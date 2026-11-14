// Two-hand spread / join and the one -> two hand probing: synthetic landmark sequences at 10, 20 and 30 detections/s.
import { describe, expect, it } from 'vitest'
import { GesturePipeline, type GestureEvent, type RawFrame } from './machine'
import { HandsProbe, SpreadDetector, type SpreadHand } from './spread'
import { seeded, synthHand, type SynthPose } from './synth'

type Two = { a: number | null; b: number | null; pose?: SynthPose; y?: number; noise?: number }
type Run = { p: GesturePipeline; t: number; fps: number; events: (GestureEvent & { t: number })[] }
const rng = seeded(7)
const run = (fps: number, p = new GesturePipeline()): Run => ({ p, t: 1000, fps, events: [] })

/** raw palm x of each hand (null = that hand is not in the picture this frame) */
function frame(t: number, h: Two): RawFrame {
  const hands = []
  const pose = h.pose ?? 'open'
  const y = h.y ?? 0.45
  // the person's right hand is on the left of the raw (unmirrored) picture
  if (h.a !== null) hands.push({ landmarks: synthHand({ pose, x: h.a, y, side: 'right', noise: h.noise, rng }), handedness: 'Left', score: 0.95 })
  if (h.b !== null) hands.push({ landmarks: synthHand({ pose, x: h.b, y, side: 'left', noise: h.noise, rng }), handedness: 'Right', score: 0.95 })
  return { t, aspect: 4 / 3, hands }
}
function play(r: Run, ms: number, at: (f: number) => Two) {
  const step = 1000 / r.fps
  const n = Math.max(1, Math.round(ms / step))
  for (let k = 1; k <= n; k++) {
    r.t += step
    for (const e of r.p.push(frame(r.t, at(k / n))).events) r.events.push({ ...e, t: r.t })
  }
  return r
}
const ease = (f: number) => f * f * (3 - 2 * f)
const lerp = (a: number, b: number, f: number) => a + (b - a) * ease(f)
const of = (r: Run, type: GestureEvent['type']) => r.events.filter((e) => e.type === type)
/** both hands move from (a0, b0) to (a1, b1) */
const move = (r: Run, ms: number, a0: number, b0: number, a1: number, b1: number, extra: Partial<Two> = {}) => play(r, ms, (f) => ({ a: lerp(a0, a1, f), b: lerp(b0, b1, f), ...extra }))
const hold = (r: Run, ms: number, a: number | null, b: number | null, extra: Partial<Two> = {}) => play(r, ms, () => ({ a, b, ...extra }))

// apart: palms ~0.5 picture widths apart (about 3.9 palm sizes); together: 0.16 apart (about 1.2 palm sizes)
const A0 = 0.25
const B0 = 0.75
const AT = 0.42
const BT = 0.58

function spreadOnce(r: Run, o: { holdMs?: number; spreadMs?: number; extra?: Partial<Two> } = {}) {
  move(r, 450, A0, B0, AT, BT, o.extra)
  hold(r, o.holdMs ?? 200, AT, BT, o.extra)
  move(r, o.spreadMs ?? 260, AT, BT, 0.2, 0.8, o.extra)
}

