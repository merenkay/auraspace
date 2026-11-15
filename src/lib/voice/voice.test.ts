import { describe, expect, it } from 'vitest'
import { evaluate } from '../health'
import type { Measurement } from '../types'
import { addressFor, alertsBriefing, readingBriefing, scoreBriefing, statusBriefing } from './briefing'
import { consultStep, newConsult } from './consult'
import { describeEntry, hasWake, parseIntent, pathFor, stripWake, validateValues } from './intents'
import { decimalWords, extractNumbers, normalizeNumbers, numberWords } from './numbers'
import { chunkText, pickVoice, sayBloodPressure, sayPercent } from './speech'

const en = (t: string) => parseIntent(t, { lang: 'en-US' })
const tr = (t: string) => parseIntent(t, { lang: 'tr-TR' })

describe('numbers', () => {
  it('converts English and Turkish number words', () => {
    expect(extractNumbers('one twenty eight over eighty two')).toEqual([128, 82])
    expect(extractNumbers('a hundred and twenty eight')).toEqual([128])
    expect(extractNumbers('thirty six point eight')).toEqual([36.8])
    expect(extractNumbers('yüz yirmi sekiz', true)).toEqual([128])
    expect(extractNumbers('otuz yedi buçuk', true)).toEqual([37.5])
    expect(extractNumbers('ateşim 36,8')).toEqual([36.8])
    expect(extractNumbers('250 ml')).toEqual([250])
    expect(normalizeNumbers('turn on the light')).toBe('turn on the light')
  })
  it('says numbers as words', () => {
    expect(numberWords(98)).toBe('ninety-eight')
    expect(numberWords(128)).toBe('one hundred twenty-eight')
    expect(decimalWords(36.8)).toBe('thirty-six point eight')
    expect(sayPercent(98)).toBe('ninety-eight percent')
    expect(sayBloodPressure(138, 86)).toBe('138 over 86')
  })
})

describe('speech helpers', () => {
  it('prefers a calm English voice and avoids novelty voices', () => {
    const i = pickVoice([{ name: 'Zarvox', lang: 'en-US' }, { name: 'Microsoft Libby Online (Natural)', lang: 'en-GB' }, { name: 'Deutsch', lang: 'de-DE' }])
    expect(i).toBe(1)
    expect(pickVoice([])).toBe(-1)
  })
  it('splits long text into sentences', () => {
    expect(chunkText('One. Two! Three?')).toEqual(['One.', 'Two!', 'Three?'])
    expect(chunkText('a, '.repeat(120)).every((c) => c.length <= 220)).toBe(true)
  })
})

describe('wake word', () => {
  it('detects and strips it', () => {
    expect(hasWake('hey aura what is my status')).toBe(true)
    expect(hasWake('what is my status')).toBe(false)
    expect(stripWake('Hey AURA, status report')).toEqual({ woke: true, rest: 'status report' })
    expect(en('aura')).toEqual({ type: 'greet', wake: true })
  })
})

