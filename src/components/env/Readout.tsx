import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Eval } from '../../lib/envStation'
import { AnimatedNumber, Card, cx } from '../ui'
import { LevelChip } from './parts'

/**
 * One large, glanceable reading: value, status (icon + word + colour), the rule behind it, how old it is.
 * `value` is a number (it tweens when it changes) or null (shown as a dash, never as zero).
 * Only a warning or alarm tints the number; a normal reading stays ink, and a stale one is dimmed.
 */
export function Readout({
  name,
  Icon,
  value,
  decimals,
  unit,
  ev,
  rule,
  extra,
  meter,
  updated,
  dimmed,
}: {
  name: string
  Icon: LucideIcon
  value: number | null
  decimals: number
  unit: string
  ev: Eval
  rule: ReactNode
  extra?: ReactNode
  meter?: ReactNode
  updated: string
  dimmed: boolean
}) {
  const shown = value == null ? '—' : `${value.toFixed(decimals)} ${unit}`
  const tone = value == null || dimmed ? 'text-dim' : ev.level === 'crit' ? 'text-crit' : ev.level === 'warn' ? 'text-warn' : 'text-ink'
  return (
    <Card className={cx('h-full', ev.level === 'crit' && 'border-crit/60')}>
      <div role="group" aria-label={`${name}: ${shown}, ${ev.label.toLowerCase()}. ${ev.detail}`} className="flex h-full flex-col">
        <div className="label flex items-center gap-2">
          <Icon className="h-4 w-4" aria-hidden="true" />
          {name}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className={cx('text-metric-xl', tone)}>{value == null ? '—' : <AnimatedNumber value={value} decimals={decimals} />}</span>
          {value != null && <span className="text-base text-dim">{unit}</span>}
        </div>
        <div className="mt-3">
          <LevelChip level={ev.level} label={ev.label} />
        </div>
        <p className={cx('mt-2 text-sm', ev.level === 'none' ? 'text-dim' : 'text-soft')}>{ev.detail}</p>
        {meter && <div className="mt-3">{meter}</div>}
        {extra && <div className="mt-2 text-sm text-dim">{extra}</div>}
        <div className="mt-auto pt-4">
          <div className="border-t border-line pt-3 text-sm text-dim">
          <p>{rule}</p>
          <p className="mt-1 font-mono text-xs">Updated {updated}</p>
          </div>
        </div>
      </div>
    </Card>
  )
}