describe('two-hand spread (opens the voice panel)', () => {
  for (const fps of [10, 20, 30]) {
    it(`fires once for together-then-apart, at ${fps} detections/s, and never slaps`, () => {
      const r = run(fps)
      hold(r, 500, A0, B0)
      spreadOnce(r)
      hold(r, 1500, 0.2, 0.8)
      expect(of(r, 'spread')).toHaveLength(1)
      expect(of(r, 'slap')).toHaveLength(0)
      const e = of(r, 'spread')[0] as { x: number; y: number }
      expect(Math.abs(e.x - 0.5)).toBeLessThan(0.1) // between the hands
    })

    it(`does not fire while both hands pinch (that is the 3D zoom), at ${fps} detections/s`, () => {
      const r = run(fps)
      hold(r, 500, A0, B0, { pose: 'pinch' })
      spreadOnce(r, { extra: { pose: 'pinch' } })
      hold(r, 800, 0.2, 0.8, { pose: 'pinch' })
      expect(of(r, 'zoom').length).toBeGreaterThan(0)
      expect(of(r, 'spread')).toHaveLength(0)
    })

    it(`does not fire when the hands only pass each other (slowly or quickly), at ${fps} detections/s`, () => {
      for (const ms of [300, 900]) {
        const r = run(fps)
        hold(r, 500, A0, B0)
        move(r, ms, A0, B0, B0, A0)
        hold(r, 1000, B0, A0)
        expect(of(r, 'spread')).toHaveLength(0)
      }
    })

    it(`does not fire with one hand, at ${fps} detections/s`, () => {
      const r = run(fps)
      hold(r, 400, AT, null)
      play(r, 300, (f) => ({ a: lerp(AT, 0.2, f), b: null }))
      play(r, 300, (f) => ({ a: lerp(0.2, 0.8, f), b: null }))
      hold(r, 600, 0.8, null)
      expect(of(r, 'spread')).toHaveLength(0)
    })

    it(`fires once per gesture: a second spread within the cooldown is ignored, a later one fires, at ${fps} detections/s`, () => {
      const r = run(fps)
      hold(r, 400, A0, B0)
      spreadOnce(r)
      spreadOnce(r) // straight away again
      expect(of(r, 'spread')).toHaveLength(1)
      hold(r, 1500, 0.2, 0.8)
      spreadOnce(r)
      hold(r, 300, 0.2, 0.8)
      expect(of(r, 'spread')).toHaveLength(2)
    })

    it(`tolerates the tracker losing one hand for a moment while the hands touch, at ${fps} detections/s`, () => {
      const r = run(fps)
      hold(r, 400, A0, B0)
      move(r, 450, A0, B0, AT, BT)
      hold(r, 100, AT, BT)
      hold(r, 200, 0.5, null) // merged into one hand in the middle
      hold(r, 60, AT, BT)
      move(r, 260, AT, BT, 0.2, 0.8)
      hold(r, 400, 0.2, 0.8)
      expect(of(r, 'spread')).toHaveLength(1)
    })

    it(`does not fire for a slow pull apart, at ${fps} detections/s`, () => {
      const r = run(fps)
      hold(r, 400, A0, B0)
      move(r, 450, A0, B0, AT, BT)
      hold(r, 200, AT, BT)
      // an even, unhurried movement: about a second from "together" to "apart"
      play(r, 2000, (f) => ({ a: AT + (0.2 - AT) * f, b: BT + (0.8 - BT) * f }))
      hold(r, 400, 0.2, 0.8)
      expect(of(r, 'spread')).toHaveLength(0)
    })
  }

  it('works with landmark noise', () => {
    const r = run(20)
    hold(r, 500, A0, B0, { noise: 0.004 })
    spreadOnce(r, { extra: { noise: 0.004 } })
    hold(r, 800, 0.2, 0.8, { noise: 0.004 })
    expect(of(r, 'spread')).toHaveLength(1)
  })

  it('can be switched off', () => {
    const r = run(20, new GesturePipeline({ twoHand: false }))
    hold(r, 500, A0, B0)
    spreadOnce(r)
    hold(r, 800, 0.2, 0.8)
    expect(of(r, 'spread')).toHaveLength(0)
  })
})

describe('two-hand join (closes the voice panel while it is open)', () => {
  for (const fps of [10, 20, 30]) {
    it(`fires after a quick approach held together, only when asked for, at ${fps} detections/s`, () => {
      const r = run(fps)
      r.p.wantJoin = true
      hold(r, 500, A0, B0)
      move(r, 350, A0, B0, AT, BT)
      hold(r, 500, AT, BT)
      expect(of(r, 'join')).toHaveLength(1)
      // pulling apart right after closing does not open it again (cooldown and re-arm)
      move(r, 260, AT, BT, 0.2, 0.8)
      hold(r, 300, 0.2, 0.8)
      expect(of(r, 'spread')).toHaveLength(0)

      const q = run(fps)
      hold(q, 500, A0, B0)
      move(q, 350, A0, B0, AT, BT)
      hold(q, 500, AT, BT)
      expect(of(q, 'join')).toHaveLength(0)
    })
  }
})

