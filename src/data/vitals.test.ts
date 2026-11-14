import { describe, expect, it } from 'vitest'
import { VITAL_BY_KEY, VITALS, worst, type Status, type Values, type VitalKey } from './vitals'

const NORMAL: Values = { sys: 118, dia: 76, hr: 65, spo2: 98, temp: 36.7, glucose: 90, sleep: 7.5, mood: 4, exercise: 100, vision: 5, water: 2.8 }
const ev = (key: VitalKey, patch: Partial<Values>) => VITAL_BY_KEY[key].evaluate({ ...NORMAL, ...patch })

type Case = [Partial<Values>, Status]
const TABLE: Record<VitalKey, Case[]> = {
  bp: [
    [{ sys: 129, dia: 79 }, 'ok'],
    [{ sys: 130, dia: 79 }, 'warn'],
    [{ sys: 129, dia: 80 }, 'warn'],
    [{ sys: 139, dia: 89 }, 'warn'],
    [{ sys: 140, dia: 70 }, 'crit'],
    [{ sys: 120, dia: 90 }, 'crit'],
    [{ sys: 90, dia: 60 }, 'ok'],
    [{ sys: 89, dia: 60 }, 'crit'], // low systolic is treated as urgent
  ],
  hr: [
    [{ hr: 39 }, 'crit'],
    [{ hr: 40 }, 'warn'],
    [{ hr: 49 }, 'warn'],
    [{ hr: 50 }, 'ok'],
    [{ hr: 100 }, 'ok'],
    [{ hr: 101 }, 'warn'],
    [{ hr: 120 }, 'warn'],
    [{ hr: 121 }, 'crit'],
  ],
  spo2: [
    [{ spo2: 91 }, 'crit'],
    [{ spo2: 92 }, 'warn'],
    [{ spo2: 94 }, 'warn'],
    [{ spo2: 95 }, 'ok'],
    [{ spo2: 100 }, 'ok'],
  ],
  temp: [
    [{ temp: 34.9 }, 'crit'],
    [{ temp: 35 }, 'warn'],
    [{ temp: 36 }, 'warn'],
    [{ temp: 36.1 }, 'ok'],
    [{ temp: 37.5 }, 'ok'],
    [{ temp: 37.6 }, 'warn'],
    [{ temp: 38 }, 'warn'],
    [{ temp: 38.1 }, 'crit'],
  ],
  glucose: [
    [{ glucose: 59 }, 'crit'],
    [{ glucose: 60 }, 'warn'],
    [{ glucose: 69 }, 'warn'],
    [{ glucose: 70 }, 'ok'],
    [{ glucose: 99 }, 'ok'],
    [{ glucose: 100 }, 'warn'],
    [{ glucose: 125 }, 'warn'],
    [{ glucose: 126 }, 'crit'],
  ],
  sleep: [
    [{ sleep: 4.9 }, 'crit'],
    [{ sleep: 5 }, 'warn'],
    [{ sleep: 6.9 }, 'warn'],
    [{ sleep: 7 }, 'ok'],
  ],
  mood: [
    [{ mood: 1 }, 'crit'],
    [{ mood: 2 }, 'crit'],
    [{ mood: 3 }, 'warn'],
    [{ mood: 4 }, 'ok'],
    [{ mood: 5 }, 'ok'],
  ],
  exercise: [
    [{ exercise: 44 }, 'crit'],
    [{ exercise: 45 }, 'warn'],
    [{ exercise: 89 }, 'warn'],
    [{ exercise: 90 }, 'ok'],
  ],
  vision: [
    [{ vision: 1 }, 'crit'],
    [{ vision: 2 }, 'crit'],
    [{ vision: 3 }, 'warn'],
    [{ vision: 4 }, 'ok'],
    [{ vision: 5 }, 'ok'],
  ],
  water: [
    [{ water: 1.4 }, 'crit'],
    [{ water: 1.5 }, 'warn'],
    [{ water: 2.4 }, 'warn'],
    [{ water: 2.5 }, 'ok'],
  ],
}

describe('space thresholds at every boundary', () => {
  for (const key of Object.keys(TABLE) as VitalKey[]) {
    it(key, () => {
      for (const [patch, want] of TABLE[key]) expect(ev(key, patch), JSON.stringify(patch)).toBe(want)
    })
  }

  it('all vitals have a table and a normal baseline', () => {
    expect(Object.keys(TABLE).sort()).toEqual(VITALS.map((v) => v.key).sort())
    for (const v of VITALS) expect(v.evaluate(NORMAL), v.key).toBe('ok')
  })
})

describe('displayed range text agrees with evaluate()', () => {
  it('numbers quoted in `ranges` match the rule', () => {
    expect(VITAL_BY_KEY.bp.ranges).toMatch(/< 130\/80/)
    expect(VITAL_BY_KEY.bp.ranges).toMatch(/≥ 140\/90/)
    expect(VITAL_BY_KEY.hr.ranges).toMatch(/50–100/)
    expect(VITAL_BY_KEY.spo2.ranges).toMatch(/≥ 95.*92–94.*< 92/)
    expect(VITAL_BY_KEY.temp.ranges).toMatch(/36\.1–37\.5.*37\.6–38\.0.*> 38\.0/)
    expect(VITAL_BY_KEY.glucose.ranges).toMatch(/70–99.*100–125.*≥ 126.*< 60/)
    expect(VITAL_BY_KEY.sleep.ranges).toMatch(/≥ 7 h.*5–6\.9 h.*< 5 h/)
    expect(VITAL_BY_KEY.mood.ranges).toMatch(/4–5.*3.*1–2/)
    expect(VITAL_BY_KEY.exercise.ranges).toMatch(/≥ 90.*45–89.*< 45/)
    expect(VITAL_BY_KEY.vision.ranges).toMatch(/4–5.*3.*1–2/)
    expect(VITAL_BY_KEY.water.ranges).toMatch(/≥ 2\.5.*1\.5–2\.4.*< 1\.5/)
  })

  it('ranges mention the low side where the rule flags low readings', () => {
    expect(VITAL_BY_KEY.bp.ranges).toMatch(/< 90/)
    expect(VITAL_BY_KEY.temp.ranges).toMatch(/35\.0–36\.0/)
    expect(VITAL_BY_KEY.temp.ranges).toMatch(/< 35/)
    expect(VITAL_BY_KEY.glucose.ranges).toMatch(/60–69/)
  })
})

describe('worst()', () => {
  it('picks the most severe status', () => {
    expect(worst([])).toBe('ok')
    expect(worst(['ok', 'warn'])).toBe('warn')
    expect(worst(['warn', 'crit', 'ok'])).toBe('crit')
  })
})
