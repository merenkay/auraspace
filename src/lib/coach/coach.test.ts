import { describe, expect, it } from 'vitest'
import { EXERCISES, EXERCISE_BY_ID } from '../../data/coach/exercises'
import { COACH_RULES, COACH_SOURCES } from '../../data/coach/sources'
import { emptyProfile, type HealthProfile } from '../../data/conditions/profile'
import type { Context } from '../../data/contexts'
import type { SavedAssessment } from '../clinic'
import { evaluate } from '../health'
import type { Measurement } from '../types'
import { adaptFromLogs, classify, plannedStep } from './adapt'
import { buildCoach, todaySummary, type CoachInput } from './index'
import type { Programme } from './generate'
import type { FocusId, SessionLog, TrainingProfile } from './types'

const TODAY = '2026-11-16' // a Monday
const NOW = Date.parse('2026-11-16T12:00:00Z')

const training = (p: Partial<TrainingProfile> = {}): TrainingProfile => ({
  focus: ['fitness'], confirmed: true, level: 'some', daysPerWeek: 3, minutes: 45, equipment: ['chair', 'wall', 'band', 'light-weights', 'step'], limits: [], startedAt: TODAY, updatedAt: null, context: 'home', ...p,
})

function rowsWith(values: Partial<Record<Measurement['metric'], number>>, day = 20): Measurement[] {
  let id = 1
  return Object.entries(values).map(([metric, value]) => ({ id: id++, crewId: 1000, metric: metric as Measurement['metric'], value: value as number, day, at: '2026-11-16T08:00:00Z', source: 'manual', device: 'test' }))
}

function input(p: Partial<CoachInput> & { context?: Context } = {}): CoachInput {
  const context = p.context ?? 'home'
  const rows = p.rows ?? []
  const ev = p.ev !== undefined ? p.ev : rows.length ? evaluate(rows, { context, profileId: 'iss', day: 20 }) : null
  return { context, ev, rows, profile: null, latest: null, sleepAvg: null, day: 20, today: TODAY, training: training({ context }), logs: [], now: NOW, ...p }
}

const run = (p: Partial<CoachInput> = {}) => buildCoach(input(p))
const items = (prog: Programme) => prog.weeks.flatMap((w) => w.sessions.flatMap((s) => [s.warmup, ...s.main, s.cooldown].flatMap((x) => x.items)))
const exercises = (prog: Programme) => items(prog).map((i) => EXERCISE_BY_ID[i.exerciseId])
const week1 = (prog: Programme) => prog.weeks[0].sessions
const withFocus = (focus: FocusId[], extra: Partial<TrainingProfile> = {}, rest: Partial<CoachInput> = {}) => run({ ...rest, training: training({ focus, ...extra, context: rest.context ?? 'home' }) })

describe('knowledge base', () => {
  it('has a focused exercise library with easier and harder versions and valid sources', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(40)
    expect(EXERCISES.length).toBeLessThanOrEqual(60)
    expect(new Set(EXERCISES.map((e) => e.id)).size).toBe(EXERCISES.length)
    for (const e of EXERCISES) {
      expect(e.easier.length, e.id).toBeGreaterThan(3)
      expect(e.harder.length, e.id).toBeGreaterThan(3)
      expect(e.steps.length, e.id).toBeGreaterThan(0)
      if (e.source) expect(COACH_SOURCES[e.source], e.id).toBeTruthy()
    }
  })
  it('every rule carries a source URL and a verbatim quote', () => {
    for (const r of Object.values(COACH_RULES)) {
      expect(COACH_SOURCES[r.s].url, r.id).toMatch(/^https:\/\//)
      expect(r.q.length, r.id).toBeGreaterThan(5)
    }
  })
})

