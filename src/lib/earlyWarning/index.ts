// Early-warning layer: notices slow deterioration against a person's own baseline before AURA's thresholds are
// crossed, plus a NEWS2 acuity score (partial unless a full check was entered). Deterministic, offline, no AI.
// Additional to src/lib/health.ts: the health score and existing alerts are unchanged.
import { CONTEXTS, vitalFor, type Context } from '../../data/contexts'
import type { EwSourceId } from '../../data/earlyWarning/sources'
import type { Measurement } from '../types'
import { analyseMetric, fmtNum, pText, type MetricAnalysis } from './drift'
import { decimalsOf, EW_METRICS } from './metrics'
import { news2FromData, type FullCheck } from './news2'

export type Viewer = 'self' | 'staff'

export type EarlyWarning = MetricAnalysis & {
  /** One sentence: what changed. */
  finding: string
  /** A few words for one-line summaries and the roster. */
  short: string
  /** How sure AURA is, and on what. */
  quality: string
  /** What to do next, in the person's context. */
  next: string
  sources: EwSourceId[]
  /** True when at least one of the rules that fired is an AURA rule (no published source). */
  usesAuraRule: boolean
}

export type EarlyWarningReport = {
  /** Ranked: early warnings first, then those not yet flagged by a threshold, then the soonest projection, then the most agreeing signs. */
  warnings: EarlyWarning[]
  metrics: MetricAnalysis[]
  /** Measurements that could be compared with something (baseline or trend). */
  checked: MetricAnalysis[]
  /** Measurements that could not be checked, with what is needed. */
  unchecked: MetricAnalysis[]
  news2: ReturnType<typeof news2FromData>
  early: number
  watch: number
  summary: string
}

export type AnalyseOptions = {
  today: number
  ctx: Context
  /** Ground role: never sees mood. */
  hidePrivate: boolean
  /** Milliseconds "now" — only NEWS2 uses it (age of readings). Passed in so results are reproducible. */
  now: number
  check?: FullCheck | null
  viewer?: Viewer
}

// Same wording as the existing lifestyle actions in src/lib/health.ts (ACTION).
const LIFESTYLE: Partial<Record<string, string>> = {
  sleep: 'Keep a fixed sleep window and dim the lights an hour before sleep.',
  exercise: 'Fit in today’s activity; split it into shorter sessions if needed.',
  water: 'Drink a glass now and spread drinks across the day.',
}

export function analyse(rows: readonly Measurement[], opt: AnalyseOptions): EarlyWarningReport {
  const viewer = opt.viewer ?? 'self'
  // Privacy: the ground role never sees mood, even if a mood row slipped through.
  const visibleRows = opt.hidePrivate ? rows.filter((r) => r.metric !== 'mood') : rows
  const hidden = CONTEXTS[opt.ctx].hiddenVitals
  const metrics = EW_METRICS.filter((m) => !(opt.hidePrivate && m.private) && !hidden.includes(m.key)).map((m) => analyseMetric(visibleRows, m, { today: opt.today, ctx: opt.ctx }))
  const order = (a: MetricAnalysis) => EW_METRICS.indexOf(a.metric)
  const warnings = metrics
    .filter((a) => a.level)
    .map((a) => describe(a, opt.ctx, viewer))
    .sort(
      (a, b) =>
        (a.level === 'early' ? 0 : 1) - (b.level === 'early' ? 0 : 1) ||
        // New information first: a reading the threshold rules already flag has its own alert.
        (a.latestStatus === 'ok' ? 0 : 1) - (b.latestStatus === 'ok' ? 0 : 1) ||
        (a.projection?.days ?? Infinity) - (b.projection?.days ?? Infinity) ||
        b.families.length - a.families.length ||
        order(a) - order(b),
    )
  const checked = metrics.filter((a) => a.state === 'signal' || a.state === 'stable')
  const unchecked = metrics.filter((a) => a.state === 'insufficient' || a.state === 'stale')
  const early = warnings.filter((w) => w.level === 'early').length
  const watch = warnings.length - early
  const news2 = news2FromData(visibleRows, opt.now, opt.check ?? null)
  return { warnings, metrics, checked, unchecked, news2, early, watch, summary: summaryLine(warnings, checked.length, metrics.length, early, watch) }
}

function summaryLine(w: EarlyWarning[], checked: number, total: number, early: number, watch: number): string {
  if (!checked && !w.length) return 'Not enough data yet — early warnings need about two weeks of daily readings.'
  if (early) {
    const first = w[0]
    const more = early - 1
    return `${first.short}${more > 0 ? ` · ${more} more early warning${more === 1 ? '' : 's'}` : ''}${watch ? ` · ${watch} worth watching` : ''}`
  }
  if (watch) return `No early warnings · ${watch} small change${watch === 1 ? '' : 's'} worth watching`
  return `No early warnings · ${checked} of ${total} measurements compared with the personal baseline`
}

