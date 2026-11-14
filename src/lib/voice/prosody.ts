// Making browser speech sound like a person: what to say instead of symbols and abbreviations, conversational
// contractions, and sentence/clause chunks with small pauses and slightly varied rate and pitch.
// Pure functions; speech.ts plays the chunks. Captions keep the written form.

/** Abbreviations, units and symbols as a person would say them. Order matters. */
const SAY: [RegExp, string | ((m: string) => string)][] = [
  [/https?:\/\/\S+/g, ''],
  [/\bSp\s?O[2₂](?![a-z0-9])/gi, 'S P O two'],
  [/\bCO[2₂](?![a-z0-9])/g, 'C O two'],
  [/\bO[2₂](?![a-z0-9])/g, 'oxygen'],
  [/\bAURA\b/g, 'Aura'],
  [/(\d)\s?\/\s?(5|10)\b(?!\d)/g, '$1 out of $2'],
  [/\s?≥\s?/g, ' at or above '],
  [/\s?≤\s?/g, ' at or below '],
  [/\s<\s?(?=\d)/g, ' below '],
  [/\s>\s?(?=\d)/g, ' above '],
  [/\b(\d{2,3})\s*\/\s*(\d{2,3})\s*mm\s?Hg\b/gi, '$1 over $2'],
  [/\b(\d{2,3})\s*\/\s*(\d{2,3})\b(?!\s*(?:\d|of))/g, '$1 over $2'],
  [/\bmm\s?Hg\b/gi, 'millimetres of mercury'],
  [/\bmg\s?\/\s?dL\b/gi, 'milligrams per decilitre'],
  [/\bmmol\s?\/\s?L\b/gi, 'millimoles per litre'],
  [/\bbpm\b/gi, 'beats per minute'],
  [/\bµSv\s?\/\s?h\b/g, 'microsieverts an hour'],
  [/\bmSv\s?\/\s?day\b/g, 'millisieverts a day'],
  [/\bmSv\b/g, 'millisieverts'],
  [/\bkPa\b/g, 'kilopascals'],
  [/(\d)\s?°\s?C\b/g, '$1 degrees Celsius'],
  [/(\d)\s?°\s?F\b/g, '$1 degrees Fahrenheit'],
  [/°/g, ' degrees'],
  [/(\d)\s?%/g, '$1 percent'],
  [/(\d)\s?ml\b/gi, '$1 millilitres'],
  [/(\d)\s?L\b/g, '$1 litres'],
  [/(\d)\s?kg\b/gi, '$1 kilograms'],
  [/(\d)\s?lbs?\b/gi, '$1 pounds'],
  [/(\d)\s?km\b/gi, '$1 kilometres'],
  [/(\d)\s?cm\b/gi, '$1 centimetres'],
  [/(\d)\s?min\b/gi, '$1 minutes'],
  [/(\d)\s?h\b/g, '$1 hours'],
  [/(\d)\s?s\b/g, '$1 seconds'],
  [/\b(ISS|OCT|ECG|EKG|CPR|AED|BMI|GP|UV|ESA|CSA|NHS|CDC)\b/g, (m: string) => m.split('').join(' ')],
  [/\be\.g\.\s?/gi, 'for example '],
  [/\bi\.e\.\s?/gi, 'that is '],
  [/\betc\.?/gi, 'and so on'],
  [/\bvs\.?\s/gi, 'versus '],
  [/\bapprox\.?\s/gi, 'about '],
  [/\bDr\.\s/g, 'Doctor '],
  [/[≈~]\s?/g, 'about '],
  [/(\d)\s?[×x]\s?(\d)/g, '$1 times $2'],
  [/×/g, ' times '],
  [/(\d)\s?[–—-]\s?(\d)/g, '$1 to $2'],
  [/\s[–—]\s/g, ', '],
  [/(\d)\s?\+\s?(\d)/g, '$1 plus $2'],
  [/\s=\s/g, ' equals '],
  [/&/g, ' and '],
  [/[·•|]/g, ', '],
  [/\s\/\s/g, ' or '],
  [/[“”"«»*#_`^{}[\]<>]/g, ''],
  [/\s*\(\s*/g, ', '],
  [/\s*\)\s*/g, ', '],
  [/[›‹]/g, ''],
  [/\s+,/g, ','],
  [/,\s*([.!?])/g, '$1'],
  [/,{2,}/g, ','],
  [/\s{2,}/g, ' '],
]

/** Text as it should be spoken: no symbols, units said in words, abbreviations spelled or expanded. */
export function speakable(text: string): string {
  let t = ` ${text} `
  for (const [re, to] of SAY) t = typeof to === 'function' ? t.replace(re, (m) => to(m)) : t.replace(re, to)
  return t.replace(/^[\s,]+/, '').replace(/[\s,]+$/, '').trim()
}

/** Conversational contractions instead of report-speak ("I do not" → "I don't"). Not used for urgent text. */
const CONTRACT: [RegExp, string][] = [
  [/\bwill not\b/g, "won't"],
  [/\bI am\b/g, "I'm"],
  [/\bI have not\b/g, "I haven't"],
  [/\bI have (?=(?:no|got|a|an|the|your|logged|saved|noted)\b)/g, "I've "],
  [/\bI will\b/g, "I'll"],
  [/\bI would\b/g, "I'd"],
  [/\b(I|you|we|they) do not\b/gi, "$1 don't"],
  [/\bdo not\b/g, "don't"],
  [/\bDo not\b/g, "Don't"],
  [/\bdoes not\b/g, "doesn't"],
  [/\bdid not\b/g, "didn't"],
  [/\bcannot\b/g, "can't"],
  [/\bCannot\b/g, "Can't"],
  [/\bcould not\b/g, "couldn't"],
  [/\bis not\b/g, "isn't"],
  [/\bare not\b/g, "aren't"],
  [/\bwas not\b/g, "wasn't"],
  [/\bThat is\b/g, "That's"],
  [/\bthat is\b(?! (?:not|a |an )\b)/g, "that's"],
  [/\bIt is\b/g, "It's"],
  [/\bThere is\b/g, "There's"],
  [/\bthere is\b/g, "there's"],
  [/\bThere are no\b/g, "There aren't any"],
  [/\bYou are\b/g, "You're"],
  [/\byou are\b/g, "you're"],
  [/\bWhat is\b/g, "What's"],
  [/\bLet us\b/g, "Let's"],
]

export function conversational(text: string): string {
  let t = text
  for (const [re, to] of CONTRACT) t = t.replace(re, to)
  return t
}

export type Chunk = { text: string; rate: number; pitch: number; pauseAfter: number }

const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0) / 4294967296
}

