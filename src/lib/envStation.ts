// AURA environment station: Arduino temperature / humidity / flammable-gas readings.
//
// This module holds everything that is not React: the tolerant line parser, the rules that turn a
// reading into a status, 10-second down-sampling, the local ring buffer (demo mode), the offline
// upload queue (server mode), history fetches and the simulator.
//
// Station scoping (mirrors public/api/routes/env.php):
//   - demo crew (astronaut) + staff (surgeon, ground) share ONE station: "mission" (the simulated cabin)
//   - a registered member has a private station "m<crewId>" that only they can read or write
// Simulated values never enter the history, the queue or the server.
import { CABIN_LIMITS } from '../data/missions'
import { apiCall, ApiError, getBackend } from './api'
import type { User } from './types'

/* ----------------------------------------------------------------- constants */

export const STALE_AFTER_MS = 5_000 // no packet for 5 s while connected = "no recent data", never "normal"
export const BUCKET_MS = 10_000 // one averaged row per 10 s goes to storage
export const LIVE_WINDOW_MS = 5 * 60_000 // live chart shows the last 5 minutes
export const STORED_STALE_MS = 3 * 60_000 // a stored reading older than this is "old data"
export const LOCAL_HISTORY_MAX = 2_160 // 6 h of 10-s rows per station in localStorage (~250 kB)
export const QUEUE_MAX = 2_000 // offline upload queue cap (oldest dropped first)
export const QUEUE_MAX_AGE_MS = 7 * 86_400_000 // the server rejects rows older than 7 days
export const BATCH_MAX = 60 // rows per upload request (server enforces the same cap)
export const FLUSH_EVERY_MS = 20_000
export const GAS_MEDIAN_OF = 3 // gas status uses the median of the last 3 one-second samples

/** AURA demo thresholds for the gas ratio (reading ÷ clean-air baseline). Not a safety standard. */
export const GAS_WARN_RATIO = 1.5
export const GAS_ALARM_RATIO = 2.0

/** Plausible ranges; anything outside is treated as a failed read (null), never shown as a value. */
export const RANGE = { t: [-40, 85], h: [0, 100], gas: [0, 4095] } as const

/* --------------------------------------------------------------------- types */

/** One parsed packet. undefined = the sketch did not send the field; null = the sensor read failed. */
export type Sample = { at: number; t?: number | null; h?: number | null; gas?: number | null; warm?: number | null }

export type DeviceInfo = { name: string; fw?: string; dht?: string; gasSensor?: string; gasPin?: string; warmupS?: number }

export type Parsed = { kind: 'sample'; sample: Omit<Sample, 'at'> } | { kind: 'info'; info: DeviceInfo } | { kind: 'noise' }

/** A stored row: the average of up to 10 one-second samples. `at` is the start of the 10-s bucket (ISO, UTC). */
export type EnvRow = {
  at: string
  t: number | null
  h: number | null
  gas: number | null // mean raw ADC value in the bucket
  gasMax: number | null // highest raw ADC value in the bucket
  base: number | null // clean-air baseline in use when the row was made
  ratio?: number | null // gasMax ÷ base (the server also computes it)
  n: number // number of one-second samples averaged
  device?: string
}

export type Level = 'ok' | 'warn' | 'crit' | 'none'
export type Eval = { level: Level; label: string; detail: string }

export type Station = { id: string; label: string; shared: boolean; who: string }

export type Baseline = { value: number; at: string }

/* ------------------------------------------------------------------- station */

export function stationFor(user: User | null): Station | null {
  if (!user) return null
  if (user.role === 'member') {
    if (user.crewId == null) return null
    return { id: `m${user.crewId}`, label: 'Your private sensor station', shared: false, who: 'Only you can see these readings.' }
  }
  return {
    id: 'mission',
    label: 'Mission cabin station',
    shared: true,
    who: 'Shared by the demo crew, the flight surgeon and mission control.',
  }
}

/* -------------------------------------------------------------------- parser */

