// "Symptoms logged while readings were elevated": saved AURA assessments placed on the environment history.
// Privacy follows src/lib/clinic.ts and the env station scoping:
//   - astronaut / member: only their own assessments
//   - surgeon: the simulated demo crew (who share the "mission" station) — never registered members
//   - ground (mission control): none — they do not read health records
import type { Context } from '../../data/contexts'
import { listAssessments, type SavedAssessment } from '../clinic'
import { FINDING_BY_ID } from '../doctor/findings'
import type { EnvRow } from '../envStation'
import type { User } from '../types'
import { deriveCabinContext, FRESH_MS, type FactorId } from './context'

const DEMO_CREW_MAX = 999 // same split as clinic.ts: demo crew ids 1–4, registered members from 1000

/** Whose saved assessments may be laid over this user's station history. */
export function overlayCrewIds(user: User | null, crewIds: number[]): number[] {
  if (!user) return []
  if (user.role === 'astronaut' || user.role === 'member') return user.crewId != null ? [user.crewId] : []
  if (user.role === 'surgeon') return crewIds.filter((id) => id <= DEMO_CREW_MAX)
  return []
}

export type OverlayItem = {
  id: number
  crewId: number
  at: number
  conditionName: string
  urgency: SavedAssessment['urgency']
  symptoms: string[]
  /** Factors elevated in the 15 minutes up to the assessment (AURA rule window). */
  elevated: FactorId[]
  /** False when there were no readings in that window (unknown, not "normal"). */
  covered: boolean
}

/** Assessments inside [from, to], each with the environment factors that were elevated when it was saved. */
export function overlayAssessments(items: SavedAssessment[], rows: EnvRow[], from: number, to: number, context: Context, skewMs = 0): OverlayItem[] {
  return items
    .map((a) => ({ a, at: Date.parse(a.createdAt) }))
    .filter(({ at }) => Number.isFinite(at) && at >= from && at <= to)
    .sort((x, y) => x.at - y.at)
    .map(({ a, at }) => {
      const before = rows.filter((r) => {
        const t = Date.parse(r.at) + skewMs
        return t <= at + 60_000 && t >= at - FRESH_MS
      })
      const ctx = deriveCabinContext({ rows: before, now: at + 60_000, context, skewMs })
      return {
        id: a.id,
        crewId: a.crewId,
        at,
        conditionName: a.conditionName,
        urgency: a.urgency,
        symptoms: a.findings.filter((f) => f.answer === 'yes').map((f) => FINDING_BY_ID[f.id]?.label ?? f.id),
        elevated: ctx.factors.map((f) => f.id),
        covered: before.length > 0,
      }
    })
}

/** Loads the permitted assessments (errors for a single person are skipped, never shown as "none"). */
export async function loadOverlaySource(user: User | null, crewIds: number[]): Promise<{ items: SavedAssessment[]; failed: number }> {
  const ids = overlayCrewIds(user, crewIds)
  let failed = 0
  const lists = await Promise.all(
    ids.map((id) =>
      listAssessments(user, id).catch(() => {
        failed++
        return [] as SavedAssessment[]
      }),
    ),
  )
  return { items: lists.flat(), failed }
}
