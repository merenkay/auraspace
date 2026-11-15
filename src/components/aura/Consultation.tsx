// The consultation thread: AURA asks, the person answers with quick replies or free text, AURA asks focused
// follow-ups, then shows the assessment. All logic is the deterministic engine in src/lib/doctor.
import { Mic, RotateCcw, Save, Send, Volume2, VolumeX } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { HealthProfile } from '../../data/conditions/profile'
import type { Context } from '../../data/contexts'
import { FINDING_BY_ID, parseFindings, STARTER_FINDINGS, URGENCY_TEXT, type Answer, type Answers, type Assessment, type Readings } from '../../lib/doctor'
import { sfx } from '../../lib/sfx'
import { emergencyPlan } from '../../lib/voice/consult'
import { parseIntent } from '../../lib/voice/intents'
import { createRecognizer, ERROR_TEXT, recognitionSupported, type Recognizer } from '../../lib/voice/recognition'
import { loadSettings, saveSettings } from '../../lib/voice/settings'
import { cancelSpeech, speak, ttsSupported } from '../../lib/voice/speech'
import { Button, DUR, EASE, IconButton, Logo, Meter, Notice, Textarea, cx, useMedia } from '../ui'
import AssessmentView from './AssessmentView'
import { useHandMode } from '../gesture/viewerBridge'
import AuraCore, { type AuraCoreProps } from './core/AuraCore'
import CorePopups from './core/CorePopups'
import { useFullscreen } from './core/useFullscreen'
import Disclosure from './Disclosure'
import { assessWithEnvironment, CabinAirNotice, environmentLine, EnvironmentNotes, useCabinContext, useCabinPrefill } from '../cabinlink'

type Turn = { id: number; who: 'aura' | 'me'; text: string; sub?: string }

/** What the page passes through to the core's data layers. */
export type CoreExtras = Pick<AuraCoreProps, 'crewId' | 'onExplain'>

const MAX_QUESTIONS = 7
const REPLY: Record<Answer, string> = { yes: 'Yes', no: 'No', unsure: 'Not sure' }

let seq = 0
const turn = (who: Turn['who'], text: string, sub?: string): Turn => ({ id: ++seq, who, text, sub })

/** One message. Enters with a short fade and 8 px rise; reduced motion removes the movement globally. */
function Message({ t, first }: { t: Turn; first: boolean }) {
  const enter = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: DUR.base, ease: EASE.out } }
  if (t.who === 'me')
    return (
      <motion.div {...enter} className="flex justify-end pt-1">
        <p className="w-fit max-w-[85%] rounded-2xl bg-panel2 px-4 py-3 text-[15px] leading-relaxed">
          <span className="sr-only">You: </span>
          {t.text}
        </p>
      </motion.div>
    )
  return (
    <motion.div {...enter}>
      {first && (
        <p className="mb-1.5 flex items-center gap-2 text-sm font-medium text-dim">
          <Logo size={20} /> AURA
        </p>
      )}
      <p className="text-base leading-relaxed text-ink">{t.text}</p>
      {t.sub && <p className="mt-1.5 text-sm leading-relaxed text-dim">{t.sub}</p>}
    </motion.div>
  )
}

export type SaveHandler = (a: Assessment, answers: Answers) => Promise<void>

/**
 * `presence`: show the AURA core (the 3D voice presence) as the counterpart of the conversation: beside the
 * thread on wide screens, a compact strip above it on phones. Once a result is shown the result comes first:
 * the core keeps a narrow column beside it on very wide screens and otherwise moves below it, so an emergency
 * banner and its steps are never pushed down or covered.
 */
