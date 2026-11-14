import type { SourceKey } from './sanitize'

/** One feed as the server (or the browser in demo mode) holds it. `data` is whitelisted upstream JSON, or null. */
export type SourceState = {
  ok: boolean
  /** 'ok' | 'error' | 'empty' (server) */
  status?: string
  /** When this copy was fetched from NASA/NOAA (ISO, UTC). */
  fetchedAt: string | null
  /** Short reason when the last refresh failed (the previous copy is still served). */
  error: string | null
  data: unknown
}

/**
 * Where the numbers on screen came from:
 *   server  our API's shared cache (refreshed from NASA/NOAA every 5–15 min)
 *   direct  the browser asked NASA/NOAA itself (demo mode or API unavailable)
 *   cache   this device's last good copy (offline)
 *   sample  the copy bundled with the app (real events, fixed date), when nothing else is available
 */
export type Origin = 'server' | 'direct' | 'cache' | 'sample'

export type Snapshot = {
  origin: Origin
  /** When this browser received it (ISO). */
  receivedAt: string
  /** Bundled sample only: when the sample was captured. */
  capturedAt?: string
  window?: { start: string; end: string }
  sources: Partial<Record<SourceKey, SourceState>>
}

/** Response of GET /api/index.php?r=spaceweather */
export type ServerPayload = {
  sources: Partial<Record<SourceKey, SourceState & { ageSeconds?: number | null; stale?: boolean }>>
  window?: { start: string; end: string }
  serverTime?: string
}
