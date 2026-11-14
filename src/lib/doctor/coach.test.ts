import { describe, expect, it } from 'vitest'
import { emptyProfile } from '../../data/conditions/profile'
import type { SavedAssessment } from '../clinic'
import { buildCoachPlan } from '../coachPlan'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const saved = (p: Partial<SavedAssessment>): SavedAssessment => ({
  id: 1, crewId: 1, createdAt: '2026-11-13T12:00:00Z', context: 'home', urgency: 'emergency', conditionId: 'heart-attack',
  conditionName: 'Possible heart attack', strength: 'strong', findings: [], note: '', ...p,
})

describe('coach programme', () => {
  it('a recent cardiac emergency puts exercise on hold first', () => {
    const plan = buildCoachPlan({ context: 'home', ev: null, profile: emptyProfile(), latest: saved({}), sleepAvg: 7, now: NOW })
    expect(plan.items[0].level).toBe('stop')
    expect(plan.items[0].text).toMatch(/cleared/)
    expect(plan.focus?.items.length).toBeGreaterThan(0)
  })
  it('profile drives sourced adaptations (diabetes, asthma, falls at home, kidney stones)', () => {
    const profile = { ...emptyProfile(), ageBand: '80+' as const, conditions: ['diabetes', 'asthma', 'kidney-stones'] }
    const plan = buildCoachPlan({ context: 'home', ev: null, profile, latest: null, sleepAvg: 5.2, now: NOW })
    const ids = plan.items.map((i) => i.id)
    expect(ids).toEqual(expect.arrayContaining(['glucose', 'asthma', 'balance', 'sleep', 'stones']))
    for (const i of plan.items.filter((x) => !x.rule)) expect(i.source?.url, i.id).toMatch(/^https:/)
  })
  it('heart conditions ask for clearance before strength work, with a source; pregnancy is a labelled AURA rule', () => {
    const profile = { ...emptyProfile(), conditions: ['angina', 'pregnancy'] }
    const plan = buildCoachPlan({ context: 'home', ev: null, profile, latest: null, sleepAvg: null, now: NOW })
    const cardiac = plan.items.find((i) => i.id === 'cardiac-clearance')!
    expect(cardiac.level).toBe('caution')
    expect(cardiac.source?.url).toMatch(/^https:/)
    expect(plan.items.find((i) => i.id === 'pregnancy')?.rule).toBe(true)
  })
  it('does nothing without data, and never mentions raising loads', () => {
    const plan = buildCoachPlan({ context: 'space', ev: null, profile: null, latest: null, sleepAvg: null, now: NOW })
    expect(plan.items).toHaveLength(0)
  })
})
