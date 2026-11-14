// Free-text understanding without AI: keyword/synonym matching (English + Turkish) with simple negation.
import { FINDINGS } from './findings'

/** Lower-case, map Turkish letters to ASCII and normalise apostrophes so one pattern covers both spellings. */
export function fold(s: string): string {
  return s
    .replace(/İ/g, 'i')
    .toLowerCase()
    .replace(/̇/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[âà]/g, 'a')
    .replace(/[îì]/g, 'i')
    .replace(/[ûù]/g, 'u')
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const COMPILED = FINDINGS.map((d) => ({ id: d.id, res: d.match.map((m) => new RegExp(m)) }))

// English negation before the phrase; Turkish "yok / değil / olmadı" after it.
const NEG_BEFORE = /\b(?:no|not|without|never|nor|denies|don'?t|doesn'?t|didn'?t|isn'?t|aren'?t|haven'?t|hasn'?t|hic)\b[^.,;]*$/
const NEG_AFTER = /^\S*(?:\s+\S+){0,2}?\s*\b(?:yok|yoktu|degil|olmadi|hayir)\b/

export type ParseResult = { answers: Record<string, 'yes' | 'no'>; hits: { id: string; text: string; negated: boolean }[] }

export function parseFindings(text: string): ParseResult {
  const answers: Record<string, 'yes' | 'no'> = {}
  const hits: ParseResult['hits'] = []
  const clauses = fold(text).split(/[.;!?\n,]|\b(?:but|and|however|ama|fakat|ve|ile)\b/)
  for (const raw of clauses) {
    const clause = raw.trim()
    if (!clause) continue
    for (const { id, res } of COMPILED) {
      for (const re of res) {
        const m = re.exec(clause)
        if (!m) continue
        const before = clause.slice(Math.max(0, m.index - 28), m.index)
        const after = clause.slice(m.index + m[0].length)
        const negated = NEG_BEFORE.test(before) || NEG_AFTER.test(after)
        // a positive mention wins over a negative one elsewhere in the text
        if (!negated || answers[id] !== 'yes') answers[id] = negated ? 'no' : 'yes'
        hits.push({ id, text: m[0], negated })
        break
      }
    }
  }
  return { answers, hits }
}
