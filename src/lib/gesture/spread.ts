// Two-hand "expand": bring both open hands together, then pull them apart quickly (like spreading a hologram
// open). The reverse — bringing open hands together quickly from apart and holding them there — is "join".
// Pure and frame-rate independent: positions are palm centres in frame-height units (x already multiplied by the
// picture's aspect ratio), sizes are palm sizes, and every limit is a time, so the same thresholds hold at 10,
// 20 or 30 detections a second.
//
//  - Together: palm centres closer than `joinRatio` palm sizes (both hands open, neither pinching). When the hands
//    touch, the tracker often merges them into one hand or loses one for a few frames: a hand missing for at most
//    `lossMs` while together counts as still together.
//  - Spread fires when, after at least `holdMs` together, the palms are more than `apartRatio` palm sizes apart
//    within `spreadMs` of last being together, both open, and the hands did not swap sides (passing each other).
//  - Join (only when asked for, e.g. to close a panel) fires after a fast approach (apart -> together within
//    `approachMs`) held for `closeHoldMs`.
//  - A pinch on either hand cancels everything (pinching with both hands is the 3D zoom). After firing, nothing
//    fires again until `cooldownMs` has passed and the hands have been still (or out of view) for `rearmMs`.
import type { HandSide } from './classify'

export type SpreadHand = {
  /** stable identity of the tracked hand */
  key: number
  side: HandSide | null
  /** palm centre, frame-height units (x * aspect, y) */
  x: number
  y: number
  /** palm size, frame-height units */
  scale: number
  /** (loosely) open hand */
  open: boolean
  /** pinching, or closing for a pinch */
  pinch: boolean
}

export type SpreadOptions = {
  joinRatio: number
  apartRatio: number
  holdMs: number
  spreadMs: number
  approachMs: number
  closeHoldMs: number
  lossMs: number
  cooldownMs: number
  rearmMs: number
  /** change of the palm distance (palm sizes per second) below which the hands count as still, for re-arming */
  rearmSpeed: number
  /** after a pinch, nothing starts for this long */
  pinchBlockMs: number
}

export const SPREAD_DEFAULTS: SpreadOptions = {
  joinRatio: 1.7,
  apartRatio: 3.0,
  holdMs: 120,
  spreadMs: 650,
  approachMs: 900,
  closeHoldMs: 300,
  lossMs: 450,
  cooldownMs: 1200,
  rearmMs: 250,
  rearmSpeed: 3,
  pinchBlockMs: 350,
}

export type SpreadEvent = { type: 'spread' | 'join'; x: number; y: number }

type Order = { mode: 'side' | 'key'; a: string | number; b: string | number; sign: number }

export class SpreadDetector {
  readonly o: SpreadOptions
  private phase: 'free' | 'together' | 'cooling' = 'free'
  private togetherSince = 0
  private lastTogetherAt = -Infinity
  private approachFast = false
  private apartAt = -Infinity
  private lastTwoAt = -Infinity
  private lastD = Infinity
  private lastT = -Infinity
  private lastMid = { x: 0, y: 0 }
  private order: Order | null = null
  private coolUntil = 0
  private restSince: number | null = null
  private blockUntil = -Infinity

  constructor(opts: Partial<SpreadOptions> = {}) {
    this.o = { ...SPREAD_DEFAULTS, ...opts }
  }

  reset() {
    this.phase = 'free'
    this.lastTogetherAt = -Infinity
    this.apartAt = -Infinity
    this.order = null
    this.restSince = null
    this.lastD = Infinity
  }

  /** 'together': the hands are together, a quick pull apart now fires */
  get phaseName(): 'free' | 'together' | 'cooling' {
    return this.phase
  }

  /** a two-hand gesture is under way (other one-hand gestures such as the slap should hold off) */
  get engaged(): boolean {
    return this.phase !== 'free'
  }

  private orderOf(a: SpreadHand, b: SpreadHand): Order {
    if (a.side && b.side && a.side !== b.side) {
      const [l, r] = a.side === 'left' ? [a, b] : [b, a]
      return { mode: 'side', a: 'left', b: 'right', sign: Math.sign(r.x - l.x) }
    }
    const [p, q] = a.key < b.key ? [a, b] : [b, a]
    return { mode: 'key', a: p.key, b: q.key, sign: Math.sign(q.x - p.x) }
  }

  /** true when the hands swapped sides since `order` was taken (they passed each other) */
  private crossed(a: SpreadHand, b: SpreadHand): boolean {
    const before = this.order
    if (!before) return false
    const now = this.orderOf(a, b)
    if (now.mode !== before.mode || now.a !== before.a || now.b !== before.b) return false // identities changed: unknown
    return now.sign !== 0 && before.sign !== 0 && now.sign !== before.sign
  }

