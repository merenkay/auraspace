import { STATUS_COLOR, STATUS_LABEL, type Source, type Status } from '../data/vitals'

const SOURCE_LABEL: Record<Source, string> = { sample: 'SAMPLE', manual: 'MANUAL', live: 'LIVE', sim: 'SIMULATED' }

type Props = {
  label: string
  value: string
  unit: string
  status: Status
  source: Source
  note?: string
  onClick?: () => void
}

export default function VitalTile({ label, value, unit, status, source, note, onClick }: Props) {
  const color = STATUS_COLOR[status]
  const live = source === 'live' || source === 'sim'
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex min-h-[104px] w-full flex-1 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-left transition hover:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-sky-400"
      style={{ boxShadow: `inset 4px 0 0 ${color}` }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">{label}</span>
        <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-slate-400">
          {live && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: source === 'live' ? '#34d399' : '#94a3b8' }} />}
          {SOURCE_LABEL[source]}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold leading-none tabular-nums sm:text-5xl xl:text-6xl" style={{ color }}>
          {value}
        </span>
        <span className="text-sm text-slate-400">{unit}</span>
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="font-bold tracking-widest" style={{ color }}>
          ● {STATUS_LABEL[status]}
        </span>
        <span className="truncate text-slate-400">{note ?? (onClick ? 'Tap to enter' : '')}</span>
      </div>
    </button>
  )
}
