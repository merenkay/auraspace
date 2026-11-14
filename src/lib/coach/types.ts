// Types shared by the training-programme engine, its knowledge base and the Coach page.
import type { Context } from '../../data/contexts'

export type FocusId = 'muscle' | 'bone' | 'balance' | 'back' | 'bp' | 'glucose' | 'mood' | 'sleep' | 'joints' | 'fitness'
export type Level = 'starting' | 'some' | 'regular'
export type EquipmentId = 'ared' | 't2' | 'cevis' | 'chair' | 'wall' | 'band' | 'light-weights' | 'dumbbells' | 'bench' | 'step' | 'bike' | 'treadmill'
export type LimitId = 'knee' | 'hip' | 'shoulder' | 'wrist' | 'back' | 'no-floor' | 'seated' | 'no-impact'

/** The person's own training settings (separate from the health profile). */
export type TrainingProfile = {
  focus: FocusId[]
  /** True once the person has confirmed or changed the suggested focus areas. */
  confirmed: boolean
  level: Level
  daysPerWeek: number
  minutes: number
  equipment: EquipmentId[]
  limits: LimitId[]
  /** ISO date (YYYY-MM-DD) the current 4-week block started. */
  startedAt: string
  updatedAt: string | null
  context: Context
}

/** Physical demands of an exercise that a restriction can rule out. */
export type ContraTag = 'spinal-flexion' | 'impact' | 'unsupported-balance' | 'standing' | 'floor' | 'isometric' | 'vigorous'
export type Joint = 'knee' | 'hip' | 'shoulder' | 'wrist' | 'back'
export type Muscle = 'legs' | 'hips' | 'back' | 'abdomen' | 'chest' | 'shoulders' | 'arms' | 'calves'
export type Kind = 'strength' | 'balance' | 'aerobic' | 'impact' | 'mobility'
export type Pattern =
  | 'squat' | 'hinge' | 'push' | 'pull' | 'arms' | 'calf' | 'hip-side' | 'core' | 'back-ext'
  | 'balance-static' | 'balance-walk' | 'step' | 'impact' | 'aerobic' | 'aerobic-hard' | 'stretch-lower' | 'stretch-upper' | 'stretch-spine' | 'warm'

/** How much of an exercise to do. Effort is on the CDC 0–10 scale. */
export type Dose = {
  sets: number
  reps?: number
  /** Top of the repetition range for this exercise (progression stops adding reps here). */
  repsMax?: number
  seconds?: number
  minutes?: number
  perSide?: boolean
  restSec?: number
  effort: [number, number]
  /** Load comes from someone else (ARED, dumbbells): AURA only suggests reps and sets. */
  loadBy?: 'specialist' | 'you'
}

export type Restriction = { tag: ContraTag | Joint; reason: string; ruleId?: string; rule?: boolean }

export type Substitution = { from: string; to: string | null; reason: string; ruleId?: string; rule?: boolean }

export type PlannedExercise = { exerciseId: string; dose: Dose; note?: string }

export type SessionPart = { title: string; minutes: number; items: PlannedExercise[] }

export type SessionType = 'strength' | 'aerobic' | 'balance' | 'space' | 'mixed'

export type PlannedSession = {
  key: string // e.g. "w2d3" — block week + weekday (0 = Monday)
  date: string // ISO date
  weekday: number
  type: SessionType
  title: string
  minutes: number
  why: string
  whyRule: string | null
  warmup: SessionPart
  main: SessionPart[]
  cooldown: SessionPart
}

export type Week = { index: number; label: string; note: string; sessions: PlannedSession[] }

export type StepDecision = 'progress' | 'hold' | 'regress' | 'start'
export type Adapt = { decision: StepDecision; step: number; reason: string; suggestedOnly: boolean }

export type SessionLog = {
  id: number
  date: string // ISO date
  sessionKey: string
  minutes: number
  effort: number // 0–10
  pain: boolean
  createdAt: string
}

export type FocusSuggestion = { id: FocusId; score: number; reasons: string[] }
