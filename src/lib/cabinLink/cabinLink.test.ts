import { describe, expect, it } from 'vitest'
import { CABIN_SOURCES, CABIN_BAND, FIRST_STEP, SENSOR_FACTS, SYMPTOM_CHECKLIST, WHY } from '../../data/cabinLink/sources'
import { CABIN_LIMITS } from '../../data/missions'
import { URGENCY_RANK } from '../../data/conditions/types'
import type { SavedAssessment } from '../clinic'
import { assess, type Answers } from '../doctor/engine'
import { FINDING_BY_ID } from '../doctor/findings'
import type { EnvRow } from '../envStation'
import type { User } from '../types'
import { assessWithCabin, cabinFactors, deriveCabinContext, FRESH_MS, gasAlarmRule, LOOKBACK_MS } from './context'
import { overlayAssessments, overlayCrewIds } from './overlay'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()
const row = (minAgo: number, p: Partial<EnvRow> = {}): EnvRow => ({ at: iso(NOW - minAgo * 60_000), t: 22, h: 45, gas: 180, gasMax: 180, base: 180, n: 10, ...p })
/** Rows every minute from `from` to `to` minutes ago. */
const series = (from: number, to: number, p: (m: number) => Partial<EnvRow> = () => ({})) => {
  const out: EnvRow[] = []
  for (let m = from; m >= to; m--) out.push(row(m, p(m)))
  return out
}
const gasAt = (ratio: number) => ({ gas: 180 * ratio, gasMax: 180 * ratio, ratio })

describe('deriveCabinContext', () => {
  it('no rows → quality "none", no factors', () => {
    const c = deriveCabinContext({ rows: [], now: NOW, context: 'home' })
    expect(c.quality).toBe('none')
    expect(c.factors).toEqual([])
    expect(c.latest).toBeNull()
  })
  it('newest row older than the fresh limit → "stale"; factors are not "now"', () => {
    const c = deriveCabinContext({ rows: series(120, 30, () => gasAt(2.5)), now: NOW, context: 'home' })
    expect(c.quality).toBe('stale')
    expect(c.ageMs).toBe(30 * 60_000)
    expect(c.factors.find((f) => f.id === 'gas')?.now).toBe(false)
    expect(FRESH_MS).toBeLessThan(30 * 60_000)
  })
  it('rows older than the look-back window give no factors', () => {
    const c = deriveCabinContext({ rows: series(LOOKBACK_MS / 60_000 + 60, LOOKBACK_MS / 60_000 + 10, () => gasAt(3)), now: NOW, context: 'home' })
    expect(c.quality).toBe('stale')
    expect(c.factors).toEqual([])
  })
  it('normal fresh readings → "fresh" with no factors', () => {
    const c = deriveCabinContext({ rows: series(60, 0), now: NOW, context: 'space' })
    expect(c.quality).toBe('fresh')
    expect(c.factors).toEqual([])
    expect(c.latest?.ratio).toBe(1)
  })
  it('gas: warn vs alarm level, "since" = start of the current elevated run', () => {
    const rows = series(60, 0, (m) => (m <= 20 ? gasAt(m <= 5 ? 2.4 : 1.6) : {}))
    const gas = deriveCabinContext({ rows, now: NOW, context: 'home' }).factors.find((f) => f.id === 'gas')!
    expect(gas.level).toBe('alarm')
    expect(gas.now).toBe(true)
    expect(gas.since).toBe(NOW - 20 * 60_000)
    expect(gas.peak).toBeCloseTo(2.4)
    const warnOnly = deriveCabinContext({ rows: series(30, 0, () => gasAt(1.6)), now: NOW, context: 'home' }).factors[0]
    expect(warnOnly.level).toBe('warn')
  })
  it('gas without a baseline is unknown, never "normal" or "elevated"', () => {
    const c = deriveCabinContext({ rows: series(10, 0, () => ({ gas: 900, gasMax: 900, base: null })), now: NOW, context: 'home' })
    expect(c.factors).toEqual([])
    expect(c.latest?.ratio).toBeNull()
  })
  it('temperature and humidity factors use the NASA habitat bands', () => {
    const hot = deriveCabinContext({ rows: series(10, 0, () => ({ t: CABIN_LIMITS.tempMax + 3, h: CABIN_LIMITS.rhMax + 5 })), now: NOW, context: 'home' })
    expect(hot.factors.map((f) => f.id).sort()).toEqual(['heat', 'humid'])
    const cold = deriveCabinContext({ rows: series(10, 0, () => ({ t: CABIN_LIMITS.tempMin - 4, h: CABIN_LIMITS.rhMin - 5 })), now: NOW, context: 'polar' })
    expect(cold.factors.map((f) => f.id).sort()).toEqual(['cold', 'dry'])
    expect(cold.factors.find((f) => f.id === 'cold')?.peak).toBe(CABIN_LIMITS.tempMin - 4)
  })
  it('a gap longer than 5 minutes breaks the "since" run', () => {
    const rows = [...series(60, 50, () => gasAt(1.8)), ...series(20, 0, () => gasAt(1.8))]
    const gas = deriveCabinContext({ rows, now: NOW, context: 'home' }).factors[0]
    expect(gas.since).toBe(NOW - 20 * 60_000)
  })
  it('applies the server clock skew', () => {
    const c = deriveCabinContext({ rows: [row(0)], now: NOW + 40 * 60_000, context: 'home', skewMs: 40 * 60_000 })
    expect(c.quality).toBe('fresh')
  })
})

