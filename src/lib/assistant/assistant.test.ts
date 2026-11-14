import { describe, expect, it } from 'vitest'
import { consultStep, crisisText, newConsult } from '../voice/consult'
import { calculate, convert, feelingOf, isCrisis, parseChat } from './chat'
import { yesterdayText } from './data'
import { newMemory, vary } from './memory'
import { chatReply, fallbackReply, type ChatCtx } from './reply'
import { resolveClarify, route, understand, type Route } from './route'
import type { Measurement } from '../types'

const R = (t: string) => route(t, { lang: 'en-US' })
const RT = (t: string) => route(t, { lang: 'tr-TR' })
const chatType = (r: Route) => (r.kind === 'chat' ? r.chat.type : null)
const ctx = (o: Partial<ChatCtx> = {}): ChatCtx => ({
  now: new Date(2026, 10, 14, 9, 30),
  address: 'Commander',
  role: 'astronaut',
  context: 'space',
  mission: { day: 142, totalDays: 180, profileId: 'mars-transit', name: 'Mars Transit' },
  ...o,
})

describe('small talk', () => {
  it('recognises everyday conversation in English and Turkish', () => {
    expect(chatType(R('hello'))).toBe('hello')
    expect(chatType(R('good morning'))).toBe('hello')
    expect(chatType(R('how are you'))).toBe('howAreYou')
    expect(chatType(RT('nasılsın'))).toBe('howAreYou')
    expect(chatType(R('thanks'))).toBe('thanks')
    expect(chatType(RT('teşekkürler'))).toBe('thanks')
    expect(chatType(R('who are you'))).toBe('whoAreYou')
    expect(chatType(R('are you a robot'))).toBe('areYouHuman')
    expect(chatType(R('what can you do'))).toBe('capabilities')
    expect(chatType(R('help'))).toBe('capabilities')
    expect(chatType(R("what's your name"))).toBe('yourName')
    expect(R('call me Mira')).toEqual({ kind: 'chat', chat: { type: 'setName', name: 'Mira' } })
    expect(chatType(R('tell me a joke'))).toBe('joke')
    expect(chatType(RT('bir fıkra anlat'))).toBe('joke')
    expect(chatType(R('what time is it'))).toBe('time')
    expect(chatType(RT('saat kaç'))).toBe('time')
    expect(chatType(R("what's the date"))).toBe('date')
    expect(chatType(R('which day of the mission is it'))).toBe('missionDay')
    expect(chatType(R("what's the weather like"))).toBe('weather')
    expect(chatType(RT('hava nasıl'))).toBe('weather')
    expect(chatType(R('how long is the delay to Earth'))).toBe('delay')
    expect(chatType(R('how much radiation have I had'))).toBe('radiation')
    expect(chatType(R("what's on my schedule today"))).toBe('today')
    expect(chatType(R('good night'))).toBe('goodbye')
  })
  it('replies warmly, concisely and honestly', () => {
    const m = newMemory()
    expect(chatReply({ type: 'hello', wake: false }, ctx(), m).say).toMatch(/Commander/)
    expect(chatReply({ type: 'whoAreYou' }, ctx(), m).say).toMatch(/rule-based.*not a person/)
    expect(chatReply({ type: 'areYouHuman' }, ctx(), m).say).toMatch(/^No\. I’m a rule-based assistant/)
    expect(chatReply({ type: 'time' }, ctx(), m).say).toMatch(/09:30|9:30/)
    expect(chatReply({ type: 'date' }, ctx(), m).say).toMatch(/Saturday,? 14 November 2026, mission day 142/)
    expect(chatReply({ type: 'missionDay' }, ctx(), m).say).toMatch(/mission day 142 of 180, so 38 to go/)
    expect(chatReply({ type: 'delay' }, ctx(), m).say).toMatch(/about 14 minutes.*28 minutes/)
    expect(chatReply({ type: 'delay' }, ctx({ context: 'home' }), m).say).toMatch(/no signal delay/)
    expect(chatReply({ type: 'radiation' }, ctx(), m).say).toMatch(/^Estimated .* not measured: about 256 millisieverts/)
    const j1 = chatReply({ type: 'joke' }, ctx(), m).say
    m.turn++
    const j2 = chatReply({ type: 'joke' }, ctx(), m).say
    expect(j1).not.toBe(j2)
  })
  it('weather is honest and uses the environment station when there is a reading', () => {
    const m = newMemory()
    const none = chatReply({ type: 'weather' }, ctx({ env: null }), m)
    expect(none.say).toMatch(/no weather in here.*no reading/i)
    const env = { label: 'Mission cabin station', t: 22.4, h: 45, gas: 'ok' as const, ageMin: 3, simulated: false }
    const r = chatReply({ type: 'weather' }, ctx({ env }), m).say
    expect(r).toMatch(/22\.4 degrees and 45 percent humidity, 3 minutes ago/)
    expect(r).toMatch(/within the comfort range/)
    expect(chatReply({ type: 'weather' }, ctx({ context: 'home', env: { ...env, t: 29, label: 'Your private sensor station' } }), m).say).toMatch(/^I don’t have a weather forecast.*outside 18 to 27/)
  })
  it('today: coach session and checklist', () => {
    const r = chatReply({ type: 'today' }, ctx({ today: { coach: 'Today: strength, about 30 minutes, 6 exercises.', tasks: [{ label: 'Drink water', time: '10:00', done: false }, { label: 'Log sleep', time: '', done: true }] } }), newMemory())
    expect(r.say).toBe('Today: strength, about 30 minutes, 6 exercises. Still on your checklist: Drink water at 10:00.')
  })
  it('calculations and unit conversions', () => {
    expect(R('what is 12 times 7')).toEqual({ kind: 'chat', chat: { type: 'calc', a: 12, op: '*', b: 7 } })
    expect(R('what is twenty plus fifteen')).toEqual({ kind: 'chat', chat: { type: 'calc', a: 20, op: '+', b: 15 } })
    expect(RT('5 artı 3 kaç eder')).toMatchObject({ chat: { type: 'calc', a: 5, op: '+', b: 3 } })
    expect(R('20 percent of 150')).toMatchObject({ chat: { type: 'calc', op: '%of' } })
    expect(R('convert 100 fahrenheit to celsius')).toEqual({ kind: 'chat', chat: { type: 'convert', value: 100, from: 'f', to: 'c' } })
    expect(R('how many kilograms is 150 pounds')).toMatchObject({ chat: { type: 'convert', value: 150, from: 'lb', to: 'kg' } })
    expect(R('120 mmHg to kPa')).toMatchObject({ chat: { type: 'convert', from: 'mmhg', to: 'kpa' } })
    expect(chatType(R('what is mmHg'))).toBe('unitInfo')
    expect(calculate(10, '/', 0)).toBeNull()
    expect(convert(98.6, 'f', 'c')).toBeCloseTo(37, 5)
    expect(convert(1, 'lb', 'kg')).toBeCloseTo(0.45359237, 8)
    expect(chatReply({ type: 'convert', value: 100, from: 'f', to: 'c' }, ctx(), newMemory()).say).toBe('100 degrees Fahrenheit is about 37.8 degrees Celsius.')
    expect(chatReply({ type: 'calc', a: 12, op: '*', b: 7 }, ctx(), newMemory()).say).toBe('12 times 7 is 84.')
    // blood pressure numbers are never treated as a sum
    expect(R('my blood pressure is 128 over 82')).toMatchObject({ kind: 'voice', intent: { type: 'log', key: 'bp' } })
  })
  it('falls back gracefully and varies its wording', () => {
    expect(R('banana helicopter')).toEqual({ kind: 'unknown' })
    const m = newMemory()
    const a = fallbackReply(m)
    m.turn++
    expect(fallbackReply(m)).not.toBe(a)
    expect(vary(['a', 'b', 'c'], 1, 'x')).toBe(vary(['a', 'b', 'c'], 1, 'x'))
  })
})

