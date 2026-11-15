// Slap, pinch calibration, cursor freeze, dwell and magnet: synthetic landmark sequences at several frame rates.
import { describe, expect, it } from 'vitest'
import { CALIB, features, PinchCalibrator } from './classify'
import { GesturePipeline, type GestureEvent, type GestureState, type RawFrame } from './machine'
import { SlapDetector, slapStep, slapTab } from './slap'
import { seeded, synthHand, type SynthOptions } from './synth'
import { Dwell, magnetRadius, pickTarget, snapPoint, type Cand, type Rect } from './target'

type Hands = SynthOptions[] | null
type Run = { p: GesturePipeline; t: number; fps: number; events: (GestureEvent & { t: number })[]; states: GestureState[] }

const run = (fps = 30, p = new GesturePipeline()): Run => ({ p, t: 1000, fps, events: [], states: [] })
function frame(t: number, hands: Hands): RawFrame {
  return { t, aspect: 4 / 3, hands: (hands ?? []).map((h) => ({ landmarks: synthHand(h), handedness: 'Left', score: 0.95 })) }
}
/** feeds `ms` of frames at the run's frame rate; `at(f)` gives the hands for progress f in (0, 1] */
function play(r: Run, ms: number, at: (f: number) => Hands) {
  const step = 1000 / r.fps
  const n = Math.max(1, Math.round(ms / step))
  for (let k = 1; k <= n; k++) {
    r.t += step
    const out = r.p.push(frame(r.t, at(k / n)))
    r.states.push(out.state)
    for (const e of out.events) r.events.push({ ...e, t: r.t })
  }
  return r
}
const of = (r: Run, type: GestureEvent['type']) => r.events.filter((e) => e.type === type)
const slaps = (r: Run) => of(r, 'slap').map((e) => (e as { dir: string }).dir)
const ease = (f: number) => f * f * (3 - 2 * f)

const OPEN: SynthOptions = { pose: 'open', x: 0.5, y: 0.45 }
const PINCH: SynthOptions = { pose: 'pinch', x: 0.5, y: 0.45 }
/** a slap: the palm travels from raw x `from` to `to` in `ms`, accelerating and braking like a real arm */
const stroke = (r: Run, from: number, to: number, ms = 220, pose: SynthOptions = OPEN) => play(r, ms, (f) => [{ ...pose, x: from + (to - from) * ease(f) }])
const rest = (r: Run, x: number, ms: number, pose: SynthOptions = OPEN) => play(r, ms, () => [{ ...pose, x }])

