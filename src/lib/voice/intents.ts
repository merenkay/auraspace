// Deterministic intent parser for spoken (or typed) commands, English and Turkish. No AI: ordered keyword
// rules on accent-folded text. It only decides WHAT the person wants; every answer comes from the existing
// rule engines. When nothing matches, the intent is "unknown" and AURA says so honestly.
import type { SystemId } from '../../data/systems'
import { VITAL_BY_KEY, VITALS, type FieldId, type VitalKey } from '../../data/vitals'
import { fold, parseFindings } from '../doctor/parse'
import { extractNumbers } from './numbers'
import type { VoiceLang } from './settings'

export type NavTarget = 'overview' | 'diagnostics' | 'aura' | 'coach' | 'history' | 'environment' | 'reports' | 'roster'
export type Values = Partial<Record<FieldId, number>>

export type Intent =
  | { type: 'status' }
  | { type: 'reading'; key: VitalKey }
  | { type: 'alerts' }
  | { type: 'score' }
  | { type: 'system'; system: SystemId | null }
  | { type: 'nav'; target: NavTarget }
  | { type: 'log'; key: VitalKey; values: Values; mode: 'add' | 'set' }
  | { type: 'logIncomplete'; key: VitalKey }
  | { type: 'logUnsupported'; key: VitalKey }
  | { type: 'consult'; text: string }
  | { type: 'answer'; answer: 'yes' | 'no' | 'unsure' }
  | { type: 'repeat' }
  | { type: 'stop' }
  | { type: 'help' }
  | { type: 'close' }
  | { type: 'greet'; wake: boolean }
  | { type: 'unknown' }

/* ---------- wake word ---------- */

const WAKE_RE = /^\s*(?:(?:hey|hi|ok|okay|hello|selam|merhaba)[\s,]+)?(?:aura|aurora|ora|laura)\b[\s,.:!?-]*/i
const WAKE_ANY = /\b(?:hey|ok|okay|hi|selam|merhaba)?\s*(?:aura|aurora|ora|laura)\b/i

/** True when the text contains the wake word ("AURA", "hey AURA"; recognisers often hear "Ora"). */
export const hasWake = (text: string) => WAKE_ANY.test(fold(text))

/** Remove a leading wake word. `rest` may be empty when the person only said "AURA". */
export function stripWake(text: string): { woke: boolean; rest: string } {
  const m = WAKE_RE.exec(fold(text))
  if (!m) return { woke: false, rest: text.trim() }
  // fold() can change length (İ, ̇), so cut on words instead of characters
  const words = text.trim().split(/\s+/)
  let n = fold(text).slice(0, m[0].length).split(/\s+/).filter(Boolean).length
  n = Math.min(n, words.length)
  return { woke: true, rest: words.slice(n).join(' ').replace(/^[\s,.:!?-]+/, '') }
}

/* ---------- vocabulary (all patterns run on folded text: ASCII, lower-case) ---------- */

export const READING_WORDS: [VitalKey, RegExp][] = [
  ['bp', /blood pressure|\bbp\b|tansiyon|\bpressure\b/],
  ['hr', /heart rate|\bpulse\b|nabiz|nabz|heart ?beat|kalp atis|\bbpm\b/],
  ['spo2', /oxygen|spo2|saturation|oksijen/],
  ['temp', /temperature|\btemp\b|fever|ates|sicaklik/],
  ['glucose', /blood sugar|glucose|seker/],
  ['sleep', /sleep|slept|uyku|uyud/],
  ['water', /\bwater\b|hydrat|\bsu\b|\bsuyu|\bsiv[ie]/],
  ['mood', /\bmood\b|ruh hali|morale/],
  ['exercise', /exercis|workout|egzersiz|\bspor\b/],
  ['vision', /\bvision\b|eyesight|\bsight\b|gorme|gorus/],
]

const SYSTEM_WORDS: [SystemId, RegExp][] = [
  ['heart', /\bheart\b|cardio|circulat|kalp|kalb/],
  ['lungs', /\blungs?\b|breathing|respirat|akciger|solunum/],
  ['brain', /\bbrain\b|behaviou?r|beyin|beyn/],
  ['eyes', /\beyes?\b|\bsans\b|\bgoz/],
  ['metabolism', /metabol|nutrition|beslenme/],
  ['immune', /immun|bagisik/],
  ['bones', /\bbones?\b|muscles?|skelet|kemik|kemig|\bkas/],
  ['renal', /kidney|renal|bobrek|bobreg/],
  ['radiation', /radiation|radyasyon/],
]

