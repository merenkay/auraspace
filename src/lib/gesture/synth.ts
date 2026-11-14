// Synthetic hands: 21 landmarks in MediaPipe order for a given pose, position, size and noise level.
// Used by the unit tests and by the dev-only frame injector (window.__auraHand). Not a model of real anatomy,
// only close enough that the classifier sees the same relations it sees in real landmarks.
import type { HandSide, Pt } from './classify'

export type SynthPose = 'open' | 'fist' | 'point' | 'pinch' | 'relaxed'

export type SynthOptions = {
  pose: SynthPose
  /** 0 = fingers apart, 1 = touching. Overrides the pinch of `pose` (thumb and index only). */
  pinch?: number
  /** palm centre in raw (unmirrored) image coordinates, 0..1 */
  x?: number
  y?: number
  /** palm length in frame-height units (about 0.18 at arm's length from a laptop camera) */
  size?: number
  aspect?: number
  side?: HandSide
  /** degrees, rotation in the image plane */
  roll?: number
  /** standard deviation of landmark noise, in frame-height units */
  noise?: number
  /** the other fingers while pinching (default: extended, an "OK" sign) */
  others?: 'extended' | 'curled' | 'relaxed'
  rng?: () => number
}

type V3 = [number, number, number]

const MCP: Record<number, V3> = { 5: [0.3, -0.95, 0], 9: [0.08, -1, 0], 13: [-0.13, -0.95, 0], 17: [-0.32, -0.85, 0] }
const SEGMENTS: Record<number, number[]> = { 5: [0.42, 0.25, 0.2], 9: [0.47, 0.29, 0.21], 13: [0.43, 0.27, 0.2], 17: [0.33, 0.2, 0.18] }
const SPLAY: Record<number, number> = { 5: -8, 9: -2, 13: 5, 17: 12 }
const BENDS = { extended: [0, 0, 0], curled: [85, 100, 70], relaxed: [25, 35, 20], pinch: [28, 38, 22] }
const OPEN_THUMB: V3[] = [[0.22, -0.18, -0.05], [0.42, -0.38, -0.08], [0.58, -0.55, -0.1], [0.72, -0.72, -0.12]]
const FIST_THUMB: V3[] = [[0.2, -0.2, -0.08], [0.32, -0.42, -0.2], [0.22, -0.62, -0.32], [0.04, -0.74, -0.36]]

const rad = (d: number) => (d * Math.PI) / 180
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

function finger(mcp: number, bends: number[]): V3[] {
  const out: V3[] = []
  let p = MCP[mcp]
  const s = rad(SPLAY[mcp])
  const bx = Math.sin(s)
  const by = -Math.cos(s)
  let a = 0
  SEGMENTS[mcp].forEach((len, i) => {
    a += rad(bends[i])
    p = [p[0] + bx * Math.cos(a) * len, p[1] + by * Math.cos(a) * len, p[2] - Math.sin(a) * len]
    out.push(p)
  })
  return out
}

/** Small deterministic random generator (mulberry32). */
export function seeded(seed = 1): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function synthHand(o: SynthOptions): Pt[] {
  const { pose, x = 0.5, y = 0.5, size = 0.18, aspect = 4 / 3, side = 'right', roll = 0, noise = 0, rng = Math.random } = o
  const pinch = o.pinch ?? (pose === 'pinch' ? 1 : 0)
  const others = pose === 'fist' ? 'curled' : pose === 'point' ? 'curled' : pose === 'relaxed' ? 'relaxed' : pose === 'pinch' ? (o.others ?? 'extended') : 'extended'
  const indexBends = pose === 'fist' ? BENDS.curled : pose === 'relaxed' ? BENDS.relaxed : BENDS.pinch.map((b) => b * pinch)

  const pts: V3[] = new Array(21)
  pts[0] = [0, 0, 0]
  const index = finger(5, indexBends)
  pts[5] = MCP[5]
  index.forEach((p, i) => (pts[6 + i] = p))
  for (const m of [9, 13, 17]) {
    pts[m] = MCP[m]
    finger(m, BENDS[others]).forEach((p, i) => (pts[m + 1 + i] = p))
  }
  if (pose === 'fist') FIST_THUMB.forEach((p, i) => (pts[1 + i] = p))
  else {
    const target: V3 = [index[2][0] + 0.04, index[2][1] + 0.02, index[2][2]]
    const tip = lerp(OPEN_THUMB[3], target, pinch)
    pts[1] = OPEN_THUMB[0]
    pts[2] = OPEN_THUMB[1]
    pts[3] = lerp(OPEN_THUMB[2], lerp(OPEN_THUMB[1], tip, 0.6), pinch)
    pts[4] = tip
  }

  // mirror for the left hand, roll in the image plane, centre on the palm, scale to the frame
  const r = rad(roll)
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const placed = pts.map(([px, py, pz]): V3 => {
    const hx = side === 'left' ? -px : px
    return [hx * cos - py * sin, hx * sin + py * cos, pz]
  })
  const ids = [0, 5, 9, 13, 17]
  const cx = ids.reduce((s, i) => s + placed[i][0], 0) / ids.length
  const cy = ids.reduce((s, i) => s + placed[i][1], 0) / ids.length
  const gauss = () => (rng() + rng() + rng() + rng() - 2) * 1.7320508
  return placed.map(([px, py, pz]) => ({
    x: x + ((px - cx) * size) / aspect + (noise ? (gauss() * noise) / aspect : 0),
    y: y + (py - cy) * size + (noise ? gauss() * noise : 0),
    z: (pz * size) / aspect + (noise ? (gauss() * noise) / aspect : 0),
  }))
}
