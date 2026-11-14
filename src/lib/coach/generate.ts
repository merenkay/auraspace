// Programme generator: training profile + safety layer + session logs → a 4-week block with a weekly schedule.
// Pure and deterministic: the same inputs always give the same programme. Every number that is AURA's own
// modelling (session split, minutes per exercise, step sizes) is labelled "AURA rule" in the UI; the guidance
// behind it is cited from src/data/coach/sources.ts.
import type { AgeBand } from '../../data/conditions/types'
import { CONTEXTS, type Context } from '../../data/contexts'
import { FOCUS_BY_ID, WEEKDAY } from '../../data/coach/catalog'
import { EXERCISES, EXERCISE_BY_ID, type Exercise } from '../../data/coach/exercises'
import type { CoachRuleId } from '../../data/coach/sources'
import { adaptFromLogs, plannedStep, type AdaptResult } from './adapt'
import { addDays, daysBetween, weekdayOf } from './profile'
import { TAG_LABEL, type Safety } from './safety'
import type { Dose, FocusId, Level, Pattern, PlannedExercise, PlannedSession, Restriction, SessionLog, SessionPart, SessionType, Substitution, TrainingProfile, Week } from './types'

export type GenerateInput = {
  training: TrainingProfile
  safety: Safety
  today: string
  logs: SessionLog[]
  ageBand?: AgeBand | null
  conditions?: string[]
  /** The suggestion engine found a recent serious illness (bed rest). */
  recovering?: boolean
}

export type Cited = { text: string; ruleId?: CoachRuleId; rule?: boolean }

export type Programme = {
  focus: FocusId[]
  context: Context
  blockNumber: number
  weekIndex: number
  blockStart: string
  weeks: Week[]
  today: PlannedSession | null
  next: PlannedSession | null
  adapt: AdaptResult
  substitutions: Substitution[]
  restrictions: Restriction[]
  targets: { days: number; strength: number; aerobic: number; balance: number; aerobicMinutes: number }
  adjustments: Cited[]
  notes: Cited[]
  rules: CoachRuleId[]
  onHold: boolean
  adherence: { done: number; planned: number; doneKeys: string[] }
}

/* ------------------------------------------------------------------ weekly targets (AURA rule, sourced basis) */

type Rx = { s: number; a: number; b: number; minDays?: number; basis: CoachRuleId }
const RX: Record<FocusId, Rx> = {
  muscle: { s: 3, a: 1, b: 0, basis: 'novice' },
  bone: { s: 3, a: 1, b: 0, basis: 'boneResistImpact' },
  balance: { s: 2, a: 1, b: 3, minDays: 3, basis: 'fallsDose' },
  back: { s: 2, a: 2, b: 0, basis: 'backGroup' },
  bp: { s: 2, a: 4, b: 0, basis: 'htnEndurance' },
  glucose: { s: 2, a: 3, b: 0, minDays: 3, basis: 'dmGap' },
  mood: { s: 2, a: 3, b: 0, basis: 'moodGroup' },
  sleep: { s: 2, a: 3, b: 0, basis: 'sleepDaytime' },
  joints: { s: 2, a: 2, b: 0, basis: 'oaExercise' },
  fitness: { s: 2, a: 3, b: 0, basis: 'adultsWeekly' },
}

/** Training days spread across the week (0 = Monday). */
const SPREAD: Record<number, number[]> = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5], 7: [0, 1, 2, 3, 4, 5, 6] }

const BASE_ORDER: Pattern[] = ['squat', 'push', 'hinge', 'pull', 'calf', 'hip-side', 'core', 'back-ext', 'arms']
const FOCUS_ORDER: Partial<Record<FocusId, Pattern[]>> = {
  muscle: ['squat', 'hinge', 'push', 'pull', 'calf', 'arms', 'core'],
  bone: ['squat', 'hinge', 'back-ext', 'calf', 'pull'],
  balance: ['squat', 'calf', 'hip-side', 'hinge'],
  back: ['back-ext', 'core', 'hinge', 'hip-side', 'squat', 'pull'],
  joints: ['squat', 'hip-side', 'calf', 'hinge', 'push', 'pull'],
}
const LOWER = new Set<Pattern>(['squat', 'hinge', 'calf', 'hip-side', 'core', 'back-ext'])
const UPPER = new Set<Pattern>(['push', 'pull', 'arms', 'core', 'back-ext'])
const STRENGTH_EFFORT: Record<Level, [number, number]> = { starting: [5, 6], some: [6, 7], regular: [7, 8] }

