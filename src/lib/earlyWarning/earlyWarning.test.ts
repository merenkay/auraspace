import { describe, expect, it } from 'vitest'
import type { FieldId } from '../../data/vitals'
import { generateMeasurements, MISSION } from '../demoData'
import type { Measurement } from '../types'
import { analyseMetric } from './drift'
import { analyse } from './index'
import { EW_METRICS, limitsFor } from './metrics'
import { mad, mannKendall, median, modifiedZ, rSquared, theilSen } from './stats'

const TODAY = 142
const NOW = Date.parse('2026-11-14T12:00:00Z')
let id = 1
/** Deterministic noise in [-1, 1] (no Math.random). */
const noise = (i: number) => { const x = Math.sin(i * 12.9898 + 1) * 43758.5453; return (x - Math.floor(x)) * 2 - 1 }
function series(metric: FieldId, f: (day: number, i: number) => number | null, from = TODAY - 41, to = TODAY): Measurement[] {
  const out: Measurement[] = []
  for (let d = from, i = 0; d <= to; d++, i++) {
    const v = f(d, i)
    if (v == null) continue
    out.push({ id: id++, crewId: 9, metric, value: v, day: d, at: new Date(NOW - (TODAY - d) * 86400000 - 3 * 3600000).toISOString(), source: 'sim', device: 'test' })
  }
  return out
}
const M = (field: FieldId) => EW_METRICS.find((m) => m.field === field)!
const run = (rows: Measurement[], field: FieldId, ctx: 'space' | 'polar' | 'home' = 'space') => analyseMetric(rows, M(field), { today: TODAY, ctx })
const recentStart = TODAY - 13

describe('robust statistics', () => {
  it('median and MAD', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1) // NIST example data set
    expect(modifiedZ(10, 2, 1)).toBeCloseTo(0.6745 * 8)
  })
  it('Theil–Sen ignores a single outlier; least squares would not', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ day: i, value: 2 * i + 1 }))
    pts[5] = { day: 5, value: 100 }
    const ts = theilSen(pts)!
    expect(ts.slope).toBeCloseTo(2)
    expect(Math.abs(ts.intercept - 1)).toBeLessThanOrEqual(1.5) // median(y) − slope·median(x)
  })
  it('Mann–Kendall: S, tie-corrected variance and continuity-corrected z', () => {
    const mk = mannKendall([1, 2, 3, 4, 5])
    expect(mk.s).toBe(10)
    expect(mk.z).toBeCloseTo(9 / Math.sqrt((5 * 4 * 15) / 18), 6)
    const tied = mannKendall([1, 1, 2, 3])
    // ties: one group of 2 → var = (4·3·13 − 2·1·9)/18 = 138/18
    expect(tied.s).toBe(5)
    expect(tied.z).toBeCloseTo(4 / Math.sqrt(138 / 18), 6)
    expect(mannKendall([5, 5, 5, 5]).p).toBe(1)
  })
  it('R² of a perfect line is 1 and of flat data is 0', () => {
    const pts = [0, 1, 2, 3].map((d) => ({ day: d, value: 3 * d }))
    expect(rSquared(pts, { slope: 3, intercept: 0 })).toBeCloseTo(1)
    expect(rSquared([0, 1, 2].map((d) => ({ day: d, value: 5 })), { slope: 0, intercept: 5 })).toBe(0)
  })
})

describe('attention/urgent lines are read from AURA rules, not duplicated', () => {
  it('systolic 130 / 140, SpO2 below 95 / 92, sleep target 7 h', () => {
    expect(limitsFor(M('sys'), 'space')).toMatchObject({ warnAt: 130, critAt: 140 })
    expect(limitsFor(M('spo2'), 'space')).toMatchObject({ okEdge: 95, warnAt: 94, critAt: 91 })
    expect(limitsFor(M('sleep'), 'space').okEdge).toBe(7)
  })
  it('context overrides: home exercise target is 21 min, space 90 min', () => {
    expect(limitsFor(M('exercise'), 'home').okEdge).toBe(21)
    expect(limitsFor(M('exercise'), 'space').okEdge).toBe(90)
  })
})

