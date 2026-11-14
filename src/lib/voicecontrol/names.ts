// Matching a spoken control name against the names written on screen, without AI. The labels are English; a
// Turkish speaker says them with Turkish grammar ("Details'e bas", "Save'e tıkla") or uses a Turkish word for
// the most common ones (kaydet -> Save). Everything works on fold()-ed text (ASCII, lower case).
import { fold } from '../doctor/parse'
import { editDistance, phoneticKey } from '../voice/fuzzy'

/** A control or heading name, normalised for matching: no keyboard hints, punctuation or extra spaces. */
export function normName(s: string): string {
  return fold(s)
    .replace(/\((?:alt|ctrl|shift|cmd)[^)]*\)/g, ' ')
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'\w*/g, '') // a Turkish case suffix after an apostrophe: details'e -> details
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
  ['olcum ekle', ['add reading', 'log a reading', 'add measurement']],
  ['sesli oku', ['read aloud']],
  ['yeniden baslat', ['restart', 'start again', 'start over']],
  ['bastan basla', ['start again', 'start over']],
  ['ana sayfa', ['overview', 'home']],
  ['genel bakis', ['overview']],
  ['geri don', ['back']],
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
  ['raporlar', ['reports']],
  ['rapor', ['report']],
  ['ekip', ['crew', 'roster']],
  ['tani', ['diagnostics']],
  ['teshis', ['diagnostics']],
  ['koc', ['coach']],
  ['dinle', ['listen']],
  ['baslat', ['start']],
  ['basla', ['start']],
  ['durdur', ['stop']],
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
  ['tansiyon', ['blood pressure']],
  ['nabiz', ['heart rate', 'pulse']],
  ['oksijen', ['oxygen']],
  ['uyku', ['sleep']],
  ['su', ['water']],
]

/** Turkish case/possessive endings a recogniser glues onto an English label ("detailse", "saveye"). Longest first. */
const SUF = 'sine|sina|suna|sini|sunu|ine|ina|une|una|ini|inu|unu|nin|nun|den|dan|yi|yu|ye|ya|ne|na|ni|nu|de|da|te|ta|e|a|i|u'
const TR_SUFFIX = new RegExp(`'?(?:${SUF})$`)

/** The ways one spoken target can be read: as said, with Turkish aliases translated, with suffixes stripped. */
export function readings(spoken: string): string[] {
  const base = normName(spoken)
  const out = new Set<string>([base])
  let alias = ` ${base} `
  for (const [tr, en] of TR_ALIASES) alias = alias.replace(new RegExp(`\\s${tr}(?:${SUF})?\\s`, 'g'), ` ${en[0]} `)
  out.add(alias.trim())
  for (const [tr, en] of TR_ALIASES) if (base === tr) for (const e of en) out.add(e)
  for (const r of [...out]) {
    const words = r.split(' ')
    const last = words[words.length - 1]
    if (last && last.length > 3) {
      const cut = last.replace(TR_SUFFIX, '')
      if (cut !== last && cut.length >= 3) out.add([...words.slice(0, -1), cut].join(' '))
    }
  }
  return [...out].filter(Boolean)
}

/** How alike two words sound, 0..1 (phonetic key + edit distance; short words must be exact). */
function wordSim(a: string, b: string): number {
  if (a === b) return 1
  if (a.length <= 2 || b.length <= 2) return 0
  const ka = phoneticKey(a)
  const kb = phoneticKey(b)
  if (ka === kb) return 0.95
  if (ka[0] !== kb[0]) return 0
  const d = editDistance(ka, kb)
  const sim = 1 - d / Math.max(ka.length, kb.length)
  return sim >= 0.7 ? sim : 0
}

const FILLER = new Set(['the', 'a', 'an', 'button', 'link', 'tab', 'option', 'item', 'checkbox', 'switch', 'field', 'box', 'on', 'butonu', 'butonuna', 'dugmesi', 'dugmesine', 'sekmesi', 'sekmesine', 'linki', 'linkine'])

/** Similarity of one spoken reading and one on-screen name, 0..1. */
function score1(said: string, name: string): number {
  if (!said || !name) return 0
  if (said === name) return 1
  const s = said.split(' ').filter((w) => !FILLER.has(w))
  const n = name.split(' ')
  if (!s.length) return 0
  const joined = s.join(' ')
  if (joined === name) return 0.99
  // the name starts with what was said ("details" -> "details for blood pressure")
  if (name.startsWith(joined + ' ')) return 0.9 - Math.min(0.08, (n.length - s.length) * 0.01)
  // every spoken word is in the name, in any order
  // (a surname in a crew card, "Reyes" in "PLT Daniel Reyes Pilot 69"; short words must not match by accident)
  if (s.every((w) => n.includes(w)) && (s.length > 1 || s[0].length >= 4)) return 0.74 + 0.12 * Math.sqrt(s.length / n.length)
  // sounds alike word by word (mis-hearings: "safe" -> "save", "detales" -> "details")
  let sum = 0
  for (const w of s) {
    let best = 0
    for (const x of n) best = Math.max(best, wordSim(w, x))
    if (!best) return 0
    sum += best
  }
  const avg = sum / s.length
  const coverage = Math.min(1, s.length / n.length)
  return avg * (0.66 + 0.2 * coverage)
}

/** Best similarity of a spoken target and an on-screen name, over every reading (aliases, suffixes). */
export function nameScore(spoken: string, name: string): number {
  const n = normName(name)
  let best = 0
  for (const r of readings(spoken)) best = Math.max(best, score1(r, n))
  return best
}

/** Accept a match at or above this score. */
export const MATCH_MIN = 0.72
