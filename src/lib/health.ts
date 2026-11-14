// Deterministic health rules: latest values, statuses, alerts and score.
// These never depend on the AI assistant.
import { CONTEXTS, vitalsFor, type Context } from '../data/contexts'
import { CAREER_LIMIT_MSV, MISSIONS } from '../data/missions'
import { SYSTEMS, type SystemId } from '../data/systems'
import { FIELD_IDS, STATUS_RANK, VITAL_BY_KEY, worst, type FieldId, type Status, type Values, type VitalDef, type VitalKey } from '../data/vitals'
import type { Measurement, ReportSummary } from './types'

export type Latest = { values: Values; meta: Partial<Record<FieldId, Measurement>> }

const FALLBACK: Values = { sys: 120, dia: 78, hr: 65, spo2: 98, temp: 36.7, glucose: 90, sleep: 7, mood: 4, exercise: 90, vision: 5, water: 2.5 }

export function latestOf(rows: Measurement[]): Latest {
  const meta: Partial<Record<FieldId, Measurement>> = {}
  for (const r of rows) {
    const cur = meta[r.metric]
    if (!cur || r.at >= cur.at) meta[r.metric] = r
  }
  const values = { ...FALLBACK }
  for (const f of FIELD_IDS) if (meta[f]) values[f] = meta[f]!.value
  return { values, meta }
}

export function seriesOf(rows: Measurement[], metric: FieldId, days = 14, today = 142): { day: number; value: number }[] {
  const byDay = new Map<number, number>()
  for (const r of rows) if (r.metric === metric && r.day > today - days) byDay.set(r.day, r.value)
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, value]) => ({ day, value }))
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

export function evaluate(rows: Measurement[], mission: EvalInput, hidePrivate = false) {
  const ctx = mission.context
  const { values, meta } = latestOf(rows)
  const defs = vitalsFor(ctx)
  const defByKey = Object.fromEntries(defs.map((d) => [d.key, d])) as Partial<Record<VitalKey, VitalDef>>
  const vitals = defs.filter((d) => !(hidePrivate && d.private) && d.fields.every((f) => meta[f.id]))
  const vitalStatus = Object.fromEntries(vitals.map((d) => [d.key, d.evaluate(values)])) as Partial<Record<VitalKey, Status>>
  const rad = radiation(mission.profileId, mission.day)
  const showRad = ctx === 'space'
  const systems = systemsFor(ctx)

  const systemStatus = Object.fromEntries(
    SYSTEMS.map((s) => [s.id, s.id === 'radiation' ? (showRad ? rad.status : 'ok') : worst(s.vitals.map((k) => vitalStatus[k] ?? 'ok'))]),
  ) as Record<SystemId, Status>

  const alerts: Alert[] = []
  for (const d of vitals) {
    const st = vitalStatus[d.key]!
    if (st === 'ok') continue
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
  const penalty = Object.values(vitalStatus).reduce((s, st) => s + PENALTY[st!], 0) + (showRad ? PENALTY[rad.status] : 0)
  const score = Math.max(0, 100 - penalty)
  const overall: Status = worst(systems.map((s) => systemStatus[s.id]))

  return { context: ctx, values, meta, vitals, defByKey, vitalStatus, systemStatus, systems, alerts, score, overall, rad, showRad }
}

export type Evaluation = ReturnType<typeof evaluate>

export function summaryOf(e: Evaluation): ReportSummary {
  return {
    overall: e.overall,
    score: e.score,
    alerts: e.alerts.map((a) => ({ title: a.title, level: a.level })),
    vitals: e.vitals.map((d) => ({ label: d.label, value: `${d.display(e.values)} ${d.unit}`, status: e.vitalStatus[d.key]! })),
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