describe('slap (page left / right)', () => {
  for (const fps of [12, 20, 30]) {
    it(`fires once in the direction seen in the mirrored preview, at ${fps} detections/s`, () => {
      const r = run(fps)
      rest(r, 0.66, 600)
      // raw x going down = the hand moves to the person's right = towards the right of the (mirrored) screen
      stroke(r, 0.66, 0.34)
      rest(r, 0.34, 900)
      expect(slaps(r)).toEqual(['right'])
      stroke(r, 0.34, 0.66)
      rest(r, 0.66, 600)
      expect(slaps(r)).toEqual(['right', 'left'])
    })

    it(`ignores the return movement after a slap, at ${fps} detections/s`, () => {
      const r = run(fps)
      rest(r, 0.66, 600)
      stroke(r, 0.66, 0.34)
      stroke(r, 0.34, 0.66, 260) // straight back, just as fast
      rest(r, 0.66, 300)
      expect(slaps(r)).toEqual(['right'])
    })
  }

  it('accepts an even-speed stroke at 12 detections/s (only three frames of movement)', () => {
    const r = run(12)
    rest(r, 0.64, 600)
    play(r, 250, (f) => [{ ...OPEN, x: 0.64 - 0.27 * f }])
    rest(r, 0.37, 400)
    expect(slaps(r)).toEqual(['right'])
  })

  it('works whatever the phase of the frames against the stroke (12 fps, 10 offsets)', () => {
    for (let k = 0; k < 10; k++) {
      const r = run(12)
      r.t += k * 8.3
      rest(r, 0.64, 500)
      stroke(r, 0.64, 0.36, 230)
      rest(r, 0.36, 400)
      expect(slaps(r), `offset ${k}`).toEqual(['right'])
    }
  })

  it('one slap = one page: a second slap inside the cooldown is ignored, after it fires again', () => {
    const r = run(30)
    rest(r, 0.66, 500)
    stroke(r, 0.66, 0.34)
    rest(r, 0.34, 200)
    stroke(r, 0.34, 0.66) // inside 0.7 s
    expect(slaps(r)).toEqual(['right'])
    rest(r, 0.66, 900)
    stroke(r, 0.66, 0.34)
    rest(r, 0.34, 300)
    expect(slaps(r)).toEqual(['right', 'right'])
  })

  it('does not fire for a slow move, a pointing hand, a fist, a vertical move or a single-frame jump', () => {
    const slow = run(30)
    rest(slow, 0.66, 400)
    stroke(slow, 0.66, 0.34, 900)
    expect(slaps(slow)).toEqual([])

    for (const pose of ['point', 'fist'] as const) {
      const r = run(30)
      rest(r, 0.66, 400, { ...OPEN, pose })
      stroke(r, 0.66, 0.34, 220, { ...OPEN, pose })
      expect(slaps(r), pose).toEqual([])
    }

    const diag = run(30)
    rest(diag, 0.6, 400)
    play(diag, 220, (f) => [{ ...OPEN, x: 0.6 - 0.16 * ease(f), y: 0.3 + 0.35 * ease(f) }])
    expect(slaps(diag)).toEqual([])

    const jump = run(20)
    rest(jump, 0.66, 500)
    rest(jump, 0.36, 500)
    expect(slaps(jump)).toEqual([])
  })

  it('never fires while pinching or dragging (scrolling with the cursor)', () => {
    const r = run(30)
    rest(r, 0.66, 500)
    rest(r, 0.66, 200, { ...PINCH, x: 0.66 })
    stroke(r, 0.66, 0.34, 220, PINCH)
    stroke(r, 0.34, 0.66, 220, PINCH)
    expect(of(r, 'dragstart').length).toBe(1)
    rest(r, 0.66, 100) // fingers open again, and right away a fast move: still not a slap (just released)
    expect(slaps(r)).toEqual([])
  })

  it('the detector alone: frame-rate independent thresholds', () => {
    for (const fps of [12, 20, 30]) {
      const d = new SlapDetector()
      const dt = 1000 / fps
      let t = 0
      const got: string[] = []
      for (let k = 0; k < 10; k++) d.push((t += dt), 0.3, 0.5, true, false)
      for (let k = 1; t < 1000 + 240; k++) {
        t += dt
        const s = d.push(t, 0.3 + 0.3 * ease(Math.min(1, (k * dt) / 240)), 0.5, true, false)
        if (s) got.push(s.dir)
        if (k * dt > 240) break
      }
      // the stroke is reported once the hand settles (it might still turn out to be a wind-up)
      for (let k = 0; k < 6; k++) {
        const s = d.push((t += dt), 0.6, 0.5, true, false)
        if (s) got.push(s.dir)
      }
      expect(got, `${fps} fps`).toEqual(['right'])
    }
  })

  it('follows the mirror setting: with mirroring off the directions swap', () => {
    const r = run(30, new GesturePipeline({ mirror: false }))
    rest(r, 0.66, 500)
    stroke(r, 0.66, 0.34)
    rest(r, 0.34, 300)
    expect(slaps(r)).toEqual(['left'])
  })
})

