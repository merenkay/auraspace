// End-of-utterance support for speech recognition. The browser's own end-pointing stops after a short pause,
// so AURA runs the recogniser continuously and decides itself when the person has finished: after a
// configurable silence since the last (interim or final) result, a longer wait when nothing was said yet,
// and a hard cap. When the browser ends a session early, the transcript heard so far is kept and stitched
// to what follows after a transparent restart. Pure: no browser objects in here.
import type { ListenLength } from './settings'
import type { Sensitivity } from './vad'

export type Alt = { transcript: string; confidence: number }
/** auto = finish after silence; hold = push-to-talk, finish on release; wake = always on, an utterance starts with the wake word. */
export type ListenMode = 'auto' | 'hold' | 'wake'
export type Timing = { silenceMs: number; initialMs: number; maxMs: number }

export const TIMING: Record<ListenLength, Timing> = {
  short: { silenceMs: 1400, initialMs: 2500, maxMs: 15_000 },
  normal: { silenceMs: 2000, initialMs: 3500, maxMs: 30_000 },
  long: { silenceMs: 3200, initialMs: 6000, maxMs: 45_000 },
}
/** Push-to-talk cap (the key or button is held). */
export const HOLD_MAX_MS = 60_000
/** After we ask the browser to stop, wait this long for its last final result before using what we have. */
export const STOP_GRACE_MS = 700
/** A quick press of Space or the mic button is a tap (auto mode); a longer one is push-to-talk. */
export const HOLD_THRESHOLD_MS = 400

type ResultLike = ArrayLike<{ transcript: string; confidence?: number }> & { isFinal: boolean }

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim()
const norm = (a: { transcript: string; confidence?: number }): Alt => ({ transcript: tidy(a.transcript ?? ''), confidence: typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : 0 })

/** Collects recogniser results, across browser restarts, into one utterance with alternatives. */
export class Transcript {
  /** segments kept from earlier browser sessions (each: the alternatives for that stretch of speech) */
  private kept: Alt[][] = []
  /** the current browser session's results */
  private live: { alts: Alt[]; final: boolean; idx: number }[] = []
  /** the current session's results before this index were dropped (trimTo) */
  private skip = 0

  /** Replace the current session's view with the browser's full results list (continuous mode keeps them all). */
  update(results: ArrayLike<ResultLike>) {
    const next: { alts: Alt[]; final: boolean; idx: number }[] = []
    for (let i = this.skip; i < results.length; i++) {
      const r = results[i]
      const alts = Array.from({ length: r.length }, (_, j) => norm(r[j])).filter((a) => a.transcript)
      if (alts.length) next.push({ alts, final: r.isFinal, idx: i })
    }
    this.live = next
  }

  /** The browser ended its session: keep everything heard so far, including words that never became final. */
  seal() {
    for (const s of this.live) this.kept.push(s.alts)
    this.live = []
    this.skip = 0
  }

  reset() {
    this.kept = []
    this.live = []
    this.skip = 0
  }

  /** The best transcript of each heard phrase (segment), oldest first. */
  phrases(): string[] {
    return this.segments().map((s) => s[0]?.transcript ?? '')
  }

  /** The newest phrase is final (the recogniser closed it after a pause). */
  lastFinal(): boolean {
    const l = this.live[this.live.length - 1]
    return l ? l.final : this.kept.length > 0
  }

  /** Forget the phrases before index `i` (chatter before the wake word); later updates of this session skip them. */
  trimTo(i: number) {
    if (i <= 0) return
    const k = this.kept.length
    if (i <= k) {
      this.kept = this.kept.slice(i)
      return
    }
    this.kept = []
    const drop = i - k
    const first = this.live[drop]
    this.skip = first ? first.idx : (this.live[this.live.length - 1]?.idx ?? this.skip - 1) + 1
    this.live = this.live.slice(drop)
  }

  private segments(): Alt[][] {
    return [...this.kept, ...this.live.map((s) => s.alts)]
  }

  text(): string {
    return tidy(
      this.segments()
        .map((s) => s[0]?.transcript ?? '')
        .join(' '),
    )
  }

  heard(): boolean {
    return this.text().length > 0
  }

  /**
   * Whole-utterance alternatives: the best path first, then the best path with one segment swapped for each
   * of that segment's alternatives. Confidence is the mean of the chosen segments (0 = not reported).
   */
  alternatives(max = 6): Alt[] {
    const segs = this.segments()
    if (!segs.length) return []
    const top = segs.map((s) => s[0])
    const mean = (xs: Alt[]) => xs.reduce((a, x) => a + x.confidence, 0) / xs.length
    const out: Alt[] = [{ transcript: tidy(top.map((a) => a.transcript).join(' ')), confidence: mean(top) }]
    const seen = new Set([out[0].transcript.toLowerCase()])
    for (let rank = 1; rank < 6 && out.length < max; rank++) {
      for (let i = segs.length - 1; i >= 0 && out.length < max; i--) {
        const alt = segs[i][rank]
        if (!alt) continue
        const path = top.map((a, k) => (k === i ? alt : a))
        const t = tidy(path.map((a) => a.transcript).join(' '))
        if (!t || seen.has(t.toLowerCase())) continue
        seen.add(t.toLowerCase())
        out.push({ transcript: t, confidence: mean(path) })
      }
    }
    return out
  }
}