type Field = 't' | 'h' | 'gas' | 'warm'
const ALIASES: Record<string, Field> = {
  t: 't', temp: 't', temperature: 't', tc: 't', temp_c: 't', tempc: 't', celsius: 't', 'temp-c': 't',
  h: 'h', hum: 'h', humidity: 'h', humid: 'h', rh: 'h',
  gas: 'gas', mq2: 'gas', 'mq-2': 'gas', mq: 'gas', smoke: 'gas', lpg: 'gas', gas_raw: 'gas', gasraw: 'gas', a0: 'gas', analog: 'gas',
  warm: 'warm', warmup: 'warm', warming: 'warm', warm_s: 'warm',
}

const normKey = (k: string) => k.toLowerCase().split(/[([]/)[0].replace(/[^a-z0-9_-]/g, '')

function toValue(v: unknown): number | null | undefined {
  if (v === null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (s === '' || s === 'nan' || s === 'null' || s === 'inf' || s === '-inf' || s === 'err' || s === 'error') return null
    if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
    return null
  }
  return undefined // booleans, objects: ignore the field
}

function inRange(f: Field, v: number | null | undefined): number | null | undefined {
  if (v == null) return v
  if (f === 'warm') return v >= 0 && v <= 86_400 ? Math.round(v) : undefined
  const [lo, hi] = RANGE[f]
  return v >= lo && v <= hi ? v : null
}

function fromPairs(pairs: [string, unknown][]): Parsed {
  const out: Omit<Sample, 'at'> = {}
  let found = false
  for (const [k, raw] of pairs) {
    // "°C  Gas=300" yields the key "C  Gas": fall back to its last word
    const f = ALIASES[normKey(k)] ?? ALIASES[normKey(k.trim().split(/\s+/).pop() ?? '')]
    if (!f || f in out) continue
    const v = inRange(f, toValue(raw))
    if (v === undefined) continue
    out[f] = v
    found = true
  }
  return found ? { kind: 'sample', sample: out } : { kind: 'noise' }
}

function infoFrom(obj: Record<string, unknown>): DeviceInfo {
  const str = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, 40) : undefined)
  const warm = Number(obj.warmup_s ?? obj.warmup)
  return {
    name: str(obj.hello ?? obj.device ?? obj.info) ?? 'sensor',
    fw: str(obj.fw),
    dht: str(obj.dht),
    gasSensor: str(obj.gas_sensor ?? obj.gasSensor),
    gasPin: str(obj.gas_pin ?? obj.gasPin),
    warmupS: Number.isFinite(warm) ? warm : undefined,
  }
}

/**
 * Tolerant parser for one serial line. Accepts JSON objects (also with boot garbage around them),
 * key aliases (temp/temperature, hum/humidity, gas/mq2/smoke ...) and plain text such as
 * "Temperature: 23.4 Humidity: 41 Gas=300". Anything else is "noise".
 */
export function parseLine(raw: string): Parsed {
  // eslint-disable-next-line no-control-regex
  const line = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f﻿�]/g, '').trim()
  if (!line || line.length > 512) return { kind: 'noise' }
  const a = line.indexOf('{')
  const b = line.lastIndexOf('}')
  if (a >= 0 && b > a) {
    try {
      const obj: unknown = JSON.parse(line.slice(a, b + 1))
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const rec = obj as Record<string, unknown>
        if (typeof rec.hello === 'string' || typeof rec.device === 'string' || typeof rec.info === 'string') return { kind: 'info', info: infoFrom(rec) }
        return fromPairs(Object.entries(rec))
      }
    } catch {
      /* broken JSON (e.g. "t":nan): fall through to the text parser */
    }
  }
  const pairs: [string, unknown][] = []
  const re = /["']?([A-Za-z][A-Za-z0-9 _-]*?)["']?\s*(?:\([^)]*\))?\s*[:=]\s*["']?(-?\d+(?:\.\d+)?|nan|null|inf|err(?:or)?)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) pairs.push([m[1].trim(), m[2]])
  return pairs.length ? fromPairs(pairs) : { kind: 'noise' }
}

