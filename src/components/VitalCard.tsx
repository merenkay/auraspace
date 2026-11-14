import { STATUS_COLOR, type Status } from '../data/vitals'
import { isImportedDevice, isSyntheticDevice } from '../lib/samsungHealth'
import Sparkline from './Sparkline'
import { Badge, Card, Metric, cx, useMedia } from './ui'

const SOURCE_LABEL: Record<string, string> = { device: 'Device', manual: 'Manual', live: 'Live', sim: 'Simulated' }

type Props = {
  label: string
  value: string
  unit: string
  status: Status
  source: string
  device: string
  time: string
  trend: { day: number; value: number }[]
  onClick?: () => void
  /** Kept for existing callers; entrance order is now handled by the parent <Stagger>. */
  index?: number
}

/** One measurement: number, plain-words status, 14-day trend and where the value came from. The whole card opens the entry dialog when `onClick` is set. */
export default function VitalCard({ label, value, unit, status, source, device, time, trend, onClick }: Props) {
  const wide = useMedia('(min-width: 640px)')
  const synthetic = isSyntheticDevice(device)
  const imported = isImportedDevice(device)
  const src = synthetic ? 'Synthetic sample' : imported ? 'Samsung Health' : (SOURCE_LABEL[source] ?? source)
  // Normal data stays neutral; only a reading that needs attention takes its status colour.
  const trendColor = status === 'ok' ? 'var(--color-soft)' : STATUS_COLOR[status]
  return (
    <Card className={cx('relative flex h-full flex-col gap-3', onClick && 'transition-colors hover:bg-panel2')} pad="sm">
      <Metric size={wide ? 'lg' : 'md'} label={label} value={value} unit={unit} status={status} hint={time} />
      <Sparkline data={trend} color={trendColor} />
      <div className="mt-auto flex flex-wrap items-center gap-1.5">
        <Badge className="max-w-full">
          <span title={device || undefined}>{src}</span>
        </Badge>
      </div>
      {onClick && <button type="button" onClick={onClick} aria-label={`Log a new ${label} reading`} className="absolute inset-0 rounded-2xl" />}
    </Card>
  )
}
