// Matching a spoken control name against the names written on screen, without AI. The labels are English; a
// Turkish speaker says them with Turkish grammar ("Details'e bas", "Save'e tıkla") or uses a Turkish word for
// the most common ones (kaydet -> Save). Everything works on fold()-ed text (ASCII, lower case).
//
// What a recogniser really returns is messier than a typed label: no punctuation, numbers and symbols as words
// ("x ray", "twenty four hours", "re measure"), plurals and verb forms, articles and role words ("the details
// button"), typical mis-hearings ("couch" for coach, "lock" for log, "the tales" for details) and Turkish case
// endings. Both sides are reduced to content tokens (canonical units, stems), then compared in tiers:
// exact > joined-up spelling > same words > prefix > all words inside the name > sounds alike.
import { fold } from '../doctor/parse'
import { editDistance, phoneticKey } from '../voice/fuzzy'
import { normalizeNumbers } from '../voice/numbers'

/** A control or heading name, normalised for matching: no keyboard hints, punctuation or extra spaces. */
export function normName(s: string): string {
  return fold(s)
    .replace(/\((?:alt|ctrl|shift|cmd|opens in)[^)]*\)/g, ' ')
    .replace(/[’']/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/%/g, ' percent ')
    .replace(/(\d)\.(\d)/g, '$1_$2')
    .replace(/[^a-z0-9_' ]+/g, ' ')
    .replace(/'\w*/g, '') // a Turkish case suffix or English possessive after an apostrophe: details'e -> details
    .replace(/_/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Turkish words for the most frequent labels (folded) -> the English label words they stand for. */
export const TR_ALIASES: [string, string[]][] = [
  ['tumunu genislet', ['expand all']],
  ['tumunu ac', ['expand all']],
  ['tumunu kapat', ['collapse all']],
  ['tumunu daralt', ['collapse all']],
  ['daha fazla goster', ['show more']],
  ['daha az goster', ['show less']],
  ['cikis yap', ['sign out', 'log out']],
  ['oturumu kapat', ['sign out', 'log out']],
  ['giris yap', ['sign in', 'log in']],
  ['hesabi sil', ['delete account']],
  ['olcum ekle', ['log a measurement', 'add reading', 'add measurement']],
  ['olcum kaydet', ['log a measurement']],
  ['yeni olcum', ['log a measurement']],
  ['tekrar olc', ['re measure']],
  ['yeniden olc', ['re measure']],
  ['raporu gonder', ['send report']],
  ['rapor gonder', ['send report']],
  ['raporlarim', ['my reports']],
  ['sesli oku', ['read aloud']],
  ['yeniden baslat', ['restart', 'start again', 'start over']],
  ['bastan basla', ['start again', 'start over']],
  ['tam ekran', ['full screen']],
  ['tam ekrandan cik', ['exit full screen']],
  ['ana sayfa', ['overview', 'home']],
  ['genel bakis', ['overview']],
  ['tum vucut', ['whole body']],
  ['butun vucut', ['whole body']],
  ['geri don', ['back']],
  ['el kontrolu', ['hand control']],
  ['ayrintilar', ['details']],
  ['ayrinti', ['details']],
  ['detaylar', ['details']],
  ['detay', ['details']],
  ['kaydet', ['save']],
  ['iptal', ['cancel']],
  ['vazgec', ['cancel']],
  ['kapat', ['close']],
  ['geri', ['back']],
  ['gonder', ['send', 'submit']],
  ['sil', ['delete', 'remove']],
  ['kaldir', ['remove']],
  ['duzenle', ['edit']],
  ['ekle', ['add']],
  ['yeni', ['new']],
  ['ara', ['search']],
  ['devam', ['continue', 'next']],
  ['ileri', ['next']],
  ['sonraki', ['next']],
  ['onceki', ['previous']],
  ['ayarlar', ['settings']],
  ['yardim', ['help']],
  ['kaynaklar', ['sources']],
  ['tamam', ['ok', 'done']],
  ['bitti', ['done']],
  ['yenile', ['refresh']],
  ['gecmis', ['history']],
  ['ortam', ['environment']],
  ['kosullar', ['conditions']],
  ['raporlar', ['reports']],
  ['rapor', ['report']],
  ['ekip', ['crew', 'roster']],
  ['murettebat', ['crew']],
  ['tani', ['diagnostics']],
  ['teshis', ['diagnostics']],
  ['koc', ['coach']],
  ['aktivite', ['activity']],
  ['hesap', ['account']],
  ['diger', ['more']],
  ['daha fazla', ['more']],
  ['dinle', ['listen']],
  ['baslat', ['start']],
  ['basla', ['start']],
  ['durdur', ['stop', 'pause']],
  ['duraklat', ['pause']],
  ['yakinlastir', ['zoom in']],
  ['uzaklastir', ['zoom out']],
  ['dondur', ['rotate']],
  ['iskelet', ['skeleton']],
  ['organlar', ['organs']],
  ['atardamarlar', ['arteries']],
  ['toplardamarlar', ['veins']],
  ['sinirler', ['nerves']],
  ['kaslar', ['muscles']],
  ['cilt', ['skin']],
  ['deri', ['skin']],
  ['rontgen', ['x ray']],
  ['tablo', ['table']],
  ['indir', ['download']],
  ['paylas', ['share']],
  ['yazdir', ['print']],
  ['onayla', ['confirm']],
  ['evet', ['yes']],
  ['hayir', ['no']],
  ['ses', ['voice', 'sound']],
  ['kalp', ['heart']],
  ['akciger', ['lungs']],
  ['beyin', ['brain']],
  ['gozler', ['eyes']],
  ['bobrekler', ['kidneys']],
  ['tansiyon', ['blood pressure']],
  ['nabiz', ['heart rate', 'pulse']],
  ['oksijen', ['oxygen']],
  ['uyku', ['sleep']],
  ['su', ['water']],
  ['ruh hali', ['mood']],
  ['egzersiz', ['exercise']],
  ['ates', ['temperature']],
  ['seker', ['blood sugar']],
  ['hafta', ['week']],
]

/** Recogniser mis-hearings of words used in this app's labels (folded, whole words) -> the label word. */
export const HEARD_AS: [RegExp, string][] = [
  [/\b(?:the tales|the tails|de tails|detales|detail's|detals|detailes)\b/g, 'details'],
  [/\b(?:couch|coaches|cooch|kotch)\b/g, 'coach'],
  [/\b(?:lock|logg|lug|look|clog)\b(?= (?:a |the )?(?:measurement|reading|sleep|water|mood|this|session|exercise|blood|heart))/g, 'log'],
  [/\b(?:ora|aurora|laura|orah|aurah|awra|oura|or a)\b/g, 'aura'],
  [/\bsafe\b/g, 'save'],
  [/\b(?:x ray|ex ray|xray|x rays)\b/g, 'x ray'],
  [/\b(?:re measure|remeasure|re measured|rimeasure|remeasured)\b/g, 're measure'],
  [/\b(?:hiss tory|his tory|histry)\b/g, 'history'],
  [/\b(?:in vironment|environments|enviroment)\b/g, 'environment'],
  [/\b(?:diagnostic's|dye agnostics|diagnosis)\b/g, 'diagnostics'],
  [/\b(?:over view|overviews)\b/g, 'overview'],
  [/\b(?:skeleton's|skelton)\b/g, 'skeleton'],
  [/\b(?:full screen|fullscreen|full-screen)\b/g, 'full screen'],
  [/\bsent\b(?= (?:report|it|the report))/g, 'send'],
]

/** Words that carry no name: articles, politeness, role words (used as a hint), Turkish role words. */
const STOP = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'on', 'in', 'at', 'and', 'with', 'my', 'your', 'this', 'that', 'it', 'please', 'one', 'so',
  'button', 'buttons', 'link', 'links', 'tab', 'tabs', 'menu', 'checkbox', 'check box', 'switch', 'toggle', 'field', 'box', 'option', 'item', 'icon', 'page', 'section', 'card', 'chip', 'control',
  'butonu', 'butonuna', 'butonunu', 'dugmesi', 'dugmesine', 'dugmesini', 'tusu', 'tusuna', 'sekmesi', 'sekmesine', 'sekmesini', 'linki', 'linkine', 'sayfasi', 'sayfasina', 'sayfasini', 'menusu', 'menusunu', 'menuyu', 'kutusu', 'kutusuna', 'bolumu', 'bolumunu', 've', 'bir',
])

/** Canonical spellings of units and number-like words. */
const CANON: Record<string, string> = {
  hours: 'h', hour: 'h', hrs: 'h', hr: 'h', saat: 'h', minutes: 'min', minute: 'min', mins: 'min', dakika: 'min', seconds: 's', second: 's', sec: 's',
  percent: '%', per: '', cent: '', ok: 'ok', okay: 'ok', xray: 'x ray', remeasure: 're measure', fullscreen: 'full screen', signout: 'sign out', logout: 'log out', spo2: 'oxygen',
  behaviour: 'behavior', colour: 'color', centre: 'center',
}

/** English stem: plural and common verb endings (both sides get the same treatment). */
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y'
  if (/(?:ss|us|is|ous)$/.test(w)) return w
  if (/(?:ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2)
  if (/s$/.test(w)) return w.slice(0, -1)
  if (/ing$/.test(w) && w.length > 5) return w.slice(0, -3)
  if (/ed$/.test(w) && w.length > 4) return w.slice(0, -2)
  return w
}

/** Turkish case/possessive endings a recogniser glues onto an English label ("detailse", "saveye"). Longest first. */
const SUF = 'sine|sina|suna|sini|sunu|ine|ina|une|una|ini|inu|unu|nin|nun|den|dan|yi|yu|ye|ya|ne|na|ni|nu|de|da|te|ta|e|a|i|u'
const TR_SUFFIX = new RegExp(`'?(?:${SUF})$`)

/** Spoken numbers to digits ("twenty four hours" -> "24 hours"); labels never spell numbers out. */
function digits(s: string): string {
  return /[a-z]/.test(s) ? normalizeNumbers(s, false) : s
}

type Prepared = { str: string; toks: string[]; compact: string }

function prepare(s: string, spoken: boolean): Prepared {
  let t = normName(s)
  if (spoken) {
    for (const [re, to] of HEARD_AS) t = t.replace(re, to)
  }
  t = digits(t)
  t = t
    .replace(/\b(\d+(?:\.\d+)?)(h|min|s|l|ml|kg|mmhg|bpm)\b/g, '$1 $2')
    .split(' ')
    .map((w) => CANON[w] ?? w)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const toks = t
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map(stem)
  // joined-up spelling ("xray" = "x ray"), keeping every word so "your training profile" is not "training profile"
  // joined-up spelling ("xray" = "x ray"), keeping every word so "your training profile" is not "training profile"
  return { str: t, toks, compact: t.replace(/\s+/g, '') }
}

/** The ways one spoken target can be read: as said, with Turkish aliases translated, with suffixes stripped. */
export function readings(spoken: string): string[] {
  // several readings of one command, separated by "|" (grammar.ts: "raporu gönder" -> "raporu gonder|send rapor")
  if (spoken.includes('|')) return [...new Set(spoken.split('|').flatMap((p) => readings(p)))]
  const base = normName(spoken)
  const out = new Set<string>([base])
  let alias = ` ${base} `
  for (const [tr, en] of TR_ALIASES) alias = alias.replace(new RegExp(`\\s${tr}(?:${SUF}|lar|ler|lari|leri|larini|lerini|lara|lere)?\\s`, 'g'), ` ${en[0]} `)
  out.add(alias.trim())
  for (const [tr, en] of TR_ALIASES) if (base === tr || base.replace(TR_SUFFIX, '') === tr) for (const e of en) out.add(e)
  for (const r of [...out]) {
    const words = r.split(' ')
    // strip a Turkish ending from any word that is not an English word on its own ("detailse", "historye")
    const cut = words.map((w) => (w.length > 3 ? w.replace(TR_SUFFIX, '') : w))
    if (cut.some((w, i) => w !== words[i] && w.length >= 3)) out.add(cut.map((w, i) => (w.length >= 3 ? w : words[i])).join(' '))
  }
  return [...out].filter(Boolean)
}

/** How alike two words sound, 0..1 (phonetic key + edit distance; short words must be exact). */
function wordSim(a: string, b: string): number {
  if (a === b) return 1
  if (a.length <= 2 || b.length <= 2) return 0
  if (/\d/.test(a) || /\d/.test(b)) return 0
  const ka = phoneticKey(a)
  const kb = phoneticKey(b)
  if (ka === kb) return 0.95
  if (ka[0] !== kb[0]) return 0
  const d = editDistance(ka, kb)
  const sim = 1 - d / Math.max(ka.length, kb.length)
  return sim >= 0.7 ? sim : 0
}

/** Similarity of one prepared spoken reading and one prepared on-screen name, 0..1. */
function score1(s: Prepared, n: Prepared): number {
  if (!s.toks.length || !n.toks.length) return s.str && s.str === n.str ? 1 : 0
  if (s.str === n.str) return 1
  if (s.compact === n.compact) return 0.99
  const st = s.toks
  const nt = n.toks
  const sSet = new Set(st)
  const nSet = new Set(nt)
  const same = st.length === nt.length && st.every((w) => nSet.has(w)) && nt.every((w) => sSet.has(w))
  if (same) return 0.95
  // the name starts with what was said ("details" -> "details for blood pressure", "send report" -> "send report to flight surgeon")
  if (st.length < nt.length && st.every((w, i) => nt[i] === w)) return Math.max(0.84, 0.92 - (nt.length - st.length) * 0.015)
  // every spoken word is in the name, in any order ("blood pressure details", a surname on a crew card)
  if (st.every((w) => nSet.has(w)) && (st.length > 1 || st[0].length >= 4 || st.length / nt.length >= 0.5)) return 0.76 + 0.12 * Math.sqrt(st.length / nt.length)
  // the name's words are all in what was said, plus a little more ("details for sleep" said, "Details" on screen)
  if (nt.every((w) => sSet.has(w)) && st.length - nt.length <= 2) return 0.62 + 0.04 * nt.length
  // sounds alike word by word (mis-hearings: "safe" -> "save", "detales" -> "details"); one extra spoken word is forgiven in long names
  let sum = 0
  let missed = 0
  for (const w of st) {
    let best = 0
    for (const x of nt) best = Math.max(best, wordSim(w, x))
    if (!best) missed++
    sum += best
  }
  if (missed > (st.length >= 3 ? 1 : 0)) return compactSim(s, n)
  const avg = sum / (st.length - missed)
  const coverage = Math.min(1, (st.length - missed) / nt.length)
  return Math.max(compactSim(s, n), avg * (0.7 + 0.2 * coverage) - 0.15 * missed)
}

/** Whole-phrase sound similarity ("talk tora" ~ "talk to aura"). */
function compactSim(s: Prepared, n: Prepared): number {
  if (s.compact.length < 5 || n.compact.length < 5) return 0
  if (s.compact.replace(/\D/g, '') !== n.compact.replace(/\D/g, '')) return 0
  const a = phoneticKey(s.compact)
  const b = phoneticKey(n.compact)
  if (a[0] !== b[0]) return 0
  const sim = 1 - editDistance(a, b) / Math.max(a.length, b.length)
  return sim >= 0.8 ? sim * 0.86 : 0
}

const prepCache = new Map<string, Prepared>()
function prepName(name: string): Prepared {
  let p = prepCache.get(name)
  if (!p) {
    p = prepare(name, false)
    if (prepCache.size > 4000) prepCache.clear()
    prepCache.set(name, p)
  }
  return p
}

/** Best similarity of a spoken target and an on-screen name, over every reading (aliases, suffixes). */
export function nameScore(spoken: string, name: string): number {
  const n = prepName(name)
  let rs = spokenCache.get(spoken)
  if (!rs) {
    rs = readings(spoken).map((r) => prepare(r, true))
    if (spokenCache.size > 2000) spokenCache.clear()
    spokenCache.set(spoken, rs)
  }
  let best = 0
  for (const r of rs) {
    best = Math.max(best, score1(r, n))
    if (best >= 1) break
  }
  return best
}
const spokenCache = new Map<string, Prepared[]>()

/** Best score over a control's names (primary first; alternatives count slightly less). */
export function namesScore(spoken: string, names: readonly string[]): number {
  let best = 0
  names.forEach((name, i) => {
    if (!name) return
    const s = nameScore(spoken, name) * (i === 0 ? 1 : 0.985)
    if (s > best) best = s
  })
  return best
}

/** The role word in a spoken target, used as a hint ("the Sleep tab", "History link", "Details butonu"). */
export function roleHint(spoken: string): 'tab' | 'link' | 'button' | 'checkbox' | 'field' | 'menu' | undefined {
  const f = normName(spoken)
  if (/\b(?:tab|sekme\w*)\b/.test(f)) return 'tab'
  if (/\b(?:link|linki\w*|baglanti\w*)\b/.test(f)) return 'link'
  if (/\b(?:checkbox|check box|kutucu\w*|onay kutu\w*)\b/.test(f)) return 'checkbox'
  if (/\b(?:field|box|input|alan\w*)\b/.test(f)) return 'field'
  if (/\b(?:menu|menus\w*)\b/.test(f)) return 'menu'
  if (/\b(?:button|buton\w*|dugme\w*|tus\w*)\b/.test(f)) return 'button'
  return undefined
}

/** Accept a match at or above this score. */
export const MATCH_MIN = 0.72
