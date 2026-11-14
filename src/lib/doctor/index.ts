// Public surface of the offline consultation engine.
import type { Evaluation } from '../health'
import type { FieldId } from '../../data/vitals'
import type { Readings } from './engine'

export * from './engine'
export * from './findings'
export * from './parse'
export * from './plan'
export * from './meds'
export { localise } from './localise'

/** Only measured values are passed on — the evaluation's fallback numbers are never treated as readings. */
export function readingsFromEvaluation(ev: Evaluation | null): Readings {
  const out: Readings = {}
  if (!ev) return out
  for (const [k, m] of Object.entries(ev.meta)) {
    if (m) out[k as FieldId] = { value: ev.values[k as FieldId], at: m.at }
  }
  return out
}
