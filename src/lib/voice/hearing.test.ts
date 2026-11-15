// Hearing sensitivity: voice activity from synthetic level sequences (noise floor, hysteresis, quiet speech,
// sustained noise, AURA's own voice), and what the listener does with it (fake recogniser, fake timers).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { holdForVoice, retryDelay, STOP_GRACE_MS, TIMING, VOICE_HOLD, WAKE_RETRY, type Alt } from './endpoint'
import type { MicMonitor } from './level'
import { createListener, ERROR_TEXT, holdRecognition, type ListenWindow, type Rec, type RecCtor, type SpeechGate } from './recognition'
import { loadSettings } from './settings'
import { explainSilence, fromDb, MIC_CHECK, micVerdict, toDb, VAD, VoiceActivity, type Sensitivity } from './vad'

/* ---------- synthetic sound ---------- */

const STEP = 20
/** feed a constant level for `ms`, starting at `t`; returns the new time */
function tone(v: VoiceActivity, t: number, db: number, ms: number, o: { self?: boolean; peak?: number } = {}): number {
  for (let k = 0; k < ms; k += STEP) v.push(fromDb(db), t + k, o)
  return t + ms
}
/** words: bursts at `db` with short gaps back at the room level */
function speech(v: VoiceActivity, t: number, db: number, roomDb: number, ms: number, o: { peak?: number } = {}): number {
  const end = t + ms
  while (t < end) {
    t = tone(v, t, db, Math.min(280, end - t), o)
    if (t < end) t = tone(v, t, roomDb, Math.min(120, end - t))
  }
  return t
}