describe('the detector alone', () => {
  const hand = (key: number, x: number, extra: Partial<SpreadHand> = {}): SpreadHand => ({ key, side: key === 1 ? 'right' : 'left', x, y: 0.5, scale: 0.17, open: true, pinch: false, ...extra })
  const feed = (d: SpreadDetector, fps: number, from: number, ms: number, at: (f: number) => SpreadHand[]) => {
    const out: string[] = []
    const n = Math.max(1, Math.round((ms * fps) / 1000))
    for (let k = 1; k <= n; k++) {
      const e = d.push(from + (k * 1000) / fps, at(k / n))
      if (e) out.push(e.type)
    }
    return out
  }
  it('uses times, not frame counts: the same movement fires at 10 and at 30 detections/s', () => {
    for (const fps of [10, 30]) {
      const d = new SpreadDetector()
      const out = [
        ...feed(d, fps, 0, 300, () => [hand(1, 0.5), hand(2, 0.7)]),
        ...feed(d, fps, 300, 250, (f) => [hand(1, 0.5 - 0.3 * f), hand(2, 0.7 + 0.3 * f)]),
      ]
      expect(out).toEqual(['spread'])
    }
  })
  it('a pinch on either hand cancels it', () => {
    const d = new SpreadDetector()
    const out = [
      ...feed(d, 20, 0, 300, () => [hand(1, 0.5), hand(2, 0.7)]),
      ...feed(d, 20, 300, 250, (f) => [hand(1, 0.5 - 0.3 * f, { pinch: f > 0.3 }), hand(2, 0.7 + 0.3 * f)]),
    ]
    expect(out).toEqual([])
  })
})

describe('looking for a second hand (one -> two hand probing)', () => {
  const step = (p: HandsProbe, t: number, s: Partial<{ hands: number; openHand: boolean; forced: boolean; enabled: boolean }>) => p.update(t, { hands: 1, openHand: true, forced: false, enabled: true, ...s })

  it('probes briefly and periodically while an open hand is in view', () => {
    const p = new HandsProbe({ everyMs: 700, probeMs: 250 })
    const modes: number[] = []
    for (let t = 0; t <= 3000; t += 50) modes.push(step(p, t, {}))
    const twoShare = modes.filter((m) => m === 2).length / modes.length
    expect(p.probes).toBeGreaterThanOrEqual(3)
    expect(p.probes).toBeLessThanOrEqual(4)
    expect(twoShare).toBeGreaterThan(0.15)
    expect(twoShare).toBeLessThan(0.35)
  })

  it('does not probe without an open hand, or when switched off', () => {
    const p = new HandsProbe()
    for (let t = 0; t <= 3000; t += 50) expect(step(p, t, { openHand: false })).toBe(1)
    for (let t = 3000; t <= 6000; t += 50) expect(step(p, t, { enabled: false })).toBe(1)
    expect(p.probes).toBe(0)
  })

  it('stays in two-hand mode while both hands are seen, and for a while after', () => {
    const p = new HandsProbe({ keepMs: 2500 })
    expect(step(p, 0, {})).toBe(2) // first probe
    expect(step(p, 100, { hands: 2 })).toBe(2)
    for (let t = 150; t <= 2000; t += 50) expect(step(p, t, { hands: 2 })).toBe(2)
    expect(step(p, 4000, { hands: 1 })).toBe(2) // within keepMs of the last two-hand frame
    expect(step(p, 4600, { hands: 1, openHand: false })).toBe(1)
  })

  it('always looks for two hands when forced (over the 3D body or zooming)', () => {
    const p = new HandsProbe()
    for (let t = 0; t <= 2000; t += 50) expect(step(p, t, { forced: true, openHand: false, enabled: false })).toBe(2)
  })
})