// How "physical" directions are encoded. A webcam frame (getUserMedia) is NOT mirrored: the camera faces the
// person, so the person's right side appears on the LEFT of the picture. Moving the hand physically to the right
// therefore makes raw landmark x go DOWN. With Mirror on (default) the cursor uses 1 - x, so it moves right too.
// A camera whose driver already mirrors the picture is the opposite: physical right = raw x goes UP; that is
// what Mirror off is for (the cursor then follows raw x, and again moves right).
const PHYS_RIGHT = -1
const PHYS_LEFT = 1
/** a stroke of the hand physically to the person's right (dir -1 in raw x) or left, from raw x `x0` */
const physStroke = (r: Run, x0: number, dir: number, travel = 0.3, ms = 220, pose: SynthOptions = OPEN) => stroke(r, x0, x0 + dir * travel, ms, pose)

describe('slap direction: physical movement -> tab (natural by default)', () => {
  for (const fps of [12, 20, 30]) {
    it(`moving the hand to your right goes to the next tab, to your left the previous one, and the cursor agrees (${fps}/s)`, () => {
      const r = run(fps)
      rest(r, 0.65, 600)
      const before = r.states[r.states.length - 1].cursor!.x
      physStroke(r, 0.65, PHYS_RIGHT)
      rest(r, 0.35, 900)
      const after = r.states[r.states.length - 1].cursor!.x
      expect(after).toBeGreaterThan(before) // the cursor went right on screen
      expect(slaps(r)).toEqual(['right'])
      expect(slapTab('right', 'natural', 2, 5)).toEqual({ side: 'right', index: 3 })
      physStroke(r, 0.35, PHYS_LEFT)
      rest(r, 0.65, 600)
      expect(slaps(r)).toEqual(['right', 'left'])
      expect(slapTab('left', 'natural', 2, 5)).toEqual({ side: 'left', index: 1 })
    })

    for (const wind of [0.16, 0.2, 0.24]) {
      it(`a wind-up the other way first does not reverse it (wind-up ${wind}, ${fps}/s)`, () => {
        for (const dir of [PHYS_RIGHT, PHYS_LEFT]) {
          const r = run(fps)
          const x0 = dir === PHYS_RIGHT ? 0.55 : 0.45
          rest(r, x0, 600)
          // draw the hand back (fast enough to be a slap on its own), then strike the other way, much further
          stroke(r, x0, x0 - dir * wind, 170)
          stroke(r, x0 - dir * wind, x0 + dir * 0.25, 300)
          rest(r, x0 + dir * 0.25, 800)
          expect(slaps(r), `dir ${dir}`).toEqual([dir === PHYS_RIGHT ? 'right' : 'left'])
        }
      })
    }
  }

  it('reports the slap shortly after the hand stops (at most ~settle time + two frames)', () => {
    const r = run(30)
    rest(r, 0.65, 600)
    physStroke(r, 0.65, PHYS_RIGHT)
    const end = r.t
    rest(r, 0.35, 600)
    const e = of(r, 'slap')
    expect(e).toHaveLength(1)
    expect(e[0].t - end).toBeLessThanOrEqual(100 + 2 * (1000 / 30) + 1)
  })

  it('Mirror off with a camera that already mirrors: physical right is raw x going up, and it still goes to the next tab', () => {
    const r = run(30, new GesturePipeline({ mirror: false }))
    rest(r, 0.35, 600)
    const before = r.states[r.states.length - 1].cursor!.x
    stroke(r, 0.35, 0.65) // pre-mirrored picture: the hand moving to the person's right moves right in the picture
    rest(r, 0.65, 600)
    expect(r.states[r.states.length - 1].cursor!.x).toBeGreaterThan(before)
    expect(slaps(r)).toEqual(['right'])
  })

  it('Mirror off with a normal camera: slap and cursor still agree (both follow the unmirrored picture)', () => {
    const r = run(30, new GesturePipeline({ mirror: false }))
    rest(r, 0.65, 600)
    const before = r.states[r.states.length - 1].cursor!.x
    physStroke(r, 0.65, PHYS_RIGHT)
    rest(r, 0.35, 600)
    expect(r.states[r.states.length - 1].cursor!.x).toBeLessThan(before)
    expect(slaps(r)).toEqual(['left'])
  })

  it('left-hand preference: the left hand slapping to your right also goes to the next tab', () => {
    const p = new GesturePipeline({ primaryHand: 'left' })
    let t = 1000
    const got: string[] = []
    const feed = (x: number) => {
      t += 1000 / 30
      // a raw (unmirrored) frame: MediaPipe labels the person's left hand "Right" (see sideOf)
      const out = p.push({ t, aspect: 4 / 3, hands: [{ landmarks: synthHand({ pose: 'open', x, y: 0.45, side: 'left' }), handedness: 'Right', score: 0.95 }] })
      for (const e of out.events) if (e.type === 'slap') got.push(e.dir)
      return out.state
    }
    for (let k = 0; k < 20; k++) feed(0.6)
    expect(feed(0.6).hands[0].side).toBe('left')
    for (let k = 1; k <= 7; k++) feed(0.6 - 0.3 * ease(k / 7)) // physically to the right
    for (let k = 0; k < 30; k++) feed(0.3)
    for (let k = 1; k <= 7; k++) feed(0.3 + 0.3 * ease(k / 7)) // physically to the left
    for (let k = 0; k < 20; k++) feed(0.6)
    expect(got).toEqual(['right', 'left'])
  })

  it('the setting: natural / reversed, and the side the feedback (edge flash, sweep, end of strip) uses', () => {
    expect(slapStep('right')).toBe(1)
    expect(slapStep('left')).toBe(-1)
    expect(slapStep('right', 'natural')).toBe(1)
    expect(slapStep('right', 'reversed')).toBe(-1)
    expect(slapStep('left', 'reversed')).toBe(1)
    // natural: the animation goes the way the hand went
    expect(slapTab('right', 'natural', 0, 3)).toEqual({ side: 'right', index: 1 })
    expect(slapTab('left', undefined, 1, 3)).toEqual({ side: 'left', index: 0 })
    // reversed: tab and animation both swap
    expect(slapTab('right', 'reversed', 1, 3)).toEqual({ side: 'left', index: 0 })
    expect(slapTab('left', 'reversed', 1, 3)).toEqual({ side: 'right', index: 2 })
    // the ends of the strip: no tab, the side says which end ("already on the last / first tab")
    expect(slapTab('right', 'natural', 2, 3)).toEqual({ side: 'right', index: null })
    expect(slapTab('left', 'natural', 0, 3)).toEqual({ side: 'left', index: null })
    expect(slapTab('left', 'reversed', 2, 3)).toEqual({ side: 'right', index: null })
    expect(slapTab('right', 'natural', -1, 3)).toEqual({ side: 'right', index: null })
  })
})

