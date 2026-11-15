// The wake word end to end below the UI: the phrases (fuzzy.ts), the always-on listener with a fake recogniser and
// fake timers (recognition.ts), and when it runs (wake.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BARE_HEY, STOP_GRACE_MS, TIMING, WAKE_RETRY, type Alt } from './endpoint'
import { afterWake, isBareHey, matchWake, wakeRest } from './fuzzy'
import { createListener, pauseWakeListening, type Listener, type Rec, type RecCtor, type RecError, type SpeechGate } from './recognition'
import { DEFAULTS, loadSettings } from './settings'
import { WAKE_HEALTH_MS, WakeController, type WakeHooks } from './wake'

/* ---------- phrases ---------- */

describe('wake phrases', () => {
  const EN = ['hey aura', 'Hey AURA.', 'aura', 'Aura?', 'AURA!', 'hi aura', 'ok aura', 'okay aura', 'hello aura', 'hey ora', 'Hey Laura', 'a aura', 'hey or a', 'hey our a', 'hey aurora', 'hey Oprah', 'hey aira', 'hey oral', 'heyaura', 'Ora, how is my pulse']
  const TR = ['selam aura', 'merhaba aura', 'hey avra', 'ey aura', 'hay aura', 'Hey Aura', 'hey ora', 'merhaba ora', 'heyora', 'hayora', 'ahura', 'selam avra', 'alo aura']
  it.each([...EN, ...TR])('“%s” wakes AURA', (t) => {
    expect(matchWake(t)).not.toBeNull()
    expect(wakeRest(t)).toBe(t === 'Ora, how is my pulse' ? 'how is my pulse' : '')
  })
  it('anywhere in the utterance, case and punctuation do not matter', () => {
    expect(afterWake('so then I said, HEY AURA! open history')).toBe('open history')
    expect(afterWake('the radio is loud. Aura: status report')).toBe('status report')
    expect(afterWake('hey aura how is my blood pressure')).toBe('how is my blood pressure')
    expect(afterWake('selam aura tansiyonum nasıl')).toBe('tansiyonum nasıl')
  })
  it('everyday words and names do not wake it in the middle of a sentence', () => {
    for (const t of ['I told Laura yesterday', 'ora çok güzel bir yer değil mi diye sordu', 'what time is it', 'hey are you coming', 'we saw the aurora last night', 'oral medicine', 'i want tea or a coffee', 'hey all', 'hey era', 'tansiyonum nasıl']) {
      if (/^(ora|oral)\b/i.test(t)) continue // phrase-initial weak spellings are covered below
      expect(matchWake(t), t).toBeNull()
    }
    // a weak spelling at the start of a phrase counts (a recogniser often hears "AURA" as "Ora")
    expect(matchWake('ora çok güzel')).not.toBeNull()
  })
  it('a plain "hey" is recognised only as a phrase of its own', () => {
    for (const t of ['hey', 'Hey!', 'hey hey', 'Ey.', 'hay', 'HEY?']) expect(isBareHey(t), t).toBe(true)
    for (const t of ['hey John', 'hey how are you', 'they', 'hello', 'hey hey hey', '', 'okay']) expect(isBareHey(t), t).toBe(false)
    expect(wakeRest('hey what is my pulse')).toBe('what is my pulse')
    expect(wakeRest('Hey, hey aura status')).toBe('status')
  })
})

/* ---------- the listener ---------- */

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
  onresult: Rec['onresult'] = null
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

const made: Listener[] = []
/** the wake listener exactly as the voice agent configures it */
function wakeRig(o: { hey?: boolean } = {}) {
  const finals: Alt[][] = []
  const wakes: string[] = []
  const lost: number[] = []
  const speech = new FakeSpeech()
  const l = createListener(
    {
      lang: 'en-US',
      mode: 'wake',
      timing: TIMING.normal,
      sensitivity: 'normal',
      wakeTest: (t) => afterWake(t) !== null,
      bareWake: o.hey === false ? undefined : isBareHey,
      wakeOnly: (t) => !wakeRest(t),
      onWake: (how) => wakes.push(how),
      onWakeLost: () => lost.push(Date.now()),
      onFinal: (a) => finals.push(a),
    },
    { Ctor: FakeRec as unknown as RecCtor, monitor: null, speech },
  )!
  made.push(l)
  l.start()
  /** the person is quiet for a while (the recogniser closes the old phrases) */
  const quiet = (ms = 2000) => vi.advanceTimersByTime(ms)
  /** let a woken utterance end and be handed over */
  const settle = () => vi.advanceTimersByTime(TIMING.normal.initialMs * 2 + STOP_GRACE_MS + 50)
  const restOf = () => finals.map((f) => wakeRest(f[0].transcript))
  return { l, finals, wakes, lost, speech, quiet, settle, restOf }
}