/* ------------------------------------------------------------------ why each session is in the plan */

type Why = Partial<Record<'strength' | 'aerobic' | 'balance', [string, CoachRuleId]>>
const WHY: Record<FocusId, Why> = {
  muscle: { strength: ['Resistance training is the strongest-evidence treatment for muscle loss.', 'sarcopeniaRT'], aerobic: ['An aerobic day lets trained muscles recover — the same group is not worked two days running.', 'noConsecutive'] },
  bone: { strength: ['Progressive resistance work loads bone as well as muscle.', 'boneProgressive'], aerobic: ['Weight-bearing activity and impact load the bones.', 'boneResistImpact'] },
  balance: { balance: ['Balance-challenging, functional exercise three times a week prevents falls.', 'fallsDose'], strength: ['Leg strength makes standing and stepping safer.', 'fallsStart'] },
  back: { strength: ['Strengthening exercise is a recommended treatment for low back pain.', 'backGroup'], aerobic: ['Staying active helps back pain settle.', 'backActive'] },
  bp: { aerobic: ['Endurance exercise lowers blood pressure.', 'htnLowers'], strength: ['Moderate strength work supplements the endurance training — breathe steadily.', 'htnEndurance'] },
  glucose: { strength: ['Resistance training on non-consecutive days helps blood-sugar control.', 'dmResistance'], aerobic: ['Regular aerobic activity, never more than 2 days apart, improves insulin action.', 'dmGap'] },
  mood: { aerobic: ['Moderate aerobic exercise more than once a week is a recommended option for low mood.', 'moodGroup'], strength: ['Strength work on 2 days completes the weekly activity guideline.', 'adultsWeekly'] },
  sleep: { aerobic: ['Regular daytime exercise helps sleep — finish at least 4 hours before bed.', 'sleepDaytime'], strength: ['Strength work on 2 days completes the weekly activity guideline.', 'adultsWeekly'] },
  joints: { strength: ['Local muscle strengthening is a core treatment for painful joints.', 'oaExercise'], aerobic: ['General aerobic fitness is the other core treatment for painful joints.', 'oaExercise'] },
  fitness: { strength: ['Strength work on at least 2 days should cover all major muscle groups.', 'allMuscles'], aerobic: ['Moderate aerobic minutes count towards about 150 a week.', 'adultsWeekly'] },
}

/* ------------------------------------------------------------------ helpers */

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)

function available(ex: Exercise, ctx: Context, equipment: string[]) {
  return ex.contexts.includes(ctx) && (ex.needs.length === 0 || ex.needs.some((n) => equipment.includes(n)))
}

function blockFor(ex: Exercise, blocked: Restriction[]): Restriction | null {
  return blocked.find((b) => (ex.contra as string[]).includes(b.tag) || (ex.stress as string[]).includes(b.tag)) ?? null
}

type Picker = {
  ctx: Context
  equipment: string[]
  blocked: Restriction[]
  subs: Substitution[]
}

/**
 * Picks the exercise for a pattern: the rung that matches level + step, rotated among equal rungs by `seed`.
 * When a restriction rules it out, walks down the ladder (then up) to the nearest allowed exercise and records why.
 */
type Target = number | { level: Level; shift: number }

