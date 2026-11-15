// Test corpus for voice control: what a real speech recogniser returns when someone names a control on screen.
// Recognisers deliver lower-case text without punctuation, with articles, politeness, fillers, partial names,
// numbers and symbols spoken as words, typical mis-hearings, and Turkish command forms around English labels.
// The fixtures (fixtures/pages.json) are the controls the real app shows per role, page and screen size, captured
// through the headless driver (tools/shot.mjs + the scan in this folder). Test-only: the app never imports this.
import { fold } from '../doctor/parse'

export type RawControl = {
  name: string
  kind: string
  aria?: string
  title?: string
  voice?: string
  heading?: string
  lines?: string[]
  risk?: string
  disabled?: boolean
  inView?: boolean
  selected?: boolean
  expanded?: boolean
  checked?: boolean
  context?: string
  href?: string
}
export type RawPage = { role: string; size: 'phone' | 'desktop'; path: string; controls: RawControl[] }

/** What a person reads on the control: its first visible line (or aria-label for icon-only ones). */
export function humanLabel(c: RawControl): string {
  if (c.voice) return c.voice
  const first = c.lines?.[0]
  if (first && /[a-z]{2}/i.test(first)) return first.replace(/\s*\((?:alt|ctrl)[^)]*\)/i, '').split(/\s+·\s+/)[0]
  const n = (c.aria ?? c.name).replace(/\s*\((?:alt|ctrl)[^)]*\)/i, '')
  const cut = /^(.{2,}?[a-z)])\s*(?=\d)/i.exec(n)
  return (cut ? cut[1] : n).split(/\s+·\s+/)[0].split(/[.:]\s/)[0]
}

/** As a recogniser writes it: lower case, no punctuation, symbols and short numbers as words. */
export function asSpoken(label: string): string {
  const NUM: Record<string, string> = { '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '15': 'fifteen', '24': 'twenty four', '30': 'thirty' }
  return fold(label)
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/\b(\d+)\s*h\b/g, (_, n) => `${NUM[n] ?? n} ${n === '1' ? 'hour' : 'hours'}`)
    .replace(/\b(\d+)\s*min\b/g, (_, n) => `${NUM[n] ?? n} minutes`)
    .replace(/\b(\d+)\b/g, (n) => NUM[n] ?? n)
    .replace(/[-–—/]/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Typical mis-hearings of words that occur in this app's labels. */
const MISHEAR: [RegExp, string][] = [
  [/\bdetails\b/, "detail's"],
  [/\bcoach\b/, 'couch'],
  [/\blog\b/, 'lock'],
  [/\bsave\b/, 'safe'],
  [/\bhistory\b/, 'hissed ory'],
  [/\bsleep\b/, 'sleeps'],
  [/\bsend\b/, 'sent'],
  [/\bx ray\b/, 'x-ray'],
  [/\bre measure\b/, 'remeasure'],
  [/\baura\b/, 'ora'],
  [/\bskin\b/, 'skinn'],
]

/** Turkish words a speaker may use for an English label (the inverse of names.ts TR_ALIASES, by hand). */
const TR_NAME: Record<string, string> = {
  details: 'ayrıntılar', save: 'kaydet', history: 'geçmiş', coach: 'koç', environment: 'ortam', overview: 'genel bakış', diagnostics: 'tanı',
  'expand all': 'tümünü aç', 'show more': 'daha fazla göster', 'sign out': 'çıkış yap', send: 'gönder', 'log a measurement': 'ölçüm ekle', crew: 'ekip', reports: 'raporlar',
  'zoom in': 'yakınlaştır', 'zoom out': 'uzaklaştır', pause: 'duraklat', 'my reports': 'raporlarım', 'send report to flight surgeon': 'raporu gönder',
}

const backVowel = (w: string) => {
  const v = fold(w).replace(/[^aeiou]/g, '')
  return /[aou]$/.test(v) || /[ı]$/.test(w.replace(/[^aeıioöuü]/g, ''))
}

export type Utterance = { text: string; tag: string }

/** The natural ways of naming one control, English and Turkish. */
export function utterancesFor(c: RawControl): Utterance[] {
  const L = asSpoken(humanLabel(c))
  if (!L) return []
  const words = L.split(' ')
  const role = c.kind === 'tab' ? 'tab' : c.kind === 'link' ? 'link' : c.kind === 'checkbox' ? 'checkbox' : c.kind === 'field' ? 'field' : 'button'
  const out: Utterance[] = []
  const add = (text: string, tag: string) => {
    if (!out.some((u) => u.text === text)) out.push({ text, tag })
  }
  if (c.kind === 'field') {
    add(`focus ${L}`, 'en-field')
    add(`click on the ${L} field`, 'en-field')
    return out
  }
  add(L, 'bare')
  add(`press ${L}`, 'en-verb')
  add(`click on ${L}`, 'en-verb')
  add(`can you press the ${L} ${role} please`, 'en-polite')
  add(`hit the ${L} ${role}`, 'en-role')
  add(`um press uh ${L}`, 'en-filler')
  add(`prez ${L}`, 'en-mishear')
  for (const [re, to] of MISHEAR) if (re.test(L)) add(`click ${L.replace(re, to)}`, 'en-mishear')
  if (words.length >= 3) add(`press ${words.slice(0, 2).join(' ')}`, 'en-partial')
  if (c.kind === 'tab') {
    add(`open the ${L} tab`, 'en-tab')
    add(`switch to ${L}`, 'en-tab')
  }
  if (c.kind === 'link') {
    add(`go to ${L}`, 'en-nav')
    add(`take me to ${L}`, 'en-nav')
    add(`open the ${L} page`, 'en-nav')
  }
  if (c.kind === 'disclosure') {
    add(`open ${L}`, 'en-open')
    add(`expand ${L}`, 'en-open')
  }
  if (c.kind === 'checkbox') add(`tick ${L}`, 'en-check')
  // Turkish command forms with the English label
  const suf = backVowel(L) ? 'a' : 'e'
  add(`${L} butonuna bas`, 'tr-verb')
  add(`${L}'${suf} tıkla`, 'tr-suffix')
  if (c.kind === 'link' || c.kind === 'tab') add(`${L}'${suf} geç`, 'tr-nav')
  const tr = TR_NAME[L]
  if (tr) {
    add(tr, 'tr-name')
    add(`${tr} ${c.kind === 'link' ? 'sayfasını aç' : 'butonuna bas'}`, 'tr-name')
  }
  return out
}

/** Sentences that must never press a control (symptoms, crises), whatever is on screen. */
export const NEVER_PRESS = [
  'i have pressure in my chest',
  'I feel like I am going to pass out',
  'my chest hurts when I press on it',
  'göğsümde baskı var',
  'I have a headache',
  'press on my chest hurts',
  'I want to kill myself',
  'my heart is racing',
]