describe('safety: symptoms and crisis never fall into small talk', () => {
  it('routes crisis words to the urgent path', () => {
    for (const t of ['I want to die', 'I want to kill myself', 'I am thinking about suicide', 'I don’t want to live anymore', 'ölmek istiyorum', 'kendimi öldürmek istiyorum', 'hey aura i want to end my life']) {
      expect(route(t).kind, t).toBe('crisis')
    }
    expect(isCrisis('this workout is killing me')).toBe(false)
  })
  it('the crisis text gives the engine’s urgent plan', () => {
    const r = consultStep(newConsult(), { context: 'home', readings: {}, profile: null, delaySec: 0 }, { text: 'self-harm. I want to die' })
    expect(r.emergency).toBe(true)
    expect(crisisText({ context: 'home', readings: {}, profile: null, delaySec: 0 })).toMatch(/^Emergency — get help now. Call 112/)
    expect(crisisText({ context: 'space', readings: {}, profile: null, delaySec: 840 })).toMatch(/flight surgeon.*28 min/)
  })
  it('symptoms go to the consultation engine, even mixed with a feeling', () => {
    expect(R('I have chest pain')).toMatchObject({ kind: 'voice', intent: { type: 'consult' } })
    expect(R("I'm tired and dizzy")).toMatchObject({ kind: 'voice', intent: { type: 'consult' } })
    expect(R('I feel tired and my chest hurts')).toMatchObject({ kind: 'voice', intent: { type: 'consult' } })
    expect(R("I can't breathe")).toMatchObject({ kind: 'voice', intent: { type: 'consult' } })
    expect(RT('başım ağrıyor ve yorgunum')).toMatchObject({ kind: 'voice', intent: { type: 'consult' } })
    expect(R('I feel hopeless')).toMatchObject({ kind: 'voice', intent: { type: 'consult' } })
    expect(R('I feel sick')).toMatchObject({ kind: 'voice', intent: { type: 'consult' } })
  })
  it('plain feelings get a kind reply that offers a feature', () => {
    expect(R("I'm so tired")).toEqual({ kind: 'chat', chat: { type: 'feeling', feeling: 'tired' } })
    expect(R('I feel stressed')).toMatchObject({ chat: { type: 'feeling', feeling: 'stressed' } })
    expect(R('feeling a bit lonely')).toMatchObject({ chat: { type: 'feeling', feeling: 'lonely' } })
    expect(RT('çok yorgunum')).toMatchObject({ chat: { type: 'feeling', feeling: 'tired' } })
    expect(feelingOf("I'm feeling great")).toBe('great')
    const m = newMemory()
    expect(chatReply({ type: 'feeling', feeling: 'tired' }, ctx(), m).offer).toEqual({ kind: 'consult' })
    expect(chatReply({ type: 'feeling', feeling: 'lonely' }, ctx(), m).say).toMatch(/far from home.*rule-based assistant/)
    expect(chatReply({ type: 'feeling', feeling: 'good' }, ctx(), m).offer).toEqual({ kind: 'logMood', value: 4 })
  })
})

