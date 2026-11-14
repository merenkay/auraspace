// Slap: an open (or loosely open) hand moving fast sideways, like slapping the air to the left or right.
// Pure and frame-rate independent: it works on palm-centre positions with timestamps, in camera-normalised
// units (0..1 of the picture width) per second, so the same thresholds hold at 12, 20 or 30 detections/s.
//
// One slap = one event. After firing, the detector is disarmed until the cooldown has passed AND the hand has
// been nearly still for a moment, so the return movement (which is just as fast) never fires a second page.

export type SlapOptions = {
  /** palm travel of the fast stroke, picture widths */
  minTravel: number
  /** fastest single step of the stroke, picture widths per second */
  minPeak: number
  /** average speed over the stroke */
  minMean: number
  /** the stroke must fit in this time window */
  maxMs: number
  /** vertical travel at most this fraction of the horizontal travel */
  maxSlope: number
  /** no second slap within this time */
  cooldownMs: number
  /** after a slap the hand must be slower than `rearmSpeed` for this long before the next one */
  rearmMs: number
  rearmSpeed: number
  /** steps smaller than this (picture widths) do not break or start a stroke (landmark jitter) */
  jitter: number
}

export const SLAP_DEFAULTS: SlapOptions = {
  minTravel: 0.15,
  minPeak: 0.95,
  minMean: 0.6,
  maxMs: 450,
  maxSlope: 0.7,
  cooldownMs: 700,
  rearmMs: 140,
  rearmSpeed: 0.4,
  jitter: 0.008,
}

type Sample = { t: number; x: number; y: number; ok: boolean }
export type Slap = { dir: 'left' | 'right'; speed: number; travel: number }

export class SlapDetector {
  readonly o: SlapOptions
  private hist: Sample[] = []
  private armed = true
  private coolUntil = 0
  private restSince: number | null = null

  constructor(opts: Partial<SlapOptions> = {}) {
    this.o = { ...SLAP_DEFAULTS, ...opts }
  }

  reset() {
    this.hist = []
    this.restSince = null
  }

  /** true while a slap is still on cooldown or waiting for the hand to settle */
  get cooling() {
    return !this.armed
  }

  /**
   * `x`: palm centre across the picture in SCREEN direction (already mirrored like the cursor: larger = towards
   * the right of the screen). `open`: the hand is (loosely) open in this frame. `blocked`: a pinch, drag or zoom
   * is in progress (nothing fires and the stroke history is dropped).
   */
  push(t: number, x: number, y: number, open: boolean, blocked: boolean): Slap | null {
    const o = this.o
    if (blocked) {
      this.hist = []
      this.restSince = null
      return null
    }
    const prev = this.hist[this.hist.length - 1]
    this.hist.push({ t, x, y, ok: open })
    while (this.hist.length > 2 && t - this.hist[0].t > o.maxMs + 250) this.hist.shift()

    if (!this.armed) {
      const speed = prev && t > prev.t ? Math.abs(x - prev.x) / ((t - prev.t) / 1000) : 0
      if (speed < o.rearmSpeed) {
        this.restSince ??= t
        if (t - this.restSince >= o.rearmMs && t >= this.coolUntil) {
          this.armed = true
          this.hist = [this.hist[this.hist.length - 1]]
        }
      } else this.restSince = null
      return null
    }

    const h = this.hist
    const n = h.length
    if (n < 3 || !open) return null
    const last = h[n - 1].x - h[n - 2].x
    if (Math.abs(last) <= o.jitter) return null
    const dir = Math.sign(last)
    // walk back over the stroke: same direction (jitter tolerated), open hand, inside the time window
    let i = n - 1
    while (i > 0) {
      const a = h[i - 1]
      const s = h[i].x - a.x
      if (!a.ok || t - a.t > o.maxMs) break
      if (Math.sign(s) !== dir && Math.abs(s) > o.jitter) break
      i--
    }
    // the stroke starts where the movement starts (not at the still frames before it)
    while (i < n - 1 && Math.abs(h[i + 1].x - h[i].x) <= o.jitter) i++
    const steps = n - 1 - i
    if (steps < 2) return null
    const dx = h[n - 1].x - h[i].x
    const dy = h[n - 1].y - h[i].y
    const dur = (h[n - 1].t - h[i].t) / 1000
    let peak = 0
    let maxStep = 0
    for (let k = i + 1; k < n; k++) {
      const s = Math.abs(h[k].x - h[k - 1].x)
      const dt = (h[k].t - h[k - 1].t) / 1000
      maxStep = Math.max(maxStep, s)
      if (dt > 0) peak = Math.max(peak, s / dt)
    }
    const travel = Math.abs(dx)
    if (travel < o.minTravel || dur <= 0 || travel / dur < o.minMean || peak < o.minPeak) return null
    if (Math.abs(dy) > o.maxSlope * travel) return null
    // one huge step is a tracking jump (hand swap, lost frames), not a movement
    if (maxStep > 0.75 * travel) return null
    this.armed = false
    this.coolUntil = t + o.cooldownMs
    this.restSince = null
    this.hist = []
    return { dir: dx > 0 ? 'right' : 'left', speed: peak, travel }
  }
}
