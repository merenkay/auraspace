// Loads the signed-in user's sensor-station history (same station scoping as the Environment page) and
// derives the cabin-air context. Refreshes every 30 s. Simulated readings are never stored, so they never
// reach the consultation.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Context } from '../../data/contexts'
import { deriveCabinContext, LOOKBACK_MS, type CabinContext } from '../../lib/cabinLink/context'
import { cabinWithLive, setStoredCabin } from '../../lib/cabinLink/current'
import { useEnvLive } from '../env/useEnvLive'
import type { Answers } from '../../lib/doctor/engine'
import { FINDING_BY_ID } from '../../lib/doctor/findings'
import { loadHistory, loadLatest, stationFor, type EnvRow } from '../../lib/envStation'
import { useSession } from '../../lib/session'

const REFRESH_MS = 30_000

export type CabinData = { cabin: CabinContext | null; rows: EnvRow[]; skewMs: number; loading: boolean; station: string | null; reload: () => void }

export function useCabinContext(ctx: Context, minutes = LOOKBACK_MS / 60_000): CabinData {
  const { user } = useSession()
  const station = stationFor(user)?.id ?? null
  const [state, setState] = useState<Omit<CabinData, 'reload' | 'station'> & { latest: EnvRow | null }>({ cabin: null, rows: [], latest: null, skewMs: 0, loading: true })

  const load = useCallback(async () => {
    if (!station) {
      setState({ cabin: deriveCabinContext({ rows: [], now: Date.now(), context: ctx }), rows: [], latest: null, skewMs: 0, loading: false })
      return
    }
    try {
      const [h, l] = await Promise.all([loadHistory(station, Math.max(minutes, LOOKBACK_MS / 60_000)), loadLatest(station)])
      const now = Date.now()
      setStoredCabin({ station, rows: h.rows, latest: l.row, skewMs: l.skewMs })
      setState({ cabin: deriveCabinContext({ rows: h.rows, latest: l.row, now, context: ctx, skewMs: l.skewMs }), rows: h.rows, latest: l.row, skewMs: l.skewMs, loading: false })
    } catch {
      // unknown is reported as "no recent readings", never as normal air
      setState({ cabin: deriveCabinContext({ rows: [], now: Date.now(), context: ctx }), rows: [], latest: null, skewMs: 0, loading: false })
    }
  }, [station, ctx, minutes])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(t)
  }, [load])

  // Live sensor readings (app-level store) are fresh by definition: fold them in every 10-s bucket.
  const live = useEnvLive()
  const liveKey = live.connected && live.stationId === station && live.latest ? Math.floor(live.latest.at / 10_000) : 0
  const cabin = useMemo(
    () => (state.loading && !liveKey ? state.cabin : cabinWithLive({ rows: state.rows, latest: state.latest, skewMs: state.skewMs, station, context: ctx })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, liveKey, station, ctx],
  )
  return { cabin, rows: state.rows, skewMs: state.skewMs, loading: state.loading, station, reload: () => void load() }
}

/* ------------------------------------------------ hand-off to the consultation */

const HANDOFF_KEY = 'aura.cabinlink.handoff.v1'
const HANDOFF_MAX_AGE_MS = 10 * 60_000

/** The Environment page's "Anyone with symptoms?" checklist hands its ticks to the consultation (one shot). */
export function setCabinHandoff(findings: string[]) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ findings, at: Date.now() }))
  } catch {
    /* storage blocked: the consultation simply starts empty */
  }
}

export function takeCabinHandoff(): string[] {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    sessionStorage.removeItem(HANDOFF_KEY)
    if (!raw) return []
    const d = JSON.parse(raw) as { findings?: unknown; at?: unknown }
    if (typeof d.at !== 'number' || Date.now() - d.at > HANDOFF_MAX_AGE_MS || !Array.isArray(d.findings)) return []
    return d.findings.filter((x): x is string => typeof x === 'string').slice(0, 12)
  } catch {
    return []
  }
}

/** Consultation side of the hand-off: on mount, applies the ticked symptoms once (as "yes" answers). */
export function useCabinPrefill(apply: (answers: Answers, said: string) => void) {
  const ref = useRef(apply)
  ref.current = apply
  useEffect(() => {
    const ids = takeCabinHandoff().filter((id) => FINDING_BY_ID[id])
    if (!ids.length) return
    const said = `From the air check on the Environment page: ${ids.map((id) => FINDING_BY_ID[id].label.toLowerCase()).join('; ')}`
    ref.current(Object.fromEntries(ids.map((id) => [id, 'yes' as const])), said)
  }, [])
}