export default function Consultation({ ctx, readings, profile, delaySec, firstName, onSave, presence = false, core: coreExtras }: { ctx: Context; readings: Readings; profile: HealthProfile | null; delaySec: number; firstName: string; onSave?: SaveHandler; presence?: boolean; core?: CoreExtras }) {
  const wide = useMedia('(min-width: 1024px)')
  const xwide = useMedia('(min-width: 1280px)')
  const greeting = () => turn('aura', `Hello${firstName ? ` ${firstName}` : ''}. Tell me what is bothering you, in your own words — or pick from the list below.`, 'I work offline from a knowledge base of known conditions and official sources. I can say what your symptoms are consistent with, not diagnose.')
  const [turns, setTurns] = useState<Turn[]>(() => [greeting()])
  const [answers, setAnswers] = useState<Answers>({})
  const [asked, setAsked] = useState<string[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle')
  const endRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()
  // Voice (optional): dictate symptoms or answers, and read AURA's questions and the result aloud.
  const [readAloud, setReadAloud] = useState(() => loadSettings().readConsult && ttsSupported())
  const [dictating, setDictating] = useState(false)
  const [dictError, setDictError] = useState<string | null>(null) // why dictation produced nothing, in words
  // Full screen: the <aside> that holds the core fills the display; the conversation continues in pop-ups over it.
  const fsRef = useRef<HTMLElement>(null)
  const fs = useFullscreen(fsRef, { preferCss: useHandMode() })
  const recRef = useRef<Recognizer | null>(null)
  const spokenTurns = useRef(1)

  const cabin = useCabinContext(ctx).cabin // cabin-air readings: supporting evidence only, never lowers urgency
  // environment-aware (src/lib/cabinLink/envDx.ts): red flags on the raw answers; the person's own words are checked for severity words
  const said = turns.filter((t) => t.who === 'me').map((t) => t.text).join('. ')
  const a = useMemo(() => assessWithEnvironment({ answers, context: ctx, readings, profile }, cabin, { text: said }), [answers, ctx, readings, profile, cabin, said])

  useEffect(() => {
    const behavior = reduce ? 'auto' : 'smooth'
    if (done) resultRef.current?.scrollIntoView({ behavior, block: 'start' })
    else if (turns.length > 1) endRef.current?.scrollIntoView({ behavior, block: 'nearest' })
  }, [turns.length, done, reduce])

  /** After every answer: stop at once on an emergency, otherwise ask the most useful next question. */
  const advance = (next: Answers, askedNow: string[], notes: Turn[]) => {
    const res = assessWithEnvironment({ answers: next, context: ctx, readings, profile }, cabin, { text: [said, ...notes.filter((t) => t.who === 'me').map((t) => t.text)].join('. ') })
    const add: Turn[] = [...notes]
    const yes = Object.values(next).some((v) => v === 'yes')
    if (res.urgency === 'emergency') {
      add.push(turn('aura', 'This pattern needs help now. Here is what to do.'))
      setPending(null)
      setDone(true)
    } else if (yes && res.next && askedNow.length < MAX_QUESTIONS) {
      add.push(turn('aura', res.next.question, res.next.why))
      setPending(res.next.id)
      setAsked([...askedNow, res.next.id])
    } else if (yes) {
      add.push(turn('aura', 'Thank you. Here is my assessment.'))
      setPending(null)
      setDone(true)
    } else {
      add.push(turn('aura', 'Tell me about a symptom you do have, or pick one from the list.'))
      setPending(null)
    }
    setAnswers(next)
    setTurns((t) => [...t, ...add])
  }

  const reply = (ans: Answer) => {
    if (!pending) return
    advance({ ...answers, [pending]: ans }, asked, [turn('me', REPLY[ans])])
  }

  const pick = (id: string) => advance({ ...answers, [id]: 'yes' }, asked, [turn('me', FINDING_BY_ID[id].label)])
  useCabinPrefill((found, said) => advance(found, [], [turn('me', said)])) // ticks from the Environment page's symptom check

  const submit = (e: FormEvent) => {
    e.preventDefault()
    sendText(text.trim())
  }

  const sendText = (q: string) => {
    if (!q) return
    setText('')
    const { answers: found } = parseFindings(q)
    const ids = Object.keys(found)
    if (!ids.length) {
      setTurns((t) => [...t, turn('me', q), turn('aura', 'I could not match that to symptoms I know. Try short phrases such as “chest pain” or “dizzy”, or pick from the list.')])
      return
    }
    const yes = ids.filter((id) => found[id] === 'yes').map((id) => FINDING_BY_ID[id].label.toLowerCase())
    const no = ids.filter((id) => found[id] === 'no').map((id) => FINDING_BY_ID[id].label.toLowerCase())
    const noted = `I noted${yes.length ? `: ${yes.join('; ')}` : ''}${no.length ? `${yes.length ? '. ' : ' '}Not present: ${no.join('; ')}` : ''}.`
    advance({ ...answers, ...found }, asked, [turn('me', q), turn('aura', noted)])
  }

  const live = useRef({ pending, reply, sendText })
  live.current = { pending, reply, sendText }

  const dictate = () => {
    if (dictating) {
      recRef.current?.stop()
      return
    }
    cancelSpeech()
    setDictError(null)
    const r = createRecognizer({
      lang: loadSettings().lang,
      onStart: () => {
        setDictating(true)
        sfx('listen')
      },
      onInterim: (t) => setText(t),
      onFinal: (t) => {
        sfx('done')
        const intent = live.current.pending ? parseIntent(t, { lang: loadSettings().lang }) : null
        if (intent?.type === 'answer') {
          setText('')
          live.current.reply(intent.answer)
        } else live.current.sendText(t)
      },
      onError: (e) => {
        setText('')
        setDictError(ERROR_TEXT[e])
      },
      onEnd: () => {
        setDictating(false)
        recRef.current = null
      },
    })
    recRef.current = r
    r?.start()
  }
  useEffect(() => () => recRef.current?.abort(), [])

  const toggleRead = () => {
    const next = !readAloud
    setReadAloud(next)
    saveSettings({ ...loadSettings(), readConsult: next })
    if (!next) cancelSpeech()
  }

  // Read AURA's new messages aloud (only when the person switched this on).
  useEffect(() => {
    if (!readAloud) {
      spokenTurns.current = turns.length
      return
    }
    const fresh = turns.slice(spokenTurns.current).filter((t) => t.who === 'aura')
    spokenTurns.current = turns.length
    if (fresh.length) speak(fresh.map((t) => t.text).join(' '))
  }, [turns, readAloud])

  // The result: an emergency is spoken at once with its first steps word for word, ahead of anything queued.
  useEffect(() => {
    if (!done || !readAloud) return
    if (a.urgency === 'emergency') {
      sfx('alarm')
      speak(emergencyPlan(a, { context: ctx, readings, profile, delaySec }).text, { priority: 'urgent' })
    } else speak(`${URGENCY_TEXT[a.urgency].title}.${a.candidates[0] ? ` Most consistent with ${a.candidates[0].condition.name.toLowerCase()}.` : ''} ${environmentLine(a) ?? ''} The full assessment is on screen.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done])

  const restart = () => {
    setTurns([greeting()])
    setAnswers({})
    setAsked([])
    setPending(null)
    setDone(false)
    setSaved('idle')
  }

  const save = async () => {
    if (!onSave) return
    setSaved('busy')
    try {
      await onSave(a, answers)
      setSaved('ok')
    } catch {
      setSaved('error')
    }
  }

  const unpicked = STARTER_FINDINGS.filter((id) => !answers[id])

  const showNow = () => {
    setPending(null)
    setDone(true)
    setTurns((t) => [...t, turn('aura', 'Here is my assessment so far.')])
  }

  // Leaving full screen with a result: the result is the first thing on the page, as it is without full screen.
  const wasFull = useRef(false)
  useEffect(() => {
    if (fs.on) {
      wasFull.current = true
      return
    }
    if (!wasFull.current) return
    wasFull.current = false
    if (done) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' }))
  }, [fs.on, done])

  const thread = (
    <div role="log" aria-label="Conversation with AURA" aria-live="polite" className="space-y-5">
      {turns.map((t, i) => (
        <Message key={t.id} t={t} first={t.who === 'aura' && turns[i - 1]?.who !== 'aura'} />
      ))}
    </div>
  )

  const main = (
    <div key="main" className="min-w-0 space-y-10">
      {done ? (
        <Disclosure size="row" title={`Conversation (${turns.length} messages)`} className="max-w-2xl border-b border-line">
          {thread}
          <div className="h-4" />
        </Disclosure>
      ) : (
        <div className="max-w-2xl space-y-6">
          {asked.length > 0 && (
            <div className="flex items-center gap-3 text-sm text-dim">
              <span className="shrink-0">
                Question {asked.length} of at most {MAX_QUESTIONS}
              </span>
              <Meter className="w-24" value={asked.length} max={MAX_QUESTIONS} label={`Question ${asked.length} of at most ${MAX_QUESTIONS}`} />
            </div>
          )}
          {thread}

          {pending && (
            <div className="grid grid-cols-3 gap-2 sm:flex sm:max-w-sm" role="group" aria-label="Answer">
              {(['yes', 'no', 'unsure'] as Answer[]).map((ans) => (
                <Button key={ans} className="sm:flex-1" onClick={() => reply(ans)}>
                  {REPLY[ans]}
                </Button>
              ))}
            </div>
          )}

          {!pending && unpicked.length > 0 && (
            <div>
              <p className="mb-2 text-sm text-dim">Common symptoms</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Common symptoms">
                {unpicked.map((id) => (
                  <Button key={id} size="sm" onClick={() => pick(id)}>
                    {FINDING_BY_ID[id].label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {a.yesCount > 0 && (
            <Button variant="quiet" onClick={showNow}>
              Show my assessment now
            </Button>
          )}
          <div ref={endRef} />

          {/* Pinned above the phone bottom bar; flows normally from md up. */}
          <form onSubmit={submit} className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 border-t border-line bg-space px-4 pb-3 pt-3 sm:-mx-6 sm:px-6 md:static md:mx-0 md:border-0 md:px-0 md:pb-0 md:pt-2">
            <label htmlFor="aura-compose" className="sr-only">
              {pending ? 'Or describe it in your own words' : 'Describe how you feel'}
            </label>
            <div className="flex items-end gap-2">
              <Textarea
                id="aura-compose"
                rows={1}
                className="min-h-11 flex-1 resize-none"
                placeholder={pending ? 'Or describe it' : 'Describe how you feel'}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    e.currentTarget.form?.requestSubmit()
                  }
                }}
              />
              {recognitionSupported() && (
                <IconButton variant="secondary" icon={Mic} label={dictating ? 'Stop dictating' : 'Dictate with your voice'} aria-pressed={dictating} className={cx('shrink-0', dictating && 'border-accent text-accent')} onClick={dictate} />
              )}
              <Button type="submit" variant="primary" icon={Send} disabled={!text.trim()}>
                Send
              </Button>
            </div>
            {dictError && !dictating && (
              <p role="status" className="mt-2 text-sm leading-snug text-soft">
                {dictError}
              </p>
            )}
            <p className="mt-1.5 text-xs text-dim">English or Turkish, e.g. “my chest hurts and my left arm is numb”. Enter sends, Shift+Enter adds a line.</p>
            {ttsSupported() && (
              <button type="button" aria-pressed={readAloud} onClick={toggleRead} className="press mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg pr-2 text-sm text-dim hover:text-ink md:min-h-8">
                {readAloud ? <Volume2 className="h-4 w-4" aria-hidden="true" /> : <VolumeX className="h-4 w-4" aria-hidden="true" />}
                Read aloud: {readAloud ? 'on' : 'off'}
              </button>
            )}
          </form>
        </div>
      )}

      {done && (
        <div ref={resultRef} className="scroll-mt-24">
          <AssessmentView
            a={a}
            cabin={<div className="space-y-3 empty:hidden"><CabinAirNotice cabin={cabin} answers={answers} ctx={ctx} /><EnvironmentNotes a={a} /></div>}
            ctx={ctx}
            profile={profile}
            delaySec={delaySec}
            footer={
              <div className="space-y-4 border-t border-line pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  {onSave && (
                    <Button variant="primary" icon={Save} loading={saved === 'busy'} done={saved === 'ok'} disabled={saved === 'ok'} onClick={() => void save()}>
                      {saved === 'ok' ? 'Saved to your record' : 'Save to my record'}
                    </Button>
                  )}
                  <Button icon={RotateCcw} onClick={restart}>
                    Start a new consultation
                  </Button>
                </div>
                {saved === 'error' && (
                  <Notice tone="crit" role="alert">
                    Could not save. Please try again.
                  </Notice>
                )}
                <p className="max-w-2xl text-sm text-dim">AURA is decision support built from a fixed knowledge base. It cannot examine you and it can be wrong — when in doubt, contact your care team.</p>
              </div>
            }
          />
        </div>
      )}
    </div>
  )

  if (!presence) return main

  // One instance of the core for every layout (it owns a WebGL context): only its place and size change.
  const beside = done ? xwide : wide
  const core = (
    <aside key="core" ref={fsRef} tabIndex={-1} data-fs={fs.mode ?? undefined} aria-label={fs.on ? 'AURA, full screen' : undefined} className={cx('aura-fs min-w-0', beside && !fs.on && 'sticky top-24 self-start')}>
      <AuraCore {...coreExtras} variant={fs.on ? 'full' : !beside ? 'strip' : done ? 'side' : 'panel'} listening={dictating} urgent={done && a.urgency === 'emergency'} fullscreen={fs.on} onToggleFullscreen={fs.toggle} />
      {fs.on && (
        <CorePopups
          ctx={ctx}
          profile={profile}
          delaySec={delaySec}
          turns={turns}
          pending={pending}
          done={done}
          a={a}
          asked={asked.length}
          maxQuestions={MAX_QUESTIONS}
          unpicked={unpicked}
          text={text}
          onText={setText}
          onSend={sendText}
          onReply={reply}
          onPick={pick}
          onShowNow={showNow}
          onRestart={restart}
          dictating={dictating}
          canDictate={recognitionSupported()}
          onDictate={dictate}
          dictError={dictError}
          readAloud={readAloud}
          canRead={ttsSupported()}
          onToggleRead={toggleRead}
          onExit={fs.exit}
          onSeeResult={fs.exit}
        />
      )}
    </aside>
  )
  return (
    <div className={cx(beside ? (done ? 'grid grid-cols-[minmax(0,1fr)_13rem] items-start gap-10' : 'grid grid-cols-[minmax(0,42rem)_minmax(0,1fr)] items-start gap-10') : cx('flex flex-col', done ? 'gap-6' : 'gap-4'))}>
      {/* the strip sits above the thread on phones; everywhere else the conversation or the result comes first */}
      {!beside && !done ? [core, main] : [main, core]}
    </div>
  )
}
