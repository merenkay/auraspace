// Deterministic health rules: latest values, statuses, alerts and score.
// These never depend on the AI assistant.
import { CONTEXTS, vitalsFor, type Context } from '../data/contexts'
import { freshDaysFor, SCORE_MIN_SHARE, SCORE_REQUIRED } from '../data/freshness'
import { CAREER_LIMIT_MSV, MISSIONS } from '../data/missions'
import { SYSTEMS, type SystemId } from '../data/systems'
import { FIELD_IDS, STATUS_RANK, VITAL_BY_KEY, worst, type FieldId, type Status, type Values, type VitalDef, type VitalKey } from '../data/vitals'
import type { Measurement, ReportSummary } from './types'

export type Latest = { values: Values; meta: Partial<Record<FieldId, Measurement>> }

const FALLBACK: Values = { sys: 120, dia: 78, hr: 65, spo2: 98, temp: 36.7, glucose: 90, sleep: 7, mood: 4, exercise: 90, vision: 5, water: 2.5 }

/** Milliseconds for an ISO timestamp (any offset or fraction format); unparseable values sort oldest. */
const ms = (at: string) => {
  const t = Date.parse(at)
  return Number.isFinite(t) ? t : -Infinity
}

export function latestOf(rows: Measurement[]): Latest {
  const meta: Partial<Record<FieldId, Measurement>> = {}
  for (const r of rows) {
    const cur = meta[r.metric]
    if (!cur || ms(r.at) >= ms(cur.at)) meta[r.metric] = r
  }
  const values = { ...FALLBACK }
  for (const f of FIELD_IDS) if (meta[f]) values[f] = meta[f]!.value
  return { values, meta }
}

export function seriesOf(rows: Measurement[], metric: FieldId, days = 14, today = 142): { day: number; value: number }[] {
  // One point per day: the newest reading of that day wins, whatever order the rows arrive in.
  const byDay = new Map<number, Measurement>()
  for (const r of rows) {
    if (r.metric !== metric || r.day <= today - days) continue
    const cur = byDay.get(r.day)
    if (!cur || ms(r.at) >= ms(cur.at)) byDay.set(r.day, r)
  }
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, r]) => ({ day, value: r.value }))
}

export function baselineOf(rows: Measurement[], metric: FieldId): number | null {
  const own = rows.filter((r) => r.metric === metric)
  if (!own.length) return null
  const firstDay = Math.min(...own.map((r) => r.day))
  const early = own.filter((r) => r.day <= firstDay + 13)
  return early.reduce((s, r) => s + r.value, 0) / early.length
}

export function radiation(profileId: string, day: number) {
  const m = MISSIONS.find((x) => x.id === profileId) ?? MISSIONS[0]
  const dose = day * m.doseRate
  const pct = (dose / CAREER_LIMIT_MSV) * 100
  const status: Status = pct > 80 ? 'crit' : pct >= 50 ? 'warn' : 'ok'
  return { mission: m, dose, pct, status }
}

export type Alert = { key: string; level: Status; title: string; detail: string; at?: string; system: SystemId }

const ACTION: Partial<Record<VitalKey, string>> = {
  bp: 'Rest 5 minutes and re-measure. Tell your care contact if it stays at or above 130/80.',
  hr: 'Re-measure at rest. Note palpitations, dizziness or chest pain.',
  spo2: 'Warm your hand and re-measure; check ventilation and air quality.',
  temp: 'Re-measure in 30 minutes, rest and hydrate; limit close contact.',
  glucose: 'Re-measure tomorrow before eating; log meals today.',
  sleep: 'Keep a fixed sleep window and dim the lights an hour before sleep.',
  mood: 'Talk to someone you trust; a private check-in with your care contact is available any time.',
  exercise: 'Fit in today’s activity; split it into shorter sessions if needed.',
  vision: 'Repeat the check for each eye; request an OCT scan if blur persists.',
  water: 'Drink a glass now and spread drinks across the day.',
}

export type EvalInput = { context: Context; profileId: string; day: number }

export function systemsFor(ctx: Context) {
  return SYSTEMS.filter((s) => !CONTEXTS[ctx].hiddenSystems.includes(s.id))
}

/** current: inside its freshness window; old: has a reading, but it is older than the window; missing: never measured. */
export type Freshness = 'current' | 'old' | 'missing'

export type DataItem = {
  key: VitalKey
  label: string
  state: Freshness
  /** Time of the reading (for a two-part reading such as blood pressure, the older part). */
  at?: string
  /** Mission day of the reading and its age in mission days. */
  day?: number
  ageDays?: number
  /** Freshness window for this measurement (days, AURA rule). */
  maxAgeDays: number
  /** Status of the reading itself; for an old reading this is the last known status, not a current one. */
  status?: Status
}

