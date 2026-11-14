// Turns a stream of hand-landmark frames into interface intents: a cursor, air-taps, holds, pinch-drags,
// single-hand push/pull, two-hand zoom, swipes, a fist-hold and an idle timeout. Pure and deterministic
// (time comes from the frames), so every gesture can be unit-tested with synthetic landmark sequences.
//
// Coordinates: frames carry raw image coordinates (0..1, not mirrored). The cursor and every event position
// are SCREEN-normalised (0..1 of the viewport), mirrored so that moving the hand to the right moves the
// cursor to the right, and stretched so that a comfortable central part of the camera picture covers the screen.
import { classify, features, pinchProgress, PoseDebouncer, POSE_TH, sideOf, type Features, type HandSide, type Pose, type PoseThresholds, type Pt } from './classify'
import { OneEuro } from './oneEuro'

export type RawHand = { landmarks: Pt[]; handedness?: string | null; score?: number }
export type RawFrame = {
  /** milliseconds, monotonic */
  t: number
  hands: RawHand[]
  /** width / height of the camera picture */
  aspect?: number
}

export type XY = { x: number; y: number }

export type GestureEvent =
  | { type: 'press'; x: number; y: number }
  | { type: 'tap'; x: number; y: number }
  | { type: 'hold'; x: number; y: number }
  | { type: 'release'; x: number; y: number }
  | { type: 'dragstart'; x: number; y: number }
  | { type: 'drag'; x: number; y: number; dx: number; dy: number }
  | { type: 'dragend'; x: number; y: number; cancelled: boolean }
  /** single-hand push/pull while pinching: factor > 1 = the hand came closer to the camera */
  | { type: 'depth'; factor: number; x: number; y: number }
  | { type: 'zoomstart'; x: number; y: number }
  /** two-hand pinch: factor > 1 = the hands moved apart */
  | { type: 'zoom'; factor: number; x: number; y: number }
  | { type: 'zoomend' }
  | { type: 'swipe'; dir: 'left' | 'right' }
  | { type: 'fist'; x: number; y: number }
  | { type: 'idle' }
  | { type: 'found' }

export type Mode = 'idle' | 'hover' | 'press' | 'drag' | 'depth' | 'zoom' | 'fist'
export type Quality = 'ok' | 'no-hand' | 'low-confidence' | 'edge' | 'far' | 'near'

export type HandView = { id: number; side: HandSide | null; pose: Pose; primary: boolean; pinch: number; landmarks: Pt[] }

export type GestureState = {
  t: number
  present: boolean
  cursor: XY | null
  mode: Mode
  pose: Pose
  /** primary hand, 0 = fingers apart, 1 = pinched */
  pinch: number
  /** 0..1 towards a hold while the pinch is held still */
  hold: number
  /** 0..1 towards the fist-hold */
  fist: number
  quality: Quality
  hands: HandView[]
  /** the two pinch points while zooming with both hands */
  zoomPts: [XY, XY] | null
}

export type GestureOptions = {
  /** part of the (mirrored) camera picture that maps onto the whole screen */
  region: { x0: number; x1: number; y0: number; y1: number }
  /** frames were flipped horizontally before detection (false for a raw webcam frame) */
  inputMirrored: boolean
  /** hands the model is less sure about are ignored */
  minScore: number
  /** a pinch released within this time without moving is an air-tap */
  tapMaxMs: number
  /** a pinch held still this long is a hold (deliberate confirm) */
  holdMs: number
  /** screen-normalised movement that turns a pinch into a drag */
  slop: number
  /** change of apparent hand size (ratio) that turns a still pinch into a push/pull; 0 disables */
  depthOn: number
  fistMs: number
  /** camera-normalised palm travel and time window for a swipe */
  swipeMinDist: number
  swipeMaxMs: number
  swipeCooldownMs: number
  /** no hand for this long: idle */
  idleMs: number
  /** a hand missing for at most this long (a dropped detection) keeps its state */
  lostGraceMs: number
  /** frames a new pose must persist before it counts */
  debounceFrames: number
  /** pinch progress above which the cursor follows the knuckle instead of the fingertip */
  steadyFrom: number
  filter: { minCutoff: number; beta: number; dCutoff: number }
  pose: PoseThresholds
}

