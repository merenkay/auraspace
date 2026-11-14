import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Eval } from '../../lib/envStation'
import { LEVEL, LevelChip } from './parts'

/** One large, glanceable reading: value, status (icon + text + colour), what the rule is, how old it is. */
export function Readout({
  name,
  Icon,
  value,
  unit,
  ev,
  rule,
  extra,
  updated,
  dimmed,
}: {
  name: string
  Icon: LucideIcon
  value: string
  unit: string
  ev: Eval
  rule: ReactNode
  extra?: ReactNode
  updated: string
  dimmed: boolean
}) {
  const s = LEVEL[ev.level]
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-deep/60 p-4 ${ev.level === 'crit' ? 'border-crit' : 'border-line'}`}
      role="group"
      aria-label={`${name}: ${value} ${unit}, ${ev.label}. ${ev.detail}`}
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${s.bar}`} aria-hidden="true" />
      <div className="flex items-center gap-2 text-sm font-semibold text-soft">
        <Icon className="h-4 w-4" aria-hidden="true" />
        {name}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className={`font-display text-5xl font-bold leading-none ${dimmed ? 'text-dim' : 'text-ink'}`}>{value}</span>
        <span className="text-base text-dim">{unit}</span>
      </div>
      <div className="mt-3">
        <LevelChip level={ev.level} label={ev.label} />
      </div>
      <p className={`mt-2 text-sm ${ev.level === 'none' ? 'text-dim' : 'text-soft'}`}>{ev.detail}</p>
      {extra && <div className="mt-1 text-xs text-dim">{extra}</div>}
      <div className="mt-3 border-t border-line pt-2 text-xs text-dim">
        <div>{rule}</div>
        <div className="mt-0.5">Updated {updated}</div>
      </div>
    </div>
  )
}
