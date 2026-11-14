// Turns a stream of hand-landmark frames into interface intents: a cursor, air-taps, holds, pinch-drags,
// single-hand push/pull, two-hand zoom, slaps (page left/right), a fist-hold and an idle timeout. Pure and
// deterministic (time comes from the frames), so every gesture can be unit-tested with synthetic landmark sequences.
//
// Coordinates: frames carry raw image coordinates (0..1, not mirrored). The cursor and every event position
// are SCREEN-normalised (0..1 of the viewport). With `mirror` on (default) the picture is treated like a mirror:
// moving the hand to your right moves the cursor to the right of the screen, and a comfortable central part of
// the camera picture (`region`) is stretched over the whole screen, so the corners are reachable without
// reaching the edges of the picture (where tracking is worst).
import { classify, features, PinchCalibrator, pinchProgress, PoseDebouncer, POSE_TH, sideOf, type Features, type HandSide, type Pose, type PoseThresholds, type Pt } from './classify'
import { OneEuro } from './oneEuro'
import { SLAP_DEFAULTS, SlapDetector, type SlapOptions } from './slap'
import { SPREAD_DEFAULTS, SpreadDetector, type SpreadHand, type SpreadOptions } from './spread'

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
  /** fast sideways movement of the open hand; `dir` is the direction on SCREEN (as seen in the mirrored preview) */
  | { type: 'slap'; dir: 'left' | 'right'; speed: number }
  | { type: 'fist'; x: number; y: number }
  /** both open hands brought together, then pulled apart quickly; x, y = between the hands (screen-normalised) */
  | { type: 'spread'; x: number; y: number }
  /** both open hands brought together quickly from apart and held (reported only while `wantJoin` is set) */
  | { type: 'join'; x: number; y: number }
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
  /** the cursor is held in place because the fingers are closing for a pinch (or pinched) */
  frozen: boolean
  quality: Quality
  hands: HandView[]
  /** the two pinch points while zooming with both hands */
  zoomPts: [XY, XY] | null
}

export type GestureOptions = {
  /** part of the camera picture (in mirrored screen orientation) that maps onto the whole screen */
  region: { x0: number; x1: number; y0: number; y1: number }
  /** frames were flipped horizontally before detection (false for a raw webcam frame) */
  inputMirrored: boolean
  /** behave like a mirror (default): your right = screen right. Off: the cursor follows the unmirrored picture */
  mirror: boolean
  /** which hand drives the cursor when both are in view */
  primaryHand: HandSide
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
  slap: SlapOptions
  /** two-hand spread / join (see spread.ts); `twoHand` false switches it off */
  spread: SpreadOptions
  twoHand: boolean
  /** no hand for this long: idle */
  idleMs: number
  /** a hand missing for at most this long (a dropped detection) keeps its state */
  lostGraceMs: number
  /** frames a new pose must persist before it counts */
  debounceFrames: number
  /** pinch progress from which the cursor freezes (if the fingers are closing) */
  freezeFrom: number
  /** pinch progress that freezes the cursor however slowly the fingers closed */
  freezeHard: number
  /** screen-normalised palm travel that breaks a freeze before the pinch is complete (the hand is moving on) */
  freezeBreak: number
  /** screen-normalised dead zone: smaller cursor movements are ignored (doubled near the screen edges) */
  deadZone: number
  filter: { minCutoff: number; beta: number; dCutoff: number }
  /** learn pinch thresholds per hand (see PinchCalibrator); false = fixed `pose` thresholds */
  calibrate: boolean
  pose: PoseThresholds
}