export type DataQuality = {
  items: DataItem[]
  /** Measurements tracked in this context (privacy filter applied). */
  expected: number
  /** Has any reading (current + old). */
  present: number
  current: number
  old: number
  missing: number
  /** Enough current data for a numeric score (see src/data/freshness.ts). */
  sufficient: boolean
  /** Fewest current measurements a score needs. */
  minCurrent: number
  /** Plain-language list of what is still needed for a score; empty when sufficient. */
  needs: string[]
}

/** Classifies every expected measurement as current / old / missing, on the mission clock (see src/data/freshness.ts). */
export function dataQualityOf(defs: VitalDef[], meta: Latest['meta'], values: Values, today: number): DataQuality {
  const items: DataItem[] = defs.map((d) => {
    const maxAgeDays = freshDaysFor(d.key)
    const parts = d.fields.map((f) => meta[f.id])
    if (parts.some((p) => !p)) return { key: d.key, label: d.label, state: 'missing', maxAgeDays }
    // A two-part reading is as old as its older part.
    const oldest = parts.reduce((a, b) => (b!.day < a!.day || (b!.day === a!.day && ms(b!.at) < ms(a!.at)) ? b : a))!
    const ageDays = Math.max(0, today - oldest.day)
    return { key: d.key, label: d.label, state: ageDays <= maxAgeDays ? 'current' : 'old', at: oldest.at, day: oldest.day, ageDays, maxAgeDays, status: d.evaluate(values) }
  })
  const count = (s: Freshness) => items.filter((i) => i.state === s).length
  const current = count('current')
  const minCurrent = Math.ceil(items.length * SCORE_MIN_SHARE)
  const needs: string[] = []
  for (const k of SCORE_REQUIRED) {
    const i = items.find((x) => x.key === k)
    if (i && i.state !== 'current') needs.push(`${i.label} (${i.state === 'old' ? 'last reading is old' : 'not measured yet'})`)
  }
  const stillShort = minCurrent - current - needs.length
  if (stillShort > 0) needs.push(`${stillShort} more current measurement${stillShort === 1 ? '' : 's'} of any kind (${current} of ${items.length} are current; a score needs ${minCurrent})`)
  return { items, expected: items.length, present: items.length - count('missing'), current, old: count('old'), missing: count('missing'), sufficient: items.length > 0 && needs.length === 0, minCurrent, needs }
}

