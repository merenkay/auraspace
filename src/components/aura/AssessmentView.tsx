import { BookOpen, ListChecks } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { HealthProfile } from '../../data/conditions/profile'
import type { Context } from '../../data/contexts'
import { carePlan, URGENCY_TEXT, type Assessment, type Candidate, type PlanItem } from '../../lib/doctor'
import { Badge, List, Notice, Row, Section, SourceLink } from '../ui'
import MedicationCard from './MedicationCard'

const TONE = { emergency: 'crit', urgent: 'warn', soon: 'info', selfcare: 'info' } as const
const STRENGTH = { strong: 'Strong match', moderate: 'Possible match', weak: 'Weak match' } as const

function Lines({ items, ordered = false, lead }: { items: PlanItem[]; ordered?: boolean; lead?: ReactNode }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-2 pl-5 text-[15px] leading-relaxed marker:text-dim`}>
      {lead && <li className="font-semibold">{lead}</li>}
      {items.map((i) => (
        <li key={i.text}>{i.text}</li>
      ))}
    </Tag>
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
    <span className="mt-1 block space-y-1 text-sm">
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

export default function AssessmentView({ a, ctx, profile, delaySec, footer }: { a: Assessment; ctx: Context; profile: HealthProfile | null; delaySec: number; footer?: ReactNode }) {
  const shown = a.candidates.slice(0, 4)
  const [selected, setSelected] = useState<string | null>(null)
  const focus = shown.find((c) => c.condition.id === selected) ?? shown[0]
  const plan = focus ? carePlan(focus.condition, a, ctx, profile, delaySec) : null
  const u = URGENCY_TEXT[a.urgency]

  return (
    <div className="space-y-10">
      <Notice tone={TONE[a.urgency]} role={a.urgency === 'emergency' ? 'alert' : undefined} title={u.title}>
        {plan && <p className="text-[15px] text-ink">{plan.first}</p>}
        {a.reasons.length > 0 && (
          <p className="mt-2">
            {a.ruleBased ? 'Rule-based alert: ' : ''}
            {a.reasons.join('; ')}.
          </p>
        )}
      </Notice>

      {plan && (a.urgency === 'emergency' || a.urgency === 'urgent') && (
        <Section title="Do this now" description={`For ${plan.name.toLowerCase()}`}>
          <Lines ordered items={plan.steps} lead={plan.first} />
          {plan.meds.length > 0 && <div className="mt-6 grid gap-4">{plan.meds.map((m) => <MedicationCard key={m.name} med={m} />)}</div>}
          {plan.donts.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-2 font-semibold">Do not</h4>
              <Lines items={plan.donts} />
            </div>
          )}
        </Section>
      )}

      <Section title="What this could be" description="Consistent with — not a diagnosis. Tap one to see its care plan.">
        {shown.length === 0 ? (
          <p className="text-sm text-soft">AURA did not find a condition in its knowledge base that fits. Ask a professional to review your symptoms.</p>
        ) : (
          <List>
            {shown.map((c) => (
              <Row
                key={c.condition.id}
                selected={c.condition.id === focus?.condition.id}
                onClick={() => setSelected(c.condition.id)}
                title={c.condition.name}
                description={
                  <>
                    <span className="block">{c.condition.blurb}</span>
                    <CandidateDetail c={c} />
                  </>
                }
                trailing={<Badge tone={c.emergency.length ? 'crit' : c.strength === 'strong' ? 'accent' : 'neutral'}>{c.emergency.length ? 'Red flag' : STRENGTH[c.strength]}</Badge>}
              />
            ))}
          </List>
        )}
        {a.noClearMatch && shown.length > 0 && (
          <Notice className="mt-4" tone="info">
            None of these is a strong match. That is useful to know too: tell your care contact what you feel and let them examine you.
          </Notice>
        )}
      </Section>

      {plan && a.urgency !== 'emergency' && a.urgency !== 'urgent' && (
        <Section title="What you can do" description={`For ${plan.name.toLowerCase()}`} action={<ListChecks className="h-5 w-5 text-dim" aria-hidden="true" />}>
          <Lines ordered items={plan.steps} lead={plan.first} />
          {plan.meds.length > 0 && <div className="mt-6 grid gap-4">{plan.meds.map((m) => <MedicationCard key={m.name} med={m} />)}</div>}
          {plan.donts.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-2 font-semibold">Do not</h4>
              <Lines items={plan.donts} />
            </div>
          )}
        </Section>
      )}

      {plan && (plan.redflags.length > 0 || plan.escalate.length > 0 || plan.monitor.length > 0) && (
        <Section title="Watch and escalate">
          <div className="grid gap-6 lg:grid-cols-2">
            {plan.redflags.length > 0 && (
              <div>
                <h4 className="mb-2 font-semibold">Get help at once if</h4>
                <Lines items={plan.redflags} />
              </div>
            )}
            <div className="space-y-6">
              {plan.escalate.length > 0 && (
                <div>
                  <h4 className="mb-2 font-semibold">When to get more help</h4>
                  <Lines items={plan.escalate} />
                </div>
              )}
              {plan.monitor.length > 0 && (
                <div>
                  <h4 className="mb-2 font-semibold">Keep an eye on</h4>
                  <Lines items={plan.monitor} />
                </div>
              )}
            </div>
          </div>
        </Section>
      )}

      {plan && plan.sources.length > 0 && (
        <Section title="Sources" description="Every line above comes from these pages. The quotes are the sources’ own words." action={<BookOpen className="h-5 w-5 text-dim" aria-hidden="true" />}>
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
        </Section>
      )}

      {footer}
    </div>
  )
}
