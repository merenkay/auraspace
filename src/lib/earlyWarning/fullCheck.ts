// The optional NEWS2 "full check" (respiration rate, air or oxygen, consciousness + the four AURA readings,
// entered together). Stored on this device only, per record — never sent to the server and never added to the
// measurements, because the server's measurement allow-list has no respiration rate / oxygen / consciousness.
import { ACVPU_LABEL, type Acvpu } from '../../data/earlyWarning/news2'
import type { FullCheck } from './news2'

const KEY = 'aura.earlyWarning.fullCheck.v1'

/** Accepted ranges for the form. RR is an AURA plausibility range; the others are the existing entry limits in vitals.ts. */
export const CHECK_RANGE = { rr: [1, 80], pulse: [20, 220], spo2: [50, 100], temp: [30, 43], sys: [60, 250] } as const

function readAll(): Record<string, FullCheck> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

export function validCheck(c: unknown): c is FullCheck {
  if (!c || typeof c !== 'object') return false
  const x = c as Record<string, unknown>
  const inRange = (k: keyof typeof CHECK_RANGE) => typeof x[k] === 'number' && Number.isFinite(x[k]) && (x[k] as number) >= CHECK_RANGE[k][0] && (x[k] as number) <= CHECK_RANGE[k][1]
  return (
    typeof x.at === 'string' &&
    Number.isFinite(Date.parse(x.at)) &&
    (x.o2 === 'air' || x.o2 === 'oxygen') &&
    typeof x.acvpu === 'string' &&
    x.acvpu in ACVPU_LABEL &&
    (['rr', 'pulse', 'spo2', 'temp', 'sys'] as const).every(inRange)
  )
}

export function loadCheck(crewId: number): FullCheck | null {
  const c = readAll()[String(crewId)]
  return validCheck(c) ? c : null
}

export function saveCheck(crewId: number, check: FullCheck): boolean {
  if (!validCheck(check)) return false
  const all = readAll()
  all[String(crewId)] = check
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
    window.dispatchEvent(new CustomEvent(CHECK_EVENT, { detail: { crewId } }))
    return true
  } catch {
    return false
  }
}

export function clearCheck(crewId: number) {
  const all = readAll()
  delete all[String(crewId)]
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
    window.dispatchEvent(new CustomEvent(CHECK_EVENT, { detail: { crewId } }))
  } catch {
    /* nothing stored */
  }
}

export const CHECK_EVENT = 'aura:early-warning-check'
export type { Acvpu }
