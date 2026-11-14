// Thin wrapper over the browser's SpeechRecognition. In Chrome and Edge the audio is sent to the browser
// vendor's service while listening, so it needs internet; Firefox has no recognition at all.
import type { VoiceLang } from './settings'

export type RecError = 'unsupported' | 'denied' | 'no-speech' | 'network' | 'no-mic' | 'other'

type RecEvent = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }
type Rec = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  onresult: ((e: RecEvent) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecCtor = new () => Rec

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
  const C = ctor()
  if (!C) return null
  let rec: Rec | null = null
  let running = false
  let wantRunning = false
  let failed = false

  const make = () => {
    const r = new C()
    r.lang = o.lang
    r.continuous = !!o.continuous
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
      // "no-speech" and "aborted" are normal in continuous mode; only report real problems.
      if (e.error === 'aborted') return
      const code = mapError(e.error)
      if (code === 'denied' || code === 'no-mic' || code === 'network') failed = true
      if (code !== 'no-speech' || !o.continuous) o.onError?.(code)
    }
    r.onend = () => {
      running = false
      // Chrome ends continuous sessions after a pause; restart while the caller still wants to listen.
      if (o.continuous && wantRunning && !failed) {
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
