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
import { describeEntry, NAV_LABEL, parseIntent, type Intent } from '../voice/intents'
import type { VoiceLang } from '../voice/settings'
import { feelingOf, isCrisis, parseChat, type ChatIntent } from './chat'

export type Choice = { label: string; route: Route }
export type Route =
  | { kind: 'crisis'; text: string }
  | { kind: 'voice'; intent: Intent }
  | { kind: 'chat'; chat: ChatIntent }
  | { kind: 'clarify'; question: string; options: Choice[] }
  | { kind: 'unknown' }

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
export function route(text: string, o: { lang?: VoiceLang } = {}): Route {
  const t = text.trim()
  if (!t) return { kind: 'unknown' }
  // 1. safety: suicide / self-harm words always go to the urgent consultation path
  if (isCrisis(t)) return { kind: 'crisis', text: t }
  const f = cleanF(t)
  const intent = parseIntent(t, { lang: o.lang })
  // 2. control words (they answer whatever is pending)
  if (intent.type === 'stop' || intent.type === 'answer') return { kind: 'voice', intent }
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
  // 7. health commands
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
export function understand(alts: Alt[], o: { lang?: VoiceLang; typed?: boolean } = {}): Understanding {
  const fallback = o.lang === 'tr-TR' ? 'tr' : 'en'
  const list = alts.filter((a) => a.transcript.trim()).slice(0, 6)
  if (!list.length) return { route: { kind: 'unknown' }, text: '', heard: '', confidence: 0, lang: fallback, candidates: [] }
  const cands: Candidate[] = []
  list.forEach((a, i) => {
    const conf = confOf(a.confidence, i)
    const variants: { text: string; fixes: Fix[] }[] = [{ text: a.transcript, fixes: [] }]
    const c = correct(a.transcript)
    if (c.fixes.length) variants.push(c)
    for (const v of variants) {
      const lang = detectLang(v.text, fallback)
      const r = route(v.text, { lang: lang === 'tr' ? 'tr-TR' : 'en-US' })
      const table = v.fixes.filter((x) => x.kind === 'table').length
      const fuzzy = v.fixes.filter((x) => x.kind === 'fuzzy').reduce((s, x) => s + 0.05 + 0.05 * x.dist, 0)
      const score = weight(r) * (0.55 + 0.45 * conf) - 0.03 * table - fuzzy - 0.02 * i
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
