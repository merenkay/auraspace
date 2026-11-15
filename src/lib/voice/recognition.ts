// Speech recognition over the browser's SpeechRecognition. In Chrome and Edge the audio is sent to the browser
// vendor's service while listening, so it needs internet; Firefox has no recognition at all.
//
// createListener() is the robust path used by AURA: continuous recognition with interim results and up to five
// alternatives, our own end-of-utterance timing (endpoint.ts), transparent restarts with transcript stitching
// when the browser ends a session early, push-to-talk, and vocabulary biasing where the browser supports it.
//
// Hearing: what the recogniser recognises is the browser's business (a page cannot touch its acoustic model or its
// capture). What AURA adds around it: the measured microphone level (level.ts + vad.ts) keeps a listen open while
// someone is still audibly speaking and explains a listen that gave no words ("sound but no words" v. "no signal");
// an always-on wake-word session restarts with back-off and steps aside while AURA itself is speaking.
import { HOLD_MAX_MS, holdForVoice, retryDelay, silenceWindow, STOP_GRACE_MS, TIMING, Transcript, WAKE_RETRY, type Alt, type ListenMode, type Timing, type VoiceNow } from './endpoint'
import { startMicLevel, startMicMonitor, type MicMonitor } from './level'
import { setDictationActive, setVoicePresence } from './presence'
import { loadSettings, type VoiceLang } from './settings'
import { selfVoice, subscribeSpeech } from './speech'
import { explainSilence, type Sensitivity } from './vad'

/**
 * `no-speech`: nothing recognised and nothing could be measured · `no-words`: sound that looked like speech was
 * measured but the recogniser returned no words · `mic-silent`: the level never rose above the room's noise floor.
 */
export type RecError = 'unsupported' | 'denied' | 'no-speech' | 'no-words' | 'mic-silent' | 'network' | 'no-mic' | 'other'

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

// the 3D core and other visuals know at start-up whether voice exists at all (speech.ts sets it for speech output)
if (recognitionSupported()) setVoicePresence({ available: true })

