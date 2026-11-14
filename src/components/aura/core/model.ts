// Pure logic of the AURA core: which state it is in, what each state looks like (pose table), what it says,
// how fast it may draw, and the view maths. No DOM and no three.js: the WebGL scene, the flat SVG fallback and
// the unit tests all read from here, so the three can never disagree about a state.
import type { VoicePhase, VoicePresence } from '../../../lib/voice/presence'

/** `off` = voice cannot be used here; `urgent` wins over every phase. */
export type CoreState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'urgent' | 'off'

/** Colour roles, resolved from the app's CSS variables (accent follows the profile; crit only for urgent). */
export type Tone = 'accent' | 'edge' | 'dim' | 'soft' | 'ink' | 'crit'

/** What the page itself knows (the consultation's own dictation and its result), merged with the voice store. */
export type LocalHints = { listening?: boolean; urgent?: boolean }

export type CoreInput = Pick<VoicePresence, 'available' | 'phase' | 'urgent'>

export function effectivePhase(phase: VoicePhase, local?: LocalHints): VoicePhase {
  return phase === 'idle' && local?.listening ? 'listening' : phase
}

export function coreState(p: CoreInput, local?: LocalHints): CoreState {
  if (p.urgent || local?.urgent) return 'urgent' // an emergency is shown even when voice itself is unavailable
  if (!p.available) return 'off'
  return effectivePhase(p.phase, local)
}

// ---------------------------------------------------------------------------------------------------------
// Pose table. Angles in radians, lengths in scene units (the fixed tick ring has radius 1.5).
// A ring lies in the XY plane (facing the viewer) before `tilt` (about X) and `roll` (about Z) are applied.

/**
 * With a = the angle the motion has accumulated (0 under reduced motion), the ring's orientation is
 * still: Rz(roll)·Rx(tilt) · precess: Ry(a)·Rz(roll)·Rx(tilt) · gimbalX: Rz(roll)·Rx(tilt + a) · gimbalY: Rz(roll)·Ry(tilt + a)
 */
export type RingMotion = 'still' | 'precess' | 'gimbalX' | 'gimbalY'

export type RingPose = {
  radius: number
  tilt: number
  roll: number
  tone: Tone
  opacity: number
  /** line width in CSS pixels */
  width: number
  motion: RingMotion
  /** rad/s for `motion` */
  rate: number
  /** how much of the (delayed) voice level becomes extra radius */
  react: number
  dashed: boolean
}

export type Pose = {
  rings: [RingPose, RingPose, RingPose]
  shell: { radius: number; tone: Tone; points: number; edges: number; /** px */ size: number; react: number; jitter: number; /** rad/s */ drift: number }
  nucleus: { radius: number; dot: number; fill: number; tone: Tone; react: number; breathe: number }
  /** 0..1 visibility of the octagon frame (the app's urgent shape) and of the travelling work arc */
  octagon: number
  arc: number
}

const deg = (d: number) => (d * Math.PI) / 180
const TURN = Math.PI * 2
const ring = (radius: number, tilt: number, roll: number, tone: Tone, more: Partial<RingPose> = {}): RingPose => ({
  radius,
  tilt: deg(tilt),
  roll: deg(roll),
  tone,
  opacity: 1,
  width: tone === 'accent' || tone === 'crit' ? 1.75 : 1.25,
  motion: 'still',
  rate: 0,
  react: 0,
  dashed: false,
  ...more,
})

