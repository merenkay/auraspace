// The tour script is data, so its promises can be checked without a browser: timing, structure, and that what
// the narration says is what the app's own rules produce from the tour's simulated data.
import { describe, expect, it } from 'vitest'
import { cleanProfile } from '../../data/conditions/profile'
import { ENV_VALUES } from '../../data/kb'
import { MISSIONS } from '../../data/missions'
import { buildCoach } from '../coach'
import { MISSION, generateMeasurements } from '../demoData'
import { assess, carePlan, parseFindings, readingsFromEvaluation } from '../doctor'
import { GAS_ALARM_RATIO, GAS_WARN_RATIO } from '../envStation'
import { evaluate, seriesOf } from '../health'
import { actionFor } from '../triage'
import type { Measurement } from '../types'
import { flatten } from './engine'
import { OPTIONAL_TARGETS, SCRIPT } from './script'
import { PERSONAS } from './seed'
import type { Action, Step } from './types'

const flat = flatten(SCRIPT)
const stepOf = (id: string) => flat.steps.find((s) => s.id === id)!
const all = generateMeasurements().map((m, i) => ({ ...m, id: i + 1 })) as Measurement[]
const rowsOf = (crewId: number) => all.filter((r) => r.crewId === crewId)
const space = { context: 'space' as const, profileId: MISSION.profileId, day: MISSION.day }

describe('tour script: shape', () => {
  it('has eight chapters and runs for about three minutes', () => {
    expect(SCRIPT.chapters).toHaveLength(8)
    expect(flat.totalMs).toBeGreaterThanOrEqual(170_000)
    expect(flat.totalMs).toBeLessThanOrEqual(195_000)
  })

  it('keeps every chapter short (15–30 s; the emergency is the longest)', () => {
    for (const c of flat.chapters) {
      const seconds = (c.endMs - c.startMs) / 1000
      expect(seconds, c.id).toBeGreaterThanOrEqual(15)
      expect(seconds, c.id).toBeLessThanOrEqual(30)
    }
    const longest = [...flat.chapters].sort((a, b) => b.endMs - b.startMs - (a.endMs - a.startMs))[0]
    expect(longest.id).toBe('emergency')
  })

  it('has unique step ids, a caption on every step and readable timing', () => {
    const ids = flat.steps.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of flat.steps) {
      expect(s.caption.length, s.id).toBeGreaterThan(20)
      // about 3.3 words a second is the most a caption may ask of a reader
      const words = s.caption.split(/\s+/).length
      expect(words / (s.duration / 1000), `${s.id}: ${words} words in ${s.duration} ms`).toBeLessThanOrEqual(3.4)
      expect(s.card || s.target, s.id).toBeTruthy()
    }
  })

  it('opens every chapter after the first with a title card, and ends on the closing card', () => {
    SCRIPT.chapters.slice(1).forEach((c, i) => {
      expect(c.steps[0].card).toMatchObject({ kind: 'chapter', number: i + 2, title: c.title })
    })
    const last = flat.steps[flat.steps.length - 1]
    expect(last).toMatchObject({ card: { kind: 'closing' }, manual: true })
  })

  it('marks optional steps with a data-demo target and nothing the rest of the tour depends on', () => {
    const optional = flat.steps.filter((s) => s.optional)
    expect(optional.map((s) => s.id)).toEqual(['problem.mission', 'daily.early', 'emergency.air', 'air.weather'])
    for (const s of optional) {
      expect(s.before ?? [], s.id).toEqual([])
      expect(s.during ?? [], s.id).toEqual([])
      expect(s.rewind, s.id).toBeUndefined()
    }
    const targets = optional.map((s) => s.target)
    for (const t of Object.values(OPTIONAL_TARGETS)) expect(targets).toContain(t)
  })

  it('marks steps that change the page irreversibly, so Back restarts their chapter', () => {
    const irreversible = (a: Action) => a.type === 'type' || (a.type === 'click' && !a.unless)
    for (const s of flat.steps as Step[]) {
      const acts = [...(s.before ?? []), ...(s.during ?? [])]
      if (acts.some(irreversible)) expect(s.rewind, s.id).toBe(false)
    }
  })

  it('only signs in the simulated people of the sandbox', () => {
    for (const s of flat.steps) expect(Object.keys(PERSONAS)).toContain(s.scene.persona)
  })
})

