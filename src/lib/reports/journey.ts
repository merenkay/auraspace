// A report's journey, derived only from stored facts (the server's status and timestamps) plus the mission profile's
// one-way signal delay. The delay part is a labelled SIMULATION: nothing here ever claims real delivery, and the
// stored status is never advanced on the client because time has passed.
import type { Report, Role } from '../types'

/** Who can ever answer a report: only the simulated crew's reports reach the flight surgeon (server: crew.owner_user_id IS NULL). */
export function reachesReviewer(role: Role | undefined): boolean {
  return role === 'astronaut'
}

/** Truthful stored state. `saved` = kept on the person's own record, nobody reviews it (registered members). */
export type StoredState = 'saved' | 'awaiting' | 'replied'

export function storedState(r: Pick<Report, 'status'>, reviewable: boolean): StoredState {
  if (r.status === 'reviewed') return 'replied'
  return reviewable ? 'awaiting' : 'saved'
}

export const STORED_LABEL: Record<StoredState, string> = {
  saved: 'Saved on your record',
  awaiting: 'Waiting for a reply',
  replied: 'Reply received',
}

const ms = (iso: string | null | undefined) => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** One leg of the simulated signal path. */
export type Leg = { arrived: boolean; at: number; remainingSec: number }

function leg(start: number | null, delaySec: number, now: number): Leg | null {
  if (start == null) return null
  const at = start + Math.round(delaySec * 1000)
  return { arrived: now >= at, at, remainingSec: Math.max(0, Math.ceil((at - now) / 1000)) }
}

/**
 * Simulated journey for a space-crew report: the report travels to Earth (createdAt + delay); the reply leaves when
 * the surgeon wrote it, but not before the report would have arrived, and travels back (+ delay). Null when the
 * profile has no meaningful delay. `reply` is null until a reply exists with a known time.
 */
export function simulatedJourney(r: Pick<Report, 'createdAt' | 'status' | 'reviewedAt'>, delaySec: number, now: number): { out: Leg; reply: Leg | null } | null {
  if (!(delaySec > 0)) return null
  const sent = ms(r.createdAt)
  const out = leg(sent, delaySec, now)
  if (!out) return null
  const written = r.status === 'reviewed' ? ms(r.reviewedAt) : null
  const reply = written == null ? null : leg(Math.max(written, out.at), delaySec, now)
  return { out, reply }
}

/** A reply the crew member has not opened yet (or that changed after they opened it). `localReadAt` is the device-only fallback. */
export function isUnread(r: Pick<Report, 'status' | 'reviewedAt' | 'readAt'>, localReadAt?: string | null): boolean {
  if (r.status !== 'reviewed') return false
  const read = ms(r.readAt ?? localReadAt ?? null)
  if (read == null) return true
  const written = ms(r.reviewedAt)
  return written != null && read < written
}

/** "about 11 min", "40 s", "under a second" — for remaining simulated travel time. */
export function formatRemaining(sec: number): string {
  if (sec < 1) return 'under a second'
  if (sec < 60) return `${sec} s`
  const min = Math.round(sec / 60)
  if (min < 60) return `about ${min} min`
  return `about ${Math.round(min / 6) / 10} h`
}
