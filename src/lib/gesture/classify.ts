// Hand pose from the 21 hand landmarks (MediaPipe order). Pure: no DOM, no MediaPipe types.
//
// Landmarks are normalised image coordinates (x by the frame width, y by the height, z a relative depth on
// roughly the scale of x). Every distance is measured in frame-height units with x and z multiplied by the
// aspect ratio, then divided by the palm size, so the thresholds hold at any distance from the camera.

export type Pt = { x: number; y: number; z: number }
export type Pose = 'open' | 'fist' | 'point' | 'pinch' | 'none'
export type HandSide = 'left' | 'right'

export const LM = { WRIST: 0, THUMB_TIP: 4, INDEX_MCP: 5, INDEX_TIP: 8, MIDDLE_MCP: 9, RING_MCP: 13, PINKY_MCP: 17 } as const

/** [knuckle (MCP), tip] for index, middle, ring and little finger */
const FINGERS: [number, number][] = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
]

/** Bones of the hand, for drawing the skeleton. */
export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
]

export const POSE_TH = {
  /** thumb–index tip distance / palm size: a pinch starts below `pinchPress` and ends above `pinchRelease` */
  pinchPress: 0.3,
  pinchRelease: 0.46,
  /** ratio of a relaxed open hand: the pinch progress ring starts closing below this */
  pinchOpen: 0.95,
  /** a pinch this tight wins over a fist (the thumb is on the index tip, not wrapped around the fingers) */
  pinchTight: 0.2,
  /** finger extension: (|wrist→tip| − |wrist→knuckle|) / palm size */
  extended: 0.42,
  curled: 0.15,
  /** an index tip folded further than this into the palm is a fist, not a pinch */
  pinchIndexMin: 0,
}
export type PoseThresholds = typeof POSE_TH

export type Features = {
  /** palm size in frame-height units */
  scale: number
  /** thumb–index tip distance / palm size */
  pinch: number
  /** extension of index, middle, ring and little finger */
  ext: [number, number, number, number]
  /** raw image coordinates (not mirrored) */
  palm: { x: number; y: number }
  knuckle: { x: number; y: number }
  tip: { x: number; y: number }
  pinchPt: { x: number; y: number }
}

export function features(lm: Pt[], aspect = 4 / 3): Features {
  const d = (a: number, b: number) => {
    const p = lm[a]
    const q = lm[b]
    return Math.hypot((p.x - q.x) * aspect, p.y - q.y, (p.z - q.z) * aspect)
  }
  const scale = Math.max(1e-4, (d(0, 5) + d(0, 9) + d(0, 17)) / 3)
  const ext = FINGERS.map(([mcp, tip]) => (d(0, tip) - d(0, mcp)) / scale) as Features['ext']
  const avg = (ids: number[]) => ({ x: ids.reduce((s, i) => s + lm[i].x, 0) / ids.length, y: ids.reduce((s, i) => s + lm[i].y, 0) / ids.length })
  return {
    scale,
    pinch: d(4, 8) / scale,
    ext,
    palm: avg([0, 5, 9, 13, 17]),
    knuckle: { x: lm[5].x, y: lm[5].y },
    tip: { x: lm[8].x, y: lm[8].y },
    pinchPt: avg([4, 8]),
  }
}

/**
 * Instantaneous pose. `wasPinching` gives the pinch its hysteresis: once pinched, the fingers must open past
 * `pinchRelease` (not just `pinchPress`) before the pinch ends, so a ratio hovering near one threshold cannot flicker.
 */
export function classify(f: Features, wasPinching: boolean, th: PoseThresholds = POSE_TH): Pose {
  const curled = f.ext.map((e) => e < th.curled)
  const ext = f.ext.map((e) => e > th.extended)
  if (curled.every(Boolean) && f.pinch > th.pinchTight) return 'fist'
  const pinching = f.pinch < (wasPinching ? th.pinchRelease : th.pinchPress)
  if (pinching && f.ext[0] > th.pinchIndexMin) return 'pinch'
  if (pinching && f.pinch <= th.pinchTight) return 'pinch'
  if (ext.every(Boolean)) return 'open'
  if (ext[0] && curled[1] && curled[2] && curled[3]) return 'point'
  return 'none'
}

/** 0 = fingers apart, 1 = pinched. Drives the closing ring around the cursor. */
export function pinchProgress(f: Features, th: PoseThresholds = POSE_TH): number {
  return Math.min(1, Math.max(0, (th.pinchOpen - f.pinch) / (th.pinchOpen - th.pinchPress)))
}

/**
 * MediaPipe's handedness label assumes a mirrored (selfie) picture. For a raw webcam frame it therefore names
 * the other hand. `inputMirrored`: the frames given to the model were already flipped horizontally.
 */