/* --------------------------------------------------------------------- rules */

const fmt1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1)

export function evalTemp(v: number | null | undefined): Eval {
  if (v === undefined) return { level: 'none', label: 'NO DATA', detail: 'The sensor does not report temperature.' }
  if (v === null) return { level: 'none', label: 'SENSOR ERROR', detail: 'The temperature sensor did not answer. Check the DHT wiring.' }
  if (v < CABIN_LIMITS.tempMin) return { level: 'warn', label: 'ATTENTION', detail: `Below ${CABIN_LIMITS.tempMin} °C` }
  if (v > CABIN_LIMITS.tempMax) return { level: 'warn', label: 'ATTENTION', detail: `Above ${CABIN_LIMITS.tempMax} °C` }
  return { level: 'ok', label: 'NORMAL', detail: `Within ${CABIN_LIMITS.tempMin}–${CABIN_LIMITS.tempMax} °C` }
}

export function evalHum(v: number | null | undefined): Eval {
  if (v === undefined) return { level: 'none', label: 'NO DATA', detail: 'The sensor does not report humidity.' }
  if (v === null) return { level: 'none', label: 'SENSOR ERROR', detail: 'The humidity sensor did not answer. Check the DHT wiring.' }
  if (v < CABIN_LIMITS.rhMin) return { level: 'warn', label: 'ATTENTION', detail: `Below ${CABIN_LIMITS.rhMin} % (too dry)` }
  if (v > CABIN_LIMITS.rhMax) return { level: 'warn', label: 'ATTENTION', detail: `Above ${CABIN_LIMITS.rhMax} % (too damp)` }
  return { level: 'ok', label: 'NORMAL', detail: `Within ${CABIN_LIMITS.rhMin}–${CABIN_LIMITS.rhMax} %` }
}

export function evalGas(input: { raw: number | null | undefined; ratio: number | null; base: number | null; warm: number | null | undefined }): Eval {
  const { raw, ratio, base, warm } = input
  if (raw === undefined) return { level: 'none', label: 'NO DATA', detail: 'The sensor does not report a gas value.' }
  if (raw === null) return { level: 'none', label: 'SENSOR ERROR', detail: 'The gas value was missing or out of range.' }
  if (warm != null && warm > 0) return { level: 'none', label: 'WARMING UP', detail: `Gas sensor heater warming up — alarm paused for ${warm} s.` }
  if (base == null || ratio == null) return { level: 'none', label: 'NO BASELINE', detail: 'Set a clean-air baseline to enable the gas alarm.' }
  if (ratio >= GAS_ALARM_RATIO) return { level: 'crit', label: 'GAS ALARM', detail: `${fmt1(ratio)}× baseline (alarm at ${GAS_ALARM_RATIO}×)` }
  if (ratio >= GAS_WARN_RATIO) return { level: 'warn', label: 'ATTENTION', detail: `${fmt1(ratio)}× baseline (attention at ${GAS_WARN_RATIO}×)` }
  return { level: 'ok', label: 'NORMAL', detail: `Below ${GAS_WARN_RATIO}× baseline` }
}

export const STALE_EVAL: Eval = { level: 'none', label: 'NO RECENT DATA', detail: 'No new reading — this value may be out of date.' }

/* ----------------------------------------------------------------- smoothing */