describe('intents: English', () => {
  it('briefing and queries', () => {
    expect(en('status report').type).toBe('status')
    expect(en('How am I doing?').type).toBe('status')
    expect(en('how is my blood pressure')).toEqual({ type: 'reading', key: 'bp' })
    expect(en("what's my heart rate")).toEqual({ type: 'reading', key: 'hr' })
    expect(en('how is my oxygen')).toEqual({ type: 'reading', key: 'spo2' })
    expect(en('how did I sleep')).toEqual({ type: 'reading', key: 'sleep' })
    expect(en('how much water have I had')).toEqual({ type: 'reading', key: 'water' })
    expect(en('list my alerts').type).toBe('alerts')
    expect(en('explain my score').type).toBe('score')
  })
  it('systems and navigation', () => {
    expect(en('show the heart')).toEqual({ type: 'system', system: 'heart' })
    expect(en('show me the lungs')).toEqual({ type: 'system', system: 'lungs' })
    expect(en('show my heart rate')).toEqual({ type: 'reading', key: 'hr' })
    expect(en('open coach')).toEqual({ type: 'nav', target: 'coach' })
    expect(en('go to history')).toEqual({ type: 'nav', target: 'history' })
    expect(en('open the environment')).toEqual({ type: 'nav', target: 'environment' })
    expect(en('what is my training today')).toEqual({ type: 'nav', target: 'coach' })
  })
  it('logging by voice', () => {
    expect(en('log 250 millilitres of water')).toEqual({ type: 'log', key: 'water', values: { water: 0.25 }, mode: 'add' })
    expect(en('I drank two glasses of water')).toMatchObject({ type: 'log', values: { water: 0.5 } })
    expect(en('my blood pressure is 128 over 82')).toEqual({ type: 'log', key: 'bp', values: { sys: 128, dia: 82 }, mode: 'set' })
    expect(en('my blood pressure is one twenty eight over eighty two')).toMatchObject({ values: { sys: 128, dia: 82 } })
    expect(en('my heart rate is 72')).toMatchObject({ type: 'log', key: 'hr', values: { hr: 72 } })
    expect(en('my temperature is 36.8')).toMatchObject({ type: 'log', key: 'temp', values: { temp: 36.8 } })
    expect(en('my oxygen is 97 percent')).toMatchObject({ type: 'log', key: 'spo2', values: { spo2: 97 } })
    expect(en('I slept 6 and a half hours').type).toBe('log')
    expect(en('my blood pressure is 128')).toEqual({ type: 'logIncomplete', key: 'bp' })
  })
  it('does not log a question, and rejects values the form would reject', () => {
    expect(en('is 128 over 82 a good blood pressure').type).toBe('reading')
    expect(validateValues({ sys: 400, dia: 80 })).toMatch(/between 60 and 250/)
    expect(validateValues({ sys: 80, dia: 120 })).toMatch(/higher/)
    expect(validateValues({ sys: 128, dia: 82 })).toBeNull()
    expect(validateValues({ temp: 98.6 })).toMatch(/between 30 and 43/)
    expect(describeEntry('bp', { sys: 128, dia: 82 })).toBe('blood pressure 128 over 82')
  })
  it('consultations, answers and control words', () => {
    expect(en('I have chest pain and my left arm is numb').type).toBe('consult')
    expect(en('start a consultation')).toEqual({ type: 'consult', text: '' })
    expect(en('yes')).toEqual({ type: 'answer', answer: 'yes' })
    expect(en('no thanks')).toEqual({ type: 'answer', answer: 'no' })
    expect(en('not sure')).toEqual({ type: 'answer', answer: 'unsure' })
    expect(en('cancel')).toEqual({ type: 'answer', answer: 'no' })
    expect(en('repeat that').type).toBe('repeat')
    expect(en('stop')).toEqual({ type: 'stop' })
    expect(en('be quiet')).toEqual({ type: 'stop' })
    expect(en('what can I say').type).toBe('help')
    expect(en('thank you')).toEqual({ type: 'close' })
  })
  it('never guesses', () => {
    expect(en('banana helicopter')).toEqual({ type: 'unknown' })
    expect(en('')).toEqual({ type: 'unknown' })
    expect(en('what is the capital of France')).toEqual({ type: 'unknown' })
    expect(en('turn on the lights')).toEqual({ type: 'unknown' })
  })
})

describe('intents: Turkish', () => {
  it('briefing and queries', () => {
    expect(tr('durum raporu').type).toBe('status')
    expect(tr('nasılım').type).toBe('status')
    expect(tr('tansiyonum nasıl')).toEqual({ type: 'reading', key: 'bp' })
    expect(tr('nabzım kaç')).toEqual({ type: 'reading', key: 'hr' })
    expect(tr('ateşim yüksek mi')).toEqual({ type: 'reading', key: 'temp' })
    expect(tr('oksijenim nasıl')).toEqual({ type: 'reading', key: 'spo2' })
    expect(tr('uyku düzenim nasıl')).toEqual({ type: 'reading', key: 'sleep' })
    expect(tr('uyarıları söyle').type).toBe('alerts')
    expect(tr('puanımı açıkla').type).toBe('score')
  })
  it('systems, navigation, logging', () => {
    expect(tr('kalbi göster')).toEqual({ type: 'system', system: 'heart' })
    expect(tr('akciğerleri göster')).toEqual({ type: 'system', system: 'lungs' })
    expect(tr('böbrekleri göster')).toEqual({ type: 'system', system: 'renal' })
    expect(tr('geçmişi aç')).toEqual({ type: 'nav', target: 'history' })
    expect(tr('antrenmanı aç')).toEqual({ type: 'nav', target: 'coach' })
    expect(tr('250 mililitre su içtim')).toEqual({ type: 'log', key: 'water', values: { water: 0.25 }, mode: 'add' })
    expect(tr('bir bardak su içtim')).toMatchObject({ type: 'log', values: { water: 0.25 } })
    expect(tr('tansiyonum 128 82')).toMatchObject({ type: 'log', key: 'bp', values: { sys: 128, dia: 82 } })
    expect(tr('ateşim 37,5')).toMatchObject({ type: 'log', key: 'temp', values: { temp: 37.5 } })
    expect(tr('nabzım yetmiş iki')).toMatchObject({ type: 'log', key: 'hr', values: { hr: 72 } })
  })
  it('symptoms and answers', () => {
    expect(tr('Göğsüm ağrıyor, sol kolum uyuşuyor ve nefes alamıyorum').type).toBe('consult')
    expect(tr('başım ağrıyor').type).toBe('consult')
    expect(tr('evet')).toEqual({ type: 'answer', answer: 'yes' })
    expect(tr('hayır')).toEqual({ type: 'answer', answer: 'no' })
    expect(tr('emin değilim')).toEqual({ type: 'answer', answer: 'unsure' })
    expect(tr('sus')).toEqual({ type: 'stop' })
    expect(tr('yardım').type).toBe('help')
    expect(tr('tekrar').type).toBe('repeat')
  })
})

