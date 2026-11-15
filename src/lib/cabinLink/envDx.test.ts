import { describe, expect, it } from 'vitest'
import { CABIN_SOURCES } from '../../data/cabinLink/sources'
import { ENV_CONDITIONS, EXPECTATIONS, FOLLOW_UP } from '../../data/cabinLink/envDx'
import { URGENCY_RANK } from '../../data/conditions/types'
import type { Context } from '../../data/contexts'
import { assess, type Answers, type EngineInput } from '../doctor/engine'
import { FINDING_BY_ID } from '../doctor/findings'
import { carePlan } from '../doctor/plan'
import type { EnvRow } from '../envStation'
import { deriveCabinContext, type CabinContext } from './context'
import { assessWithEnvironment, environmentBrief, environmentLine, environmentNotes, EXPECTED_DISCOUNT } from './envDx'
import { heatCategory, heatIndexC, heatIndexF } from './heatIndex'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const rows = (t: number | null, h: number | null, minAgoFrom = 20, minAgoTo = 0, gas = 1): EnvRow[] => {
  const out: EnvRow[] = []
  for (let m = minAgoFrom; m >= minAgoTo; m--) out.push({ at: iso(NOW - m * 60_000), t, h, gas: 180 * gas, gasMax: 180 * gas, base: 180, ratio: gas, n: 10 })
  return out
}
const cabinOf = (r: EnvRow[], context: Context = 'space'): CabinContext => deriveCabinContext({ rows: r, now: NOW, context })
const HOT = () => cabinOf(rows(32, 80))
const NORMAL = () => cabinOf(rows(21, 45))
const COLD = (ctx: Context = 'space') => cabinOf(rows(15, 45), ctx)
const DRY = () => cabinOf(rows(22, 18))
const STALE_HOT = () => cabinOf(rows(32, 80, 120, 30))
const input = (answers: Answers, context: Context = 'space', extra: Partial<EngineInput> = {}): EngineInput => ({ answers, context, now: NOW, ...extra })
const ids = (a: { candidates: { condition: { id: string } }[] }) => a.candidates.map((c) => c.condition.id)
const rank = (u: keyof typeof URGENCY_RANK) => URGENCY_RANK[u]

describe('NOAA heat index', () => {
  it('matches values published by the National Weather Service', () => {
    expect(heatIndexF(96, 65)).toBeGreaterThan(120) // weather.gov/safety/heat-index: 96 °F, 65 % → 121 °F
    expect(Math.round(heatIndexF(96, 65))).toBe(121)
    expect(Math.round(heatIndexF(100, 55))).toBe(124) // weather.gov/ama/heatindex
    expect(Math.round(heatIndexF(100, 15))).toBe(96) // weather.gov/ama/heatindex (low-humidity adjustment applies)
  })
  it('uses the simple formula below about 80 °F and both published adjustments', () => {
    const simple = 0.5 * (70 + 61 + (70 - 68) * 1.2 + 50 * 0.094)
    expect(heatIndexF(70, 50)).toBeCloseTo(simple, 6)
    const T = 84
    const RH = 95
    const base = -42.379 + 2.04901523 * T + 10.14333127 * RH - 0.22475541 * T * RH - 0.00683783 * T * T - 0.05481717 * RH * RH + 0.00122874 * T * T * RH + 0.00085282 * T * RH * RH - 0.00000199 * T * T * RH * RH
    expect(heatIndexF(T, RH)).toBeCloseTo(base + ((RH - 85) / 10) * ((87 - T) / 5), 6)
  })
  it('classifies with the NWS bands and converts to °C', () => {
    expect(heatCategory(85).id).toBe('caution')
    expect(heatCategory(95).id).toBe('extreme-caution')
    expect(heatCategory(110).id).toBe('danger')
    expect(heatCategory(130).id).toBe('extreme-danger')
    expect(heatIndexC(32, 80)).toBeGreaterThan(40)
  })
})