describe('voice activity (vad.ts)', () => {
  it('converts levels both ways', () => {
    expect(toDb(1)).toBeCloseTo(0)
    expect(toDb(0.1)).toBeCloseTo(-20)
    expect(toDb(0)).toBe(-100)
    expect(fromDb(-40)).toBeCloseTo(0.01)
  })

  it('learns the room as the noise floor and stays silent in it', () => {
    const v = new VoiceActivity('normal')
    tone(v, 1000, -55, 2000)
    expect(v.calibrated).toBe(true)
    expect(v.floorDb).toBeCloseTo(-55, 0)
    expect(v.voiced).toBe(false)
    expect(v.lastVoiceAt).toBe(-Infinity)
  })

  it('detects speech above the floor, keeps the floor at the room through the gaps, and ends after the hang-over', () => {
    const v = new VoiceActivity('normal')
    let t = tone(v, 0, -55, 1000)
    v.mark()
    t = speech(v, t, -28, -55, 2400)
    expect(v.lastVoiceAt).toBeGreaterThan(t - 300)
    expect(v.floorDb).toBeLessThan(-48) // words did not become the floor
    const s = v.stats()
    expect(s.voicedMs).toBeGreaterThan(1200)
    expect(s.snrDb).toBeGreaterThan(20)
    expect(s.speechDb).toBeGreaterThan(-36)
    t = tone(v, t, -55, VAD.HANG_MS + 400)
    expect(v.voiced).toBe(false)
  })

  it('has hysteresis: a level between the two thresholds neither starts speech nor ends it', () => {
    const between = VAD.ON_DB.normal - VAD.HYSTERESIS_DB / 2 // 8 dB above the floor: over OFF, under ON
    const quiet = new VoiceActivity('normal')
    let t = tone(quiet, 0, -55, 1000)
    tone(quiet, t, -55 + between, 800)
    expect(quiet.voiced).toBe(false)

    const v = new VoiceActivity('normal')
    t = tone(v, 0, -55, 1000)
    t = tone(v, t, -30, 400)
    expect(v.voiced).toBe(true)
    t = tone(v, t, -55 + between, 600) // dropped, but not below OFF
    expect(v.voiced).toBe(true)
    t = tone(v, t, -55 + 1, VAD.HANG_MS + 300) // now clearly below
    expect(v.voiced).toBe(false)
  })

  it('needs the level to hold for a moment: a click is not speech', () => {
    const v = new VoiceActivity('normal')
    let t = tone(v, 0, -55, 1000)
    t = tone(v, t, -20, 20) // one frame
    tone(v, t, -55, 400)
    expect(v.lastVoiceAt).toBe(-Infinity)
  })

  it('quiet speech: missed at Normal, heard at High, and Low needs a clear voice', () => {
    const run = (s: Sensitivity, speechDb: number) => {
      const v = new VoiceActivity(s)
      const t = tone(v, 0, -58, 1000)
      v.mark()
      speech(v, t, speechDb, -58, 2000)
      return v.stats().voicedMs
    }
    expect(run('normal', -50)).toBe(0) // 8 dB above the room
    expect(run('high', -50)).toBeGreaterThan(800)
    expect(run('low', -46)).toBe(0) // 12 dB above the room
    expect(run('low', -40)).toBeGreaterThan(800)
  })

  it('auto adapts in the session: recognised quiet speech lowers the threshold, sound without words raises it', () => {
    const v = new VoiceActivity('auto')
    expect(v.onDb).toBe(VAD.ON_DB.normal)
    let t = tone(v, 0, -58, 1000)
    // three utterances that the recogniser understood, though they were only ~8 dB above the room
    for (let i = 0; i < 3; i++) {
      v.mark()
      t = speech(v, t, -50, -58, 1500)
      v.learn(true)
      t = tone(v, t, -58, 600)
    }
    expect(v.onDb).toBeLessThan(8)
    v.mark()
    t = speech(v, t, -50, -58, 1500)
    expect(v.stats().voicedMs).toBeGreaterThan(500) // now it is detected
    // then a clattering room: speech-like sound, no words, again and again
    const before = v.onDb
    for (let i = 0; i < 4; i++) {
      v.mark()
      t = speech(v, t, -40, -58, 1200)
      v.learn(false)
      t = tone(v, t, -58, 400)
    }
    expect(v.onDb).toBeGreaterThan(before + 3)
    expect(v.onDb).toBeLessThanOrEqual(VAD.AUTO_RANGE[1])
    // a fixed setting never learns
    const fixed = new VoiceActivity('normal')
    t = tone(fixed, 0, -58, 1000)
    fixed.mark()
    speech(fixed, t, -50, -58, 1500)
    fixed.learn(true)
    expect(fixed.onDb).toBe(VAD.ON_DB.normal)
  })

  it('sustained noise becomes the floor within a few seconds, and speech over it is still found', () => {
    const v = new VoiceActivity('normal')
    let t = tone(v, 0, -60, 1500)
    const onset = t
    let voicedUntil = onset
    for (let k = 0; k < 6000; k += STEP) {
      v.push(fromDb(-36), t, {})
      if (v.voiced) voicedUntil = t
      t += STEP
    }
    expect(voicedUntil - onset).toBeGreaterThan(500) // it did sound like something at first
    expect(voicedUntil - onset).toBeLessThan(4000) // and stopped counting as voice
    expect(v.voiced).toBe(false)
    expect(v.floorDb).toBeGreaterThan(-39)
    v.mark()
    speech(v, t, -18, -36, 1500)
    expect(v.stats().voicedMs).toBeGreaterThan(600)
  })

  it('never counts AURA’s own voice: frames marked as self are dropped and do not move the floor', () => {
    const v = new VoiceActivity('high')
    let t = tone(v, 0, -55, 1000)
    const floor = v.floorDb
    v.mark()
    t = speech(v, t, -20, -55, 100) // a first syllable of the person, cut short
    t = tone(v, t, -15, 3000, { self: true }) // AURA talks through the loudspeaker
    expect(v.voiced).toBe(false)
    expect(v.floorDb).toBeCloseTo(floor, 1)
    expect(v.stats().peakDb).toBeLessThan(-18) // the loud self frames are not in the statistics
    const after = v.lastVoiceAt
    tone(v, t, -55, 500)
    expect(v.lastVoiceAt).toBe(after)
  })

  it('explains a listen without words', () => {
    expect(explainSilence(null)).toBe('no-speech')
    const muted = new VoiceActivity('normal')
    muted.mark()
    tone(muted, 0, -100, 3000) // digital silence
    expect(explainSilence(muted.stats())).toBe('mic-silent')
    const room = new VoiceActivity('normal')
    room.mark()
    tone(room, 0, -52, 3000) // only the room: the level never left the noise floor
    expect(explainSilence(room.stats())).toBe('mic-silent')
    const mumble = new VoiceActivity('normal')
    const t = tone(mumble, 0, -55, 1000)
    mumble.mark()
    speech(mumble, t, -40, -55, 1500)
    expect(explainSilence(mumble.stats())).toBe('no-words')
    // too little to judge
    const brief = new VoiceActivity('normal')
    brief.mark()
    tone(brief, 0, -100, 200)
    expect(explainSilence(brief.stats())).toBe('no-speech')
  })

  it('microphone check verdicts', () => {
    const check = (roomDb: number, speechDb: number | null, o: { peak?: number; ms?: number } = {}) => {
      const v = new VoiceActivity('normal')
      v.mark()
      const t = tone(v, 0, roomDb, 1200)
      if (speechDb !== null) speech(v, t, speechDb, roomDb, o.ms ?? 2500, { peak: o.peak })
      else tone(v, t, roomDb, o.ms ?? 2500)
      return micVerdict(v.stats())
    }
    expect(check(-58, null, { ms: 1000 })).toBe('waiting')
    expect(check(-100, null, { ms: MIC_CHECK.GIVE_UP_MS })).toBe('silent')
    expect(check(-58, -24)).toBe('good')
    expect(check(-62, -46)).toBe('quiet')
    expect(check(-58, -5)).toBe('loud')
    expect(check(-58, -14, { peak: 1 })).toBe('loud') // clipping
    expect(check(-36, -22)).toBe('noisy')
  })
})

