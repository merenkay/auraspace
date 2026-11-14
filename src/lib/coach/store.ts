// Training profile + session log storage. Server mode uses public/api/routes/coach.php; demo mode keeps
// everything in localStorage ('aura.coach.v1'). Privacy (same as src/lib/clinic.ts): a person reads and writes
// only their own record; the flight surgeon may read the simulated demo crew; mission control (ground) may not.
import type { Context } from '../../data/contexts'
import { apiCall, getBackend } from '../api'
import type { User } from '../types'
import { cleanTrainingProfile, isoDate } from './profile'
import type { SessionLog, TrainingProfile } from './types'

const KEY = 'aura.coach.v1'
const DEMO_CREW_MAX = 999 // demo crew ids are 1–4; registered members start at 1000
const MAX_LOGS = 120

export type CoachState = { profile: TrainingProfile | null; logs: SessionLog[] }
export type NewLog = { date: string; sessionKey: string; minutes: number; effort: number; pain: boolean }

type Store = { profiles: Record<string, TrainingProfile>; logs: Record<string, SessionLog[]> }

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const s = raw ? (JSON.parse(raw) as Partial<Store>) : {}
    return { profiles: s.profiles ?? {}, logs: s.logs ?? {} }
  } catch {
    return { profiles: {}, logs: {} }
  }
}
function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: kept for this page only */
  }
}

export function canReadCoach(user: User | null, crewId: number): boolean {
  if (!user) return false
  if (user.role === 'astronaut' || user.role === 'member') return user.crewId === crewId
  if (user.role === 'surgeon') return crewId <= DEMO_CREW_MAX
  return false
}
export const canWriteCoach = (user: User | null, crewId: number) => !!user && (user.role === 'astronaut' || user.role === 'member') && user.crewId === crewId

function deny(): never {
  throw new Error('Not allowed for your role')
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const KEY_RE = /^[a-z0-9]{1,16}$/

/** Keeps a log entry inside the same bounds the server enforces. */
export function cleanLog(l: Partial<SessionLog>): SessionLog | null {
  if (typeof l.date !== 'string' || !DATE_RE.test(l.date) || typeof l.sessionKey !== 'string' || !KEY_RE.test(l.sessionKey)) return null
  const minutes = Math.round(Number(l.minutes))
  const effort = Math.round(Number(l.effort))
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 300 || !Number.isFinite(effort) || effort < 0 || effort > 10) return null
  return { id: Number(l.id) || 0, date: l.date, sessionKey: l.sessionKey, minutes, effort, pain: l.pain === true, createdAt: typeof l.createdAt === 'string' ? l.createdAt : new Date().toISOString() }
}

export async function loadCoach(user: User | null, crewId: number, context: Context): Promise<CoachState> {
  if (!canReadCoach(user, crewId)) deny()
  const today = isoDate()
  const b = await getBackend()
  if (b.mode === 'server') {
    const d = await apiCall<{ profile: unknown | null; logs: Partial<SessionLog>[] }>('coach/state', { query: { crew: crewId } })
    return { profile: d.profile ? cleanTrainingProfile(d.profile, context, today) : null, logs: (d.logs ?? []).map(cleanLog).filter((x): x is SessionLog => !!x) }
  }
  const s = read()
  const own = s.profiles[String(crewId)]
  return { profile: own ? cleanTrainingProfile(own, context, today) : null, logs: (s.logs[String(crewId)] ?? []).map(cleanLog).filter((x): x is SessionLog => !!x) }
}

export async function saveTrainingProfile(user: User | null, crewId: number, p: TrainingProfile): Promise<TrainingProfile> {
  if (!canWriteCoach(user, crewId)) deny()
  const clean = cleanTrainingProfile({ ...p, updatedAt: new Date().toISOString() }, p.context, isoDate())
  const b = await getBackend()
  if (b.mode === 'server') return apiCall<{ profile: unknown }>('coach/profile', { method: 'POST', body: { crewId, profile: clean } }).then((d) => cleanTrainingProfile(d.profile, p.context, isoDate()))
  const s = read()
  s.profiles[String(crewId)] = clean
  write(s)
  return clean
}

/** Saves (or replaces) the log for one planned session on one date. */
export async function logSession(user: User | null, crewId: number, log: NewLog): Promise<SessionLog> {
  if (!canWriteCoach(user, crewId)) deny()
  const item = cleanLog({ ...log, id: Date.now(), createdAt: new Date().toISOString() })
  if (!item) throw new Error('Invalid session log')
  const b = await getBackend()
  if (b.mode === 'server') return apiCall<{ item: Partial<SessionLog> }>('coach/log', { method: 'POST', body: { crewId, log: { date: item.date, sessionKey: item.sessionKey, minutes: item.minutes, effort: item.effort, pain: item.pain } } }).then((d) => cleanLog(d.item) ?? item)
  const s = read()
  const list = (s.logs[String(crewId)] ?? []).filter((l) => !(l.date === item.date && l.sessionKey === item.sessionKey))
  s.logs[String(crewId)] = [...list, item].sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_LOGS)
  write(s)
  return item
}