describe('expected in this environment', () => {
  it('sweating at 32 °C / 80 % is expected: note, half weight, heat-strain candidate, discriminating follow-up', () => {
    const a = assessWithEnvironment(input({ sweating: 'yes' }), HOT())
    const note = a.environment.notes.find((n) => n.finding === 'sweating')!
    expect(note.kind).toBe('expected')
    expect(note.text).toMatch(/Cabin is 32 °C and 80 % humidity — sweating is an expected response/)
    expect(note.text).toMatch(/humid air/)
    expect(note.cite?.s).toBe('nhs-sweating')
    expect(a.environment.discounted).toEqual(['sweating'])
    expect(a.environment.offered).toEqual(['env-heat-strain'])
    expect(a.candidates[0].condition.id).toBe('env-heat-strain')
    // red-flag safety questions still come first (sweating could complete the heart-attack rule) …
    expect(a.next?.why).toMatch(/^Safety check/)
    expect(a.urgency).toBe('selfcare')
    // … then the environment's discriminating question
    const b = assessWithEnvironment(input({ sweating: 'yes', 'chest-pain': 'no', breathless: 'no', lightheaded: 'no', nausea: 'no', 'pale-blue-skin': 'no', collapse: 'no', 'pain-spread': 'no', vomiting: 'no' }), HOT())
    expect(b.next?.id).toBe('heat-not-eased')
    expect(b.environment.followUp).toBe('heat-not-eased')
    const hm = a.candidates.find((c) => c.condition.id === 'heart-attack')
    if (hm) expect(hm.matched.find((m) => m.id === 'sweating')?.w).toBe(2 * EXPECTED_DISCOUNT)
  })
  it('each heat association is explained only by fresh heat', () => {
    for (const e of EXPECTATIONS.filter((x) => x.factor === 'heat')) {
      const hot = environmentNotes({ [e.finding]: 'yes' }, HOT(), 'space')
      expect(hot.explained.get('heat'), e.finding).toEqual([e.finding])
      const normal = environmentNotes({ [e.finding]: 'yes' }, NORMAL(), 'space')
      expect(normal.explained.size, e.finding).toBe(0)
      const stale = environmentNotes({ [e.finding]: 'yes' }, STALE_HOT(), 'space')
      expect(stale.explained.size, e.finding).toBe(0)
      expect(stale.notes[0].kind).toBe('no-data')
    }
  })
  it('chills in a cold room are expected; a fever cancels it (infection)', () => {
    const a = assessWithEnvironment(input({ chills: 'yes' }, 'polar'), COLD('polar'))
    expect(a.environment.notes[0].kind).toBe('expected')
    expect(a.environment.offered).toContain('env-cold-stress')
    expect(a.next?.id === 'fever' || /^Safety check/.test(a.next?.why ?? '')).toBe(true)
    const safe = assessWithEnvironment(input({ chills: 'yes', confusion: 'no', drowsy: 'no', speech: 'no', collapse: 'no' }, 'polar'), COLD('polar'))
    expect(safe.next?.id).toBe('fever')
    const b = assessWithEnvironment(input({ chills: 'yes', fever: 'yes' }, 'polar'), COLD('polar'))
    expect(b.environment.notes.find((n) => n.finding === 'chills')?.kind).toBe('cancelled')
    expect(b.environment.offered).toEqual([])
  })
  it('stinging eyes in very dry air are expected; a painful red eye escalates to urgent', () => {
    const a = assessWithEnvironment(input({ 'eye-throat-irritation': 'yes' }), DRY())
    expect(a.environment.notes[0].kind).toBe('expected')
    expect(a.environment.offered).toEqual(['env-dry-air'])
    expect(a.next?.id).toBe('eye-red-painful')
    const b = assessWithEnvironment(input({ 'eye-throat-irritation': 'yes', 'eye-red-painful': 'yes' }), DRY())
    expect(b.urgency).toBe('urgent')
    expect(b.environment.offered).toEqual([])
  })
  it('a racing heartbeat or breathlessness in heat is never explained away (NHS heatstroke signs)', () => {
    for (const f of ['palpitations', 'breathless']) {
      const a = assessWithEnvironment(input({ [f]: 'yes' }), HOT())
      expect(a.environment.notes[0].kind).toBe('watch')
      expect(a.environment.discounted).toEqual([])
      expect(rank(a.urgency)).toBeGreaterThanOrEqual(rank(assess(input({ [f]: 'yes' })).urgency))
      expect(a.next?.id === 'heat-not-eased' || /^Safety check/.test(a.next?.why ?? '')).toBe(true)
    }
  })
})

