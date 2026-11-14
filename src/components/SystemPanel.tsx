import type { ReactNode } from 'react'
import type { BodySystem } from '../data/systems'
import { STATUS_COLOR, STATUS_LABEL, VITAL_BY_KEY, type Status, type Values, type VitalKey } from '../data/vitals'

type Props = {
  system: BodySystem
  status: Status
  values: Values
  action: string // delay-aware triage instruction
  extra?: ReactNode // e.g. radiation dose details
  onEdit: (key: VitalKey) => void
  onClose: () => void
}

export default function SystemPanel({ system, status, values, action, extra, onEdit, onClose }: Props) {
  const color = STATUS_COLOR[status]
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end bg-black/50 sm:items-stretch" onClick={onClose}>
      <aside
        className="max-h-[88vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl sm:max-h-none sm:w-[420px] sm:rounded-none sm:rounded-l-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-sky-300">Hazard: {system.hazard}</p>
            <h2 className="mt-1 text-2xl font-bold text-white">
              {system.icon} {system.name}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 text-3xl leading-none text-slate-400 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>

        <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: color, background: `${color}14` }}>
          <p className="text-xs font-bold tracking-widest" style={{ color }}>
            ● {STATUS_LABEL[status]}
          </p>
          <p className="mt-1 text-sm leading-snug text-slate-100">{action}</p>
        </div>

        {system.vitals.length > 0 && (
          <div className="mt-4 space-y-2">
            {system.vitals.map((k) => {
              const def = VITAL_BY_KEY[k]
              const st = def.evaluate(values)
              return (
                <button
                  key={k}
                  onClick={() => onEdit(k)}
                  className="flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left hover:bg-white/10"
                >
                  <span>
                    <span className="block text-xs uppercase tracking-wider text-slate-400">{def.label}</span>
                    <span className="text-3xl font-bold tabular-nums" style={{ color: STATUS_COLOR[st] }}>
                      {def.display(values)}
                    </span>
                    <span className="ml-2 text-sm text-slate-400">{def.unit}</span>
                  </span>
                  <span className="text-sm font-semibold text-sky-300">Update ›</span>
                </button>
              )
            })}
          </div>
        )}
        {extra}

        <Section title="What it does">{system.fn}</Section>
        <Section title="How space affects it">{system.space}</Section>
        <Section title="What you can do">
          <ul className="list-disc space-y-1 pl-5">
            {system.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </Section>

        {system.vitals.length > 0 && (
          <Section title="Why these limits?">
            {system.vitals.map((k) => (
              <p key={k} className="mb-1">
                <span className="font-semibold text-slate-200">{VITAL_BY_KEY[k].label}: </span>
                {VITAL_BY_KEY[k].ranges} <span className="text-slate-500">({VITAL_BY_KEY[k].source})</span>
              </p>
            ))}
          </Section>
        )}

        <a href={system.sourceUrl} target="_blank" rel="noreferrer" className="mt-4 block text-xs text-sky-300 underline">
          Source: {system.sourceLabel}
        </a>
        <p className="mt-3 text-[11px] leading-snug text-slate-500">
          CrewPulse supports self-assessment. It does not diagnose and does not replace the flight surgeon.
        </p>
      </aside>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">{title}</h3>
      <div className="mt-1.5 text-sm leading-relaxed text-slate-200">{children}</div>
    </section>
  )
}
