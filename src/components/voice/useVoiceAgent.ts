// The voice agent: listens (tap, push-to-talk or wake word) with its own end-of-utterance timing, scores every
// recogniser alternative, asks when unsure, answers from the existing rule engines or the offline dialogue
// layer (src/lib/assistant), and speaks the reply with natural pacing. All understanding is deterministic.
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { MISSIONS } from '../../data/missions'
import { SYSTEM_BY_ID } from '../../data/systems'
import { STATUS_LABEL, type VitalKey } from '../../data/vitals'
import { chatReply, fallbackReply, loadEnvSnapshot, loadToday, newMemory, readingWhy, understand, resolveClarify, vary, yesterdayText, type ChatIntent, type Choice, type Offer, type Route } from '../../lib/assistant'
import { canReadClinic, loadProfile } from '../../lib/clinic'
import { readingsFromEvaluation } from '../../lib/doctor'
import { evaluate, systemsFor, type Evaluation } from '../../lib/health'
import { useSession } from '../../lib/session'
import { DEV_HOOKS } from '../../lib/devHooks'
import { sfx } from '../../lib/sfx'
import type { Measurement } from '../../lib/types'
import { emitUi, onUi } from '../../lib/uiBus'
import { addressFor, alertsBriefing, readingBriefing, scoreBriefing, statusBriefing } from '../../lib/voice/briefing'
import { consultStep, crisisText, newConsult, type ConsultState } from '../../lib/voice/consult'
import { HOLD_THRESHOLD_MS, TIMING, type Alt } from '../../lib/voice/endpoint'
import { afterWake, BIAS_PHRASES } from '../../lib/voice/fuzzy'
import { describeEntry, hasWake, NAV_LABEL, pathFor, validateValues, type Intent, type NavTarget, type Values } from '../../lib/voice/intents'
import { startMicLevel } from '../../lib/voice/level'
import { announceDataChanged, setPendingSystem } from '../../lib/voice/pending'
import { setVoicePresence } from '../../lib/voice/presence'
import { VoiceControl, type UiCommand, type UiReply } from '../../lib/voicecontrol'
import { domEffects } from '../../lib/voicecontrol/dom'
import { BARE_MIN } from '../../lib/assistant/route'
import { conversational } from '../../lib/voice/prosody'
import { createListener, forceRecognitionUnsupported, recognitionSupported, type Listener, type ListenWindow, type RecError } from '../../lib/voice/recognition'
import { loadSettings, saveSettings, type VoiceSettings } from '../../lib/voice/settings'
import { availableVoices, cancelSpeech, onSpeaking, onVoicesChanged, setRate, setVoicePreference, speak, ttsSupported, type VoiceOption } from '../../lib/voice/speech'

export type Caption = { id: number; who: 'you' | 'aura'; text: string; urgent?: boolean }
export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking'

type PendingLog = { key: VitalKey; values: Values; heard: string }
let seq = 0

