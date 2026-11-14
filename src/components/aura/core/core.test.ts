import { describe as suite, expect, it } from 'vitest'
import { geodesic, polygon, projectLattice } from './geometry'
import { coreState, describe, effectivePhase, follow, frameRate, homeFor, HOME_VIEW, PITCH_LIMIT, POSES, rotateView, urgentPulse, viewSettled, ZOOM_MAX, ZOOM_MIN, zoomView, type CoreState, type Pace } from './model'

const STATES: CoreState[] = ['idle', 'listening', 'thinking', 'speaking', 'urgent', 'off']

suite('core state', () => {
  const base = { available: true, phase: 'idle' as const, urgent: false }
  it('follows the voice phase', () => {
    expect(coreState(base)).toBe('idle')
    expect(coreState({ ...base, phase: 'listening' })).toBe('listening')
    expect(coreState({ ...base, phase: 'thinking' })).toBe('thinking')
    expect(coreState({ ...base, phase: 'speaking' })).toBe('speaking')
  })
  it('urgent wins over every phase, and over an unavailable voice', () => {
    expect(coreState({ ...base, phase: 'speaking', urgent: true })).toBe('urgent')
    expect(coreState({ available: false, phase: 'idle', urgent: true })).toBe('urgent')
    expect(coreState({ available: false, phase: 'idle', urgent: false }, { urgent: true })).toBe('urgent')
  })
  it('is off when voice cannot be used, whatever the phase says', () => {
    expect(coreState({ available: false, phase: 'listening', urgent: false })).toBe('off')
  })
  it('the page hints fill in only while the voice store is idle', () => {
    expect(coreState(base, { listening: true })).toBe('listening')
    expect(effectivePhase('speaking', { listening: true })).toBe('speaking')
    expect(coreState(base, { urgent: true })).toBe('urgent')
    expect(coreState(base, {})).toBe('idle')
  })
})

suite('poses', () => {
  it('every state has three rings and sane sizes inside the tick ring', () => {
    for (const s of STATES) {
      const p = POSES[s]
      expect(p.rings).toHaveLength(3)
      for (const r of p.rings) {
        expect(r.radius).toBeGreaterThan(0.5)
        expect(r.radius * (1 + r.react)).toBeLessThan(1.5)
        expect(r.width).toBeGreaterThanOrEqual(1)
      }
      expect(p.shell.radius * (1 + p.shell.react + p.shell.jitter)).toBeLessThan(1.2)
      expect(p.nucleus.radius * (1 + p.nucleus.react + p.nucleus.breathe)).toBeLessThan(p.shell.radius)
    }
  })
  it('red appears only in the urgent state, with the octagon', () => {
    for (const s of STATES) {
      const p = POSES[s]
      const red = p.rings.some((r) => r.tone === 'crit' && r.opacity > 0) || p.nucleus.tone === 'crit' || p.shell.tone === 'crit'
      expect(red).toBe(s === 'urgent')
      expect(p.octagon > 0).toBe(s === 'urgent')
    }
  })
  it('nothing is live or accented when voice is off, and nothing moves', () => {
    const p = POSES.off
    expect(p.rings.every((r) => r.tone === 'edge' && r.dashed && r.motion === 'still' && r.react === 0)).toBe(true)
    expect(p.nucleus.tone).toBe('edge')
    expect(p.shell.drift + p.shell.jitter + p.shell.react + p.nucleus.breathe).toBe(0)
  })
  it('only the thinking state shows the work arc, and only idle and thinking rings turn on their own', () => {
    for (const s of STATES) {
      expect(POSES[s].arc > 0).toBe(s === 'thinking')
      expect(POSES[s].rings.some((r) => r.motion !== 'still')).toBe(s === 'idle' || s === 'thinking')
    }
  })
  it('the voice level moves something only while listening, speaking or urgent', () => {
    for (const s of STATES) {
      const p = POSES[s]
      const reacts = p.shell.react > 0 || p.nucleus.react > 0 || p.rings.some((r) => r.react > 0)
      expect(reacts).toBe(s === 'listening' || s === 'speaking' || s === 'urgent')
    }
  })
  it('idle drift is slow: no ring turns faster than once a minute', () => {
    for (const r of POSES.idle.rings) expect(Math.abs(r.rate)).toBeLessThanOrEqual((Math.PI * 2) / 60)
  })
})

