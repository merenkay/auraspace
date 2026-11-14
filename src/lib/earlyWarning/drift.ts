// Personal-baseline drift and trend detection for one measurement. Deterministic: same rows in, same result out.
// Methods and constants: src/data/earlyWarning/rules.ts (each either sourced or labelled "AURA rule").
import { vitalFor, type Context } from '../../data/contexts'
import { EW } from '../../data/earlyWarning/rules'
import type { EwSourceId } from '../../data/earlyWarning/sources'
import type { Status } from '../../data/vitals'
import { seriesOf } from '../health'
import type { Measurement } from '../types'
import { decimalsOf, limitsFor, stepOf, type EwMetric, type Limits } from './metrics'
import { mad, mannKendall, median, modifiedZ, rSquared, theilSen, type Pt } from './stats'

export type RuleFamily = 'trend' | 'shift' | 'target'
export type FiredRule = { id: string; family: RuleFamily; text: string; source: EwSourceId | null }

export type Baseline = { median: number; spread: number; n: number; outliers: number; fromDay: number; toDay: number; points: Pt[] }
export type Trend = { slope: number; intercept: number; z: number; p: number; r2: number; n: number; significant: boolean; worse: boolean }
export type Projection = { target: number; line: 'attention' | 'urgent'; days: number; atDay: number; phrase: string }

export type MetricAnalysis = {
  metric: EwMetric
  state: 'signal' | 'stable' | 'insufficient' | 'stale'
  /** Plain-language reasons why something could not be checked, and what is needed. */
  needs: string[]
  recent: Pt[]
  baseline: Baseline | null
  trend: Trend | null
  rules: FiredRule[]
  limits: Limits
  projection: Projection | null
  /** Why no projection was drawn although there is a trend (shown as the quality note). */
  projectionNote: string | null
  /** Recent median minus baseline median, in units of the usual spread (descriptive only). */
  shift: number | null
  sleepDebt: { hours: number; nights: number; mean: number; target: number } | null
  streak: number
  latestStatus: Status | null
  level: 'early' | 'watch' | null
  families: RuleFamily[]
}

export type DriftOptions = { today: number; ctx: Context }

/** Number for text: fixed decimals if given, else 0 dp from 10, 1 dp from 1, two significant digits below 1. */
export const fmtNum = (x: number, dec?: number) => {
  if (dec != null) return x.toFixed(dec)
  const a = Math.abs(x)
  return a >= 10 ? x.toFixed(0) : a >= 1 ? x.toFixed(1) : String(Number(x.toPrecision(2)))
}

