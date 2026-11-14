// Jury demo mode: the data set the tour runs on. It is the app's own simulated crew (src/lib/demoData.ts) plus
// two simulated people for the other contexts, built from the same deterministic generator. Everything here is
// written into the sandboxed store only (storageOverlay.ts), never into the person's browser or the server.
import type { HealthProfile } from '../../data/conditions/profile'
import type { Context } from '../../data/contexts'
import type { FieldId } from '../../data/vitals'
import { CREW, MISSION, generateMeasurements } from '../demoData'
import type { Measurement, User } from '../types'
import type { PersonaId } from './types'

/** Storage keys of the app that the sandbox seeds (see src/lib/api.ts, clinic.ts, sfx.ts, voice/settings.ts). */
export const KEYS = { store: 'aura.demo.v3', clinic: 'aura.clinic.v1', sfx: 'aura.sfx.v1', voice: 'aura.voice.v1' } as const

export type Persona = {
  id: PersonaId
  kind: 'crew' | 'member'
  crewId: number
  name: string
  context: Context
  /** One line for the tour: what this person's simulated data shows. */
  story: string
}

/** How many days of history the two simulated members have. */
export const MEMBER_DAYS = 46

export const PERSONAS: Record<PersonaId, Persona> = {
  okafor: { id: 'okafor', kind: 'crew', crewId: 1, name: 'Mira Okafor', context: 'space', story: 'Blood pressure rising over three weeks' },
  reyes: { id: 'reyes', kind: 'crew', crewId: 2, name: 'Daniel Reyes', context: 'space', story: 'Short sleep and low mood; allergic to aspirin' },
  polar: { id: 'polar', kind: 'member', crewId: 2001, name: 'Lars Eriksen', context: 'polar', story: 'Winter-over at an Antarctic station: short sleep, low mood' },
  home: { id: 'home', kind: 'member', crewId: 2002, name: 'Nermin Aydın', context: 'home', story: 'Lives at home, aged 72: raised blood pressure, drinks too little' },
}

const TITLE: Record<Context, string> = { space: 'Space crew', polar: 'Polar station', home: 'Home care' }
const EMAIL: Record<'polar' | 'home', string> = { polar: 'lars.eriksen@demo.invalid', home: 'nermin.aydin@demo.invalid' }

/** The signed-in user object for a persona, in the same shape the demo store produces (src/lib/api.ts). */
export function userOf(id: PersonaId): User {
  const p = PERSONAS[id]
  if (p.kind === 'crew') {
    const c = CREW.find((x) => x.id === p.crewId)!
    return { id: c.id, username: c.username, role: 'astronaut', name: c.name, title: `${c.position} · ${c.callsign}`, crewId: c.id, context: 'space' }
  }
  const email = EMAIL[id as 'polar' | 'home']
  return { id: p.crewId, username: email, email, role: 'member', name: p.name, title: TITLE[p.context], crewId: p.crewId, context: p.context }
}

/**
 * Which simulated crew member each metric of a member is copied from. The polar member follows the pilot
 * (sleep and mood falling); the person at home has the commander's rising blood pressure, the engineer's low
 * water intake and otherwise the healthy mission specialist's readings.
 */
const SOURCE: Record<'polar' | 'home', (metric: string) => number> = {
  polar: () => 2,
  home: (m) => (m === 'sys' || m === 'dia' ? 1 : m === 'water' ? 4 : 3),
}
const DEVICE: Record<string, string> = { 'ARED / T2 log': 'Activity log', 'Vision card': 'Vision card' }

/** Measurements of the two members: the last MEMBER_DAYS days of their source series, renumbered from day 1. */
export function memberMeasurements(now = new Date()): Measurement[] {
  const all = generateMeasurements(now)
  const shift = MISSION.day - MEMBER_DAYS
  const out: Measurement[] = []
  let id = 2_000_000
  for (const who of ['polar', 'home'] as const) {
    const p = PERSONAS[who]
    for (const r of all) {
      if (r.metric === 'vision' || r.day <= shift || r.crewId !== SOURCE[who](r.metric)) continue
      // An older adult's sleep target is 7 h (CDC); keep this person's sleep on target so the story stays on blood pressure and water.
      const value = who === 'home' && r.metric === 'sleep' ? Math.max(7.1, r.value) : r.value
      out.push({ id: id++, crewId: p.crewId, metric: r.metric as FieldId, value, day: r.day - shift, at: r.at, source: r.source, device: DEVICE[r.device] ?? r.device })
    }
  }
  return out
}

const profile = (p: Partial<HealthProfile>, at: string): HealthProfile => ({ ageBand: null, conditions: [], allergies: [], medicines: [], notes: '', ...p, updatedAt: at, simulated: true })

/**
 * The complete starting contents of the sandboxed store. `real` carries the two device settings that are worth
 * keeping from the person's own browser: whether sound is on, and their voice settings (the wake word and
 * reading the consultation aloud are switched off inside the tour, so the microphone is never opened).
 */
export function buildSeed(now = new Date(), real: { sfx?: string | null; voice?: string | null } = {}): Record<string, string> {
  const created = new Date(now)
  created.setHours(9, 0, 0, 0)
  created.setDate(created.getDate() - (MEMBER_DAYS - 1))
  const at = created.toISOString()
  const members = (['polar', 'home'] as const).map((who) => {
    const p = PERSONAS[who]
    return { id: p.crewId, crewId: p.crewId, email: EMAIL[who], name: p.name, pass: 'demo-sandbox', context: p.context, createdAt: at, color: '#C7C4BD' }
  })
  const store = {
    user: userOf('okafor'),
    extra: memberMeasurements(now),
    done: {
      ...Object.fromEntries(CREW.map((c) => [`${c.id}:${MISSION.day}`, c.doneTasks])),
      [`${PERSONAS.polar.crewId}:${MEMBER_DAYS}`]: ['bp', 'spo2'],
      [`${PERSONAS.home.crewId}:${MEMBER_DAYS}`]: ['bp', 'walk', 'mood'],
    },
    reports: [],
    members,
    pending: {},
    imports: {},
  }
  const clinic = {
    profiles: {
      [PERSONAS.polar.crewId]: profile({ ageBand: 'under-40' }, at),
      [PERSONAS.home.crewId]: profile({ ageBand: '65-79', conditions: ['hypertension'], medicines: ['blood-pressure'] }, at),
    },
    assessments: {},
  }
  const seed: Record<string, string> = { [KEYS.store]: JSON.stringify(store), [KEYS.clinic]: JSON.stringify(clinic) }
  if (real.sfx === '1' || real.sfx === '0') seed[KEYS.sfx] = real.sfx
  if (real.voice) {
    try {
      seed[KEYS.voice] = JSON.stringify({ ...(JSON.parse(real.voice) as object), wake: false, readConsult: false })
    } catch {
      /* unreadable settings: the tour uses the defaults */
    }
  }
  if (!seed[KEYS.voice]) seed[KEYS.voice] = JSON.stringify({ wake: false, readConsult: false })
  return seed
}