describe('drift and trend rules on synthetic series', () => {
  it('rising: early warning with trend, run rules and a gated projection', () => {
    const rows = series('sys', (d, i) => Math.round(115 + noise(i) * 2 + (d >= recentStart ? (d - recentStart) * 0.8 : 0)))
    const a = run(rows, 'sys')
    expect(a.level).toBe('early')
    expect(a.trend!.significant).toBe(true)
    expect(a.trend!.slope).toBeGreaterThan(0.5)
    expect(a.rules.map((r) => r.id)).toEqual(expect.arrayContaining(['trend', 'run8']))
    expect(a.projection).not.toBeNull()
    expect(a.projection!.target).toBe(130)
    expect(a.projection!.days).toBeGreaterThan(0)
    expect(a.projection!.days).toBeLessThanOrEqual(28)
    const r = analyse(rows, { today: TODAY, ctx: 'space', hidePrivate: false, now: NOW })
    expect(r.warnings[0].finding).toMatch(/Systolic pressure has risen about 0\.\d mmHg per day/)
    expect(r.warnings[0].finding).toMatch(/estimate/)
  })
  it('falling: sleep losing minutes each night is an early warning in the worse direction', () => {
    const rows = series('sleep', (d, i) => +(7.6 + noise(i) * 0.2 - (d >= recentStart ? (d - recentStart) * 0.08 : 0)).toFixed(1))
    const a = run(rows, 'sleep')
    expect(a.level).toBe('early')
    expect(a.trend!.slope).toBeLessThan(0)
    const r = analyse(rows, { today: TODAY, ctx: 'space', hidePrivate: false, now: NOW })
    expect(r.warnings[0].finding).toMatch(/Sleep has fallen about [0-9.]+ min per night/)
  })
  it('improving direction is never a warning (falling blood pressure)', () => {
    const rows = series('sys', (d, i) => Math.round(125 + noise(i) * 2 - (d >= recentStart ? (d - recentStart) * 0.8 : 0)))
    expect(run(rows, 'sys').level).toBeNull()
  })
  it('noisy but flat: stable, no warning', () => {
    const rows = series('hr', (_d, i) => Math.round(62 + noise(i) * 4))
    const a = run(rows, 'hr')
    expect(a.state).toBe('stable')
    expect(a.level).toBeNull()
  })
  it('step change: run rules fire without a trend → worth watching, no projection', () => {
    const rows = series('sys', (d, i) => Math.round((d >= recentStart ? 124 : 115) + noise(i) * 1.5))
    const a = run(rows, 'sys')
    expect(a.rules.some((r) => r.family === 'shift')).toBe(true)
    expect(a.rules.some((r) => r.family === 'trend')).toBe(false)
    expect(a.level).toBe('watch')
    expect(a.projection).toBeNull()
    expect(a.shift!).toBeGreaterThan(2)
  })
  it('sparse data: not enough data, with what is needed — never "stable"', () => {
    const rows = series('sys', (d) => ((TODAY - d) % 5 === 0 ? 118 : null)) // every 5th day: 3 recent, 6 baseline
    const a = run(rows, 'sys')
    expect(a.state).toBe('insufficient')
    expect(a.needs.join(' ')).toMatch(/at least 7 daily readings/)
    expect(a.needs.join(' ')).toMatch(/at least 8 readings/)
    const r = analyse(rows, { today: TODAY, ctx: 'space', hidePrivate: false, now: NOW })
    expect(r.warnings).toHaveLength(0)
    expect(r.unchecked.some((u) => u.metric.field === 'sys')).toBe(true)
  })
  it('stale data (nothing in the last 3 days) is reported, not treated as normal', () => {
    const rows = series('sys', () => 118, TODAY - 41, TODAY - 5)
    const a = run(rows, 'sys')
    expect(a.state).toBe('stale')
    expect(a.level).toBeNull()
    expect(a.needs[0]).toMatch(/No reading in the last 3 days/)
  })
  it('no readings at all: insufficient', () => {
    expect(run([], 'temp').state).toBe('insufficient')
  })
  it('outliers: one wild baseline reading is set aside; one wild recent reading does not create a trend', () => {
    const rows = series('hr', (d, i) => (d === TODAY - 30 ? 140 : d === TODAY - 6 ? 120 : Math.round(62 + noise(i) * 3)))
    const a = run(rows, 'hr')
    expect(a.baseline!.outliers).toBe(1)
    expect(a.baseline!.median).toBeGreaterThan(58)
    expect(a.baseline!.median).toBeLessThan(66)
    expect(a.rules.some((r) => r.family === 'trend')).toBe(false)
    expect(a.level).toBeNull()
  })
  it('projection gating: too few points, loose fit, too far ahead', () => {
    // 9 recent readings: trend can be significant but projection needs 10
    const few = series('sys', (d, i) => (d >= recentStart && d % 3 === 0 ? null : Math.round(115 + noise(i) + (d >= recentStart ? (d - recentStart) * 1.2 : 0))))
    const a1 = run(few, 'sys')
    if (a1.trend?.significant) {
      expect(a1.projection).toBeNull()
      expect(a1.projectionNote).toMatch(/needs 10 readings/)
    }
    // loose fit: strong noise around a modest slope
    const loose = series('sys', (d, i) => Math.round(115 + noise(i * 3) * 5 + (d >= recentStart ? (d - recentStart) * 0.7 : 0)))
    const a2 = run(loose, 'sys')
    expect(a2.trend!.significant && a2.trend!.worse).toBe(true)
    expect(a2.trend!.r2).toBeLessThan(0.5)
    expect(a2.projection).toBeNull()
    expect(a2.projectionNote).toMatch(/explains only/)
    // slow: clean but very slow rise far from the line
    const slow = series('sys', (d) => 100 + (d - (TODAY - 41)) * 0.1 + (d % 2 ? 0.05 : 0))
    const a3 = run(slow, 'sys')
    expect(a3.trend!.significant).toBe(true)
    expect(a3.projection).toBeNull()
    expect(a3.projectionNote).toMatch(/within 28 days/)
  })
  it('loose fit case actually exercises the gate', () => {
    const loose = series('sys', (d, i) => Math.round(115 + noise(i * 3) * 5 + (d >= recentStart ? (d - recentStart) * 0.7 : 0)))
    const a = run(loose, 'sys')
    expect(a.trend!.significant).toBe(true)
    expect(a.trend!.r2).toBeLessThan(0.5)
  })
  it('below-target streak and sleep debt', () => {
    const rows = series('sleep', (d, i) => (d >= TODAY - 13 ? 5.6 + noise(i) * 0.2 : 7.4 + noise(i) * 0.2))
    const a = run(rows, 'sleep')
    expect(a.streak).toBeGreaterThanOrEqual(3)
    expect(a.sleepDebt!.hours).toBeGreaterThan(7)
    expect(a.rules.map((r) => r.id)).toEqual(expect.arrayContaining(['streak', 'sleepDebt', 'sleepRestricted']))
    expect(a.level).toBe('early')
  })
  it('a missing day ends a streak', () => {
    const rows = series('water', (d) => (d === TODAY - 1 ? null : d >= TODAY - 4 ? 1.8 : 2.8))
    expect(run(rows, 'water').streak).toBe(1)
  })
})