/** Silence window to use now: shorter once the person has said something. */
export const silenceFor = (t: Timing, heard: boolean) => (heard ? t.silenceMs : t.initialMs)

/* ---------- the measured level joins in (vad.ts): do not cut off someone who is still audibly speaking ---------- */

/**
 * The recogniser only tells us about words, and it is slow or silent with quiet speech. When the silence window
 * runs out while the microphone level says someone is still speaking, the listener waits on, within limits, so
 * background noise cannot hold the microphone open: the noise floor adapts (a steady sound stops counting as voice
 * after about three seconds) and the wait is capped at MAX_MS without any new recognised word.
 */
export const VOICE_HOLD = {
  /** voice measured within this long counts as "still speaking" (bridges the gaps between words), ms */
  RECENT_MS: 450,
  /** the longest the level alone may keep the microphone open past the silence window, per sensitivity, ms */
  MAX_MS: { low: 2500, normal: 4000, high: 6500, auto: 4000 } as Record<Sensitivity, number>,
  /** how often to look again while waiting, ms */
  CHECK_MS: 200,
  /** the first wait (nothing recognised yet) is multiplied by this: High gives slow or quiet starters more time */
  INITIAL_X: { low: 1, normal: 1, high: 1.5, auto: 1 } as Record<Sensitivity, number>,
} as const

/** What the level meter says right now; null = nothing is being measured (phones, no permission). */
export type VoiceNow = { calibrated: boolean; voiced: boolean; /** ms since voice was last measured */ quietMs: number }

/**
 * The silence window just ran out. Returns 0 to finish now, or the ms to wait before asking again.
 * `sinceWordsMs`: time since the recogniser last produced words (or since listening began);
 * `windowMs`: the silence window that just ended.
 */
export function holdForVoice(v: VoiceNow | null, sinceWordsMs: number, windowMs: number, sensitivity: Sensitivity): number {
  if (!v || !v.calibrated) return 0
  if (!v.voiced && v.quietMs >= VOICE_HOLD.RECENT_MS) return 0
  if (sinceWordsMs >= windowMs + VOICE_HOLD.MAX_MS[sensitivity]) return 0
  return VOICE_HOLD.CHECK_MS
}

/** Silence window with the sensitivity applied. */
export const silenceWindow = (t: Timing, heard: boolean, sensitivity: Sensitivity) => (heard ? t.silenceMs : Math.round(t.initialMs * VOICE_HOLD.INITIAL_X[sensitivity]))

/* ---------- restarts of an always-on (wake word) session ---------- */

export const WAKE_RETRY = {
  /** normal pause before the browser's ended session is started again, ms */
  BASE_MS: 250,
  /** a session that ended sooner than this did not really run: back off, doubling up to MAX_MS */
  SHORT_SESSION_MS: 1000,
  MAX_MS: 8000,
  /** after a network error: first retry, doubling up to NET_MAX_MS */
  NET_BASE_MS: 1000,
  NET_MAX_MS: 30_000,
  /** start() answered with neither a start nor an error for this long: drop the session and try again */
  START_WATCHDOG_MS: 4000,
  /** a running session that neither reports anything nor ends for this long has silently died: replace it
   *  (the browser ends a healthy silent session itself after roughly 5-60 s) */
  STALE_SESSION_MS: 75_000,
} as const

/**
 * The plain-"hey" wake (fuzzy.ts isBareHey). "Hey" is an everyday word, so it only wakes AURA when it is said on its
 * own: the heard phrase is nothing but "hey", it began after at least GAP_MS of quiet (not the middle of a
 * conversation), and no further word followed within PAUSE_MS (the recogniser's first interim of "hey John, ..."
 * is a bare "hey" too: the pause tells the two apart). After a bare-hey wake the next one waits COOLDOWN_MS.
 * Too eager in a noisy room: raise GAP_MS / PAUSE_MS, or switch "also a plain Hey" off in the voice settings.
 * Too deaf: lower PAUSE_MS (not below ~400 ms).
 */
export const BARE_HEY = {
  GAP_MS: 800,
  PAUSE_MS: 700,
  /** a phrase the recogniser already closed as just "hey" needs only this much more quiet */
  FINAL_PAUSE_MS: 250,
  COOLDOWN_MS: 8000,
} as const

/** Delay before restarting: `fails` = consecutive sessions that ended at once, or network errors in a row. */
export function retryDelay(fails: number, network: boolean): number {
  const base = network ? WAKE_RETRY.NET_BASE_MS : WAKE_RETRY.BASE_MS
  const max = network ? WAKE_RETRY.NET_MAX_MS : WAKE_RETRY.MAX_MS
  return Math.min(max, base * 2 ** Math.max(0, Math.min(10, network ? fails - 1 : fails)))
}
