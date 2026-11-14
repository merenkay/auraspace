// Targeting helpers for the hand cursor. Pure (rectangles in, choice out), so they are unit-tested without a DOM.
//  - pickTarget: magnetism with hysteresis. Snaps to the nearest control within a radius that scales with the
//    viewport, treats small controls as if they were at least `minHit` px large, and keeps the current target
//    until another one is clearly closer, so the cursor does not flicker between neighbours.
//  - Dwell: hover-to-click timer with a re-arm rule (one click per visit).

export type Rect = { left: number; top: number; right: number; bottom: number }
export type Cand<T> = { key: T; rect: Rect }
export type MagnetOptions = {
  /** snap radius in px */
  radius: number
  /** a challenger must be this many px closer than the current target to take over */
  stick: number
  /** the current target is let go beyond radius * keep */
  keep: number
  /** small controls count as at least this large (px) */
  minHit: number
}

/** Snap radius for a viewport: about 5 % of its short side, 32..64 px. */
export function magnetRadius(w: number, h: number): number {
  return Math.round(Math.min(64, Math.max(32, Math.min(w, h) * 0.05)))
}

export const MAGNET_DEFAULTS: MagnetOptions = { radius: 48, stick: 18, keep: 1.35, minHit: 44 }

/** The rectangle grown to at least `minHit` in each direction, around its centre. */
export function inflate(r: Rect, minHit: number): Rect {
  const w = r.right - r.left
  const h = r.bottom - r.top
  const gx = Math.max(0, (minHit - w) / 2)
  const gy = Math.max(0, (minHit - h) / 2)
  return { left: r.left - gx, right: r.right + gx, top: r.top - gy, bottom: r.bottom + gy }
}

/** Signed distance from a point to a rectangle: positive outside, negative (down to -cap) inside. */
export function rectDistance(r: Rect, x: number, y: number, cap = 24): number {
  const dx = Math.max(r.left - x, 0, x - r.right)
  const dy = Math.max(r.top - y, 0, y - r.bottom)
  if (dx > 0 || dy > 0) return Math.hypot(dx, dy)
  return -Math.min(cap, x - r.left, r.right - x, y - r.top, r.bottom - y)
}

export function pickTarget<T>(cands: Cand<T>[], x: number, y: number, current: T | null, opts: Partial<MagnetOptions> = {}): T | null {
  const o = { ...MAGNET_DEFAULTS, ...opts }
  let best: { key: T; d: number; area: number } | null = null
  let cur: number | null = null
  let curArea = 0
  for (const c of cands) {
    const r = inflate(c.rect, o.minHit)
    const d = rectDistance(r, x, y, o.stick + 6)
    const area = (r.right - r.left) * (r.bottom - r.top)
    if (c.key === current) {
      cur = d
      curArea = area
    }
    // under the cursor in both (nested, like a button on a card) or equally far: the smaller, more specific one wins
    const better = !best || (d <= 0 && best.d <= 0 ? area < best.area : d < best.d - 0.5 || (Math.abs(d - best.d) <= 0.5 && area < best.area))
    if (better) best = { key: c.key, d, area }
  }
  if (current !== null && cur !== null && cur <= o.radius * o.keep) {
    if (!best || best.key === current) return current
    // moving onto a control that sits inside the current one (a button on a card) switches at once
    const nested = best.d <= 0 && cur <= 0 && best.area < curArea
    if (!nested && cur <= best.d + o.stick) return current
  }
  return best && best.d <= o.radius ? best.key : null
}

/** Where to draw the cursor on a target: small controls snap to their centre, large ones keep the point inside. */
export function snapPoint(r: Rect, x: number, y: number, small = 72): { x: number; y: number } {
  const w = r.right - r.left
  const h = r.bottom - r.top
  const cx = (r.left + r.right) / 2
  const cy = (r.top + r.bottom) / 2
  if (w <= small && h <= small) return { x: cx, y: cy }
  const inset = (s: number) => Math.min(10, s / 4)
  const px = w <= small ? cx : Math.min(Math.max(x, r.left + inset(w)), r.right - inset(w))
  const py = h <= small ? cy : Math.min(Math.max(y, r.top + inset(h)), r.bottom - inset(h))
  return { x: px, y: py }
}

export type DwellOptions = {
  ms: number
  /** the cursor may wander this many px over the target while dwelling (large cards, slow drift) */
  moveTol: number
}

/**
 * Hover-to-click. `update` once per frame with the current target key (null = nothing) and whether dwelling is
 * allowed right now (no pinch in progress, dwell enabled, the control is not a destructive one).
 * Fires once per visit: after a click the same target must be left (or the hand lost) before it can fire again.
 */
export class Dwell<T> {
  o: DwellOptions
  private key: T | null = null
  private since = 0
  private at: { x: number; y: number } | null = null
  private fired = false
  progress = 0

  constructor(opts: Partial<DwellOptions> = {}) {
    this.o = { ms: 800, moveTol: 56, ...opts }
  }

  reset() {
    this.key = null
    this.at = null
    this.fired = false
    this.progress = 0
  }

  update(key: T | null, t: number, x: number, y: number, allowed: boolean): boolean {
    if (key !== this.key) {
      this.key = key
      this.fired = false
      this.since = t
      this.at = { x, y }
    }
    if (key === null || this.fired) {
      this.progress = 0
      return false
    }
    if (!allowed || !this.at || Math.hypot(x - this.at.x, y - this.at.y) > this.o.moveTol) {
      this.since = t
      this.at = { x, y }
      this.progress = 0
      return false
    }
    this.progress = Math.min(1, (t - this.since) / this.o.ms)
    if (this.progress >= 1) {
      this.fired = true
      this.progress = 0
      return true
    }
    return false
  }

  /** after a pinch-click, do not dwell-click the same control again */
  consume() {
    this.fired = true
    this.progress = 0
  }
}