describe('pinch calibration', () => {
  it('learns a small open hand: the pinch ring is not half closed at rest, and a pinch still presses', () => {
    // this person rests with thumb and index fairly close (ratio ~0.74 instead of ~1.26)
    const r = run(30)
    const relaxed = { ...OPEN, pinch: 0.4 }
    play(r, 300, () => [relaxed])
    const before = r.states.at(-1)!.pinch
    play(r, 2500, () => [relaxed])
    const after = r.states.at(-1)!.pinch
    expect(before).toBeGreaterThan(0.15)
    expect(after).toBeLessThan(0.05)
    expect(of(r, 'press').length).toBe(0)
    play(r, 150, (f) => [{ ...relaxed, pinch: 0.4 + 0.45 * f }])
    play(r, 150, () => [{ ...relaxed, pinch: 0.85 }])
    play(r, 300, () => [relaxed])
    expect(of(r, 'tap').length).toBe(1)
  })

  it('accepts a hand whose pinch cannot get below the default threshold after a near miss', () => {
    const attempt = (r: Run) => {
      play(r, 200, (f) => [{ ...OPEN, pinch: 0.66 * f }])
      play(r, 200, () => [{ ...OPEN, pinch: 0.66 }])
      play(r, 200, (f) => [{ ...OPEN, pinch: 0.66 * (1 - f) }])
      play(r, 500, () => [OPEN])
    }
    const thick = features(synthHand({ pose: 'open', pinch: 0.66 })).pinch
    expect(thick).toBeGreaterThan(0.39)

    const fixed = run(30, new GesturePipeline({ calibrate: false, pose: { pinchPress: 0.3, pinchRelease: 0.46 } as never }))
    play(fixed, 2500, () => [OPEN])
    for (let k = 0; k < 3; k++) attempt(fixed)
    expect(of(fixed, 'press').length).toBe(0)

    const r = run(30)
    play(r, 2500, () => [OPEN])
    attempt(r)
    expect(of(r, 'press').length).toBe(0) // the first try is a near miss
    attempt(r)
    attempt(r)
    expect(of(r, 'press').length).toBeGreaterThanOrEqual(1)
  })

  it('keeps a hysteresis gap that scales with the hand, and does not depend on the distance to the camera', () => {
    const near = new PinchCalibrator()
    const far = new PinchCalibrator()
    for (let t = 0; t <= CALIB.learnMs + 100; t += 33) {
      near.update(features(synthHand({ pose: 'open', size: 0.35 })).pinch, false, true, t)
      far.update(features(synthHand({ pose: 'open', size: 0.08 })).pinch, false, true, t)
    }
    expect(near.learned && far.learned).toBe(true)
    expect(Math.abs(near.th.pinchPress - far.th.pinchPress)).toBeLessThan(0.01)
    expect(near.th.pinchRelease - near.th.pinchPress).toBeGreaterThanOrEqual(CALIB.minGap)
    expect(near.th.pinchOpen).toBeGreaterThan(near.th.pinchRelease)
  })
})

