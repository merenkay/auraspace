// Slap: an open (or loosely open) hand moving fast sideways, like slapping the air to the left or right.
// Pure and frame-rate independent: it works on palm-centre positions with timestamps, in camera-normalised
// units (0..1 of the picture width) per second, so the same thresholds hold at 12, 20 or 30 detections/s.
//
// One slap = one event. After firing, the detector is disarmed until the cooldown has passed AND the hand has
// been nearly still for a moment, so the return movement (which is just as fast) never fires a second page.
//
// Wind-up: a real slap usually starts by drawing the hand back the other way, and that preparation is fast
// enough to qualify as a stroke on its own. Firing on it would page the WRONG way and then swallow the real
// strike as "the return movement" (this is why slaps felt reversed with a real webcam). So a qualifying stroke
// is held until the hand settles; if the hand instead swings back clearly further (`windup` times the travel),
// the first stroke was only the wind-up and the strike is reported. A plain back-and-forth of equal size still
// reports the first stroke.

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
  /** a qualifying stroke is reported once the hand has been slower than `rearmSpeed` for this long */
  settleMs: number
  /** ... or at the latest this long after it qualified */
  holdMs: number
  /** a swing back at least this many times the first stroke's travel means the first was only the wind-up */
  windup: number
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
  settleMs: 100,
  holdMs: 600,
  windup: 1.4,
}

type Sample = { t: number; x: number; y: number; ok: boolean }
export type Slap = { dir: 'left' | 'right'; speed: number; travel: number }
type Stroke = Slap & { ok: boolean }

/** Hand setting: `natural` = the tab on the side the hand moved to (right = next); `reversed` swaps them. */
export type SlapDirection = 'natural' | 'reversed'

/**
 * Tab step for a slap: +1 = next tab (the tab to the right), -1 = previous. `dir` is the slap's SCREEN direction,
 * the same left/right as the cursor (with Mirror on: moving your hand to your right = 'right' = next tab).
 */
export function slapStep(dir: 'left' | 'right', setting: SlapDirection = 'natural'): 1 | -1 {
  return (dir === 'right') !== (setting === 'reversed') ? 1 : -1
}

/**
 * Where a slap goes in a tab strip of `count` tabs with tab `cur` current: `side` = the side of the tab it aims at
 * (drives the edge flash / sweep and "already on the last / first tab"), `index` = the tab to open, or null at
 * the end of the strip (or when there is no current tab).
 */
export function slapTab(dir: 'left' | 'right', setting: SlapDirection | undefined, cur: number, count: number): { side: 'left' | 'right'; index: number | null } {
  const step = slapStep(dir, setting)
  const i = cur + step
  return { side: step > 0 ? 'right' : 'left', index: cur >= 0 && i >= 0 && i < count ? i : null }
}

export class SlapDetector {
  readonly o: SlapOptions
  private hist: Sample[] = []
  private armed = true
  private coolUntil = 0
  private restSince: number | null = null
  /** a qualifying stroke waiting to see whether it was only the wind-up */
  private pending: (Slap & { since: number }) | null = null
  private quietSince: number | null = null

  constructor(opts: Partial<SlapOptions> = {}) {
    this.o = { ...SLAP_DEFAULTS, ...opts }
  }

  reset() {
    this.hist = []
    this.restSince = null
    this.pending = null
    this.quietSince = null
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
      this.pending = null
      this.quietSince = null
      return null
    }
    const prev = this.hist[this.hist.length - 1]
    this.hist.push({ t, x, y, ok: open })
    while (this.hist.length > 2 && t - this.hist[0].t > o.maxMs + 250) this.hist.shift()
    const speed = prev && t > prev.t ? Math.abs(x - prev.x) / ((t - prev.t) / 1000) : 0

    if (!this.armed) {
      if (speed < o.rearmSpeed) {
        this.restSince ??= t
        if (t - this.restSince >= o.rearmMs && t >= this.coolUntil) {
          this.armed = true
          this.hist = [this.hist[this.hist.length - 1]]
        }
      } else this.restSince = null
      return null
    }

    const m = this.stroke(t)
    const p = this.pending
    if (!p) {
      if (!m?.ok) return null
      this.pending = { dir: m.dir, speed: m.speed, travel: m.travel, since: t }
      this.quietSince = null
      return null
    }
    // a stroke is pending: a clearly bigger swing back means it was only the wind-up of this one
    if (m?.ok && m.dir !== p.dir && m.travel >= o.windup * p.travel) return this.fire(t, m)
    if (m && m.dir === p.dir) {
      p.travel = Math.max(p.travel, m.travel)
      p.speed = Math.max(p.speed, m.speed)
    }
    if (speed < o.rearmSpeed) this.quietSince ??= t
    else this.quietSince = null
    if ((this.quietSince !== null && t - this.quietSince >= o.settleMs) || t - p.since >= o.holdMs) return this.fire(p.since, p)
    return null
  }

  /** `t`: when the stroke qualified (the cooldown runs from there, as if it had fired at once) */
  private fire(t: number, s: Slap): Slap {
    this.armed = false
    this.coolUntil = t + this.o.cooldownMs
    this.restSince = null
    this.hist = []
    this.pending = null
    this.quietSince = null
    return { dir: s.dir, speed: s.speed, travel: s.travel }
  }

  /** The stroke ending at the newest sample (same direction, open hand, inside the time window), measured. */
  private stroke(t: number): Stroke | null {
    const o = this.o
    const h = this.hist
    const n = h.length
    if (n < 3 || !h[n - 1].ok) return null
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
    const ok =
      travel >= o.minTravel &&
      dur > 0 &&
      travel / dur >= o.minMean &&
      peak >= o.minPeak &&
      Math.abs(dy) <= o.maxSlope * travel &&
      // one huge step is a tracking jump (hand swap, lost frames), not a movement
      maxStep <= 0.75 * travel
    return { dir: dx > 0 ? 'right' : 'left', speed: peak, travel, ok }
  }
}
