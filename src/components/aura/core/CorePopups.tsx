// The pop-ups of the full-screen AURA core: AURA's message or question with its answer buttons, the live caption
// and transcript, typed input, the result card and the emergency sheet. They only DRAW the consultation: every
// handler and all state come from Consultation.tsx, so the normal view and full screen are one conversation.
//
// Emergency: we STAY in full screen and put a dedicated sheet in the centre, rather than leaving full screen.
// Why: (1) leaving on our own swaps the whole display at the worst moment, and the person then has to find the
// banner on a scrolled page; on a wall display or from across a cabin the centre sheet is the largest, closest
// thing we can show. (2) The sheet is not a copy: it calls the same `carePlan()` and draws the same `Steps` as
// the page's "Do this now", the steps come first, and nothing else is on it but the care contact and two
// buttons. (3) Nothing is trapped: Esc, "Exit full screen" and "See the full assessment" all lead to the page,
// where the result is the first thing as before. It is the one pop-up allowed to cover the centre of the core;
// a click outside does not close it, and "Stay here" only folds it into a red bar that reopens it.
import { ChevronRight, Keyboard, Mic, Minimize2, OctagonAlert, RotateCcw, Send, Volume2, VolumeX, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react'
import type { HealthProfile } from '../../../data/conditions/profile'
import { CONTEXTS, type Context } from '../../../data/contexts'
import { carePlan, FINDING_BY_ID, firstStep, URGENCY_TEXT, type Answer, type Assessment } from '../../../lib/doctor'
import { getVoicePresence, subscribeVoicePresence } from '../../../lib/voice/presence'
import InputLevel from '../../voice/InputLevel'
import { Button, DUR, EASE, IconButton, Logo, Textarea, cx } from '../../ui'
import { Steps } from '../AssessmentView'
import { CAPTION_HOLD_MS, captionOf, popupPlan, type Caption } from './popups'
import './fullscreen.css'

export type PopTurn = { id: number; who: 'aura' | 'me'; text: string; sub?: string }

export type CorePopupsProps = {
  ctx: Context
  profile: HealthProfile | null
  delaySec: number
  turns: PopTurn[]
  pending: string | null
  done: boolean
  a: Assessment
  asked: number
  maxQuestions: number
  /** common symptoms not yet answered */
  unpicked: string[]
  text: string
  onText: (t: string) => void
  onSend: (t: string) => void
  onReply: (a: Answer) => void
  onPick: (id: string) => void
  onShowNow: () => void
  onRestart: () => void
  dictating: boolean
  canDictate: boolean
  onDictate: () => void
  /** why the last dictation produced nothing (recognition.ts ERROR_TEXT), or null */
  dictError: string | null
  readAloud: boolean
  canRead: boolean
  onToggleRead: () => void
  onExit: () => void
  /** leave full screen and bring the result into view */
  onSeeResult: () => void
}

const REPLY: Record<Answer, string> = { yes: 'Yes', no: 'No', unsure: 'Not sure' }
const STRENGTH = { strong: 'a strong match', moderate: 'a possible match', weak: 'a weak match' } as const

/** A card over the scene: opaque, hairline border, the overlay shadow. Arrives with a short fade and rise. */
function Pop({ children, className, from = 10, ...rest }: { children: ReactNode; className?: string; from?: number; role?: 'status' }) {
  const reduce = useReducedMotion()
  const y = reduce ? 0 : from
  return (
    <motion.div {...rest} initial={{ opacity: 0, y }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduce ? 0 : from / 2 }} transition={{ duration: DUR.base, ease: EASE.out }} className={cx('rounded-2xl border border-line bg-panel shadow-overlay', className)}>
      {children}
    </motion.div>
  )
}