/** Analyse one measurement for the person's whole record. */
export function analyseMetric(rows: readonly Measurement[], m: EwMetric, opt: DriftOptions): MetricAnalysis {
  const { today, ctx } = opt
  const def = vitalFor(m.key, ctx)
  const limits = limitsFor(m, ctx)
  const dec = decimalsOf(m.field)
  const sign = m.worse === 'up' ? 1 : -1
  const all = seriesOf(rows as Measurement[], m.field, EW.RECENT_DAYS + EW.BASELINE_DAYS, today).filter((p) => p.day <= today)
  const recent = all.filter((p) => p.day > today - EW.RECENT_DAYS)
  const basePts = all.filter((p) => p.day <= today - EW.RECENT_DAYS)
  const needs: string[] = []
  const rules: FiredRule[] = []
  const latest = recent.at(-1) ?? null
  const latestStatus: Status | null = latest ? def.evaluate({ ...probeValues(), [m.field]: latest.value }) : null

  const base: MetricAnalysis = {
    metric: m, state: 'insufficient', needs, recent, baseline: null, trend: null, rules, limits, projection: null, projectionNote: null,
    shift: null, sleepDebt: null, streak: 0, latestStatus, level: null, families: [],
  }

  // Missing data is never treated as normal.
  const newestDay = all.at(-1)?.day
  if (newestDay == null) {
    needs.push(`No ${m.name.toLowerCase()} readings in the last ${EW.RECENT_DAYS + EW.BASELINE_DAYS} days.`)
    return base
  }
  if (newestDay < today - EW.STALE_DAYS) {
    needs.push(`No reading in the last ${EW.STALE_DAYS} days (newest is ${today - newestDay} days old), so AURA cannot tell whether it is changing.`)
    return { ...base, state: 'stale' }
  }

  // Personal baseline: median of the earlier window after setting aside potential outliers (modified Z > 3.5).
  let baseline: Baseline | null = null
  if (basePts.length >= EW.MIN_BASELINE) {
    const v0 = basePts.map((p) => p.value)
    const med0 = median(v0)
    const mad0 = mad(v0)
    const kept = mad0 > 0 ? basePts.filter((p) => Math.abs(modifiedZ(p.value, med0, mad0, EW.MZ_CONST)) <= EW.MZ_OUTLIER) : basePts
    const kv = kept.map((p) => p.value)
    const spread = Math.max(mad(kv) / EW.MZ_CONST, stepOf(m.field))
    baseline = { median: median(kv), spread, n: kept.length, outliers: basePts.length - kept.length, fromDay: basePts[0].day, toDay: basePts.at(-1)!.day, points: basePts }
  } else {
    needs.push(`A personal baseline needs at least ${EW.MIN_BASELINE} daily readings from more than ${EW.RECENT_DAYS} days ago (has ${basePts.length}). Until then the run rules are off.`)
  }

  // Trend over the recent window: Mann–Kendall test + Theil–Sen slope.
  let trend: Trend | null = null
  if (recent.length >= EW.MIN_TREND) {
    const mk = mannKendall(recent.map((p) => p.value))
    const ts = theilSen(recent)
    if (ts) {
      const significant = Math.abs(mk.z) >= EW.ALPHA_Z
      trend = { slope: ts.slope, intercept: ts.intercept, z: mk.z, p: mk.p, r2: rSquared(recent, ts), n: recent.length, significant, worse: sign * ts.slope > 0 && sign * mk.z > 0 }
      if (significant && trend.worse)
        rules.push({ id: 'trend', family: 'trend', text: `Steady ${m.worse === 'up' ? 'rise' : 'fall'} over the last ${EW.RECENT_DAYS} days (Mann–Kendall p ${pText(mk.p)}).`, source: 'mannKendall' })
    }
  } else {
    needs.push(`A trend test needs at least ${EW.MIN_TREND} readings in the last ${EW.RECENT_DAYS} days (has ${recent.length}).`)
  }

  // Western Electric run rules against the person's own median and spread (worse side only).
  if (baseline) {
    const dev = recent.map((p) => (sign * (p.value - baseline!.median)) / baseline!.spread)
    const last = (n: number) => dev.slice(-n)
    const side = m.worse === 'up' ? 'above' : 'below'
    if (dev.length >= EW.WE_RUN && last(EW.WE_RUN).every((d) => d > 0)) {
      let k = 0
      for (let i = dev.length - 1; i >= 0 && dev[i] > 0; i--) k++
      rules.push({ id: 'run8', family: 'shift', text: `${k} readings in a row ${side} the personal baseline median.`, source: 'nistControl' })
    }
    const [a4, n5, s1] = EW.WE_4OF5
    if (dev.length >= n5 && last(n5).filter((d) => d > s1).length >= a4) rules.push({ id: '4of5', family: 'shift', text: `${a4} of the last ${n5} readings more than 1 usual spread ${side} the baseline.`, source: 'nistControl' })
    const [a2, n3, s2] = EW.WE_2OF3
    if (dev.length >= n3 && last(n3).filter((d) => d > s2).length >= a2) rules.push({ id: '2of3', family: 'shift', text: `${a2} of the last ${n3} readings more than 2 usual spreads ${side} the baseline.`, source: 'nistControl' })
    if (dev.length && dev[dev.length - 1] > EW.WE_EXTREME_SIGMA) rules.push({ id: 'extreme', family: 'shift', text: `The latest reading is more than ${EW.WE_EXTREME_SIGMA} usual spreads ${side} the baseline.`, source: 'nistControl' })
  }
  if (recent.length >= EW.WE_TREND_RUN) {
    const r = recent.slice(-EW.WE_TREND_RUN)
    if (r.every((p, i) => i === 0 || sign * (p.value - r[i - 1].value) > 0))
      rules.push({ id: 'trend6', family: 'trend', text: `${EW.WE_TREND_RUN} readings in a row, each ${m.worse === 'up' ? 'higher' : 'lower'} than the one before.`, source: 'nistControl' })
  }

  // Daily-target rules: below-target streak, and sleep debt.
  let streak = 0
  let sleepDebt: MetricAnalysis['sleepDebt'] = null
  if (m.target && limits.okEdge != null) {
    const below = (v: number) => def.evaluate({ ...probeValues(), [m.field]: v }) !== 'ok'
    for (let i = recent.length - 1; i >= 0; i--) {
      if (!below(recent[i].value)) break
      if (i < recent.length - 1 && recent[i + 1].day - recent[i].day !== 1) break // a missing day ends the streak
      streak++
    }
    if (streak >= EW.STREAK_DAYS) rules.push({ id: 'streak', family: 'target', text: `Below the ${fmtNum(limits.okEdge, dec)} ${m.unit} daily target ${streak} days in a row.`, source: null })
    if (m.field === 'sleep') {
      if (recent.length >= EW.MIN_SLEEP_NIGHTS) {
        const target = limits.okEdge
        const hours = recent.reduce((s, p) => s + Math.max(0, target - p.value), 0)
        const mean = recent.reduce((s, p) => s + p.value, 0) / recent.length
        sleepDebt = { hours: +hours.toFixed(1), nights: recent.length, mean: +mean.toFixed(2), target }
        if (hours >= EW.SLEEP_DEBT_HOURS) rules.push({ id: 'sleepDebt', family: 'target', text: `About ${fmtNum(hours, 1)} h below the ${fmtNum(target, 1)} h target over the last ${recent.length} nights.`, source: null })
        if (mean <= EW.SLEEP_RESTRICTED_H)
          rules.push({ id: 'sleepRestricted', family: 'target', text: `Average ${fmtNum(mean, 1)} h a night over ${recent.length} nights — at or below the ${EW.SLEEP_RESTRICTED_H} h restriction that caused cumulative deficits in a 14-day laboratory study.`, source: 'vanDongen2003' })
      } else {
        needs.push(`Sleep debt needs at least ${EW.MIN_SLEEP_NIGHTS} of the last ${EW.RECENT_DAYS} nights logged (has ${recent.length}).`)
      }
    }
  }

  // Projection to the next line, only for a good, significant, worsening fit.
  let projection: Projection | null = null
  let projectionNote: string | null = null
  if (trend?.significant && trend.worse) {
    const f0 = trend.intercept + trend.slope * today
    const up = m.worse === 'up'
    const targets: { value: number | null; line: 'attention' | 'urgent' }[] = up
      ? [
          { value: limits.warnAt, line: 'attention' },
          { value: limits.critAt, line: 'urgent' },
        ]
      : [
          { value: limits.okEdge, line: 'attention' },
          { value: limits.critAt != null ? +(limits.critAt + Math.min(1, stepOf(m.field))).toFixed(dec) : null, line: 'urgent' },
        ]
    const next = targets.find((t) => t.value != null && (up ? f0 < t.value : f0 > t.value))
    if (latestStatus === 'crit' || !next) projectionNote = 'Already past the urgent line, so there is nothing left to project.'
    else if (trend.n < EW.MIN_PROJECTION) projectionNote = `No projection: needs ${EW.MIN_PROJECTION} readings in ${EW.RECENT_DAYS} days (has ${trend.n}).`
    else if (trend.r2 < EW.MIN_R2) projectionNote = `No projection: the straight line explains only ${Math.max(0, Math.round(trend.r2 * 100))}% of the variation (needs ${EW.MIN_R2 * 100}%).`
    else {
      const days = Math.abs((next.value! - f0) / trend.slope)
      if (days > EW.MAX_PROJECTION_DAYS) projectionNote = `At this pace it would not reach the ${next.line} line within ${EW.MAX_PROJECTION_DAYS} days.`
      else {
        const rounded = Math.max(1, Math.round(days))
        const phrase = up ? `reach ${fmtNum(next.value!, dec)} ${m.unit}` : `fall below ${fmtNum(next.value!, dec)} ${m.unit}`
        projection = { target: next.value!, line: next.line, days: rounded, atDay: today + days, phrase }
      }
    }
  }

  const families = [...new Set(rules.map((r) => r.family))]
  const strongTarget = rules.some((r) => r.id === 'sleepRestricted')
  const level: MetricAnalysis['level'] = (families.includes('trend') && families.includes('shift')) || projection || strongTarget ? 'early' : rules.length ? 'watch' : null
  const shift = baseline && recent.length ? (median(recent.map((p) => p.value)) - baseline.median) / baseline.spread : null

  const ran = trend != null || baseline != null
  return {
    ...base,
    state: rules.length ? 'signal' : ran ? 'stable' : 'insufficient',
    baseline,
    trend,
    rules,
    projection,
    projectionNote,
    shift,
    sleepDebt,
    streak,
    level,
    families,
  }
}

const pText = (p: number) => (p < 0.001 ? '< 0.001' : `= ${p.toFixed(3)}`)
export { pText }

// Plainly normal values for every field, so a single field can be evaluated on its own.
function probeValues() {
  return { sys: 115, dia: 75, hr: 65, spo2: 98, temp: 36.8, glucose: 85, sleep: 8, mood: 5, exercise: 120, vision: 5, water: 3 }
}