function describe(a: MetricAnalysis, ctx: Context, viewer: Viewer): EarlyWarning {
  const m = a.metric
  const dec = decimalsOf(m.field)
  const up = m.worse === 'up'
  const has = (id: string) => a.rules.some((r) => r.id === id)
  const span = a.recent.length ? a.recent.at(-1)!.day - a.recent[0].day + 1 : 0

  let finding: string
  let short: string
  if (a.trend && (has('trend') || has('trend6'))) {
    const r = m.rate ?? { unit: m.unit, factor: 1, per: 'day' }
    const rate = fmtNum(Math.abs(a.trend.slope) * r.factor)
    finding = `${m.name} has ${up ? 'risen' : 'fallen'} about ${rate} ${r.unit} per ${r.per} over the last ${span} days.`
    short = `${m.name} ${up ? 'rising' : 'falling'} ~${rate} ${r.unit}/${r.per}`
  } else if (a.baseline && a.rules.some((r) => r.family === 'shift')) {
    const side = up ? 'above' : 'below'
    finding = `${m.name} has been ${side} the personal baseline of ${fmtNum(a.baseline.median, dec)} ${m.unit} lately (${a.rules.find((r) => r.family === 'shift')!.text.replace(/\.$/, '').toLowerCase()}).`
    short = `${m.name} ${side} baseline`
  } else if (a.sleepDebt && (has('sleepDebt') || has('sleepRestricted'))) {
    finding = `About ${fmtNum(a.sleepDebt.hours, 1)} h of sleep missed against the ${fmtNum(a.sleepDebt.target, 1)} h target over the last ${a.sleepDebt.nights} nights (average ${fmtNum(a.sleepDebt.mean, 1)} h).`
    short = `Sleep debt ~${fmtNum(a.sleepDebt.hours, 0)} h in ${a.sleepDebt.nights} nights`
  } else {
    finding = `${m.name} below the ${fmtNum(a.limits.okEdge ?? 0, dec)} ${m.unit} daily target ${a.streak} days in a row.`
    short = `${m.name} below target ${a.streak} days`
  }
  if (a.projection) {
    finding += ` At this pace it would ${a.projection.phrase} (the ${a.projection.line} line) in about ${a.projection.days} day${a.projection.days === 1 ? '' : 's'} — an estimate from a straight line, not a forecast.`
    short += ` · about ${a.projection.days} day${a.projection.days === 1 ? '' : 's'} to ${fmtNum(a.projection.target, dec)} ${m.unit}`
  }
  if (a.latestStatus && a.latestStatus !== 'ok') finding += ' The latest reading is already flagged by the threshold rules.'

  const q: string[] = []
  if (a.trend) {
    q.push(`${a.trend.n} daily readings in the last ${span || 14} days. Trend test p ${pText(a.trend.p)}; the line explains ${Math.max(0, Math.round(a.trend.r2 * 100))}% of the day-to-day variation.`)
  }
  if (a.baseline)
    q.push(
      `Baseline ${fmtNum(a.baseline.median, dec)} ${m.unit} (usual spread ±${fmtNum(a.baseline.spread)}) from ${a.baseline.n} readings${a.baseline.outliers ? `, ${a.baseline.outliers} outlier${a.baseline.outliers === 1 ? '' : 's'} set aside` : ''}.`,
    )
  if (a.projectionNote) q.push(a.projectionNote)
  if (a.level === 'watch') q.push('Only one kind of sign so far, so this may be chance.')
  if (m.field === 'hr') q.push('A rise in resting heart rate cannot tell which illness, if any, is behind it; exercise, stress and some medicines also raise it.')

  const contact = CONTEXTS[ctx].contact
  const soon = a.projection != null && a.projection.days <= 7
  let next: string
  if (viewer === 'staff') {
    next = a.level === 'early' ? (soon ? 'Review this trend with the crew member today, before it reaches the line.' : 'Review this trend with the crew member at the next check-in.') : 'No action needed yet; AURA keeps watching.'
  } else {
    const base =
      a.level === 'early'
        ? soon
          ? `Re-measure at your usual time, the same way as always. Tell your ${contact} about this trend today, before it reaches the line.`
          : `Keep measuring at the same time each day and mention this trend to your ${contact} at the next check-in.`
        : 'Nothing to do yet. Keep measuring at the same time each day; AURA will say if it continues.'
    const life = LIFESTYLE[m.key]
    next = life && a.level === 'early' ? `${base} ${life}` : `${base} ${a.level === 'early' ? `How to measure: ${vitalFor(m.key, ctx).howTo}` : ''}`.trim()
  }

  const sources = [...new Set([...a.rules.map((r) => r.source).filter((s): s is EwSourceId => s != null), ...(a.trend && (has('trend') || a.projection) ? (['theilSen'] as EwSourceId[]) : []), ...(m.evidence ?? [])])]
  const usesAuraRule = a.rules.some((r) => r.source == null) || a.projection != null || a.level != null
  return { ...a, finding, short, quality: q.join(' '), next, sources, usesAuraRule }
}

export type { MetricAnalysis } from './drift'
export type { FullCheck } from './news2'
