import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOLD_MAX_MS, STOP_GRACE_MS, TIMING, Transcript, type Alt } from './endpoint'
import { afterWake, correct, detectLang, editDistance, fuzzyWord, phoneticKey, stripFillers } from './fuzzy'
import { parseIntent, describeEntry, validateValues } from './intents'
import { conversational, prosody, speakable } from './prosody'
import { createListener, type Rec, type RecCtor } from './recognition'
import { pickVoice, rankVoices } from './speech'

/* ---------- a fake browser recogniser ---------- */

type R = { alts: { transcript: string; confidence: number }[]; final: boolean }
class FakeRec implements Rec {
  static all: FakeRec[] = []
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string; confidence?: number }> & { isFinal: boolean }> }) => void) | null = null
  results: R[] = []
  running = false
  constructor() {
    FakeRec.all.push(this)
  }
  start() {
    this.running = true
    this.onstart?.()
  }
  stop() {
    // a real engine finalises pending words, then ends
    this.results = this.results.map((r) => ({ ...r, final: true }))
    this.emit()
    this.end()
  }
  abort() {
    this.running = false
  }
  end() {
    this.running = false
    this.onend?.()
  }
  /** set the current (last) result's text; final=false is an interim */
  say(text: string, final = false, alts: string[] = []) {
    const last = this.results[this.results.length - 1]
    const r: R = { alts: [{ transcript: text, confidence: 0.9 }, ...alts.map((a) => ({ transcript: a, confidence: 0.5 }))], final }
    if (last && !last.final) this.results[this.results.length - 1] = r
    else this.results.push(r)
    this.emit()
  }
  emit() {
    const results = this.results.map((r) => Object.assign([...r.alts], { isFinal: r.final }))
    this.onresult?.({ resultIndex: 0, results })
  }
}
const latest = () => FakeRec.all[FakeRec.all.length - 1]

function listen(mode: 'auto' | 'hold' | 'wake' = 'auto', extra: Record<string, unknown> = {}) {
  const finals: Alt[][] = []
  const errors: string[] = []
  let ended = 0
  const l = createListener(
    { lang: 'en-US', mode, timing: TIMING.normal, onFinal: (a) => finals.push(a), onError: (e) => errors.push(e), onEnd: () => ended++, ...extra },
    { Ctor: FakeRec as unknown as RecCtor },
  )!
  l.start()
  return { l, finals, errors, ended: () => ended }
}

describe('end of utterance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRec.all = []
  })
  afterEach(() => vi.useRealTimers())

  it('uses continuous recognition with interim results and five alternatives', () => {
    listen()
    expect(latest()).toMatchObject({ continuous: true, interimResults: true, maxAlternatives: 5, lang: 'en-US' })
  })

  it('waits ~2 s after the last words, not after the first pause', () => {
    const { finals } = listen()
    latest().say('my blood pressure')
    vi.advanceTimersByTime(1500)
    latest().say('my blood pressure is 128') // still talking: the window restarts
    vi.advanceTimersByTime(1500)
    expect(finals).toHaveLength(0)
    latest().say('my blood pressure is 128 over 82', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs - 10)
    expect(finals).toHaveLength(0)
    vi.advanceTimersByTime(20 + STOP_GRACE_MS)
    expect(finals).toHaveLength(1)
    expect(finals[0][0].transcript).toBe('my blood pressure is 128 over 82')
  })

  it('waits longer (~3.5 s) when nothing has been said yet, then reports no speech', () => {
    const { finals, errors, ended } = listen()
    vi.advanceTimersByTime(TIMING.normal.silenceMs + 100)
    expect(errors).toEqual([])
    vi.advanceTimersByTime(TIMING.normal.initialMs)
    vi.advanceTimersByTime(STOP_GRACE_MS)
    expect(finals).toHaveLength(0)
    expect(errors).toEqual(['no-speech'])
    expect(ended()).toBe(1)
  })

  it('restarts transparently when the browser ends early, and stitches the transcript', () => {
    const { finals } = listen()
    latest().say('I drank two')
    latest().end() // Chrome ends the session mid-utterance (pause / no-speech / 60 s limit)
    vi.advanceTimersByTime(100)
    expect(FakeRec.all).toHaveLength(2)
    latest().say('glasses of water', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS)
    expect(finals[0][0].transcript).toBe('I drank two glasses of water')
  })

  it('has a hard cap', () => {
    const { finals } = listen()
    for (let t = 0; t < TIMING.normal.maxMs; t += 1000) {
      latest().say(`word ${t}`)
      vi.advanceTimersByTime(1000)
    }
    vi.advanceTimersByTime(STOP_GRACE_MS)
    expect(finals).toHaveLength(1)
  })

  it('push-to-talk listens until release, however long the pauses', () => {
    const { l, finals } = listen('hold')
    latest().say('log my sleep')
    vi.advanceTimersByTime(8000)
    expect(finals).toHaveLength(0)
    latest().say('log my sleep seven hours')
    l.finish('release')
    vi.advanceTimersByTime(STOP_GRACE_MS)
    expect(finals[0][0].transcript).toBe('log my sleep seven hours')
    // and still has a cap
    const h = listen('hold')
    vi.advanceTimersByTime(HOLD_MAX_MS + STOP_GRACE_MS)
    expect(h.errors).toEqual(['no-speech'])
  })

  it('a quick tap switches push-to-talk to auto mode; "tap to finish" ends at once', () => {
    const { l, finals } = listen('hold')
    l.setMode('auto')
    latest().say('status report')
    l.finish('tap')
    vi.advanceTimersByTime(STOP_GRACE_MS)
    expect(finals).toHaveLength(1)
  })

  it('reports the countdown window and a fatal error stops without restarting', () => {
    const wins: (number | null)[] = []
    const { errors } = listen('auto', { onWindow: (w: { total: number; deadline: number | null }) => wins.push(w.deadline ? w.total : null) })
    expect(wins[0]).toBe(TIMING.normal.initialMs)
    latest().say('hello')
    expect(wins[wins.length - 1]).toBe(TIMING.normal.silenceMs)
    latest().onerror?.({ error: 'not-allowed' })
    latest().end()
    vi.advanceTimersByTime(1000)
    expect(errors).toEqual(['denied'])
    expect(FakeRec.all).toHaveLength(1)
  })

  it('wake mode ignores chatter, takes the utterance after the wake word, and keeps listening', () => {
    const { finals } = listen('wake', { wakeTest: (t: string) => afterWake(t) !== null })
    latest().say('so anyway', true)
    vi.advanceTimersByTime(10_000)
    expect(finals).toHaveLength(0)
    latest().say('hey aura how is my heart rate', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS)
    expect(finals).toHaveLength(1)
    expect(afterWake(finals[0][0].transcript)).toBe('how is my heart rate')
    vi.advanceTimersByTime(300)
    expect(latest().running).toBe(true)
  })
})

