import { describe, expect, it } from 'vitest'
import type { FieldId, Values, VitalKey } from '../../data/vitals'
import { evaluate } from '../../lib/health'
import type { Measurement } from '../../lib/types'
import { alertAction, alertLevelFor, alertVitalKey, describeSave } from './readingLogic'

let id = 1
const row = (metric: FieldId, value: number, day = 142, min = 0): Measurement => ({
  id: id++,
  crewId: 1,
  metric,
  value,
  day,
  at: new Date(Date.UTC(2026, 0, 1) + day * 86400000 + min * 60000).toISOString(),
  source: 'manual',
  device: 'x',
})
const NORMAL: Values = { sys: 118, dia: 76, hr: 65, spo2: 98, temp: 36.7, glucose: 90, sleep: 7.5, mood: 4, exercise: 100, vision: 5, water: 2.8 }
const snap = (patch: Partial<Values> = {}) => (Object.keys({ ...NORMAL, ...patch }) as FieldId[]).map((k) => row(k, { ...NORMAL, ...patch }[k]))
const M = { context: 'space' as const, profileId: 'iss', day: 142 }
const ALL: VitalKey[] = ['bp', 'hr', 'spo2', 'temp', 'glucose', 'sleep', 'mood', 'exercise', 'vision', 'water']

describe('alertAction', () => {
  it('maps measured vitals to re-measure and daily logs to log', () => {
    expect(alertAction({ key: 'bp' }, ALL)).toEqual({ key: 'bp', label: 'Re-measure' })
    expect(alertAction({ key: 'spo2' }, ALL)?.label).toBe('Re-measure')
    expect(alertAction({ key: 'water' }, ALL)).toEqual({ key: 'water', label: 'Log water' })
    expect(alertAction({ key: 'mood' }, ALL)?.label).toBe('Log mood')
    expect(alertAction({ key: 'vision' }, ALL)?.label).toBe('Repeat check')
  })
  it('maps the sleep trend alert to the sleep form', () => {
    expect(alertVitalKey({ key: 'sleep-trend' })).toBe('sleep')
    expect(alertAction({ key: 'sleep-trend' }, ALL)).toEqual({ key: 'sleep', label: 'Log sleep' })
  })
  it('has no action for radiation, unknown keys or vitals this profile cannot log', () => {
    expect(alertAction({ key: 'rad' }, ALL)).toBeNull()
    expect(alertAction({ key: 'toString' }, ALL)).toBeNull()
    expect(alertAction({ key: 'vision' }, ['bp', 'hr'])).toBeNull()
  })
})

describe('describeSave', () => {
  it('reports a cleared alert with the previous value', () => {
    const rows = snap({ sys: 138, dia: 88 })
    const before = evaluate(rows, M)
    expect(alertLevelFor(before, 'bp')).toBe('warn')
    const after = evaluate([...rows, row('sys', 118, 142, 5), row('dia', 76, 142, 5)], M)
    const out = describeSave('bp', before, after)!
    expect(out.title).toBe('Blood pressure saved: 118/76 mmHg')
    expect(out.detail).toBe('Before: 138/88 mmHg. The alert has cleared.')
    expect(out.tone).toBe('ok')
  })
  it('reports an alert that stays on', () => {
    const rows = snap({ sys: 138, dia: 88 })
    const out = describeSave('bp', evaluate(rows, M), evaluate([...rows, row('sys', 136, 142, 5), row('dia', 86, 142, 5)], M))!
    expect(out.detail).toBe('Before: 138/88 mmHg. Still needs attention. The alert stays on.')
    expect(out.tone).toBe('warn')
  })
  it('reports a new alert', () => {
    const rows = snap()
    const out = describeSave('bp', evaluate(rows, M), evaluate([...rows, row('sys', 138, 142, 5), row('dia', 88, 142, 5)], M))!
    expect(out.detail).toBe('Before: 118/76 mmHg. New alert: needs attention.')
  })
  it('handles a first reading (no evaluation before)', () => {
    const out = describeSave('hr', null, evaluate([row('hr', 70)], M))!
    expect(out.title).toBe('Heart rate saved: 70 bpm')
    expect(out.detail).toBe('First reading. Rated normal. No alert.')
  })
  it('returns null when the vital has no reading after the save', () => {
    expect(describeSave('glucose', null, evaluate([row('hr', 70)], M))).toBeNull()
  })
})