export const DEFAULT_OPTIONS: GestureOptions = {
  region: { x0: 0.18, x1: 0.82, y0: 0.14, y1: 0.72 },
  inputMirrored: false,
  minScore: 0.5,
  tapMaxMs: 600,
  holdMs: 900,
  slop: 0.03,
  depthOn: 1.18,
  fistMs: 700,
  swipeMinDist: 0.22,
  swipeMaxMs: 320,
  swipeCooldownMs: 800,
  idleMs: 2500,
  lostGraceMs: 160,
  debounceFrames: 2,
  steadyFrom: 0.35,
  filter: { minCutoff: 1.2, beta: 4, dCutoff: 1 },
  pose: POSE_TH,
}

type Track = {
  id: number
  filters: OneEuro[]
  lm: Pt[]
  f: Features
  /** palm centre before smoothing (for fast gestures) */
  rawPalm: { x: number; y: number }
  side: HandSide | null
  pose: Pose
  raw: Pose
  deb: PoseDebouncer
  since: number
  seenAt: number
  poseSince: number
}

type Press = { t0: number; anchor: XY; last: XY; palm0: XY; scale0: number; lastScale: number; mode: 'none' | 'move' | 'depth'; held: boolean }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export class GesturePipeline {
  readonly o: GestureOptions
  private tracks: Track[] = []
  private nextId = 1
  private primaryId: number | null = null
  private cursor: XY | null = null
  private steady: { base: XY; knuckle: XY } | null = null
  private blend: { dx: number; dy: number; t: number } | null = null
  private press: Press | null = null
  private zoom: { d: number } | null = null
  private suppressPinch = false
  private fistFired = false
  private swipeHist: { t: number; x: number; y: number; open: boolean }[] = []
  private swipeUntil = 0
  private lastHandAt = -Infinity
  private idleSent = true
  private last: GestureState

  constructor(opts: Partial<GestureOptions> = {}) {
    this.o = { ...DEFAULT_OPTIONS, ...opts, region: { ...DEFAULT_OPTIONS.region, ...opts.region }, pose: { ...POSE_TH, ...opts.pose } }
    this.last = this.emptyState(0, 'no-hand')
  }

  reset() {
    this.tracks = []
    this.primaryId = null
    this.cursor = null
    this.steady = null
    this.blend = null
    this.press = null
    this.zoom = null
    this.suppressPinch = false
    this.fistFired = false
    this.swipeHist = []
    this.lastHandAt = -Infinity
    this.idleSent = true
  }

  /** Raw image point -> screen-normalised point (mirrored, stretched over `region`). */
  toScreen(p: XY): XY {
    const r = this.o.region
    const mx = this.o.inputMirrored ? p.x : 1 - p.x
    return { x: clamp01((mx - r.x0) / (r.x1 - r.x0)), y: clamp01((p.y - r.y0) / (r.y1 - r.y0)) }
  }

  /** Screen-normalised point -> raw image point (inverse of toScreen inside the region). */
  fromScreen(p: XY): XY {
    const r = this.o.region
    const mx = r.x0 + p.x * (r.x1 - r.x0)
    return { x: this.o.inputMirrored ? mx : 1 - mx, y: r.y0 + p.y * (r.y1 - r.y0) }
  }

  private delta(a: XY, b: XY): XY {
    const r = this.o.region
    const dx = (b.x - a.x) / (r.x1 - r.x0)
    return { x: this.o.inputMirrored ? dx : -dx, y: (b.y - a.y) / (r.y1 - r.y0) }
  }

  private emptyState(t: number, quality: Quality): GestureState {
    return { t, present: false, cursor: null, mode: 'idle', pose: 'none', pinch: 0, hold: 0, fist: 0, quality, hands: [], zoomPts: null }
  }

  // ---------------------------------------------------------------------------------------------------
  // tracking: identity across frames, smoothing, per-hand pose with hysteresis and debounce
  // ---------------------------------------------------------------------------------------------------
  private updateTracks(frame: RawFrame, aspect: number): { fresh: Track[]; lowConfidence: boolean } {
    const t = frame.t
    const good = frame.hands.filter((h) => h.landmarks?.length === 21 && (h.score ?? 1) >= this.o.minScore)
    const lowConfidence = frame.hands.length > 0 && good.length === 0
    const centre = (lm: Pt[]) => ({ x: (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5, y: (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5 })
    const free = new Set(good.map((_, i) => i))
    const matched = new Map<Track, number>()
    // oldest tracks pick first: the hand that was there first keeps its identity (and stays the cursor hand)
    for (const tr of [...this.tracks].sort((a, b) => a.since - b.since)) {
      let best = -1
      let bestD = 0.3
      for (const i of free) {
        const c = centre(good[i].landmarks)
        const d = Math.hypot((c.x - tr.f.palm.x) * aspect, c.y - tr.f.palm.y)
        if (d < bestD) {
          bestD = d
          best = i
        }
      }
      if (best >= 0) {
        matched.set(tr, best)
        free.delete(best)
      }
    }
    for (const i of free) {
      if (this.tracks.length >= 2) break
      const { minCutoff, beta, dCutoff } = this.o.filter
      const tr: Track = {
        id: this.nextId++,
        filters: Array.from({ length: 63 }, () => new OneEuro(minCutoff, beta, dCutoff)),
        lm: [],
        f: features(good[i].landmarks, aspect),
        rawPalm: centre(good[i].landmarks),
        side: null,
        pose: 'none',
        raw: 'none',
        deb: new PoseDebouncer(this.o.debounceFrames),
        since: t,
        seenAt: t,
        poseSince: t,
      }
      this.tracks.push(tr)
      matched.set(tr, i)
    }
    const fresh: Track[] = []
    for (const [tr, i] of matched) {
      const h = good[i]
      tr.lm = h.landmarks.map((p, k) => ({ x: tr.filters[k * 3].filter(p.x, t), y: tr.filters[k * 3 + 1].filter(p.y, t), z: tr.filters[k * 3 + 2].filter(p.z, t) }))
      tr.f = features(tr.lm, aspect)
      tr.rawPalm = centre(h.landmarks)
      tr.side = sideOf(h.handedness, this.o.inputMirrored) ?? tr.side
      tr.raw = classify(tr.f, tr.raw === 'pinch', this.o.pose)
      const { pose, changed } = tr.deb.push(tr.raw)
      if (changed) {
        tr.pose = pose
        tr.poseSince = t
      }
      tr.seenAt = t
      fresh.push(tr)
    }
    this.tracks = this.tracks.filter((tr) => tr.seenAt === t || t - tr.seenAt <= this.o.lostGraceMs)
    return { fresh: fresh.sort((a, b) => a.since - b.since), lowConfidence }
  }

  // ---------------------------------------------------------------------------------------------------
  // one frame in, state + intents out
  // ---------------------------------------------------------------------------------------------------
  push(frame: RawFrame): { state: GestureState; events: GestureEvent[] } {
    const t = frame.t
    const aspect = frame.aspect ?? 4 / 3
    const ev: GestureEvent[] = []
    const { fresh, lowConfidence } = this.updateTracks(frame, aspect)

    let primary = fresh.find((tr) => tr.id === this.primaryId) ?? null
    if (!primary && this.primaryId !== null && this.tracks.some((tr) => tr.id === this.primaryId)) {
      // the cursor hand dropped out for a frame or two: hold everything as it is
      this.last = { ...this.last, t }
      return { state: this.last, events: ev }
    }
    if (!primary && fresh.length) {
      this.cancelPress(ev)
      this.endZoom(ev)
      this.steady = null
      this.swipeHist = []
      primary = fresh.find((tr) => tr.side === 'right') ?? fresh[0]
      this.primaryId = primary.id
    }

    if (!primary) {
      this.cancelPress(ev)
      this.endZoom(ev)
      this.primaryId = null
      this.steady = null
      this.swipeHist = []
      if (!this.idleSent && t - this.lastHandAt >= this.o.idleMs) {
        this.idleSent = true
        ev.push({ type: 'idle' })
      }
      this.last = this.emptyState(t, lowConfidence ? 'low-confidence' : 'no-hand')
      return { state: this.last, events: ev }
    }

    if (this.idleSent) {
      this.idleSent = false
      ev.push({ type: 'found' })
    }
    this.lastHandAt = t
    const f = primary.f
    const pinch = pinchProgress(f, this.o.pose)
    let mode: Mode = 'hover'
    let zoomPts: [XY, XY] | null = null

    // ---- two hands pinching: zoom --------------------------------------------------------------------
    const other = fresh.find((tr) => tr !== primary) ?? null
    if (other && primary.pose === 'pinch' && other.pose === 'pinch') {
      const a = primary.f.pinchPt
      const b = other.f.pinchPt
      const d = Math.max(1e-4, Math.hypot((a.x - b.x) * aspect, a.y - b.y))
      const mid = this.toScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
      if (!this.zoom) {
        this.cancelPress(ev)
        this.zoom = { d }
        ev.push({ type: 'zoomstart', ...(this.cursor ?? mid) })
      } else {
        const factor = d / this.zoom.d
        this.zoom.d = d
        if (Math.abs(factor - 1) > 1e-4) ev.push({ type: 'zoom', factor, ...(this.cursor ?? mid) })
      }
      zoomPts = [this.toScreen(a), this.toScreen(b)]
      mode = 'zoom'
    } else if (this.zoom) {
      this.endZoom(ev)
      // the hand still pinching must open before it can press again
      this.suppressPinch = true
    }

    // ---- cursor ------------------------------------------------------------------------------------
    if (mode !== 'zoom' && primary.pose !== 'fist') this.moveCursor(primary, pinch, t)
    const cursor = this.cursor ?? this.toScreen(f.tip)
    this.cursor = cursor

    // ---- fist-hold ------------------------------------------------------------------------------------
    let fist = 0
    if (primary.pose === 'fist') {
      this.cancelPress(ev)
      fist = Math.min(1, (t - primary.poseSince) / this.o.fistMs)
      if (fist >= 1 && !this.fistFired) {
        this.fistFired = true
        ev.push({ type: 'fist', ...cursor })
      }
      if (mode !== 'zoom') mode = 'fist'
    } else this.fistFired = false

    // ---- pinch: press, tap, hold, drag, push/pull ------------------------------------------------------
    let hold = 0
    if (primary.pose !== 'pinch') this.suppressPinch = false
    if (mode !== 'zoom' && mode !== 'fist') {
      if (primary.pose === 'pinch' && !this.suppressPinch) {
        let p = this.press
        if (!p) {
          p = this.press = { t0: t, anchor: cursor, last: cursor, palm0: f.palm, scale0: f.scale, lastScale: f.scale, mode: 'none', held: false }
          ev.push({ type: 'press', ...cursor })
        }
        if (p.mode === 'none') {
          // Sideways travel of the palm vs change of apparent hand size, each against its own threshold: whichever
          // is clearly larger decides between a drag and a push/pull. (The palm, not the knuckle: pushing a hand
          // towards the camera spreads the knuckles outwards in the picture, but leaves the palm centre in place.)
          const d = this.delta(p.palm0, f.palm)
          const lateral = Math.hypot(d.x, d.y) / this.o.slop
          const depth = this.o.depthOn > 1 && !p.held ? Math.abs(Math.log(f.scale / p.scale0)) / Math.log(this.o.depthOn) : 0
          if (lateral > 1 || depth > 1) {
            p.mode = depth > lateral ? 'depth' : 'move'
            if (p.mode === 'depth') p.lastScale = p.scale0
            ev.push({ type: 'dragstart', ...p.anchor })
          }
        }
        if (p.mode === 'move') {
          const dx = cursor.x - p.last.x
          const dy = cursor.y - p.last.y
          if (dx || dy) ev.push({ type: 'drag', ...cursor, dx, dy })
          mode = 'drag'
        } else if (p.mode === 'depth') {
          const factor = f.scale / p.lastScale
          if (Math.abs(factor - 1) > 1e-4) ev.push({ type: 'depth', factor, ...p.anchor })
          mode = 'depth'
        } else {
          mode = 'press'
          hold = Math.min(1, (t - p.t0) / this.o.holdMs)
          if (!p.held && hold >= 1) {
            p.held = true
            ev.push({ type: 'hold', ...p.anchor })
          }
        }
        p.last = cursor
        p.lastScale = f.scale
      } else if (this.press) {
        const p = this.press
        this.press = null
        if (p.mode !== 'none') ev.push({ type: 'dragend', ...cursor, cancelled: false })
        else if (!p.held && t - p.t0 <= this.o.tapMaxMs) ev.push({ type: 'tap', ...p.anchor })
        ev.push({ type: 'release', ...(p.mode === 'none' ? p.anchor : cursor) })
      }
    }

    // ---- swipe: a quick horizontal sweep of the open palm ----------------------------------------------
    // Measured on the unsmoothed palm (smoothing would eat a fast flick); the sweep must span at least
    // three frames, so a single-frame landmark jump is never a swipe.
    const palm = primary.rawPalm
    const palmX = this.o.inputMirrored ? palm.x : 1 - palm.x
    this.swipeHist.push({ t, x: palmX, y: palm.y, open: primary.pose === 'open' && !this.press && !this.zoom })
    while (this.swipeHist.length && t - this.swipeHist[0].t > this.o.swipeMaxMs) this.swipeHist.shift()
    if (t >= this.swipeUntil && primary.pose === 'open' && !this.press && !this.zoom) {
      let i = this.swipeHist.length - 1
      while (i > 0 && this.swipeHist[i - 1].open) i--
      const a = this.swipeHist[i]
      const dx = palmX - a.x
      const dy = palm.y - a.y
      let maxStep = 0
      for (let k = i + 1; k < this.swipeHist.length; k++) maxStep = Math.max(maxStep, Math.abs(this.swipeHist[k].x - this.swipeHist[k - 1].x))
      if (i <= this.swipeHist.length - 3 && maxStep <= 0.7 * Math.abs(dx) && Math.abs(dx) >= this.o.swipeMinDist && Math.abs(dy) <= 0.6 * Math.abs(dx)) {
        ev.push({ type: 'swipe', dir: dx > 0 ? 'right' : 'left' })
        this.swipeUntil = t + this.o.swipeCooldownMs
        this.swipeHist = []
      }
    }

    // ---- tracking quality ------------------------------------------------------------------------------
    let quality: Quality = 'ok'
    if (f.palm.x < 0.05 || f.palm.x > 0.95 || f.palm.y < 0.05 || f.palm.y > 0.95) quality = 'edge'
    else if (f.scale < 0.07) quality = 'far'
    else if (f.scale > 0.55) quality = 'near'

    this.last = {
      t,
      present: true,
      cursor,
      mode,
      pose: primary.pose,
      pinch,
      hold,
      fist,
      quality,
      hands: fresh.map((tr) => ({ id: tr.id, side: tr.side, pose: tr.pose, primary: tr === primary, pinch: pinchProgress(tr.f, this.o.pose), landmarks: tr.lm })),
      zoomPts,
    }
    return { state: this.last, events: ev }
  }

  /**
   * The cursor follows the index fingertip. Once the fingers start closing for a pinch it follows the index
   * knuckle instead (the knuckle does not move when the fingertip travels to the thumb), so a pinch does not
   * drag the cursor off its target. When the fingers open again it eases back onto the fingertip.
   */
  private moveCursor(tr: Track, pinch: number, t: number) {
    const f = tr.f
    const steady = tr.pose === 'pinch' || pinch >= this.o.steadyFrom
    if (steady) {
      if (!this.steady) this.steady = { base: this.cursor ?? this.toScreen(f.tip), knuckle: f.knuckle }
      const d = this.delta(this.steady.knuckle, f.knuckle)
      this.cursor = { x: clamp01(this.steady.base.x + d.x), y: clamp01(this.steady.base.y + d.y) }
      this.blend = null
      return
    }
    const target = this.toScreen(f.tip)
    if (this.steady && this.cursor) this.blend = { dx: this.cursor.x - target.x, dy: this.cursor.y - target.y, t }
    this.steady = null
    const k = this.blend ? 1 - (t - this.blend.t) / 250 : 0
    if (this.blend && k <= 0) this.blend = null
    this.cursor = this.blend ? { x: clamp01(target.x + this.blend.dx * k), y: clamp01(target.y + this.blend.dy * k) } : target
  }

  private cancelPress(ev: GestureEvent[]) {
    const p = this.press
    if (!p) return
    this.press = null
    if (p.mode !== 'none') ev.push({ type: 'dragend', ...p.last, cancelled: true })
    ev.push({ type: 'release', ...p.last })
  }

  private endZoom(ev: GestureEvent[]) {
    if (!this.zoom) return
    this.zoom = null
    ev.push({ type: 'zoomend' })
  }
}
