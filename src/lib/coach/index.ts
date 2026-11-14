// Personalised training programme: public entry points.
//   buildCoach()    suggestions → training profile → safety layer → 4-week programme (pure, deterministic)
//   todaySummary()  one plain-text sentence about today's session (for a voice assistant)
import type { HealthProfile } from '../../data/conditions/profile'
import type { Context } from '../../data/contexts'
import type { SavedAssessment } from '../clinic'
import type { Evaluation } from '../health'
import type { Measurement } from '../types'
import { generateProgramme, todaySummary as summaryOf, type Programme } from './generate'
import { cleanTrainingProfile, defaultTrainingProfile } from './profile'
import { buildSafety, type Safety } from './safety'
import { suggestFocus, type FocusSuggestionFull } from './suggest'
import type { SessionLog, TrainingProfile } from './types'

export type CoachInput = {
  context: Context
  ev: Evaluation | null
  rows: Measurement[]
  profile: HealthProfile | null
  latest: SavedAssessment | null
  sleepAvg: number | null
  /** Tracking day (mission day in space). */
  day: number
  /** Local date, YYYY-MM-DD. */
  today: string
  training: TrainingProfile | null
  logs: SessionLog[]
  now?: number
}

export type CoachResult = { suggestions: FocusSuggestionFull[]; training: TrainingProfile; saved: boolean; safety: Safety; programme: Programme }

export function buildCoach(input: CoachInput): CoachResult {
  const { context, ev, rows, profile, latest, sleepAvg, day, today, logs, now } = input
  const saved = !!input.training
  const draftLimits = input.training?.limits ?? []
  const suggestions = suggestFocus({ context, ev, rows, profile, latest, day, limits: draftLimits, now })
  const training = input.training ? cleanTrainingProfile({ ...input.training, context }, context, today) : defaultTrainingProfile(context, suggestions, today)
  const safety = buildSafety({ context, ev, profile, latest, sleepAvg, training, now })
  const recovering = suggestions.some((s) => s.why.some((w) => w.ruleId === 'bedRest'))
  const programme = generateProgramme({ training, safety, today, logs, ageBand: profile?.ageBand ?? null, conditions: profile?.conditions ?? [], recovering })
  return { suggestions, training, saved, safety, programme }
}

/** A short sentence about today's session, e.g. "Today: strength + balance, about 30 minutes, 6 exercises, starting with sit-to-stand." */
export function todaySummary(result: Pick<CoachResult, 'programme' | 'safety'>): string {
  return summaryOf(result.programme, result.safety.holdReason)
}

export { generateProgramme, buildSafety, suggestFocus }
export { adaptFromLogs, classify, plannedStep } from './adapt'
export { canReadCoach, canWriteCoach, loadCoach, logSession, saveTrainingProfile } from './store'
export { cleanTrainingProfile, defaultTrainingProfile, isoDate } from './profile'
export type { Programme, Safety, FocusSuggestionFull }
export type * from './types'