describe('tour script: what the narration claims is what the rules produce', () => {
  it('chapter 1: the delay figures come from the knowledge base', () => {
    const mars = ENV_VALUES.find((e) => e.id === 'comms-delay-earth-mars')!
    expect([mars.value, mars.valueMax, mars.unit]).toEqual([3, 22, 'min'])
    expect(stepOf('problem.delay').caption).toContain('between 3 and 22 minutes')
    expect(MISSIONS.find((m) => m.id === MISSION.profileId)!.delaySec).toBe(14 * 60)
    expect(stepOf('problem.mission').caption).toContain(`day ${MISSION.day}`)
    expect(stepOf('problem.mission').caption).toContain('14 minutes')
  })

  it('chapter 2: Okafor has two attention alerts (blood pressure, sleep) and delay-aware advice', () => {
    const ev = evaluate(rowsOf(1), space)
    expect(ev.alerts.map((a) => [a.key, a.level])).toEqual([
      ['bp', 'warn'],
      ['sleep', 'warn'],
    ])
    expect(actionFor(ev.systemStatus.heart, 840, 'space')).toContain('a reply from Earth takes at least 28 min')
  })

  it('chapter 3: her upper blood-pressure value has climbed for three weeks; the scripted reading is still "attention"', () => {
    const sys = seriesOf(rowsOf(1), 'sys', 30, MISSION.day)
    const early = sys.filter((p) => p.day <= MISSION.day - 24).map((p) => p.value)
    const late = sys.filter((p) => p.day > MISSION.day - 5).map((p) => p.value)
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length
    expect(mean(late) - mean(early)).toBeGreaterThan(10)
    const reading = stepOf('trend.reading').during!.find((a) => a.type === 'reading')
    if (reading?.type !== 'reading') throw new Error('no scripted reading')
    expect(reading.values).toEqual({ sys: 139, dia: 88 })
    const ev = evaluate([...rowsOf(1), ...Object.entries(reading.values).map(([metric, value], i) => ({ id: 9e6 + i, crewId: 1, metric, value, day: MISSION.day, at: new Date().toISOString(), source: 'device', device: reading.device }) as Measurement)], space)
    expect(ev.vitalStatus.bp).toBe('warn')
    expect(ev.defByKey.bp!.display(ev.values)).toBe('139/88')
  })

  it('chapter 4: the typed sentence and one "yes" lead the real engine to the rule-based emergency, the delay-aware first step and the aspirin check', () => {
    const typed = stepOf('emergency.describe').during!.find((a) => a.type === 'type')
    if (typed?.type !== 'type') throw new Error('no typed text')
    const ev = evaluate(rowsOf(2), space)
    const readings = readingsFromEvaluation(ev)
    // Reyes's simulated starter profile (src/lib/clinic.ts DEMO_PROFILES): allergic to aspirin
    const profile = cleanProfile({ ageBand: '40-64', allergies: ['aspirin'], simulated: true, updatedAt: '2026-11-01T00:00:00.000Z' })

    const first = assess({ answers: parseFindings(typed.text).answers, context: 'space', readings, profile })
    expect(first.urgency).not.toBe('emergency')
    expect(first.next).toMatchObject({ id: 'pain-spread' })
    expect(first.next!.question).toMatch(/spread to your arm, jaw/)
    expect(first.next!.why).toMatch(/^Safety check/)

    const a = assess({ answers: { ...parseFindings(typed.text).answers, [first.next!.id]: 'yes' }, context: 'space', readings, profile })
    expect(a).toMatchObject({ urgency: 'emergency', ruleBased: true })
    expect(a.candidates[0].condition.id).toBe('heart-attack')

    const plan = carePlan(a.candidates[0].condition, a, 'space', profile, 840)
    expect(plan.first).toContain('A reply from Earth takes at least 28 min')
    expect(plan.first).toContain('without waiting')
    const aspirin = plan.meds.find((m) => /aspirin/i.test(m.name))!
    expect(aspirin.status).toBe('not-for-you')
    expect(aspirin.reasons).toContain('Not suggested because you are allergic to aspirin.')
    expect(plan.sources.length).toBeGreaterThan(0)
    expect(plan.sources.every((s) => s.quotes.length > 0 && /^https:\/\//.test(s.url))).toBe(true)
  })

  it('chapter 5: the callout states the station’s real thresholds', () => {
    expect([GAS_WARN_RATIO, GAS_ALARM_RATIO]).toEqual([1.5, 2])
    expect(stepOf('air.leak').callout!.text).toContain('1.5 times')
    expect(stepOf('air.leak').callout!.text).toContain('2 times')
  })

  it('chapter 6: the coach suggests muscle and bone loss plus blood pressure, and caps effort at 6 of 10', () => {
    const rows = rowsOf(1)
    const ev = evaluate(rows, space)
    const sleep = seriesOf(rows, 'sleep', 7, MISSION.day)
    const profile = cleanProfile({ ageBand: '40-64', simulated: true, updatedAt: '2026-11-01T00:00:00.000Z' })
    const c = buildCoach({ context: 'space', ev, rows, profile, latest: null, sleepAvg: sleep.reduce((s, p) => s + p.value, 0) / sleep.length, day: MISSION.day, today: '2026-11-14', training: null, logs: [] })
    expect(c.training.focus).toEqual(['muscle', 'bone', 'bp'])
    expect(c.training.confirmed).toBe(false) // so the page shows "Suggested focus"
    expect(c.safety.effortCap).toMatchObject({ max: 6 })
    expect(c.programme.rules.length).toBeGreaterThan(3) // "How this plan was built" has sourced rules to show
  })
})