describe('not expected in this environment', () => {
  it('sweating at 21 °C is noted as not explained and adds a small weight', () => {
    const base = assess(input({ sweating: 'yes' }))
    const a = assessWithEnvironment(input({ sweating: 'yes' }), NORMAL())
    const note = a.environment.notes[0]
    expect(note.kind).toBe('not-expected')
    expect(note.text).toBe('Cabin is 21 °C and 45 % humidity — sweating is not explained by the environment.')
    expect(a.environment.discounted).toEqual([])
    expect(a.environment.offered).toEqual([])
    expect(rank(a.urgency)).toBeGreaterThanOrEqual(rank(base.urgency))
    expect(a.candidates.some((c) => c.factors.some((f) => /not explained by heat/.test(f.label)))).toBe(true)
  })
  it('shivering in a warm room and stinging eyes in normal humidity are noted', () => {
    expect(environmentNotes({ chills: 'yes' }, NORMAL(), 'home').notes[0].kind).toBe('not-expected')
    expect(environmentNotes({ 'eye-throat-irritation': 'yes' }, NORMAL(), 'home').notes[0].kind).toBe('not-expected')
  })
  it('stale or missing readings say "no recent readings", never "normal"', () => {
    for (const c of [STALE_HOT(), cabinOf([]), null]) {
      const a = assessWithEnvironment(input({ sweating: 'yes', headache: 'yes' }), c)
      expect(a.environment.discounted).toEqual([])
      expect(a.environment.offered).toEqual([])
      for (const n of a.environment.notes) {
        expect(n.kind).toBe('no-data')
        expect(n.text).toMatch(/No recent cabin readings/)
        expect(n.text).not.toMatch(/normal/i)
      }
    }
    expect(environmentBrief(null, 'space')).toMatch(/no recent cabin readings/)
  })
})

describe('hard safety rules', () => {
  it('chest pain + sweating + breathlessness at 32 °C is the unchanged emergency (same reasons, candidates, plan and first step)', () => {
    const answers: Answers = { 'chest-pain': 'yes', sweating: 'yes', breathless: 'yes' }
    const raw = assess(input(answers))
    const a = assessWithEnvironment(input(answers), HOT(), { text: 'chest pain, sweating and short of breath' })
    expect(raw.urgency).toBe('emergency')
    expect(a.urgency).toBe('emergency')
    expect(a.reasons).toEqual(raw.reasons)
    expect(ids(a)).toEqual(ids(raw))
    expect(a.next).toBeNull()
    const p1 = carePlan(raw.candidates[0].condition, raw, 'space', null, 600)
    const p2 = carePlan(a.candidates[0].condition, a, 'space', null, 600)
    expect(p2.first).toBe(p1.first)
    expect(p2.steps).toEqual(p1.steps)
    expect(environmentLine(a)).toBeNull() // emergencies: instructions only
  })
  it('severity words and findings cancel the discount', () => {
    const t = assessWithEnvironment(input({ headache: 'yes' }), HOT(), { text: 'a sudden severe headache' })
    expect(t.environment.discounted).toEqual([])
    expect(t.environment.notes[0].kind).toBe('cancelled')
    const f = assessWithEnvironment(input({ sweating: 'yes', 'pale-blue-skin': 'yes' }), HOT())
    expect(f.environment.discounted).toEqual([])
    expect(f.environment.offered).toEqual([])
    for (const w of ['severe', 'at rest', 'fainted', 'blue lips', 'şiddetli']) expect(assessWithEnvironment(input({ sweating: 'yes' }), HOT(), { text: `sweating, ${w}` }).environment.discounted, w).toEqual([])
  })
  it('heat illness is still caught: heatstroke signs in a hot room and "still unwell after cooling" are emergencies', () => {
    expect(assessWithEnvironment(input({ sweating: 'yes', 'heat-not-eased': 'yes' }), HOT()).urgency).toBe('emergency')
    const skin = assessWithEnvironment(input({ 'hot-skin-no-sweat': 'yes' }), HOT())
    expect(skin.urgency).toBe('emergency')
    // the home knowledge base's own heatstroke rule is untouched
    const home = { 'heat-exposure': 'yes', 'hot-skin-no-sweat': 'yes' } as Answers
    expect(assess(input(home, 'home')).urgency).toBe('emergency')
    expect(assessWithEnvironment(input(home, 'home'), HOT()).reasons).toEqual(assess(input(home, 'home')).reasons)
  })
  it('vital readings in a hot cabin get a note, never a status or urgency change', () => {
    const readings = { hr: { value: 112, at: iso(NOW - 600_000) }, temp: { value: 37.8, at: iso(NOW - 600_000) } }
    const a = assessWithEnvironment(input({ sweating: 'yes' }, 'space', { readings }), HOT())
    expect(a.environment.vitalNotes.map((v) => v.finding)).toEqual(['hr', 'temp'])
    expect(a.environment.vitalNotes[0].text).toMatch(/status is unchanged/)
    const n = assessWithEnvironment(input({ sweating: 'yes' }, 'space', { readings }), NORMAL())
    expect(n.environment.vitalNotes).toEqual([])
  })
  it('brute force: urgency never drops from urgent/emergency, emergency results are identical, nothing is explained without fresh data or with severity', () => {
    const all = Object.keys(FINDING_BY_ID)
    const focus = ['sweating', 'thirst', 'fatigue', 'headache', 'lightheaded', 'cramps', 'nausea', 'chills', 'eye-throat-irritation', 'palpitations', 'breathless']
    const envs: [string, () => CabinContext | null][] = [
      ['hot', HOT], ['hot-dry', () => cabinOf(rows(33, 20))], ['cold', () => COLD('space')], ['dry', DRY], ['normal', NORMAL], ['stale', STALE_HOT], ['none', () => null],
      ['gas', () => cabinOf(rows(32, 80, 20, 0, 2.5))],
    ]
    const readingsSet = [undefined, { hr: { value: 125, at: iso(NOW) }, temp: { value: 38.6, at: iso(NOW) } }]
    let n = 0
    for (const ctx of ['space', 'polar', 'home'] as const)
      for (let i = 0; i < all.length; i++)
        for (const extra of [focus[i % focus.length], all[(i * 7 + 3) % all.length], null]) {
          const answers: Answers = { [all[i]]: 'yes', ...(extra ? { [extra]: 'yes' } : {}), ...(i % 5 === 0 ? { [focus[(i + 2) % focus.length]]: 'yes' } : {}) }
          for (const readings of readingsSet)
            for (const [name, env] of envs) {
              const inp = input(answers, ctx, { readings })
              const raw = assess(inp)
              const a = assessWithEnvironment(inp, env(), { text: i % 9 === 0 ? 'it came on suddenly' : undefined })
              if (rank(raw.urgency) >= rank('urgent')) expect(rank(a.urgency), `${ctx} ${name} ${JSON.stringify(answers)}`).toBeGreaterThanOrEqual(rank(raw.urgency))
              if (raw.urgency === 'emergency') {
                expect(a.urgency).toBe('emergency')
                expect(a.reasons).toEqual(raw.reasons)
                expect(ids(a)).toEqual(ids(raw))
              }
              if (name === 'stale' || name === 'none' || i % 9 === 0) expect(a.environment.discounted).toEqual([])
              if (a.environment.discounted.length) {
                expect(rank(raw.urgency)).toBeLessThan(rank('urgent'))
                expect(a.environment.cancelledBy).toEqual([])
              }
              n++
            }
        }
    expect(n).toBeGreaterThan(5000)
  }, 120_000) // thousands of combinations over the whole catalogue: needs more than the default 5 s
})

