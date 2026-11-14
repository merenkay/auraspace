import { describe, expect, it } from 'vitest'
import { NEWS2_BANDS, NEWS2_TRIGGER } from '../../data/earlyWarning/news2'
import type { Measurement } from '../types'
import { news2FromData, scoreNews2, scoreParam, triggerOf, type FullCheck } from './news2'

// Every boundary on RCP NEWS2 Chart 1 (2017), both sides.
const CHART: Record<keyof typeof NEWS2_BANDS, [number, number][]> = {
  rr: [[0, 3], [8, 3], [9, 1], [11, 1], [12, 0], [20, 0], [21, 2], [24, 2], [25, 3], [60, 3]],
  spo2: [[70, 3], [91, 3], [92, 2], [93, 2], [94, 1], [95, 1], [96, 0], [100, 0]],
  sys: [[60, 3], [90, 3], [91, 2], [100, 2], [101, 1], [110, 1], [111, 0], [219, 0], [220, 3], [250, 3]],
  pulse: [[20, 3], [40, 3], [41, 1], [50, 1], [51, 0], [90, 0], [91, 1], [110, 1], [111, 2], [130, 2], [131, 3], [200, 3]],
  temp: [[33, 3], [35.0, 3], [35.1, 1], [36.0, 1], [36.1, 0], [38.0, 0], [38.1, 1], [39.0, 1], [39.1, 2], [42, 2]],
}

describe('NEWS2 Chart 1 bands', () => {
  for (const [param, cases] of Object.entries(CHART) as [keyof typeof NEWS2_BANDS, [number, number][]][]) {
    it(`${param}: every published boundary`, () => {
      for (const [value, score] of cases) expect(scoreParam(param, value), `${param} ${value}`).toBe(score)
    })
    it(`${param}: bands leave no gap and never overlap at the chart's precision`, () => {
      const step = param === 'temp' ? 0.1 : 1
      for (let i = 0; i <= 3000; i++) {
        const v = +((param === 'temp' ? 30 : 0) + i * step).toFixed(1)
        const hits = NEWS2_BANDS[param].filter((b) => (b.lo == null || v >= b.lo) && (b.hi == null || v <= b.hi))
        expect(hits.length, `${param} ${v}`).toBe(1)
      }
    })
  }
  it('rounds to recording precision before scoring (35.04 °C is 35.0 → 3; 35.06 → 35.1 → 1)', () => {
    expect(scoreParam('temp', 35.04)).toBe(3)
    expect(scoreParam('temp', 35.06)).toBe(1)
    expect(scoreParam('pulse', 90.4)).toBe(0)
    expect(scoreParam('pulse', 90.6)).toBe(1)
  })
  it('missing or non-finite values are not scored (never 0)', () => {
    expect(scoreParam('pulse', null)).toBeNull()
    expect(scoreParam('pulse', undefined)).toBeNull()
    expect(scoreParam('pulse', NaN)).toBeNull()
  })
  it('air/oxygen and ACVPU', () => {
    const base = { rr: 16, spo2: 97, sys: 120, pulse: 70, temp: 37 }
    expect(scoreNews2({ ...base, o2: 'air', acvpu: 'A' }).points).toBe(0)
    expect(scoreNews2({ ...base, o2: 'oxygen', acvpu: 'A' }).points).toBe(2)
    for (const a of ['C', 'V', 'P', 'U'] as const) expect(scoreNews2({ ...base, o2: 'air', acvpu: a }).points).toBe(3)
  })
})

describe('partial vs complete', () => {
  it('four AURA parameters give a partial result with no trigger', () => {
    const r = scoreNews2({ pulse: 95, spo2: 94, sys: 105, temp: 38.5 })
    expect(r.complete).toBe(false)
    expect(r.scored).toBe(4)
    expect(r.points).toBe(4)
    expect(r.trigger).toBeNull()
    expect(r.items.filter((i) => i.score == null).map((i) => i.param)).toEqual(['rr', 'o2', 'acvpu'])
  })
  it('a single 3 is surfaced as a red score even when partial', () => {
    const r = scoreNews2({ pulse: 135, spo2: 98, sys: 120, temp: 37 })
    expect(r.complete).toBe(false)
    expect(r.red).toEqual(['pulse'])
    expect(r.trigger).toBeNull()
  })
  it('complete score maps to Chart 2 triggers', () => {
    const full = { rr: 16, o2: 'air' as const, acvpu: 'A' as const, spo2: 97, sys: 120, pulse: 70, temp: 37 }
    expect(scoreNews2(full).trigger).toBe('low')
    expect(scoreNews2({ ...full, rr: 21 }).trigger).toBe('low') // 2
    expect(scoreNews2({ ...full, rr: 25 }).trigger).toBe('red') // single 3, total 3
    expect(scoreNews2({ ...full, rr: 21, spo2: 93, pulse: 95 }).trigger).toBe('medium') // 2+2+1 = 5
    expect(scoreNews2({ ...full, rr: 25, o2: 'oxygen', pulse: 95, temp: 38.5 }).trigger).toBe('high') // 3+2+1+1 = 7
  })
  it('trigger precedence: 7+ high, 5–6 medium, else red if any 3, else low', () => {
    expect(triggerOf(7, false)).toBe('high')
    expect(triggerOf(6, true)).toBe('medium')
    expect(triggerOf(5, false)).toBe('medium')
    expect(triggerOf(4, true)).toBe('red')
    expect(triggerOf(4, false)).toBe('low')
    expect(triggerOf(0, false)).toBe('low')
  })
  it('response wording is the verbatim Chart 2 text', () => {
    expect(NEWS2_TRIGGER.medium.response).toBe('Key threshold for urgent response*')
    expect(NEWS2_TRIGGER.high.response).toBe('Urgent or emergency response**')
    expect(NEWS2_TRIGGER.red.risk).toBe('Low–medium')
  })
})

describe('news2FromData', () => {
  const NOW = Date.parse('2026-11-14T12:00:00Z')
  const m = (metric: Measurement['metric'], value: number, hoursAgo: number): Measurement => ({
    id: Math.round(value * 100 + hoursAgo),
    crewId: 1,
    metric,
    value,
    day: 142,
    at: new Date(NOW - hoursAgo * 3600000).toISOString(),
    source: 'device',
    device: 'x',
  })
  it('uses readings under 24 h; older ones are missing, not normal', () => {
    const r = news2FromData([m('hr', 70, 2), m('spo2', 97, 2), m('temp', 36.8, 30), m('sys', 120, 2)], NOW, null)
    expect(r.complete).toBe(false)
    expect(r.scored).toBe(3)
    const temp = r.items.find((i) => i.param === 'temp')!
    expect(temp.score).toBeNull()
    expect(temp.note).toMatch(/24 h old/)
  })
  it('a full check within an hour gives a complete score; an expired one falls back to partial', () => {
    const check: FullCheck = { at: new Date(NOW - 20 * 60000).toISOString(), rr: 22, o2: 'air', acvpu: 'A', pulse: 92, spo2: 95, temp: 37, sys: 120 }
    const r = news2FromData([], NOW, check)
    expect(r.complete).toBe(true)
    expect(r.points).toBe(2 + 1 + 1)
    expect(r.trigger).toBe('low')
    const old = news2FromData([], NOW, { ...check, at: new Date(NOW - 2 * 3600000).toISOString() })
    expect(old.complete).toBe(false)
    expect(old.scored).toBe(0)
    expect(old.expiredCheckAt).not.toBeNull()
  })
})