describe('privacy, context and determinism', () => {
  const mood = series('mood', (d) => (d >= recentStart ? Math.max(1, 4 - Math.floor((d - recentStart) / 3)) : 4 + (d % 2)))
  it('ground role never sees mood, even if mood rows are passed in', () => {
    const hidden = analyse(mood, { today: TODAY, ctx: 'space', hidePrivate: true, now: NOW })
    expect(hidden.metrics.some((m) => m.metric.field === 'mood')).toBe(false)
    expect(JSON.stringify(hidden)).not.toMatch(/Mood/)
    const shown = analyse(mood, { today: TODAY, ctx: 'space', hidePrivate: false, now: NOW })
    expect(shown.warnings.some((w) => w.metric.field === 'mood')).toBe(true)
  })
  it('wording follows the context care contact and the viewer', () => {
    const rows = series('sys', (d, i) => Math.round(115 + noise(i) * 2 + (d >= recentStart ? (d - recentStart) * 0.8 : 0)))
    expect(analyse(rows, { today: TODAY, ctx: 'home', hidePrivate: false, now: NOW }).warnings[0].next).toMatch(/doctor or caregiver/)
    expect(analyse(rows, { today: TODAY, ctx: 'polar', hidePrivate: false, now: NOW }).warnings[0].next).toMatch(/station doctor/)
    expect(analyse(rows, { today: TODAY, ctx: 'space', hidePrivate: false, now: NOW }).warnings[0].next).toMatch(/flight surgeon/)
    expect(analyse(rows, { today: TODAY, ctx: 'space', hidePrivate: false, now: NOW, viewer: 'staff' }).warnings[0].next).toMatch(/crew member/)
  })
  it('same input → same output, whatever the row order', () => {
    const rows = [...series('sys', (d, i) => Math.round(115 + noise(i) * 2 + (d >= recentStart ? (d - recentStart) * 0.8 : 0))), ...mood]
    const a = analyse(rows, { today: TODAY, ctx: 'space', hidePrivate: false, now: NOW })
    const b = analyse([...rows].reverse(), { today: TODAY, ctx: 'space', hidePrivate: false, now: NOW })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})

describe('simulated demo crew', () => {
  const now = new Date('2026-11-14T12:00:00')
  const all = generateMeasurements(now).map((r, i) => ({ ...r, id: i })) as Measurement[]
  const crew = (cid: number, hidePrivate = false) => analyse(all.filter((r) => r.crewId === cid), { today: MISSION.day, ctx: 'space', hidePrivate, now: now.getTime() })
  it('Okafor: rising systolic pressure is the top early warning, with a projection', () => {
    const r = crew(1)
    expect(r.warnings[0].metric.field).toBe('sys')
    expect(r.warnings[0].level).toBe('early')
    expect(r.warnings[0].projection).not.toBeNull()
  })
  it('Tanaka: calm', () => {
    const r = crew(3)
    expect(r.early).toBe(0)
    expect(r.watch).toBe(0)
    expect(r.summary).toMatch(/^No early warnings/)
  })
  it('Reyes: resting heart rate drifting up; mood hidden from the ground role', () => {
    expect(crew(2).warnings.some((w) => w.metric.field === 'hr' && w.level === 'early')).toBe(true)
    expect(crew(2, true).warnings.some((w) => w.metric.field === 'mood')).toBe(false)
  })
  it('Brandt: falling water and exercise', () => {
    const f = crew(4).warnings.map((w) => w.metric.field)
    expect(f).toEqual(expect.arrayContaining(['water', 'exercise']))
  })
})
