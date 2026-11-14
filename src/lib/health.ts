// Deterministic health rules: latest values, statuses, alerts and score.
// These never depend on the AI assistant.
import { CAREER_LIMIT_MSV, MISSIONS } from '../data/missions'
import { SYSTEMS, type SystemId } from '../data/systems'
import {
  FIELD_IDS,
  STATUS_RANK,
  VITALS,
  VITAL_BY_KEY,
  worst,
  type FieldId,
  type Status,
  type Values,
  type VitalKey,
} from '../data/vitals'
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
  const early = rows.filter((r) => r.metric === metric && r.day <= 14)
  if (!early.length) return null
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
  bp: 'Rest 5 minutes and re-measure. Tell the crew medical officer if it stays at or above 130/80.',
  hr: 'Re-measure at rest. Note palpitations, dizziness or chest pain.',
  spo2: 'Warm your hand and re-measure; check cabin CO₂ and airflow.',
  temp: 'Re-measure in 30 minutes, rest and hydrate; limit close contact.',
  glucose: 'Re-measure tomorrow before eating; log meals today.',
  sleep: 'Keep a fixed sleep window and dim the lights an hour before sleep.',
  mood: 'A private check-in with the flight surgeon is available any time.',
  exercise: 'Complete today’s prescribed session; split it in two if needed.',
  vision: 'Repeat the check for each eye; request an OCT scan if blur persists.',
  water: 'Drink a glass now and spread drinks across the day.',
}

export function evaluate(rows: Measurement[], profileId: string, day: number, hidePrivate = false) {
  const { values, meta } = latestOf(rows)
  const vitals = VITALS.filter((d) => !(hidePrivate && d.private) && d.fields.every((f) => meta[f.id]))
  const vitalStatus = Object.fromEntries(vitals.map((d) => [d.key, d.evaluate(values)])) as Partial<Record<VitalKey, Status>>
  const rad = radiation(profileId, day)

  const systemStatus = Object.fromEntries(
    SYSTEMS.map((s) => [
      s.id,
      s.id === 'radiation' ? rad.status : worst(s.vitals.map((k) => vitalStatus[k] ?? 'ok')),
    ]),
  ) as Record<SystemId, Status>

  const alerts: Alert[] = []
  for (const d of vitals) {
    const st = vitalStatus[d.key]!
    if (st === 'ok') continue
    const sys = SYSTEMS.find((s) => s.vitals.includes(d.key))?.id ?? 'heart'
    alerts.push({
      key: d.key,
      level: st,
      title: `${d.label} ${d.display(values)} ${d.unit}`,
      detail: ACTION[d.key] ?? '',
      at: meta[d.primary]?.at,
      system: sys,
    })
  }
  // trend rule: three short nights in a row
  const sleep = seriesOf(rows, 'sleep', 3, day)
  if (sleep.length === 3 && sleep.every((s) => s.value < 6) && !alerts.some((a) => a.key === 'sleep')) {
    alerts.push({ key: 'sleep-trend', level: 'warn', title: 'Three short nights in a row', detail: ACTION.sleep!, system: 'brain' })
  }
  if (rad.status !== 'ok') {
    alerts.push({ key: 'rad', level: rad.status, title: `Radiation ${rad.pct.toFixed(0)}% of career limit`, detail: 'Review shielding and storm-shelter procedures.', system: 'radiation' })
  }
  alerts.sort((a, b) => STATUS_RANK[b.level] - STATUS_RANK[a.level])

  // 100 minus a fixed penalty per out-of-range reading (and radiation), so every point is explainable.
  const PENALTY: Record<Status, number> = { ok: 0, warn: 9, crit: 22 }
  const penalty = Object.values(vitalStatus).reduce((s, st) => s + PENALTY[st!], 0) + PENALTY[rad.status]
  const score = Math.max(0, 100 - penalty)
  const overall: Status = worst(Object.values(systemStatus))

  return { values, meta, vitals, vitalStatus, systemStatus, alerts, score, overall, rad }
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
  if (diff < 24 * 60) return `today ${d.toTimeString().slice(0, 5)}`
  if (diff < 48 * 60) return `yesterday ${d.toTimeString().slice(0, 5)}`
  return `${Math.round(diff / 1440)} days ago`
}

export const VITAL_SYSTEM: Record<VitalKey, SystemId> = Object.fromEntries(
  Object.keys(VITAL_BY_KEY).map((k) => [k, SYSTEMS.find((s) => s.vitals.includes(k as VitalKey))?.id ?? 'heart']),
) as Record<VitalKey, SystemId>