suite('motion helpers', () => {
  it('follow rises fast and settles slowly', () => {
    const up = follow(0, 1, 0.06, 0.06, 0.3)
    const down = follow(1, 0, 0.06, 0.06, 0.3)
    expect(up).toBeCloseTo(1 - Math.exp(-1), 5)
    expect(1 - down).toBeLessThan(up)
    expect(follow(0.4, 1, 0, 0.06)).toBe(0.4)
    expect(follow(0.4, 1, 0.1, 0)).toBe(1)
  })
  it('urgent pulses three times, then holds still', () => {
    expect(urgentPulse(0)).toBe(0)
    expect(urgentPulse(0.5)).toBeCloseTo(1)
    expect(urgentPulse(1)).toBeCloseTo(0)
    expect(urgentPulse(1.5)).toBeCloseTo(1)
    expect(urgentPulse(2.5)).toBeCloseTo(1)
    expect(urgentPulse(3)).toBe(0)
    expect(urgentPulse(60)).toBe(0)
    for (let t = 0; t < 4; t += 0.05) expect(urgentPulse(t)).toBeLessThanOrEqual(1)
  })
})

suite('frame rate', () => {
  const pace = (p: Partial<Pace>): Pace => ({ state: 'idle', live: false, reduced: false, lowPower: false, moving: false, level: 0, ...p })
  it('idles at 30 and never draws faster without a reason', () => {
    expect(frameRate(pace({}))).toBe(30)
    expect(frameRate(pace({ state: 'thinking' }))).toBe(30)
    expect(frameRate(pace({ state: 'listening', live: true, level: 0 }))).toBe(30)
  })
  it('draws at the display rate only while a level or a movement needs it', () => {
    expect(frameRate(pace({ state: 'listening', live: true, level: 0.4 }))).toBe(60)
    expect(frameRate(pace({ state: 'speaking', live: true, level: 0.4 }))).toBe(60)
    expect(frameRate(pace({ moving: true }))).toBe(60)
  })
  it('stops when the picture is still', () => {
    expect(frameRate(pace({ state: 'off' }))).toBe(0)
    expect(frameRate(pace({ state: 'urgent' }))).toBe(0)
    expect(frameRate(pace({ state: 'urgent', live: true, level: 0 }))).toBe(30)
    expect(frameRate(pace({ state: 'urgent', moving: true }))).toBe(60)
  })
  it('reduced motion draws only on a change', () => {
    for (const state of STATES) expect(frameRate(pace({ state, reduced: true, live: true, level: 0.8 }))).toBe(0)
    expect(frameRate(pace({ reduced: true, moving: true }))).toBe(60)
  })
  it('hand control caps everything at 30', () => {
    expect(frameRate(pace({ lowPower: true, moving: true }))).toBe(30)
    expect(frameRate(pace({ lowPower: true, state: 'speaking', live: true, level: 0.9 }))).toBe(30)
  })
})

suite('view', () => {
  it('turns freely sideways and within limits up and down', () => {
    const v = rotateView(HOME_VIEW, 100, 10000)
    expect(v.yaw).toBeCloseTo(0.8)
    expect(v.pitch).toBeCloseTo(PITCH_LIMIT)
    expect(rotateView(HOME_VIEW, 0, -10000).pitch).toBeCloseTo(-PITCH_LIMIT)
  })
  it('zoom stays inside its range; a factor below 1 comes closer', () => {
    expect(zoomView(HOME_VIEW, 0.8).zoom).toBeCloseTo(1.25)
    expect(zoomView(HOME_VIEW, 0.01).zoom).toBe(ZOOM_MAX)
    expect(zoomView(HOME_VIEW, 100).zoom).toBe(ZOOM_MIN)
    expect(zoomView(HOME_VIEW, 0)).toEqual(HOME_VIEW)
    expect(zoomView(HOME_VIEW, NaN)).toEqual(HOME_VIEW)
  })
  it('reset goes to the nearest whole turn', () => {
    const h = homeFor({ yaw: Math.PI * 2 * 3 + 0.4, pitch: 0.5, zoom: 1.4 })
    expect(h).toEqual({ yaw: Math.PI * 2 * 3, pitch: 0, zoom: 1 })
    expect(viewSettled(h, { ...h, yaw: h.yaw + 0.001 })).toBe(true)
    expect(viewSettled(h, { ...h, zoom: 1.1 })).toBe(false)
  })
})