export function useVoiceAgent(crewId: number | null) {
  const { user, mission, crew, backend } = useSession()
  const navigate = useNavigate()
  const loc = useLocation()
  const [settings, setSettings] = useState<VoiceSettings>(loadSettings)
  const [open, setOpenState] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [interim, setInterim] = useState('')
  const [captions, setCaptions] = useState<Caption[]>([])
  const [error, setError] = useState<RecError | null>(null)
  /** a hint that replaces an error the person could not have avoided (the browser refused a gesture-started listen) */
  const [notice, setNotice] = useState<string | null>(null)
  /** the current listen was started by a hand gesture (no user activation: the browser may refuse the microphone) */
  const gestureListen = useRef(false)
  const [recOk, setRecOk] = useState(() => recognitionSupported())
  const [win, setWin] = useState<ListenWindow | null>(null)
  const [voices, setVoices] = useState<VoiceOption[]>(() => availableVoices())

  const live = useRef({ user, mission, crew, backend, crewId, path: loc.pathname, settings, open })
  live.current = { user, mission, crew, backend, crewId, path: loc.pathname, settings, open }
  const fns = useRef({} as Record<string, (...a: never[]) => unknown>)
  const rec = useRef<Listener | null>(null)
  const recMode = useRef<'cmd' | 'wake' | null>(null)
  const recSeq = useRef(0)
  const pressAt = useRef(0)
  const speakingRef = useRef(false)
  const spokeUntil = useRef(0)
  const lastReply = useRef('')
  const pendingLog = useRef<PendingLog | null>(null)
  const clarifyQ = useRef<Choice[] | null>(null)
  const consult = useRef<ConsultState | null>(null)
  const consultOpen = useRef(false)
  const autoClose = useRef(false)
  const mem = useRef(newMemory())
  /** voice control of the page (press by name, numbers, scrolling, dictation) */
  const vcRef = useRef<VoiceControl | null>(null)
  const vc = () => (vcRef.current ??= new VoiceControl(domEffects))
  const pageNames = (): string[] => {
    try {
      return vc().names()
    } catch {
      return []
    }
  }

  /* ---------- speaking ---------- */

  useEffect(() => {
    setRate(settings.rate)
  }, [settings.rate])
  useEffect(() => {
    setVoicePreference(settings.voice)
  }, [settings.voice])
  useEffect(() => onVoicesChanged(() => setVoices(availableVoices())), [])
  useEffect(() => {
    onSpeaking((s) => {
      speakingRef.current = s
      if (!s) spokeUntil.current = Date.now()
      setSpeaking(s)
    })
    return () => onSpeaking(null)
  }, [])

  const say = (text: string, o: { urgent?: boolean; expectReply?: boolean; slower?: boolean } = {}) => {
    // conversational wording for everyday replies; urgent text stays exactly as the engine wrote it
    const shown = o.urgent ? text : conversational(text)
    lastReply.current = shown
    setCaptions((c) => [...c.slice(-5), { id: ++seq, who: 'aura', text: shown, urgent: o.urgent }])
    if (o.urgent) sfx('alarm')
    if (live.current.settings.speak) {
      speak(shown, {
        priority: o.urgent ? 'urgent' : 'normal',
        slower: o.slower ? 0.8 : undefined,
        onEnd: () => {
          if (o.expectReply) (fns.current.afterQuestion as () => void)()
          else if (autoClose.current) setTimeout(() => autoClose.current && !speakingRef.current && setOpen(false), 5000)
        },
      })
    }
  }

  /* ---------- data ---------- */

  const loadRows = async (): Promise<Measurement[]> => {
    const { backend: b, crewId: id } = live.current
    if (!b || id == null) return []
    return b.measurements(id)
  }
  const evOf = (rows: Measurement[]): Evaluation | null => {
    const { mission: m, user: u } = live.current
    return rows.length && m ? evaluate(rows, m, u?.role === 'ground') : null
  }
  const loadEv = async (): Promise<Evaluation | null> => evOf(await loadRows())

  /* ---------- the brain ---------- */

  const handle = async (input: string | Alt[], o: { typed?: boolean } = {}) => {
    const alts = typeof input === 'string' ? [{ transcript: input.trim(), confidence: 1 }] : input.filter((a) => a.transcript.trim())
    if (!alts.length) return
    setThinking(true)
    setCaptions((c) => [...c.slice(-5), { id: ++seq, who: 'you', text: alts[0].transcript }])
    try {
      await respond(alts, !!o.typed)
    } catch {
      say('Something went wrong while I was working on that. Please try again.')
    } finally {
      setThinking(false)
    }
  }

  const respond = async (alts: Alt[], typed: boolean) => {
    const { user: u, settings: s } = live.current
    if (!u) return say('Please sign in first.')
    const m = mem.current
    m.turn++
    const und = understand(alts, { lang: s.lang, typed, names: pageNames() })
    const r = und.route
    const lang = und.lang === 'tr' ? 'tr-TR' : 'en-US'
    const ans = r.kind === 'voice' && r.intent.type === 'answer' ? r.intent.answer : null

    // a page command is waiting: which of several (a number), or yes / no for a destructive press or a submit
    if (vc().hasPending()) {
      const reply = vc().answer(r.kind === 'ui' ? r.cmd : null, ans ?? (r.kind === 'voice' && r.intent.type === 'stop' ? 'no' : null))
      if (reply) return sayUi(reply)
    }
    // a spoken confirmation is pending: yes saves, anything else drops it
    if (pendingLog.current) {
      const p = pendingLog.current
      pendingLog.current = null
      if (ans === 'yes') return commitLog(p)
      if (ans || (r.kind === 'voice' && r.intent.type === 'stop')) return say('Cancelled. Nothing was saved.')
    }
    // a clarifying question is pending
    if (clarifyQ.current) {
      const options = clarifyQ.current
      clarifyQ.current = null
      const k = resolveClarify(und.heard, options, lang)
      if (k === 'no') return say(vary(['Okay, never mind. What would you like?', 'No problem. Say it again in other words?'], m.turn, 'clar-no'))
      if (typeof k === 'number') return act(options[k].route, und.heard)
    }
    // something was offered ("Shall I log your mood as good?")
    if (m.offer && ans) {
      const off = m.offer
      m.offer = null
      if (ans === 'yes') return runOffer(off)
      return say(vary(['Okay.', 'No problem.', 'Alright.'], m.turn, 'offer-no'))
    }
    m.offer = null
    // a consultation is open: answers go to it; unmatched text and feelings are taken as more symptoms
    if (consultOpen.current) {
      if (ans) return runConsult({ answer: ans })
      if (r.kind === 'unknown' || (r.kind === 'chat' && r.chat.type === 'feeling') || r.kind === 'clarify') return runConsult({ text: und.heard })
    }
    return act(r, und.heard)
  }

  const act = async (r: Route, heard: string): Promise<void> => {
    switch (r.kind) {
      case 'crisis':
        return runCrisis(heard)
      case 'clarify':
        clarifyQ.current = r.options
        return say(r.question, { expectReply: true })
      case 'chat':
        return runChat(r.chat)
      case 'voice':
        return runIntent(r.intent, heard)
      case 'ui':
        return runUi(r.cmd)
      default:
        mem.current.lastTopic = null
        return say(fallbackReply(mem.current))
    }
  }

  const who = () => {
    const { user: u, crew: members, crewId: id } = live.current
    const subjectMember = id != null && u && u.crewId !== id ? members.find((c) => c.id === id) : undefined
    const address = mem.current.name ?? addressFor(u, members.find((c) => c.id === (u?.crewId ?? id)))
    return { subject: subjectMember?.name ?? null, address }
  }

  /** Speak a page-control reply with its interface sound. */
  const sayUi = (reply: UiReply) => {
    if (reply.sfx) sfx(reply.sfx)
    mem.current.lastTopic = 'page'
    say(reply.say, { expectReply: reply.expectReply })
  }

  const runUi = async (cmd: UiCommand): Promise<void> => {
    let reply: UiReply
    try {
      reply = vc().run(cmd)
    } catch {
      reply = { say: 'I could not do that on this page.', sfx: 'warn' }
    }
    sayUi(reply)
  }

  const runIntent = async (intent: Intent, heard = ''): Promise<void> => {
    const { user: u, mission: m, crewId: id } = live.current
    if (!u) return
    const { subject, address } = who()
    const hour = new Date().getHours()
    const M = mem.current
    switch (intent.type) {
      case 'status': {
        const ev = await loadEv()
        M.lastTopic = 'status'
        M.why = 'Each reading is compared with fixed ranges from the app’s sources. Anything outside its range is listed, urgent items first.'
        M.more = alertsBriefing(ev)
        return say(statusBriefing(ev, { address, hour, subject }))
      }
      case 'reading': {
        const ev = await loadEv()
        const hidden = intent.key === 'mood' && u.role === 'ground'
        M.lastTopic = intent.key
        M.lastReading = hidden ? null : intent.key
        M.why = hidden ? null : readingWhy(intent.key)
        const alert = ev?.alerts.find((a) => a.key === intent.key)
        M.more = alert?.detail ? `Suggested step: ${alert.detail} Say “open history” to see the trend.` : 'Say “open history” to see the trend, or “and yesterday?” for yesterday’s value.'
        return say(readingBriefing(ev, intent.key, { subject, hidden }))
      }
      case 'alerts':
        M.lastTopic = 'alerts'
        M.why = 'Alerts come from fixed rules on your latest readings, not from AI.'
        M.more = null
        return say(alertsBriefing(await loadEv()))
      case 'score': {
        const ev = await loadEv()
        M.lastTopic = 'score'
        M.why = 'It starts at one hundred and loses fixed points for every reading outside its range.'
        M.more = null
        return say(scoreBriefing(ev))
      }
      case 'system': {
        const ev = await loadEv()
        const ctx = m?.context ?? u.context
        if (intent.system && !systemsFor(ctx).some((x) => x.id === intent.system)) return say('That body system is not tracked in this profile.')
        const onPage = /^\/crew\/\d+(\/diagnostics)?\/?$/.test(live.current.path)
        if (!onPage) {
          const to = pathFor('diagnostics', u.role, id) ?? pathFor('overview', u.role, id)
          if (!to) return say('There is no body view available here.')
          setPendingSystem(intent.system)
          navigate(to)
        } else emitUi('select-system', { system: intent.system, source: 'voice' })
        sfx('select')
        M.lastTopic = intent.system ?? 'body'
        if (!intent.system) return say('Showing the whole body.')
        const sys = SYSTEM_BY_ID[intent.system]
        const measured = ev?.systemMeasured[intent.system]
        return say(`${sys.name}. ${measured && ev ? `Status: ${STATUS_LABEL[ev.systemStatus[intent.system]].toLowerCase()}.` : 'There are no readings for this system yet.'}`)
      }
      case 'nav':
        return goTo(intent.target)
      case 'log':
        return startLog(intent.key, intent.values, intent.mode)
      case 'logIncomplete':
        return say('I need both blood pressure numbers, for example “128 over 82”.')
      case 'logUnsupported':
        return say('I can log blood pressure, heart rate, oxygen, temperature, blood sugar, sleep, water, mood and exercise by voice. For anything else, use the manual entry on the Overview.')
      case 'consult':
        return runConsult({ text: intent.text })
      case 'answer':
        // nothing is pending: a word like “kaydet” or “tamam” may be the name of a button on screen
        if (heard && vc().bareScore(heard) >= BARE_MIN) return runUi({ kind: 'press', target: heard, bare: true })
        return say(intent.answer === 'no' ? 'Understood.' : 'There is nothing waiting for an answer.')
      case 'repeat':
        return say(lastReply.current || 'I have not said anything yet.')
      case 'stop':
        cancelSpeech()
        autoClose.current = false
        return
      case 'help':
        return runChat({ type: 'capabilities' })
      case 'close':
        // a dialog, sheet or menu is open: “close” means that, not the voice panel
        if (vc().overlayOpen()) return runUi({ kind: 'closeOverlay' })
        say(vary(['Standing by.', 'I’ll be here.', 'Standing by. Say “hey AURA” or press Alt V when you need me.'], M.turn, 'close'))
        return void setTimeout(() => setOpen(false), 900)
      case 'greet':
        return runChat({ type: 'hello', wake: intent.wake })
      default:
        return say(fallbackReply(M))
    }
  }

  const goTo = (target: NavTarget) => {
    const { user: u, crewId: id } = live.current
    const to = pathFor(target, u?.role, id)
    if (!to) return say('That page is not available for your role.')
    navigate(to)
    sfx('open')
    mem.current.lastTopic = target
    return say(`${vary(['Opening', 'Here’s', 'Bringing up'], mem.current.turn, 'nav')} ${NAV_LABEL[target]}.`)
  }

  const runChat = async (chat: ChatIntent): Promise<void> => {
    const { user: u, mission: m, crewId: id, backend: b } = live.current
    const M = mem.current
    if (chat.type === 'setName') M.name = chat.name
    const { subject, address } = who()
    let env = undefined
    let today = undefined
    let yesterday: string | null = null
    if (chat.type === 'weather' || chat.type === 'cabin') env = await loadEnvSnapshot(u)
    if (chat.type === 'today') {
      const rows = await loadRows()
      today = await loadToday({ user: u, crewId: id, mission: m, backend: b, rows, ev: evOf(rows) })
    }
    if (chat.type === 'yesterday' && M.lastReading && m) yesterday = yesterdayText(await loadRows(), M.lastReading, m.day, subject)
    const ctx = m?.context ?? u?.context ?? 'space'
    const reply = chatReply(
      chat,
      {
        now: new Date(),
        address,
        role: u?.role ?? null,
        context: ctx,
        mission: m ? { day: m.day, totalDays: m.totalDays, profileId: m.profileId, name: MISSIONS.find((x) => x.id === m.profileId)?.name ?? m.name } : null,
        env,
        today,
        yesterday,
      },
      M,
      lastReply.current,
    )
    M.offer = reply.offer ?? null
    if (!['why', 'more', 'yesterday', 'slower'].includes(chat.type)) {
      M.lastTopic = reply.topic ?? chat.type
      M.why = reply.why ?? null
      M.more = reply.more ?? null
    }
    say(reply.say, { slower: reply.slower, expectReply: !!reply.offer })
    if (reply.close) setTimeout(() => setOpen(false), 2500)
  }

  const runOffer = async (off: Offer): Promise<void> => {
    if (off.kind === 'logMood') return startLog('mood', { mood: off.value }, 'set')
    if (off.kind === 'consult') return runConsult({})
    if (off.kind === 'nav') return goTo(off.target)
    return runChat({ type: 'joke' })
  }

  const startLog = async (key: VitalKey, values: Values, mode: 'add' | 'set') => {
    const { user: u, mission: m, crewId: id } = live.current
    const own = (u?.role === 'astronaut' || u?.role === 'member') && u.crewId === id
    if (!own) return say('Logging by voice is only available for your own record.')
    const field = key === 'water' ? 'water' : key === 'exercise' ? 'exercise' : null
    if (field && mode === 'add') {
      // water and exercise add to today's total; the read-back says both numbers
      const ev = await loadEv()
      const meta = ev?.meta[field]
      const prev = meta && m && meta.day === m.day ? meta.value : 0
      const total = Math.round((prev + (values[field] ?? 0)) * 100) / 100
      const final = { [field]: total } as Values
      const bad = validateValues(final)
      if (bad) return say(bad)
      pendingLog.current = { key, values: final, heard: describeEntry(key, values, prev) }
    } else {
      const bad = validateValues(values)
      if (bad) return say(bad)
      pendingLog.current = { key, values, heard: describeEntry(key, values) }
    }
    say(`I heard ${pendingLog.current.heard}. Shall I save it? Say yes to confirm, or no to cancel.`, { expectReply: true })
  }

  const commitLog = async (p: PendingLog) => {
    const { backend: b, crewId: id, user: u } = live.current
    if (!b || id == null) return say('I could not save that.')
    try {
      await b.addMeasurements(id, p.values, 'manual', 'Voice entry')
    } catch {
      return say('I could not save that. Nothing was changed.')
    }
    announceDataChanged()
    sfx('confirm')
    const ev = await loadEv()
    mem.current.lastReading = p.key
    mem.current.lastTopic = p.key
    say(`${vary(['Saved.', 'Done, saved.', 'Logged.'], mem.current.turn, 'saved')} ${readingBriefing(ev, p.key, { hidden: p.key === 'mood' && u?.role === 'ground' })}`)
  }

  const consultCtx = async () => {
    const { user: u, mission: m, crewId: id } = live.current
    const ev = await loadEv()
    const ctx = ev?.context ?? m?.context ?? u?.context ?? 'space'
    let profile = null
    try {
      profile = id != null && canReadClinic(u, id) ? await loadProfile(u, id) : null
    } catch {
      profile = null
    }
    const delaySec = ctx === 'space' ? (MISSIONS.find((x) => x.id === m?.profileId)?.delaySec ?? 0) : 0
    return { context: ctx, readings: readingsFromEvaluation(ev), profile, delaySec }
  }

  /** Words of suicide or self-harm: the consultation engine's urgent plan, for every role, at urgent priority. */
  const runCrisis = async (heard: string) => {
    consult.current = null
    consultOpen.current = false
    const c = await consultCtx()
    // the engine confirms the emergency (self-harm is an emergency rule); the spoken text is its first step
    const step = consultStep(newConsult(), c, { text: `self-harm. ${heard}` })
    say(step.emergency ? crisisText(c) : `${crisisText(c)} ${step.say}`, { urgent: true })
  }

  const runConsult = async (input: { text?: string; answer?: 'yes' | 'no' | 'unsure' }) => {
    const { user: u, crewId: id } = live.current
    if (id == null || !canReadClinic(u, id)) return say('Consultations are private to the person and their flight surgeon, so they are not available for your role.')
    const state = consult.current ?? newConsult()
    if (!input.text && !input.answer) {
      consult.current = newConsult()
      consultOpen.current = true
      return say('Tell me what is bothering you, in your own words.', { expectReply: true })
    }
    const step = consultStep(state, await consultCtx(), input)
    consult.current = step.state.done ? null : step.state
    consultOpen.current = !step.state.done
    mem.current.lastTopic = 'consult'
    say(step.say, { urgent: step.emergency, expectReply: consultOpen.current })
  }

  /* ---------- listening ---------- */

  const stopRec = () => {
    recSeq.current++
    rec.current?.abort()
    rec.current = null
    recMode.current = null
    setListening(false)
    setInterim('')
    setWin(null)
  }

  /** Listen for one command. auto = ends after the silence window; hold = push-to-talk, ends on release. */
  const startListen = (mode: 'auto' | 'hold' = 'auto', source: 'hand' | 'key' | 'page' = 'key') => {
    const s = live.current.settings
    cancelSpeech()
    stopRec()
    setError(null)
    setNotice(null)
    gestureListen.current = source === 'hand'
    const my = recSeq.current
    const cur = () => my === recSeq.current
    const l = createListener({
      lang: s.lang,
      mode,
      timing: TIMING[s.listen],
      phrases: BIAS_PHRASES,
      onStart: () => cur() && sfx('listen'),
      onInterim: (t) => cur() && setInterim(t),
      onWindow: (w) => cur() && setWin(w.deadline || w.mode === 'hold' ? w : null),
      onFinal: (alts) => {
        if (!cur()) return
        setInterim('')
        sfx('done')
        void handle(alts)
      },
      onError: (e) => {
        if (!cur()) return
        if (e === 'denied' && gestureListen.current) {
          // started by a hand gesture: the browser wants a tap (user activation) before it opens the microphone
          setNotice(live.current.settings.wake ? 'To listen, the browser needs a tap first. Tap the microphone below, press Space, or say “hey AURA”. You can also type.' : 'To listen, the browser needs a tap first. Tap the microphone below or press Space. You can also type.')
          return
        }
        setError(e)
      },
      onEnd: () => {
        if (!cur()) return
        rec.current = null
        recMode.current = null
        setListening(false)
        setInterim('')
        setWin(null)
        ;(fns.current.startWake as () => void)()
      },
    })
    if (!l) {
      setError('unsupported')
      setOpen(true)
      return
    }
    rec.current = l
    recMode.current = 'cmd'
    setOpen(true)
    setListening(true)
    if (mode === 'hold') setWin({ deadline: null, total: 0, heard: false, mode: 'hold' })
    l.start()
  }

  /** Space or the mic button went down: push-to-talk until release; a quick tap becomes a normal (auto) listen. */
  const pressStart = () => {
    if (recMode.current === 'cmd' && rec.current) {
      rec.current.finish('tap') // pressing again while listening = "I'm done"
      pressAt.current = 0
      return
    }
    pressAt.current = Date.now()
    startListen('hold')
  }
  const pressEnd = () => {
    if (!pressAt.current || recMode.current !== 'cmd' || !rec.current) return
    const held = Date.now() - pressAt.current
    pressAt.current = 0
    if (rec.current.mode !== 'hold') return
    if (held < HOLD_THRESHOLD_MS) {
      rec.current.setMode('auto')
      setWin(null)
    } else rec.current.finish('release')
  }

  const finishListening = () => {
    if (recMode.current === 'cmd') rec.current?.finish('tap')
  }

  const startWake = () => {
    const s = live.current.settings
    if (!s.wake || !live.current.user || recMode.current || !recognitionSupported()) return
    const my = ++recSeq.current
    const cur = () => my === recSeq.current
    const l = createListener({
      lang: s.lang,
      mode: 'wake',
      timing: TIMING[s.listen],
      phrases: BIAS_PHRASES,
      wakeTest: (t) => afterWake(t) !== null,
      onInterim: (t) => {
        if (!cur()) return
        const rest = afterWake(t)
        if (rest === null) return
        // barge-in: the person said the wake word while AURA was talking (unless AURA itself is saying its name)
        if (speakingRef.current && hasWake(t) && !/aura/i.test(lastReply.current)) cancelSpeech()
        if (!speakingRef.current) {
          setOpenState(true)
          setInterim(rest)
        }
      },
      onWindow: (w) => cur() && setWin(w.deadline ? w : null),
      onFinal: (alts) => {
        if (!cur()) return
        setInterim('')
        if (speakingRef.current || Date.now() - spokeUntil.current < 500) return // AURA's own voice
        const rests = alts.map((a) => ({ transcript: afterWake(a.transcript) ?? '', confidence: a.confidence })).filter((a) => a.transcript)
        setOpenState(true)
        if (rests.length) {
          sfx('done')
          void handle(rests)
        } else {
          sfx('listen')
          setCaptions((c) => [...c.slice(-5), { id: ++seq, who: 'you', text: alts[0].transcript }])
          say(vary(['Yes?', 'I’m listening.', 'Go ahead.'], mem.current.turn++, 'wake'), { expectReply: true })
        }
      },
      onError: (e) => {
        if (!cur()) return
        setError(e)
        if (e === 'denied' || e === 'no-mic' || e === 'unsupported') update({ wake: false })
      },
      onEnd: () => {
        if (cur() && recMode.current === 'wake') {
          rec.current = null
          recMode.current = null
        }
      },
    })
    if (!l) return
    rec.current = l
    recMode.current = 'wake'
    l.start()
  }

  /** AURA asked something: listen for the answer (the wake listener steps aside and comes back afterwards). */
  const afterQuestion = () => {
    if (!live.current.open || !recognitionSupported() || !live.current.settings.speak) return
    if (recMode.current === 'cmd') return
    startListen('auto')
  }

  const setOpen = (on: boolean) => {
    setOpenState(on)
    if (!on) {
      setNotice(null)
      cancelSpeech()
      autoClose.current = false
      if (recMode.current === 'cmd') {
        stopRec()
        ;(fns.current.startWake as () => void)()
      }
      pendingLog.current = null
      clarifyQ.current = null
      mem.current.offer = null
    }
  }

  const update = (patch: Partial<VoiceSettings>) => {
    setSettings((cur) => {
      const next = { ...cur, ...patch }
      saveSettings(next)
      return next
    })
  }

  fns.current = { startWake, afterQuestion }

  /* ---------- effects ---------- */

  // wake-word listening follows the setting (and restarts when the language or listening time changes)
  useEffect(() => {
    if (recMode.current === 'wake') stopRec()
    if (settings.wake && user) startWake()
    return () => {
      if (recMode.current === 'wake') stopRec()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wake, settings.lang, settings.listen, user?.id])

  useEffect(() => {
    emitUi('hud', { on: open, source: 'voice' })
    emitUi('voice-state', { open })
  }, [open])

  // other features (hand gestures, pages) can open or close the panel and start listening
  useEffect(
    () =>
      onUi('voice', (d) => {
        if (!live.current.user) return
        const isOpen = live.current.open
        const action = d.action === 'toggle' ? (isOpen ? 'close' : 'open') : d.action
        if (action === 'close') {
          if (isOpen) setOpen(false)
          return
        }
        if (d.listen && recognitionSupported()) {
          // already listening for a command: nothing to do
          if (isOpen && recMode.current === 'cmd') return
          startListen('auto', d.source)
        } else setOpenState(true)
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // other features can ask AURA to speak
  useEffect(
    () =>
      onUi('say', (d) => {
        if (!live.current.settings.speak) return
        if (!live.current.open) {
          autoClose.current = true
          setOpenState(true)
        }
        say(d.text, { urgent: d.priority === 'urgent' })
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // the voice always follows the person who signs out
  useEffect(() => {
    if (!user) {
      cancelSpeech()
      stopRec()
      setOpenState(false)
      setCaptions([])
      consult.current = null
      consultOpen.current = false
      pendingLog.current = null
      clarifyQ.current = null
      mem.current = newMemory()
      vcRef.current?.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // leaving the page (closing the tab, navigating away, bfcache): stop listening and release the microphone, the
  // wake word included; speech itself is cancelled by the guard in lib/voice/speech.ts. Back from the bfcache, the
  // wake word resumes if it is switched on.
  useEffect(() => {
    const hide = () => {
      cancelSpeech()
      stopRec()
    }
    const show = (e: PageTransitionEvent) => {
      if (e.persisted && live.current.settings.wake && live.current.user) (fns.current.startWake as () => void)()
    }
    window.addEventListener('pagehide', hide)
    window.addEventListener('pageshow', show)
    return () => {
      window.removeEventListener('pagehide', hide)
      window.removeEventListener('pageshow', show)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keyboard: Alt+V opens or closes AURA voice; with it open, hold Space to talk (tap Space = listen until you pause); Escape closes
  useEffect(() => {
    const editable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null
      return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(el.tagName) || el.getAttribute('role') === 'button')
    }
    const down = (e: KeyboardEvent) => {
      if (!live.current.user) return
      if (e.altKey && e.code === 'KeyV') {
        e.preventDefault()
        if (live.current.open) setOpen(false)
        else startListen('auto')
      } else if (e.code === 'Escape' && live.current.open) setOpen(false)
      else if (e.code === 'Space' && live.current.open && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !editable(e.target)) {
        e.preventDefault()
        pressStart()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') pressEnd()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // development only: drive the pipeline without a microphone or speech engine
  useEffect(() => {
    if (!DEV_HOOKS) return
    const w = window as unknown as { __auraVoice?: unknown }
    const toAlts = (xs: (string | Alt)[]): Alt[] => xs.map((x, i) => (typeof x === 'string' ? { transcript: x, confidence: i === 0 ? 0.9 : 0.6 - i * 0.05 } : x))
    w.__auraVoice = {
      /** as if this was heard (confident) */
      hear: async (t: string) => {
        setOpenState(true)
        await handle([{ transcript: t, confidence: 0.92 }])
        return lastReply.current
      },
      /** as if typed */
      type: async (t: string) => {
        setOpenState(true)
        await handle(t, { typed: true })
        return lastReply.current
      },
      /** as if the recogniser returned these alternatives (best first); strings get descending confidence */
      hearAlts: async (alts: (string | Alt)[]) => {
        setOpenState(true)
        await handle(toAlts(alts))
        return lastReply.current
      },
      /** a low-confidence recognition of `t` */
      lowConfidence: async (t: string, confidence = 0.3) => {
        setOpenState(true)
        await handle([{ transcript: t, confidence }])
        return lastReply.current
      },
      /** what AURA would understand from these alternatives, without acting */
      understand: (alts: (string | Alt)[]) => understand(toAlts(alts), { lang: live.current.settings.lang }),
      memory: () => ({ ...mem.current }),
      voices: () => availableVoices(),
      open: () => setOpenState(true),
      close: () => setOpen(false),
      /** pretend the recogniser is listening (screenshots): remainMs of totalMs silence left, or hold = push-to-talk */
      fake: (phase: 'listening' | 'idle', text = '', o: { remainMs?: number; totalMs?: number; hold?: boolean } = {}) => {
        setOpenState(true)
        setError(null)
        setListening(phase === 'listening')
        setInterim(text)
        if (phase !== 'listening') return setWin(null)
        if (o.hold) return setWin({ deadline: null, total: 0, heard: !!text, mode: 'hold' })
        const total = o.totalMs ?? TIMING[live.current.settings.listen].silenceMs
        setWin({ deadline: Date.now() + (o.remainMs ?? total), total, heard: !!text, mode: 'auto' })
      },
      noRecognition: (off: boolean) => {
        forceRecognitionUnsupported(off)
        setRecOk(recognitionSupported())
        if (off) setError('unsupported')
      },
      reply: () => lastReply.current,
      /** the control names voice control sees on this page */
      controls: () => pageNames(),
    }
    return () => {
      delete w.__auraVoice
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const phase: Phase = thinking ? 'thinking' : listening ? 'listening' : speaking ? 'speaking' : 'idle'
  const urgent = captions.length > 0 && captions[captions.length - 1].urgent === true
  const lastAura = [...captions].reverse().find((c) => c.who === 'aura')?.text ?? ''

  // the voice state for visual hosts (the 3D AURA core): every change, plus the microphone level while listening
  useEffect(() => {
    setVoicePresence({ available: recOk || ttsSupported(), open, phase, urgent, interim, caption: lastAura })
  }, [recOk, open, phase, urgent, interim, lastAura])
  useEffect(() => (phase === 'listening' ? startMicLevel() : undefined), [phase])
  // another page: numbered badges and a waiting "which one?" belong to the old one
  useEffect(() => {
    vcRef.current?.reset()
  }, [loc.pathname])

  return {
    phase,
    open,
    setOpen,
    toggle: () => (open ? setOpen(false) : startListen('auto')),
    startPtt: () => startListen('auto'),
    stopPtt: finishListening,
    pressStart,
    pressEnd,
    finishListening,
    window: win,
    submit: (t: string) => void handle(t, { typed: true }),
    settings,
    update,
    voices,
    /** Say a short sample with this voice (null = the automatic choice). */
    previewVoice: (uri: string | null) => {
      setVoicePreference(uri)
      cancelSpeech()
      speak(vary(['Hello. I’m AURA. This is how I sound.', 'Voice check. Blood pressure, 128/82 mmHg. Within range.', 'Hi there. Ready when you are.'], mem.current.turn++, 'preview'))
    },
    captions,
    interim,
    error,
    notice,
    urgent,
    recOk: recOk && recognitionSupported(),
    ttsOk: ttsSupported(),
    clearError: () => setError(null),
  }
}