function pick(p: Picker, pattern: Pattern, target: Target, seed: number, prefer?: (e: Exercise) => boolean): Exercise | null {
  const ladder = EXERCISES.filter((e) => e.pattern === pattern && available(e, p.ctx, p.equipment))
  if (!ladder.length) return null
  const rungs = [...new Set(ladder.map((e) => e.rung))].sort((a, b) => a - b)
  let top: number
  if (typeof target === 'number') top = rungs.filter((r) => r <= target).pop() ?? rungs[0]
  else {
    // Level picks a position on whatever ladder this context and equipment allow: easiest, middle or top.
    const n = rungs.length
    const base = target.level === 'starting' ? 0 : target.level === 'some' ? Math.floor((n - 1) / 2) : n - 1
    top = rungs[Math.min(n - 1, Math.max(0, base + target.shift))]
  }
  const at = (r: number) => {
    const xs = ladder.filter((e) => e.rung === r)
    const pref = prefer ? xs.filter(prefer) : []
    const pool = pref.length ? pref : xs
    return pool[seed % pool.length]
  }
  const ideal = at(top)
  const order = [...rungs.filter((r) => r <= top).reverse(), ...rungs.filter((r) => r > top)]
  for (const r of order) {
    const xs = ladder.filter((e) => e.rung === r)
    const start = xs.indexOf(at(r))
    for (let i = 0; i < xs.length; i++) {
      const e = xs[(start + i) % xs.length]
      if (!blockFor(e, p.blocked)) {
        if (e !== ideal) note(p, ideal, e)
        return e
      }
    }
  }
  note(p, ideal, null)
  return null
}

function note(p: Picker, from: Exercise, to: Exercise | null) {
  const why = blockFor(from, p.blocked)!
  if (p.subs.some((s) => s.from === from.id && s.to === (to?.id ?? null))) return
  p.subs.push({ from: from.id, to: to?.id ?? null, reason: why.reason, ruleId: why.ruleId, rule: why.rule ?? !why.ruleId })
}

function capEffort(e: [number, number], cap: number | null): [number, number] {
  if (cap == null) return e
  const hi = Math.min(e[1], cap)
  return [Math.min(e[0], hi - 1), hi]
}

/** Dose for one exercise at a level and step (step already net of any rung change). */
export function doseFor(ex: Exercise, level: Level, step: number, cap: number | null, minutes = 0, hard = false): Dose {
  const loadBy = ex.needs.includes('ared') ? 'specialist' : ex.needs.some((n) => n === 'dumbbells' || n === 'band' || n === 'light-weights') ? 'you' : undefined
  if (ex.dose.timed) {
    const base: [number, number] = hard ? [7, 8] : step < 0 ? [4, 5] : [5, 6]
    return { sets: 1, minutes, effort: capEffort(base, cap), ...(loadBy ? { loadBy } : {}) }
  }
  const [lo, hi] = ex.dose.reps ?? [1, 1]
  const setsMax = ex.dose.setsMax
  let sets = ex.kind === 'impact' ? Math.min(2, setsMax) : level === 'starting' ? 1 : Math.min(2, setsMax)
  let reps = level === 'regular' ? Math.round((lo + hi) / 2) : lo
  if (step > 0) {
    for (let k = 0; k < step; k++) {
      if (ex.kind === 'impact' && sets < setsMax) sets += 1
      else if (reps < hi) reps = Math.min(hi, reps + Math.max(1, Math.ceil((hi - lo) / 2)))
      else if (sets < setsMax) {
        sets += 1
        reps = lo
      }
    }
  } else if (step < 0) {
    sets = Math.max(1, sets - 1)
    reps = lo
  }
  const hold = ex.dose.hold ? (step > 0 ? ex.dose.hold[1] : ex.dose.hold[0]) : undefined
  let effort: [number, number] = ex.kind === 'strength' ? STRENGTH_EFFORT[level] : ex.kind === 'impact' ? [5, 6] : [3, 5]
  if (step < 0 && ex.kind === 'strength') effort = [Math.max(3, effort[0] - 1), effort[1] - 1]
  const restSec = ex.kind === 'strength' ? 90 : ex.kind === 'impact' ? 60 : undefined
  return { sets, reps, repsMax: hi, ...(hold ? { seconds: hold } : {}), ...(ex.dose.perSide ? { perSide: true } : {}), ...(restSec ? { restSec } : {}), effort: ex.kind === 'mobility' ? effort : capEffort(effort, cap), ...(loadBy ? { loadBy } : {}) }
}

/** Splits a step into a ladder move and the remaining dose step. */
function split(step: number): { rung: number; dose: number } {
  if (step >= 3) {
    const rung = Math.floor(step / 3)
    return { rung, dose: step - rung * 3 }
  }
  if (step <= -2) return { rung: -1, dose: -1 }
  return { rung: 0, dose: step }
}