/* ---------- the listener with a level meter ---------- */

type R = { alts: { transcript: string; confidence: number }[]; final: boolean }
class FakeRec implements Rec {
  static all: FakeRec[] = []
  static throwOnStart = 0
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
    if (FakeRec.throwOnStart > 0) {
      FakeRec.throwOnStart--
      throw new Error('InvalidStateError')
    }
    this.running = true
    this.onstart?.()
  }
  stop() {
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
  fail(error: string) {
    this.onerror?.({ error })
    this.end()
  }
  say(text: string, final = false) {
    const last = this.results[this.results.length - 1]
    const r: R = { alts: [{ transcript: text, confidence: 0.9 }], final }
    if (last && !last.final) this.results[this.results.length - 1] = r
    else this.results.push(r)
    this.emit()
  }
  emit() {
    this.onresult?.({ resultIndex: 0, results: this.results.map((r) => Object.assign([...r.alts], { isFinal: r.final })) })
  }
}
const latest = () => FakeRec.all[FakeRec.all.length - 1]
/** every listener a test made is stopped afterwards (they subscribe to module-level gates) */
const made: { abort(): void }[] = []
const stopAll = () => {
  for (const l of made.splice(0)) l.abort()
}

class FakeSpeech implements SpeechGate {
  on = false
  endedAt = -Infinity
  tail = 700
  fns = new Set<(s: boolean) => void>()
  active = () => this.on || Date.now() - this.endedAt < this.tail
  subscribe = (fn: (s: boolean) => void) => {
    this.fns.add(fn)
    return () => void this.fns.delete(fn)
  }
  set(on: boolean) {
    this.on = on
    if (!on) this.endedAt = Date.now()
    for (const f of [...this.fns]) f(on)
  }
}

function rig(mode: 'auto' | 'hold' | 'wake' = 'auto', sensitivity: Sensitivity = 'normal', extra: Record<string, unknown> = {}) {
  const vad = new VoiceActivity(sensitivity)
  const finals: Alt[][] = []
  const errors: string[] = []
  const windows: ListenWindow[] = []
  const speech = new FakeSpeech()
  let ended = 0
  let starts = 0
  let stopped = 0
  const monitor: MicMonitor = { activity: () => vad, mark: () => vad.mark(), stop: () => stopped++ }
  const l = createListener(
    { lang: 'en-US', mode, timing: TIMING.normal, sensitivity, wakeTest: (t: string) => /\baura\b/i.test(t), onStart: () => starts++, onWindow: (w) => windows.push(w), onFinal: (a) => finals.push(a), onError: (e) => errors.push(e), onEnd: () => ended++, ...extra },
    { Ctor: FakeRec as unknown as RecCtor, monitor: () => monitor, clock: () => Date.now(), speech },
  )!
  made.push(l)
  l.start()
  /** let `ms` pass with the microphone at `db` (or speech-like bursts over `room`) */
  const sound = (ms: number, db: number, room?: number) => {
    for (let k = 0; k < ms; k += STEP) {
      const inGap = room !== undefined && Date.now() % 400 >= 280
      vad.push(fromDb(inGap ? room : db), Date.now())
      vi.advanceTimersByTime(STEP)
    }
  }
  return { l, vad, finals, errors, windows, speech, sound, ended: () => ended, starts: () => starts, stopped: () => stopped }
}