describe('data integrity', () => {
  it('every environment statement cites a fetched https source with a quote', () => {
    const cites = [...EXPECTATIONS.map((e) => e.cite), ...Object.values(FOLLOW_UP).map((f) => f.cite)]
    for (const c of Object.values(ENV_CONDITIONS)) for (const list of Object.values(c.ev)) for (const x of list as { s: string; q: string }[]) cites.push(x as never)
    for (const c of cites) {
      expect(CABIN_SOURCES[c.s]?.url, c.s).toMatch(/^https:\/\//)
      expect(c.q.length).toBeGreaterThan(5)
    }
    for (const f of Object.values(FOLLOW_UP)) expect(FINDING_BY_ID[f.id]).toBeTruthy()
  })
  it('the environment care plan lists real sources', () => {
    const a = assessWithEnvironment(input({ sweating: 'yes', thirst: 'yes' }), HOT())
    const plan = carePlan(a.candidates[0].condition, a, 'space', null, 0)
    expect(plan.steps[0].text).toMatch(/cool place/)
    expect(plan.sources.every((s) => /^https:\/\//.test(s.url))).toBe(true)
  })
  it('spoken line and brief', () => {
    const a = assessWithEnvironment(input({ sweating: 'yes', thirst: 'yes' }), HOT())
    expect(environmentLine(a)).toMatch(/cabin is 32 °C and 80 % humidity, so sweating and thirst are expected/)
    expect(environmentBrief(HOT(), 'space')).toMatch(/heat index/)
    expect(environmentBrief(NORMAL(), 'space')).toMatch(/would not explain/)
  })
})
