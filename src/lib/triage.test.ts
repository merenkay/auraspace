import { describe, expect, it } from 'vitest'
import { MISSIONS, formatDelay } from '../data/missions'
import { actionFor } from './triage'

describe('actionFor: ok', () => {
  it('is the same calm text everywhere', () => {
    const t = actionFor('ok', 0, 'space')
    expect(t).toMatch(/Within normal range/)
    expect(actionFor('ok', 840, 'space')).toBe(t)
    expect(actionFor('ok', 0, 'polar')).toBe(t)
    expect(actionFor('ok', 0, 'home')).toBe(t)
  })
})

describe('actionFor: home', () => {
  it('warn: rest, re-measure, tell doctor or caregiver today', () => {
    const t = actionFor('warn', 0, 'home')
    expect(t).toMatch(/rest for 5 minutes/)
    expect(t).toMatch(/doctor or caregiver today/)
    expect(t).not.toMatch(/crew|station|Earth/i)
  })
  it('crit: contact doctor now and point to the emergency number', () => {
    const t = actionFor('crit', 0, 'home')
    expect(t).toMatch(/doctor or caregiver now/)
    expect(t).toMatch(/112/)
  })
})

describe('actionFor: polar', () => {
  it('warn: re-measure in 15 minutes, station doctor today', () => {
    const t = actionFor('warn', 840, 'polar')
    expect(t).toMatch(/15 minutes/)
    expect(t).toMatch(/station doctor today/)
    expect(t).not.toMatch(/Earth/)
  })
  it('crit: station doctor now, delay is ignored', () => {
    expect(actionFor('crit', 840, 'polar')).toMatch(/station doctor now/)
    expect(actionFor('crit', 0, 'polar')).toBe(actionFor('crit', 840, 'polar'))
  })
})

describe('actionFor: space', () => {
  it('near Earth (delay under a minute): crewmate and ground, no delay maths', () => {
    for (const d of [0, 1.3, 59.9]) {
      expect(actionFor('warn', d, 'space')).toMatch(/crewmate/)
      expect(actionFor('warn', d, 'space')).not.toMatch(/reply from Earth/)
      expect(actionFor('crit', d, 'space')).toMatch(/Alert a crewmate and contact the flight surgeon now/)
    }
  })
  it('space is the default context', () => {
    expect(actionFor('crit', 0)).toBe(actionFor('crit', 0, 'space'))
  })
  it('remote profile: the earliest reply is the ROUND trip (2 x one-way)', () => {
    const mars = MISSIONS.find((m) => m.id === 'mars-transit')!
    expect(mars.delaySec).toBe(840)
    expect(formatDelay(mars.delaySec * 2)).toBe('28 min')
    expect(actionFor('warn', mars.delaySec, 'space')).toMatch(/at least 28 min/)
    expect(actionFor('crit', mars.delaySec, 'space')).toMatch(/about 28 min/)
    expect(actionFor('crit', mars.delaySec, 'space')).toMatch(/crew medical officer/)
  })
  it('exactly one minute one-way counts as remote and gives a 2 min round trip', () => {
    expect(actionFor('warn', 60, 'space')).toMatch(/at least 2 min/)
  })
  it('delay never changes the wording for ok', () => {
    expect(actionFor('ok', 840)).toBe(actionFor('ok', 0))
  })
})