describe('listener: the measured level joins the end-of-utterance timing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRec.all = []
    FakeRec.throwOnStart = 0
  })
  afterEach(() => {
    stopAll()
    vi.useRealTimers()
  })

  it('the pure rule: wait only while voice is measured, never past the cap, never without a meter', () => {
    const win = TIMING.normal.initialMs
    expect(holdForVoice(null, win, win, 'normal')).toBe(0)
    expect(holdForVoice({ calibrated: false, voiced: true, quietMs: 0 }, win, win, 'normal')).toBe(0)
    expect(holdForVoice({ calibrated: true, voiced: false, quietMs: 2000 }, win, win, 'normal')).toBe(0)
    expect(holdForVoice({ calibrated: true, voiced: true, quietMs: 0 }, win, win, 'normal')).toBe(VOICE_HOLD.CHECK_MS)
    expect(holdForVoice({ calibrated: true, voiced: false, quietMs: 200 }, win, win, 'normal')).toBe(VOICE_HOLD.CHECK_MS) // a gap between words
    expect(holdForVoice({ calibrated: true, voiced: true, quietMs: 0 }, win + VOICE_HOLD.MAX_MS.normal, win, 'normal')).toBe(0)
    expect(VOICE_HOLD.MAX_MS.high).toBeGreaterThan(VOICE_HOLD.MAX_MS.normal)
    expect(VOICE_HOLD.MAX_MS.low).toBeLessThan(VOICE_HOLD.MAX_MS.normal)
  })

  it('quiet speech is not cut off: the microphone stays open while a voice is measured, though no words have come yet', () => {
    const h = rig()
    h.sound(600, -56) // the room
    h.sound(5000, -34, -56) // the person talks; the recogniser is slow and has produced nothing
    expect(h.errors).toEqual([]) // without the meter this listen would have ended at 3.5 s with "no speech"
    expect(h.ended()).toBe(0)
    expect(h.windows.some((w) => w.voice)).toBe(true) // the HUD is told why the ring is not counting
    latest().say('my chest feels tight', true) // the words arrive at last
    h.sound(TIMING.normal.silenceMs + STOP_GRACE_MS + 100, -56)
    expect(h.finals).toHaveLength(1)
    expect(h.finals[0][0].transcript).toBe('my chest feels tight')
    expect(h.stopped()).toBe(1) // the meter is given back
  })

  it('background noise does not keep the microphone open: a steady noise is the floor, not a voice', () => {
    const h = rig()
    h.sound(TIMING.normal.initialMs + STOP_GRACE_MS + 60, -36) // a loud fan from the start
    expect(h.ended()).toBe(1)
    expect(h.errors).toEqual(['mic-silent']) // no voice ever rose above it
  })

  it('a noise that starts mid-listen is dropped once it has become the floor', () => {
    const h = rig()
    h.sound(800, -58)
    h.sound(TIMING.normal.initialMs + 2500, -36)
    expect(h.ended()).toBe(1) // well before the 30 s cap
    expect(h.errors).toHaveLength(1)
  })

  it('sound that goes on and on without words is capped, per sensitivity', () => {
    const endsAfter = (s: Sensitivity) => {
      FakeRec.all = []
      const h = rig('auto', s)
      h.sound(600, -56)
      let ms = 600
      while (!h.ended() && ms < 20_000) {
        h.sound(100, -30, -56)
        ms += 100
      }
      expect(h.errors).toEqual(['no-words'])
      return ms
    }
    const normal = endsAfter('normal')
    const win = TIMING.normal.initialMs
    expect(normal).toBeGreaterThan(win + VOICE_HOLD.MAX_MS.normal - 100)
    expect(normal).toBeLessThan(win + VOICE_HOLD.MAX_MS.normal + STOP_GRACE_MS + 600)
    expect(endsAfter('low')).toBeLessThan(normal)
    expect(endsAfter('high')).toBeGreaterThan(normal) // High waits longer for a slow or quiet start
  })

  it('says specifically why nothing was understood', () => {
    const mumble = rig()
    mumble.sound(600, -56)
    mumble.sound(1500, -36, -56)
    mumble.sound(TIMING.normal.initialMs + STOP_GRACE_MS, -56)
    expect(mumble.errors).toEqual(['no-words'])
    expect(ERROR_TEXT['no-words']).toMatch(/heard sound but no words/i)

    const muted = rig()
    muted.sound(TIMING.normal.initialMs + STOP_GRACE_MS + 60, -100)
    expect(muted.errors).toEqual(['mic-silent'])
    expect(ERROR_TEXT['mic-silent']).toMatch(/muted or too far/i)

    const far = rig() // the level stays at the room's floor the whole time
    far.sound(TIMING.normal.initialMs + STOP_GRACE_MS + 60, -55)
    expect(far.errors).toEqual(['mic-silent'])
    expect(ERROR_TEXT['no-speech']).toMatch(/did not hear anything/i) // kept for when nothing can be measured
  })

  it('without a meter (phones) it behaves exactly as before', () => {
    const errors: string[] = []
    const l = createListener({ lang: 'en-US', mode: 'auto', timing: TIMING.normal, onFinal: () => undefined, onError: (e) => errors.push(e) }, { Ctor: FakeRec as unknown as RecCtor, monitor: null, speech: null })!
    made.push(l)
    l.start()
    vi.advanceTimersByTime(TIMING.normal.initialMs + STOP_GRACE_MS + 10)
    expect(errors).toEqual(['no-speech'])
  })

  it('announces the start once, not on every transparent restart', () => {
    const h = rig()
    latest().say('I drank')
    latest().end()
    vi.advanceTimersByTime(100)
    latest().end()
    vi.advanceTimersByTime(100)
    expect(FakeRec.all.length).toBe(3)
    expect(h.starts()).toBe(1)
  })

  it('a silence timeout between two browser sessions still finishes the listen', () => {
    const h = rig()
    latest().say('log my sleep seven hours', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs - 30)
    latest().end() // the browser ends its session just before our window runs out
    vi.advanceTimersByTime(40)
    expect(h.finals).toHaveLength(1)
    expect(h.finals[0][0].transcript).toBe('log my sleep seven hours')
  })

  it('remembers the sensitivity setting with a safe default', () => {
    expect(loadSettings().sensitivity).toBe('auto')
  })
})

