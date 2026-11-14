import { useEffect, useMemo, useState } from 'react'
import { analyse, type EarlyWarningReport, type Viewer } from '../../lib/earlyWarning'
import { CHECK_EVENT, loadCheck } from '../../lib/earlyWarning/fullCheck'
import type { FullCheck } from '../../lib/earlyWarning/news2'
import { useSession } from '../../lib/session'
import type { Measurement } from '../../lib/types'

/** Who is looking, and may they enter/see the device-local NEWS2 full check for this record? */
export function useViewer(crewId: number) {
  const { user } = useSession()
  const role = user?.role
  const viewer: Viewer = role === 'surgeon' || role === 'ground' ? 'staff' : 'self'
  const ownRecord = (role === 'astronaut' || role === 'member') && user?.crewId === crewId
  return { viewer, ownRecord, hidePrivate: role === 'ground' }
}

/** Early-warning report for one record. Rows come from the caller (the page already has them). */
export function useEarlyWarning(rows: Measurement[], crewId: number): { report: EarlyWarningReport | null; check: FullCheck | null } {
  const { mission } = useSession()
  const { viewer, ownRecord, hidePrivate } = useViewer(crewId)
  const [check, setCheck] = useState<FullCheck | null>(() => (ownRecord ? loadCheck(crewId) : null))
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setCheck(ownRecord ? loadCheck(crewId) : null)
    const on = () => {
      setCheck(ownRecord ? loadCheck(crewId) : null)
      setNow(Date.now())
    }
    window.addEventListener(CHECK_EVENT, on)
    return () => window.removeEventListener(CHECK_EVENT, on)
  }, [crewId, ownRecord])

  // "Now" moves on whenever the readings change (a new reading should count as fresh).
  useEffect(() => setNow(Date.now()), [rows])

  const report = useMemo(
    () => (mission && rows.length ? analyse(rows, { today: mission.day, ctx: mission.context, hidePrivate, now, check, viewer }) : null),
    [rows, mission, hidePrivate, now, check, viewer],
  )
  return { report, check }
}
