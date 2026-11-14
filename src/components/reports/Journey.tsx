// The steps a crew report goes through. Stored facts (sent, reply written, reply opened) come from the backend;
// the signal-delay steps are a labelled simulation computed from the stored times + the mission profile's delay.
import { Check, Circle, Clock, RadioTower } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { formatDelay } from '../../data/missions'
import { formatRemaining, isUnread, simulatedJourney, type Leg } from '../../lib/reports/journey'
import type { Report } from '../../lib/types'
import { Badge, cx } from '../ui'

/** Current time, ticking once a second only while `active`. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

export const clock = (t: number | string) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

type Step = { key: string; done: boolean; icon: typeof Check; title: ReactNode; meta?: ReactNode; simulated?: boolean }

function simStep(key: string, l: Leg, moving: string, arrived: string): Step {
  return l.arrived
    ? { key, done: true, icon: Check, title: arrived, meta: clock(l.at), simulated: true }
    : { key, done: false, icon: RadioTower, title: moving, meta: `arrives in ${formatRemaining(l.remainingSec)}`, simulated: true }
}

export default function Journey({ report: r, delaySec, perspective }: { report: Report; delaySec: number; perspective: 'crew' | 'surgeon' }) {
  const first = simulatedJourney(r, delaySec, Date.now())
  const moving = Boolean(first && (!first.out.arrived || (first.reply && !first.reply.arrived)))
  const now = useNow(moving)
  const j = simulatedJourney(r, delaySec, now)
  const crew = perspective === 'crew'

  const steps: Step[] = [{ key: 'sent', done: true, icon: Check, title: crew ? 'Sent from the spacecraft' : 'Sent by the crew member', meta: clock(r.createdAt) }]
  if (j) steps.push(simStep('out', j.out, 'In transit to Earth', 'Delivered to Earth'))
  if (r.status === 'reviewed') {
    steps.push({ key: 'reply', done: true, icon: Check, title: `Reply written by ${r.reviewedBy ?? 'the flight surgeon'}`, meta: r.reviewedAt ? clock(r.reviewedAt) : undefined })
    if (j?.reply) steps.push(simStep('back', j.reply, 'Reply in transit to the spacecraft', 'Reply delivered to the spacecraft'))
    if (!crew)
      steps.push(
        r.readAt === undefined
          ? { key: 'read', done: false, icon: Circle, title: 'Read status not available on this server yet' }
          : isUnread(r)
            ? { key: 'read', done: false, icon: Circle, title: 'Not opened by the crew member yet' }
            : { key: 'read', done: true, icon: Check, title: 'Opened by the crew member', meta: r.readAt ? clock(r.readAt) : undefined },
      )
  } else {
    steps.push({ key: 'wait', done: false, icon: Clock, title: crew ? 'Waiting for the flight surgeon’s reply' : 'Waiting for your reply' })
  }

  return (
    <div>
      <ol className="space-y-0">
        {steps.map((s, i) => (
          <li key={s.key} className="relative flex gap-3 pb-3 last:pb-0">
            {i < steps.length - 1 && <span aria-hidden="true" className="absolute left-[9px] top-6 bottom-0 w-px bg-line" />}
            <s.icon className={cx('mt-0.5 h-[18px] w-[18px] shrink-0', s.done ? 'text-ink' : 'text-dim')} aria-hidden="true" />
            <div className="min-w-0 flex-1 text-sm">
              <span className={cx(s.done ? 'text-ink' : 'text-soft')}>{s.title}</span>
              {s.simulated && (
                <Badge className="ml-2 align-middle" tone="neutral">
                  Simulated
                </Badge>
              )}
              {s.meta && <span className="block font-mono text-xs text-dim">{s.meta}</span>}
            </div>
          </li>
        ))}
      </ol>
      {j && (
        <p className="mt-3 text-xs leading-relaxed text-dim">
          Simulated signal delay: {formatDelay(delaySec)} each way on this mission profile, timed from the stored send and reply times. AURA stores the report and the reply immediately; the steps marked Simulated only show how long a real mission would wait.
        </p>
      )}
    </div>
  )
}
