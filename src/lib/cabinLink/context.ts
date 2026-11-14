// Cabin-air link: turns stored environment-station rows into a small "environment context" for the
// AURA consultation, and folds it into the assessment conservatively. Pure functions, no I/O, no AI.
//
// What is sourced and what is AURA's own modelling:
//   - the 18–27 °C / 25–75 % bands are NASA's crew-health habitat bands (CABIN_LIMITS, OCHMO-TB-002)
//   - the 1.5× / 2× gas-ratio levels are AURA demo thresholds on an uncalibrated sensor          → AURA rule
//   - the 3-hour look-back, the 15-minute "fresh" limit, the 5-minute gap, the factor weights     → AURA rule
//   - which symptoms each factor is linked to comes from src/data/cabinLink/sources.ts (sourced)
// The MQ-2 reacts to combustible gas and smoke. It does NOT measure carbon monoxide or CO₂, so nothing here
// ever says it does, and a normal reading never counts as "air is fine".
import { CABIN_LIMITS } from '../../data/missions'
import { URGENCY_RANK, type Urgency } from '../../data/conditions/types'
import type { Context } from '../../data/contexts'
import { GAS_ALARM_RATIO, GAS_WARN_RATIO, rowRatio, type EnvRow } from '../envStation'
import { assess, type Answers, type Assessment, type EngineInput } from '../doctor/engine'

/** AURA rule: how far back the consultation looks at the air. */
export const LOOKBACK_MS = 3 * 3_600_000
/** AURA rule: the newest reading must be at most this old to count as "now". */
export const FRESH_MS = 15 * 60_000
/** AURA rule: rows further apart than this break an "elevated since" run. */
export const RUN_GAP_MS = 5 * 60_000

export type DataQuality = 'fresh' | 'stale' | 'none'
export type FactorId = 'gas' | 'heat' | 'humid' | 'cold' | 'dry'

export type CabinFactor = {
  id: FactorId
  /** 'alarm' only for gas at/above the alarm ratio. */
  level: 'warn' | 'alarm'
  /** The newest reading is fresh and still shows it. */
  now: boolean
  /** Start of the latest run of elevated readings (ms, local clock). */
  since: number
  /** Latest elevated reading (ms, local clock). */
  lastAt: number
  /** Highest value in the look-back (gas: ratio; heat/humid: max; cold/dry: min). */
  peak: number
}

export type CabinContext = {
  context: Context
  quality: DataQuality
  /** Newest reading time (ms, local clock), or null when there is none. */
  latestAt: number | null
  ageMs: number | null
  latest: { t: number | null; h: number | null; ratio: number | null } | null
  /** Rows inside the look-back window. */
  rows: number
  factors: CabinFactor[]
}

type Test = { id: FactorId; value: (r: EnvRow) => number | null; hit: (v: number) => boolean; alarm?: (v: number) => boolean; high: boolean }

const TESTS: Test[] = [
  { id: 'gas', value: (r) => rowRatio(r), hit: (v) => v >= GAS_WARN_RATIO, alarm: (v) => v >= GAS_ALARM_RATIO, high: true },
  { id: 'heat', value: (r) => r.t, hit: (v) => v > CABIN_LIMITS.tempMax, high: true },
  { id: 'humid', value: (r) => r.h, hit: (v) => v > CABIN_LIMITS.rhMax, high: true },
  { id: 'cold', value: (r) => r.t, hit: (v) => v < CABIN_LIMITS.tempMin, high: false },
  { id: 'dry', value: (r) => r.h, hit: (v) => v < CABIN_LIMITS.rhMin, high: false },
]

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * Builds the environment context from stored rows (and the newest row, if loaded separately).
 * `skewMs` = local clock minus server clock, so server timestamps line up with `now`.
 */
export function deriveCabinContext(input: { rows: EnvRow[]; latest?: EnvRow | null; now: number; context: Context; skewMs?: number }): CabinContext {
  const { now, context } = input
  const skew = input.skewMs ?? 0
  const byAt = new Map<number, EnvRow>()
  for (const r of [...input.rows, ...(input.latest ? [input.latest] : [])]) {
    const at = Date.parse(r.at)
    if (Number.isFinite(at) && at + skew <= now + 60_000) byAt.set(at + skew, r)
  }
  const all = [...byAt.entries()].sort((a, b) => a[0] - b[0])
  if (!all.length) return { context, quality: 'none', latestAt: null, ageMs: null, latest: null, rows: 0, factors: [] }
  const [latestAt, last] = all[all.length - 1]
  const ageMs = Math.max(0, now - latestAt)
  const quality: DataQuality = ageMs <= FRESH_MS ? 'fresh' : 'stale'
  const win = all.filter(([at]) => at >= now - LOOKBACK_MS)
  const factors: CabinFactor[] = []
  for (const test of TESTS) {
    let lastHit = -1
    let peak: number | null = null
    let alarm = false
    win.forEach(([, r], i) => {
      const v = num(test.value(r))
      if (v == null || !test.hit(v)) return
      lastHit = i
      peak = peak == null ? v : test.high ? Math.max(peak, v) : Math.min(peak, v)
    })
    if (lastHit < 0 || peak == null) continue
    // walk back from the latest elevated row while rows stay elevated and close together
    let start = lastHit
    while (start > 0) {
      const v = num(test.value(win[start - 1][1]))
      if (v == null || !test.hit(v) || win[start][0] - win[start - 1][0] > RUN_GAP_MS) break
      start--
    }
    for (let i = start; i <= lastHit; i++) {
      const v = num(test.value(win[i][1]))
      if (v != null && test.alarm?.(v)) alarm = true
    }
    const lastV = num(test.value(last))
    factors.push({
      id: test.id,
      level: alarm ? 'alarm' : 'warn',
      now: quality === 'fresh' && lastV != null && test.hit(lastV),
      since: win[start][0],
      lastAt: win[lastHit][0],
      peak,
    })
  }
  return {
    context,
    quality,
    latestAt,
    ageMs,
    latest: { t: num(last.t), h: num(last.h), ratio: num(rowRatio(last)) },
    rows: win.length,
    factors,
  }
}

