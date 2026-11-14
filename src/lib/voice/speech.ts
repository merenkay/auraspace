// Text-to-speech over the browser's speechSynthesis. Speech is generated on the device (the voices are the
// operating system's or the browser's own); this module only chooses a voice, queues sentences and handles
// interruption. Nothing here is medical: it just says what it is given.
import { decimalWords, numberWords } from './numbers'

export type Priority = 'normal' | 'urgent'

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
}

/** Prefer a calm, local, English voice. Pure so it can be tested. */
export function pickVoice(voices: { name: string; lang: string; localService?: boolean; default?: boolean }[], lang = 'en'): number {
  if (!voices.length) return -1
  const want = lang.toLowerCase()
  const score = (v: { name: string; lang: string; localService?: boolean; default?: boolean }) => {
    const l = v.lang.toLowerCase().replace('_', '-')
    let s = 0
    if (l.startsWith(want)) s += 40
    if (l === 'en-gb') s += 6 // measured, slightly formal
    else if (l === 'en-us') s += 4
    if (/natural|neural|online/i.test(v.name)) s += 8
    if (/google uk english male|daniel|oliver|arthur|ryan|guy|aria|jenny|samantha|karen|serena|moira|libby|sonia/i.test(v.name)) s += 10
    if (/espeak|compact|novelty|bad news|bahh|bells|boing|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph/i.test(v.name)) s -= 40
    if (v.localService) s += 3
    if (v.default) s += 1
    return s
  }
  let best = 0
  let bestScore = -Infinity
  voices.forEach((v, i) => {
    const sc = score(v)
    if (sc > bestScore) {
      bestScore = sc
      best = i
    }
  })
  return best
}

/** Split into sentence-sized chunks: Chrome silently stops utterances longer than ~15 s. */
export function chunkText(text: string, max = 220): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?;:])\s+/)
    .filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    if (p.length <= max) {
      out.push(p)
      continue
    }
    let rest = p
    while (rest.length > max) {
      const cut = rest.lastIndexOf(',', max - 1) > 60 ? rest.lastIndexOf(',', max - 1) + 1 : rest.lastIndexOf(' ', max)
      out.push(rest.slice(0, cut > 0 ? cut : max).trim())
      rest = rest.slice(cut > 0 ? cut : max).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}

type Job = { text: string; priority: Priority; onEnd?: () => void }

let voiceCache: SpeechSynthesisVoice[] = []
let queue: Job[] = []
let current: Job | null = null
let rate = 1
let onActivity: ((speaking: boolean) => void) | null = null
let epoch = 0

function loadVoices() {
  if (!ttsSupported()) return
  voiceCache = window.speechSynthesis.getVoices()
}

if (ttsSupported()) {
  loadVoices()
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices)
}

export function setRate(r: number) {
  rate = Math.min(1.3, Math.max(0.7, r))
}

/** Called with true when speech starts and false when everything queued has been said. */
export function onSpeaking(fn: ((speaking: boolean) => void) | null) {
  onActivity = fn
}

export function isSpeaking(): boolean {
  return current !== null || queue.length > 0
}

function pump() {
  if (current || !queue.length) {
    if (!current && !queue.length) onActivity?.(false)
    return
  }
  const job = queue.shift()!
  current = job
  onActivity?.(true)
  const my = epoch
  let guard: ReturnType<typeof setTimeout> | undefined
  const done = () => {
    clearTimeout(guard)
    if (my !== epoch || current !== job) return
    current = null
    job.onEnd?.()
    pump()
  }
  try {
    const u = new SpeechSynthesisUtterance(job.text)
    if (!voiceCache.length) loadVoices()
    const idx = pickVoice(voiceCache, 'en')
    if (idx >= 0) {
      u.voice = voiceCache[idx]
      u.lang = voiceCache[idx].lang
    } else u.lang = 'en-GB'
    u.rate = job.priority === 'urgent' ? Math.min(1.05, rate) : rate
    u.pitch = 0.95
    u.volume = 1
    u.onend = done
    u.onerror = done
    // some engines never fire "end" (no voices installed, tab in background): do not stall the queue
    guard = setTimeout(done, 2500 + (job.text.length * 90) / rate)
    window.speechSynthesis.speak(u)
  } catch {
    done()
  }
}

/** Stop everything now (barge-in: the person started talking, or asked AURA to be quiet). */
export function cancelSpeech() {
  epoch++
  queue = []
  const had = current !== null
  current = null
  if (ttsSupported()) {
    try {
      window.speechSynthesis.cancel()
    } catch {
      /* nothing to cancel */
    }
  }
  if (had) onActivity?.(false)
}

/**
 * Say `text`. `urgent` interrupts whatever is being said and jumps the queue; `normal` waits its turn.
 * Returns false when speech is unavailable (the caller still shows the text as a caption).
 */
export function speak(text: string, opts: { priority?: Priority; onEnd?: () => void } = {}): boolean {
  if (!ttsSupported() || !text.trim()) {
    opts.onEnd?.()
    return false
  }
  const priority = opts.priority ?? 'normal'
  if (priority === 'urgent') cancelSpeech()
  const chunks = chunkText(text)
  chunks.forEach((c, i) => queue.push({ text: c, priority, onEnd: i === chunks.length - 1 ? opts.onEnd : undefined }))
  pump()
  return true
}

/* ---------- pronunciation helpers (pure) ---------- */

export const sayBloodPressure = (sys: number, dia: number) => `${Math.round(sys)} over ${Math.round(dia)}`
export const sayPercent = (n: number) => `${numberWords(Math.round(n))} percent`
export const sayTemperature = (c: number) => `${decimalWords(c, 1)} degrees Celsius`
export const sayHours = (h: number) => {
  const r = Math.round(h * 10) / 10
  return `${Number.isInteger(r) ? numberWords(r) : decimalWords(r, 1)} ${r === 1 ? 'hour' : 'hours'}`
}
export const sayLitres = (l: number) => {
  const r = Math.round(l * 100) / 100
  return `${decimalWords(r, r * 10 === Math.round(r * 10) ? 1 : 2)} ${r === 1 ? 'litre' : 'litres'}`
}
export const sayCount = (n: number, unit: string) => `${numberWords(Math.round(n))} ${unit}`