describe('cursor freeze during a pinch', () => {
  it('holds the cursor from the moment the fingers start closing until the release', () => {
    const r = run(20)
    play(r, 800, () => [OPEN])
    const before = r.states.at(-1)!.cursor!
    const from = r.states.length
    // fingers close in 150 ms while the hand drifts a little (under the drag threshold)
    play(r, 150, (f) => [{ ...OPEN, pinch: f, x: 0.5 - 0.008 * f }])
    play(r, 200, () => [{ ...PINCH, x: 0.492 }])
    play(r, 100, (f) => [{ ...OPEN, pinch: 1 - f, x: 0.492 }])
    const during = r.states.slice(from).map((s) => s.cursor!)
    const drift = Math.max(...during.map((c) => Math.hypot(c.x - before.x, c.y - before.y)))
    expect(drift).toBeLessThan(0.004)
    play(r, 100, () => [{ ...OPEN, x: 0.492 }])
    const tap = of(r, 'tap')[0] as { x: number; y: number }
    expect(tap).toBeTruthy()
    expect(Math.hypot(tap.x - before.x, tap.y - before.y)).toBeLessThan(0.004)
    expect(r.states.slice(from + 2, from + 6).every((s) => s.frozen)).toBe(true)
    // afterwards it follows the hand again
    play(r, 600, (f) => [{ ...OPEN, x: 0.492 - 0.1 * f }])
    expect(r.states.at(-1)!.cursor!.x - before.x).toBeGreaterThan(0.1)
    expect(r.states.at(-1)!.frozen).toBe(false)
  })

  it('lets go when the half-closed hand moves on instead of pinching', () => {
    const r = run(30)
    play(r, 600, () => [OPEN])
    play(r, 200, (f) => [{ ...OPEN, pinch: 0.55 * f }])
    const held = r.states.at(-1)!.cursor!
    play(r, 500, (f) => [{ ...OPEN, pinch: 0.55, x: 0.5 - 0.12 * f }])
    expect(of(r, 'press').length).toBe(0)
    expect(r.states.at(-1)!.cursor!.x - held.x).toBeGreaterThan(0.08)
  })

  it('a drag still moves the cursor (with the knuckle, not the fingertip)', () => {
    const r = run(30)
    play(r, 500, () => [OPEN])
    play(r, 150, () => [PINCH])
    const start = r.states.at(-1)!.cursor!
    play(r, 400, (f) => [{ ...PINCH, x: 0.5 - 0.12 * f }])
    expect(r.states.at(-1)!.mode).toBe('drag')
    expect(r.states.at(-1)!.cursor!.x - start.x).toBeGreaterThan(0.12)
  })

  it('a still hand with tremor keeps a steady cursor (dead zone)', () => {
    const rng = seeded(11)
    const r = run(30)
    play(r, 3000, () => [{ ...OPEN, noise: 0.003, rng }])
    const xs = r.states.slice(30).map((s) => s.cursor!.x)
    const ys = r.states.slice(30).map((s) => s.cursor!.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.012)
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.012)
  })
})

