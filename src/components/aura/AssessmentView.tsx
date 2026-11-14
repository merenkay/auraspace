import { Ban, Check, Flag } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { HealthProfile } from '../../data/conditions/profile'
import type { Context } from '../../data/contexts'
import { carePlan, URGENCY_TEXT, type Assessment, type Candidate, type PlanItem } from '../../lib/doctor'
import { Badge, cx, List, Notice, Row, Section, SourceLink } from '../ui'
import Disclosure from './Disclosure'
import MedicationCard from './MedicationCard'

const TONE = { emergency: 'crit', urgent: 'warn', soon: 'info', selfcare: 'info' } as const
const STRENGTH = { strong: 'Strong match', moderate: 'Possible match', weak: 'Weak match' } as const

/** Plain bullet list for secondary guidance. */
function Lines({ items }: { items: PlanItem[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 text-[15px] leading-relaxed marker:text-dim">
      {items.map((i) => (
        <li key={i.text}>{i.text}</li>
      ))}
    </ul>
  )
}

/** The action steps as large numbered rows. The first one is the most important. */
function Steps({ items, big }: { items: string[]; big: boolean }) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {items.map((t, i) => (
        <li key={t} className={cx('flex items-start gap-4', big ? 'py-4' : 'py-3')}>
          <span className={cx('flex shrink-0 items-center justify-center rounded-lg font-semibold', big ? 'h-9 w-9 text-lg' : 'h-8 w-8 text-[15px]', i === 0 ? 'bg-ink text-space' : 'border border-edge text-ink')}>{i + 1}</span>
          <span className={cx('min-w-0 pt-0.5 leading-snug text-ink', big ? 'text-lg' : 'text-base', i === 0 && 'font-semibold')}>{t}</span>
        </li>
      ))}
    </ol>
  )
}

function CandidateDetail({ c }: { c: Candidate }) {
  const rows: [string, string[]][] = [
    ['Matches', c.matched.map((m) => m.label)],
    ['Also supports it', c.factors.map((f) => f.label)],
    ['Key signs not confirmed', c.missing],
    ['Makes it less likely', c.against.map((a) => a.label)],
    ['Not measured recently', c.unmeasured],
  ]
  return (
    <span className="mt-2 block space-y-1 text-sm">
      {rows
        .filter(([, v]) => v.length)
        .map(([k, v]) => (
          <span key={k} className="block">
            <span className="text-dim">{k}: </span>
            <span className="text-soft">{v.join(' · ')}</span>
          </span>
        ))}
    </span>
  )
}

