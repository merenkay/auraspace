import { describe, expect, it } from 'vitest'
import { deriveCabinContext } from '../cabinLink/context'
import { environmentBrief } from '../cabinLink/envDx'
import type { EnvRow } from '../envStation'
import { consultStep, newConsult, type ConsultCtx } from '../voice/consult'
import { newMemory } from './memory'
import { chatReply, type ChatCtx } from './reply'
import { route } from './route'

const NOW = Date.now()
const rows = (t: number, h: number): EnvRow[] =>
  Array.from({ length: 10 }, (_, i) => ({ at: new Date(NOW - (9 - i) * 60_000).toISOString(), t, h, gas: 180, gasMax: 180, base: 180, ratio: 1, n: 10 }))
const HOT = deriveCabinContext({ rows: rows(32, 80), now: NOW, context: 'space' })
const NORMAL = deriveCabinContext({ rows: rows(21, 45), now: NOW, context: 'space' })
const c = (cabin: ConsultCtx['cabin']): ConsultCtx => ({ context: 'space', readings: {}, profile: null, delaySec: 0, cabin })
const chat = (o: Partial<ChatCtx> = {}): ChatCtx => ({ now: new Date(), address: null, role: 'astronaut', context: 'space', mission: null, ...o })

describe('voice: environment-aware consultation', () => {
  it('a heart-attack pattern at 32 °C is the same emergency text as without the environment', () => {
    const text = 'chest pain, I am sweating and short of breath'
    const hot = consultStep(newConsult(), c(HOT), { text })
    const none = consultStep(newConsult(), c(null), { text })
    expect(hot.emergency).toBe(true)
    expect(hot.say).toBe(none.say)
    expect(hot.say).not.toMatch(/expected/)
  })
  it('the summary says the environment note briefly', () => {
    let s = consultStep(newConsult(), c(HOT), { text: 'I am sweating and very thirsty' })
    for (let i = 0; i < 8 && !s.state.done; i++) s = consultStep(s.state, c(HOT), { answer: 'no' })
    expect(s.state.done).toBe(true)
    expect(s.say).toMatch(/cabin is 32 °C and 80 % humidity, so sweating and thirst are expected/)
    let n = consultStep(newConsult(), c(NORMAL), { text: 'I am sweating' })
    for (let i = 0; i < 8 && !n.state.done; i++) n = consultStep(n.state, c(NORMAL), { answer: 'no' })
    expect(n.say).toMatch(/Sweating is not explained by the cabin/)
  })
  it('asks the discriminating follow-up and escalates when it does not fit the heat', () => {
    let s = consultStep(newConsult(), c(HOT), { text: 'I am sweating' })
    let guard = 0
    while (s.state.pending && s.state.pending !== 'heat-not-eased' && guard++ < 8) s = consultStep(s.state, c(HOT), { answer: 'no' })
    expect(s.state.pending).toBe('heat-not-eased')
    const e = consultStep(s.state, c(HOT), { answer: 'yes' })
    expect(e.emergency).toBe(true)
  })
  it('severity words in the spoken text cancel the explanation', () => {
    const s = consultStep(newConsult(), c(HOT), { text: 'sudden severe headache' })
    expect(s.assessment && 'environment' in s.assessment ? (s.assessment as { environment: { discounted: string[] } }).environment.discounted : null).toEqual([])
  })
})

describe('assistant: "is it the air?"', () => {
  it('routes air questions to the cabin brief', () => {
    for (const q of ['is it the heat?', 'could it be the air', 'how is the cabin', 'sıcaktan mı']) {
      const r = route(q, { lang: q.includes('ı') ? 'tr-TR' : 'en-US' })
      expect(r, q).toMatchObject({ kind: 'chat', chat: { type: 'cabin', air: true } })
    }
  })
  it('answers with what the readings make expected; gas alarm first; no data is never "normal"', () => {
    const env = { label: 'Mission cabin station', t: 32, h: 80, gas: 'ok' as const, ageMin: 1, simulated: false, brief: environmentBrief(HOT, 'space') }
    const r = chatReply({ type: 'cabin', air: true }, chat({ env }), newMemory())
    expect(r.say).toMatch(/sweating and thirst are expected/)
    expect(r.say).toMatch(/heat index/)
    const alarm = chatReply({ type: 'cabin', air: true }, chat({ env: { ...env, gas: 'crit' } }), newMemory())
    expect(alarm.say).toMatch(/^The gas sensor is in alarm/)
    expect(environmentBrief(null, 'space')).toMatch(/no recent cabin readings/)
    const old = chatReply({ type: 'cabin' }, chat({ env: { ...env, ageMin: 120, t: 22, h: 45 } }), newMemory())
    expect(old.say).not.toMatch(/within the comfort range/)
  })
})