/* ------------------------------------------------------------------ generator */

export function generateProgramme({ training, safety, today, logs, ageBand = null, conditions = [], recovering = false }: GenerateInput): Programme {
  const ctx = training.context
  const contact = CONTEXTS[ctx].contact
  const focus: FocusId[] = training.focus.length ? training.focus : ['fitness']
  const primary = focus[0]
  const space = ctx === 'space'
  const adjustments: Cited[] = []
  const rules = new Set<CoachRuleId>()

  // ---- calendar
  const sinceStart = Math.max(0, daysBetween(training.startedAt, today))
  const weeksSince = Math.floor(sinceStart / 7)
  const blockNumber = Math.floor(weeksSince / 4) + 1
  const weekIndex = (weeksSince % 4) + 1
  const blockStart = addDays(training.startedAt, (blockNumber - 1) * 28)

  // ---- days and weekly targets
  let days = training.daysPerWeek
  for (const f of focus) {
    const min = RX[f].minDays
    if (min && days < min) {
      adjustments.push({ text: `Training days raised from ${days} to ${min} for ${FOCUS_BY_ID[f].label.toLowerCase()}.`, ruleId: RX[f].basis })
      days = min
    }
  }
  const older = ageBand === '65-79' || ageBand === '80+'
  let S = Math.min(days, Math.max(2, ...focus.map((f) => RX[f].s)))
  let A = Math.min(days, Math.max(...focus.map((f) => RX[f].a)))
  let B = Math.min(days, Math.max(ctx === 'home' || older ? 2 : 0, ...focus.map((f) => RX[f].b)))
  if (space) {
    S = days
    A = days
    B = 0
    rules.add('spaceSchedule').add('spaceResistive').add('spaceAerobic')
  }
  for (const f of focus) rules.add(RX[f].basis)
  if (safety.lightOnly) {
    S = 0
    adjustments.push({ text: `Strength work is paused: light activity only until your ${contact} has reviewed your recent assessment.`, rule: true })
  }

  const positions = SPREAD[days] ?? SPREAD[3]
  const strengthIdx = new Set<number>()
  for (let i = 0; i < S; i++) strengthIdx.add(Math.floor((i * positions.length) / S))
  const strengthDays = [...strengthIdx].map((i) => positions[i])
  const adjacent = (a: number, b: number) => Math.abs(a - b) === 1 || Math.abs(a - b) === 6
  const needSplit = !space && strengthDays.some((d, i) => strengthDays.some((e, j) => i !== j && adjacent(d, e)))
  if (needSplit) adjustments.push({ text: 'Strength days fall on consecutive days, so they alternate legs and upper body.', ruleId: 'noConsecutive' })

  const aerobicDays = new Set<number>()
  for (const d of positions) if (aerobicDays.size < A && !strengthDays.includes(d)) aerobicDays.add(d)
  for (const d of [...positions].reverse()) if (aerobicDays.size < A) aerobicDays.add(d)
  if (safety.lightOnly) positions.forEach((d) => aerobicDays.add(d))
  const balanceDays = new Set<number>()
  for (let i = 0; i < B; i++) balanceDays.add(positions[Math.floor((i * positions.length) / B)])
  const impactAll = focus.includes('bone') && !space

  // ---- adaptation from the log
  const capNow = plannedStep(blockNumber, weekIndex)
  const adapt = adaptFromLogs(logs, { caution: safety.caution, cap: capNow, contact, since: training.startedAt })
  const stepForWeek = (w: number) => {
    if (w <= weekIndex) return w === weekIndex ? adapt.step : plannedStep(blockNumber, w)
    return safety.caution ? adapt.step : Math.min(plannedStep(blockNumber, w), adapt.step + (w - weekIndex))
  }

  const picker: Picker = { ctx, equipment: training.equipment, blocked: safety.blocked, subs: [] }
  let shortSessions = false
  const level = training.level
  const capVal = safety.effortCap?.max ?? null

  const buildSession = (w: number, weekday: number, n: number): PlannedSession => {
    const date = addDays(blockStart, (w - 1) * 7 + weekday)
    const step = stepForWeek(w)
    const sp = split(step)
    const rung: Target = { level, shift: sp.rung }
    const seed = w * 7 + weekday
    const hasStrength = strengthDays.includes(weekday)
    const split2 = needSplit && hasStrength ? (strengthDays.indexOf(weekday) % 2 === 0 ? 'lower' : 'upper') : 'full'
    const aerobicOn = aerobicDays.has(weekday)
    const hasBalance = balanceDays.has(weekday)
    const wantHard = !space ? level === 'regular' && (focus.includes('fitness') || focus.includes('mood')) && n === 1 : level === 'regular' && n % 3 === 1
    const warmMin = 5
    const coolMin = safety.cooldownMin
    const main = Math.max(10, training.minutes - warmMin - coolMin)

    // Warm-up
    const warmEx = space ? pick(picker, 'warm', 0, 0) : pick(picker, 'warm', 1, 0)
    const warmup: SessionPart = { title: 'Warm-up', minutes: warmMin, items: warmEx ? [{ exerciseId: warmEx.id, dose: { ...(warmEx.dose.timed ? doseFor(warmEx, level, 0, capVal, warmMin) : doseFor(warmEx, level, 0, capVal)), effort: [3, 4] } }] : [] }
    rules.add('warmUp')

    const parts: SessionPart[] = []
    // Minutes (AURA rule): balance about 6 min next to other work, impact 5 min, aerobic bouts at least 10 min,
    // strength at least 10 min. A short session drops its aerobic part rather than squeezing everything in.
    const impactMin = impactAll && hasStrength ? 5 : 0
    let balanceMin = hasBalance ? (hasStrength || aerobicOn ? 6 : main) : 0
    let hasAerobic = aerobicOn
    if (!space && hasStrength && hasAerobic && main < 20 + balanceMin + impactMin) {
      hasAerobic = false
      shortSessions = true
    }
    const rest = Math.max(0, main - balanceMin - impactMin)
    let aerobicMin = 0
    let strengthMin = 0
    if (space) {
      aerobicMin = hasStrength ? Math.min(30, Math.round(rest / 2)) : rest
      strengthMin = rest - aerobicMin
    } else if (hasStrength && hasAerobic) {
      const aerShare = ['bp', 'glucose', 'mood', 'sleep'].includes(primary) ? 0.6 : primary === 'muscle' || primary === 'bone' ? 0.3 : 0.4
      aerobicMin = Math.min(rest - 10, Math.max(10, round5(rest * aerShare)))
      strengthMin = rest - aerobicMin
    } else if (hasStrength) strengthMin = rest
    else if (hasAerobic) aerobicMin = rest
    else balanceMin += rest

    const strengthItems: PlannedExercise[] = []
    if (hasStrength && !safety.lightOnly) {
      if (space) {
        const aredPatterns: Pattern[] = ['squat', 'hinge', 'calf']
        for (const pat of aredPatterns) {
          const e = pick(picker, pat, pat === 'squat' ? 1 + (n % 2) : 1, seed)
          if (e) strengthItems.push({ exerciseId: e.id, dose: doseFor(e, level, sp.dose, capVal) })
        }
        rules.add('aredExercises').add('aredHeelRaise').add('spaceSpecialist')
      } else {
        const count = Math.min(8, Math.max(2, Math.round(strengthMin / 4)))
        const order: Pattern[] = []
        for (const f of focus) for (const p of FOCUS_ORDER[f] ?? []) if (!order.includes(p)) order.push(p)
        for (const p of BASE_ORDER) if (!order.includes(p)) order.push(p)
        const allowed = order.filter((p) => split2 === 'full' || (split2 === 'lower' ? LOWER.has(p) : UPPER.has(p)))
        for (const pat of allowed) {
          if (strengthItems.length >= count) break
          const e = pick(picker, pat, rung, seed)
          if (e) strengthItems.push({ exerciseId: e.id, dose: doseFor(e, level, sp.dose, capVal) })
        }
        rules.add('setsReps').add('rest').add('breathing')
        if (level === 'starting') rules.add('beginnerNoWeights')
      }
    }
    const impactItems: PlannedExercise[] = []
    if (impactMin) {
      const e = pick(picker, 'impact', { level: 'starting', shift: Math.max(0, sp.rung) }, seed)
      if (e) {
        impactItems.push({ exerciseId: e.id, dose: doseFor(e, level, sp.dose, capVal) })
        rules.add('boneImpactDose')
      }
    }
    const balanceItems: PlannedExercise[] = []
    if (hasBalance) {
      const pats: Pattern[] = focus.includes('balance') && training.equipment.includes('step') ? ['balance-static', 'balance-walk', 'step'] : ['balance-static', 'balance-walk']
      for (const pat of pats) {
        const e = pick(picker, pat, rung, seed)
        if (e) balanceItems.push({ exerciseId: e.id, dose: e.dose.timed ? doseFor(e, level, sp.dose, capVal, Math.max(5, balanceMin - 4)) : doseFor(e, level, sp.dose, capVal) })
      }
      rules.add('balanceSupport')
    }
    const aerobicItems: PlannedExercise[] = []
    if (aerobicMin > 0) {
      const t2Day = focus.includes('bone') ? n % 3 !== 2 : n % 2 === 0
      const pref = space
        ? (e: Exercise) => (t2Day ? e.needs.includes('t2') : e.needs.includes('cevis'))
        : (e: Exercise) => (focus.includes('joints') ? e.needs.includes('bike') || e.id === 'walk-brisk' : focus.includes('bone') ? e.contra.includes('standing') : true)
      let e: Exercise | null = null
      let hard = wantHard && !safety.lightOnly
      if (hard) {
        // Intervals only when nothing rules out vigorous effort; otherwise the steady version, with the reason shown.
        e = pick({ ...picker, subs: [] }, 'aerobic-hard', 2, seed, pref)
        if (!e) hard = false
      }
      if (!e) e = pick(picker, 'aerobic', 1, seed, pref)
      if (wantHard && !hard && e) {
        const ideal = EXERCISES.find((x) => x.pattern === 'aerobic-hard' && available(x, ctx, training.equipment) && pref(x))
        if (ideal && blockFor(ideal, picker.blocked)) note(picker, ideal, e)
      }
      if (e) aerobicItems.push({ exerciseId: e.id, dose: doseFor(e, level, sp.dose, safety.lightOnly ? Math.min(capVal ?? 4, 4) : capVal, aerobicMin, hard) })
      rules.add(space ? (e?.needs.includes('t2') ? 't2Dose' : 'cevisDose') : 'talkTest')
      if (hard) rules.add('effortScale')
    }

    // ADA: resistance before aerobic. Balance after strength while fresh; impact with the strength block.
    if (strengthItems.length || impactItems.length) parts.push({ title: space ? 'ARED resistive' : split2 === 'lower' ? 'Strength · legs' : split2 === 'upper' ? 'Strength · upper body' : 'Strength', minutes: strengthMin + impactMin, items: [...strengthItems, ...impactItems] })
    if (balanceItems.length) parts.push({ title: 'Balance', minutes: balanceMin, items: balanceItems })
    if (aerobicItems.length) parts.push({ title: space ? 'Aerobic' : 'Aerobic', minutes: aerobicMin, items: aerobicItems })

    // Cool-down: two stretches.
    const coolPats: Pattern[] = focus.includes('back') ? ['stretch-spine', 'stretch-lower'] : n % 2 === 0 ? ['stretch-lower', 'stretch-upper'] : ['stretch-spine', 'stretch-lower']
    const coolItems: PlannedExercise[] = []
    for (const pat of coolPats) {
      const e = pick(picker, pat, 1, seed)
      if (e && !coolItems.some((c) => c.exerciseId === e.id)) coolItems.push({ exerciseId: e.id, dose: doseFor(e, level, 0, null) })
    }
    rules.add('flexibility').add('stretchSafe')
    const cooldown: SessionPart = { title: 'Cool-down', minutes: coolMin, items: coolItems }

    const type: SessionType = space ? 'space' : hasStrength && !safety.lightOnly && hasAerobic ? 'mixed' : hasStrength && !safety.lightOnly ? 'strength' : hasBalance && !hasAerobic ? 'balance' : 'aerobic'
    const aeroName = aerobicItems[0] ? EXERCISE_BY_ID[aerobicItems[0].exerciseId].name : ''
    const titleBits: string[] = []
    if (space) titleBits.push('ARED', aeroName.replace(/^T2 treadmill /, 'T2 ').replace(/^CEVIS /, 'CEVIS '))
    else {
      if (strengthItems.length) titleBits.push(split2 === 'lower' ? 'Strength (legs)' : split2 === 'upper' ? 'Strength (upper body)' : 'Strength')
      if (balanceItems.length) titleBits.push('balance')
      if (aerobicItems.length) titleBits.push(aeroName.toLowerCase())
    }
    const title = safety.lightOnly ? 'Light movement and stretches' : titleBits.filter(Boolean).join(' + ').replace(/^./, (c) => c.toUpperCase())

    // Why: the first focus with a reason for this session's main component.
    const comp: ('strength' | 'aerobic' | 'balance')[] = hasBalance && focus.includes('balance') ? ['balance', 'strength', 'aerobic'] : strengthItems.length ? ['strength', 'aerobic', 'balance'] : ['aerobic', 'balance', 'strength']
    let why: [string, CoachRuleId] | null = null
    if (space) why = focus.includes('bone') && aerobicItems[0]?.exerciseId.startsWith('t2') ? ['Treadmill and resistance volume were the key countermeasure factors for bone and muscle in flight.', 'spaceVolume'] : ['Daily resistive and aerobic exercise is the NASA flight countermeasure for muscle, bone and fitness.', 'spaceStrengthStd']
    for (const c of comp) for (const f of focus) if (!why && WHY[f][c]) why = WHY[f][c]!
    if (safety.lightOnly) why = [`Light movement keeps you active while your ${contact} reviews your recent assessment.`, 'anyAmount']
    if (why) rules.add(why[1])

    return {
      key: `b${blockNumber}w${w}d${weekday}`,
      date,
      weekday,
      type,
      title,
      minutes: warmMin + parts.reduce((s, p) => s + p.minutes, 0) + coolMin,
      why: why ? why[0] : 'Regular activity is better than none.',
      whyRule: why ? why[1] : 'anyAmount',
      warmup,
      main: parts,
      cooldown,
    }
  }

  const WEEK_LABEL = ['Learn the movements', 'Build', 'Build', 'Consolidate']
  const WEEK_NOTE = [
    'Start at the easy end of each range and focus on form.',
    'If last week felt manageable (effort 6 or less, no pain), AURA adds repetitions or a set.',
    'Another small step, only after two manageable sessions in a row.',
    `Keep the dose steady and review your progress with your ${contact} before the next block.`,
  ]
  const weeks: Week[] = [1, 2, 3, 4].map((w) => ({
    index: w,
    label: WEEK_LABEL[w - 1],
    note: safety.caution && w > weekIndex ? `Planned steps are paused while a caution is active — your ${contact} decides when to step up.` : WEEK_NOTE[w - 1],
    sessions: positions.map((d, n) => buildSession(w, d, n)),
  }))

  if (shortSessions) adjustments.push({ text: `Sessions of ${training.minutes} minutes are too short for strength and aerobic work together, so aerobic work goes on the other days. Longer sessions combine both.`, rule: true })
  const current = weeks[weekIndex - 1]
  const todaySession = current.sessions.find((s) => s.date === today) ?? null
  const upcoming = weeks.flatMap((w) => w.sessions).filter((s) => s.date > today)
  const next = upcoming[0] ?? null

  // Adherence this week.
  const weekStart = addDays(blockStart, (weekIndex - 1) * 7)
  const weekEnd = addDays(weekStart, 6)
  const weekLogs = logs.filter((l) => l.date >= weekStart && l.date <= weekEnd)
  const doneKeys = current.sessions.filter((s) => weekLogs.some((l) => l.sessionKey === s.key || l.date === s.date)).map((s) => s.key)
  const adherence = { done: doneKeys.length, planned: current.sessions.length, doneKeys }

  // Notes tied to the chosen focus areas.
  const notes: Cited[] = []
  if (focus.includes('muscle')) {
    if (older) notes.push(conditions.includes('kidney-disease') ? { text: 'Protein matters for muscle, but with kidney disease the right amount must come from your doctor.', ruleId: 'proteinKidney' } : { text: 'Eat enough protein: people over 65 are advised at least 1.0–1.2 g per kg of body weight a day, more if active. Check with your doctor if you have kidney disease.', ruleId: 'protein' })
    if (recovering) notes.push({ text: 'After an illness or time in bed, leg strength drops quickly — rebuild it gradually with this plan.', ruleId: 'bedRest' })
  }
  if (focus.includes('back')) notes.push({ text: 'Stop a back exercise if the pain gets worse and see a doctor.', ruleId: 'backStop' }, { text: 'Back pain with numbness around the genitals, weakness in both legs, or bladder or bowel changes is an emergency.', ruleId: 'backRedFlag' })
  if (focus.includes('joints')) notes.push({ text: 'Joint pain may increase a little when you start; regular exercise still helps your joints in the long run.', ruleId: 'oaPain' })
  if (focus.includes('sleep')) notes.push({ text: 'Exercise during the day and finish at least 4 hours before bed.', ruleId: 'sleepLate' })
  if (focus.includes('glucose')) notes.push({ text: 'Between sessions, break up sitting with a few minutes of light activity every 30 minutes.', ruleId: 'dmSitting' })
  if (focus.includes('mood')) notes.push({ text: 'Pick the activities you enjoy — even a brisk 10-minute walk counts.', ruleId: 'moodAny' })
  if (space) notes.push({ text: 'Loads, speeds and work rates come from your exercise specialist; AURA suggests repetitions and sets only.', ruleId: 'spaceSpecialist' })
  const usesLoad = weeks.some((w) => w.sessions.some((s) => s.main.some((p) => p.items.some((i) => i.dose.loadBy))))
  if (usesLoad) notes.push({ text: `When you can do 1–2 repetitions more than the target, ask your ${space ? 'exercise specialist' : contact} about a 2–10% heavier load. AURA never raises loads on its own.`, ruleId: 'loadStep' })
  for (const n of notes) if (n.ruleId) rules.add(n.ruleId)
  for (const s of picker.subs) if (s.ruleId) rules.add(s.ruleId as CoachRuleId)
  for (const n of safety.notes) if (n.ruleId) rules.add(n.ruleId)

  const aerobicMinutes = current.sessions.reduce((s, x) => s + x.main.filter((p) => p.title === 'Aerobic').reduce((a, p) => a + p.minutes, 0), 0)

  return {
    focus,
    context: ctx,
    blockNumber,
    weekIndex,
    blockStart,
    weeks,
    today: todaySession,
    next,
    adapt,
    substitutions: picker.subs,
    restrictions: safety.blocked,
    targets: {
      days,
      strength: current.sessions.filter((s) => s.main.some((p) => p.title.startsWith('Strength') || p.title === 'ARED resistive')).length,
      aerobic: current.sessions.filter((s) => s.main.some((p) => p.title === 'Aerobic')).length,
      balance: current.sessions.filter((s) => s.main.some((p) => p.title === 'Balance')).length,
      aerobicMinutes,
    },
    adjustments,
    notes,
    rules: [...rules],
    onHold: safety.onHold,
    adherence,
  }
}

/** One plain-text sentence about today's session, for a voice assistant. */
export function todaySummary(p: Programme, holdReason?: string | null): string {
  if (p.onHold) return `Training is on hold today${holdReason ? `: ${holdReason.toLowerCase()}` : ''}. Check the restrictions on the Coach page first.`
  const s = p.today
  if (!s) {
    if (!p.next) return 'There is no session planned. Open the Coach page to set up your programme.'
    return `Today is a rest day. Next session: ${WEEKDAY[p.next.weekday]}, ${p.next.title.toLowerCase()}, about ${p.next.minutes} minutes.`
  }
  const items = s.main.flatMap((m) => m.items)
  const first = items[0] ? EXERCISE_BY_ID[items[0].exerciseId]?.name : null
  const done = p.adherence.doneKeys.includes(s.key)
  return `${done ? 'Done today' : 'Today'}: ${s.title.toLowerCase()}, about ${s.minutes} minutes, ${items.length} exercise${items.length === 1 ? '' : 's'}${first ? `, starting with ${first.toLowerCase()}` : ''}.`
}

export { TAG_LABEL }
export const weekdayOfDate = weekdayOf
