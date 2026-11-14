import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { impactOf, vitalFor, type Context } from '../data/contexts'
import { recordsForSystem } from '../data/kb'
import type { BodySystem } from '../data/systems'
import { STATUS_COLOR, STATUS_LABEL, type Status, type Values, type VitalKey } from '../data/vitals'
import { RecordCard } from './ScienceLibrary'

type Props = {
  system: BodySystem
  status: Status
  values: Values
  available: VitalKey[] // vitals with data for this person
  action: string // context- and delay-aware triage instruction
  context: Context
  extra?: ReactNode
  canEdit: boolean
  onEdit: (key: VitalKey) => void
  onClose: () => void
}

export default function SystemPanel({ system, status, values, available, action, context, extra, canEdit, onEdit, onClose }: Props) {
  const color = STATUS_COLOR[status]
  const impact = impactOf(system.id, context)
  const research = context === 'space' ? recordsForSystem(system.id).slice(0, 3) : []
  const vitals = system.vitals.filter((k) => available.includes(k))

  return (
    <motion.div className="fixed inset-0 z-40 flex items-end justify-end bg-black/50 sm:items-stretch" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.aside
        initial={{ x: 60, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ ease: [0.22, 1, 0.36, 1], duration: 0.35 }}
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-line bg-panel p-5 shadow-2xl sm:max-h-none sm:w-[440px] sm:rounded-none sm:rounded-l-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            {context === 'space' && <p className="label text-cyan">Hazard · {system.hazard}</p>}
            <h2 className="mt-1 font-display text-2xl font-bold">{system.name}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 text-3xl leading-none text-dim hover:text-ink" aria-label="Close">
            ×
          </button>
        </div>

        <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: color, background: `${color}14` }}>
          <p className="text-xs font-bold tracking-widest" style={{ color }}>
            ● {STATUS_LABEL[status]}
          </p>
          <p className="mt-1 text-sm leading-snug">{action}</p>
        </div>

        {vitals.length > 0 && (
          <div className="mt-4 space-y-2">
            {vitals.map((k) => {
              const def = vitalFor(k, context)
              return (
                <button
                  key={k}
                  type="button"
                  disabled={!canEdit}
                  onClick={() => onEdit(k)}
                  className="flex w-full items-center justify-between rounded-2xl border border-line bg-deep/60 px-4 py-3 text-left transition enabled:hover:border-cyan/50"
                >
                  <span>
                    <span className="block text-xs uppercase tracking-wider text-dim">{def.label}</span>
                    <span className="font-display text-3xl font-bold" style={{ color: STATUS_COLOR[def.evaluate(values)] }}>
                      {def.display(values)}
                    </span>
                    <span className="ml-2 text-sm text-dim">{def.unit}</span>
                  </span>
                  {canEdit && <span className="text-sm font-semibold text-cyan">Update ›</span>}
                </button>
              )
            })}
          </div>
        )}
        {extra}

        <Section title="What it does">{system.fn}</Section>
        {impact.heading !== 'What it does' && <Section title={impact.heading}>{impact.text}</Section>}
        <Section title="What you can do">
          <ul className="list-disc space-y-1 pl-5">
            {system.tips.slice(context === 'space' ? 0 : 0).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Section>

        {vitals.length > 0 && (
          <Section title="Why these limits?">
            {vitals.map((k) => {
              const d = vitalFor(k, context)
              return (
                <p key={k} className="mb-1">
                  <span className="font-semibold">{d.label}: </span>
                  {d.ranges} <span className="text-dim">({d.source})</span>
                </p>
              )
            })}
          </Section>
        )}

        {research.length > 0 && (
          <section className="mt-5">
            <h3 className="label">NASA research on this system</h3>
            <div className="mt-2 space-y-2">
              {research.map((r) => (
                <RecordCard key={r.id} r={r} compact />
              ))}
            </div>
          </section>
        )}

        {impact.source && (
          <a href={impact.source.url} target="_blank" rel="noreferrer" className="mt-4 block text-xs text-cyan underline">
            Source: {impact.source.org} — {impact.source.title}
          </a>
        )}
        <p className="mt-3 text-[11px] leading-snug text-dim">AURA supports self-assessment. It does not diagnose and does not replace your doctor or emergency services.</p>
      </motion.aside>
    </motion.div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="label">{title}</h3>
      <div className="mt-1.5 text-sm leading-relaxed text-soft">{children}</div>
    </section>
  )
}
