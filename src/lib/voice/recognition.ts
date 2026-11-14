// Speech recognition over the browser's SpeechRecognition. In Chrome and Edge the audio is sent to the browser
// vendor's service while listening, so it needs internet; Firefox has no recognition at all.
//
// createListener() is the robust path used by AURA: continuous recognition with interim results and up to five
// alternatives, our own end-of-utterance timing (endpoint.ts), transparent restarts with transcript stitching
// when the browser ends a session early, push-to-talk, and vocabulary biasing where the browser supports it.
import { HOLD_MAX_MS, silenceFor, STOP_GRACE_MS, TIMING, Transcript, type Alt, type ListenMode, type Timing } from './endpoint'
import { loadSettings, type VoiceLang } from './settings'

export type RecError = 'unsupported' | 'denied' | 'no-speech' | 'network' | 'no-mic' | 'other'

type RecAlt = { transcript: string; confidence?: number }
type RecResult = ArrayLike<RecAlt> & { isFinal: boolean }
type RecEvent = { resultIndex: number; results: ArrayLike<RecResult> }
export type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  grammars?: unknown
  phrases?: unknown
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  onresult: ((e: RecEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecCtor = new () => Rec

let forcedOff = false
/** Dev/testing hook: pretend the browser has no speech recognition. */
export function forceRecognitionUnsupported(off: boolean) {
  forcedOff = off
}

function ctor(): RecCtor | null {
  if (forcedOff || typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function recognitionSupported(): boolean {
  return ctor() !== null
}

export const ERROR_TEXT: Record<RecError, string> = {
  unsupported: 'This browser has no speech recognition. You can still type to AURA.',
  denied: 'Microphone access is blocked. Allow it in the browser’s site settings, or type instead.',
  'no-speech': 'I did not hear anything. Try again.',
  network: 'Speech recognition needs an internet connection in this browser. You can still type.',
  'no-mic': 'No microphone was found.',
  other: 'Speech recognition stopped unexpectedly. Try again.',
}

export function mapError(code: string): RecError {
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'denied'
  if (code === 'no-speech') return 'no-speech'
  if (code === 'network') return 'network'
  if (code === 'audio-capture') return 'no-mic'
  return 'other'
}

/* ---------- vocabulary biasing (feature-detected; silently skipped where unsupported) ---------- */

let phrasesBroken = false

/** Hint our domain words to the recogniser: the newer phrase list API if present, else a JSGF grammar list. */
export function applyBias(r: Rec, phrases: string[]) {
  if (!phrases.length || typeof window === 'undefined') return
  const w = window as unknown as {
    SpeechRecognitionPhrase?: new (phrase: string, boost?: number) => unknown
    SpeechGrammarList?: new () => { addFromString(s: string, weight?: number): void }
    webkitSpeechGrammarList?: new () => { addFromString(s: string, weight?: number): void }
  }
  if (!phrasesBroken && w.SpeechRecognitionPhrase && 'phrases' in r) {
    try {
      r.phrases = phrases.map((p) => new w.SpeechRecognitionPhrase!(p, 3))
      return
    } catch {
      phrasesBroken = true
    }
  }
  const GL = w.SpeechGrammarList ?? w.webkitSpeechGrammarList
  if (!GL) return
  try {
    const g = new GL()
    const words = phrases.map((p) => p.toLowerCase().replace(/[^a-z0-9çğıöşü ]/gi, '')).filter(Boolean)
    g.addFromString(`#JSGF V1.0; grammar aura; public <term> = ${words.join(' | ')} ;`, 1)
    r.grammars = g
  } catch {
    /* grammar lists are ignored by most engines anyway */
  }
}

/* ---------- the listener ---------- */

export type ListenWindow = { deadline: number | null; total: number; heard: boolean; mode: ListenMode }

export type ListenerOptions = {
  lang: VoiceLang
  mode: ListenMode
  timing?: Timing
  maxAlternatives?: number
  /** Domain phrases for recognition biasing. */
  phrases?: string[]
  /** Wake mode: an utterance only counts once this returns true for the transcript. */
  wakeTest?: (text: string) => boolean
  onStart?: () => void
  onInterim?: (text: string) => void
  /** The silence countdown was (re)started or cleared; drives the ring in the HUD. */
  onWindow?: (w: ListenWindow) => void
  /** One finished utterance with its alternatives (best first). */
  onFinal: (alts: Alt[], reason: 'silence' | 'release' | 'cap' | 'tap') => void
  onError?: (e: RecError) => void
  /** Listening is over (not called in wake mode until stopped, nor after abort()). */
  onEnd?: () => void
}

export type Listener = {
  start(): void
  /** Finish now and use what was heard ("tap to finish", key or button released). */
  finish(reason?: 'release' | 'tap'): void
  abort(): void
  setMode(m: ListenMode): void
  readonly mode: ListenMode
}

export type ListenerDeps = { Ctor?: RecCtor | null }

export function createListener(o: ListenerOptions, deps: ListenerDeps = {}): Listener | null {
  const C = deps.Ctor !== undefined ? deps.Ctor : ctor()
  if (!C) return null
  const timing = o.timing ?? TIMING.normal
  const tr = new Transcript()
  let mode: ListenMode = o.mode
  let rec: Rec | null = null
  let want = false
  let finishing = false
  let delivered = false
  let failed = false
  let awake = false
  let startedAt = 0
  let emptyRestarts = 0
  let silenceT: ReturnType<typeof setTimeout> | undefined
  let capT: ReturnType<typeof setTimeout> | undefined
  let graceT: ReturnType<typeof setTimeout> | undefined
  let restartT: ReturnType<typeof setTimeout> | undefined
  let finishReason: 'silence' | 'release' | 'cap' | 'tap' = 'silence'

  const clearTimers = () => {
    clearTimeout(silenceT)
    clearTimeout(capT)
    clearTimeout(graceT)
    clearTimeout(restartT)
  }
  const counting = () => mode === 'auto' || (mode === 'wake' && awake)
  const windowOff = () => o.onWindow?.({ deadline: null, total: 0, heard: tr.heard(), mode })

  const armSilence = () => {
    clearTimeout(silenceT)
    if (!counting() || finishing) return windowOff()
    const ms = silenceFor(timing, tr.heard())
    silenceT = setTimeout(() => finish('silence'), ms)
    o.onWindow?.({ deadline: Date.now() + ms, total: ms, heard: tr.heard(), mode })
  }
  const armCap = () => {
    clearTimeout(capT)
    if (mode === 'wake' && !awake) return
    const left = (mode === 'hold' ? HOLD_MAX_MS : timing.maxMs) - (Date.now() - startedAt)
    capT = setTimeout(() => finish('cap'), Math.max(0, left))
  }

  const make = () => {
    const r = new C()
    r.lang = o.lang
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = o.maxAlternatives ?? 5
    applyBias(r, o.phrases ?? [])
    r.onstart = () => {
      if (rec === r) o.onStart?.()
    }
    r.onresult = (e) => {
      if (rec !== r || delivered) return
      tr.update(e.results)
      const text = tr.text()
      if (!text) return
      emptyRestarts = 0
      if (mode === 'wake' && !awake) {
        if (!o.wakeTest?.(text)) {
          o.onInterim?.(text)
          // keep memory bounded while waiting for the wake word
          if (Array.from(e.results).every((x) => x.isFinal) && e.results.length > 6) restartFresh()
          return
        }
        awake = true
        startedAt = Date.now()
        armCap()
      }
      o.onInterim?.(text)
      if (!finishing) armSilence()
    }
    r.onerror = (e) => {
      if (rec !== r) return
      if (e.error === 'aborted' || e.error === 'no-speech') return // our own timers decide; onend restarts
      if (e.error === 'phrases-not-supported' || e.error === 'language-not-supported') {
        phrasesBroken = true
        return
      }
      const code = mapError(e.error)
      if (code === 'denied' || code === 'no-mic' || code === 'network') {
        failed = true
        want = false
        clearTimers()
        windowOff()
        o.onError?.(code)
      }
    }
    r.onend = () => {
      if (rec !== r) return
      if (finishing) return deliver()
      if (failed || !want) {
        rec = null
        return o.onEnd?.()
      }
      // The browser stopped on its own (a pause, "no-speech", the ~60 s limit): keep what we heard and go on.
      tr.seal()
      emptyRestarts++
      if (emptyRestarts > 12 && mode !== 'wake') {
        want = false
        rec = null
        if (tr.heard()) {
          finishing = true
          return deliver()
        }
        o.onError?.('no-speech')
        return o.onEnd?.()
      }
      restartT = setTimeout(() => want && !finishing && begin(), mode === 'wake' ? 250 : 80)
    }
    return r
  }

  const begin = () => {
    rec = make()
    try {
      rec.start()
    } catch {
      /* already started */
    }
  }

  const restartFresh = () => {
    tr.reset()
    const old = rec
    rec = null
    try {
      old?.abort()
    } catch {
      /* not running */
    }
    if (want) restartT = setTimeout(() => want && begin(), 120)
  }

  function deliver() {
    if (delivered) return
    clearTimers()
    const alts = tr.alternatives()
    const old = rec
    rec = null
    try {
      old?.abort()
    } catch {
      /* finished */
    }
    windowOff()
    if (mode === 'wake') {
      // hand the utterance over and keep listening for the next wake word
      const woke = awake
      awake = false
      finishing = false
      tr.reset()
      if (woke && alts.length) o.onFinal(alts, finishReason)
      if (want) restartT = setTimeout(() => want && begin(), 150)
      return
    }
    delivered = true
    want = false
    if (alts.length) o.onFinal(alts, finishReason)
    else o.onError?.('no-speech')
    o.onEnd?.()
  }

  function finish(reason: 'silence' | 'release' | 'cap' | 'tap' = 'tap') {
    if (finishing || delivered || !rec) return
    if (mode === 'wake' && !awake) return
    finishing = true
    finishReason = reason
    clearTimeout(silenceT)
    clearTimeout(capT)
    windowOff()
    const r = rec
    try {
      r.stop() // lets the engine turn its last interim words into a final result
    } catch {
      /* not running */
    }
    graceT = setTimeout(deliver, STOP_GRACE_MS)
  }

  return {
    get mode() {
      return mode
    },
    start() {
      if (want) return
      want = true
      failed = false
      finishing = false
      delivered = false
      awake = false
      emptyRestarts = 0
      tr.reset()
      startedAt = Date.now()
      begin()
      armCap()
      armSilence()
    },
    finish,
    abort() {
      want = false
      clearTimers()
      const r = rec
      rec = null
      try {
        r?.abort()
      } catch {
        /* not running */
      }
    },
    setMode(m: ListenMode) {
      if (m === mode) return
      mode = m
      armCap()
      armSilence()
    },
  }
}

/* ---------- simple recogniser (kept for the consultation dictation and older callers) ---------- */

export type RecognizerOptions = {
  lang: VoiceLang
  /** Keep listening after each phrase (wake-word mode). */
  continuous?: boolean
  onStart?: () => void
  onInterim?: (text: string) => void
  onFinal: (text: string) => void
  onError?: (e: RecError) => void
  onEnd?: () => void
}

export type Recognizer = { start: () => void; stop: () => void; abort: () => void }

export function createRecognizer(o: RecognizerOptions): Recognizer | null {
  // One-shot dictation now uses the same robust end-pointing as AURA voice (listening time from the voice settings).
  if (!o.continuous) {
    let s: ReturnType<typeof loadSettings> | null = null
    try {
      s = loadSettings()
    } catch {
      s = null
    }
    const l = createListener({
      lang: o.lang,
      mode: 'auto',
      timing: TIMING[s?.listen ?? 'normal'],
      onStart: o.onStart,
      onInterim: o.onInterim,
      onFinal: (alts) => alts[0] && o.onFinal(alts[0].transcript),
      onError: o.onError,
      onEnd: o.onEnd,
    })
    if (!l) return null
    return { start: () => l.start(), stop: () => l.finish('release'), abort: () => l.abort() }
  }
  const C = ctor()
  if (!C) return null
  let rec: Rec | null = null
  let running = false
  let wantRunning = false
  let failed = false

  const make = () => {
    const r = new C()
    r.lang = o.lang
    r.continuous = true
    r.interimResults = true
    r.maxAlternatives = 1
    r.onstart = () => {
      running = true
      o.onStart?.()
    }
    r.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        const t = res[0]?.transcript ?? ''
        if (res.isFinal) {
          if (t.trim()) o.onFinal(t.trim())
        } else interim += t
      }
      if (interim) o.onInterim?.(interim.trim())
    }
    r.onerror = (e) => {
      if (e.error === 'aborted' || e.error === 'no-speech') return
      const code = mapError(e.error)
      if (code === 'denied' || code === 'no-mic' || code === 'network') failed = true
      o.onError?.(code)
    }
    r.onend = () => {
      running = false
      if (wantRunning && !failed) {
        setTimeout(() => {
          if (wantRunning && !running) {
            try {
              r.start()
            } catch {
              /* already started */
            }
          }
        }, 250)
        return
      }
      wantRunning = false
      o.onEnd?.()
    }
    return r
  }

  return {
    start() {
      if (running) return
      failed = false
      wantRunning = true
      rec = make()
      try {
        rec.start()
      } catch {
        o.onError?.('other')
      }
    },
    stop() {
      wantRunning = false
      try {
        rec?.stop()
      } catch {
        /* not running */
      }
    },
    abort() {
      wantRunning = false
      try {
        rec?.abort()
      } catch {
        /* not running */
      }
      running = false
    },
  }
}