describe('transcript alternatives', () => {
  it('combines segments and swaps one segment at a time', () => {
    const t = new Transcript()
    t.update([Object.assign([{ transcript: 'my blood', confidence: 0.9 }], { isFinal: true }), Object.assign([{ transcript: 'pleasure', confidence: 0.6 }, { transcript: 'pressure', confidence: 0.5 }], { isFinal: true })])
    const alts = t.alternatives()
    expect(alts.map((a) => a.transcript)).toEqual(['my blood pleasure', 'my blood pressure'])
  })
})

describe('fuzzy understanding', () => {
  it('edit distance and phonetic key', () => {
    expect(editDistance('presure', 'pressure')).toBe(1)
    expect(editDistance('ab', 'ba')).toBe(1)
    expect(phoneticKey('Glukoze')).toBe(phoneticKey('glucose'))
  })
  it('corrects common English mis-hearings', () => {
    expect(correct('how is my blood pleasure').text).toBe('how is my blood pressure')
    expect(correct("what's my hard rate").text).toBe("what's my heart rate")
    expect(correct('what is my s p o 2').text).toBe('what is my spo2')
    expect(correct('lock 250 mils of water').text).toBe('log 250 ml of water')
    expect(correct('um so uh show the lungs').text).toBe('show the lungs')
    expect(correct('open diagnostiks').text).toBe('open diagnostics')
    expect(correct('how is my temprature').text).toBe('how is my temperature')
    expect(fuzzyWord('pleasure')).toBeNull() // a real word is never "corrected" on its own
    expect(correct('it was a pleasure').fixes).toEqual([])
  })
  it('corrects Turkish mis-hearings', () => {
    expect(correct('tansyonum nasıl').text).toBe('tansiyonum nasil')
    expect(correct('tansiyon um kaç').text).toBe('tansiyonum kac')
    expect(parseIntent(correct('nabısım kaç').text, { lang: 'tr-TR' })).toEqual({ type: 'reading', key: 'hr' })
    expect(correct('şey yani oksjenim nasıl').text).toBe('oksijenim nasil')
  })
  it('wake word variants anywhere in the utterance', () => {
    expect(afterWake('hey aura status report')).toBe('status report')
    expect(afterWake('Ora, how is my pulse')).toBe('how is my pulse')
    expect(afterWake('okay aurora what time is it')).toBe('what time is it')
    expect(afterWake('blah blah hey Aura open history')).toBe('open history')
    expect(afterWake('what time is it')).toBeNull()
    expect(parseIntent('hey ora status report').type).toBe('status')
  })
  it('detects Turkish vs English from the words', () => {
    expect(detectLang('tansiyonum nasıl')).toBe('tr')
    expect(detectLang('bugün çok yorgunum')).toBe('tr')
    expect(detectLang('how is my blood pressure')).toBe('en')
    expect(detectLang('nabız', 'en')).toBe('tr')
    expect(detectLang('ok', 'tr')).toBe('tr')
  })
  it('strips fillers but keeps meaning words', () => {
    expect(stripFillers("um i don't feel well you know")).toBe("i don't feel well")
    expect(stripFillers('well my heart rate')).toBe('my heart rate')
  })
})