describe('the always-on wake listener', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeRec.all = []
  })
  afterEach(() => {
    for (const l of made.splice(0)) l.abort()
    vi.useRealTimers()
  })

  it.each(['hey aura', 'Hey AURA.', 'aura', 'hey ora', 'Hey Laura', 'hey or a', 'hi aura', 'ok aura', 'hello aura', 'selam aura', 'merhaba aura', 'aura?', 'hey avra', 'ey aura', 'hay aura', 'a aura'])('wakes on the interim result “%s”', (t) => {
    const h = wakeRig()
    h.quiet()
    latest().say(t) // interim only: the recogniser may never make it final
    expect(h.wakes).toEqual(['name'])
  })

  it.each(['hey aura', 'hey ora', 'selam aura', 'hey avra'])('wakes on the final result “%s”', (t) => {
    const h = wakeRig()
    h.quiet()
    latest().say(t, true)
    expect(h.wakes).toEqual(['name'])
  })

  it('wake phrase + command in one breath hands over just the command', () => {
    const h = wakeRig()
    latest().say('the radio is on', true)
    h.quiet()
    latest().say('hey aura how is my')
    latest().say('hey aura how is my blood pressure', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS + 50)
    expect(h.finals).toHaveLength(1)
    expect(h.finals[0][0].transcript).toBe('hey aura how is my blood pressure') // the chatter before is dropped
    expect(h.restOf()).toEqual(['how is my blood pressure'])
  })

  it('after the wake phrase alone it waits the longer first window for the command', () => {
    const h = wakeRig()
    latest().say('hey aura', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + 100) // a normal pause would have ended it here
    expect(h.finals).toHaveLength(0)
    latest().say('open history', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS + 50)
    expect(h.restOf()).toEqual(['open history'])
  })

  it('a plain "hey" on its own wakes it after the pause', () => {
    const h = wakeRig()
    h.quiet()
    latest().say('hey')
    vi.advanceTimersByTime(BARE_HEY.PAUSE_MS - 100)
    expect(h.wakes).toEqual([])
    vi.advanceTimersByTime(200)
    expect(h.wakes).toEqual(['bare'])
    latest().say('what is my pulse', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS + 50)
    expect(h.restOf()).toEqual(['what is my pulse'])
  })

  it('a final "hey" needs only the short confirmation', () => {
    const h = wakeRig()
    h.quiet()
    latest().say('Hey!', true)
    vi.advanceTimersByTime(BARE_HEY.FINAL_PAUSE_MS + 10)
    expect(h.wakes).toEqual(['bare'])
  })

  it('"hey" at the start of a sentence to someone else does not wake it', () => {
    const h = wakeRig()
    h.quiet()
    latest().say('hey') // the recogniser's first interim of a longer sentence
    vi.advanceTimersByTime(250)
    latest().say('hey John are you coming to lunch')
    vi.advanceTimersByTime(BARE_HEY.PAUSE_MS * 3)
    latest().say('hey John are you coming to lunch with us today', true)
    h.quiet(5000)
    expect(h.wakes).toEqual([])
    expect(h.finals).toEqual([])
  })

  it('"hey" in the middle of a conversation (no quiet before it) does not wake it', () => {
    const h = wakeRig()
    h.quiet()
    latest().say('so I told him to wait', true)
    vi.advanceTimersByTime(BARE_HEY.GAP_MS - 300)
    latest().say('hey', true)
    h.quiet(3000)
    expect(h.wakes).toEqual([])
  })

  it('a bare "hey" has a cool-down; "hey AURA" never does', () => {
    const h = wakeRig()
    h.quiet()
    latest().say('hey', true)
    vi.advanceTimersByTime(BARE_HEY.FINAL_PAUSE_MS + 10)
    expect(h.wakes).toEqual(['bare'])
    h.settle() // nothing followed: only the wake phrase is handed over (the agent closes quietly)
    expect(h.restOf()).toEqual([''])
    h.quiet()
    latest().say('hey', true)
    h.quiet()
    expect(h.wakes).toEqual(['bare']) // inside the cool-down
    latest().say('hey aura', true)
    expect(h.wakes).toEqual(['bare', 'name'])
    h.settle()
    vi.advanceTimersByTime(BARE_HEY.COOLDOWN_MS)
    latest().say('hey', true)
    vi.advanceTimersByTime(BARE_HEY.FINAL_PAUSE_MS + 10)
    expect(h.wakes).toEqual(['bare', 'name', 'bare'])
  })

  it('"Wake on: hey AURA and AURA" ignores a plain hey', () => {
    const h = wakeRig({ hey: false })
    h.quiet()
    latest().say('hey', true)
    h.quiet(3000)
    expect(h.wakes).toEqual([])
    latest().say('hey aura', true)
    expect(h.wakes).toEqual(['name'])
  })

  it('is not woken by AURA saying its own name, and really listens again after the tail', () => {
    const h = wakeRig()
    const first = latest()
    h.speech.set(true)
    expect(first.running).toBe(false)
    first.say('say hey aura when you need me', true) // the dropped session's words are ignored
    vi.advanceTimersByTime(3000)
    expect(FakeRec.all).toHaveLength(1)
    h.speech.set(false)
    vi.advanceTimersByTime(h.speech.tail + 300)
    expect(FakeRec.all).toHaveLength(2)
    expect(latest().running).toBe(true)
    expect(h.wakes).toEqual([])
    h.quiet()
    latest().say('hey aura status report', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS + 50)
    expect(h.restOf()).toEqual(['status report'])
    // and again after the reply is spoken
    h.speech.set(true)
    h.speech.set(false)
    vi.advanceTimersByTime(h.speech.tail + 300)
    h.quiet()
    latest().say('aura open history', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS + 50)
    expect(h.restOf()).toEqual(['status report', 'open history'])
  })

  it('keeps going when the browser ends sessions (no-speech, the ~60 s limit), with nothing piling up', () => {
    const h = wakeRig()
    for (let i = 0; i < 20; i++) {
      latest().say(`chatter number ${i}`, true)
      vi.advanceTimersByTime(8000)
      latest().fail('no-speech')
      vi.advanceTimersByTime(WAKE_RETRY.BASE_MS + 20)
      expect(latest().running).toBe(true)
    }
    h.quiet()
    latest().say('hey aura what time is it', true)
    vi.advanceTimersByTime(TIMING.normal.silenceMs + STOP_GRACE_MS + 50)
    expect(h.finals).toHaveLength(1)
    expect(h.finals[0][0].transcript).toBe('hey aura what time is it')
  })

  it('replaces a session that silently died (started, then nothing, never ended)', () => {
    wakeRig()
    const n = FakeRec.all.length
    vi.advanceTimersByTime(WAKE_RETRY.STALE_SESSION_MS + 500)
    expect(FakeRec.all.length).toBe(n + 1)
    expect(latest().running).toBe(true)
  })

  it('steps aside for the consultation dictation and comes back', () => {
    const h = wakeRig()
    const release = pauseWakeListening()
    expect(latest().running).toBe(false)
    vi.advanceTimersByTime(10_000)
    expect(FakeRec.all).toHaveLength(1)
    release()
    vi.advanceTimersByTime(400)
    expect(latest().running).toBe(true)
    h.quiet()
    latest().say('hey aura', true)
    expect(h.wakes).toEqual(['name'])
  })
})

