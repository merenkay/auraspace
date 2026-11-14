// End-of-utterance support for speech recognition. The browser's own end-pointing stops after a short pause,
// so AURA runs the recogniser continuously and decides itself when the person has finished: after a
// configurable silence since the last (interim or final) result, a longer wait when nothing was said yet,
// and a hard cap. When the browser ends a session early, the transcript heard so far is kept and stitched
// to what follows after a transparent restart. Pure: no browser objects in here.
import type { ListenLength } from './settings'

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
  private live: { alts: Alt[]; final: boolean }[] = []

  /** Replace the current session's view with the browser's full results list (continuous mode keeps them all). */
  update(results: ArrayLike<ResultLike>) {
    const next: { alts: Alt[]; final: boolean }[] = []
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      const alts = Array.from({ length: r.length }, (_, j) => norm(r[j])).filter((a) => a.transcript)
      if (alts.length) next.push({ alts, final: r.isFinal })
    }
    this.live = next
  }

  /** The browser ended its session: keep everything heard so far, including words that never became final. */
  seal() {
    for (const s of this.live) this.kept.push(s.alts)
    this.live = []
  }

  reset() {
    this.kept = []
    this.live = []
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
