// The voice agent: listens (push-to-talk or wake word), parses the utterance into an intent, answers from the
// existing rule engines and speaks the reply. All understanding is deterministic; nothing here is medical.
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { MISSIONS } from '../../data/missions'
import { SYSTEM_BY_ID } from '../../data/systems'
import { STATUS_LABEL } from '../../data/vitals'
import { canReadClinic, loadProfile } from '../../lib/clinic'
import { readingsFromEvaluation } from '../../lib/doctor'
import { evaluate, systemsFor, type Evaluation } from '../../lib/health'
import { useSession } from '../../lib/session'
import { sfx } from '../../lib/sfx'
import { emitUi, onUi } from '../../lib/uiBus'
import { addressFor, alertsBriefing, HELP_TEXT, readingBriefing, scoreBriefing, statusBriefing, UNKNOWN_TEXT } from '../../lib/voice/briefing'
import { consultStep, newConsult, type ConsultState } from '../../lib/voice/consult'
import { describeEntry, hasWake, NAV_LABEL, parseIntent, pathFor, stripWake, validateValues, type Intent, type Values } from '../../lib/voice/intents'
import { announceDataChanged, setPendingSystem } from '../../lib/voice/pending'
import { createRecognizer, forceRecognitionUnsupported, recognitionSupported, type RecError, type Recognizer } from '../../lib/voice/recognition'
import { loadSettings, saveSettings, type VoiceSettings } from '../../lib/voice/settings'
import { cancelSpeech, onSpeaking, setRate, speak, ttsSupported } from '../../lib/voice/speech'
import type { VitalKey } from '../../data/vitals'

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
  const [recOk, setRecOk] = useState(() => recognitionSupported())

  const live = useRef({ user, mission, crew, backend, crewId, path: loc.pathname, settings, open })
  live.current = { user, mission, crew, backend, crewId, path: loc.pathname, settings, open }
  const fns = useRef({} as Record<string, (...a: never[]) => unknown>)
  const rec = useRef<Recognizer | null>(null)
  const recMode = useRef<'ptt' | 'wake' | null>(null)
  const recSeq = useRef(0)
  const armedUntil = useRef(0)
  const speakingRef = useRef(false)
  const lastReply = useRef('')
  const pendingLog = useRef<PendingLog | null>(null)
  const consult = useRef<ConsultState | null>(null)
  const consultOpen = useRef(false)
  const autoClose = useRef(false)

  /* ---------- speaking ---------- */

  useEffect(() => {
    setRate(settings.rate)
  }, [settings.rate])
  useEffect(() => {
    onSpeaking((s) => {
      speakingRef.current = s
      setSpeaking(s)
    })
    return () => onSpeaking(null)
  }, [])

  const say = (text: string, o: { urgent?: boolean; expectReply?: boolean } = {}) => {
    lastReply.current = text
    setCaptions((c) => [...c.slice(-5), { id: ++seq, who: 'aura', text, urgent: o.urgent }])
    if (o.urgent) sfx('alarm')
    if (live.current.settings.speak) {
      speak(text, {
        priority: o.urgent ? 'urgent' : 'normal',
        onEnd: () => {
          if (o.expectReply) (fns.current.afterQuestion as () => void)()
          else if (autoClose.current) setTimeout(() => autoClose.current && !speakingRef.current && setOpen(false), 5000)
        },
      })
    }
  }

  /* ---------- data ---------- */

  const loadEv = async (): Promise<Evaluation | null> => {
    const { backend: b, mission: m, user: u, crewId: id } = live.current
    if (!b || !m || id == null) return null
    const rows = await b.measurements(id)
    return rows.length ? evaluate(rows, m, u?.role === 'ground') : null
  }

  /* ---------- the brain ---------- */

  const handle = async (text: string) => {
    const t = text.trim()
    if (!t) return
    setThinking(true)
    setCaptions((c) => [...c.slice(-5), { id: ++seq, who: 'you', text: t }])
    try {
      await respond(t)
    } catch {
      say('Something went wrong while I was working on that. Please try again.')
    } finally {
      setThinking(false)
    }
  }

  const respond = async (t: string) => {
    const { user: u, crew: members, mission: m, crewId: id, settings: s } = live.current
    if (!u) return say('Please sign in first.')
    let intent: Intent = parseIntent(t, { lang: s.lang })
    const subjectMember = id != null && u.crewId !== id ? members.find((c) => c.id === id) : undefined
    const subject = subjectMember?.name ?? null
    const address = addressFor(u, members.find((c) => c.id === (u.crewId ?? id)))
    const hour = new Date().getHours()

    // a spoken confirmation is pending: yes saves, anything else drops it
    if (pendingLog.current) {
      const p = pendingLog.current
      pendingLog.current = null
      if (intent.type === 'answer' && intent.answer === 'yes') return commitLog(p)
      if (intent.type === 'answer' || intent.type === 'stop') return say('Cancelled. Nothing was saved.')
    }
    // a consultation is open: yes / no / not sure answer the question; unmatched text is taken as more symptoms
    if (consultOpen.current) {
      if (intent.type === 'answer') return runConsult({ answer: intent.answer === 'unsure' ? 'unsure' : intent.answer })
      if (intent.type === 'unknown') intent = { type: 'consult', text: stripWake(t).rest }
    }

    switch (intent.type) {
      case 'status': {
        const ev = await loadEv()
        return say(statusBriefing(ev, { address, hour, subject }))
      }
      case 'reading': {
        const ev = await loadEv()
        return say(readingBriefing(ev, intent.key, { subject, hidden: intent.key === 'mood' && u.role === 'ground' }))
      }
      case 'alerts':
        return say(alertsBriefing(await loadEv()))
      case 'score':
        return say(scoreBriefing(await loadEv()))
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
        if (!intent.system) return say('Showing the whole body.')
        const sys = SYSTEM_BY_ID[intent.system]
        const measured = ev?.systemMeasured[intent.system]
        return say(`${sys.name}. ${measured && ev ? `Status: ${STATUS_LABEL[ev.systemStatus[intent.system]].toLowerCase()}.` : 'There are no readings for this system yet.'}`)
      }
      case 'nav': {
        const to = pathFor(intent.target, u.role, id)
        if (!to) return say('That page is not available for your role.')
        navigate(to)
        sfx('open')
        return say(`Opening ${NAV_LABEL[intent.target]}.`)
      }
      case 'log':
        return startLog(intent.key, intent.values, intent.mode)
      case 'logIncomplete':
        return say('I need both blood pressure numbers, for example “128 over 82”.')
      case 'logUnsupported':
        return say('I can log blood pressure, heart rate, oxygen, temperature, blood sugar, sleep and water by voice. For anything else, use the manual entry on the Overview.')
      case 'consult':
        return runConsult({ text: intent.text })
      case 'answer':
        return say(intent.answer === 'no' ? 'Understood.' : 'There is nothing waiting for an answer.')
      case 'repeat':
        return say(lastReply.current || 'I have not said anything yet.')
      case 'stop':
        cancelSpeech()
        autoClose.current = false
        return
      case 'help':
        return say(HELP_TEXT)
      case 'close':
        say('Standing by.')
        return setTimeout(() => setOpen(false), 900)
      case 'greet':
        return say(`${intent.wake ? 'Yes' : 'Hello'}${address ? `, ${address}` : ''}. How can I help?`)
      default:
        return say(UNKNOWN_TEXT)
    }
  }

  const startLog = async (key: VitalKey, values: Values, mode: 'add' | 'set') => {
    const { user: u, mission: m, crewId: id } = live.current
    const own = (u?.role === 'astronaut' || u?.role === 'member') && u.crewId === id
    if (!own) return say('Logging by voice is only available for your own record.')
    let final = values
    if (key === 'water' && mode === 'add') {
      const ev = await loadEv()
      const meta = ev?.meta.water
      const prev = meta && m && meta.day === m.day ? meta.value : 0
      final = { water: Math.round((prev + (values.water ?? 0)) * 100) / 100 }
      const bad = validateValues(final)
      if (bad) return say(bad)
      pendingLog.current = { key, values: final, heard: describeEntry(key, values, prev) }
    } else {
      const bad = validateValues(values)
      if (bad) return say(bad)
      pendingLog.current = { key, values: final, heard: describeEntry(key, values) }
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
    say(`Saved. ${readingBriefing(ev, p.key, { hidden: p.key === 'mood' && u?.role === 'ground' })}`)
  }

  const runConsult = async (input: { text?: string; answer?: 'yes' | 'no' | 'unsure' }) => {
    const { user: u, mission: m, crewId: id } = live.current
    if (id == null || !canReadClinic(u, id)) return say('Consultations are private to the person and their flight surgeon, so they are not available for your role.')
    const ev = await loadEv()
    const ctx = ev?.context ?? m?.context ?? u?.context ?? 'space'
    let profile = null
    try {
      profile = await loadProfile(u, id)
    } catch {
      profile = null
    }
    const delaySec = ctx === 'space' ? (MISSIONS.find((x) => x.id === m?.profileId)?.delaySec ?? 0) : 0
    const state = consult.current ?? newConsult()
    if (!input.text && !input.answer) {
      consult.current = newConsult()
      consultOpen.current = true
      return say('Tell me what is bothering you, in your own words.', { expectReply: true })
    }
    const step = consultStep(state, { context: ctx, readings: readingsFromEvaluation(ev), profile, delaySec }, input)
    consult.current = step.state.done ? null : step.state
    consultOpen.current = !step.state.done
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
  }

  const startPtt = () => {
    const s = live.current.settings
    cancelSpeech()
    stopRec()
    setError(null)
    const my = recSeq.current
    const cur = () => my === recSeq.current
    const r = createRecognizer({
      lang: s.lang,
      onStart: () => {
        if (!cur()) return
        setListening(true)
        sfx('listen')
      },
      onInterim: (t) => cur() && setInterim(t),
      onFinal: (t) => {
        if (!cur()) return
        setInterim('')
        sfx('done')
        void handle(t)
      },
      onError: (e) => cur() && setError(e),
      onEnd: () => {
        if (!cur()) return
        if (recMode.current === 'ptt') {
          rec.current = null
          recMode.current = null
        }
        setListening(false)
        setInterim('')
        ;(fns.current.startWake as () => void)()
      },
    })
    if (!r) {
      setError('unsupported')
      setOpen(true)
      return
    }
    rec.current = r
    recMode.current = 'ptt'
    setOpen(true)
    r.start()
  }

  const stopPtt = () => {
    if (recMode.current === 'ptt') rec.current?.stop()
  }

  const startWake = () => {
    const s = live.current.settings
    if (!s.wake || !live.current.user || recMode.current || !recognitionSupported()) return
    const my = ++recSeq.current
    const cur = () => my === recSeq.current
    const r = createRecognizer({
      lang: s.lang,
      continuous: true,
      onInterim: (t) => {
        if (cur() && speakingRef.current && hasWake(t)) cancelSpeech() // barge-in
      },
      onFinal: (t) => {
        if (!cur() || speakingRef.current) return // ignore AURA's own voice
        const { woke, rest } = stripWake(t)
        if (woke) {
          setOpen(true)
          if (rest) {
            sfx('done')
            void handle(rest)
          } else {
            sfx('listen')
            armedUntil.current = Date.now() + 8000
            setCaptions((c) => [...c.slice(-5), { id: ++seq, who: 'you', text: t }])
            say('Yes?')
          }
        } else if (Date.now() < armedUntil.current) {
          armedUntil.current = 0
          void handle(t)
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
    if (!r) return
    rec.current = r
    recMode.current = 'wake'
    r.start()
  }

  const afterQuestion = () => {
    if (live.current.open && !recMode.current && recognitionSupported() && live.current.settings.speak) startPtt()
  }

  const setOpen = (on: boolean) => {
    setOpenState(on)
    if (!on) {
      cancelSpeech()
      autoClose.current = false
      if (recMode.current === 'ptt') stopRec()
      pendingLog.current = null
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

  // wake-word listening follows the setting
  useEffect(() => {
    if (recMode.current === 'wake') stopRec()
    if (settings.wake && user) startWake()
    return () => {
      if (recMode.current === 'wake') stopRec()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.wake, settings.lang, user?.id])

  useEffect(() => {
    emitUi('hud', { on: open, source: 'voice' })
  }, [open])

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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // keyboard: Alt+V opens or closes AURA voice; with it open, hold Space to talk; Escape closes
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
        else startPtt()
      } else if (e.code === 'Escape' && live.current.open) setOpen(false)
      else if (e.code === 'Space' && live.current.open && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && !editable(e.target)) {
        e.preventDefault()
        startPtt()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && recMode.current === 'ptt') stopPtt()
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
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __auraVoice?: unknown }
    w.__auraVoice = {
      hear: async (t: string) => {
        setOpenState(true)
        await handle(t)
        return lastReply.current
      },
      open: () => setOpenState(true),
      close: () => setOpen(false),
      /** pretend the recogniser is listening (screenshots) */
      fake: (phase: 'listening' | 'idle', text = '') => {
        setOpenState(true)
        setListening(phase === 'listening')
        setInterim(text)
      },
      noRecognition: (off: boolean) => {
        forceRecognitionUnsupported(off)
        setRecOk(recognitionSupported())
        if (off) setError('unsupported')
      },
      reply: () => lastReply.current,
    }
    return () => {
      delete w.__auraVoice
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const phase: Phase = thinking ? 'thinking' : listening ? 'listening' : speaking ? 'speaking' : 'idle'
  const urgent = captions.length > 0 && captions[captions.length - 1].urgent === true

  return {
    phase,
    open,
    setOpen,
    toggle: () => (open ? setOpen(false) : startPtt()),
    startPtt,
    stopPtt,
    submit: (t: string) => void handle(t),
    settings,
    update,
    captions,
    interim,
    error,
    urgent,
    recOk: recOk && recognitionSupported(),
    ttsOk: ttsSupported(),
    clearError: () => setError(null),
  }
}
