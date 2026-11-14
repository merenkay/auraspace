import { motion } from 'motion/react'
import { STATUS_COLOR, type Status } from '../data/vitals'
import { Sparkline, StatusPill } from './ui'

const SOURCE_LABEL: Record<string, string> = { device: 'DEVICE', manual: 'MANUAL', live: 'LIVE', sim: 'SIMULATED' }

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
  index?: number
}

export default function VitalCard({ label, value, unit, status, source, device, time, trend, onClick, index = 0 }: Props) {
  const color = STATUS_COLOR[status]
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-30px' }}
      transition={{ duration: 0.5, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      whileHover={onClick ? { y: -4 } : undefined}
      className="glass group relative flex w-full flex-col gap-2 overflow-hidden rounded-3xl p-4 text-left disabled:cursor-default"
    >
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: color }} />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold text-soft">{label}</span>
        <span className="shrink-0 rounded-md bg-panel2 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-ice" title={device}>
          {SOURCE_LABEL[source] ?? source.toUpperCase()}
        </span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display text-4xl font-bold leading-none" style={{ color }}>
          {value}
        </span>
        <span className="text-sm text-dim">{unit}</span>
      </div>
      <Sparkline data={trend} color={color} />
      <div className="flex items-center justify-between gap-2">
        <StatusPill status={status} small />
        <span className="text-[11px] text-dim">{time}</span>
      </div>
    </motion.button>
  )
}