export const factorOf = (c: CabinContext | null, id: FactorId) => c?.factors.find((f) => f.id === id) ?? null

/** Findings that sourced material links to the factors (see src/data/cabinLink/sources.ts). */
export const AIR_SYMPTOMS = ['headache', 'lightheaded', 'nausea', 'vomiting', 'breathless', 'cough', 'eye-throat-irritation', 'drowsy', 'confusion', 'fatigue', 'wheeze', 'chest-pain']
export const HEAT_SYMPTOMS = ['headache', 'lightheaded', 'fatigue', 'nausea', 'cramps', 'sweating', 'thirst']
export const COLD_SYMPTOMS = ['chills', 'drowsy', 'confusion', 'speech', 'fatigue', 'pale-blue-skin']
export const DRY_SYMPTOMS = ['eye-throat-irritation']
const RELEVANT = new Set([...AIR_SYMPTOMS, ...HEAT_SYMPTOMS, ...COLD_SYMPTOMS, ...DRY_SYMPTOMS])

const yesIds = (answers: Answers) => Object.entries(answers).filter(([, a]) => a === 'yes').map(([id]) => id)

/** Reported symptoms that could plausibly relate to the air, temperature or humidity. */
export const reportedAirSymptoms = (answers: Answers) => yesIds(answers).filter((id) => RELEVANT.has(id))

/**
 * Extra supporting factors for the engine (AURA rule: weights 1–2, never a "key" factor).
 * Only conditions that exist in the person's context are affected by the engine anyway.
 */
export function cabinFactors(c: CabinContext | null): Record<string, { label: string; w: number }[]> {
  const out: Record<string, { label: string; w: number }[]> = {}
  if (!c || c.quality === 'none') return out
  const add = (id: string, label: string, w: number) => (out[id] ??= []).push({ label, w })
  const gas = factorOf(c, 'gas')
  const heat = factorOf(c, 'heat')
  const humid = factorOf(c, 'humid')
  const cold = factorOf(c, 'cold')
  const when = (f: CabinFactor) => (f.now ? 'now' : 'in the last 3 hours')
  if (gas) {
    // Fuel gas or smoke in the air can point to a burning or leaking fuel source; the sensor cannot see CO itself.
    add('carbon-monoxide', `Gas sensor raised ${when(gas)} — fuel gas or smoke may be present (the sensor cannot measure CO)`, gas.now && gas.level === 'alarm' ? 2 : 1)
  }
  if (heat) add('heat-illness', `Room above ${CABIN_LIMITS.tempMax} °C ${when(heat)}${humid ? ', with high humidity' : ''} (sensor station)`, humid ? 2 : 1)
  if (cold) add('hypothermia', `Room below ${CABIN_LIMITS.tempMin} °C ${when(cold)} (sensor station)`, 1)
  return out
}

/** AURA rule: symptoms reported while the gas sensor is at alarm level right now → at least "urgent". */
export function gasAlarmRule(c: CabinContext | null, answers: Answers): string | null {
  const gas = factorOf(c, 'gas')
  if (!gas || !gas.now || gas.level !== 'alarm') return null
  const reported = yesIds(answers).filter((id) => AIR_SYMPTOMS.includes(id))
  if (!reported.length) return null
  return 'AURA rule: symptoms reported while the gas sensor is at its alarm level — leave the area and get checked'
}

const rank = (u: Urgency) => URGENCY_RANK[u]

/**
 * The consultation with the cabin-air context folded in. Guarantees:
 *   - the urgency is never lower than the assessment without the environment
 *   - red-flag (emergency/urgent) rules are evaluated exactly as without the environment
 *   - environment evidence only adds score to matching conditions (it cannot create a candidate on its own)
 */
export function assessWithCabin(input: EngineInput, cabin: CabinContext | null): Assessment {
  const base = assess(input)
  const extra = cabinFactors(cabin)
  const rule = gasAlarmRule(cabin, input.answers)
  if (!Object.keys(extra).length && !rule) return base
  let out = Object.keys(extra).length ? assess({ ...input, extraFactors: { ...input.extraFactors, ...extra } }) : base
  if (rank(out.urgency) < rank(base.urgency)) out = { ...out, urgency: base.urgency, reasons: base.reasons, ruleBased: base.ruleBased, noClearMatch: base.noClearMatch }
  if (rule && rank(out.urgency) < rank('urgent')) out = { ...out, urgency: 'urgent', ruleBased: true, reasons: [...out.reasons, rule] }
  return out
}