const run = (answers: Answers, context: 'home' | 'polar' | 'space', rows: EnvRow[]) => {
  const cabin = deriveCabinContext({ rows, now: NOW, context })
  const input = { answers, context, now: NOW }
  return { base: assess(input), withCabin: assessWithCabin(input, cabin), cabin }
}
const gasAlarmRows = series(30, 0, (m) => (m <= 15 ? gasAt(2.5) : {}))
const gasWarnRows = series(30, 0, (m) => (m <= 15 ? gasAt(1.6) : {}))

describe('assessWithCabin', () => {
  it('without readings it is exactly the plain assessment ("no recent readings" path)', () => {
    const a: Answers = { headache: 'yes', lightheaded: 'yes' }
    const { base, withCabin, cabin } = run(a, 'home', [])
    expect(cabin.quality).toBe('none')
    expect(withCabin).toEqual(base)
  })
  it('raised gas supports carbon-monoxide poisoning (polar/home) as a labelled factor, never as a CO measurement', () => {
    const { base, withCabin } = run({ headache: 'yes', lightheaded: 'yes' }, 'polar', gasWarnRows)
    const co = withCabin.candidates.find((c) => c.condition.id === 'carbon-monoxide')!
    expect(co.factors.some((f) => /gas sensor/i.test(f.label) && /cannot measure CO/.test(f.label))).toBe(true)
    expect(co.score).toBeGreaterThan(base.candidates.find((c) => c.condition.id === 'carbon-monoxide')!.score)
    expect(withCabin.candidates[0].condition.id).toBe('carbon-monoxide')
    // strength is unchanged: environment evidence is never a key factor
    expect(co.strength).toBe(base.candidates.find((c) => c.condition.id === 'carbon-monoxide')!.strength)
  })
  it('heat + humidity supports heat illness at home; cold supports hypothermia', () => {
    const hot = run({ headache: 'yes', lightheaded: 'yes' }, 'home', series(20, 0, () => ({ t: 31, h: 80 })))
    expect(hot.withCabin.candidates.find((c) => c.condition.id === 'heat-illness')?.factors.some((f) => /high humidity/.test(f.label))).toBe(true)
    const cold = run({ chills: 'yes' }, 'home', series(20, 0, () => ({ t: 14 })))
    expect(cold.withCabin.candidates.find((c) => c.condition.id === 'hypothermia')?.factors.some((f) => /below 18/.test(f.label))).toBe(true)
  })
  it('urgency is never lowered, for many symptom combinations, contexts and environments', () => {
    const ids = Object.keys(FINDING_BY_ID)
    const envs = [[], gasWarnRows, gasAlarmRows, series(20, 0, () => ({ t: 32, h: 85 })), series(20, 0, () => ({ t: 12, h: 15 }))]
    let n = 0
    for (const ctx of ['home', 'polar', 'space'] as const)
      for (let i = 0; i < ids.length; i++)
        for (const j of [i + 1, i + 7, i + 13]) {
          const a: Answers = { [ids[i]]: 'yes', [ids[j % ids.length]]: 'yes' }
          for (const rows of envs) {
            const { base, withCabin } = run(a, ctx, rows)
            expect(URGENCY_RANK[withCabin.urgency]).toBeGreaterThanOrEqual(URGENCY_RANK[base.urgency])
            n++
          }
        }
    expect(n).toBeGreaterThan(500)
  })
  it('red-flag rules are unaffected (same emergency reasons with and without the environment)', () => {
    const a: Answers = { 'fuel-appliance': 'yes', headache: 'yes', confusion: 'yes' }
    const { base, withCabin } = run(a, 'home', gasAlarmRows)
    expect(base.urgency).toBe('emergency')
    expect(withCabin.urgency).toBe('emergency')
    expect(withCabin.reasons).toEqual(base.reasons)
    const stroke = run({ 'face-droop': 'yes', speech: 'yes' }, 'space', gasAlarmRows)
    expect(stroke.withCabin.urgency).toBe('emergency')
    expect(stroke.withCabin.suspectedStroke).toBe(true)
  })
  it('AURA rule: symptoms while the gas sensor is at alarm level now → at least urgent; warn level or stale data → no change', () => {
    const a: Answers = { headache: 'yes', lightheaded: 'yes' }
    const alarm = run(a, 'space', gasAlarmRows)
    expect(URGENCY_RANK[alarm.base.urgency]).toBeLessThan(URGENCY_RANK.urgent)
    expect(alarm.withCabin.urgency).toBe('urgent')
    expect(alarm.withCabin.reasons.some((r) => r.startsWith('AURA rule'))).toBe(true)
    expect(run(a, 'space', gasWarnRows).withCabin.urgency).toBe(run(a, 'space', gasWarnRows).base.urgency)
    const stale = deriveCabinContext({ rows: series(90, 40, () => gasAt(3)), now: NOW, context: 'space' })
    expect(gasAlarmRule(stale, a)).toBeNull()
    expect(gasAlarmRule(deriveCabinContext({ rows: gasAlarmRows, now: NOW, context: 'space' }), { 'back-pain': 'yes' })).toBeNull()
  })
  it('in space, raised gas does not boost CO₂ build-up (the MQ-2 cannot see CO₂)', () => {
    const f = cabinFactors(deriveCabinContext({ rows: gasAlarmRows, now: NOW, context: 'space' }))
    expect(f['co2-exposure']).toBeUndefined()
  })
})