const NAV_WORDS: [NavTarget, RegExp][] = [
  ['diagnostics', /diagnostic|body map|teshis|tani\b|vucut harita/],
  ['aura', /(?:aura|consultation|consult) (?:tab|page)|danisma sekme|aura sekme/],
  ['coach', /\bcoach|training|workout plan|activity tab|antrenman|kocluk|\bkoc\b/],
  ['history', /history|trends?\b|gecmis/],
  ['environment', /environment|conditions\b|cabin|cevre|ortam/],
  ['reports', /\breports\b|\breport page|raporlar/],
  ['roster', /roster|crew list|crew page|ekip listesi|ekip sayfa/],
  ['overview', /overview|dashboard|home page|\bhome\b|genel bakis|ana sayfa/],
]

const SHOW_VERB = /\b(?:show|select|open|display|focus|highlight|go to|pick|take me|goster|ac|sec|odaklan|git|gotur)\b/
const QUESTION = /\?|^(?:is|are|does|do|can|should)\b|\b(?:how|what|whats|which|tell|check|read|explain|nasil|kac|ne kadar|soyle|acikla|neden|why)\b|\bm[iu]\b|\bis it\b/
const TR_HINT = /tansiyon|nabiz|oksijen|ates|seker|uyku|goster|kalp|nasil|\bsu\b|bardak|evet|hayir/

/* ---------- small helpers ---------- */