describe('alternatives, mis-hearings and clarification', () => {
  const alts = (...xs: [string, number][]) => xs.map(([transcript, confidence]) => ({ transcript, confidence }))
  it('picks the alternative that makes sense', () => {
    const u = understand(alts(['how is my blood pleasure', 0.7], ['how is my blood pressure', 0.6]))
    expect(u.route).toEqual({ kind: 'voice', intent: { type: 'reading', key: 'bp' } })
    const v = understand(alts(['show the lunch', 0.8], ['show the lungs', 0.55]))
    expect(v.route).toEqual({ kind: 'voice', intent: { type: 'system', system: 'lungs' } })
    const w = understand(alts(['what is my hard rate', 0.8]))
    expect(w.route).toEqual({ kind: 'voice', intent: { type: 'reading', key: 'hr' } })
    const tr = understand(alts(['tansyonum nasıl', 0.8]), { lang: 'en-US' })
    expect(tr.route).toEqual({ kind: 'voice', intent: { type: 'reading', key: 'bp' } })
    expect(tr.lang).toBe('tr')
  })
  it('safety wins a near tie', () => {
    const u = understand(alts(['I have chess pain', 0.7], ['I have chest pain', 0.6]))
    expect(u.route).toMatchObject({ kind: 'voice', intent: { type: 'consult' } })
  })
  it('asks when two medical meanings are close', () => {
    const u = understand(alts(['how is my blood pressure', 0.62], ['how is my blood sugar', 0.6]))
    expect(u.route.kind).toBe('clarify')
    if (u.route.kind === 'clarify') {
      expect(u.route.question).toBe('Did you mean your blood pressure or your blood sugar?')
      expect(resolveClarify('blood sugar', u.route.options)).toBe(1)
      expect(resolveClarify('the first one', u.route.options)).toBe(0)
      expect(resolveClarify('pressure', u.route.options)).toBe(0)
      expect(resolveClarify('neither', u.route.options)).toBeNull()
      expect(resolveClarify('no', u.route.options)).toBe('no')
    }
  })
  it('asks when the words themselves are ambiguous', () => {
    const blood = R('how is my blood')
    expect(blood).toMatchObject({ kind: 'clarify', question: 'Did you mean your blood pressure or your blood sugar?' })
    const temp = R("what's the temperature")
    expect(temp).toMatchObject({ kind: 'clarify', question: 'Did you mean your body temperature or the cabin temperature?' })
    if (temp.kind === 'clarify') expect(resolveClarify('the cabin', temp.options)).toBe(1)
    expect(R('what is my temperature')).toEqual({ kind: 'voice', intent: { type: 'reading', key: 'temp' } })
    const heart = R('how is my heart')
    expect(heart.kind).toBe('clarify')
    if (heart.kind === 'clarify') {
      expect(resolveClarify('heart rate', heart.options)).toBe(0)
      expect(resolveClarify('show it', heart.options)).toBe(1)
    }
  })
  it('checks first when recognition confidence is low, but not for typed text', () => {
    const low = understand(alts(['how is my oxygen', 0.3]))
    expect(low.route).toMatchObject({ kind: 'clarify', question: expect.stringMatching(/^Did you mean your .*oxygen.*?$/i) })
    if (low.route.kind === 'clarify') expect(resolveClarify('yes', low.route.options)).toBe(0)
    expect(understand(alts(['how is my oxygen', 0.3]), { typed: true }).route).toMatchObject({ kind: 'voice' })
    // small talk is never blocked by a question
    expect(understand(alts(['tell me a joke', 0.3])).route).toMatchObject({ kind: 'chat' })
  })
  it('a log is never made without the read-back (the parser only proposes it)', () => {
    const u = understand(alts(['lock 250 mils of water', 0.8]))
    expect(u.route).toMatchObject({ kind: 'voice', intent: { type: 'log', key: 'water', values: { water: 0.25 } } })
  })
})