suite('words', () => {
  const none = { phase: 'idle' as const, interim: '', caption: '' }
  it('every state has a label and a line, in both sizes', () => {
    for (const s of STATES)
      for (const compact of [false, true]) {
        const t = describe(s, none, compact)
        expect(t.label.length).toBeGreaterThan(0)
        expect(t.line.length).toBeGreaterThan(0)
      }
  })
  it('shows what was heard while listening and what is said while speaking', () => {
    const heard = describe('listening', { phase: 'listening', interim: ' my head hurts ', caption: 'How long?' })
    expect(heard).toMatchObject({ label: 'Listening', line: 'my head hurts', quote: true, sub: 'AURA: How long?' })
    expect(describe('speaking', { phase: 'speaking', interim: '', caption: 'Rest and drink water.' })).toMatchObject({ label: 'Speaking', line: 'Rest and drink water.' })
    expect(describe('thinking', { phase: 'thinking', interim: 'my head hurts', caption: '' })).toMatchObject({ label: 'Working on it', quote: true })
  })
  it('urgent always points at the steps on screen', () => {
    expect(describe('urgent', none).line).toBe('Follow the steps on screen.')
    expect(describe('urgent', { phase: 'speaking', interim: '', caption: 'Call for help now.' })).toMatchObject({ label: 'Urgent', line: 'Follow the steps on screen.', sub: 'Call for help now.' })
    expect(describe('urgent', { phase: 'listening', interim: 'what do I do', caption: '' })).toMatchObject({ line: 'what do I do', sub: 'Follow the steps on screen.' })
  })
  it('says plainly when voice is off', () => {
    expect(describe('off', none).label).toBe('Voice is off')
    expect(describe('off', none).line).toMatch(/type/i)
  })
})

suite('geometry', () => {
  it('builds a closed geodesic lattice on the unit sphere', () => {
    for (const f of [1, 2, 3]) {
      const l = geodesic(f)
      expect(l.vertices).toHaveLength(10 * f * f + 2)
      expect(l.edges).toHaveLength(30 * f * f)
      for (const v of l.vertices) expect(Math.hypot(...v)).toBeCloseTo(1, 6)
      const degree = new Array(l.vertices.length).fill(0)
      for (const [a, b] of l.edges) {
        expect(a).not.toBe(b)
        degree[a]++
        degree[b]++
      }
      // twelve corners with five neighbours, six everywhere else
      expect(degree.filter((d) => d === 5)).toHaveLength(12)
      expect(degree.filter((d) => d === 6)).toHaveLength(l.vertices.length - 12)
    }
  })
  it('projects the lattice inside its radius, split front and back', () => {
    const l = geodesic(2)
    const p = projectLattice(l, 0.5, 0.42, 100)
    const count = (s: string) => (s.match(/M/g) ?? []).length
    expect(count(p.front) + count(p.back)).toBe(l.edges.length)
    expect(count(p.dotsFront) + count(p.dotsBack)).toBe(l.vertices.length)
    for (const n of `${p.front}${p.back}`.match(/-?\d+(\.\d+)?/g) ?? []) expect(Math.abs(Number(n))).toBeLessThanOrEqual(100.05)
  })
  it('an octagon rests on a flat side', () => {
    const o = polygon(8, 1)
    expect(o).toHaveLength(8)
    const ys = o.map(([, y]) => y)
    expect(ys.filter((y) => Math.abs(y - Math.max(...ys)) < 1e-9)).toHaveLength(2)
  })
})
