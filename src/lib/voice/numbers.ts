// Number words <-> digits for English and Turkish. Pure functions.

const EN_UNITS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }
const EN_TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }
const TR_UNITS: Record<string, number> = { sifir: 0, bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9 }
const TR_TENS: Record<string, number> = { yirmi: 20, otuz: 30, kirk: 40, elli: 50, altmis: 60, yetmis: 70, seksen: 80, doksan: 90 }
const POINT = new Set(['point', 'nokta', 'virgul', 'dot'])

type Tok = { v: number; kind: 'unit' | 'tens' | 'hundred' | 'thousand' | 'half' | 'point' | 'and' }

/** `on` (Turkish ten) is only a number next to another number word or when the speaker uses Turkish. */
function classify(w: string, tr: boolean, near: boolean): Tok | null {
  if (w in EN_UNITS) return { v: EN_UNITS[w], kind: 'unit' }
  if (w in EN_TENS) return { v: EN_TENS[w], kind: 'tens' }
  if (w in TR_UNITS) return { v: TR_UNITS[w], kind: 'unit' }
  if (w === 'on') return tr || near ? { v: 10, kind: 'tens' } : null
  if (w in TR_TENS) return { v: TR_TENS[w], kind: 'tens' }
  if (w === 'hundred' || w === 'yuz') return { v: 100, kind: 'hundred' }
  if (w === 'thousand' || w === 'bin') return { v: 1000, kind: 'thousand' }
  if (w === 'bucuk') return { v: 0.5, kind: 'half' }
  if (POINT.has(w)) return { v: 0, kind: 'point' }
  return null
}

/** Convert one run of number tokens to a value; null when it is not a coherent number. */
function runValue(toks: Tok[]): number | null {
  let total = 0
  let cur = 0
  let any = false
  let i = 0
  for (; i < toks.length; i++) {
    const t = toks[i]
    if (t.kind === 'point') break
    if (t.kind === 'and') continue
    any = true
    if (t.kind === 'unit') {
      // "one twenty eight" -> 128 (digits-style speech)
      const next = toks[i + 1]
      if (cur === 0 && total === 0 && t.v >= 1 && t.v <= 9 && next?.kind === 'tens' && next.v >= 20) cur += t.v * 100
      else cur += t.v
    } else if (t.kind === 'tens') cur += t.v
    else if (t.kind === 'hundred') cur = (cur || 1) * 100
    else if (t.kind === 'thousand') {
      total += (cur || 1) * 1000
      cur = 0
    } else if (t.kind === 'half') cur += 0.5
  }
  let value = total + cur
  if (i < toks.length && toks[i].kind === 'point') {
    let frac = ''
    for (let j = i + 1; j < toks.length; j++) {
      const t = toks[j]
      if (t.kind === 'unit' && Number.isInteger(t.v) && t.v <= 9) frac += String(t.v)
      else if (t.kind !== 'and') return null
    }
    if (!frac) return null
    value = Number(`${total + cur}.${frac}`)
    any = true
  }
  return any ? value : null
}

const foldWord = (w: string) =>
  w
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9.,]/g, '')

/** Replace spoken numbers ("one twenty eight", "yüz yirmi sekiz", "two point five") by digits; digits are kept. */
export function normalizeNumbers(text: string, tr = false): string {
  const words = text.split(/\s+/).filter(Boolean)
  const folded = words.map(foldWord)
  const out: string[] = []
  let i = 0
  while (i < words.length) {
    const toks: Tok[] = []
    let j = i
    while (j < words.length) {
      const f = folded[j]
      const prevNum = toks.length > 0
      const nextIsNum = j + 1 < words.length && classify(folded[j + 1], tr, false) !== null
      let t = classify(f, tr, prevNum || nextIsNum)
      if (!t && f === 'and' && prevNum && nextIsNum) t = { v: 0, kind: 'and' }
      if (!t && f === 'a' && !prevNum && j + 1 < words.length && (folded[j + 1] === 'hundred' || folded[j + 1] === 'thousand')) t = { v: 1, kind: 'unit' }
      if (!t) break
      toks.push(t)
      j++
    }
    if (toks.length) {
      const v = toks.every((t) => t.kind === 'point' || t.kind === 'and') ? null : runValue(toks)
      if (v !== null) {
        out.push(String(v))
        i = j
        continue
      }
    }
    out.push(words[i])
    i++
  }
  return out.join(' ')
}

/** All numbers in an utterance, in order, after number words are converted. "36,8" and "36.8" are one decimal number. */
export function extractNumbers(text: string, tr = false): number[] {
  const t = normalizeNumbers(text, tr).replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
  return (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number)
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

/** 0..9999 as English words: 98 -> "ninety-eight". Other values fall back to digits. */
export function numberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9999) return String(n)
  if (n < 20) return ONES[n]
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '')
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWords(n % 100)}` : ''}`
  return `${numberWords(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberWords(n % 1000)}` : ''}`
}

/** 36.8 -> "thirty-six point eight". */
export function decimalWords(n: number, digits = 1): string {
  const [a, b] = n.toFixed(digits).split('.')
  return b && Number(b) !== 0 ? `${numberWords(Number(a))} point ${[...b].map((d) => ONES[Number(d)]).join(' ')}` : numberWords(Number(a))
}