export function evaluate(rows: Measurement[], mission: EvalInput, hidePrivate = false) {
  const ctx = mission.context
  const { values, meta } = latestOf(rows)
  const defs = vitalsFor(ctx)
  const defByKey = Object.fromEntries(defs.map((d) => [d.key, d])) as Partial<Record<VitalKey, VitalDef>>
  const tracked = defs.filter((d) => !(hidePrivate && d.private))
  const quality = dataQualityOf(tracked, meta, values, mission.day)
  const fresh = new Set(quality.items.filter((i) => i.state === 'current').map((i) => i.key))
  /** Every measured vital, current or old (cards show old ones with their age). */
  const vitals = tracked.filter((d) => d.fields.every((f) => meta[f.id]))
  /** Status of each measured vital's latest reading — for an old reading, its last known status. */
  const vitalStatus = Object.fromEntries(vitals.map((d) => [d.key, d.evaluate(values)])) as Partial<Record<VitalKey, Status>>
  /** Only current readings drive the score, alerts, body-system colours and the overall status. */
  const currentStatus = Object.fromEntries(vitals.filter((d) => fresh.has(d.key)).map((d) => [d.key, vitalStatus[d.key]!])) as Partial<Record<VitalKey, Status>>
  const rad = radiation(mission.profileId, mission.day)
  const showRad = ctx === 'space'
  const systems = systemsFor(ctx)

  const systemStatus = Object.fromEntries(
    SYSTEMS.map((s) => [s.id, s.id === 'radiation' ? (showRad ? rad.status : 'ok') : worst(s.vitals.map((k) => currentStatus[k] ?? 'ok'))]),
  ) as Record<SystemId, Status>

  const alerts: Alert[] = []
  for (const d of vitals) {
    const st = currentStatus[d.key]
    if (!st || st === 'ok') continue
    const sys = SYSTEMS.find((s) => s.vitals.includes(d.key))?.id ?? 'heart'
    alerts.push({ key: d.key, level: st, title: `${d.label} ${d.display(values)} ${d.unit}`, detail: ACTION[d.key] ?? '', at: meta[d.primary]?.at, system: sys })
  }
  const sleep = seriesOf(rows, 'sleep', 3, mission.day)
  if (sleep.length === 3 && sleep.every((s) => s.value < 6) && !alerts.some((a) => a.key === 'sleep')) {
    alerts.push({ key: 'sleep-trend', level: 'warn', title: 'Three short nights in a row', detail: ACTION.sleep!, system: 'brain' })
  }
  if (showRad && rad.status !== 'ok') {
    alerts.push({ key: 'rad', level: rad.status, title: `Radiation ${rad.pct.toFixed(0)}% of career limit`, detail: 'Review shielding and storm-shelter procedures.', system: 'radiation' })
  }
  alerts.sort((a, b) => STATUS_RANK[b.level] - STATUS_RANK[a.level])

  // 100 minus a fixed penalty per out-of-range reading (and radiation in space), so every point is explainable.
  const PENALTY: Record<Status, number> = { ok: 0, warn: 9, crit: 22 }
  // Only current readings count; missing and old ones add nothing (neither "normal" nor "bad").
  const penalty = Object.values(currentStatus).reduce((s, st) => s + PENALTY[st!], 0) + (showRad ? PENALTY[rad.status] : 0)
  /** Points from the current readings. Only meaningful as a "health score" when `scoreReady` is true. */
  const score = Math.max(0, 100 - penalty)
  const scoreReady = quality.sufficient
  const overall: Status = worst(systems.map((s) => systemStatus[s.id]))
  /** Overall status to show: null ("not enough data") when data are insufficient and nothing current is out of range. */
  const overallShown: Status | null = scoreReady || overall !== 'ok' ? overall : null

  // "ok" above also covers "nothing measured". These let the UI say "no data yet" instead of "normal":
  // hasData is false until at least one vital has any reading; systemMeasured is true when a body system has a
  // *current* reading; systemStale when it only has old ones.
  const hasData = vitals.length > 0
  const systemMeasured = Object.fromEntries(
    SYSTEMS.map((s) => [s.id, s.id === 'radiation' ? showRad : s.vitals.some((k) => currentStatus[k] !== undefined)]),
  ) as Record<SystemId, boolean>
  const systemStale = Object.fromEntries(
    SYSTEMS.map((s) => [s.id, s.id !== 'radiation' && !systemMeasured[s.id] && s.vitals.some((k) => vitalStatus[k] !== undefined)]),
  ) as Record<SystemId, boolean>
  /** Old readings, abnormal first: shown as "last known" with their time and a re-measure prompt, never as current. */
  const lastKnown = quality.items.filter((i) => i.state === 'old').sort((a, b) => STATUS_RANK[b.status!] - STATUS_RANK[a.status!] || (a.ageDays ?? 0) - (b.ageDays ?? 0))

  return { context: ctx, values, meta, vitals, defByKey, vitalStatus, currentStatus, systemStatus, systemMeasured, systemStale, hasData, systems, alerts, score, scoreReady, overall, overallShown, quality, lastKnown, rad, showRad }
}

export type Evaluation = ReturnType<typeof evaluate>

export function summaryOf(e: Evaluation): ReportSummary {
  return {
    overall: e.overall,
    score: e.score,
    alerts: e.alerts.map((a) => ({ title: a.title, level: a.level })),
    vitals: e.vitals.map((d) => {
      const old = e.lastKnown.find((i) => i.key === d.key)
      return { label: d.label, value: `${d.display(e.values)} ${d.unit}${old ? ` (old: ${old.ageDays} days, last known)` : ''}`, status: e.vitalStatus[d.key]! }
    }),
    scoreReady: e.scoreReady,
    data: { expected: e.quality.expected, present: e.quality.present, current: e.quality.current, old: e.quality.old, missing: e.quality.missing },
    oldReadings: e.lastKnown.map((i) => ({ label: i.label, at: i.at ?? '', ageDays: i.ageDays ?? 0, status: i.status! })),
  }
}

export function timeAgo(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 60000
  if (diff < 1) return 'just now'
  if (diff < 60) return `${Math.round(diff)} min ago`
  // Compare calendar days, not elapsed hours: 18:35 yesterday is "yesterday" even at 09:00 today.
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((midnight(new Date()) - midnight(d)) / 86400000)
  if (days <= 0) return `today ${d.toTimeString().slice(0, 5)}`
  if (days === 1) return `yesterday ${d.toTimeString().slice(0, 5)}`
  return `${days} days ago`
}

export const VITAL_SYSTEM: Record<VitalKey, SystemId> = Object.fromEntries(
  Object.keys(VITAL_BY_KEY).map((k) => [k, SYSTEMS.find((s) => s.vitals.includes(k as VitalKey))?.id ?? 'heart']),
) as Record<VitalKey, SystemId>
