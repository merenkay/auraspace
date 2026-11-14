// Data the conversation layer reads: the environment station's latest stored reading, today's coach session and
// checklist, and yesterday's value of a reading. Uses the same modules and permission checks as the pages.
import { STATUS_LABEL, VITAL_BY_KEY, type VitalKey } from '../../data/vitals'
import type { Backend } from '../api'
import { canReadClinic, latestAssessment, loadProfile } from '../clinic'
import { buildCoach, canReadCoach, isoDate, loadCoach, todaySummary } from '../coach'
import { evalGas, loadLatest, rowRatio, stationFor } from '../envStation'
import { seriesOf, type Evaluation } from '../health'
import type { Measurement, Mission, User } from '../types'
import type { EnvSnapshot } from './reply'

/** Latest stored reading of the person's environment station (shared cabin station or private home sensor). */
export async function loadEnvSnapshot(user: User | null): Promise<EnvSnapshot | null> {
  const st = stationFor(user)
  if (!st) return null
  try {
    const { row, skewMs } = await loadLatest(st.id)
    if (!row) return { label: st.label, t: null, h: null, gas: 'none', ageMin: 0, simulated: false }
    const ageMin = Math.max(0, (Date.now() - skewMs - Date.parse(row.at)) / 60_000)
    const ratio = rowRatio(row)
    const gas = evalGas({ raw: row.gasMax ?? row.gas, ratio: ratio ?? null, base: row.base, warm: 0 }).level
    return { label: st.label, t: row.t, h: row.h, gas, ageMin, simulated: /sim/i.test(row.device ?? '') }
  } catch {
    return null
  }
}

/** Today's coach session sentence and the daily checklist, each null when unavailable for this role. */
export async function loadToday(o: { user: User | null; crewId: number | null; mission: Mission | null; backend: Backend | null; rows: Measurement[]; ev: Evaluation | null }) {
  const { user, crewId, mission, backend, rows, ev } = o
  let coach: string | null = null
  let tasks: { label: string; time: string; done: boolean }[] | null = null
  if (crewId == null || !user) return { coach, tasks }
  const ctx = ev?.context ?? mission?.context ?? user.context
  if (canReadCoach(user, crewId)) {
    try {
      const [profile, latest, state] = await Promise.all([
        canReadClinic(user, crewId) ? loadProfile(user, crewId).catch(() => null) : Promise.resolve(null),
        latestAssessment(user, crewId),
        loadCoach(user, crewId, ctx),
      ])
      const day = mission?.day ?? 1
      const sleep = seriesOf(rows, 'sleep', 7, day)
      const sleepAvg = sleep.length ? sleep.reduce((s, p) => s + p.value, 0) / sleep.length : null
      const result = buildCoach({ context: ctx, ev, rows, profile, latest, sleepAvg, day, today: isoDate(), training: state.profile, logs: state.logs })
      coach = todaySummary(result)
    } catch {
      coach = null
    }
  }
  if (backend) {
    try {
      tasks = (await backend.tasks(crewId)).tasks.map((t) => ({ label: t.label, time: t.time, done: t.done }))
    } catch {
      tasks = null
    }
  }
  return { coach, tasks }
}

/** "Yesterday your blood pressure was 132/84 mmHg, attention." or null when there is no reading from that day. */
export function yesterdayText(rows: Measurement[], key: VitalKey, today: number, subject?: string | null): string | null {
  const def = VITAL_BY_KEY[key]
  const values: Record<string, number> = {}
  for (const f of def.fields) {
    const r = rows.filter((x) => x.metric === f.id && x.day === today - 1).sort((a, b) => b.at.localeCompare(a.at))[0]
    if (!r) return null
    values[f.id] = r.value
  }
  const v = values as Parameters<typeof def.display>[0]
  const st = def.evaluate(v)
  const who = subject ? `${subject}'s` : 'your'
  return `Yesterday ${who} ${def.label.toLowerCase()} was ${def.display(v)} ${def.unit}, ${STATUS_LABEL[st].toLowerCase()}.`
}

/** The fixed rule behind a reading, with its source, for "why?". */
export function readingWhy(key: VitalKey): string {
  const def = VITAL_BY_KEY[key] as { label: string; ranges?: string; source?: string }
  return `I compare your latest ${def.label.toLowerCase()} with fixed ranges${def.ranges ? `: ${def.ranges}` : ''}.${def.source ? ` Source: ${def.source}.` : ''} It's a rule, not a diagnosis.`
}