describe('voice logging: mood, exercise, sleep', () => {
  const en = (t: string) => parseIntent(t, { lang: 'en-US' })
  const tr = (t: string) => parseIntent(t, { lang: 'tr-TR' })
  it('mood by word or number', () => {
    expect(en('my mood is good')).toEqual({ type: 'log', key: 'mood', values: { mood: 4 }, mode: 'set' })
    expect(en('log my mood as 2')).toMatchObject({ values: { mood: 2 } })
    expect(en('my mood today is not great')).toMatchObject({ values: { mood: 2 } })
    expect(tr('ruh halim çok iyi')).toMatchObject({ type: 'log', values: { mood: 5 } })
    expect(en('how is my mood').type).toBe('reading')
    expect(validateValues({ mood: 7 })).toMatch(/between 1 and 5/)
    expect(describeEntry('mood', { mood: 4 })).toBe('your mood as good, 4 out of 5')
  })
  it('exercise minutes, added to today', () => {
    expect(en('I exercised for 30 minutes')).toEqual({ type: 'log', key: 'exercise', values: { exercise: 30 }, mode: 'add' })
    expect(en('log an hour of exercise')).toMatchObject({ values: { exercise: 60 } })
    expect(en('I worked out for 1.5 hours')).toMatchObject({ values: { exercise: 90 } })
    expect(tr('45 dakika egzersiz yaptım')).toMatchObject({ values: { exercise: 45 } })
    expect(validateValues({ exercise: 400 })).toMatch(/between 0 and 300/)
    expect(describeEntry('exercise', { exercise: 20 }, 30)).toBe('20 more minutes of exercise, 50 minutes today in total')
  })
  it('sleep', () => {
    expect(en('I slept seven hours')).toMatchObject({ type: 'log', key: 'sleep', values: { sleep: 7 } })
    expect(tr('7 saat uyudum')).toMatchObject({ type: 'log', key: 'sleep', values: { sleep: 7 } })
  })
})

describe('human-sounding speech', () => {
  it('says symbols and units as words', () => {
    expect(speakable('BP 138/86 mmHg.')).toBe('BP 138 over 86.')
    expect(speakable('SpO₂ 97%')).toBe('S P O two 97 percent')
    expect(speakable('Glucose 110 mg/dL (fasting)')).toBe('Glucose 110 milligrams per decilitre, fasting')
    expect(speakable('Keep the cabin at 18–27 °C · humidity 25–75 %')).toBe('Keep the cabin at 18 to 27 degrees Celsius, humidity 25 to 75 percent')
    expect(speakable('Mood 4 / 5')).toBe('Mood 4 out of 5')
    expect(speakable('Normal < 130/80 · High ≥ 140/90')).toBe('Normal below 130 over 80, High at or above 140 over 90')
    expect(speakable('This is AURA')).toBe('This is Aura')
  })
  it('uses contractions', () => {
    expect(conversational('I do not have a reading. That is within range. I will not assume it is normal.')).toBe("I don't have a reading. That's within range. I won't assume it is normal.")
  })
  it('chunks with pauses and gentle variation', () => {
    const c = prosody('Your heart rate is 72 beats per minute. That is within range. Anything else?')
    expect(c).toHaveLength(3)
    expect(c[2].pitch).toBeGreaterThan(c[1].pitch - 0.03)
    expect(c.every((x) => x.pauseAfter > 0)).toBe(true)
    const long = prosody(`${'word '.repeat(40)}, and then ${'more '.repeat(30)}.`)
    expect(long.length).toBeGreaterThan(1)
    expect(long.every((x) => x.text.length <= 220)).toBe(true)
    const urgent = prosody('Emergency. Call 112 now.', { urgent: true, rate: 1.2 })
    expect(urgent.every((x) => x.rate <= 0.97 && x.pitch < 1)).toBe(true)
  })
  it('ranks natural voices first', () => {
    const v = [
      { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
      { name: 'Google UK English Female', lang: 'en-GB' },
      { name: 'Microsoft Sonia Online (Natural) - English (United Kingdom)', lang: 'en-GB' },
      { name: 'Samantha (Enhanced)', lang: 'en-US', localService: true },
      { name: 'Microsoft Emel Online (Natural) - Turkish', lang: 'tr-TR' },
      { name: 'Zarvox', lang: 'en-US' },
    ]
    expect(pickVoice(v)).toBe(2)
    const r = rankVoices(v)
    expect(r[0].name).toMatch(/Sonia/)
    expect(r.map((x) => x.name)).not.toContain('Zarvox')
    expect(r.map((x) => x.name)).not.toContain('Microsoft Emel Online (Natural) - Turkish')
  })
})
