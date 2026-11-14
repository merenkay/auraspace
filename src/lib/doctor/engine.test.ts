import { describe, expect, it } from 'vitest'
import { CONDITION_BY_ID, CONDITIONS, SOURCES } from '../../data/conditions'
import { emptyProfile, type HealthProfile } from '../../data/conditions/profile'
import { assess, type Answers, type EngineInput } from './engine'
import { FINDING_BY_ID } from './findings'
import { localise } from './localise'
import { parseFindings } from './parse'
import { carePlan } from './plan'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const profile = (p: Partial<HealthProfile> = {}): HealthProfile => ({ ...emptyProfile(), updatedAt: '2026-11-01T00:00:00Z', ...p })
const run = (answers: Answers, extra: Partial<EngineInput> = {}) => assess({ answers, context: 'home', profile: profile(), now: NOW, ...extra })

describe('knowledge base', () => {
  it('has at least 20 conditions, each with a summary, actions or escalation, and resolvable sources', () => {
    expect(CONDITIONS.length).toBeGreaterThanOrEqual(20)
    for (const c of CONDITIONS) {
      expect(c.ev.summary?.length, c.id).toBeGreaterThan(0)
      expect((c.ev.action?.length ?? 0) + (c.ev.escalate?.length ?? 0), c.id).toBeGreaterThan(0)
      for (const f of c.findings) expect(FINDING_BY_ID[f.id], `${c.id} -> ${f.id}`).toBeTruthy()
      for (const r of c.emergencyIf ?? []) for (const g of r.need ?? []) for (const id of g) expect(FINDING_BY_ID[id], `${c.id} rule -> ${id}`).toBeTruthy()
      for (const kind of ['summary', 'action', 'redflag', 'escalate'] as const) for (const x of c.ev[kind] ?? []) expect(SOURCES[x.s]?.url, `${c.id} ${x.s}`).toMatch(/^https:\/\//)
    }
  })
  it('every medicine carries a verbatim quote and a source', () => {
    for (const c of CONDITIONS) for (const m of c.ev.meds ?? []) {
      expect(m.q.length).toBeGreaterThan(10)
      expect(SOURCES[m.s]).toBeTruthy()
    }
  })
})

describe('free-text understanding', () => {
  it('reads the classic English heart-attack description', () => {
    const { answers } = parseFindings("My chest hurts and my left arm is numb, I'm sweating")
    expect(answers).toMatchObject({ 'chest-pain': 'yes', 'pain-spread': 'yes', sweating: 'yes' })
    expect(answers['one-side-weak']).toBeUndefined()
  })
  it('reads Turkish symptom words', () => {
    const { answers } = parseFindings('Göğüs ağrısı, sol kol uyuşması, nefes darlığı ve terleme var')
    expect(answers).toMatchObject({ 'chest-pain': 'yes', 'pain-spread': 'yes', breathless: 'yes', sweating: 'yes' })
  })
  it('handles negation in both languages', () => {
    // "uyuşuyor" (is numb) must not be read as "üşüyor" (is cold)
    expect(parseFindings('Göğsüm ağrıyor, sol kolum uyuşuyor').answers.chills).toBeUndefined()
    expect(parseFindings('Çok üşüyorum').answers.chills).toBe('yes')
    expect(parseFindings('No fever, but I have a headache').answers).toMatchObject({ fever: 'no', headache: 'yes' })
    expect(parseFindings('Ateşim yok ama başım ağrıyor').answers).toMatchObject({ fever: 'no', headache: 'yes' })
  })
})

describe('heart attack scenario (end to end)', () => {
  const answers = parseFindings('chest pain, my left arm is numb, short of breath and sweating').answers
  const a = run(answers)
  it('is an emergency from a deterministic rule, led by a possible heart attack', () => {
    expect(a.urgency).toBe('emergency')
    expect(a.ruleBased).toBe(true)
    expect(a.candidates[0].condition.id).toBe('heart-attack')
    expect(a.candidates[0].strength).toBe('strong')
    expect(a.next).toBeNull()
    expect(a.suspectedStroke).toBe(false)
  })
  it('tells the person to call for help and offers the sourced aspirin wording', () => {
    const plan = carePlan(CONDITION_BY_ID['heart-attack'], a, 'home', profile(), 0)
    expect(plan.first).toMatch(/Call 112/)
    const aspirin = plan.meds.find((m) => /aspirin/i.test(m.name))!
    expect(aspirin.status).toBe('suggested')
    expect(aspirin.quote).toMatch(/300mg/)
    expect(plan.steps.some((s) => /aspirin/i.test(s.text))).toBe(false) // medicines live in the medicine card only
    expect(plan.sources.some((s) => s.url.includes('nhs.uk'))).toBe(true)
  })
})

describe('stroke (FAST)', () => {
  it('a single FAST sign is an emergency and aspirin is not offered', () => {
    const a = run({ 'face-droop': 'yes' })
    expect(a.urgency).toBe('emergency')
    expect(a.candidates[0].condition.id).toBe('stroke')
    const plan = carePlan(CONDITION_BY_ID.stroke, a, 'home', profile())
    expect(plan.meds).toHaveLength(0)
    expect(plan.donts.some((d) => /aspirin/i.test(d.text))).toBe(true)
  })
  it('suppresses aspirin for chest pain when a stroke is also suspected', () => {
    const a = run({ 'chest-pain': 'yes', sweating: 'yes', speech: 'yes' })
    expect(a.suspectedStroke).toBe(true)
    const plan = carePlan(CONDITION_BY_ID['heart-attack'], a, 'home', profile())
    expect(plan.meds.find((m) => /aspirin/i.test(m.name))!.status).toBe('not-for-you')
  })
})

describe('benign differential', () => {
  it('panic-type symptoms without chest pain are not an emergency', () => {
    const a = run({ palpitations: 'yes', fear: 'yes', trembling: 'yes', tingling: 'yes', 'chest-pain': 'no' }, { profile: profile({ conditions: ['panic-disorder'] }) })
    expect(a.candidates[0].condition.id).toBe('panic-attack')
    expect(a.urgency).not.toBe('emergency')
    expect(a.urgency).not.toBe('urgent')
  })
  it('a known panic disorder never hides a heart-attack pattern', () => {
    const a = run({ fear: 'yes', palpitations: 'yes', 'chest-pain': 'yes', breathless: 'yes' }, { profile: profile({ conditions: ['panic-disorder'] }) })
    expect(a.urgency).toBe('emergency')
  })
})

describe('medicine safety', () => {
  it('an aspirin allergy suppresses aspirin and says why', () => {
    const a = run({ 'chest-pain': 'yes', 'pain-spread': 'yes' })
    const plan = carePlan(CONDITION_BY_ID['heart-attack'], a, 'home', profile({ allergies: ['aspirin'] }))
    const aspirin = plan.meds.find((m) => /aspirin/i.test(m.name))!
    expect(aspirin.status).toBe('not-for-you')
    expect(aspirin.reasons.join(' ')).toMatch(/allergic to aspirin/)
  })
  it('an empty profile is never treated as "no allergies"', () => {
    const a = run({ 'chest-pain': 'yes', 'pain-spread': 'yes' })
    const plan = carePlan(CONDITION_BY_ID['heart-attack'], a, 'home', null)
    expect(plan.meds.find((m) => /aspirin/i.test(m.name))!.status).toBe('check-first')
  })
  it('prescribed-only devices are marked as such', () => {
    const a = run({ 'throat-swelling': 'yes' })
    const plan = carePlan(CONDITION_BY_ID.anaphylaxis, a, 'home', profile())
    expect(plan.meds[0].status).toBe('if-prescribed')
    const own = carePlan(CONDITION_BY_ID.anaphylaxis, a, 'home', profile({ medicines: ['adrenaline-autoinjector'] }))
    expect(own.meds[0].status).toBe('suggested')
  })
})

describe('context differences', () => {
  const answers: Answers = { 'chest-pain': 'yes', 'pain-spread': 'yes', sweating: 'yes' }
  it('space and home give different first actions; space counts the Earth delay', () => {
    const space = assess({ answers, context: 'space', profile: profile(), now: NOW })
    const home = run(answers)
    const sp = carePlan(CONDITION_BY_ID['heart-attack'], space, 'space', profile(), 840)
    const hp = carePlan(CONDITION_BY_ID['heart-attack'], home, 'home', profile(), 0)
    expect(sp.first).toMatch(/crew medical officer/)
    expect(sp.first).toMatch(/28 min/)
    expect(hp.first).toMatch(/112/)
    expect(sp.meds[0].confirmWith).toMatch(/onboard medical kit/)
    expect([...sp.steps, ...sp.donts, ...sp.escalate].some((s) => /\b999\b|A&E|drive/.test(s.text))).toBe(false)
  })
  it('localises emergency numbers', () => {
    expect(localise('Call 999 if lips turn blue.', 'polar')).toBe('Alert the station doctor now if lips turn blue.')
    expect(localise('Do not drive yourself to A&E.', 'space')).toBeNull()
    expect(localise('Call 999 straight away.', 'home')).toMatch(/112/)
  })
  it('space-only conditions are not offered at home', () => {
    const a = run({ nausea: 'yes', 'first-days': 'yes' })
    expect(a.candidates.some((c) => c.condition.id === 'space-motion-sickness')).toBe(false)
    const s = assess({ answers: { nausea: 'yes', 'first-days': 'yes' }, context: 'space', profile: profile(), now: NOW })
    expect(s.candidates[0].condition.id).toBe('space-motion-sickness')
  })
})

describe('readings and missing data', () => {
  it('uses current readings as supporting factors and reports unmeasured ones', () => {
    const a = run({ 'chest-pain': 'yes', 'pain-spread': 'yes' }, { readings: { sys: { value: 150, at: '2026-11-14T08:00:00Z' } } })
    const ha = a.candidates.find((c) => c.condition.id === 'heart-attack')!
    expect(ha.factors.map((f) => f.label)).toContain('Latest blood pressure is high')
    const none = run({ 'chest-pain': 'yes' })
    expect(none.candidates.find((c) => c.condition.id === 'heart-attack')!.unmeasured).toContain('blood pressure')
  })
  it('ignores readings older than a week', () => {
    const a = run({ headache: 'yes' }, { readings: { sys: { value: 190, at: '2026-10-01T08:00:00Z' } } })
    expect(a.urgency).not.toBe('urgent')
  })
  it('very high blood pressure alone is urgent; with chest pain it is an emergency', () => {
    const readings = { sys: { value: 185, at: '2026-11-14T08:00:00Z' }, dia: { value: 110, at: '2026-11-14T08:00:00Z' } }
    expect(run({ headache: 'yes' }, { readings }).urgency).toBe('urgent')
    expect(run({ 'chest-pain': 'yes' }, { readings }).urgency).toBe('emergency')
  })
})

describe('interview', () => {
  it('after chest pain alone, the next question is a safety question about spreading pain', () => {
    const a = run({ 'chest-pain': 'yes' })
    expect(a.urgency).toBe('urgent')
    expect(a.next?.id).toBe('pain-spread')
    expect(a.next?.why).toMatch(/Safety/)
  })
  it('a vague complaint with no good match recommends professional review', () => {
    const a = run({ cough: 'yes' })
    expect(a.noClearMatch).toBe(true)
    expect(a.urgency).toBe('soon')
    expect(a.reasons.join(' ')).toMatch(/professional should review/)
  })
})

describe('thoughts of self-harm', () => {
  it('is an emergency in every context and leads with the crisis plan, never a mood programme', () => {
    for (const context of ['space', 'polar', 'home'] as const) {
      const a = assess({ answers: { 'self-harm': 'yes', 'low-mood': 'yes', 'dark-season': 'yes', fatigue: 'yes' }, context, profile: profile(), now: NOW })
      expect(a.urgency).toBe('emergency')
      expect(a.candidates[0].condition.id).toBe('suicidal-thoughts')
    }
  })

  it('is recognised in plain English and Turkish', () => {
    expect(parseFindings("I don't want to live anymore").answers['self-harm']).toBe('yes')
    expect(parseFindings('I want to die').answers['self-harm']).toBe('yes')
    expect(parseFindings('Yaşamak istemiyorum').answers['self-harm']).toBe('yes')
  })
})