describe('follow-ups with short-term context', () => {
  it('understands follow-up phrases', () => {
    expect(R('and my heart rate?')).toEqual({ kind: 'voice', intent: { type: 'reading', key: 'hr' } })
    expect(R('what about the lungs')).toEqual({ kind: 'voice', intent: { type: 'system', system: 'lungs' } })
    expect(chatType(R('what about yesterday'))).toBe('yesterday')
    expect(chatType(RT('peki dün'))).toBe('yesterday')
    expect(chatType(R('why?'))).toBe('why')
    expect(chatType(R('tell me more'))).toBe('more')
    expect(chatType(R('repeat that slower'))).toBe('slower')
    expect(R('repeat that')).toMatchObject({ kind: 'voice', intent: { type: 'repeat' } })
  })
  it('answers them from memory', () => {
    const m = newMemory()
    expect(chatReply({ type: 'yesterday' }, ctx(), m).say).toMatch(/Ask about a reading first/)
    m.lastReading = 'bp'
    expect(chatReply({ type: 'yesterday' }, ctx({ yesterday: 'Yesterday your blood pressure was 132/84 mmHg, attention.' }), m).say).toMatch(/132\/84/)
    m.why = 'Because of the rule.'
    expect(chatReply({ type: 'why' }, ctx(), m).say).toBe('Because of the rule.')
    expect(chatReply({ type: 'slower' }, ctx(), m, 'Last thing I said.')).toMatchObject({ say: 'Last thing I said.', slower: true })
    expect(chatReply({ type: 'more' }, ctx(), newMemory()).say).toMatch(/That’s all I have/)
  })
  it('finds yesterday’s value from the measurements', () => {
    const row = (metric: Measurement['metric'], value: number, day: number) => ({ id: day * 10 + value, crewId: 1, metric, value, day, at: `2026-11-${day - 128}T08:00:00Z`, source: 'sim', device: 't' }) as Measurement
    const rows = [row('sys', 132, 141), row('dia', 84, 141), row('sys', 120, 142), row('dia', 78, 142)]
    expect(yesterdayText(rows, 'bp', 142)).toBe('Yesterday your blood pressure was 132/84 mmHg, attention.')
    expect(yesterdayText(rows, 'hr', 142)).toBeNull()
  })
  it('remembers a name', () => {
    expect(parseChat('my name is Ayşe')).toEqual({ type: 'setName', name: 'Ayse' })
    expect(parseChat("I'm tired")).toMatchObject({ type: 'feeling' })
  })
})

describe('everyday phrases do not get "corrected" into health words', () => {
  it('keeps chat as chat', () => {
    const u = (t: string) => understand([{ transcript: t, confidence: 0.85 }]).route
    expect(u("what's the weather")).toMatchObject({ kind: 'chat', chat: { type: 'weather' } })
    expect(u('can you hear me')).toMatchObject({ kind: 'chat', chat: { type: 'presence' } })
    expect(u("what's up")).toMatchObject({ kind: 'chat', chat: { type: 'howAreYou' } })
    expect(u("what's your favourite planet")).toMatchObject({ kind: 'chat', chat: { type: 'favourite' } })
    expect(u('how are my bones')).toEqual({ kind: 'voice', intent: { type: 'system', system: 'bones' } })
    expect(u("I'm stressed about the spacewalk")).toMatchObject({ kind: 'chat', chat: { type: 'feeling', feeling: 'stressed' } })
    expect(u('ruh halim kötü')).toMatchObject({ kind: 'voice', intent: { type: 'log', key: 'mood', values: { mood: 2 } } })
  })
})