/** Order of the rings everywhere: A (the live one), B, C (the outer one; it carries the work arc). */
export const POSES: Record<CoreState, Pose> = {
  // three rings at three tilts, each drifting once in 70 to 120 s; the nucleus breathes
  idle: {
    rings: [
      ring(1.28, 70, -24, 'accent', { motion: 'precess', rate: TURN / 70 }),
      ring(1.18, 53.6, 38, 'dim', { motion: 'precess', rate: -TURN / 90 }),
      ring(1.38, 81, 9, 'edge', { motion: 'precess', rate: TURN / 120 }),
    ],
    shell: { radius: 0.9, tone: 'soft', points: 0.95, edges: 0.5, size: 2.6, react: 0, jitter: 0.012, drift: 0.035 },
    nucleus: { radius: 0.28, dot: 0.09, fill: 0.14, tone: 'accent', react: 0, breathe: 0.04 },
    octagon: 0,
    arc: 0,
  },
  // rings open flat toward the viewer; the lattice and the inner ring follow the microphone
  listening: {
    rings: [
      ring(1.22, 0, 0, 'accent', { react: 0.03 }),
      ring(1.06, 0, 0, 'accent', { opacity: 0.7, width: 1.25, react: 0.08 }),
      ring(1.38, 0, 0, 'edge'),
    ],
    shell: { radius: 0.92, tone: 'ink', points: 1, edges: 0.55, size: 3, react: 0.16, jitter: 0.006, drift: 0 },
    nucleus: { radius: 0.26, dot: 0.04, fill: 0, tone: 'accent', react: 0.1, breathe: 0 },
    octagon: 0,
    arc: 0,
  },
  // gimbals at right angles turning steadily; a short arc travels round the outer ring
  thinking: {
    rings: [
      ring(1.32, 74, 0, 'dim', { motion: 'gimbalX', rate: 0.9 }),
      ring(1.32, 74, 0, 'dim', { motion: 'gimbalY', rate: -0.7 }),
      ring(1.32, 0, 0, 'edge'),
    ],
    shell: { radius: 0.72, tone: 'dim', points: 0.9, edges: 0.45, size: 2.4, react: 0, jitter: 0.004, drift: 0.3 },
    nucleus: { radius: 0.2, dot: 0.06, fill: 0.14, tone: 'accent', react: 0, breathe: 0 },
    octagon: 0,
    arc: 1,
  },
  // rings level and nested like ripples; the nucleus swells with speech, the rings follow outward
  speaking: {
    rings: [
      ring(1.14, 69, -8, 'accent', { opacity: 0.75, width: 1.25, react: 0.05 }),
      ring(0.88, 69, -8, 'accent', { react: 0.07 }),
      ring(1.4, 69, -8, 'edge', { react: 0.03 }),
    ],
    shell: { radius: 0.86, tone: 'soft', points: 0.9, edges: 0.4, size: 2.6, react: 0.04, jitter: 0.008, drift: 0.035 },
    nucleus: { radius: 0.36, dot: 0.14, fill: 0.22, tone: 'accent', react: 0.22, breathe: 0 },
    octagon: 0,
    arc: 0,
  },
  // the octagon frame locks round the core; rings square up; red replaces the accent
  urgent: {
    rings: [ring(1.16, 0, 0, 'edge'), ring(0.98, 0, 0, 'edge'), ring(1.38, 0, 0, 'crit', { opacity: 0 })],
    shell: { radius: 0.78, tone: 'dim', points: 0.6, edges: 0.3, size: 2.4, react: 0.02, jitter: 0, drift: 0 },
    nucleus: { radius: 0.3, dot: 0.11, fill: 0.2, tone: 'crit', react: 0.11, breathe: 0 },
    octagon: 1,
    arc: 0,
  },
  // parked: rings edge-on and dashed, nucleus hollow, no accent anywhere, nothing moves
  off: {
    rings: [
      ring(1.18, 86, 0, 'edge', { dashed: true }),
      ring(0.98, 86, 0, 'edge', { dashed: true }),
      ring(1.38, 86, 0, 'edge', { dashed: true }),
    ],
    shell: { radius: 0.86, tone: 'edge', points: 0.45, edges: 0, size: 2.4, react: 0, jitter: 0, drift: 0 },
    nucleus: { radius: 0.24, dot: 0, fill: 0, tone: 'edge', react: 0, breathe: 0 },
    octagon: 0,
    arc: 0,
  },
}

/** Scene constants shared with the fallback drawing. */
export const TICK_RADIUS = 1.5
export const OCTAGON_RADIUS = 1.38
/** seconds for the work arc to travel once round the outer ring */
export const ARC_PERIOD = 2.4
/** time constant (s) of the swing between two poses: settled in about 400 ms */
export const POSE_TAU = 0.11

// ---------------------------------------------------------------------------------------------------------
// Motion helpers

/** One-pole follower with separate rise and fall times (seconds): fast attack, slow release for voice levels. */
export function follow(current: number, target: number, dt: number, attack: number, release = attack): number {
  const tau = target > current ? attack : release
  if (tau <= 0 || dt <= 0) return dt <= 0 ? current : target
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}

/** The urgent state announces itself with three slow pulses (one second each), then holds still. 0..1. */
export const URGENT_PULSES = 3
export function urgentPulse(secondsSinceUrgent: number): number {
  if (secondsSinceUrgent <= 0 || secondsSinceUrgent >= URGENT_PULSES) return 0
  const s = Math.sin(Math.PI * secondsSinceUrgent)
  return s * s
}