export const DEFAULT_OPTIONS: GestureOptions = {
  region: { x0: 0.2, x1: 0.8, y0: 0.15, y1: 0.68 },
  inputMirrored: false,
  mirror: true,
  primaryHand: 'right',
  minScore: 0.5,
  tapMaxMs: 600,
  holdMs: 900,
  slop: 0.035,
  depthOn: 1.18,
  fistMs: 700,
  slap: SLAP_DEFAULTS,
  spread: SPREAD_DEFAULTS,
  twoHand: true,
  idleMs: 2500,
  lostGraceMs: 200,
  debounceFrames: 2,
  freezeFrom: 0.3,
  freezeHard: 0.6,
  freezeBreak: 0.06,
  deadZone: 0.0035,
  filter: { minCutoff: 0.9, beta: 5, dCutoff: 1.2 },
  calibrate: true,
  pose: POSE_TH,
}

type Track = {
  id: number
  filters: OneEuro[]
  lm: Pt[]
  f: Features
  /** features of the unsmoothed landmarks (for fast gestures) */
  rawF: Features
  side: HandSide | null
  pose: Pose
  raw: Pose
  deb: PoseDebouncer
  calib: PinchCalibrator | null
  th: PoseThresholds
  since: number
  seenAt: number
  poseSince: number
}