describe('cabin-link sources', () => {
  it('every cited statement resolves to an https source and carries a verbatim quote', () => {
    const all = [...Object.values(WHY).flat(), CABIN_BAND, ...Object.values(FIRST_STEP), ...Object.values(SENSOR_FACTS), ...SYMPTOM_CHECKLIST.map((c) => c.cite)]
    for (const c of all) {
      expect(CABIN_SOURCES[c.s]?.url, c.s).toMatch(/^https:\/\//)
      expect(c.q.length, c.t).toBeGreaterThan(5)
    }
  })
  it('every checklist item is a known consultation finding', () => {
    for (const c of SYMPTOM_CHECKLIST) expect(FINDING_BY_ID[c.finding], c.finding).toBeTruthy()
  })
  it('never claims the gas sensor measures CO or CO₂', () => {
    const text = JSON.stringify([SENSOR_FACTS, WHY.gas, SYMPTOM_CHECKLIST]).toLowerCase()
    expect(text).not.toMatch(/(measures|detects) (co|carbon)/)
  })
})

describe('overlay privacy', () => {
  const u = (role: User['role'], crewId: number | null): User => ({ id: 1, username: 'x', role, name: 'X', title: '', crewId, context: 'space' })
  it('own assessments only for self users; surgeon sees the simulated crew only; ground sees none', () => {
    expect(overlayCrewIds(u('astronaut', 2), [1, 2, 3, 4])).toEqual([2])
    expect(overlayCrewIds(u('member', 1004), [1, 2, 1004])).toEqual([1004])
    expect(overlayCrewIds(u('surgeon', null), [1, 2, 3, 4, 1004])).toEqual([1, 2, 3, 4])
    expect(overlayCrewIds(u('ground', null), [1, 2, 3, 4])).toEqual([])
    expect(overlayCrewIds(null, [1])).toEqual([])
  })
  it('marks which factors were elevated when an assessment was saved', () => {
    const items: SavedAssessment[] = [
      { id: 1, crewId: 2, createdAt: iso(NOW - 10 * 60_000), context: 'space', urgency: 'soon', conditionId: null, conditionName: 'No clear match', strength: null, findings: [{ id: 'headache', answer: 'yes' }], note: '' },
      { id: 2, crewId: 2, createdAt: iso(NOW - 25 * 60_000), context: 'space', urgency: 'selfcare', conditionId: null, conditionName: 'No clear match', strength: null, findings: [], note: '' },
      { id: 3, crewId: 2, createdAt: iso(NOW - 48 * 3_600_000), context: 'space', urgency: 'selfcare', conditionId: null, conditionName: 'Old', strength: null, findings: [], note: '' },
    ]
    const out = overlayAssessments(items, gasAlarmRows, NOW - LOOKBACK_MS, NOW, 'space')
    expect(out.map((o) => o.id)).toEqual([2, 1])
    expect(out[1].elevated).toEqual(['gas'])
    expect(out[1].symptoms).toEqual(['Headache'])
    expect(out[0].elevated).toEqual([])
  })
})