  /**
   * One detection. `hands`: the tracked hands in this frame (any number). `wantJoin`: also report "join".
   * Returns the gesture that completed in this frame, if any.
   */
  push(t: number, hands: SpreadHand[], wantJoin = false): SpreadEvent | null {
    const o = this.o
    const two = hands.length >= 2 ? [hands[0], hands[1]] : null
    const dt = t - this.lastT
    this.lastT = t

    if (hands.some((h) => h.pinch)) {
      if (this.phase !== 'cooling') this.reset()
      this.blockUntil = t + o.pinchBlockMs
      if (two) this.track(t, two)
      return null
    }

    let d = Infinity
    let mid = this.lastMid
    if (two) {
      const [a, b] = two
      const scale = Math.max(1e-4, (a.scale + b.scale) / 2)
      d = Math.hypot(a.x - b.x, a.y - b.y) / scale
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }

    if (this.phase === 'cooling') {
      const speed = two && Number.isFinite(this.lastD) && dt > 0 ? Math.abs(d - this.lastD) / (dt / 1000) : 0
      if (!two || speed < o.rearmSpeed) this.restSince ??= t
      else this.restSince = null
      if (t >= this.coolUntil && this.restSince !== null && t - this.restSince >= o.rearmMs) {
        this.phase = 'free'
        this.order = null
        this.apartAt = -Infinity
      }
      if (two) this.track(t, two)
      return null
    }
    if (t < this.blockUntil) {
      if (two) this.track(t, two)
      return null
    }

    if (!two) {
      // one hand (or none): while together the other one is probably merged into it or lost for a moment
      if (this.phase === 'together') {
        if (t - this.lastTwoAt <= o.lossMs) this.lastTogetherAt = t
        else this.reset()
      } else if (this.lastD < o.joinRatio * 1.4 && t - this.lastTwoAt <= o.lossMs && hands.length === 1) {
        // lost as they met: count it as together from now
        this.enterTogether(t)
      }
      return null
    }

    const [a, b] = two
    const bothOpen = a.open && b.open
    let ev: SpreadEvent | null = null
    if (this.phase === 'free') {
      if (d >= o.joinRatio) this.order = this.orderOf(a, b)
      if (d >= o.apartRatio && bothOpen) this.apartAt = t
      if (d < o.joinRatio && bothOpen) this.enterTogether(t)
    } else if (this.phase === 'together') {
      if (d < o.joinRatio) {
        this.lastTogetherAt = t
        if (wantJoin && this.approachFast && t - this.togetherSince >= o.closeHoldMs && bothOpen) {
          ev = { type: 'join', ...mid }
          this.fire(t)
        }
      } else if (d >= o.apartRatio) {
        const held = this.lastTogetherAt - this.togetherSince >= o.holdMs
        if (held && bothOpen && t - this.lastTogetherAt <= o.spreadMs && !this.crossed(a, b)) {
          ev = { type: 'spread', ...mid }
          this.fire(t)
        } else {
          this.phase = 'free'
          this.order = this.orderOf(a, b)
          if (bothOpen) this.apartAt = t
        }
      } else if (t - this.lastTogetherAt > o.spreadMs) {
        this.phase = 'free'
        this.order = this.orderOf(a, b)
      }
    }
    this.track(t, two)
    return ev
  }

  private enterTogether(t: number) {
    this.phase = 'together'
    this.togetherSince = t
    this.lastTogetherAt = t
    this.approachFast = t - this.apartAt <= this.o.approachMs
  }

  private fire(t: number) {
    this.phase = 'cooling'
    this.coolUntil = t + this.o.cooldownMs
    this.restSince = null
  }

  private track(t: number, [a, b]: SpreadHand[]) {
    const scale = Math.max(1e-4, (a.scale + b.scale) / 2)
    this.lastD = Math.hypot(a.x - b.x, a.y - b.y) / scale
    this.lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    this.lastTwoAt = t
  }
}

/**
 * How many hands the model should look for. Looking for one is much cheaper (once that hand is tracked the palm
 * detector stops running), so the second hand is searched for only:
 *  - always, while a two-hand gesture is possible right now (`forced`: over the 3D body, or zooming),
 *  - for `keepMs` after two hands were last seen,
 *  - and otherwise in short probes: while an open hand is in view, every `everyMs` the model looks for two hands
 *    for `probeMs` (a few detections). If a second hand shows up it stays in two-hand mode while both are in view.
 */
export type ProbeOptions = { everyMs: number; probeMs: number; keepMs: number }
export const PROBE_DEFAULTS: ProbeOptions = { everyMs: 700, probeMs: 250, keepMs: 2500 }

export class HandsProbe {
  readonly o: ProbeOptions
  private twoAt = -Infinity
  private probeUntil = 0
  private nextProbe = 0
  /** probes started (for measurements) */
  probes = 0

  constructor(opts: Partial<ProbeOptions> = {}) {
    this.o = { ...PROBE_DEFAULTS, ...opts }
  }

  reset() {
    this.twoAt = -Infinity
    this.probeUntil = 0
    this.nextProbe = 0
  }

  /**
   * One detection: `hands` seen, whether an open hand is in view, `forced` (two hands needed now) and `enabled`
   * (the two-hand gesture is switched on). Returns the number of hands to look for from now on.
   */
  update(t: number, s: { hands: number; openHand: boolean; forced: boolean; enabled: boolean }): 1 | 2 {
    if (s.hands >= 2) this.twoAt = t
    if (s.forced || t - this.twoAt <= this.o.keepMs) {
      this.probeUntil = 0
      return 2
    }
    if (this.probeUntil) {
      if (t < this.probeUntil) return 2
      // the probe found no second hand
      this.probeUntil = 0
      this.nextProbe = t + this.o.everyMs
      return 1
    }
    if (s.enabled && s.openHand && t >= this.nextProbe) {
      this.probeUntil = t + this.o.probeMs
      this.probes++
      return 2
    }
    return 1
  }
}
