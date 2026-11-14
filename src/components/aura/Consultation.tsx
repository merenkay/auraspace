// The consultation thread: AURA asks, the person answers with quick replies or free text, AURA asks focused
// follow-ups, then shows the assessment. All logic is the deterministic engine in src/lib/doctor.
import { RotateCcw, Save, Send } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { HealthProfile } from '../../data/conditions/profile'
import type { Context } from '../../data/contexts'
import { assess, FINDING_BY_ID, parseFindings, STARTER_FINDINGS, type Answer, type Answers, type Assessment, type Readings } from '../../lib/doctor'
import { Button, Field, Logo, Notice, Textarea } from '../ui'
import AssessmentView from './AssessmentView'

type Turn = { id: number; who: 'aura' | 'me'; text: string; sub?: string }

const MAX_QUESTIONS = 7
const REPLY: Record<Answer, string> = { yes: 'Yes', no: 'No', unsure: 'Not sure' }

let seq = 0
const turn = (who: Turn['who'], text: string, sub?: string): Turn => ({ id: ++seq, who, text, sub })

function AuraSays({ t }: { t: Turn }) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-sm text-dim">
        <Logo size={20} /> AURA
      </p>
      <p className="text-[15px] leading-relaxed">{t.text}</p>
      {t.sub && <p className="mt-1 text-sm text-dim">{t.sub}</p>}
    </div>
  )
}

export type SaveHandler = (a: Assessment, answers: Answers) => Promise<void>

export default function Consultation({ ctx, readings, profile, delaySec, firstName, onSave }: { ctx: Context; readings: Readings; profile: HealthProfile | null; delaySec: number; firstName: string; onSave?: SaveHandler }) {
  const greeting = () => turn('aura', `Hello${firstName ? ` ${firstName}` : ''}. Tell me what is bothering you, in your own words — or pick from the list below.`, 'I work offline from a knowledge base of known conditions and official sources. I can say what your symptoms are consistent with, not diagnose.')
  const [turns, setTurns] = useState<Turn[]>(() => [greeting()])
  const [answers, setAnswers] = useState<Answers>({})
  const [asked, setAsked] = useState<string[]>([])
  const [pending, setPending] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [text, setText] = useState('')
  const [saved, setSaved] = useState<'idle' | 'busy' | 'ok' | 'error'>('idle')
  const endRef = useRef<HTMLDivElement>(null)

  const a = useMemo(() => assess({ answers, context: ctx, readings, profile }), [answers, ctx, readings, profile])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [turns.length, done])

  /** After every answer: stop at once on an emergency, otherwise ask the most useful next question. */
  const advance = (next: Answers, askedNow: string[], notes: Turn[]) => {
    const res = assess({ answers: next, context: ctx, readings, profile })
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

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
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

  return (
    <div className="space-y-10">
      <div className="max-w-2xl space-y-6" aria-live="polite">
        {turns.map((t) =>
          t.who === 'me' ? (
            <p key={t.id} className="ml-auto w-fit max-w-[85%] rounded-2xl bg-panel2 px-4 py-3 text-[15px]">
              {t.text}
            </p>
          ) : (
            <AuraSays key={t.id} t={t} />
          ),
        )}

        {!done && pending && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Answer">
            {(['yes', 'no', 'unsure'] as Answer[]).map((ans) => (
              <Button key={ans} size="sm" onClick={() => reply(ans)}>
                {REPLY[ans]}
              </Button>
            ))}
          </div>
        )}

        {!done && !pending && unpicked.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Common symptoms">
            {unpicked.map((id) => (
              <Button key={id} size="sm" onClick={() => pick(id)}>
                {FINDING_BY_ID[id].label}
              </Button>
            ))}
          </div>
        )}

        {!done && (
          <form onSubmit={submit} className="space-y-3">
            <Field label={pending ? 'Or describe it in your own words' : 'Describe how you feel'} hint="English or Turkish, e.g. “my chest hurts and my left arm is numb”.">
              <Textarea
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    e.currentTarget.form?.requestSubmit()
                  }
                }}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" icon={Send}>
                Send
              </Button>
              {a.yesCount > 0 && (
                <Button variant="quiet" onClick={() => { setPending(null); setDone(true); setTurns((t) => [...t, turn('aura', 'Here is my assessment so far.')]) }}>
                  Show my assessment now
                </Button>
              )}
            </div>
          </form>
        )}
        <div ref={endRef} />
      </div>

      {done && (
        <AssessmentView
          a={a}
          ctx={ctx}
          profile={profile}
          delaySec={delaySec}
          footer={
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-6">
              {onSave && (
                <Button variant="primary" icon={Save} loading={saved === 'busy'} disabled={saved === 'ok'} onClick={() => void save()}>
                  {saved === 'ok' ? 'Saved to your record' : 'Save to my record'}
                </Button>
              )}
              <Button icon={RotateCcw} onClick={restart}>
                Start a new consultation
              </Button>
              {saved === 'error' && <Notice tone="crit" role="alert">Could not save. Please try again.</Notice>}
              <p className="w-full text-sm text-dim">AURA is decision support built from a fixed knowledge base. It cannot examine you and it can be wrong — when in doubt, contact your care team.</p>
            </div>
          }
        />
      )}
    </div>
  )
}