export function median(values: number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((x, y) => x - y)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Median of the last `n` valid gas values received within the last `withinMs` (filters single spikes). */
export function recentGas(samples: Sample[], now: number, n = GAS_MEDIAN_OF, withinMs = STALE_AFTER_MS): number | null {
  const vals: number[] = []
  for (let i = samples.length - 1; i >= 0 && vals.length < n; i--) {
    const s = samples[i]
    if (now - s.at > withinMs) break
    if (typeof s.gas === 'number') vals.push(s.gas)
  }
  return median(vals)
}

export const ratioOf = (gas: number | null | undefined, base: number | null | undefined) =>
  typeof gas === 'number' && typeof base === 'number' && base > 0 ? Math.round((gas / base) * 100) / 100 : null

/** Peak ratio for a stored row (uses the bucket's highest value so short spikes are not averaged away). */
export const rowRatio = (r: EnvRow) => (r.ratio != null ? r.ratio : ratioOf(r.gasMax ?? r.gas, r.base))

/* -------------------------------------------------------------- down-sampling */

/** Averages one-second live samples into one row per 10-second bucket. */
export class Downsampler {
  private key = -1
  private tSum = 0
  private tN = 0
  private hSum = 0
  private hN = 0
  private gSum = 0
  private gN = 0
  private gMax = -1
  private n = 0
  private base: number | null = null
  private device = ''
  private readonly onRow: (row: EnvRow) => void
  private readonly bucketMs: number

  constructor(onRow: (row: EnvRow) => void, bucketMs = BUCKET_MS) {
    this.onRow = onRow
    this.bucketMs = bucketMs
  }

  push(s: Sample, base: number | null, device: string) {
    const k = Math.floor(s.at / this.bucketMs)
    if (k !== this.key) {
      this.flush()
      this.key = k
    }
    this.n++
    this.base = base
    this.device = device
    if (typeof s.t === 'number') {
      this.tSum += s.t
      this.tN++
    }
    if (typeof s.h === 'number') {
      this.hSum += s.h
      this.hN++
    }
    // gas values taken while the heater warms up are not trustworthy: keep them out of storage
    if (typeof s.gas === 'number' && !(s.warm != null && s.warm > 0)) {
      this.gSum += s.gas
      this.gN++
      this.gMax = Math.max(this.gMax, s.gas)
    }
  }

  flush() {
    if (this.key >= 0 && this.n > 0 && (this.tN || this.hN || this.gN)) {
      const gas = this.gN ? Math.round((this.gSum / this.gN) * 10) / 10 : null
      const gasMax = this.gN ? Math.round(this.gMax) : null
      this.onRow({
        at: new Date(this.key * this.bucketMs).toISOString(),
        t: this.tN ? Math.round((this.tSum / this.tN) * 100) / 100 : null,
        h: this.hN ? Math.round((this.hSum / this.hN) * 100) / 100 : null,
        gas,
        gasMax,
        base: this.base,
        ratio: ratioOf(gasMax, this.base),
        n: this.n,
        device: this.device || undefined,
      })
    }
    this.key = -1
    this.tSum = this.tN = this.hSum = this.hN = this.gSum = this.gN = this.n = 0
    this.gMax = -1
  }
}

/* ------------------------------------------------------------ local storage */

const histKey = (station: string) => `aura.env.hist.v1.${station}`
const baseKey = (station: string) => `aura.env.base.v1.${station}`
const QUEUE_KEY = 'aura.env.queue.v1'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false // storage full or blocked: data lives for this page only
  }
}

const isRow = (r: unknown): r is EnvRow => !!r && typeof r === 'object' && typeof (r as EnvRow).at === 'string' && !Number.isNaN(Date.parse((r as EnvRow).at))

export function readLocalHistory(station: string): EnvRow[] {
  const rows = readJson<unknown>(histKey(station), [])
  return Array.isArray(rows) ? rows.filter(isRow) : []
}

/** Appends rows to the station's bounded ring buffer (sorted, de-duplicated by bucket time). */
export function appendLocalHistory(station: string, rows: EnvRow[]) {
  if (!rows.length) return
  const byAt = new Map(readLocalHistory(station).map((r) => [r.at, r]))
  for (const r of rows) if (!byAt.has(r.at)) byAt.set(r.at, r)
  let all = [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at))
  if (all.length > LOCAL_HISTORY_MAX) all = all.slice(all.length - LOCAL_HISTORY_MAX)
  // if the browser storage is full, keep halving until it fits
  while (!writeJson(histKey(station), all) && all.length > 50) all = all.slice(all.length >> 1)
}