describe('dwell-to-click', () => {
  it('fires once after resting on a control, again only after leaving it', () => {
    const d = new Dwell<string>({ ms: 800 })
    let fires = 0
    let t = 0
    const hover = (key: string | null, ms: number, x = 100, allowed = true) => {
      for (const end = t + ms; t < end; t += 33) if (d.update(key, t, x, 100, allowed)) fires++
    }
    hover('a', 700)
    expect(fires).toBe(0)
    expect(d.progress).toBeGreaterThan(0.8)
    hover('a', 2000)
    expect(fires).toBe(1)
    hover(null, 100)
    hover('a', 900)
    expect(fires).toBe(2)
    hover('b', 500)
    hover('b', 500, 100, false) // a pinch started: the timer starts over
    hover('b', 600)
    expect(fires).toBe(2)
    hover('b', 300)
    expect(fires).toBe(3)
  })

  it('restarts when the cursor wanders across a large control', () => {
    const d = new Dwell<string>({ ms: 800, moveTol: 50 })
    let fired = false
    for (let t = 0, x = 0; t < 1500; t += 33, x += 4) fired ||= d.update('card', t, x, 0, true)
    expect(fired).toBe(false)
  })
})

describe('magnet', () => {
  const box = (left: number, top: number, w: number, h: number): Rect => ({ left, top, right: left + w, bottom: top + h })

  it('scales the snap radius with the viewport', () => {
    expect(magnetRadius(390, 844)).toBeLessThan(magnetRadius(1440, 900))
    expect(magnetRadius(4000, 3000)).toBe(64)
  })

  it('snaps to a small control within the radius, and enlarges its hit area', () => {
    const icon: Cand<string>[] = [{ key: 'icon', rect: box(100, 100, 16, 16) }]
    expect(pickTarget(icon, 108 + 14 + 30, 108, null, { radius: 48 })).toBe('icon') // 30 px past the 44 px hit area
    expect(pickTarget(icon, 108 + 22 + 60, 108, null, { radius: 48 })).toBe(null)
    expect(snapPoint(icon[0].rect, 140, 120)).toEqual({ x: 108, y: 108 })
  })

  it('has hysteresis: jitter between two neighbours does not flicker', () => {
    const cands: Cand<string>[] = [
      { key: 'a', rect: box(0, 0, 60, 40) },
      { key: 'b', rect: box(80, 0, 60, 40) },
    ]
    let cur: string | null = null
    let changes = 0
    const rng = seeded(5)
    for (let k = 0; k < 200; k++) {
      const x = 70 + (rng() - 0.5) * 14 // around the gap between them
      const next: string | null = pickTarget(cands, x, 20, cur)
      if (next !== cur) changes++
      cur = next
    }
    expect(changes).toBe(1)
    // a clear move onto the other one does switch
    expect(pickTarget(cands, 120, 20, 'a')).toBe('b')
  })

  it('prefers the more specific control when the cursor is inside two', () => {
    const cands: Cand<string>[] = [
      { key: 'card', rect: box(0, 0, 400, 200) },
      { key: 'button', rect: box(20, 20, 80, 36) },
    ]
    expect(pickTarget(cands, 50, 38, null)).toBe('button')
    expect(pickTarget(cands, 300, 150, null)).toBe('card')
    expect(pickTarget(cands, 50, 38, 'card')).toBe('button') // moving onto the button inside the card
    expect(pickTarget(cands, 300, 150, 'button')).toBe('card')
  })
})
