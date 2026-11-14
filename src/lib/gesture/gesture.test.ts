import { describe, expect, it } from 'vitest'
import { classify, features, pinchProgress, POSE_TH, PoseDebouncer, sideOf } from './classify'
import { GesturePipeline, type GestureEvent, type GestureState, type RawFrame } from './machine'
import { OneEuro } from './oneEuro'
import { seeded, synthHand, type SynthOptions } from './synth'

const FPS = 30
const STEP = 1000 / FPS

type Hands = SynthOptions[] | null
type Timeline = { events: (GestureEvent & { t: number })[]; states: GestureState[]; t: number }

function frame(t: number, hands: Hands, aspect = 4 / 3): RawFrame {
  return { t, aspect, hands: (hands ?? []).map((h) => ({ landmarks: synthHand({ aspect, ...h }), handedness: 'Left', score: 0.95 })) }
}

/** Feeds `ms` of frames at 30 fps; `at(k, n)` gives the hands for frame k of n. */
function play(p: GesturePipeline, tl: Timeline, ms: number, at: (k: number, n: number) => Hands) {
  const n = Math.max(1, Math.round(ms / STEP))
  for (let k = 0; k < n; k++) {
    tl.t += STEP
    const out = p.push(frame(tl.t, at(k, n)))
    tl.states.push(out.state)
    for (const e of out.events) tl.events.push({ ...e, t: tl.t })
  }
  return tl
}
const timeline = (): Timeline => ({ events: [], states: [], t: 1000 })
const types = (tl: Timeline) => tl.events.map((e) => e.type)
const count = (tl: Timeline, type: GestureEvent['type']) => tl.events.filter((e) => e.type === type).length
const hold = (h: SynthOptions) => () => [h]

describe('pose classifier', () => {
  const poses = ['open', 'fist', 'point', 'pinch'] as const
  for (const pose of poses) {
    it(`recognises ${pose} at any distance, roll and side`, () => {
      for (const size of [0.07, 0.18, 0.4])
        for (const roll of [-30, 0, 30])
          for (const side of ['left', 'right'] as const) {
            const f = features(synthHand({ pose, size, roll, side }))
            expect(classify(f, false), `${pose} size ${size} roll ${roll} ${side}`).toBe(pose)
          }
    })
  }

  it('normalises by hand size: the pinch ratio does not depend on the distance to the camera', () => {
    const near = features(synthHand({ pose: 'open', pinch: 0.5, size: 0.4 }))
    const far = features(synthHand({ pose: 'open', pinch: 0.5, size: 0.08 }))
    expect(Math.abs(near.pinch - far.pinch)).toBeLessThan(0.01)
    expect(near.scale / far.scale).toBeCloseTo(5, 1)
  })

  it('handles a non-square camera picture (aspect ratio)', () => {
    for (const aspect of [4 / 3, 16 / 9, 1]) {
      expect(classify(features(synthHand({ pose: 'pinch', aspect }), aspect), false)).toBe('pinch')
      expect(classify(features(synthHand({ pose: 'open', aspect }), aspect), false)).toBe('open')
    }
  })

  it('a pinch with the other fingers curled is still a pinch, not a fist', () => {
    expect(classify(features(synthHand({ pose: 'pinch', others: 'curled' })), false)).toBe('pinch')
    expect(classify(features(synthHand({ pose: 'pinch', others: 'relaxed' })), false)).toBe('pinch')
  })

  it('pinch has hysteresis: between the thresholds it keeps its previous state', () => {
    const f = features(synthHand({ pose: 'open', pinch: 0.69 }))
    expect(f.pinch).toBeGreaterThan(POSE_TH.pinchPress)
    expect(f.pinch).toBeLessThan(POSE_TH.pinchRelease)
    expect(classify(f, true)).toBe('pinch')
    expect(classify(f, false)).not.toBe('pinch')
  })

  it('pinch progress runs from 0 (apart) to 1 (pinched)', () => {
    expect(pinchProgress(features(synthHand({ pose: 'open' })))).toBe(0)
    expect(pinchProgress(features(synthHand({ pose: 'pinch' })))).toBe(1)
    const mid = pinchProgress(features(synthHand({ pose: 'open', pinch: 0.5 })))
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.8)
  })

  it('maps handedness for raw and mirrored pictures', () => {
    expect(sideOf('Left', false)).toBe('right')
    expect(sideOf('Right', false)).toBe('left')
    expect(sideOf('Left', true)).toBe('left')
    expect(sideOf(undefined, false)).toBeNull()
    expect(sideOf('?', true)).toBeNull()
  })

  it('debounces: a pose must persist before it counts', () => {
    const d = new PoseDebouncer(2)
    expect(d.push('pinch').pose).toBe('none')
    expect(d.push('open').pose).toBe('none')
    expect(d.push('open').pose).toBe('open')
    expect(d.push('pinch').changed).toBe(false)
    expect(d.push('pinch').changed).toBe(true)
  })
})

