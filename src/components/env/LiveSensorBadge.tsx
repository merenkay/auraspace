// Header indicator for the Arduino sensor station. Mounted once in the app shell, so it also binds the app-level
// live store to the signed-in person's station and keeps the stored cabin readings cached for the voice
// assistant. Visible only while a sensor is connected / reconnecting, or while the live gas alarm is active.
import { Flame, Plug } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router'
import { LOOKBACK_MS } from '../../lib/cabinLink/context'
import { setStoredCabin } from '../../lib/cabinLink/current'
import { loadHistory, loadLatest, stationFor } from '../../lib/envStation'
import { tempOutOfBand } from '../../lib/serial/envLive'
import { useSession } from '../../lib/session'
import { cx } from '../ui'
import { useEnvLive, useEnvLiveBinding } from './useEnvLive'

const CACHE_EVERY_MS = 60_000

function useStoredCabinCache() {
  const { user } = useSession()
  const station = stationFor(user)?.id ?? null
  useEffect(() => {
    if (!station) {
      setStoredCabin(null)
      return
    }
    let alive = true
    const run = async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      try {
        const [h, l] = await Promise.all([loadHistory(station, LOOKBACK_MS / 60_000), loadLatest(station)])
        if (alive) setStoredCabin({ station, rows: h.rows, latest: l.row, skewMs: l.skewMs })
      } catch {
        /* unknown stays unknown */
      }
    }
    void run()
    const id = setInterval(run, CACHE_EVERY_MS)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [station])
}

export default function LiveSensorBadge({ className }: { className?: string }) {
  useEnvLiveBinding()
  useStoredCabinCache()
  const s = useEnvLive()
  const alarmOn = !!s.alarm && s.alarm.endedAt == null
  const linked = s.connected || s.status === 'reconnecting'
  if (!alarmOn && !linked) return null

  if (alarmOn) {
    return (
      <Link
        to="/environment"
        role="alert"
        data-testid="sensor-badge"
        title="The flammable-gas sensor is at its alarm level. Open the Environment page for what to do."
        className={cx('inline-flex min-h-9 items-center gap-1.5 rounded-full border border-crit bg-crit/15 px-2.5 py-1 text-xs font-semibold text-crit', className)}
      >
        <Flame className="h-3.5 w-3.5" aria-hidden="true" />
        Gas alarm
      </Link>
    )
  }

  const t = s.latest?.fresh ? s.latest.t : null
  const live = s.status === 'live'
  const label = live ? (t != null ? `${t.toFixed(1)} °C` : 'Live') : s.status === 'reconnecting' ? 'Reconnecting' : 'No signal'
  return (
    <Link
      to="/environment"
      data-testid="sensor-badge"
      title={live ? `Cabin sensor connected — latest temperature ${t != null ? `${t.toFixed(1)} °C` : 'not reported'}. Open the Environment page.` : s.message}
      aria-label={`Sensor station: ${label}`}
      className={cx(
        'inline-flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs',
        live ? (tempOutOfBand(t) ? 'border-warn/50 text-warn' : 'border-line text-ink') : 'border-warn/50 text-warn',
        className,
      )}
    >
      {live ? <span className="h-1.5 w-1.5 animate-live rounded-full bg-accent" aria-hidden="true" /> : <Plug className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </Link>
  )
}