export type Pace = {
  state: CoreState
  /** a voice level is being fed (listening or speaking), also during an urgent reply */
  live: boolean
  reduced: boolean
  /** camera hand control is on: detection shares the device */
  lowPower: boolean
  /** a pose swing, a view change or the urgent pulses are still in progress */
  moving: boolean
  /** current smoothed voice level 0..1 */
  level: number
}

/**
 * Frames per second the scene may draw right now. 0 = draw once and stop until something changes.
 * Fast (60) only while something changes fast: a pose swing, a drag, or a voice level that is actually moving.
 */
export function frameRate(p: Pace): 0 | 30 | 60 {
  const fast = p.lowPower ? 30 : 60
  if (p.reduced) return p.moving ? fast : 0 // near-static: only direct manipulation and pose changes draw
  if (p.moving) return fast
  if (p.state === 'off') return 0
  if (p.state === 'urgent') return p.live ? (p.level > 0.02 ? fast : 30) : 0
  if ((p.state === 'listening' || p.state === 'speaking') && p.level > 0.02) return fast
  return 30
}

// ---------------------------------------------------------------------------------------------------------
// View: the person may turn and zoom the core; the state poses stay recognisable because a new state swings
// the view home again.

export type View = { yaw: number; pitch: number; zoom: number }
export const HOME_VIEW: View = { yaw: 0, pitch: 0, zoom: 1 }
export const PITCH_LIMIT = deg(60)
export const ZOOM_MIN = 0.7
export const ZOOM_MAX = 1.6
/** radians per pixel of drag */
export const ROTATE_PER_PX = 0.008

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function rotateView(v: View, dxPx: number, dyPx: number): View {
  return { ...v, yaw: v.yaw + dxPx * ROTATE_PER_PX, pitch: clamp(v.pitch + dyPx * ROTATE_PER_PX, -PITCH_LIMIT, PITCH_LIMIT) }
}

/** `factor` multiplies the camera distance, as in the body viewer: below 1 comes closer (zoom grows). */
export function zoomView(v: View, factor: number): View {
  if (!(factor > 0) || !Number.isFinite(factor)) return v
  return { ...v, zoom: clamp(v.zoom / factor, ZOOM_MIN, ZOOM_MAX) }
}

/** Yaw is free; bring it to the nearest whole turn so a reset never unwinds several rotations. */
export function homeFor(v: View): View {
  return { yaw: Math.round(v.yaw / TURN) * TURN, pitch: 0, zoom: 1 }
}

export function viewSettled(a: View, b: View): boolean {
  return Math.abs(a.yaw - b.yaw) < 0.002 && Math.abs(a.pitch - b.pitch) < 0.002 && Math.abs(a.zoom - b.zoom) < 0.002
}

// ---------------------------------------------------------------------------------------------------------
// Words. Every state has a label, so nothing depends on colour, motion or sound.

export type CoreText = { label: string; /** main line under the label */ line: string; /** quieter second line */ sub?: string; /** the main line is the person's own words */ quote?: boolean }

export function describe(state: CoreState, p: { phase: VoicePhase; interim: string; caption: string }, compact = false): CoreText {
  const heard = p.interim.trim()
  const said = p.caption.trim()
  switch (state) {
    case 'off':
      return { label: 'Voice is off', line: compact ? 'Type your symptoms below.' : 'Voice does not work in this browser. Type your symptoms instead.' }
    case 'urgent':
      if (p.phase === 'listening') return { label: 'Urgent', line: heard || 'Listening.', quote: !!heard, sub: 'Follow the steps on screen.' }
      return { label: 'Urgent', line: 'Follow the steps on screen.', sub: said || (compact ? undefined : 'I can read them aloud.') }
    case 'listening':
      return { label: 'Listening', line: heard || 'Go ahead, I am listening.', quote: !!heard, sub: said ? `AURA: ${said}` : undefined }
    case 'thinking':
      return { label: 'Working on it', line: heard || 'One moment.', quote: !!heard }
    case 'speaking':
      return { label: 'Speaking', line: said || 'The answer is in the conversation.' }
    case 'idle':
      return { label: 'Ready', line: compact ? 'Tap to talk, or type below.' : 'Tap the core to talk, or type below.', sub: said ? `AURA: ${said}` : undefined }
  }
}
