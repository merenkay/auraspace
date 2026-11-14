// Health profile + saved AURA assessments. Server mode uses public/api/routes/clinic.php;
// demo mode keeps everything in localStorage ('aura.clinic.v1'). Privacy: a person reads and writes only
// their own record; the flight surgeon may read the simulated demo crew; mission control (ground) may not.
import { cleanProfile, type HealthProfile } from '../data/conditions/profile'
import type { Urgency } from '../data/conditions/types'
import type { Context } from '../data/contexts'
import { apiCall, getBackend } from './api'
import type { User } from './types'

export type SavedAssessment = {
  id: number
  crewId: number
  createdAt: string
  context: Context
  urgency: Urgency
  conditionId: string | null
  conditionName: string
  strength: 'strong' | 'moderate' | 'weak' | null
  findings: { id: string; answer: 'yes' | 'no' | 'unsure' }[]
  note: string
}

export type NewAssessment = Omit<SavedAssessment, 'id' | 'crewId' | 'createdAt'>

const KEY = 'aura.clinic.v1'
const DEMO_CREW_MAX = 999 // demo crew ids are 1–4; registered members start at 1000

type Store = { profiles: Record<string, HealthProfile>; assessments: Record<string, SavedAssessment[]> }

// Simulated starting records for the demo crew so the medicine checks are visible. Labelled "simulated" in the UI.
const DEMO_PROFILES: Record<number, Partial<HealthProfile>> = {
  1: { ageBand: '40-64' },
  2: { ageBand: '40-64', allergies: ['aspirin'] },
  3: { ageBand: 'under-40' },
  4: { ageBand: '40-64', conditions: ['kidney-stones'] },
}

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const s = raw ? (JSON.parse(raw) as Partial<Store>) : {}
    return { profiles: s.profiles ?? {}, assessments: s.assessments ?? {} }
  } catch {
    return { profiles: {}, assessments: {} }
  }
}
function write(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: kept for this page only */
  }
}

export function canReadClinic(user: User | null, crewId: number): boolean {
  if (!user) return false
  if (user.role === 'astronaut' || user.role === 'member') return user.crewId === crewId
  if (user.role === 'surgeon') return crewId <= DEMO_CREW_MAX
  return false
}
export const canWriteClinic = (user: User | null, crewId: number) => !!user && (user.role === 'astronaut' || user.role === 'member') && user.crewId === crewId

function deny(): never {
  throw new Error('Not allowed for your role')
}

export async function loadProfile(user: User | null, crewId: number): Promise<HealthProfile | null> {
  if (!canReadClinic(user, crewId)) deny()
  const b = await getBackend()
  // The simulated crew start with the same labelled starter record in both modes: the server stores nothing
  // for them until someone saves a profile, and a saved profile always wins.
  const seed = DEMO_PROFILES[crewId]
  const starter = () => (seed ? cleanProfile({ ...seed, simulated: true, updatedAt: '2026-11-01T00:00:00.000Z' }) : null)
  if (b.mode === 'server') {
    const d = await apiCall<{ profile: HealthProfile | null }>('clinic/profile', { query: { crew: crewId } })
    return d.profile ? cleanProfile(d.profile) : starter()
  }
  const own = read().profiles[String(crewId)]
  return own ? cleanProfile(own) : starter()
}

export async function saveProfile(user: User | null, crewId: number, p: HealthProfile): Promise<HealthProfile> {
  if (!canWriteClinic(user, crewId)) deny()
  const clean = cleanProfile({ ...p, simulated: false, updatedAt: new Date().toISOString() })
  const b = await getBackend()
  if (b.mode === 'server') return apiCall<{ profile: HealthProfile }>('clinic/profile', { method: 'POST', body: { crewId, profile: clean } }).then((d) => cleanProfile(d.profile))
  const s = read()
  s.profiles[String(crewId)] = clean
  write(s)
  return clean
}

export async function listAssessments(user: User | null, crewId: number): Promise<SavedAssessment[]> {
  if (!canReadClinic(user, crewId)) deny()
  const b = await getBackend()
  if (b.mode === 'server') return apiCall<{ items: SavedAssessment[] }>('clinic/assessments', { query: { crew: crewId } }).then((d) => d.items)
  return [...(read().assessments[String(crewId)] ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function addAssessment(user: User | null, crewId: number, a: NewAssessment): Promise<SavedAssessment> {
  if (!canWriteClinic(user, crewId)) deny()
  const body = { ...a, note: a.note.slice(0, 500), findings: a.findings.slice(0, 60) }
  const b = await getBackend()
  if (b.mode === 'server') return apiCall<{ item: SavedAssessment }>('clinic/assessments', { method: 'POST', body: { crewId, assessment: body } }).then((d) => d.item)
  const s = read()
  const list = s.assessments[String(crewId)] ?? []
  const item: SavedAssessment = { ...body, id: Date.now(), crewId, createdAt: new Date().toISOString() }
  s.assessments[String(crewId)] = [item, ...list].slice(0, 50)
  write(s)
  return item
}

/** Latest saved assessment, or null. Used by the coach. */
export async function latestAssessment(user: User | null, crewId: number): Promise<SavedAssessment | null> {
  if (!canReadClinic(user, crewId)) return null
  try {
    return (await listAssessments(user, crewId))[0] ?? null
  } catch {
    return null
  }
}