export const ERROR_TEXT: Record<RecError, string> = {
  unsupported: 'This browser has no speech recognition. You can still type to AURA.',
  denied: 'Microphone access is blocked. Allow it in the browser’s site settings, or type instead.',
  'no-speech': 'I did not hear anything. Try again.',
  'no-words': 'I heard sound but no words. Move closer to the microphone, or raise the microphone sensitivity in the voice settings.',
  'mic-silent': 'I did not pick up a voice. If you were speaking, the microphone seems muted or too far away: try the microphone check in the voice settings.',
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

/* ---------- stepping aside: AURA's own voice, and the microphone check ---------- */

let holds = 0
const holdListeners = new Set<() => void>()

/**
 * Pause all speech recognition until the returned function is called (the microphone check uses it: on phones a
 * second capture next to recognition is not possible). A wake-word listener stops and comes back afterwards; a
 * command that is being heard is finished with what it has.
 */
export function holdRecognition(): () => void {
  holds++
  for (const fn of [...holdListeners]) fn()
  let done = false
  return () => {
    if (done) return
    done = true
    holds = Math.max(0, holds - 1)
    for (const fn of [...holdListeners]) fn()
  }
}

/** AURA's own speech as the listener sees it: `active` = speaking now or within the tail after (SELF_VOICE_TAIL_MS). */
export type SpeechGate = { active: () => boolean; subscribe: (fn: (speaking: boolean) => void) => () => void }
const SPEECH_GATE: SpeechGate = { active: () => selfVoice(), subscribe: subscribeSpeech }

/* ---------- the listener ---------- */

export type ListenWindow = {
  deadline: number | null
  total: number
  heard: boolean
  mode: ListenMode
  /** the silence window ran out, but the microphone level says someone is still speaking: AURA keeps listening */
  voice?: boolean
}

export type ListenerOptions = {
  lang: VoiceLang
  mode: ListenMode
  timing?: Timing
  /** Microphone sensitivity; default: the voice setting on this device. */
  sensitivity?: Sensitivity
  maxAlternatives?: number
  /** Domain phrases for recognition biasing. */
  phrases?: string[]
  /** Wake mode: an utterance only counts once this returns true for the transcript. */
  wakeTest?: (text: string) => boolean
  /** Listening began (once per start(), not on the transparent restarts). */
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

export type ListenerDeps = {
  Ctor?: RecCtor | null
  /** the level meter (default: level.ts; null = none) */
  monitor?: (() => MicMonitor | null) | null
  /** the clock the meter stamps its samples with (default performance.now) */
  clock?: () => number
  /** AURA's own speech (default: speech.ts; null = no guard) */
  speech?: SpeechGate | null
}

export function createListener(o: ListenerOptions, deps: ListenerDeps = {}): Listener | null {
  const C = deps.Ctor !== undefined ? deps.Ctor : ctor()
  if (!C) return null
  const timing = o.timing ?? TIMING.normal
  const openMonitor = deps.monitor !== undefined ? deps.monitor : startMicMonitor
  const clock = deps.clock ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()))
  const gate = deps.speech !== undefined ? deps.speech : SPEECH_GATE
  const tr = new Transcript()
  let mode: ListenMode = o.mode
  let sens: Sensitivity = o.sensitivity ?? 'auto'
  let rec: Rec | null = null
  let mon: MicMonitor | null = null
  let want = false
  let finishing = false
  let delivered = false
  let failed = false
  let awake = false
  let announced = false
  let suspended = false
  let startedAt = 0
  let wordsAt = 0
  let windowMs = 0
  let holding = false
  let emptyRestarts = 0
  let startThrows = 0
  // always-on (wake) session health
  let sessionAt = 0
  let fails = 0
  let netFails = 0
  let netDown = false
  let netReported = false
  /** the session that has reported "started" (the watchdog replaces one that never does) */
  let liveRec: Rec | null = null
  let silenceT: ReturnType<typeof setTimeout> | undefined
  let capT: ReturnType<typeof setTimeout> | undefined
  let graceT: ReturnType<typeof setTimeout> | undefined
  let restartT: ReturnType<typeof setTimeout> | undefined
  let resumeT: ReturnType<typeof setTimeout> | undefined
  let watchT: ReturnType<typeof setTimeout> | undefined
  let unsubs: (() => void)[] = []
  let finishReason: 'silence' | 'release' | 'cap' | 'tap' = 'silence'

  const clearTimers = () => {
    clearTimeout(silenceT)
    clearTimeout(capT)
    clearTimeout(graceT)
    clearTimeout(restartT)
    clearTimeout(watchT)
  }
  /** the listen is over for good: give the microphone meter back and stop watching speech / page events */
  const cleanup = () => {
    clearTimeout(resumeT)
    clearTimeout(watchT)
    mon?.stop()
    mon = null
    for (const u of unsubs) u()
    unsubs = []
  }
  const blocked = () => holds > 0 || (mode === 'wake' && !!gate?.active())
  const counting = () => mode === 'auto' || (mode === 'wake' && awake)
  const windowOff = () => o.onWindow?.({ deadline: null, total: 0, heard: tr.heard(), mode })
  const voiceNow = (): VoiceNow | null => {
    const a = mon?.activity()
    return a ? { calibrated: a.calibrated, voiced: a.voiced, quietMs: clock() - a.lastVoiceAt } : null
  }

  const armSilence = () => {
    clearTimeout(silenceT)
    holding = false
    if (!counting() || finishing) return windowOff()
    const ms = silenceWindow(timing, tr.heard(), sens)
    windowMs = ms
    silenceT = setTimeout(silenceOut, ms)
    o.onWindow?.({ deadline: Date.now() + ms, total: ms, heard: tr.heard(), mode })
  }
  /** The window ran out. If the level says the person is still speaking (quiet speech gives late words), wait on. */
  const silenceOut = () => {
    const wait = holdForVoice(voiceNow(), Date.now() - wordsAt, windowMs, sens)
    if (wait > 0 && counting() && !finishing) {
      silenceT = setTimeout(silenceOut, wait)
      if (!holding) {
        holding = true
        o.onWindow?.({ deadline: null, total: 0, heard: tr.heard(), mode, voice: true })
      }
      return
    }
    holding = false
    finish('silence')
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
      if (rec !== r) return
      liveRec = r
      clearTimeout(watchT)
      if (!announced) {
        announced = true
        o.onStart?.()
      }
    }
    r.onresult = (e) => {
      if (rec !== r || delivered) return
      tr.update(e.results)
      const text = tr.text()
      if (!text) return
      emptyRestarts = 0
      fails = 0
      netFails = 0
      netReported = false
      wordsAt = Date.now()
      if (mode === 'wake' && !awake) {
        if (!o.wakeTest?.(text)) {
          o.onInterim?.(text)
          // keep memory bounded while waiting for the wake word
          if (Array.from(e.results).every((x) => x.isFinal) && e.results.length > 6) restartFresh()
          return
        }
        awake = true
        startedAt = Date.now()
        readSensitivity()
        mon?.mark()
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
      if (code === 'network' && mode === 'wake') {
        // an always-on listener survives a dropped connection: say so once, then keep trying, ever more slowly
        netDown = true
        netFails++
        if (!netReported) {
          netReported = true
          o.onError?.('network')
        }
        return
      }
      if (code === 'denied' || code === 'no-mic' || code === 'network') {
        failed = true
        want = false
        clearTimers()
        cleanup()
        windowOff()
        o.onError?.(code)
      }
    }
    r.onend = () => {
      if (rec !== r) return
      clearTimeout(watchT)
      if (finishing) return deliver()
      if (failed || !want) {
        rec = null
        cleanup()
        return o.onEnd?.()
      }
      // The browser stopped on its own (a pause, "no-speech", the ~60 s limit): keep what we heard and go on.
      tr.seal()
      rec = null
      if (mode === 'wake') {
        const short = Date.now() - sessionAt < WAKE_RETRY.SHORT_SESSION_MS
        fails = short ? fails + 1 : 0
        const net = netDown
        netDown = false
        if (!net && !short) netFails = 0
        return retry(net)
      }
      emptyRestarts++
      if (emptyRestarts > 12) return giveUp()
      retry(false)
    }
    return r
  }

  /** Nothing usable for too long (command modes): use what there is, or say why there is nothing. */
  const giveUp = () => {
    want = false
    if (tr.heard()) {
      finishing = true
      return deliver()
    }
    const why = explainSilence(mon?.activity()?.stats() ?? null)
    clearTimers()
    cleanup()
    windowOff()
    o.onError?.(why)
    o.onEnd?.()
  }

  const retry = (network: boolean) => {
    clearTimeout(restartT)
    if (!want || finishing) return
    const ms = mode === 'wake' ? retryDelay(network ? netFails : fails, network) : 80
    restartT = setTimeout(() => want && !finishing && begin(), ms)
  }

  const begin = () => {
    if (!want) return
    if (blocked()) {
      if (mode === 'wake') suspend()
      else finish('tap')
      return
    }
    const r = make()
    rec = r
    sessionAt = Date.now()
    try {
      r.start()
    } catch {
      // the engine refused (still shutting the previous session down, or busy): try again, more slowly each time
      rec = null
      startThrows++
      if (mode === 'wake') {
        fails++
        return retry(false)
      }
      if (startThrows > 3) {
        want = false
        clearTimers()
        cleanup()
        windowOff()
        o.onError?.('other')
        return void o.onEnd?.()
      }
      return retry(false)
    }
    if (mode === 'wake') {
      // a session that neither starts nor fails is dropped and replaced
      clearTimeout(watchT)
      watchT = setTimeout(() => {
        if (rec !== r || !want || liveRec === r) return
        rec = null
        try {
          r.abort()
        } catch {
          /* not running */
        }
        fails++
        retry(false)
      }, WAKE_RETRY.START_WATCHDOG_MS)
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

  /** Wake mode: stop hearing while AURA itself speaks (and during the microphone check); nothing heard is kept. */
  const suspend = () => {
    if (!suspended) {
      suspended = true
      clearTimers()
      const old = rec
      rec = null
      try {
        old?.abort()
      } catch {
        /* not running */
      }
      awake = false
      finishing = false
      tr.reset()
      windowOff()
    }
    clearTimeout(resumeT)
    resumeT = setTimeout(resume, 150)
  }
  const resume = () => {
    clearTimeout(resumeT)
    if (!want || !suspended) return
    if (blocked()) {
      resumeT = setTimeout(resume, 150)
      return
    }
    suspended = false
    begin()
  }
  /** AURA started or stopped speaking, or the microphone check took or released the microphone. */
  const onGate = () => {
    if (!want) return
    if (mode === 'wake') {
      if (blocked()) suspend()
    } else if (holds > 0) finish('tap')
  }
  /** Back online, or the tab is visible again: do not wait out a long back-off. */
  const onPageBack = () => {
    if (!want || mode !== 'wake' || rec || suspended) return
    if (typeof document !== 'undefined' && document.hidden) return
    fails = 0
    netFails = 0
    clearTimeout(restartT)
    begin()
  }

  const readSensitivity = () => {
    if (o.sensitivity) return
    try {
      sens = loadSettings().sensitivity
    } catch {
      sens = 'auto'
    }
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
    const act = mon?.activity() ?? null
    if (mode === 'wake') {
      // hand the utterance over and keep listening for the next wake word
      const woke = awake
      awake = false
      finishing = false
      tr.reset()
      if (woke) act?.learn(alts.length > 0)
      if (woke && alts.length) o.onFinal(alts, finishReason)
      if (want) restartT = setTimeout(() => want && begin(), 150)
      return
    }
    delivered = true
    want = false
    // nothing recognised: was there sound without words, no signal at all, or simply nobody speaking?
    const why = alts.length ? null : explainSilence(act?.stats() ?? null)
    act?.learn(alts.length > 0)
    cleanup()
    if (alts.length) o.onFinal(alts, finishReason)
    else o.onError?.(why ?? 'no-speech')
    o.onEnd?.()
  }

  function finish(reason: 'silence' | 'release' | 'cap' | 'tap' = 'tap') {
    if (finishing || delivered || !want) return
    if (mode === 'wake' && !awake) return
    finishing = true
    finishReason = reason
    clearTimeout(silenceT)
    clearTimeout(capT)
    clearTimeout(restartT)
    windowOff()
    const r = rec
    if (!r) return deliver() // between two browser sessions: there is nothing to wait for
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
      announced = false
      suspended = false
      emptyRestarts = 0
      startThrows = 0
      fails = 0
      netFails = 0
      netDown = false
      netReported = false
      tr.reset()
      startedAt = Date.now()
      wordsAt = startedAt
      readSensitivity()
      mon = openMonitor ? openMonitor() : null
      mon?.mark()
      if (gate) unsubs.push(gate.subscribe(onGate))
      holdListeners.add(onGate)
      unsubs.push(() => holdListeners.delete(onGate))
      if (mode === 'wake' && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('online', onPageBack)
        unsubs.push(() => window.removeEventListener('online', onPageBack))
        if (typeof document !== 'undefined') {
          document.addEventListener('visibilitychange', onPageBack)
          unsubs.push(() => document.removeEventListener('visibilitychange', onPageBack))
        }
      }
      begin()
      armCap()
      armSilence()
    },
    finish,
    abort() {
      want = false
      clearTimers()
      cleanup()
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
    // the consultation's dictation is published as 'listening' with the real microphone level (presence.ts)
    let stopLevel: (() => void) | null = null
    const off = () => {
      stopLevel?.()
      stopLevel = null
      setDictationActive(false)
    }
    const l = createListener({
      lang: o.lang,
      mode: 'auto',
      timing: TIMING[s?.listen ?? 'normal'],
      onStart: () => {
        setDictationActive(true)
        stopLevel ??= startMicLevel()
        o.onStart?.()
      },
      onInterim: o.onInterim,
      onFinal: (alts) => {
        off()
        if (alts[0]) o.onFinal(alts[0].transcript)
      },
      onError: (e) => {
        off()
        o.onError?.(e)
      },
      onEnd: () => {
        off()
        o.onEnd?.()
      },
    })
    if (!l) return null
    return {
      start: () => l.start(),
      stop: () => l.finish('release'),
      abort: () => {
        off()
        l.abort()
      },
    }
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
