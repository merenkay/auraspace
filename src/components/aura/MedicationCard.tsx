import { Pill } from 'lucide-react'
import { sourceOf } from '../../data/conditions'
import type { MedAdvice, MedStatus } from '../../lib/doctor'
import { Badge, Card, Notice, SourceLink } from '../ui'

const STATUS: Record<MedStatus, { label: string; tone: 'ok' | 'warn' | 'crit' | 'neutral' }> = {
  suggested: { label: 'Commonly advised', tone: 'neutral' },
  'check-first': { label: 'Check first', tone: 'warn' },
  'if-prescribed': { label: 'Only if prescribed to you', tone: 'neutral' },
  'not-for-you': { label: 'Not suggested for you', tone: 'crit' },
}

export default function MedicationCard({ med }: { med: MedAdvice }) {
  const src = sourceOf(med.source)
  const st = STATUS[med.status]
  const off = med.status === 'not-for-you'
  return (
    <Card tone="well" as="article">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Pill className="h-4 w-4 text-dim" aria-hidden="true" />
          <h4 className="text-[15px] font-semibold">{med.name}</h4>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <p className="mt-1 text-sm text-soft">{med.purpose}</p>
      {!off && (
        <blockquote className="mt-3 border-l-2 border-edge pl-3 text-[15px] leading-relaxed">
          <span className="italic">“{med.quote}”</span>
          <div className="mt-1">
            <SourceLink href={src.url} org={src.org} title={src.title} />
          </div>
        </blockquote>
      )}
      {med.reasons.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {med.reasons.map((r) => (
            <li key={r} className={off ? 'text-crit' : 'text-soft'}>
              {r}
            </li>
          ))}
        </ul>
      )}
      {med.cautions.length > 0 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-soft">Cautions from the source ({med.cautions.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {med.cautions.map((c) => {
              const s = sourceOf(c.s)
              const hit = med.matched.includes(c)
              return (
                <li key={c.q} className="py-2">
                  <p className={hit ? 'font-medium text-ink' : 'text-soft'}>
                    {hit && <span className="mr-1 text-warn">Applies to you:</span>}
                    {c.t}
                  </p>
                  <p className="mt-0.5 text-xs text-dim">
                    “{c.q}” — {s.org}
                  </p>
                </li>
              )
            })}
          </ul>
        </details>
      )}
      <Notice tone="info" className="mt-3">
        {med.confirmWith} First-aid information quoted from a named source, not a prescription.
      </Notice>
    </Card>
  )
}
