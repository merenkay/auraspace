// Deciding what an utterance means, without AI. Safety first (crisis → urgent consultation path; symptoms →
// consultation engine), then everyday conversation, then health commands. With speech, every recogniser
// alternative is corrected (fuzzy.ts), routed and scored; when two meanings are close, confidence is low or
// the words are ambiguous, AURA asks a short question instead of guessing. Values are never logged without
// the existing read-back confirmation.
import { SYSTEM_BY_ID } from '../../data/systems'
import { VITAL_BY_KEY } from '../../data/vitals'
import { fold, parseFindings } from '../doctor/parse'
import type { Alt } from '../voice/endpoint'
import { correct, detectLang, type Fix } from '../voice/fuzzy'
import { describeEntry, NAV_LABEL, parseIntent, stripWake, type Intent } from '../voice/intents'

const stripWakeRest = (t: string) => stripWake(t).rest
import type { VoiceLang } from '../voice/settings'
import { MATCH_MIN, nameScore, parseUiCommand, type UiCommand } from '../voicecontrol'
import { prep } from '../voicecontrol/grammar'
import { feelingOf, isCrisis, parseChat, type ChatIntent } from './chat'

export type Choice = { label: string; route: Route }
export type Route =
  | { kind: 'crisis'; text: string }
  | { kind: 'voice'; intent: Intent }
  | { kind: 'chat'; chat: ChatIntent }
  | { kind: 'clarify'; question: string; options: Choice[] }
  /** voice control of the page (src/lib/voicecontrol): press a control by name, scroll, type, ... */
  | { kind: 'ui'; cmd: UiCommand }
  | { kind: 'unknown' }

/** Options for routing. `names`: the names of the controls on screen now (a bare name can press one). */
export type RouteOptions = { lang?: VoiceLang; names?: string[] }

// "I", "my", "me" (and Turkish first-person endings) mark a statement about the body, never a page command
const FIRST_PERSON = /\b(?:i|i'm|im|i've|ive|my|me|mine|myself|ben|bende|benim|bana)\b|\w(?:iyorum|uyorum|ıyorum|yorum|im|um)\b/
/** Intents that already do what "open / show / select X" would mean; they win over pressing a control called X. */
const DEDICATED = new Set(['nav', 'system', 'reading', 'status', 'alerts', 'score', 'log', 'logIncomplete', 'logUnsupported'])
/** A bare phrase presses a control only when it matches a name on screen this well (and nothing else understood it). */
export const BARE_MIN = 0.86

function uiRoute(t: string, f: string, intent: Intent, names: string[] | undefined): Route | null {
  const cmd = parseUiCommand(t)
  if (!cmd) return null
  // symptoms and feelings about one's own body go to the consultation engine, whatever verb they contain
  const symptom = parseFindings(t).hits.some((h) => !h.negated)
  // (dictation is the exception: "type I have a headache" writes those words into the focused field, where the
  // consultation itself reads them; crisis words were already routed to the crisis path above)
  if (symptom && cmd.kind !== 'type' && (FIRST_PERSON.test(f) || cmd.kind !== 'press')) return null
  // the whole sentence is a control's name ("Dictate with your voice", "Show more", "Go to Overview"): press that
  if (names?.length && !symptom && ['press', 'type', 'focus', 'check', 'expand', 'search', 'setValue', 'readSection', 'step'].includes(cmd.kind)) {
    const whole = prep(t)
    const w = bestScore(whole, names)
    const tgt = 'target' in cmd && typeof cmd.target === 'string' ? cmd.target : ''
    if (w >= 0.97 && (!tgt || w >= bestScore(tgt, names))) return { kind: 'ui', cmd: { kind: 'press', target: whole } }
  }
  // verbs that dedicated intents also use ("check my blood pressure", "show the heart", "open history", "read the alerts")
  const shared = (cmd.kind === 'press' && cmd.soft) || cmd.kind === 'check' || cmd.kind === 'focus' || cmd.kind === 'expand' || (cmd.kind === 'readSection' && cmd.which === 'named')
  const target = 'target' in cmd && typeof cmd.target === 'string' ? cmd.target : ''
  const best = target && names?.length ? bestScore(target, names) : 0
  // a control named exactly so on screen wins over the dedicated meaning ("open the Sleep tab", "open Training profile");
  // logging stays a health entry unless the verb is plainly navigation ("take me to <a link that mentions exercise>")
  const navVerb = /^(?:go to|take me|open|show|press|click|tap|hit|switch|view|visit)\b/.test(prep(t))
  const exact = best >= 0.96 && (intent.type !== 'log' || navVerb) && (cmd.kind !== 'press' || !!cmd.soft) && cmd.kind !== 'readSection'
  // "log blood pressure" with no value: a "Log a measurement" menu on screen holds it
  const menu = cmd.kind === 'press' && cmd.verb === 'log' && intent.type !== 'log' && !!names?.some((n) => /^(?:log|add|record|new)\b/i.test(n))
  if (shared && DEDICATED.has(intent.type) && !exact && !menu && !(cmd.kind === 'press' && cmd.want === 'tab' && best >= MATCH_MIN)) return null
  if (cmd.kind === 'press' && cmd.soft && !menu) {
    // "show me a joke", "open the window": only a page command when a control of that name is on screen
    if (parseChat(t) && best < 0.96) return null
    if (best < MATCH_MIN) return null
  }
  // "number two" while nothing is numbered can still be a reading or a log ("two litres")
  if (cmd.kind === 'number' && intent.type === 'log') return null
  return { kind: 'ui', cmd }
}

