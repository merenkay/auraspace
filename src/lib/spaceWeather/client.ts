// Loads space weather in this order:
//   1. server mode: our API (GET spaceweather) — one shared cache for everyone, refreshed from NASA/NOAA every 5–15 min
//   2. the browser asks NASA DONKI / NOAA SWPC directly (both send CORS headers) — demo mode, or when the API fails
//   3. this device's last good copy (localStorage) — offline
//   4. the copy bundled with the app (real events captured 14 Nov 2026), labelled "saved sample"
// Feeds missing from one step are filled from the next where possible, each keeping its own fetch time.
import { apiCall, getBackend } from '../api'
import { SOURCE_KEYS, sanitizeSource, type SourceKey } from './sanitize'
import type { Origin, ServerPayload, Snapshot, SourceState } from './types'
import { upstreamUrls, windowFor } from './upstream'

export const CACHE_KEY = 'aura.spaceweather.v1'
const DIRECT_TIMEOUT_MS = 12000

const hasData = (s: SourceState | undefined) => !!s && s.data != null

export function readCache(): Snapshot | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Snapshot
    if (!v || typeof v !== 'object' || !v.sources || typeof v.sources !== 'object') return null
    // re-apply the whitelist: the copy on this device is not trusted more than the network
    const sources: Snapshot['sources'] = {}
    for (const k of SOURCE_KEYS) {
      const s = v.sources[k]
      if (!s || typeof s !== 'object') continue
      sources[k] = { ok: !!s.ok, fetchedAt: typeof s.fetchedAt === 'string' ? s.fetchedAt : null, error: typeof s.error === 'string' ? s.error : null, data: s.data == null ? null : sanitizeSource(k, s.data) }
    }
    return { origin: v.origin === 'sample' ? 'sample' : 'cache', receivedAt: typeof v.receivedAt === 'string' ? v.receivedAt : new Date(0).toISOString(), capturedAt: v.capturedAt, window: v.window, sources }
  } catch {
    return null
  }
}

export function writeCache(s: Snapshot): void {
  if (s.origin === 'sample') return
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(s))
  } catch {
    /* storage full or blocked: we only lose the offline copy */
  }
}

/** The bundled sample (loaded on demand so it is not part of the main bundle). */
export async function loadSample(): Promise<Snapshot> {
  const mod = await import('../../data/spaceweather/sample.json')
  const raw = (mod.default ?? mod) as unknown as { capturedAt: string; window: { start: string; end: string }; sources: Record<string, SourceState> }
  const sources: Snapshot['sources'] = {}
  for (const k of SOURCE_KEYS) {
    const s = raw.sources[k]
    if (s) sources[k] = { ok: true, status: 'ok', fetchedAt: s.fetchedAt ?? raw.capturedAt, error: null, data: sanitizeSource(k, s.data) }
  }
  return { origin: 'sample', receivedAt: new Date().toISOString(), capturedAt: raw.capturedAt, window: raw.window, sources }
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // no cookies, no referrer: NASA/NOAA learn nothing about the person or the app beyond the request itself
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
  }
}

/** Asks NASA DONKI and NOAA SWPC directly for the given feeds. Failed feeds come back with `data: null` and an error. */
export async function fetchDirect(keys: SourceKey[] = SOURCE_KEYS, now = Date.now()): Promise<Snapshot['sources']> {
  const urls = upstreamUrls(now)
  const results = await Promise.allSettled(keys.map((k) => fetchJson(urls[k], DIRECT_TIMEOUT_MS)))
  const out: Snapshot['sources'] = {}
  keys.forEach((k, i) => {
    const r = results[i]
    const data = r.status === 'fulfilled' ? sanitizeSource(k, r.value) : null
    out[k] =
      data != null
        ? { ok: true, status: 'ok', fetchedAt: new Date().toISOString(), error: null, data }
        : { ok: false, status: 'error', fetchedAt: null, error: r.status === 'rejected' ? 'Upstream unreachable' : 'Unexpected format', data: null }
  })
  return out
}

/** Fills feeds without data in `into` from `from`, keeping the older copy's own fetch time and the newer error. */
export function mergeMissing(into: Snapshot['sources'], from: Snapshot['sources'] | undefined): Snapshot['sources'] {
  const out = { ...into }
  if (!from) return out
  for (const k of SOURCE_KEYS) {
    if (!hasData(out[k]) && hasData(from[k])) out[k] = { ...from[k]!, ok: false, error: out[k]?.error ?? from[k]!.error ?? null }
  }
  return out
}

const anyData = (s: Snapshot['sources']) => SOURCE_KEYS.some((k) => hasData(s[k]))

function fromServer(p: ServerPayload): Snapshot['sources'] {
  const out: Snapshot['sources'] = {}
  for (const k of SOURCE_KEYS) {
    const s = p.sources?.[k]
    if (!s) continue
    out[k] = { ok: !!s.ok, status: s.status, fetchedAt: s.fetchedAt ?? null, error: s.error ?? null, data: s.data == null ? null : sanitizeSource(k, s.data) }
  }
  return out
}

export type LoadDeps = {
  mode?: () => Promise<'server' | 'demo'>
  server?: () => Promise<ServerPayload>
  direct?: (keys: SourceKey[]) => Promise<Snapshot['sources']>
  cache?: () => Snapshot | null
  sample?: () => Promise<Snapshot>
  save?: (s: Snapshot) => void
  now?: () => number
}

/** Loads the best available copy (see the order at the top of this file). Never throws. Dependencies are injectable for tests. */
export async function loadSpaceWeather(deps: LoadDeps = {}): Promise<Snapshot> {
  const now = deps.now ?? Date.now
  const mode = deps.mode ?? (async () => (await getBackend()).mode)
  const server = deps.server ?? (() => apiCall<ServerPayload>('spaceweather'))
  const direct = deps.direct ?? ((keys: SourceKey[]) => fetchDirect(keys, now()))
  const cache = deps.cache ?? readCache
  const sample = deps.sample ?? loadSample
  const save = deps.save ?? writeCache

  let sources: Snapshot['sources'] = {}
  let origin: Origin | null = null
  let win: Snapshot['window']

  try {
    if ((await mode()) === 'server') {
      const p = await server()
      sources = fromServer(p)
      win = p.window
      if (anyData(sources)) origin = 'server'
    }
  } catch {
    /* API down or not installed: ask NASA/NOAA directly */
  }

  const missing = SOURCE_KEYS.filter((k) => !hasData(sources[k]))
  if (missing.length) {
    try {
      const d = await direct(missing)
      const before = anyData(sources)
      sources = { ...sources, ...Object.fromEntries(missing.filter((k) => d[k]).map((k) => [k, hasData(d[k]) ? d[k] : { ...d[k]!, error: sources[k]?.error ?? d[k]!.error }])) }
      if (!before && anyData(sources)) origin = 'direct'
      win = win ?? windowFor(now())
    } catch {
      /* offline */
    }
  }

  const cached = cache()
  if (origin) {
    const snap: Snapshot = { origin, receivedAt: new Date(now()).toISOString(), window: win, sources: mergeMissing(sources, cached?.sources) }
    save(snap)
    return snap
  }
  if (cached && anyData(cached.sources)) return { ...cached, origin: cached.origin === 'sample' ? 'sample' : 'cache' }
  return sample()
}