export function clearLocalHistory(station: string) {
  try {
    localStorage.removeItem(histKey(station))
  } catch {
    /* ignore */
  }
}

export const localHistoryKey = histKey

export function readBaseline(station: string): Baseline | null {
  const b = readJson<Baseline | null>(baseKey(station), null)
  return b && typeof b.value === 'number' && b.value > 0 && b.value <= RANGE.gas[1] ? b : null
}

export function saveBaseline(station: string, value: number | null): Baseline | null {
  if (value == null) {
    try {
      localStorage.removeItem(baseKey(station))
    } catch {
      /* ignore */
    }
    return null
  }
  const b: Baseline = { value: Math.round(value), at: new Date().toISOString() }
  writeJson(baseKey(station), b)
  return b
}

/* ------------------------------------------------------------- upload queue */

type QueueItem = { u: number; s: string; r: EnvRow; q: number }

function readQueue(): QueueItem[] {
  const q = readJson<unknown>(QUEUE_KEY, [])
  if (!Array.isArray(q)) return []
  const cutoff = Date.now() - QUEUE_MAX_AGE_MS
  return q.filter((i): i is QueueItem => !!i && typeof i.u === 'number' && typeof i.s === 'string' && isRow(i.r) && Date.parse(i.r.at) > cutoff)
}
function writeQueue(q: QueueItem[]) {
  let items = q.length > QUEUE_MAX ? q.slice(q.length - QUEUE_MAX) : q
  while (!writeJson(QUEUE_KEY, items) && items.length > 50) items = items.slice(items.length >> 1)
}

export function queueRows(userId: number, station: string, rows: EnvRow[]) {
  if (!rows.length) return
  const now = Date.now()
  writeQueue([...readQueue(), ...rows.map((r) => ({ u: userId, s: station, r, q: now }))])
}

export function pendingCount(userId: number, station: string) {
  return readQueue().filter((i) => i.u === userId && i.s === station).length
}

export type FlushResult = { sent: number; pending: number; error: string | null }

let flushing: Promise<FlushResult> | null = null

/** Uploads this user's queued rows in batches of BATCH_MAX. Keeps rows on network/server errors and retries later. */
export function flushQueue(userId: number, station: string): Promise<FlushResult> {
  if (flushing) return flushing
  flushing = (async (): Promise<FlushResult> => {
    let sent = 0
    let error: string | null = null
    try {
      const b = await getBackend()
      if (b.mode !== 'server') return { sent: 0, pending: 0, error: null }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return { sent: 0, pending: pendingCount(userId, station), error: 'Offline — readings are kept in this browser and sent later.' }
      }
      for (let round = 0; round < 40; round++) {
        const mine = readQueue().filter((i) => i.u === userId && i.s === station)
        if (!mine.length) break
        const batch = mine.slice(0, BATCH_MAX)
        let drop = false
        try {
          const res = await apiCall<{ ok: boolean; inserted: number; rejected?: number }>('env/readings', { method: 'POST', body: { source: 'live', rows: batch.map((i) => i.r) } })
          sent += batch.length - (res.rejected ?? 0)
          if (res.rejected) error = `The server refused ${res.rejected} reading(s) with an impossible time or value — check this computer's clock.`
          drop = true
        } catch (e) {
          const status = e instanceof ApiError ? e.status : 0
          if (status >= 400 && status < 500 && ![401, 408, 429].includes(status)) {
            drop = true // the server refused these rows for good (validation / not allowed): do not retry forever
            error = `The server refused ${batch.length} reading(s): ${e instanceof Error ? e.message : 'invalid data'}`
          } else {
            error = status === 401 ? 'Signed out — readings are kept and sent after you sign in again.' : 'Server not reachable — readings are kept in this browser and sent later.'
          }
        }
        if (!drop) break
        const sentAt = new Set(batch.map((i) => i.r.at))
        writeQueue(readQueue().filter((i) => !(i.u === userId && i.s === station && sentAt.has(i.r.at))))
      }
    } finally {
      flushing = null
    }
    return { sent, pending: pendingCount(userId, station), error }
  })()
  return flushing
}