const clean = (f: string) => f.replace(/[.,!?;:"]/g, ' ').replace(/\s+/g, ' ').trim()
const FILLER = /^(?:(?:ok|okay|alright|well)\s+)?(.*?)(?:\s+(?:please|thanks|thank you|lutfen|aura))?$/

const YES = new Set(['yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'correct', 'confirm', 'confirmed', 'affirmative', 'do it', 'save it', 'go ahead', 'thats right', 'right', 'yes please', 'evet', 'tamam', 'onay', 'onayla', 'dogru', 'kaydet', 'olur', 'var', 'evet var'])
const NO = new Set(['no', 'nope', 'nah', 'cancel', 'negative', 'dont', 'do not', 'wrong', 'incorrect', 'never mind', 'nevermind', 'hayir', 'iptal', 'vazgec', 'yanlis', 'yok', 'degil', 'no thanks'])
const UNSURE = new Set(['not sure', 'unsure', 'maybe', 'i dont know', 'dont know', 'dunno', 'i am not sure', 'im not sure', 'emin degilim', 'bilmiyorum', 'belki', 'bilemiyorum', 'emin degil'])

function answerOf(f: string): 'yes' | 'no' | 'unsure' | null {
  const t = (FILLER.exec(clean(f).replace(/'/g, ''))?.[1] ?? '').trim()
  if (!t) return null
  if (YES.has(t)) return 'yes'
  if (NO.has(t)) return 'no'
  if (UNSURE.has(t)) return 'unsure'
  return null
}

const readingKeyOf = (f: string): VitalKey | null => READING_WORDS.find(([, re]) => re.test(f))?.[0] ?? null

/* ---------- logging by voice ---------- */

function waterLitres(raw: string, f: string, nums: number[]): number | null {
  const n = nums[0]
  const isMl = /\b(?:ml|millilit(?:re|er)s?|cc)\b|\bmililitre/.test(f)
  const isL = /\b(?:litres?|liters?|lt|l)\b/.test(f)
  const isGlass = /\b(?:glass(?:es)?|cups?)\b|bardak/.test(f)
  if (n === undefined) return isGlass && /\b(?:a|one|bir)\b/.test(f) ? 0.25 : null
  if (isMl) return n / 1000
  if (isGlass) return n * 0.25 // one glass is taken as 250 ml and read back before saving
  if (isL) return n
  return n >= 20 ? n / 1000 : n
}

function parseLog(raw: string, f: string, tr: boolean): Intent | null {
  const key = readingKeyOf(f)
  if (!key) return null
  const nums = extractNumbers(raw, tr)
  const LOG_VERB = /\b(?:log|add|record|save|enter|drank|drink|had|ictim|icti|ekle|kaydet)\b/
  if (key === 'water') {
    if (!nums.length && !(LOG_VERB.test(f) && /glass|cup|bardak/.test(f))) return null
    const l = waterLitres(raw, f, nums)
    if (l === null || !(l > 0)) return null
    const set = /\b(?:total|so far|toplam|altogether)\b|\bwater (?:today |intake )?(?:is|was|at)\b/.test(f)
    return { type: 'log', key, values: { water: Math.round(l * 1000) / 1000 }, mode: set ? 'set' : 'add' }
  }
  if (!nums.length) return null
  switch (key) {
    case 'bp':
      return nums.length >= 2 ? { type: 'log', key, values: { sys: nums[0], dia: nums[1] }, mode: 'set' } : { type: 'logIncomplete', key }
    case 'hr':
      return { type: 'log', key, values: { hr: nums[0] }, mode: 'set' }
    case 'spo2':
      return { type: 'log', key, values: { spo2: nums[0] }, mode: 'set' }
    case 'temp':
      return { type: 'log', key, values: { temp: nums[0] }, mode: 'set' }
    case 'glucose':
      return { type: 'log', key, values: { glucose: nums[0] }, mode: 'set' }
    case 'sleep': {
      const mins = /\b(?:minutes?|mins?|dakika)\b/.test(f) && !/\b(?:hours?|hrs?|saat)\b/.test(f)
      return { type: 'log', key, values: { sleep: Math.round((mins ? nums[0] / 60 : nums[0]) * 10) / 10 }, mode: 'set' }
    }
    default:
      return { type: 'logUnsupported', key }
  }
}

/** Same limits as the manual entry form (field min/max), plus systolic above diastolic. Returns a spoken reason or null. */
export function validateValues(values: Values): string | null {
  for (const def of VITALS) {
    for (const f of def.fields) {
      const v = values[f.id]
      if (v === undefined) continue
      if (!Number.isFinite(v) || v < f.min || v > f.max) return `${f.label.replace(/ \(.*\)$/, '')} must be between ${f.min} and ${f.max}. I did not save anything.`
    }
  }
  if (values.sys !== undefined && values.dia !== undefined && values.sys <= values.dia) return 'The upper blood pressure number must be higher than the lower one. I did not save anything.'
  return null
}

/** Plain-language read-back of a pending entry, spoken before the person confirms. */
export function describeEntry(key: VitalKey, v: Values, prevWater?: number): string {
  switch (key) {
    case 'bp':
      return `blood pressure ${v.sys} over ${v.dia}`
    case 'hr':
      return `heart rate ${v.hr} beats per minute`
    case 'spo2':
      return `oxygen saturation ${v.spo2} percent`
    case 'temp':
      return `body temperature ${v.temp} degrees Celsius`
    case 'glucose':
      return `blood sugar ${v.glucose} milligrams per decilitre`
    case 'sleep':
      return `${v.sleep} hours of sleep last night`
    case 'water':
      return prevWater !== undefined && prevWater > 0 ? `water today ${round(v.water ?? 0)} litres, adding to ${round(prevWater)}` : `water today ${round(v.water ?? 0)} litres`
    default:
      return VITAL_BY_KEY[key].label.toLowerCase()
  }
}
const round = (n: number) => Math.round(n * 100) / 100

/* ---------- the parser ---------- */

export function parseIntent(text: string, opts: { lang?: VoiceLang } = {}): Intent {
  const { woke, rest } = stripWake(text)
  const raw = rest
  const f = clean(fold(raw))
  if (!f) return woke ? { type: 'greet', wake: true } : { type: 'unknown' }
  const tr = opts.lang === 'tr-TR' || TR_HINT.test(f)
  const words = f.split(' ').length

  if (/^(?:stop|be quiet|quiet|silence|shut up|enough|hush|dur|sus|sessiz ol|sessiz|yeter)(?: talking)?$/.test(f.replace(/ (?:please|lutfen)$/, '')) || /^(?:that'?s enough|thats enough)$/.test(f)) return { type: 'stop' }
  const ans = words <= 5 ? answerOf(f) : null
  if (ans) return { type: 'answer', answer: ans }
  if (words <= 5 && /^(?:close|dismiss|goodbye|bye|that'?s all|thats all|thanks|thank you|kapat|gorusuruz|tesekkurler|tesekkur ederim|sagol)\b/.test(f)) return { type: 'close' }
  if (/\b(?:repeat|say (?:that )?again|come again|once more|tekrar|ne dedin)\b/.test(f)) return { type: 'repeat' }
  if (/\b(?:help|what can i say|what can you do|commands|yardim|neler yapabilirsin|ne diyebilirim|ne soyleyebilirim)\b/.test(f)) return { type: 'help' }

  const question = QUESTION.test(f)

  if (!question) {
    const log = parseLog(raw, f, tr)
    if (log) return log
  }

  if (/\b(?:score|skor)|\bpuan/.test(f)) return { type: 'score' }
  if (/\b(?:status|briefing|brief me|how am i|how'?m i|how i am|how'?s my health|how is my health|my health|health summary|summary|sitrep|durum|nasilim|ozet|sagligim)\b/.test(f) || /\bgive me (?:a |the )?report\b/.test(f)) return { type: 'status' }
  if (/\b(?:alerts?|warnings?|alarms?|problems?|what'?s wrong|anything wrong|needs? attention|alarm|sorun|dikkat)\b|uyari/.test(f)) return { type: 'alerts' }

  const reading = readingKeyOf(f)

  if (!reading) {
    if (/whole body|tum vucut|clear selection|deselect|selection off/.test(f)) return { type: 'system', system: null }
    if (SHOW_VERB.test(f) || words <= 2) {
      const sys = SYSTEM_WORDS.find(([, re]) => re.test(f))?.[0]
      if (sys && !NAV_WORDS.some(([, re]) => re.test(f))) return { type: 'system', system: sys }
    }
  }
  if (SHOW_VERB.test(f) || words <= 3 || /training|antrenman/.test(f)) {
    const nav = NAV_WORDS.find(([, re]) => re.test(f))?.[0]
    if (nav && (!reading || /training|workout plan|activity tab|antrenman/.test(f))) return { type: 'nav', target: nav }
  }

  // "how is my blood pressure", "tansiyonum nasıl", or just "heart rate"
  if (reading && (question || words <= 3 || SHOW_VERB.test(f))) return { type: 'reading', key: reading }

  if (parseFindings(raw).hits.length > 0) return { type: 'consult', text: raw }
  if (/\b(?:consultation|consult|symptoms?|not feeling well|don'?t feel well|feel sick|feel ill|i'?m sick|i am sick|i'?m ill|danisma|muayene|semptom|hastayim|rahatsizim|kendimi iyi hissetmiyorum|kotu hissediyorum)\b/.test(f)) return { type: 'consult', text: '' }
  if (reading) return { type: 'reading', key: reading }
  if (words <= 3 && /^(?:hello|hi|hey|good (?:morning|afternoon|evening)|merhaba|selam|gunaydin|iyi aksamlar)\b/.test(f)) return { type: 'greet', wake: woke }
  return woke ? { type: 'greet', wake: true } : { type: 'unknown' }
}

/** What each role may open by voice, as router paths. Null = not available to this role. */
export function pathFor(target: NavTarget, role: string | undefined, crewId: number | null): string | null {
  const own = role === 'astronaut' || role === 'member'
  const crew = crewId != null ? `/crew/${crewId}` : null
  switch (target) {
    case 'overview':
      return crew ?? (role === 'surgeon' || role === 'ground' ? '/crew' : null)
    case 'diagnostics':
      return crew && (own || role === 'surgeon') ? `${crew}/diagnostics` : null
    case 'aura':
      return crew && (own || role === 'surgeon') ? `${crew}/aura` : null
    case 'coach':
      return crew && own ? `${crew}/coach` : null
    case 'history':
      return crew ? `${crew}/history` : null
    case 'environment':
      return '/environment'
    case 'reports':
      return role === 'surgeon' ? '/reports' : null
    case 'roster':
      return role === 'surgeon' || role === 'ground' ? '/crew' : null
  }
}

export const NAV_LABEL: Record<NavTarget, string> = { overview: 'the overview', diagnostics: 'diagnostics', aura: 'the AURA consultation', coach: 'the coach', history: 'history', environment: 'the environment page', reports: 'reports', roster: 'the crew list' }

/** Example phrases shown as chips and spoken by "help". */
export const EXAMPLES = ['Status report', 'How is my blood pressure?', 'Show the heart', 'Log 250 millilitres of water', 'My blood pressure is 128 over 82', 'I have chest pain', 'Open history']
export const EXAMPLES_TR = ['Durum raporu', 'Tansiyonum nasıl?', 'Kalbi göster', 'Nabzım kaç?', '250 mililitre su içtim', 'Göğsüm ağrıyor']