/** The caption stays while AURA listens, thinks or speaks, and for a few seconds after; then the core is clear. */
function useHeldCaption(c: Caption): Caption | null {
  const [held, setHeld] = useState<Caption | null>(null)
  useEffect(() => {
    if (c.live) {
      setHeld(c)
      return
    }
    const id = setTimeout(() => setHeld(null), CAPTION_HOLD_MS)
    return () => clearTimeout(id)
    // the caption's own words are its identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.live, c.label, c.line])
  return c.live ? c : held
}

export default function CorePopups(p: CorePopupsProps) {
  const presence = useSyncExternalStore(subscribeVoicePresence, getVoicePresence, getVoicePresence)
  const emergency = p.done && p.a.urgency === 'emergency'
  const voiceUrgent = presence.urgent && !emergency
  const last = p.turns[p.turns.length - 1]
  const [dismissedFor, setDismissedFor] = useState<number | null>(null)
  const [sheetMin, setSheetMin] = useState(false)
  const [typing, setTyping] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const urgentNow = emergency || voiceUrgent
  // a new emergency always opens the sheet again
  useEffect(() => {
    if (urgentNow) setSheetMin(false)
  }, [urgentNow])

  const plan = popupPlan({ done: p.done, emergency, voiceUrgent, pending: !!p.pending, dismissed: dismissedFor === last?.id, sheetMin })
  const caption = useHeldCaption(captionOf({ phase: presence.phase, interim: presence.interim, caption: presence.caption, dictating: p.dictating, dictText: p.text }))

  useEffect(() => {
    if (plan.sheet) sheetRef.current?.focus({ preventScroll: true })
  }, [plan.sheet])
  useEffect(() => {
    if (typing) formRef.current?.querySelector('textarea')?.focus({ preventScroll: true })
  }, [typing])

  // AURA's part since the person last spoke (e.g. "I noted: chest pain." and then the question)
  const lastMe = p.turns.map((t) => t.who).lastIndexOf('me')
  const tail = p.turns.slice(lastMe + 1)
  const mine = lastMe >= 0 ? p.turns[lastMe] : null
  // read aloud of the message that is already on its card: the caption keeps its state word, not a second copy
  const echo = !!caption && caption.label === 'Speaking' && plan.side !== 'chip' && plan.side !== null && tail.some((t) => t.text.includes(caption.line) || caption.line.includes(t.text))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = p.text.trim()
    if (q) p.onSend(q)
  }

  // ----- the emergency sheet: the same plan and the same steps as the page's "Do this now" -----
  const top = p.a.candidates[0]
  const care = emergency && top ? carePlan(top.condition, p.a, p.ctx, p.profile, p.delaySec) : null
  const first = firstStep('emergency', p.ctx, p.delaySec)
  const steps = care ? [care.first, ...care.steps.map((s) => s.text)] : [first]
  const title = URGENCY_TEXT.emergency.title

  const side =
    plan.side === 'result' ? (
      <Pop key="result" role="status" className="p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-dim">
          <Logo size={20} /> AURA · assessment
        </p>
        <p className="mt-2 text-[17px] font-semibold leading-snug text-ink">{URGENCY_TEXT[p.a.urgency].title}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-soft">{top ? `Most consistent with ${top.condition.name.toLowerCase()}, ${STRENGTH[top.strength]}. This is not a diagnosis.` : 'I could not find a clear match in my knowledge base. This is not a diagnosis.'}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" iconRight={ChevronRight} onClick={p.onSeeResult}>
            See the full assessment
          </Button>
          <Button icon={RotateCcw} onClick={p.onRestart}>
            Start again
          </Button>
        </div>
      </Pop>
    ) : plan.side === 'chip' ? (
      <motion.div key="chip" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: DUR.fast }} className="flex justify-end">
        <Button className="bg-panel shadow-overlay" onClick={() => setDismissedFor(null)}>
          <Logo size={18} /> {p.pending ? 'Question waiting' : 'Show AURA’s message'}
        </Button>
      </motion.div>
    ) : plan.side ? (
      <Pop key={`msg-${last?.id ?? 0}`} className="p-4">
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium text-dim">
            <Logo size={20} /> AURA
            {p.asked > 0 && (
              <span className="meta truncate">
                · question {p.asked} of at most {p.maxQuestions}
              </span>
            )}
          </p>
          <IconButton icon={X} size="sm" label={p.pending ? 'Hide the question for now' : 'Hide this message'} onClick={() => setDismissedFor(last?.id ?? null)} />
        </div>
        <div aria-live="polite" className="mt-2 space-y-2">
          {mine && (
            <p className={cx('text-sm text-dim', caption && 'max-sm:hidden')}>
              You: <span className="text-soft">{mine.text}</span>
            </p>
          )}
          {tail.map((t, i) => (
            <div key={t.id}>
              <p className={cx('leading-relaxed text-ink', i === tail.length - 1 ? 'text-[17px] font-medium' : 'text-[15px]')}>{t.text}</p>
              {/* phones: the reason for a question stays; the long note under the greeting gives way to the symptom list */}
              {t.sub && <p className={cx('mt-1 text-sm leading-relaxed text-dim', (!p.pending || caption) && 'max-sm:hidden')}>{t.sub}</p>}
            </div>
          ))}
        </div>

        {p.pending ? (
          <div className="mt-4 flex gap-2" role="group" aria-label="Answer">
            {(['yes', 'no', 'unsure'] as Answer[]).map((ans) => (
              <Button key={ans} size="lg" className="min-w-0 flex-1 px-2" onClick={() => p.onReply(ans)}>
                {REPLY[ans]}
              </Button>
            ))}
            {p.canDictate && <IconButton variant="secondary" icon={Mic} label={p.dictating ? 'Stop listening' : 'Answer by voice'} aria-pressed={p.dictating} className={cx('h-12 w-12 shrink-0', p.dictating && 'border-accent text-accent')} onClick={p.onDictate} />}
          </div>
        ) : (
          p.unpicked.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-dim">Common symptoms</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Common symptoms">
                {p.unpicked.map((id) => (
                  <Button key={id} size="sm" onClick={() => p.onPick(id)}>
                    {FINDING_BY_ID[id].label}
                  </Button>
                ))}
              </div>
            </div>
          )
        )}
        {p.a.yesCount > 0 && (
          <Button variant="quiet" className="mt-2 -ml-2" onClick={p.onShowNow}>
            Show my assessment now
          </Button>
        )}
      </Pop>
    ) : null

  return (
    <div className="aura-fs__pop" data-aura-popups={plan.sheet ?? plan.side ?? 'none'}>
      <div className="aura-fs__stack" inert={!!plan.sheet}>
        <div className="aura-fs__side">
          <AnimatePresence mode="popLayout" initial={false}>
            {side}
          </AnimatePresence>
        </div>

        <div className="aura-fs__bottom">
          <AnimatePresence initial={false}>
            {caption && (
              <Pop key="caption" from={8} className="px-4 py-3">
                <p className="flex items-center gap-2 text-sm font-medium text-dim">
                  {caption.live && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />}
                  {caption.label}
                  {caption.label === 'Listening' && <InputLevel className="ml-1" />}
                </p>
                {!echo && (
                  <p aria-live="polite" className={cx('aura-fs__clamp mt-1 text-[17px] leading-snug', caption.quote ? 'text-ink' : 'text-soft')}>
                    {caption.quote ? `“${caption.line}”` : caption.line}
                  </p>
                )}
              </Pop>
            )}
          </AnimatePresence>
          {plan.composer && p.dictError && !p.dictating && (
            <p role="status" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm leading-snug text-soft shadow-overlay">
              {p.dictError}
            </p>
          )}
          {plan.composer &&
            (typing ? (
              <form ref={formRef} onSubmit={submit} className="flex items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-overlay">
                <label htmlFor="aura-fs-compose" className="sr-only">
                  {p.pending ? 'Or describe it in your own words' : 'Describe how you feel'}
                </label>
                <Textarea
                  id="aura-fs-compose"
                  rows={1}
                  className="min-h-11 flex-1 resize-none"
                  placeholder={p.pending ? 'Or describe it' : 'Describe how you feel'}
                  value={p.text}
                  onChange={(e) => p.onText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      e.currentTarget.form?.requestSubmit()
                    } else if (e.key === 'Escape') {
                      // Esc closes the input first; a second Esc leaves full screen
                      e.preventDefault()
                      e.stopPropagation()
                      setTyping(false)
                    }
                  }}
                />
                {p.canDictate && <IconButton variant="secondary" icon={Mic} label={p.dictating ? 'Stop dictating' : 'Dictate with your voice'} aria-pressed={p.dictating} className={cx('shrink-0', p.dictating && 'border-accent text-accent')} onClick={p.onDictate} />}
                <Button type="submit" variant="primary" icon={Send} disabled={!p.text.trim()}>
                  Send
                </Button>
                <IconButton icon={X} label="Close typed input" className="shrink-0" onClick={() => setTyping(false)} />
              </form>
            ) : (
              <div className="flex justify-center gap-2">
                {p.canDictate && (
                  <Button icon={Mic} aria-pressed={p.dictating} className={cx('bg-panel shadow-overlay', p.dictating && 'border-accent text-accent')} onClick={p.onDictate}>
                    {p.dictating ? 'Stop listening' : 'Speak'}
                  </Button>
                )}
                <Button icon={Keyboard} className="bg-panel shadow-overlay" onClick={() => setTyping(true)}>
                  Type instead
                </Button>
              </div>
            ))}
        </div>
      </div>

      {/* after "Stay here": the emergency stays on screen as a bar that reopens the sheet */}
      {plan.bar && (
        <div className="aura-fs__bar">
          <button type="button" onClick={() => setSheetMin(false)} className="press flex min-h-11 items-center gap-2 rounded-lg border border-crit bg-panel px-4 text-[15px] font-semibold text-ink shadow-overlay">
            <OctagonAlert className="h-5 w-5 shrink-0 text-crit" aria-hidden="true" />
            {title}
            <span className="font-normal text-soft">· Show the steps</span>
          </button>
        </div>
      )}

      {plan.sheet && (
        <div className="aura-fs__sheet">
          <div ref={sheetRef} tabIndex={-1} role="alertdialog" aria-labelledby="aura-fs-urgent-title" aria-describedby="aura-fs-urgent-steps" className="aura-fs__sheet-card rounded-2xl border border-crit bg-panel shadow-overlay outline-none">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-crit">
              <OctagonAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
              Urgent
            </p>
            <h2 id="aura-fs-urgent-title" className="mt-2 text-title text-ink">
              {title}
            </h2>
            {plan.sheet === 'emergency' && p.a.reasons.length > 0 && (
              <p className="mt-2 text-base leading-relaxed text-soft">
                {p.a.ruleBased ? 'Rule-based alert: ' : ''}
                {p.a.reasons.join('; ')}.
              </p>
            )}
            <div id="aura-fs-urgent-steps" className="mt-5">
              <p className="mb-2 text-[15px] font-semibold text-ink">
                Do this now{care ? <span className="font-normal text-dim"> · for {care.name.toLowerCase()}</span> : null}
              </p>
              <Steps items={plan.sheet === 'emergency' ? steps : [first]} big />
            </div>
            {plan.sheet === 'voice' && presence.caption.trim() && (
              <p className="mt-4 text-base leading-relaxed text-soft">
                <span className="text-dim">AURA is saying: </span>
                {presence.caption}
              </p>
            )}
            <p className="mt-4 text-sm text-dim">
              Care contact: {CONTEXTS[p.ctx].contact}. {plan.sheet === 'emergency' ? 'The medicines, what not to do and the sources are in the full assessment.' : 'Leave full screen to see AURA’s full reply.'}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="primary" size="lg" iconRight={ChevronRight} onClick={plan.sheet === 'emergency' ? p.onSeeResult : p.onExit}>
                {plan.sheet === 'emergency' ? 'See the full assessment' : 'Leave full screen'}
              </Button>
              <Button size="lg" onClick={() => setSheetMin(true)}>
                Stay here
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="aura-fs__top">
        {p.canRead && <IconButton variant="secondary" icon={p.readAloud ? Volume2 : VolumeX} label={`Read aloud: ${p.readAloud ? 'on' : 'off'}`} aria-pressed={p.readAloud} className="bg-panel" onClick={p.onToggleRead} />}
        <Button icon={Minimize2} className="bg-panel" aria-keyshortcuts="F Escape" onClick={p.onExit}>
          <span className="max-sm:sr-only">Exit full screen</span>
        </Button>
      </div>
    </div>
  )
}
