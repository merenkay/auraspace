import { Ban, Check, CircleAlert, ClipboardList, type LucideIcon } from 'lucide-react'
import { sourceOf } from '../../data/conditions'
import type { MedAdvice, MedStatus } from '../../lib/doctor'
import { Card, cx, SourceLink } from '../ui'
import Disclosure from './Disclosure'

// Each state has its own icon shape, word and border, so it reads without colour.
const STATUS: Record<MedStatus, { label: string; Icon: LucideIcon; text: string; border: string }> = {
  suggested: { label: 'Commonly advised', Icon: Check, text: 'text-soft', border: 'border-line' },
  'check-first': { label: 'Check first', Icon: CircleAlert, text: 'text-warn', border: 'border-warn/40' },
  'if-prescribed': { label: 'Only if prescribed to you', Icon: ClipboardList, text: 'text-soft', border: 'border-line' },
  'not-for-you': { label: 'Not suggested for you', Icon: Ban, text: 'text-crit', border: 'border-crit/50' },
}

export default function MedicationCard({ med }: { med: MedAdvice }) {
  const src = sourceOf(med.source)
  const st = STATUS[med.status]
  const off = med.status === 'not-for-you'
  const check = med.status === 'check-first'
  return (
    <Card tone="well" as="article" className={cx(st.border, off && 'border-dashed')}>
      <p className={cx('flex items-center gap-1.5 text-sm font-medium', st.text)}>
        <st.Icon className="h-4 w-4" aria-hidden="true" />
        {st.label}
      </p>
      <h4 className={cx('mt-2 text-[15px] font-semibold', off ? 'text-soft line-through decoration-edge' : 'text-ink')}>{med.name}</h4>
      <p className="mt-1 text-sm text-soft">{med.purpose}</p>
      {med.reasons.length > 0 && (
        <ul className={cx('mt-3 space-y-1 text-[15px] leading-snug', off || check ? 'font-medium text-ink' : 'text-soft')}>
          {med.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {!off && (
        <blockquote className="mt-3 border-l-2 border-edge pl-3 text-[15px] leading-relaxed">
          <span className="italic">“{med.quote}”</span>
          <div className="mt-1">
            <SourceLink href={src.url} org={src.org} title={src.title} />
          </div>
        </blockquote>
      )}
      {med.cautions.length > 0 && (
        <Disclosure size="row" title={`Cautions from the source (${med.cautions.length})`} defaultOpen={check} className="mt-2">
          <ul className="divide-y divide-line">
            {med.cautions.map((c) => {
              const s = sourceOf(c.s)
              const hit = med.matched.includes(c)
              return (
                <li key={c.q} className="py-2 text-sm">
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
        </Disclosure>
      )}
      <p className="mt-3 border-t border-line pt-3 text-sm text-dim">
        {med.confirmWith} First-aid information quoted from a named source, not a prescription.
      </p>
    </Card>
  )
}
