import type { ReactNode } from 'react'
import { impactOf, vitalFor, type Context } from '../data/contexts'
import { recordsForSystem } from '../data/kb'
import type { BodySystem } from '../data/systems'
import { type Status, type Values, type VitalKey } from '../data/vitals'
import { RecordCard } from './ScienceLibrary'
import { Disclosure, List, Notice, Row, Sheet, SourceLink, StatusText, SYSTEM_ICON, VITAL_ICON, statusLabel } from './ui'

type Props = {
  system: BodySystem
  /** null: this system has no reading yet */
  status: Status | null
  values: Values
  available: VitalKey[] // vitals with data for this person
  action: string // context- and delay-aware triage instruction
  context: Context
  extra?: ReactNode
  canEdit: boolean
  onEdit: (key: VitalKey) => void
  onClose: () => void
  /** Lets a parent hide the sheet temporarily (e.g. while the entry dialog is on top). Default true. */
  open?: boolean
}

export default function SystemPanel({ system, status, values, available, action, context, extra, canEdit, onEdit, onClose, open = true }: Props) {
  const impact = impactOf(system.id, context)
  const research = context === 'space' ? recordsForSystem(system.id).slice(0, 3) : []
  const vitals = system.vitals.filter((k) => available.includes(k))
  const Icon = SYSTEM_ICON[system.id]

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        <span className="flex items-center gap-2.5">
          <Icon className="h-5 w-5 shrink-0 text-dim" aria-hidden="true" />
          {system.name}
        </span>
      }
      description={context === 'space' ? `Hazard · ${system.hazard}` : undefined}
    >
      <div className="space-y-6">
        {status === null ? (
          <div>
            <StatusText status={null} />
            <p className="mt-2 text-[15px] leading-relaxed text-soft">Not measured yet, so AURA cannot say whether this system is normal. Log a reading to see its status.</p>
          </div>
        ) : status === 'ok' ? (
          <div>
            <StatusText status={status} />
            <p className="mt-2 text-[15px] leading-relaxed text-soft">{action}</p>
          </div>
        ) : (
          <Notice tone={status} title={statusLabel(status)}>
            <span className="text-[15px] text-ink">{action}</span>
          </Notice>
        )}

        {vitals.length > 0 && (
          <List>
            {vitals.map((k) => {
              const def = vitalFor(k, context)
              const st = def.evaluate(values)
              const VIcon = VITAL_ICON[k]
              return (
                <Row
                  key={k}
                  title={def.label}
                  description={<StatusText status={st} />}
                  leading={<VIcon className="h-5 w-5" aria-hidden="true" />}
                  trailing={
                    <span className="text-right">
                      <span className={st === 'warn' ? 'text-metric-md text-warn' : st === 'crit' ? 'text-metric-md text-crit' : 'text-metric-md text-ink'}>{def.display(values)}</span>
                      <span className="ml-1.5 text-sm text-dim">{def.unit}</span>
                    </span>
                  }
                  onClick={canEdit ? () => onEdit(k) : undefined}
                />
              )
            })}
          </List>
        )}
        {vitals.length > 0 && canEdit && <p className="-mt-3 text-sm text-dim">Select a reading to log a new value.</p>}
        {extra}

        <div className="border-t border-line">
        <Block id="system.what" title="What it does">{system.fn}</Block>
        {impact.heading !== 'What it does' && <Block id="system.impact" title={impact.heading}>{impact.text}</Block>}
        <Block id="system.tips" title="What you can do" defaultOpen>
          <ul className="list-disc space-y-1 pl-5">
            {system.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Block>

        {vitals.length > 0 && (
          <Block id="system.limits" title="Why these limits?">
            <div className="space-y-2">
              {vitals.map((k) => {
                const d = vitalFor(k, context)
                return (
                  <p key={k}>
                    <span className="font-medium text-ink">{d.label}: </span>
                    {d.ranges} <span className="text-dim">({d.source})</span>
                  </p>
                )
              })}
            </div>
          </Block>
        )}

        {research.length > 0 && (
          <Block id="system.research" title="NASA research on this system" meta={`${research.length} records`}>
            <div className="space-y-2">
              {research.map((r) => (
                <RecordCard key={r.id} r={r} compact />
              ))}
            </div>
          </Block>
        )}

        </div>
        {impact.source && <SourceLink href={impact.source.url} org={impact.source.org} title={impact.source.title} />}
        <p className="border-t border-line pt-4 text-sm text-dim">AURA supports self-assessment. It does not diagnose and does not replace your doctor or emergency services.</p>
      </div>
    </Sheet>
  )
}

/** One folded group in the panel: the person's choice to open or close it is remembered on this device. */
function Block({ id, title, meta, defaultOpen = false, children }: { id: string; title: string; meta?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <Disclosure size="row" id={id} defaultOpen={defaultOpen} title={<span className="text-[15px] font-semibold text-ink">{title}</span>} meta={meta} className="border-b border-line">
      <div className="text-sm leading-relaxed text-soft">{children}</div>
    </Disclosure>
  )
}