export function sideOf(label: string | null | undefined, inputMirrored: boolean): HandSide | null {
  const l = (label ?? '').trim().toLowerCase()
  const side: HandSide | null = l.startsWith('l') ? 'left' : l.startsWith('r') ? 'right' : null
  if (!side || inputMirrored) return side
  return side === 'left' ? 'right' : 'left'
}

/** Stable pose: a new pose must be seen for `frames` consecutive frames before it replaces the current one. */
export class PoseDebouncer {
  pose: Pose = 'none'
  private cand: Pose = 'none'
  private n = 0
  frames: number
  constructor(frames = 2) {
    this.frames = frames
  }
  push(raw: Pose): { pose: Pose; changed: boolean } {
    if (raw === this.cand) this.n++
    else {
      this.cand = raw
      this.n = 1
    }
    if (this.n >= this.frames && this.cand !== this.pose) {
      this.pose = this.cand
      return { pose: this.pose, changed: true }
    }
    return { pose: this.pose, changed: false }
  }
}

/**
 * Per-hand pinch thresholds, learned while the hand is tracked instead of fixed constants.
 *
 * The pinch ratio (thumb–index distance / palm size) already ignores the distance to the camera, but people
 * differ: a relaxed open hand may hold the thumb close to the index (open ratio ~0.7) or far from it (~1.5),
 * and a "touching" pinch reads as anything from ~0.05 to ~0.4 depending on finger thickness and landmark noise.
 *  - `open`: learned in the first `learnMs` of tracking from the hand at rest (robust upper quartile), then
 *    follows slowly.
 *  - `closed`: follows the tightest ratio seen while pinching; a "near miss" (the fingers clearly closed but
 *    stopped just short of the press threshold) moves it up, so a hand that cannot get lower is accepted after
 *    a try or two.
 * Press / release / ring-start thresholds are then placed between the two, with a hysteresis gap that scales
 * with the hand's own range.
 */
export const CALIB = {
  learnMs: 2000,
  /** defaults before anything is learned */
  open: 1.15,
  closed: 0.1,
  /** where the thresholds sit between closed (0) and open (1) */
  pressAt: 0.25,
  releaseAt: 0.42,
  ringAt: 0.8,
  /** smallest hysteresis gap between press and release, in ratio units */
  minGap: 0.1,
  /** a near miss counts when its lowest ratio is at most this far above the press threshold */
  nearMiss: 0.16,
}

export class PinchCalibrator {
  open = CALIB.open
  closed = CALIB.closed
  learned = false
  private t0: number | null = null
  private samples: number[] = []
  /** lowest ratio of the current closing movement (for near misses) */
  private dip: number | null = null
  th: PoseThresholds

  constructor(private base: PoseThresholds = POSE_TH) {
    this.th = this.compute()
  }

  private compute(): PoseThresholds {
    const span = Math.max(0.4, this.open - this.closed)
    const press = Math.min(0.55, Math.max(0.2, this.closed + CALIB.pressAt * span))
    const release = Math.min(0.75, Math.max(press + CALIB.minGap, this.closed + CALIB.releaseAt * span))
    const ring = Math.min(1.6, Math.max(release + 0.12, this.closed + CALIB.ringAt * span))
    return { ...this.base, pinchPress: press, pinchRelease: release, pinchOpen: ring }
  }

  /** Feed one frame of this hand: its pinch ratio, whether it is pinched now, and whether it looks like an open/pointing hand at rest. */
  update(ratio: number, pinching: boolean, atRest: boolean, t: number): PoseThresholds {
    if (this.t0 === null) this.t0 = t
    if (!this.learned) {
      if (atRest && !pinching && ratio > 0.45) this.samples.push(ratio)
      if (t - this.t0 >= CALIB.learnMs && this.samples.length >= 6) {
        const s = [...this.samples].sort((a, b) => a - b)
        this.open = s[Math.floor(s.length * 0.75)]
        this.learned = true
        this.samples = []
      }
    } else if (atRest && !pinching && ratio > this.open * 0.8) {
      this.open += 0.02 * (ratio - this.open)
    }
    if (pinching) {
      if (ratio < this.closed + 0.12) this.closed += 0.12 * (ratio - this.closed)
      this.dip = null
    } else {
      const th = this.th
      if (ratio < th.pinchOpen * 0.85) this.dip = this.dip === null ? ratio : Math.min(this.dip, ratio)
      // the fingers opened again after a dip that stopped just short of the press threshold: a near miss
      if (this.dip !== null && ratio > this.dip + 0.18) {
        if (this.dip > th.pinchPress && this.dip <= th.pinchPress + CALIB.nearMiss) this.closed += 0.45 * (this.dip - this.closed)
        this.dip = null
      }
    }
    this.closed = Math.min(0.38, Math.max(0.02, this.closed))
    this.open = Math.min(2.2, Math.max(this.closed + 0.4, this.open))
    this.th = this.compute()
    return this.th
  }
}