/* ---------- when it runs ---------- */

class FakeListener implements Listener {
  static all: FakeListener[] = []
  started = false
  aborted = false
  mode = 'wake' as const
  constructor(public hooks: WakeHooks) {
    FakeListener.all.push(this)
  }
  start() {
    this.started = true
  }
  finish() {}
  abort() {
    this.aborted = true
  }
  setMode() {}
}
const live = () => FakeListener.all.filter((l) => l.started && !l.aborted)
class MemStore {
  m = new Map<string, string>()
  getItem = (k: string) => this.m.get(k) ?? null
  setItem = (k: string, v: string) => void this.m.set(k, v)
  removeItem = (k: string) => void this.m.delete(k)
}
const ON = { enabled: true, signedIn: true, tour: false, supported: true, visible: true, cmdActive: false, key: 'en' }

describe('when the wake word listens (wake.ts)', () => {
  let ctls: WakeController[] = []
  const make = (store: MemStore | null = new MemStore()) => {
    const c = new WakeController({ make: (h) => new FakeListener(h), storage: store })
    ctls.push(c)
    return c
  }
  beforeEach(() => {
    vi.useFakeTimers()
    FakeListener.all = []
  })
  afterEach(() => {
    for (const c of ctls) c.dispose()
    ctls = []
    vi.useRealTimers()
  })

  it('never opens the microphone before the first deliberate use, even when switched on', () => {
    const c = make()
    c.set(ON)
    vi.advanceTimersByTime(WAKE_HEALTH_MS * 10)
    expect(c.starts).toBe(0)
    expect(c.status()).toBe('unarmed')
    c.arm() // the person tapped the microphone
    expect(live()).toHaveLength(1)
    expect(c.status()).toBe('listening')
  })

  it('is on by default for people who never chose, and a choice is remembered', () => {
    const mem = new MemStore()
    vi.stubGlobal('localStorage', { ...mem, clear: () => mem.m.clear() })
    expect(DEFAULTS.wake).toBe(true)
    expect(loadSettings().wake).toBe(true)
    // the old default was saved with every other change: it no longer switches the wake word off
    localStorage.setItem('aura.voice.v1', JSON.stringify({ wake: false, lang: 'tr-TR' }))
    expect(loadSettings().wake).toBe(true)
    localStorage.setItem('aura.voice.v1', JSON.stringify({ wake: false, wakeSet: true }))
    expect(loadSettings().wake).toBe(false)
    vi.unstubAllGlobals()
  })

  it('the guided tour keeps it off, armed or not', () => {
    const c = make()
    c.arm()
    c.set({ ...ON, tour: true })
    vi.advanceTimersByTime(WAKE_HEALTH_MS * 3)
    expect(c.starts).toBe(0)
    expect(c.status()).toBe('tour')
  })

  it('keeps one listener across panel open/close, page changes and every command', () => {
    const c = make()
    c.set(ON)
    c.arm()
    const first = live()[0]
    // the panel and the route are not inputs at all: re-syncing (any re-render) keeps the same listener
    for (let i = 0; i < 5; i++) c.set({})
    expect(live()).toEqual([first])
    // a command takes the microphone and gives it back, again and again
    for (let i = 0; i < 4; i++) {
      c.set({ cmdActive: true })
      expect(live()).toHaveLength(0)
      expect(c.status()).toBe('paused')
      c.set({ cmdActive: false })
      expect(live()).toHaveLength(1)
    }
    expect(c.status()).toBe('listening')
  })

  it('restarts a listener that ended, through the health check', () => {
    const c = make()
    c.set(ON)
    c.arm()
    live()[0].hooks.end()
    FakeListener.all[0].aborted = true
    vi.advanceTimersByTime(WAKE_HEALTH_MS + 10)
    expect(live()).toHaveLength(1)
    expect(c.starts).toBe(2)
  })

  it('pauses while the tab is hidden and resumes when it is visible again', () => {
    const c = make()
    c.set(ON)
    c.arm()
    c.set({ visible: false })
    expect(live()).toHaveLength(0)
    expect(c.status()).toBe('paused')
    c.set({ visible: true })
    expect(live()).toHaveLength(1)
  })

  it('a refusal disarms it and says why; the next deliberate use tries again', () => {
    const statuses: string[] = []
    const store = new MemStore()
    const c = new WakeController({ make: (h) => new FakeListener(h), storage: store, onStatus: (s, i) => statuses.push(`${s}:${i ?? ''}`) })
    ctls.push(c)
    c.set(ON)
    c.arm()
    live()[0].hooks.error('denied' as RecError)
    expect(live()).toHaveLength(0)
    expect(c.status()).toBe('blocked')
    expect(c.currentIssue()).toBe('denied')
    vi.advanceTimersByTime(WAKE_HEALTH_MS * 5)
    expect(c.starts).toBe(1) // no retry loop against a blocked microphone
    expect(store.getItem('aura.voice.wakeArmed')).toBeNull()
    c.arm()
    expect(live()).toHaveLength(1)
    expect(statuses).toContain('blocked:denied')
    // a dropped connection is reported but it keeps listening
    live()[0].hooks.error('network' as RecError)
    expect(c.status()).toBe('listening')
    expect(c.currentIssue()).toBe('network')
  })

  it('armed survives a reload in the same tab (sessionStorage), not a new tab', () => {
    const store = new MemStore()
    make(store).arm()
    const again = make(store)
    again.set(ON)
    expect(live().length).toBeGreaterThanOrEqual(1)
    expect(again.isArmed()).toBe(true)
    const fresh = make(new MemStore())
    expect(fresh.isArmed()).toBe(false)
  })

  it('a new language or phrase choice restarts it; switching off stops it', () => {
    const c = make()
    c.set(ON)
    c.arm()
    c.set({ key: 'tr' })
    expect(c.starts).toBe(2)
    expect(live()).toHaveLength(1)
    c.set({ enabled: false })
    expect(live()).toHaveLength(0)
    expect(c.status()).toBe('off')
  })
})
