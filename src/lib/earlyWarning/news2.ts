// NEWS2 scoring (RCP 2017) on the bands in src/data/earlyWarning/news2.ts.
// AURA measures four of the seven parameters (pulse, SpO2, temperature, systolic pressure). Without the other three
// (respiration rate, supplemental oxygen, consciousness) the result is a *partial* score that never claims the
// official aggregate or its response bands. A complete score needs a "full check" entered together.
import {
  NEWS2_ACVPU_SCORE,
  NEWS2_BANDS,
  NEWS2_DECIMALS,
  NEWS2_O2_SCORE,
  NEWS2_PARAMS,
  NEWS2_TRIGGER,
  type Acvpu,
  type News2Param,
  type News2Trigger,
} from '../../data/earlyWarning/news2'
import { EW } from '../../data/earlyWarning/rules'
import type { Measurement } from '../types'

type Numeric = keyof typeof NEWS2_BANDS

/** Round to the chart's recording precision (whole numbers; temperature to 0.1 °C) so every value falls in exactly one band. */
export function roundForChart(param: Numeric, value: number): number {
  const p = 10 ** NEWS2_DECIMALS[param]
  return Math.round(value * p) / p
}

/** Chart 1 score for one numeric parameter, or null for a missing / non-finite value. */
export function scoreParam(param: Numeric, value: number | null | undefined): 0 | 1 | 2 | 3 | null {
  if (value == null || !Number.isFinite(value)) return null
  const v = roundForChart(param, value)
  const band = NEWS2_BANDS[param].find((b) => (b.lo == null || v >= b.lo) && (b.hi == null || v <= b.hi))
  return band ? band.score : null
}

export type News2Inputs = {
  rr?: number | null
  spo2?: number | null
  o2?: 'air' | 'oxygen' | null
  sys?: number | null
  pulse?: number | null
  acvpu?: Acvpu | null
  temp?: number | null
}

export type News2Item = { param: News2Param; value: number | string | null; score: 0 | 1 | 2 | 3 | null; at?: string; source: 'reading' | 'full-check' | 'missing'; note?: string }

export type News2Result = {
  items: News2Item[]
  /** Parameters with a score, out of 7. */
  scored: number
  complete: boolean
  /** Sum of the scored parameters. For a partial result this is NOT a NEWS2 total. */
  points: number
  /** Any single parameter scoring 3 ("red score" in Chart 2) — surfaced even when partial. */
  red: News2Param[]
  /** Chart 2 trigger, only for a complete score. */
  trigger: News2Trigger | null
}

export function scoreNews2(input: News2Inputs, meta: Partial<Record<News2Param, { at?: string; source?: News2Item['source']; note?: string }>> = {}): News2Result {
  const items: News2Item[] = NEWS2_PARAMS.map((param) => {
    let value: number | string | null = null
    let score: 0 | 1 | 2 | 3 | null = null
    if (param === 'o2') {
      value = input.o2 ?? null
      score = input.o2 ? NEWS2_O2_SCORE[input.o2] : null
    } else if (param === 'acvpu') {
      value = input.acvpu ?? null
      score = input.acvpu ? NEWS2_ACVPU_SCORE[input.acvpu] : null
    } else {
      const raw = input[param]
      score = scoreParam(param, raw)
      value = score == null ? null : roundForChart(param, raw!)
    }
    const m = meta[param]
    return { param, value, score, at: m?.at, source: score == null ? 'missing' : (m?.source ?? 'reading'), note: m?.note }
  })
  const scored = items.filter((i) => i.score != null).length
  const points = items.reduce((s, i) => s + (i.score ?? 0), 0)
  const red = items.filter((i) => i.score === 3).map((i) => i.param)
  const complete = scored === NEWS2_PARAMS.length
  return { items, scored, complete, points, red, trigger: complete ? triggerOf(points, red.length > 0) : null }
}

/** Chart 2 trigger for a complete aggregate: 7+ high, 5–6 medium, any single 3 red, otherwise low. */
export function triggerOf(total: number, anyRed: boolean): News2Trigger {
  if (total >= 7) return 'high'
  if (total >= 5) return 'medium'
  if (anyRed) return 'red'
  return 'low'
}

export function triggerText(t: News2Trigger) {
  return NEWS2_TRIGGER[t]
}

/** A full check stored on this device: all seven parameters entered at one time. */
export type FullCheck = { at: string; rr: number; o2: 'air' | 'oxygen'; acvpu: Acvpu; pulse: number; spo2: number; temp: number; sys: number }

const hoursSince = (iso: string, now: number) => (now - Date.parse(iso)) / 3600000

/**
 * NEWS2 for the latest data: a current full check gives a complete score; otherwise device readings
 * no older than 24 h give a partial score (missing parameters say so — they are never scored as 0).
 */
export function news2FromData(rows: readonly Measurement[], now: number, check: FullCheck | null): News2Result & { checkAt: string | null; expiredCheckAt: string | null } {
  if (check && hoursSince(check.at, now) >= 0 && hoursSince(check.at, now) <= EW.NEWS2_FULLCHECK_MAX_AGE_H) {
    const src = { at: check.at, source: 'full-check' as const }
    const r = scoreNews2(check, Object.fromEntries(NEWS2_PARAMS.map((p) => [p, src])))
    return { ...r, checkAt: check.at, expiredCheckAt: null }
  }
  const newest = (metric: Measurement['metric']) => {
    let best: Measurement | null = null
    for (const r of rows) if (r.metric === metric && (!best || Date.parse(r.at) > Date.parse(best.at))) best = r
    return best
  }
  const meta: Partial<Record<News2Param, { at?: string; note?: string }>> = {}
  const pick = (param: News2Param, metric: Measurement['metric']) => {
    const r = newest(metric)
    if (!r) {
      meta[param] = { note: 'Never measured' }
      return null
    }
    const age = hoursSince(r.at, now)
    if (!(age <= EW.NEWS2_READING_MAX_AGE_H)) {
      meta[param] = { at: r.at, note: `Last reading over ${EW.NEWS2_READING_MAX_AGE_H} h old` }
      return null
    }
    meta[param] = { at: r.at }
    return r.value
  }
  const input: News2Inputs = { pulse: pick('pulse', 'hr'), spo2: pick('spo2', 'spo2'), temp: pick('temp', 'temp'), sys: pick('sys', 'sys') }
  for (const p of ['rr', 'o2', 'acvpu'] as const) meta[p] = { note: 'Not measured — needs a full check' }
  const r = scoreNews2(input, meta)
  return { ...r, checkAt: null, expiredCheckAt: check ? check.at : null }
}