/* ------------------------------------------------------------------ history */

export type HistoryResult = { rows: EnvRow[]; from: 'server' | 'local'; error: string | null }

function localSince(station: string, minutes: number): EnvRow[] {
  const since = Date.now() - minutes * 60_000
  return readLocalHistory(station).filter((r) => Date.parse(r.at) >= since)
}

/** Stored rows of the user's station for the last `minutes` (server: aggregated to ≤ ~720 points). */
export async function loadHistory(station: string, minutes: number): Promise<HistoryResult> {
  const b = await getBackend()
  if (b.mode !== 'server') return { rows: localSince(station, minutes), from: 'local', error: null }
  try {
    const d = await apiCall<{ rows: EnvRow[] }>('env/history', { query: { minutes } })
    const rows = Array.isArray(d.rows) ? d.rows.filter(isRow) : []
    // rows recorded in this browser that are not uploaded yet (the queue flushes every 20 s)
    const lastServer = rows.length ? Date.parse(rows[rows.length - 1].at) : 0
    const pending = localSince(station, minutes).filter((r) => Date.parse(r.at) > lastServer)
    return { rows: [...rows, ...pending], from: 'server', error: null }
  } catch (e) {
    return { rows: localSince(station, minutes), from: 'local', error: e instanceof Error ? e.message : 'Could not load stored readings' }
  }
}

export type LatestResult = { row: EnvRow | null; skewMs: number; from: 'server' | 'local'; error: string | null }

/** Newest stored row. skewMs = local clock minus server clock, so ages are right even if clocks differ. */
export async function loadLatest(station: string): Promise<LatestResult> {
  const b = await getBackend()
  const local = () => {
    const rows = readLocalHistory(station)
    return rows.length ? rows[rows.length - 1] : null
  }
  if (b.mode !== 'server') return { row: local(), skewMs: 0, from: 'local', error: null }
  try {
    const d = await apiCall<{ reading: EnvRow | null; serverTime: string }>('env/latest')
    const server = Date.parse(d.serverTime)
    return { row: d.reading && isRow(d.reading) ? d.reading : null, skewMs: Number.isFinite(server) ? Date.now() - server : 0, from: 'server', error: null }
  } catch (e) {
    return { row: local(), skewMs: 0, from: 'local', error: e instanceof Error ? e.message : 'Could not load the latest reading' }
  }
}

/* ---------------------------------------------------------------- simulator */

export const SIM_BASELINE = 180

/** Generates plausible SIMULATED readings (1 Hz). `leak()` plays a 45-second gas-leak scenario. */
export function createSimulator() {
  let t = 22.4
  let h = 41
  let leakAt: number | null = null
  const noise = (k: number) => (Math.random() - 0.5) * k
  return {
    leak(now = Date.now()) {
      leakAt = now
    },
    get leaking() {
      return leakAt != null
    },
    next(now = Date.now()): Sample {
      t = Math.min(26.5, Math.max(19.5, t + noise(0.12) + (22.4 - t) * 0.02))
      h = Math.min(60, Math.max(30, h + noise(0.6) + (41 - h) * 0.03))
      let gas = SIM_BASELINE + noise(10)
      if (leakAt != null) {
        const s = (now - leakAt) / 1000
        const factor = s < 8 ? 1 + (2.1 * s) / 8 : s < 23 ? 3.1 : s < 45 ? 3.1 - (2.1 * (s - 23)) / 22 : 1
        gas = SIM_BASELINE * factor + noise(14)
        if (s >= 45) leakAt = null
      }
      return { at: now, t: Math.round(t * 10) / 10, h: Math.round(h * 10) / 10, gas: Math.round(gas), warm: 0 }
    },
  }
}