/** Split long sentences at clause boundaries so the engine breathes where a person would. */
function clauses(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence]
  const parts = sentence.split(/(?<=[,;:])\s+|\s+(?=(?:and then|but|so|because|which|while)\s)/)
  const out: string[] = []
  let cur = ''
  for (const p of parts) {
    if (cur && (cur + ' ' + p).length > max) {
      out.push(cur)
      cur = p
    } else cur = cur ? `${cur} ${p}` : p
  }
  if (cur) out.push(cur)
  // hard cut anything still too long (Chrome stops utterances after ~15 s)
  return out.flatMap((c) => {
    if (c.length <= 220) return [c]
    const res: string[] = []
    let rest = c
    while (rest.length > 220) {
      const cut = rest.lastIndexOf(' ', 220)
      res.push(rest.slice(0, cut > 0 ? cut : 220).trim())
      rest = rest.slice(cut > 0 ? cut : 220).trim()
    }
    if (rest) res.push(rest)
    return res
  })
}

/**
 * Prosody plan for one reply: sentence and clause chunks, a short pause after each, and a gentle per-sentence
 * variation: questions a touch higher, numbers a little slower, urgent text slower and lower, never theatrical.
 */
export function prosody(text: string, o: { rate?: number; urgent?: boolean } = {}): Chunk[] {
  const base = o.rate ?? 1
  const sentences = speakable(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const out: Chunk[] = []
  sentences.forEach((s, si) => {
    const pieces = clauses(s, o.urgent ? 110 : 150)
    pieces.forEach((p, pi) => {
      const last = pi === pieces.length - 1
      const q = /\?$/.test(p)
      const excl = /!$/.test(p)
      const numeric = (p.match(/\d/g) ?? []).length >= 3
      const jitter = (hash(p) - 0.5) * 0.04
      let rate = base * (1 + jitter)
      let pitch = 1 + jitter / 2
      if (q) pitch += 0.05
      if (excl) rate *= 1.03
      if (numeric) rate *= 0.94
      if (si === 0 && pi === 0 && !o.urgent) pitch += 0.02
      if (o.urgent) {
        rate = Math.min(base, 0.97) * (numeric ? 0.95 : 1)
        pitch = 0.94
      }
      out.push({
        text: p,
        rate: Math.round(Math.min(1.35, Math.max(0.65, rate)) * 100) / 100,
        pitch: Math.round(Math.min(1.15, Math.max(0.85, pitch)) * 100) / 100,
        pauseAfter: !last ? 90 : q ? 260 : o.urgent ? 280 : 200,
      })
    })
  })
  return out
}
