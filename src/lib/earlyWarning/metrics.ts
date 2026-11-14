// Which measurements the early-warning layer watches, which direction is "worse", and the attention/urgent
// lines read from AURA's own rules (vitalFor(...).evaluate) so no threshold is duplicated here.
import { vitalFor, type Context } from '../../data/contexts'
import { VITAL_BY_KEY, type FieldId, type Status, type Values, type VitalKey } from '../../data/vitals'
import type { EwSourceId } from '../../data/earlyWarning/sources'

export type Direction = 'up' | 'down'

export type EwMetric = {
  field: FieldId
  key: VitalKey
  /** Sentence-case name used in findings. */
  name: string
  unit: string
  worse: Direction
  /** Daily-target measurements get the below-target streak rule (and sleep its debt rule). */
  target?: boolean
  private?: boolean
  /** Published evidence that a change in this measurement against a personal baseline matters. */
  evidence?: EwSourceId[]
  /** How a daily rate of change reads best (sleep in minutes per night, water in mL per day). */
  rate?: { unit: string; factor: number; per: string }
}

export const EW_METRICS: EwMetric[] = [
  { field: 'sys', key: 'bp', name: 'Systolic pressure', unit: 'mmHg', worse: 'up' },
  { field: 'hr', key: 'hr', name: 'Resting heart rate', unit: 'bpm', worse: 'up', evidence: ['mishra2020', 'stanford2020'] },
  { field: 'temp', key: 'temp', name: 'Body temperature', unit: '°C', worse: 'up' },
  { field: 'spo2', key: 'spo2', name: 'Blood oxygen', unit: '%', worse: 'down' },
  { field: 'dia', key: 'bp', name: 'Diastolic pressure', unit: 'mmHg', worse: 'up' },
  { field: 'sleep', key: 'sleep', name: 'Sleep', unit: 'h', worse: 'down', target: true, evidence: ['vanDongen2003'], rate: { unit: 'min', factor: 60, per: 'night' } },
  { field: 'mood', key: 'mood', name: 'Mood', unit: 'points', worse: 'down', private: true },
  { field: 'water', key: 'water', name: 'Water intake', unit: 'L', worse: 'down', target: true, rate: { unit: 'mL', factor: 1000, per: 'day' } },
  { field: 'exercise', key: 'exercise', name: 'Exercise', unit: 'min', worse: 'down', target: true },
  { field: 'glucose', key: 'glucose', name: 'Fasting blood sugar', unit: 'mg/dL', worse: 'up' },
]

/** Recording step of a field (vitals.ts); also the smallest "usual spread" AURA will assume. */
export function stepOf(field: FieldId): number {
  for (const d of Object.values(VITAL_BY_KEY)) for (const f of d.fields) if (f.id === field) return f.step
  return 1
}
function rangeOf(field: FieldId): [number, number] {
  for (const d of Object.values(VITAL_BY_KEY)) for (const f of d.fields) if (f.id === field) return [f.min, f.max]
  return [0, 1000]
}
export const decimalsOf = (field: FieldId) => {
  const s = String(stepOf(field))
  return s.includes('.') ? s.split('.')[1].length : 0
}

// Starting point for probing the rules: a plainly normal set of values. Only used to search for the lines below.
const PROBE: Values = { sys: 115, dia: 75, hr: 65, spo2: 98, temp: 36.8, glucose: 85, sleep: 8, mood: 5, exercise: 120, vision: 5, water: 3 }

export type Limits = {
  /** First value (in the worse direction) that AURA's rules mark "attention" / "urgent"; null if none. */
  warnAt: number | null
  critAt: number | null
  /** Last value before the attention line — the daily target for down-direction measurements. */
  okEdge: number | null
}

/** Reads the attention/urgent lines for one field in one context straight from vitalFor(key, ctx).evaluate. */
export function limitsFor(m: EwMetric, ctx: Context): Limits {
  const def = vitalFor(m.key, ctx)
  // Probe in whole units for integer fields (exercise is logged in 5s, but its home target is 21 min).
  const step = Math.min(1, stepOf(m.field))
  const dec = decimalsOf(m.field)
  const [min, max] = rangeOf(m.field)
  const sign = m.worse === 'up' ? 1 : -1
  const status = (x: number): Status => def.evaluate({ ...PROBE, [m.field]: x })
  let warnAt: number | null = null
  let critAt: number | null = null
  let okEdge: number | null = null
  let prev = PROBE[m.field]
  for (let i = 0; ; i++) {
    const x = +(PROBE[m.field] + sign * i * step).toFixed(dec)
    if (x < min || x > max) break
    const s = status(x)
    if (s !== 'ok' && warnAt == null) {
      warnAt = x
      okEdge = prev
    }
    if (s === 'crit') {
      critAt = x
      if (warnAt == null) {
        warnAt = x
        okEdge = prev
      }
      break
    }
    prev = x
  }
  return { warnAt, critAt, okEdge }
}
