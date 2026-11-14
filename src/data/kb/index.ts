// Scientific knowledge base built from official NASA HRP / CSA pages.
// Every finding carries a verbatim quote from its source page (see the JSON files).
import physiology from './physiology.json'
import behaviorResearch from './behavior-research.json'
import environment from './environment.json'
import exercise from './exercise.json'
import type { SystemId } from '../systems'

export type HazardId = 'radiation' | 'isolation' | 'distance' | 'gravity' | 'environment'
export type KbSystem = SystemId | 'renal'

export type KbRecord = {
  id: string
  title: string
  organization: string
  url: string
  lastUpdated: string | null
  fetchStatus: 'ok' | 'failed'
  hazards: HazardId[]
  bodySystems: KbSystem[]
  summary: string
  findings: { text: string; quote: string }[]
  measurements: string[]
  countermeasures: string[]
  limitations: string[]
}

export type EnvValue = {
  id: string
  parameter: string
  value: number | null
  valueMax: number | null
  unit: string
  context: string
  source: { title: string; organization: string; url: string; date: string | null }
  quote: string
  confidence: 'verified' | 'secondary'
  notes: string
}

export type ExerciseKb = {
  equipment: {
    id: string
    name: string
    category: string
    description: string
    capabilities: string[]
    source: { title: string; url: string; date: string | null }
    quote: string
  }[]
  facts: {
    id: string
    topic: string
    bodySystems: KbSystem[]
    text: string
    value: number | null
    unit: string | null
    source: { title: string; organization?: string; url: string; date: string | null }
    quote: string
  }[]
  sessionTemplates: { id: string; name: string; equipment: string; durationMin: number; basis: string }[]
}

export const KB_RECORDS: KbRecord[] = ([...physiology, ...behaviorResearch] as KbRecord[]).filter(
  (r) => r.fetchStatus === 'ok',
)
export const ENV_VALUES = environment as EnvValue[]
export const EXERCISE_KB = exercise as ExerciseKb

export const HAZARD_LABEL: Record<HazardId, string> = {
  radiation: 'Space radiation',
  isolation: 'Isolation & confinement',
  distance: 'Distance from Earth',
  gravity: 'Gravity fields',
  environment: 'Hostile / closed environment',
}

export function recordsForSystem(id: KbSystem): KbRecord[] {
  return KB_RECORDS.filter((r) => r.bodySystems.includes(id) && !r.id.startsWith('hazard-'))
}

export function envValue(id: string): EnvValue | undefined {
  return ENV_VALUES.find((e) => e.id === id && e.value != null)
}