describe('one euro filter', () => {
  it('removes jitter from a still signal and follows a fast one', () => {
    const rng = seeded(7)
    const f = new OneEuro()
    const input: number[] = []
    const out: number[] = []
    for (let k = 0; k < 120; k++) {
      input.push(0.5 + (rng() - 0.5) * 0.01)
      out.push(f.filter(input[k], k * STEP))
    }
    const sd = (xs: number[]) => {
      const m = xs.reduce((s, x) => s + x, 0) / xs.length
      return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length)
    }
    expect(sd(out.slice(30))).toBeLessThan(0.45 * sd(input.slice(30)))
    const g = new OneEuro()
    let v = 0
    for (let k = 0; k <= 15; k++) v = g.filter(k / 15, k * STEP) // 0 -> 1 in half a second
    expect(v).toBeGreaterThan(0.85)
  })
})

describe('interaction state machine', () => {
  const OPEN: SynthOptions = { pose: 'open', x: 0.5, y: 0.45 }
  const PINCH: SynthOptions = { pose: 'pinch', x: 0.5, y: 0.45 }

  it('mirrors the picture: a hand on the left of the raw frame puts the cursor on the right of the screen', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 300, hold({ pose: 'point', x: 0.3, y: 0.5 }))
    expect(tl.states.at(-1)!.cursor!.x).toBeGreaterThan(0.6)
    const back = p.fromScreen(p.toScreen({ x: 0.42, y: 0.4 }))
    expect(back.x).toBeCloseTo(0.42, 6)
    expect(back.y).toBeCloseTo(0.4, 6)
  })

  it('announces a hand once, then idles after the timeout', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 300, hold(OPEN))
    expect(count(tl, 'found')).toBe(1)
    play(p, tl, 3000, () => null)
    expect(count(tl, 'idle')).toBe(1)
    expect(tl.states.at(-1)!.present).toBe(false)
    expect(tl.states.at(-1)!.quality).toBe('no-hand')
    play(p, tl, 200, hold(OPEN))
    expect(count(tl, 'found')).toBe(2)
  })

  it('a quick pinch is an air-tap at the spot the cursor was on before the fingers closed', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 500, hold(OPEN))
    const before = tl.states.at(-1)!.cursor!
    // fingers close over ~100 ms, stay closed ~130 ms, open again
    play(p, tl, 100, (k, n) => [{ ...OPEN, pinch: (k + 1) / n }])
    play(p, tl, 130, hold(PINCH))
    play(p, tl, 300, hold(OPEN))
    expect(types(tl)).toContain('tap')
    expect(count(tl, 'tap')).toBe(1)
    expect(count(tl, 'dragstart')).toBe(0)
    const tap = tl.events.find((e) => e.type === 'tap') as { x: number; y: number }
    expect(Math.hypot(tap.x - before.x, tap.y - before.y)).toBeLessThan(0.02)
  })

  it('a pinch that moves is a drag, not a tap', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 400, hold(OPEN))
    play(p, tl, 150, hold(PINCH))
    play(p, tl, 400, (k, n) => [{ ...PINCH, x: 0.5 - (0.15 * (k + 1)) / n }])
    play(p, tl, 300, hold(OPEN))
    expect(count(tl, 'dragstart')).toBe(1)
    expect(count(tl, 'dragend')).toBe(1)
    expect(count(tl, 'tap')).toBe(0)
    const dx = tl.events.filter((e) => e.type === 'drag').reduce((s, e) => s + (e as { dx: number }).dx, 0)
    expect(dx).toBeGreaterThan(0.1) // raw x went down = the hand moved to the person's right = cursor moves right
  })

  it('a pinch held still is a hold (deliberate confirm), and its release is not also a tap', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 400, hold(OPEN))
    play(p, tl, 1200, hold(PINCH))
    const mid = tl.states.at(-1)!
    play(p, tl, 300, hold(OPEN))
    expect(count(tl, 'hold')).toBe(1)
    expect(count(tl, 'tap')).toBe(0)
    expect(mid.hold).toBe(1)
    const pressAt = tl.events.find((e) => e.type === 'press')!.t
    const holdAt = tl.events.find((e) => e.type === 'hold')!.t
    expect(holdAt - pressAt).toBeGreaterThanOrEqual(900)
  })

  it('pushing a pinched hand towards the camera reports a push/pull zoom', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 400, hold(OPEN))
    play(p, tl, 150, hold(PINCH))
    play(p, tl, 500, (k, n) => [{ ...PINCH, size: 0.18 + (0.07 * (k + 1)) / n }])
    play(p, tl, 300, hold(OPEN))
    const total = tl.events.filter((e) => e.type === 'depth').reduce((s, e) => s * (e as { factor: number }).factor, 1)
    expect(total).toBeGreaterThan(1.15)
    expect(count(tl, 'tap')).toBe(0)
    expect(count(tl, 'drag')).toBe(0)
  })

  it('a sideways drag that also changes the hand size a little stays a drag (no accidental zoom)', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 400, hold(OPEN))
    play(p, tl, 150, hold(PINCH))
    play(p, tl, 400, (k, n) => [{ ...PINCH, x: 0.5 - (0.15 * (k + 1)) / n, size: 0.18 + (0.03 * (k + 1)) / n }])
    play(p, tl, 300, hold(OPEN))
    expect(count(tl, 'dragstart')).toBe(1)
    expect(count(tl, 'depth')).toBe(0)
  })

  it('two hands pinching and moving apart zoom in; together zoom out', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 400, () => [{ ...OPEN, x: 0.62 }, { ...OPEN, x: 0.38, side: 'left' }])
    play(p, tl, 200, () => [{ ...PINCH, x: 0.62 }, { ...PINCH, x: 0.38, side: 'left' }])
    const start = tl.events.length
    play(p, tl, 400, (k, n) => {
      const s = (0.12 * (k + 1)) / n
      return [{ ...PINCH, x: 0.62 + s }, { ...PINCH, x: 0.38 - s, side: 'left' }]
    })
    const spread = tl.events.slice(start).filter((e) => e.type === 'zoom').reduce((s, e) => s * (e as { factor: number }).factor, 1)
    expect(spread).toBeGreaterThan(1.5)
    const mid = tl.events.length
    play(p, tl, 400, (k, n) => {
      const s = 0.12 - (0.2 * (k + 1)) / n
      return [{ ...PINCH, x: 0.62 + s }, { ...PINCH, x: 0.38 - s, side: 'left' }]
    })
    const closed = tl.events.slice(mid).filter((e) => e.type === 'zoom').reduce((s, e) => s * (e as { factor: number }).factor, 1)
    expect(closed).toBeLessThan(0.6)
    play(p, tl, 300, () => [{ ...OPEN, x: 0.62 }, { ...OPEN, x: 0.38, side: 'left' }])
    expect(count(tl, 'zoomstart')).toBe(1)
    expect(count(tl, 'zoomend')).toBe(1)
    expect(count(tl, 'tap')).toBe(0)
    expect(count(tl, 'hold')).toBe(0)
  })

  it('after a two-hand zoom the hand still pinching must open before it can press again', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 300, () => [{ ...OPEN, x: 0.62 }, { ...OPEN, x: 0.38, side: 'left' }])
    play(p, tl, 300, () => [{ ...PINCH, x: 0.62 }, { ...PINCH, x: 0.38, side: 'left' }])
    play(p, tl, 1500, () => [{ ...PINCH, x: 0.62 }, { ...OPEN, x: 0.38, side: 'left' }])
    expect(count(tl, 'press')).toBe(0)
    expect(count(tl, 'hold')).toBe(0)
  })

  it('a fist held for 0.7 s fires once; a brief fist does nothing', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 300, hold(OPEN))
    play(p, tl, 300, hold({ ...OPEN, pose: 'fist' }))
    play(p, tl, 300, hold(OPEN))
    expect(count(tl, 'fist')).toBe(0)
    play(p, tl, 1500, hold({ ...OPEN, pose: 'fist' }))
    expect(count(tl, 'fist')).toBe(1)
    expect(tl.states.at(-1)!.fist).toBe(1)
  })

  it('rejects noise: a jittery still hand produces no gestures and a steady cursor', () => {
    const rng = seeded(42)
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 3000, () => [{ ...OPEN, noise: 0.004, rng }])
    expect(types(tl).filter((t) => t !== 'found')).toEqual([])
    const xs = tl.states.slice(30).map((s) => s.cursor!.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.02)
  })

  it('rejects noise near the pinch threshold: no false press, and an established pinch does not flicker', () => {
    const rng = seeded(3)
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 2500, hold(OPEN)) // the hand calibrates its pinch thresholds
    play(p, tl, 2000, () => [{ ...OPEN, pinch: 0.62, noise: 0.002, rng }])

    expect(count(tl, 'press')).toBe(0)
    play(p, tl, 200, hold(PINCH))
    play(p, tl, 2000, () => [{ ...OPEN, pinch: 0.62, noise: 0.002, rng }])
    expect(count(tl, 'press')).toBe(1)
    expect(count(tl, 'release')).toBe(0)
  })

  it('ignores a single-frame pinch glitch', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 400, hold(OPEN))
    play(p, tl, STEP, hold(PINCH))
    play(p, tl, 400, hold(OPEN))
    expect(count(tl, 'press')).toBe(0)
    expect(count(tl, 'tap')).toBe(0)
  })

  it('keeps a drag alive through a dropped detection frame', () => {
    const p = new GesturePipeline()
    const tl = play(p, timeline(), 400, hold(OPEN))
    play(p, tl, 150, hold(PINCH))
    play(p, tl, 200, (k, n) => [{ ...PINCH, x: 0.5 - (0.08 * (k + 1)) / n }])
    play(p, tl, STEP, () => null)
    play(p, tl, 200, (k, n) => [{ ...PINCH, x: 0.42 - (0.08 * (k + 1)) / n }])
    play(p, tl, 200, hold(OPEN))
    expect(count(tl, 'dragstart')).toBe(1)
    expect(count(tl, 'dragend')).toBe(1)
    expect(tl.events.find((e) => e.type === 'dragend')).toMatchObject({ cancelled: false })
  })

  it('ignores hands the model is unsure about and reports low confidence', () => {
    const p = new GesturePipeline()
    const out = p.push({ t: 10, hands: [{ landmarks: synthHand({ pose: 'open' }), score: 0.2 }] })
    expect(out.state.present).toBe(false)
    expect(out.state.quality).toBe('low-confidence')
  })

  it('reports a hand that is too far away or at the edge of the picture', () => {
    const far = new GesturePipeline()
    expect(play(far, timeline(), 200, hold({ ...OPEN, size: 0.05 })).states.at(-1)!.quality).toBe('far')
    const edge = new GesturePipeline()
    expect(play(edge, timeline(), 200, hold({ ...OPEN, x: 0.02 })).states.at(-1)!.quality).toBe('edge')
  })
})