/** How well a spoken target names some control among `names` (0..1). */
export function bestScore(target: string, names: readonly string[]): number {
  let memo = bestMemo.get(names)
  if (!memo) bestMemo.set(names, (memo = new Map()))
  const hit = memo.get(target)
  if (hit !== undefined) return hit
  let best = 0
  for (const n of names) {
    best = Math.max(best, nameScore(target, n))
    if (best >= 1) break
  }
  memo.set(target, best)
  return best
}
const bestMemo = new WeakMap<readonly string[], Map<string, number>>()

function bareRoute(t: string, names: string[] | undefined): Route | null {
  if (!names?.length) return null
  const f = cleanF(t)
  if (!f || words(f) > 6 || parseFindings(t).hits.some((h) => !h.negated)) return null
  // a recogniser's filler and politeness around a bare name ("um details please")
  const target = prep(t)
  if (!target) return null
  return bestScore(target, names) >= BARE_MIN ? { kind: 'ui', cmd: { kind: 'press', target, bare: true } } : null
}

/** Findings that a plain "I'm tired / I feel low / I can't sleep" statement may match; these get a kind reply with an offer. */
const SOFT = new Set(['fatigue', 'low-mood', 'insomnia', 'recent-eva'])

const words = (f: string) => f.split(' ').filter(Boolean).length
const cleanF = (t: string) =>
  fold(t)
    .replace(/[?!.,;:"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Short label for a meaning, used in clarifying questions. */
export function labelOf(r: Route): string {
  if (r.kind === 'voice') {
    const i = r.intent
    if (i.type === 'reading') return `your ${VITAL_BY_KEY[i.key].label.toLowerCase()}`
    if (i.type === 'log') return `logging ${describeEntry(i.key, i.values)}`
    if (i.type === 'system') return i.system ? `the ${SYSTEM_BY_ID[i.system].name.toLowerCase()} view` : 'the whole body'
    if (i.type === 'nav') return `opening ${NAV_LABEL[i.target]}`
    if (i.type === 'status') return 'a status report'
    if (i.type === 'alerts') return 'your alerts'
    if (i.type === 'score') return 'your health score'
    if (i.type === 'consult') return 'a consultation'
  }
  if (r.kind === 'ui' && r.cmd.kind === 'press') return `pressing “${r.cmd.target.split('|')[0]}”`
  if (r.kind === 'chat') {
    if (r.chat.type === 'cabin' || r.chat.type === 'weather') return 'the cabin temperature'
    if (r.chat.type === 'time') return 'the time'
    if (r.chat.type === 'joke') return 'a joke'
  }
  return 'that'
}

/** A stable key for "the same meaning" across alternatives. */
export function meaningOf(r: Route): string {
  if (r.kind === 'voice') {
    const i = r.intent
    return `voice:${i.type}:${'key' in i ? i.key : 'system' in i ? i.system : 'target' in i ? i.target : 'answer' in i ? i.answer : ''}${i.type === 'log' ? JSON.stringify(i.values) : ''}`
  }
  if (r.kind === 'chat') return `chat:${r.chat.type}`
  if (r.kind === 'ui') return `ui:${r.cmd.kind}:${'target' in r.cmd ? r.cmd.target : ''}`
  return r.kind
}

/** Meanings where acting on a mis-hearing would give the wrong health information or entry. */
const isMedical = (r: Route) => r.kind === 'voice' && ['reading', 'log', 'system', 'logIncomplete'].includes(r.intent.type)

const clarify = (options: Route[]): Route => {
  const choices = options.map((route) => ({ label: labelOf(route), route }))
  const question = choices.length === 1 ? `Did you mean ${choices[0].label}?` : `Did you mean ${choices.map((c) => c.label).join(' or ')}?`
  return { kind: 'clarify', question: question.charAt(0).toUpperCase() + question.slice(1), options: choices }
}

/** One text → one meaning. */
export function route(text: string, o: RouteOptions = {}): Route {
  const t = text.trim()
  if (!t) return { kind: 'unknown' }
  // 1. safety: suicide / self-harm words always go to the urgent consultation path
  if (isCrisis(t)) return { kind: 'crisis', text: t }
  const f = cleanF(t)
  const intent = parseIntent(t, { lang: o.lang })
  // 2. control words (they answer whatever is pending)
  if (intent.type === 'stop' || intent.type === 'answer') return { kind: 'voice', intent }
  // 2b. an explicit page command ("press Details", "scroll down", "Save'e bas"); a symptom statement never is one
  const ui = uiRoute(t, f, intent, o.names)
  if (ui) return ui
  // 2c. a control's exact name said on its own ("Training profile", "Stored history", "How the score is calculated")
  // beats a page or summary meaning of the same words; never for symptoms (they go to the consultation) or logging
  if (o.names?.length && ['unknown', 'nav', 'status', 'alerts', 'score', 'greet', 'help', 'consult'].includes(intent.type) && !parseFindings(t).hits.some((h) => !h.negated) && !(intent.type === 'greet' && !stripWakeRest(t))) {
    const target = prep(t)
    if (target && words(cleanF(target)) <= 8 && bestScore(target, o.names) >= 0.97) return { kind: 'ui', cmd: { kind: 'press', target, bare: true } }
  }
  // 3. symptoms go to the consultation engine; only a plain feeling statement gets a kind reply instead
  if (intent.type === 'consult') {
    const feel = feelingOf(t)
    const hits = parseFindings(t).hits.filter((h) => !h.negated)
    if (feel && hits.length > 0 && hits.every((h) => SOFT.has(h.id)) && !/hopeless|worthless|umutsuz|degersiz/.test(f)) return { kind: 'chat', chat: { type: 'feeling', feeling: feel } }
    return { kind: 'voice', intent }
  }
  // 4. everyday conversation
  const chat = parseChat(t)
  if (chat) {
    if (chat.type === 'feeling' && intent.type === 'log') return { kind: 'voice', intent } // "my mood is good" logs it (read back first)
    if (chat.type === 'feeling' && parseFindings(t).hits.some((h) => !h.negated && !SOFT.has(h.id))) return { kind: 'voice', intent: { type: 'consult', text: t } }
    return { kind: 'chat', chat }
  }
  // 5. follow-ups: "and the lungs?", "what about sleep?", "peki nabzım?"
  const fu = /^(?:and|what about|how about|peki|ya|bir de)\s+(.+)$/.exec(f)
  if (fu && intent.type === 'unknown') {
    const rest = route(fu[1], o)
    if (rest.kind !== 'unknown') return rest
    const sys = parseIntent(`show ${fu[1]}`, { lang: o.lang })
    if (sys.type === 'system') return { kind: 'voice', intent: sys }
  }
  // 6. ambiguity in the words themselves: ask, do not guess a medical meaning
  if (intent.type === 'unknown' && /\b(?:blood|kan(?:im|imi|in)?)\b/.test(f) && !/pressure|sugar|glucose|\bbp\b|tansiyon|seker/.test(f) && words(f) <= 7) {
    return clarify([
      { kind: 'voice', intent: { type: 'reading', key: 'bp' } },
      { kind: 'voice', intent: { type: 'reading', key: 'glucose' } },
    ])
  }
  if (intent.type === 'reading' && intent.key === 'temp' && !/\b(?:my|body|fever|ates\w*|i|me|im|vucut)\b/.test(f) && /\b(?:the|it|outside|in here|room|cabin|inside|here|station|burasi|oda)\b/.test(f)) {
    return clarify([{ kind: 'voice', intent }, { kind: 'chat', chat: { type: 'cabin' } }])
  }
  if (intent.type === 'unknown' && /\b(?:heart|kalp\w*|kalb\w*)\b/.test(f) && words(f) <= 6) {
    return clarify([
      { kind: 'voice', intent: { type: 'reading', key: 'hr' } },
      { kind: 'voice', intent: { type: 'system', system: 'heart' } },
    ])
  }
  // "how are my lungs" → show that system (with its status)
  if (intent.type === 'unknown' && words(f) <= 6) {
    const sys = parseIntent(`show ${f.replace(/^(?:how (?:is|are)|what about|check) (?:my |the )?/, '')}`, { lang: o.lang })
    if (sys.type === 'system' && sys.system) return { kind: 'voice', intent: sys }
  }
  // 7. a control's name said on its own ("Details", "Ayrıntılar"), when it clearly matches one on screen
  if (intent.type === 'unknown') {
    const bare = bareRoute(t, o.names)
    if (bare) return bare
  }
  // 8. health commands
  if (intent.type === 'greet') return { kind: 'chat', chat: { type: 'hello', wake: intent.wake } }
  if (intent.type === 'help') return { kind: 'chat', chat: { type: 'capabilities' } }
  if (intent.type !== 'unknown') return { kind: 'voice', intent }
  return { kind: 'unknown' }
}

/* ---------- alternatives ---------- */

export type Candidate = { text: string; heard: string; route: Route; score: number; confidence: number; fixes: Fix[]; lang: 'en' | 'tr' }
export type Understanding = { route: Route; text: string; heard: string; confidence: number; lang: 'en' | 'tr'; candidates: Candidate[] }

function weight(r: Route): number {
  if (r.kind === 'crisis') return 1.4
  if (r.kind === 'unknown') return 0
  if (r.kind === 'clarify') return 0.7
  if (r.kind === 'ui') return r.cmd.kind === 'press' && r.cmd.bare ? 0.9 : 1
  if (r.kind === 'chat') return r.chat.type === 'hello' || r.chat.type === 'ack' ? 0.6 : 0.92
  const t = r.intent.type
  if (t === 'consult') return r.intent.text ? 1.15 : 0.95
  if (t === 'greet' || t === 'unknown') return 0.5
  if (t === 'logIncomplete' || t === 'logUnsupported') return 0.85
  return 1
}

/** Recognisers often report 0 for "unknown"; treat the first alternative as fairly sure and the rest as less so. */
const confOf = (c: number, i: number) => (c > 0 ? c : i === 0 ? 0.8 : 0.45)

/**
 * Score every alternative (after mis-hearing corrections) against the parsers and pick the best meaning.
 * `typed` skips the low-confidence question (typing is exact). `fallback` is the language setting.
 */
export function understand(alts: Alt[], o: { lang?: VoiceLang; typed?: boolean; names?: string[] } = {}): Understanding {
  const fallback = o.lang === 'tr-TR' ? 'tr' : 'en'
  const list = alts.filter((a) => a.transcript.trim()).slice(0, 6)
  if (!list.length) return { route: { kind: 'unknown' }, text: '', heard: '', confidence: 0, lang: fallback, candidates: [] }
  const cands: Candidate[] = []
  list.forEach((a, i) => {
    const conf = confOf(a.confidence, i)
    const variants: { text: string; fixes: Fix[] }[] = [{ text: a.transcript, fixes: [] }]
    const c = correct(a.transcript)
    // a sentence that already names a control exactly is not "corrected" into a health word
    const exactName = !!o.names?.length && bestScore(prep(a.transcript), o.names) >= 0.97
    if (c.fixes.length && !exactName) variants.push(c)
    for (const v of variants) {
      const lang = detectLang(v.text, fallback)
      const r = route(v.text, { lang: lang === 'tr' ? 'tr-TR' : 'en-US', names: o.names })
      const table = v.fixes.filter((x) => x.kind === 'table').length
      const fuzzy = v.fixes.filter((x) => x.kind === 'fuzzy').reduce((s, x) => s + 0.05 + 0.05 * x.dist, 0)
      // a press is only as good as its match on screen: the alternative that names a real control wins
      let w = weight(r)
      if (r.kind === 'ui' && r.cmd.kind === 'press' && o.names?.length && !r.cmd.verb) {
        const s = bestScore(r.cmd.target, o.names)
        w *= s >= MATCH_MIN ? 1 + 0.15 * (s - MATCH_MIN) : 0.8
      }
      const score = w * (0.55 + 0.45 * conf) - 0.03 * table - fuzzy - 0.02 * i
      cands.push({ text: v.text, heard: a.transcript, route: r, score, confidence: a.confidence, fixes: v.fixes, lang })
    }
  })
  cands.sort((x, y) => y.score - x.score)
  const best = cands[0]
  const pick = (route: Route): Understanding => ({ route, text: best.text, heard: best.heard, confidence: best.confidence, lang: best.lang, candidates: cands })
  if (best.route.kind === 'unknown' || best.route.kind === 'crisis' || best.route.kind === 'clarify') return pick(best.route)

  // two different medical meanings almost tied: ask which
  const rival = cands.find((c) => c.route.kind !== 'unknown' && meaningOf(c.route) !== meaningOf(best.route))
  if (rival && isMedical(best.route) && isMedical(rival.route) && best.score - rival.score < 0.06) return pick(clarify([best.route, rival.route]))
  // low recogniser confidence, or a bold fuzzy correction, behind a medical meaning: check first
  const bold = best.fixes.some((x) => x.kind === 'fuzzy' && x.dist >= 2)
  if (!o.typed && isMedical(best.route) && ((best.confidence > 0 && best.confidence < 0.45) || bold)) return pick(clarify([best.route]))
  // a single word heard with low confidence that would press something: ask first ("Did you mean pressing “Pause”?")
  if (!o.typed && best.route.kind === 'ui' && best.route.cmd.kind === 'press' && best.route.cmd.bare && words(cleanF(best.route.cmd.target)) === 1 && best.confidence > 0 && best.confidence < 0.5) return pick(clarify([best.route]))
  return pick(best.route)
}

/* ---------- answering a clarifying question ---------- */

/** Which option the reply picks: an index, 'no' (none of them), or null (not an answer: treat as a new request). */
export function resolveClarify(text: string, options: Choice[], lang?: VoiceLang): number | 'no' | null {
  const f = cleanF(text)
  if (/^(?:the )?(?:first|first one|former|number one|1|one|birinci|ilki|ilk|ilki olsun)\b/.test(f)) return 0
  if (options.length > 1 && /^(?:the )?(?:second|second one|latter|other one|last one|number two|2|two|ikinci|ikincisi|sonuncu|digeri)\b/.test(f)) return 1
  const r = route(correct(text).text, { lang })
  if (r.kind === 'voice' && r.intent.type === 'answer') {
    if (r.intent.answer === 'no') return 'no'
    if (r.intent.answer === 'yes' && options.length === 1) return 0
    return null
  }
  const m = meaningOf(r)
  const same = options.findIndex((o) => meaningOf(o.route) === m)
  if (same >= 0) return same
  // a distinctive word from one label: "pressure", "sugar", "cabin", "body", "view"
  const STOP = new Set(['your', 'the', 'view', 'logging', 'opening', 'a', 'of', 'blood'])
  const hits = options.map((o) => o.label.split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)).some((w) => f.includes(fold(w))))
  if (hits.filter(Boolean).length === 1) return hits.indexOf(true)
  if (/\b(?:body|my|vucut|benim)\b/.test(f)) {
    const i = options.findIndex((o) => o.label.startsWith('your'))
    if (i >= 0 && options.length > 1) return i
  }
  if (/\b(?:rate|beat|pulse|nabiz|nabz\w*)\b/.test(f)) {
    const i = options.findIndex((o) => o.route.kind === 'voice' && o.route.intent.type === 'reading' && o.route.intent.key === 'hr')
    if (i >= 0) return i
  }
  if (/\b(?:cabin|room|air|kabin|oda|ortam)\b/.test(f)) {
    const i = options.findIndex((o) => o.route.kind === 'chat')
    if (i >= 0) return i
  }
  if (/\b(?:view|show|organ|model|goster|gorunum)\b/.test(f)) {
    const i = options.findIndex((o) => o.route.kind === 'voice' && o.route.intent.type === 'system')
    if (i >= 0) return i
  }
  return null
}