type Press = { t0: number; anchor: XY; last: XY; palm0: XY; scale0: number; lastScale: number; mode: 'none' | 'move' | 'depth'; held: boolean }
type Freeze = { at: XY; palm: XY; knuckle: XY }

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export class GesturePipeline {
  o: GestureOptions
  private tracks: Track[] = []
  private nextId = 1
  private primaryId: number | null = null
  private cursor: XY | null = null
  private freeze: Freeze | null = null
  /** the cursor stays frozen until this time after a release (the fingertip flicks as the fingers open) */
  private thawAt = 0
  /** a freeze was broken by moving the hand: no new one until the fingers open (or a real pinch) */
  private freezeVeto = false
  private blend: { dx: number; dy: number; t: number } | null = null
  private recent: { t: number; cursor: XY; pinch: number }[] = []
  private press: Press | null = null
  private releasedAt = -Infinity
  private zoom: { d: number } | null = null
  private suppressPinch = false
  private fistFired = false
  private slap: SlapDetector
  private spread: SpreadDetector
  /** report "join" too (set by the page side, e.g. while the voice panel is open) */
  wantJoin = false
  private lastHandAt = -Infinity
  private idleSent = true
  private last: GestureState

  constructor(opts: Partial<GestureOptions> = {}) {
    this.o = this.merge(DEFAULT_OPTIONS, opts)
    this.slap = new SlapDetector(this.o.slap)
    this.spread = new SpreadDetector(this.o.spread)
    this.last = this.emptyState(0, 'no-hand')
  }

  private merge(base: GestureOptions, opts: Partial<GestureOptions>): GestureOptions {
    return { ...base, ...opts, region: { ...base.region, ...opts.region }, pose: { ...base.pose, ...opts.pose }, slap: { ...base.slap, ...opts.slap }, spread: { ...base.spread, ...opts.spread }, filter: { ...base.filter, ...opts.filter } }
  }

  /** Change options while running (settings panel): mirror, hand preference, region. */
  configure(opts: Partial<GestureOptions>) {
    this.o = this.merge(this.o, opts)
  }

  reset() {
    this.tracks = []
    this.primaryId = null
    this.cursor = null
    this.freeze = null
    this.freezeVeto = false
    this.blend = null
    this.recent = []
    this.press = null
    this.zoom = null
    this.suppressPinch = false
    this.fistFired = false
    this.slap.reset()
    this.spread.reset()
    this.lastHandAt = -Infinity
    this.idleSent = true
  }

  /** a two-hand gesture (spread / join) is under way */
  get twoHandBusy(): boolean {
    return this.spread.engaged
  }

  /** 'together': both open hands are together and a pull apart would fire now */
  get twoHandPhase(): 'free' | 'together' | 'cooling' {
    return this.spread.phaseName
  }

  /** raw x -> x in screen orientation (before stretching over the region) */
  private sx(x: number): number {
    return this.o.mirror !== this.o.inputMirrored ? 1 - x : x
  }

  /** Raw image point -> screen-normalised point (mirrored, stretched over `region`). */
  toScreen(p: XY): XY {
    const r = this.o.region
    return { x: clamp01((this.sx(p.x) - r.x0) / (r.x1 - r.x0)), y: clamp01((p.y - r.y0) / (r.y1 - r.y0)) }
  }

  /** Screen-normalised point -> raw image point (inverse of toScreen inside the region). */
  fromScreen(p: XY): XY {
    const r = this.o.region
    const mx = r.x0 + p.x * (r.x1 - r.x0)
    return { x: this.sx(mx), y: r.y0 + p.y * (r.y1 - r.y0) }
  }

  private delta(a: XY, b: XY): XY {
    const r = this.o.region
    return { x: (this.sx(b.x) - this.sx(a.x)) / (r.x1 - r.x0), y: (b.y - a.y) / (r.y1 - r.y0) }
  }

  private emptyState(t: number, quality: Quality): GestureState {
    return { t, present: false, cursor: null, mode: 'idle', pose: 'none', pinch: 0, hold: 0, fist: 0, frozen: false, quality, hands: [], zoomPts: null }
  }

  // ---------------------------------------------------------------------------------------------------
  // tracking: identity across frames, smoothing, per-hand pose with calibrated hysteresis and debounce
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
        const d = Math.hypot((c.x - tr.rawF.palm.x) * aspect, c.y - tr.rawF.palm.y)
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
      const f0 = features(good[i].landmarks, aspect)
      const calib = this.o.calibrate ? new PinchCalibrator(this.o.pose) : null
      const tr: Track = {
        id: this.nextId++,
        filters: Array.from({ length: 63 }, () => new OneEuro(minCutoff, beta, dCutoff)),
        lm: [],
        f: f0,
        rawF: f0,
        side: null,
        pose: 'none',
        raw: 'none',
        deb: new PoseDebouncer(this.o.debounceFrames),
        calib,
        th: calib?.th ?? this.o.pose,
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
      tr.rawF = features(h.landmarks, aspect)
      tr.side = sideOf(h.handedness, this.o.inputMirrored) ?? tr.side
      tr.raw = classify(tr.f, tr.raw === 'pinch', tr.th)
      const { pose, changed } = tr.deb.push(tr.raw)
      if (changed) {
        tr.pose = pose
        tr.poseSince = t
      }
      if (tr.calib) tr.th = tr.calib.update(tr.f.pinch, tr.raw === 'pinch', tr.pose === 'open' || tr.pose === 'point', t)
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

    // ---- two open hands: spread (and join) ---------------------------------------------------------------
    // Fed with every frame, also while the cursor hand is briefly missing (the hands merge as they touch).
    if (this.o.twoHand) {
      const hands: SpreadHand[] = fresh.map((tr) => ({
        key: tr.id,
        side: tr.side,
        x: tr.rawF.palm.x * aspect,
        y: tr.rawF.palm.y,
        scale: tr.rawF.scale,
        open: tr.pose === 'open' || (tr.rawF.ext.filter((e) => e > 0.3).length >= 3 && tr.rawF.pinch > tr.th.pinchRelease),
        pinch: tr.pose === 'pinch' || tr.raw === 'pinch' || pinchProgress(tr.f, tr.th) > 0.6,
      }))
      const sp = this.spread.push(t, hands, this.wantJoin)
      if (sp) ev.push({ type: sp.type, ...this.toScreen({ x: sp.x / aspect, y: sp.y }) })
    }

    let primary = fresh.find((tr) => tr.id === this.primaryId) ?? null
    if (!primary && this.primaryId !== null && this.tracks.some((tr) => tr.id === this.primaryId)) {
      // the cursor hand dropped out for a frame or two: hold everything as it is
      this.last = { ...this.last, t }
      return { state: this.last, events: ev }
    }
    if (!primary && fresh.length) {
      this.cancelPress(ev)
      this.endZoom(ev)
      this.freeze = null
      this.slap.reset()
      primary = fresh.find((tr) => tr.side === this.o.primaryHand) ?? fresh[0]
      this.primaryId = primary.id
    }

    if (!primary) {
      this.cancelPress(ev)
      this.endZoom(ev)
      this.primaryId = null
      this.freeze = null
      this.recent = []
      this.slap.reset()
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
    const pinch = pinchProgress(f, primary.th)
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
          // the cursor is frozen while the fingers close, so the press lands where the person aimed
          const at = this.freeze?.at ?? cursor
          p = this.press = { t0: t, anchor: at, last: at, palm0: f.palm, scale0: f.scale, lastScale: f.scale, mode: 'none', held: false }
          if (!this.freeze) this.freeze = { at, palm: f.palm, knuckle: f.knuckle }
          ev.push({ type: 'press', ...at })
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
            if (p.mode === 'move') this.moveCursor(primary, pinch, t)
          }
        }
        const cur = this.cursor ?? cursor
        if (p.mode === 'move') {
          const dx = cur.x - p.last.x
          const dy = cur.y - p.last.y
          if (dx || dy) ev.push({ type: 'drag', ...cur, dx, dy })
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
        p.last = cur
        p.lastScale = f.scale
      } else if (this.press) {
        const p = this.press
        this.press = null
        this.releasedAt = t
        const cur = this.cursor ?? cursor
        if (p.mode !== 'none') ev.push({ type: 'dragend', ...cur, cancelled: false })
        else if (!p.held && t - p.t0 <= this.o.tapMaxMs) ev.push({ type: 'tap', ...p.anchor })
        ev.push({ type: 'release', ...(p.mode === 'none' ? p.anchor : cur) })
        // keep the cursor where it was for a moment: the fingertip flicks as the fingers open
        if (p.mode === 'none') this.thawAt = t + 150
        else this.freeze = null
      }
    }

    // ---- slap: a fast sideways movement of the (loosely) open hand ------------------------------------
    // On the unsmoothed palm (smoothing would eat the stroke), in screen direction. Never while a pinch, drag or
    // zoom is in progress, just after one, or while the fingers are closing.
    const rf = primary.rawF
    const openish = rf.ext.filter((e) => e > 0.3).length >= 3 && rf.pinch > primary.th.pinchRelease
    // (with two hands in view the two-hand gestures take over: spreading them apart is fast and sideways too)
    const blocked = !!this.press || !!this.zoom || mode === 'fist' || pinch > 0.5 || t - this.releasedAt < 350 || fresh.length > 1 || this.spread.engaged
    const slap = this.slap.push(t, this.sx(rf.palm.x), rf.palm.y, openish, blocked)
    if (slap) ev.push({ type: 'slap', dir: slap.dir, speed: slap.speed })

    // ---- tracking quality ------------------------------------------------------------------------------
    let quality: Quality = 'ok'
    if (f.palm.x < 0.05 || f.palm.x > 0.95 || f.palm.y < 0.05 || f.palm.y > 0.95) quality = 'edge'
    else if (f.scale < 0.07) quality = 'far'
    else if (f.scale > 0.55) quality = 'near'

    this.last = {
      t,
      present: true,
      cursor: this.cursor ?? cursor,
      mode,
      pose: primary.pose,
      pinch,
      hold,
      fist,
      frozen: !!this.freeze,
      quality,
      hands: fresh.map((tr) => ({ id: tr.id, side: tr.side, pose: tr.pose, primary: tr === primary, pinch: pinchProgress(tr.f, tr.th), landmarks: tr.lm })),
      zoomPts,
    }
    return { state: this.last, events: ev }
  }

  /**
   * The cursor follows the index fingertip, with a small dead zone against tremor. From the moment the fingers
   * start closing for a pinch it FREEZES (at the spot it had just before they began to close) until the pinch is
   * released, so the pinch cannot drag it off its target. A pinch that turns into a drag moves it with the
   * knuckle (which does not travel when the fingertip does). A freeze before the pinch completes is broken
   * when the whole hand moves on or the fingers open again; afterwards the cursor eases back onto the fingertip.
   */
  private moveCursor(tr: Track, pinch: number, t: number) {
    const f = tr.f
    const target = this.toScreen(f.tip)
    const prev = this.cursor
    this.recent.push({ t, cursor: prev ?? target, pinch })
    while (this.recent.length > 1 && t - this.recent[0].t > 400) this.recent.shift()

    const p = this.press
    if (p && p.mode === 'move' && this.freeze) {
      const d = this.delta(this.freeze.knuckle, f.knuckle)
      this.cursor = { x: clamp01(this.freeze.at.x + d.x), y: clamp01(this.freeze.at.y + d.y) }
      return
    }
    if (p && this.freeze) {
      this.cursor = this.freeze.at
      return
    }
    if (this.freeze && !p) {
      const moved = this.delta(this.freeze.palm, f.palm)
      // just after a release: wait out the flick; before a pinch: the fingers opened again
      const thawed = this.thawAt > 0 ? t >= this.thawAt : pinch < 0.15
      if (thawed ||Math.hypot(moved.x, moved.y) > this.o.freezeBreak) {
        this.blend = { dx: this.freeze.at.x - target.x, dy: this.freeze.at.y - target.y, t }
        if (!thawed) this.freezeVeto = true
        this.freeze = null
        this.thawAt = 0
      } else {
        this.cursor = this.freeze.at
        return
      }
    }
    // start a freeze: the fingers are closing (fast), or are already well on the way
    if (pinch < 0.15) this.freezeVeto = false
    const ago = this.recent.find((r) => t - r.t <= 160)
    const closing = ago ? pinch - ago.pinch >= 0.15 : false
    if (!p && !this.freezeVeto && tr.pose !== 'fist' && ((pinch >= this.o.freezeFrom && closing) || pinch >= this.o.freezeHard)) {
      // rewind to where the cursor was before the fingers began to move
      let at = prev ?? target
      for (let k = this.recent.length - 1; k >= 0; k--) {
        if (t - this.recent[k].t > 350) break
        if (this.recent[k].pinch < 0.12) {
          at = this.recent[k].cursor
          break
        }
      }
      this.freeze = { at, palm: f.palm, knuckle: f.knuckle }
      this.thawAt = 0
      this.blend = null
      this.cursor = at
      return
    }

    const k = this.blend ? 1 - (t - this.blend.t) / 250 : 0
    if (this.blend && k <= 0) this.blend = null
    const goal = this.blend ? { x: clamp01(target.x + this.blend.dx * k), y: clamp01(target.y + this.blend.dy * k) } : target
    if (!prev || this.blend) {
      this.cursor = goal
      return
    }
    // dead zone (rubber band): the cursor moves only by the part of the movement beyond the zone
    const edge = Math.min(goal.x, 1 - goal.x, goal.y, 1 - goal.y) < 0.04
    const dz = this.o.deadZone * (edge ? 2 : 1)
    const dx = goal.x - prev.x
    const dy = goal.y - prev.y
    const d = Math.hypot(dx, dy)
    if (d <= dz) this.cursor = prev
    else this.cursor = { x: prev.x + (dx * (d - dz)) / d, y: prev.y + (dy * (d - dz)) / d }
  }

  private cancelPress(ev: GestureEvent[]) {
    const p = this.press
    if (!p) return
    this.press = null
    this.freeze = null
    if (p.mode !== 'none') ev.push({ type: 'dragend', ...p.last, cancelled: true })
    ev.push({ type: 'release', ...p.last })
  }

  private endZoom(ev: GestureEvent[]) {
    if (!this.zoom) return
    this.zoom = null
    ev.push({ type: 'zoomend' })
  }
}