describe('roles', () => {
  it('limits what can be opened by voice', () => {
    expect(pathFor('coach', 'ground', 1)).toBeNull()
    expect(pathFor('aura', 'ground', 1)).toBeNull()
    expect(pathFor('aura', 'surgeon', 2)).toBe('/crew/2/aura')
    expect(pathFor('coach', 'astronaut', 1)).toBe('/crew/1/coach')
    // own records: "my reports" opens the person's own report page (the surgeon-only Reports page stays closed)
    expect(pathFor('reports', 'astronaut', 1)).toBe('/my-reports')
    expect(pathFor('reports', 'ground', 1)).toBeNull()
    expect(pathFor('environment', 'ground', null)).toBe('/environment')
  })
})

const mission = { context: 'space' as const, profileId: 'iss', day: 142 }
const row = (id: number, metric: Measurement['metric'], value: number): Measurement => ({ id, crewId: 1, metric, value, at: '2026-11-14T08:00:00Z', day: 142, source: 'sim', device: 'test' }) as Measurement
const ev = (rows: Measurement[], hide = false) => evaluate(rows, mission, hide)

describe('briefing', () => {
  const bad = ev([row(1, 'sys', 150), row(2, 'dia', 95), row(3, 'sleep', 5.5), row(4, 'hr', 62), row(5, 'spo2', 98)])
  it('starts with the greeting, the score and the urgent items first', () => {
    const t = statusBriefing(bad, { address: 'Commander', hour: 15 })
    expect(t).toMatch(/^Good afternoon, Commander\. Health score [a-z-]+\./)
    expect(t).toMatch(/items? needs? attention: blood pressure 150 over 95, urgent/)
    expect(t.indexOf('blood pressure')).toBeLessThan(t.indexOf('sleep'))
  })
  it('says there is no data instead of "normal"', () => {
    const none = ev([])
    expect(statusBriefing(none, { address: null, hour: 9 })).toMatch(/no readings yet/)
    expect(statusBriefing(null, { address: 'Doctor', hour: 20 })).toMatch(/^Good evening, Doctor\. .*no readings yet/)
    expect(readingBriefing(none, 'bp', {})).toMatch(/do not have a blood pressure reading/)
    expect(alertsBriefing(none)).toMatch(/no readings/i)
    expect(scoreBriefing(none)).toMatch(/no health score/i)
    expect(statusBriefing(none, { address: null, hour: 9 })).not.toMatch(/normal|within range/)
  })
  it('covers reading, alerts and score; respects role and subject', () => {
    expect(readingBriefing(bad, 'bp', {})).toMatch(/^Your blood pressure is 150 over 95/)
    expect(readingBriefing(bad, 'spo2', {})).toMatch(/ninety-eight percent.*within range/)
    expect(readingBriefing(bad, 'bp', { subject: 'Mira Okafor' })).toMatch(/^Mira Okafor's blood pressure/)
    expect(readingBriefing(bad, 'mood', { hidden: true })).toMatch(/not available to your role/)
    expect(alertsBriefing(bad)).toMatch(/Urgent: Blood pressure/)
    expect(scoreBriefing(bad)).toMatch(/Health score .* fixed rules/)
    expect(statusBriefing(bad, { address: 'Doctor', hour: 10, subject: 'Mira Okafor' })).toMatch(/briefing for Mira Okafor/)
  })
  it('addresses people by role', () => {
    const u = (role: string, title: string, name = 'Mira Okafor') => ({ id: 1, username: 'x', role, name, title, crewId: 1, context: 'space' }) as never
    expect(addressFor(u('astronaut', 'Commander'), { id: 1, name: 'Mira Okafor', callsign: 'CDR', position: 'Commander', color: '' })).toBe('Commander')
    expect(addressFor(u('surgeon', 'Flight Surgeon', 'Dr. Selin Arslan'))).toBe('Doctor')
    expect(addressFor(u('ground', 'Mission Control · CAPCOM'))).toBe('CAPCOM')
    expect(addressFor(u('member', 'Member', 'Ayse Kaya'))).toBe('Ayse')
  })
})

describe('voice consultation', () => {
  const c = { context: 'home' as const, readings: {}, profile: null, delaySec: 0 }
  it('turns the Turkish heart-attack sentence into an urgent plan read from the engine', () => {
    const r = consultStep(newConsult(), c, { text: 'Göğsüm ağrıyor, sol kolum uyuşuyor, nefes alamıyorum ve terliyorum' })
    expect(r.emergency).toBe(true)
    expect(r.say).toMatch(/Emergency/)
    expect(r.say).toMatch(/Call 112/)
    expect(r.state.done).toBe(true)
  })
  it('asks follow-up questions and takes yes/no answers', () => {
    const r1 = consultStep(newConsult(), c, { text: 'I have a headache' })
    expect(r1.emergency).toBe(false)
    expect(r1.state.pending).toBeTruthy()
    const r2 = consultStep(r1.state, c, { answer: 'no' })
    expect(r2.state.answers[r1.state.pending!]).toBe('no')
  })
  it('says so when it cannot match the text', () => {
    expect(consultStep(newConsult(), c, { text: 'banana' }).say).toMatch(/could not match/)
  })
})