describe('programme generator', () => {
  it('is deterministic: same inputs give the same programme', () => {
    const a = run({ training: training({ focus: ['muscle', 'balance'] }) })
    const b = run({ training: training({ focus: ['muscle', 'balance'] }) })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.programme.weeks).toHaveLength(4)
  })

  it('muscle loss: progressive resistance on 3 days covering every major muscle group, with protein advice for older adults', () => {
    const muscle = withFocus(['muscle'], {}, { profile: { ...emptyProfile(), ageBand: '80+' } }).programme
    const fitness = withFocus(['fitness']).programme
    expect(muscle.targets.strength).toBe(3)
    expect(fitness.targets.strength).toBe(2)
    const groups = new Set(week1(muscle).flatMap((s) => s.main.filter((p) => p.title.startsWith('Strength')).flatMap((p) => p.items.flatMap((i) => EXERCISE_BY_ID[i.exerciseId].muscles))))
    for (const g of ['legs', 'hips', 'chest', 'back', 'arms'] as const) expect(groups.has(g), g).toBe(true)
    expect(week1(muscle)[0].whyRule).toBe('sarcopeniaRT')
    expect(muscle.notes.some((n) => n.ruleId === 'protein')).toBe(true)
    expect(muscle.rules).toContain('sarcopeniaRT')
  })

  it('protein advice defers to the doctor with kidney disease', () => {
    const p = withFocus(['muscle'], {}, { profile: { ...emptyProfile(), ageBand: '65-79', conditions: ['kidney-disease'] } }).programme
    expect(p.notes.some((n) => n.ruleId === 'proteinKidney')).toBe(true)
    expect(p.notes.some((n) => n.ruleId === 'protein')).toBe(false)
  })

  it('balance: three balance sessions a week, with supported versions', () => {
    const p = withFocus(['balance']).programme
    expect(p.targets.balance).toBe(3)
    expect(week1(p).every((s) => s.main.some((m) => m.title === 'Balance'))).toBe(true)
    expect(p.rules).toContain('fallsDose')
  })

  it('raised blood pressure: aerobic emphasis and breathing guidance', () => {
    const bp = withFocus(['bp']).programme
    const muscle = withFocus(['muscle']).programme
    expect(bp.targets.aerobic).toBeGreaterThanOrEqual(3)
    expect(bp.targets.aerobicMinutes).toBeGreaterThan(muscle.targets.aerobicMinutes)
    expect(bp.rules).toEqual(expect.arrayContaining(['htnEndurance', 'breathing']))
    expect(exercises(bp).some((e) => e.contra.includes('isometric') || e.contra.includes('vigorous'))).toBe(false)
  })

  it('bone loss: impact work, back extension and progressive loading', () => {
    const p = withFocus(['bone']).programme
    const ids = items(p).map((i) => i.exerciseId)
    expect(ids).toContain('stamping')
    expect(exercises(p).some((e) => e.pattern === 'back-ext')).toBe(true)
    expect(p.rules).toEqual(expect.arrayContaining(['boneResistImpact', 'boneImpactDose']))
  })

  it('low back pain: back extension and core first, with stop advice and red flags', () => {
    const p = withFocus(['back']).programme
    const first = week1(p)[0].main[0].items[0]
    expect(EXERCISE_BY_ID[first.exerciseId].pattern).toBe('back-ext')
    expect(p.notes.map((n) => n.ruleId)).toEqual(expect.arrayContaining(['backStop', 'backRedFlag']))
  })

  it('blood sugar: at least 3 days, no more than 2 days apart, strength not on consecutive days', () => {
    const p = withFocus(['glucose'], { daysPerWeek: 2 }).programme
    expect(p.targets.days).toBe(3)
    expect(p.adjustments.some((a) => a.ruleId === 'dmGap')).toBe(true)
    const days = week1(p).map((s) => s.weekday)
    const gaps = days.map((d, i) => (i ? d - days[i - 1] - 1 : d + 7 - days[days.length - 1] - 1))
    expect(Math.max(...gaps)).toBeLessThanOrEqual(2)
    expect(p.notes.some((n) => n.ruleId === 'dmSitting')).toBe(true)
  })

  it('mood, sleep and joints each change the plan', () => {
    const mood = withFocus(['mood']).programme
    expect(mood.targets.aerobic).toBeGreaterThanOrEqual(2)
    expect(mood.rules).toContain('moodGroup')
    const sleep = withFocus(['sleep']).programme
    expect(sleep.notes.some((n) => n.ruleId === 'sleepLate')).toBe(true)
    const joints = withFocus(['joints'], { equipment: ['chair', 'wall', 'bike'] }).programme
    const aerobic = week1(joints).flatMap((s) => s.main.filter((m) => m.title === 'Aerobic').flatMap((m) => m.items.map((i) => i.exerciseId)))
    expect(aerobic.every((id) => id === 'bike-steady')).toBe(true)
    expect(joints.notes.some((n) => n.ruleId === 'oaPain')).toBe(true)
  })

  it('space: ARED resistive work plus about 30 minutes on CEVIS or T2 on 6 days, loads left to the specialist', () => {
    const r = run({ context: 'space', day: 142, training: null })
    const p = r.programme
    expect(r.training.focus.slice(0, 2)).toEqual(['muscle', 'bone'])
    expect(week1(p)).toHaveLength(6)
    for (const s of week1(p)) {
      expect(s.main.find((m) => m.title === 'ARED resistive')?.items.length).toBeGreaterThan(0)
      const aer = s.main.find((m) => m.title === 'Aerobic')!
      expect(aer.minutes).toBe(30)
      expect(['cevis', 't2'].some((eq) => EXERCISE_BY_ID[aer.items[0].exerciseId].needs.includes(eq as never))).toBe(true)
    }
    expect(items(p).filter((i) => EXERCISE_BY_ID[i.exerciseId].needs.includes('ared')).every((i) => i.dose.loadBy === 'specialist')).toBe(true)
  })

  it('different focus areas give visibly different programmes', () => {
    const sig = (f: FocusId) => JSON.stringify(week1(withFocus([f]).programme).map((s) => [s.title, s.main.map((m) => m.items.map((i) => i.exerciseId))]))
    const all = (['muscle', 'bone', 'balance', 'back', 'bp', 'glucose', 'joints', 'fitness'] as FocusId[]).map(sig)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('safety layer', () => {
  const profile = (p: Partial<HealthProfile>): HealthProfile => ({ ...emptyProfile(), ...p })

  it('osteoporosis: no forward bending of the spine and no impact, each swap explained', () => {
    const r = withFocus(['bone', 'back'], {}, { profile: profile({ conditions: ['osteoporosis'] }) })
    const ex = exercises(r.programme)
    expect(ex.some((e) => e.contra.includes('spinal-flexion'))).toBe(false)
    expect(ex.some((e) => e.contra.includes('impact'))).toBe(false)
    const subs = r.programme.substitutions
    expect(subs.find((s) => s.from === 'hamstring-stretch-seated')?.ruleId).toBe('osteoFlexion')
    expect(subs.find((s) => s.from === 'stamping')?.reason).toMatch(/brisk-walking/)
  })

  it('osteoporosis swaps curl-ups for another core exercise', () => {
    const r = withFocus(['back'], { level: 'regular', context: 'polar', equipment: ['band', 'chair', 'wall'] }, { context: 'polar', profile: profile({ conditions: ['osteoporosis'] }) })
    expect(items(r.programme).some((i) => i.exerciseId === 'curl-up')).toBe(false)
  })

  it('a fall in the last year keeps balance work supported', () => {
    const r = withFocus(['balance'], { level: 'regular' }, { profile: profile({ conditions: ['falls-history'] }) })
    expect(exercises(r.programme).some((e) => e.contra.includes('unsupported-balance'))).toBe(false)
    expect(r.programme.substitutions.length).toBeGreaterThan(0)
  })

  it('a raised blood-pressure reading removes sustained holds and hard intervals and caps effort', () => {
    const rows = rowsWith({ sys: 150, dia: 95 })
    const normal = withFocus(['back', 'fitness'], { context: 'polar', level: 'some', equipment: ['wall', 'chair', 'band', 'bike'] }, { context: 'polar' })
    expect(items(normal.programme).some((i) => i.exerciseId === 'wall-plank')).toBe(true)
    const r = withFocus(['back', 'fitness'], { context: 'polar', level: 'some', equipment: ['wall', 'chair', 'band', 'bike'] }, { context: 'polar', rows })
    expect(r.safety.plan.items.some((i) => i.id === 'bp-high')).toBe(true)
    expect(items(r.programme).some((i) => i.exerciseId === 'wall-plank')).toBe(false)
    expect(r.programme.substitutions.some((s) => s.from === 'wall-plank')).toBe(true)
    expect(r.safety.effortCap?.max).toBe(6)
    for (const i of items(r.programme)) if (EXERCISE_BY_ID[i.exerciseId].kind !== 'mobility') expect(i.dose.effort[1], i.exerciseId).toBeLessThanOrEqual(6)
  })

  it('a raised reading in space swaps T2 runs and CEVIS intervals for steady work', () => {
    const r = run({ context: 'space', day: 142, training: null, rows: rowsWith({ sys: 150, dia: 95 }, 142), ev: evaluate(rowsWith({ sys: 150, dia: 95 }, 142), { context: 'space', profileId: 'iss', day: 142 }) })
    expect(exercises(r.programme).some((e) => e.contra.includes('vigorous'))).toBe(false)
    expect(r.programme.substitutions.some((s) => s.from === 't2-run' || s.from === 'cevis-intervals')).toBe(true)
  })

  it('movement limitations: seated, no floor, knee', () => {
    const seated = withFocus(['fitness'], { limits: ['seated'] }).programme
    expect(exercises(seated).some((e) => e.contra.includes('standing'))).toBe(false)
    expect(week1(seated).every((s) => s.main.length > 0)).toBe(true)
    const floor = withFocus(['back'], { limits: ['no-floor'] }).programme
    expect(exercises(floor).some((e) => e.contra.includes('floor'))).toBe(false)
    const knee = withFocus(['muscle'], { limits: ['knee'], level: 'regular' }).programme
    expect(exercises(knee).some((e) => e.stress.includes('knee'))).toBe(false)
    expect(knee.substitutions.some((s) => s.from === 'squat')).toBe(true)
  })

  it('a stop puts the session on hold and the summary says so', () => {
    const r = run({ rows: rowsWith({ temp: 38.4 }) })
    expect(r.programme.onHold).toBe(true)
    expect(todaySummary(r)).toMatch(/on hold/i)
  })

  it('a recent serious assessment allows light movement only', () => {
    const latest: SavedAssessment = { id: 1, crewId: 1000, createdAt: '2026-11-14T10:00:00Z', context: 'home', urgency: 'urgent', conditionId: 'fever-infection', conditionName: 'Possible infection', strength: 'moderate', findings: [], note: '' }
    const r = run({ latest })
    expect(r.safety.lightOnly).toBe(true)
    expect(week1(r.programme).every((s) => !s.main.some((m) => m.title.startsWith('Strength')))).toBe(true)
    for (const i of items(r.programme)) if (EXERCISE_BY_ID[i.exerciseId].kind === 'aerobic') expect(i.dose.effort[1]).toBeLessThanOrEqual(4)
  })

  it('missing data is listed as not checked, never as normal', () => {
    const r = run({ profile: null })
    expect(r.safety.notChecked.join(' ')).toMatch(/Blood pressure/)
    expect(r.safety.notChecked.join(' ')).toMatch(/Health profile/)
  })
})

describe('session log and adaptation', () => {
  const log = (date: string, effort: number, pain = false, key = 'k'): SessionLog => ({ id: 1, date, sessionKey: key, minutes: 30, effort, pain, createdAt: `${date}T10:00:00Z` })

  it('classifies effort and pain by fixed rules', () => {
    expect(classify({ effort: 5, pain: true })).toBe('regress')
    expect(classify({ effort: 9, pain: false })).toBe('regress')
    expect(classify({ effort: 7, pain: false })).toBe('hold')
    expect(classify({ effort: 6, pain: false })).toBe('progress')
  })

  it('steps up only after two manageable sessions and never beyond the block plan', () => {
    const one = adaptFromLogs([log('2026-11-16', 5)], { caution: false, cap: 2, contact: 'doctor' })
    expect(one.step).toBe(0)
    const two = adaptFromLogs([log('2026-11-16', 5), log('2026-11-18', 6)], { caution: false, cap: 2, contact: 'doctor' })
    expect(two).toMatchObject({ decision: 'progress', step: 1, suggestedOnly: false })
    const capped = adaptFromLogs([log('2026-11-16', 5), log('2026-11-18', 5), log('2026-11-20', 5), log('2026-11-23', 5), log('2026-11-25', 5), log('2026-11-27', 5)], { caution: false, cap: 2, contact: 'doctor' })
    expect(capped.step).toBe(2)
    expect(plannedStep(1, 1)).toBe(0)
    expect(plannedStep(1, 4)).toBe(2)
  })

  it('with an active caution a step up is only a suggestion', () => {
    const r = adaptFromLogs([log('2026-11-16', 5), log('2026-11-18', 5)], { caution: true, cap: 2, contact: 'doctor' })
    expect(r).toMatchObject({ decision: 'progress', step: 0, suggestedOnly: true })
    expect(r.reason).toMatch(/ask your doctor/)
  })

  it('pain or a very hard session steps down; pain twice asks to see the care contact', () => {
    expect(adaptFromLogs([log('2026-11-16', 9)], { caution: false, cap: 2, contact: 'doctor' })).toMatchObject({ decision: 'regress', step: -1 })
    const r = adaptFromLogs([log('2026-11-16', 5, true), log('2026-11-18', 5, true)], { caution: false, cap: 2, contact: 'doctor' })
    expect(r.step).toBe(-2)
    expect(r.reason).toMatch(/talk to your doctor/)
  })

  it('logged sessions change the next session dose; weeks after it only preview the plan', () => {
    const t = training({ focus: ['muscle'], level: 'starting', startedAt: '2026-11-09' })
    const base = run({ training: t, today: '2026-11-16' }).programme
    const logs = [log('2026-11-09', 5, false, 'b1w1d0'), log('2026-11-11', 5, false, 'b1w1d2')]
    const after = run({ training: t, today: '2026-11-16', logs }).programme
    const reps = (p: Programme) => p.today!.main[0].items[0].dose.reps!
    expect(after.adapt.decision).toBe('progress')
    expect(reps(after)).toBeGreaterThan(reps(base))
    expect(after.adherence).toMatchObject({ done: 0, planned: 3 })
    // Without any log, nothing steps up in later weeks either.
    const w4 = base.weeks[3].sessions[0].main[0].items[0].dose
    expect(w4.reps).toBe(base.weeks[1].sessions[0].main[0].items[0].dose.reps)
  })

  it('adherence counts this week’s logged sessions', () => {
    const t = training({ startedAt: '2026-11-16' })
    const p = run({ training: t, today: '2026-11-18', logs: [log('2026-11-16', 6, false, 'b1w1d0')] }).programme
    expect(p.adherence).toMatchObject({ done: 1, planned: 3 })
  })
})

describe('no data', () => {
  it('a member with no measurements, profile or saved programme still gets a programme', () => {
    const r = run({ training: null, rows: [], ev: null, profile: null })
    expect(r.saved).toBe(false)
    expect(r.training.focus).toEqual(['fitness'])
    expect(r.programme.weeks.every((w) => w.sessions.length > 0)).toBe(true)
    expect(r.programme.today ?? r.programme.next).toBeTruthy()
    expect(todaySummary(r)).toMatch(/minutes/)
  })
  it('space with no readings still suggests muscle and bone, and grows with mission day', () => {
    const early = run({ context: 'space', day: 10, training: null }).suggestions
    const late = run({ context: 'space', day: 142, training: null }).suggestions
    expect(early.slice(0, 2).map((s) => s.id)).toEqual(['muscle', 'bone'])
    expect(late[0].score).toBeGreaterThan(early[0].score)
    expect(late[0].reasons[0]).toMatch(/Day 142/)
  })
})
