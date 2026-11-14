import { Info } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EW } from '../../data/earlyWarning/rules'
import { analyse } from '../../lib/earlyWarning'
import { useSession } from '../../lib/session'
import type { Measurement } from '../../lib/types'
import { Skeleton, StatusIcon } from '../ui'

/**
 * Roster: who is drifting. Loads the record's last 6 weeks itself (the roster only loads 30 days),
 * so the personal baseline is available. Staff only ever see the simulated crew (the roster's own list).
 */
export default function EarlyWarningIndicator({ crewId }: { crewId: number }) {
  const { backend, mission, user } = useSession()
  const [rows, setRows] = useState<Measurement[] | null>(null)
  useEffect(() => {
    if (!backend || !mission) return
    let alive = true
    backend
      .measurements(crewId, mission.day - (EW.RECENT_DAYS + EW.BASELINE_DAYS))
      .then((r) => alive && setRows(r))
      .catch(() => alive && setRows([]))
    return () => {
      alive = false
    }
  }, [backend, mission, crewId])

  const report = useMemo(
    () => (rows && mission ? analyse(rows, { today: mission.day, ctx: mission.context, hidePrivate: user?.role === 'ground', now: Date.now(), viewer: 'staff' }) : null),
    [rows, mission, user],
  )

  if (!report) return <Skeleton className="mt-3 h-5 w-40" />
  const top = report.warnings[0]
  let icon = <StatusIcon status={null} size={15} />
  let text = 'Early warning: not enough data yet'
  if (report.early) {
    icon = <StatusIcon status="warn" size={15} />
    text = `Early warning: ${top.short}${report.early > 1 ? ` (+${report.early - 1} more)` : ''}`
  } else if (report.watch) {
    icon = <Info className="h-[15px] w-[15px] text-dim" aria-hidden="true" />
    text = `No early warnings · ${report.watch} worth watching`
  } else if (report.checked.length) {
    icon = <StatusIcon status="ok" size={15} />
    text = 'No early warnings'
  }
  return (
    <p className="mt-3 flex items-start gap-2 border-t border-line pt-3 text-sm" data-early-warning={report.early ? 'early' : report.watch ? 'watch' : report.checked.length ? 'calm' : 'none'}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className={report.early ? 'min-w-0 text-ink' : 'min-w-0 text-soft'}>{text}</span>
    </p>
  )
}
