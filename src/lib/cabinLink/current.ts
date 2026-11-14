// The cabin-air context "right now", available synchronously anywhere (voice consultation, assistant):
// stored history cached by the app shell / consultation, merged with the live sensor store. Live readings are
// fresh by definition; with neither, the result says "no readings" — never "normal air".
import type { Context } from '../../data/contexts'
import type { EnvRow } from '../envStation'
import { envLive } from '../serial/envLive'
import { deriveCabinContext, type CabinContext } from './context'

type Cached = { station: string; rows: EnvRow[]; latest: EnvRow | null; skewMs: number }
let cached: Cached | null = null

export function setStoredCabin(c: Cached | null) {
  cached = c
}

/** Live row for the person's station (null when the sensor is not streaming or belongs to another station). */
export function liveCabinRow(station: string | null, now = Date.now()): EnvRow | null {
  const s = envLive.getSnapshot()
  if (!station || s.stationId !== station) return null
  return envLive.liveRow(now)
}

/** Stored rows + live row → environment context. */
export function cabinWithLive(input: { rows: EnvRow[]; latest: EnvRow | null; skewMs: number; station: string | null; context: Context; now?: number }): CabinContext {
  const now = input.now ?? Date.now()
  const live = liveCabinRow(input.station, now)
  // the live row uses this computer's clock: shift it into "server" time so one skew applies to all rows
  const liveShifted = live ? { ...live, at: new Date(Date.parse(live.at) - input.skewMs).toISOString() } : null
  const rows = liveShifted ? [...input.rows, liveShifted] : input.rows
  const latest = liveShifted ?? input.latest
  return deriveCabinContext({ rows, latest, now, context: input.context, skewMs: input.skewMs })
}

/** The best current context for `station` without any network call. */
export function currentCabin(context: Context, station: string | null = cached?.station ?? envLive.getSnapshot().stationId, now = Date.now()): CabinContext {
  const c = cached && cached.station === station ? cached : null
  return cabinWithLive({ rows: c?.rows ?? [], latest: c?.latest ?? null, skewMs: c?.skewMs ?? 0, station, context, now })
}