export default function AssessmentView({ a, ctx, profile, delaySec, footer, cabin }: { a: Assessment; ctx: Context; profile: HealthProfile | null; delaySec: number; footer?: ReactNode; cabin?: ReactNode }) {
  const shown = a.candidates.slice(0, 4)
  const [selected, setSelected] = useState<string | null>(null)
  const focus = shown.find((c) => c.condition.id === selected) ?? shown[0]
  const plan = focus ? carePlan(focus.condition, a, ctx, profile, delaySec) : null
  const u = URGENCY_TEXT[a.urgency]
  const emergency = a.urgency === 'emergency'
  const hot = emergency || a.urgency === 'urgent'
  const steps = plan ? [plan.first, ...plan.steps.map((s) => s.text)] : []

  const candidates = (
    <>
      {shown.length === 0 ? (
        <p className="text-sm text-soft">AURA did not find a condition in its knowledge base that fits. Ask a professional to review your symptoms.</p>
      ) : (
        <>
          <p className="mb-3 text-sm text-dim">Consistent with, not a diagnosis. Choose one to see its care plan.</p>
          <List>
            {shown.map((c) => {
              const on = c.condition.id === focus?.condition.id
              return (
                <Row
                  key={c.condition.id}
                  selected={on}
                  onClick={() => setSelected(c.condition.id)}
                  leading={on ? <Check className="h-4 w-4 text-ink" aria-hidden="true" /> : <span className="h-4 w-4" aria-hidden="true" />}
                  title={c.condition.name}
                  description={
                    <>
                      <span className="block">{c.condition.blurb}</span>
                      {on && <CandidateDetail c={c} />}
                    </>
                  }
                  trailing={
                    <Badge tone={c.emergency.length ? 'crit' : c.strength === 'strong' ? 'accent' : 'neutral'} icon={c.emergency.length ? Flag : undefined}>
                      {c.emergency.length ? 'Red flag' : STRENGTH[c.strength]}
                    </Badge>
                  }
                />
              )
            })}
          </List>
        </>
      )}
      {a.noClearMatch && shown.length > 0 && (
        <Notice className="mt-4" tone="info">
          None of these is a strong match. That is useful to know too: tell your care contact what you feel and let them examine you.
        </Notice>
      )}
    </>
  )

  const actions = plan && (
    <Section title={hot ? 'Do this now' : 'What you can do'} description={`For ${plan.name.toLowerCase()}`}>
      <Steps items={steps} big={emergency} />
      {plan.meds.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-[15px] font-semibold text-ink">Medicines</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {plan.meds.map((m) => (
              <MedicationCard key={m.name} med={m} />
            ))}
          </div>
        </div>
      )}
      {plan.donts.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <Ban className="h-4 w-4 text-dim" aria-hidden="true" />
            Do not
          </h3>
          <Lines items={plan.donts} />
        </div>
      )}
    </Section>
  )

  const watch =
    plan && (plan.redflags.length > 0 || plan.escalate.length > 0 || plan.monitor.length > 0) ? (
      <div className="space-y-6">
        {/* Red flags are safety information: always visible, never behind a disclosure. */}
        {plan.redflags.length > 0 && (
          <div>
            <h3 className="mb-2 text-[15px] font-semibold text-ink">Get help at once if</h3>
            <Lines items={plan.redflags} />
          </div>
        )}
        {(plan.escalate.length > 0 || plan.monitor.length > 0) && (
      <Disclosure title="Watch and escalate" defaultOpen={!hot}>
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-6">
            {plan.escalate.length > 0 && (
              <div>
                <h3 className="mb-2 text-[15px] font-semibold text-ink">When to get more help</h3>
                <Lines items={plan.escalate} />
              </div>
            )}
            {plan.monitor.length > 0 && (
              <div>
                <h3 className="mb-2 text-[15px] font-semibold text-ink">Keep an eye on</h3>
                <Lines items={plan.monitor} />
              </div>
            )}
          </div>
        </div>
      </Disclosure>
        )}
      </div>
    ) : null

  const sources =
    plan && plan.sources.length > 0 ? (
      <Disclosure id="aura.sources" title="Sources" meta={`${plan.sources.length} pages`}>
        <p className="mb-2 text-sm text-dim">Every line above comes from these pages. The quotes are the sources’ own words.</p>
        <ul className="divide-y divide-line">
          {plan.sources.map((s) => (
            <li key={s.id} className="py-3">
              <SourceLink href={s.url} org={s.org} title={s.title} />
              {s.quotes.map((q) => (
                <p key={q} className="mt-1 text-sm text-dim">
                  “{q}”
                </p>
              ))}
            </li>
          ))}
        </ul>
      </Disclosure>
    ) : null

  return (
    <div className={cx('space-y-10', !hot && 'max-w-3xl')}>
      {/* Appears at once: never inside a stagger or reveal. */}
      <Notice tone={TONE[a.urgency]} role={emergency ? 'alert' : undefined} title={u.title} className={emergency ? 'p-4 sm:p-5' : undefined}>
        {a.reasons.length > 0 && (
          <p className={emergency ? 'text-base text-ink' : ''}>
            {a.ruleBased ? 'Rule-based alert: ' : ''}
            {a.reasons.join('; ')}.
          </p>
        )}
      </Notice>
      {!emergency && cabin /* cabin-air notice (src/components/cabinlink); after the emergency steps when it is an emergency */}

      {hot ? (
        <>
          {actions}
          {emergency && cabin}
          <div className="space-y-6">
            <Disclosure title="What this could be" meta={shown.length ? `${shown.length} possible` : undefined}>
              {candidates}
            </Disclosure>
            {watch}
            {sources}
          </div>
        </>
      ) : (
        <>
          <Section title="What this could be">{candidates}</Section>
          {actions}
          {watch}
          {sources}
        </>
      )}

      {footer}
    </div>
  )
}