describe('listener: always-on wake word', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRec.all = []
    FakeRec.throwOnStart = 0
  })
  afterEach(() => {
    stopAll()
    vi.useRealTimers()
  })

  it('is not triggered by AURA’s own voice: recognition is suspended while it speaks and for a tail after', () => {
    const h = rig('wake')
    const first = latest()
    expect(first.running).toBe(true)
    h.speech.set(true) // AURA starts talking
    expect(first.running).toBe(false) // the session is dropped at once
    first.say('hello I am aura how can I help', true) // whatever the dropped session still reports is ignored
    vi.advanceTimersByTime(4000)
    expect(FakeRec.all).toHaveLength(1) // and no new session while it speaks
    h.speech.set(false)
    vi.advanceTimersByTime(h.speech.tail - 200)
    expect(FakeRec.all).toHaveLength(1) // nor during the tail (room echo, the recogniser's buffer)
    vi.advanceTimersByTime(600)
    expect(FakeRec.all).toHaveLength(2)
    expect(latest().running).toBe(true)
    vi.advanceTimersByTime(TIMING.normal.maxMs)
    expect(h.finals).toHaveLength(0) // nothing AURA said became a command
    // and the person is heard again afterwards
    latest().say('hey aura what is my heart rate', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS + 10)
    expect(h.finals).toHaveLength(1)
  })

  it('a wake listener started while AURA is speaking waits for it to finish', () => {
    const speech = new FakeSpeech()
    speech.set(true)
    const l = createListener({ lang: 'en-US', mode: 'wake', wakeTest: (t) => /aura/i.test(t), onFinal: () => undefined }, { Ctor: FakeRec as unknown as RecCtor, monitor: null, speech })!
    l.start()
    expect(FakeRec.all).toHaveLength(0)
    speech.set(false)
    vi.advanceTimersByTime(speech.tail + 400)
    expect(FakeRec.all).toHaveLength(1)
    l.abort()
  })

  it('a half-heard command is dropped when AURA starts to speak', () => {
    const h = rig('wake')
    latest().say('aura log my')
    h.speech.set(true)
    h.speech.set(false)
    vi.advanceTimersByTime(h.speech.tail + 400 + TIMING.normal.maxMs)
    expect(h.finals).toHaveLength(0)
  })

  it('restarts when the browser ends the session, and backs off when sessions end at once', () => {
    rig('wake')
    // a normal session: ends after a while, comes back after the base delay
    vi.advanceTimersByTime(8000)
    latest().end()
    vi.advanceTimersByTime(WAKE_RETRY.BASE_MS + 10)
    expect(FakeRec.all).toHaveLength(2)
    // sessions that die immediately: 500 ms, 1 s, 2 s ... never a tight loop
    const gaps: number[] = []
    for (let i = 0; i < 6; i++) {
      const n = FakeRec.all.length
      latest().end()
      let waited = 0
      while (FakeRec.all.length === n && waited < 20_000) {
        vi.advanceTimersByTime(50)
        waited += 50
      }
      gaps.push(waited)
    }
    expect(gaps[0]).toBeGreaterThanOrEqual(500)
    expect(gaps[1]).toBeGreaterThan(gaps[0])
    expect(gaps[2]).toBeGreaterThan(gaps[1])
    expect(Math.max(...gaps)).toBeLessThanOrEqual(WAKE_RETRY.MAX_MS + 50)
    // a session that works resets the back-off
    latest().say('the television is on')
    vi.advanceTimersByTime(3000)
    latest().end()
    vi.advanceTimersByTime(WAKE_RETRY.BASE_MS + 10)
    expect(latest().running).toBe(true)
    expect(retryDelay(0, false)).toBe(WAKE_RETRY.BASE_MS)
    expect(retryDelay(99, false)).toBe(WAKE_RETRY.MAX_MS)
    expect(retryDelay(1, true)).toBe(WAKE_RETRY.NET_BASE_MS)
    expect(retryDelay(99, true)).toBe(WAKE_RETRY.NET_MAX_MS)
  })

  it('survives a dropped connection: reports it once and keeps trying', () => {
    const h = rig('wake')
    vi.advanceTimersByTime(5000)
    for (let i = 0; i < 4; i++) {
      const n = FakeRec.all.length
      latest().fail('network')
      vi.advanceTimersByTime(WAKE_RETRY.NET_MAX_MS + 10)
      expect(FakeRec.all.length).toBe(n + 1)
    }
    expect(h.errors).toEqual(['network'])
    expect(h.ended()).toBe(0)
    // back online: words reset everything
    latest().say('aura status', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS + 10)
    expect(h.finals).toHaveLength(1)
  })

  it('retries when the engine refuses to start, and replaces a session that never starts', () => {
    FakeRec.throwOnStart = 2
    const h = rig('wake')
    expect(latest().running).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(latest().running).toBe(true)
    expect(h.errors).toEqual([])
    // a session object that never calls back
    const n = FakeRec.all.length
    latest().end()
    const orig = FakeRec.prototype.start
    FakeRec.prototype.start = function () {
      /* silent: neither start nor error */
    }
    vi.advanceTimersByTime(WAKE_RETRY.MAX_MS)
    FakeRec.prototype.start = orig
    vi.advanceTimersByTime(WAKE_RETRY.START_WATCHDOG_MS + WAKE_RETRY.MAX_MS + 100)
    expect(FakeRec.all.length).toBeGreaterThan(n + 1)
    expect(latest().running).toBe(true)
  })

  it('a microphone that is denied still ends the listener for good', () => {
    const h = rig('wake')
    latest().fail('not-allowed')
    vi.advanceTimersByTime(60_000)
    expect(h.errors).toEqual(['denied'])
    expect(FakeRec.all).toHaveLength(1)
    expect(h.stopped()).toBe(1)
  })

  it('the microphone check pauses recognition and gives it back', () => {
    rig('wake')
    const release = holdRecognition()
    expect(latest().running).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(FakeRec.all).toHaveLength(1)
    release()
    release() // twice is harmless
    vi.advanceTimersByTime(400)
    expect(FakeRec.all).toHaveLength(2)
    expect(latest().running).toBe(true)
    // a command being heard is finished with what it has
    FakeRec.all = []
    const cmd = rig('auto')
    latest().say('open history')
    const r2 = holdRecognition()
    vi.advanceTimersByTime(STOP_GRACE_MS + 10)
    expect(cmd.finals).toHaveLength(1)
    r2()
  })
})
