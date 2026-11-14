// State for the live sensor station: serial link, simulator, current values + rule statuses,
// 10-s recording (local ring buffer / server upload queue), stored history polling and the gas-alarm latch.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSerial } from '../../hooks/useSerial'
import {
  BUCKET_MS,
  Downsampler,
  FLUSH_EVERY_MS,
  LIVE_WINDOW_MS,
  STALE_AFTER_MS,
  STALE_EVAL,
  STORED_STALE_MS,
  SIM_BASELINE,
  appendLocalHistory,
  createSimulator,
  evalGas,
  evalHum,
  evalTemp,
  flushQueue,
  loadHistory,
  loadLatest,
  localHistoryKey,
  median,
  parseLine,
  pendingCount,
  queueRows,
  ratioOf,
  readBaseline,
  recentGas,
  rowRatio,
  saveBaseline,
  stationFor,
  type Baseline,
  type DeviceInfo,
  type EnvRow,
  type Eval,
  type HistoryResult,
  type LatestResult,
  type Parsed,
  type Sample,
} from '../../lib/envStation'
import { useSession } from '../../lib/session'

export type SourceMode = 'live' | 'sim' | 'stored' | 'none'
export type Field = { value: number | null | undefined; eval: Eval }
export type GasField = Field & { raw: number | null | undefined; ratio: number | null; base: number | null; warm: number | null }
/** startedAt = time of the first reading in alarm; last = newest ratio seen while the alarm was latched. */
export type AlarmState = { startedAt: number; endedAt: number | null; peak: number; last: number; mode: SourceMode; noData: boolean }

/**
 * Gas-alarm latch. Starts on a reading at/above the alarm ratio; ends only when a NEW, current reading is
 * below it. Missing or stale data never ends an alarm (it is flagged `noData` instead).
 */
function latchAlarm(prev: AlarmState | null, crit: boolean, ratio: number | null, noData: boolean, mode: SourceMode, at: number): AlarmState | null {
  const r = ratio ?? 0
  if (crit) {
    if (!prev || prev.endedAt != null) return { startedAt: at, endedAt: null, peak: r, last: r, mode, noData }
    if (r !== prev.last || r > prev.peak || prev.noData !== noData || prev.mode !== mode) return { ...prev, peak: Math.max(prev.peak, r), last: r, noData, mode }
    return prev
  }
  if (prev && prev.endedAt == null) {
    if (noData) return prev.noData ? prev : { ...prev, noData: true }
    return { ...prev, endedAt: Date.now(), noData: false }
  }
  return prev
}

export type ChartPoint = { x: number; t: number | null; h: number | null; g: number | null }

const POLL_MS = 10_000
const KEEP_SAMPLES_MS = 10 * 60_000
const BASELINE_WINDOW_MS = 10_000
const BASELINE_MIN_SAMPLES = 5

const atMs = (r: EnvRow) => Date.parse(r.at)

// parseLine never throws, but a corrupted line must never take the page down either.
function parseLineSafe(line: string): Parsed {
  try {
    return parseLine(line)
  } catch {
    return { kind: 'noise' }
  }
}

function lastField(samples: Sample[], f: 't' | 'h' | 'gas' | 'warm'): number | null | undefined {
  for (let i = samples.length - 1; i >= 0; i--) {
    const v = samples[i][f]
    if (v !== undefined) return v
  }
  return undefined
}

export function useEnvStation() {
  const { user, backend } = useSession()
  const station = useMemo(() => stationFor(user), [user])
  const stationId = station?.id ?? null
  const userId = user?.id ?? null
  const serverMode = backend?.mode === 'server'

  const samplesRef = useRef<Sample[]>([])
  const [, setTick] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [sim, setSim] = useState(false)
  const simRef = useRef<ReturnType<typeof createSimulator> | null>(null)
  const [simLeaking, setSimLeaking] = useState(false)
  const [device, setDevice] = useState<DeviceInfo | null>(null)
  const [noise, setNoise] = useState(0)
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [range, setRange] = useState(60)
  const [history, setHistory] = useState<HistoryResult & { loading: boolean }>({ rows: [], from: 'local', error: null, loading: true })
  const [latest, setLatest] = useState<LatestResult | null>(null)
  const [upload, setUpload] = useState<{ pending: number; lastSentAt: number | null; error: string | null }>({ pending: 0, lastSentAt: null, error: null })
  const [recorded, setRecorded] = useState(0)
  const [alarm, setAlarm] = useState<AlarmState | null>(null) // from real data (live sensor or stored)
  const [simAlarm, setSimAlarm] = useState<AlarmState | null>(null) // from the simulator only

  const baselineRef = useRef(baseline)
  baselineRef.current = baseline
  const deviceRef = useRef(device)
  deviceRef.current = device
  const rangeRef = useRef(range)
  rangeRef.current = range
  const ctxRef = useRef({ userId, serverMode })
  ctxRef.current = { userId, serverMode }
  const dsRef = useRef<Downsampler | null>(null)

  const pushSample = useCallback((s: Sample) => {
    const arr = samplesRef.current
    arr.push(s)
    const cutoff = s.at - KEEP_SAMPLES_MS
    let drop = 0
    while (drop < arr.length && arr[drop].at < cutoff) drop++
    if (drop) arr.splice(0, drop)
    setTick((t) => t + 1)
  }, [])

  /* ------------------------------------------------------------ recording */

  const recordRow = useCallback((st: string, row: EnvRow) => {
    appendLocalHistory(st, [row])
    const { userId: uid, serverMode: server } = ctxRef.current
    if (server && uid != null) {
      queueRows(uid, st, [row])
      setUpload((u) => ({ ...u, pending: pendingCount(uid, st) }))
    }
    setRecorded((n) => n + 1)
    setLatest((prev) => (prev?.row && atMs(prev.row) > atMs(row) ? prev : { row, skewMs: prev?.skewMs ?? 0, from: prev?.from ?? 'local', error: null }))
    setHistory((h) => {
      const cutoff = Date.now() - rangeRef.current * 60_000
      const t = atMs(row)
      return { ...h, rows: [...h.rows.filter((r) => atMs(r) >= cutoff && atMs(r) !== t), row] }
    })
  }, [])

  // One down-sampler per station; leaving the page (or switching user) writes the partial bucket.
  useEffect(() => {
    if (!stationId) return
    const ds = new Downsampler((row) => recordRow(stationId, row))
    dsRef.current = ds
    return () => {
      ds.flush()
      if (dsRef.current === ds) dsRef.current = null
    }
  }, [stationId, recordRow])

  /* --------------------------------------------------------------- serial */

  const onLine = useCallback(
    (line: string) => {
      const p = parseLineSafe(line)
      if (p.kind === 'info') {
        setDevice(p.info)
        return
      }
      if (p.kind !== 'sample') {
        setNoise((n) => n + 1)
        return
      }
      const s: Sample = { at: Date.now(), ...p.sample }
      pushSample(s)
      const d = deviceRef.current
      const label = d ? `Arduino · ${d.dht ?? 'DHT'} + ${d.gasSensor ?? 'gas sensor'}` : 'Arduino sensor'
      dsRef.current?.push(s, baselineRef.current?.value ?? null, label)
    },
    [pushSample],
  )

  const serial = useSerial(undefined, { onLine, staleAfterMs: STALE_AFTER_MS, helloCommand: 'i\n' })

  // A real sensor always wins over the simulator; never mix the two in one buffer.
  const connected = serial.connected
  useEffect(() => {
    if (!connected) return
    setSim(false)
    samplesRef.current = []
    setDevice(null)
    setNoise(0)
    setTick((t) => t + 1)
  }, [connected])

  // When the sensor stops (unplug / disconnect), close the open 10-s bucket right away.
  useEffect(() => {
    if (!connected) dsRef.current?.flush()
  }, [connected])

  /* ------------------------------------------------------------ simulator */

  useEffect(() => {
    if (!sim) return
    samplesRef.current = []
    const g = createSimulator()
    simRef.current = g
    const step = () => {
      pushSample(g.next())
      setSimLeaking(g.leaking)
    }
    step()
    const id = setInterval(step, 1000)
    return () => {
      clearInterval(id)
      simRef.current = null
      samplesRef.current = []
      setSimLeaking(false)
      setTick((t) => t + 1)
    }
  }, [sim, pushSample])

  const startSim = useCallback(() => {
    if (!serial.connected) setSim(true)
  }, [serial.connected])
  const stopSim = useCallback(() => setSim(false), [])
  const simulateLeak = useCallback(() => {
    simRef.current?.leak()
    setSimLeaking(true)
  }, [])

  /* ---------------------------------------------------------------- clock */

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  /* ------------------------------------------------------------- baseline */

  useEffect(() => {
    setBaseline(stationId ? readBaseline(stationId) : null)
  }, [stationId])

  /* ----------------------------------------------------- upload (server) */

  useEffect(() => {
    if (!serverMode || userId == null || !stationId) return
    let alive = true
    const run = async () => {
      const r = await flushQueue(userId, stationId)
      if (alive) setUpload((u) => ({ pending: r.pending, lastSentAt: r.sent ? Date.now() : u.lastSentAt, error: r.error }))
    }
    void run()
    const id = setInterval(run, FLUSH_EVERY_MS)
    window.addEventListener('online', run)
    return () => {
      alive = false
      clearInterval(id)
      window.removeEventListener('online', run)
      void flushQueue(userId, stationId)
    }
  }, [serverMode, userId, stationId])

  /* -------------------------------------------------- stored data + polling */

  const lastStoredAt = useRef<number | null>(null)
  const loadAll = useCallback(async () => {
    if (!stationId) return
    const [h, l] = await Promise.all([loadHistory(stationId, range), loadLatest(stationId)])
    setHistory({ ...h, loading: false })
    setLatest((prev) => (prev?.row && l.row && atMs(prev.row) > atMs(l.row) ? { ...l, row: prev.row } : l))
    lastStoredAt.current = l.row ? atMs(l.row) : null
  }, [stationId, range])

  useEffect(() => {
    setHistory((h) => ({ ...h, loading: true }))
    void loadAll()
  }, [loadAll])

  // Viewers (e.g. the flight surgeon) see stored readings refresh; also picks up other tabs in demo mode.
  useEffect(() => {
    if (!stationId) return
    const id = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const l = await loadLatest(stationId)
      const t = l.row ? atMs(l.row) : null
      if (t !== lastStoredAt.current) void loadAll()
      else setLatest((prev) => (prev?.row && l.row && atMs(prev.row) > atMs(l.row) ? { ...l, row: prev.row } : l))
    }, POLL_MS)
    const onStorage = (e: StorageEvent) => {
      if (e.key === localHistoryKey(stationId)) void loadAll()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      clearInterval(id)
      window.removeEventListener('storage', onStorage)
    }
  }, [stationId, loadAll])

  /* -------------------------------------------------------- current values */

  const samples = samplesRef.current
  const linkUp = serial.status === 'live' || serial.status === 'stale' || serial.status === 'connecting'
  const mode: SourceMode = sim ? 'sim' : linkUp ? 'live' : latest?.row ? 'stored' : 'none'

  let lastAt: number | null = null
  let age: number | null = null
  let noData = false
  let t: number | null | undefined
  let h: number | null | undefined
  let raw: number | null | undefined
  let ratio: number | null = null
  let base: number | null = null
  let warm: number | null = null

  if (mode === 'live' || mode === 'sim') {
    const last = samples[samples.length - 1]
    lastAt = last?.at ?? null
    age = lastAt != null ? Math.max(0, now - lastAt) : null
    noData = mode === 'live' && (serial.status !== 'live' || age == null || age > STALE_AFTER_MS)
    t = lastField(samples, 't')
    h = lastField(samples, 'h')
    raw = lastField(samples, 'gas')
    const w = lastField(samples, 'warm')
    warm = typeof w === 'number' ? w : null
    base = mode === 'sim' ? SIM_BASELINE : (baseline?.value ?? null)
    ratio = ratioOf(recentGas(samples, now), base)
    if (!samples.length) noData = true
  } else if (mode === 'stored' && latest?.row) {
    const row = latest.row
    lastAt = atMs(row) + BUCKET_MS
    age = Math.max(0, now - latest.skewMs - lastAt)
    noData = age > STORED_STALE_MS
    t = row.t
    h = row.h
    raw = row.gasMax ?? row.gas
    base = row.base
    ratio = rowRatio(row)
  } else {
    noData = true
  }

  const temp: Field = { value: t, eval: noData ? STALE_EVAL : evalTemp(t) }
  const hum: Field = { value: h, eval: noData ? STALE_EVAL : evalHum(h) }
  const gas: GasField = { value: ratio, raw, ratio, base, warm, eval: noData ? STALE_EVAL : evalGas({ raw, ratio, base, warm }) }
  if (mode === 'none') {
    const none: Eval = { level: 'none', label: 'NO DATA', detail: 'No reading yet.' }
    temp.eval = hum.eval = gas.eval = none
  }

  /* ----------------------------------------------------------- alarm latch */

  // The rule itself, ignoring staleness: an old stored reading that was in alarm must still raise the banner
  // (flagged "no newer data"), never silently disappear.
  const ruleCrit = mode !== 'none' && evalGas({ raw, ratio, base, warm }).level === 'crit'
  const isSim = mode === 'sim'
  useEffect(() => {
    const at = lastAt ?? Date.now()
    if (isSim) {
      // Simulated numbers never touch the real-data alarm; they get their own, clearly labelled one.
      setSimAlarm((prev) => latchAlarm(prev, ruleCrit && !noData, ratio, noData, 'sim', at))
      return
    }
    setSimAlarm(null)
    setAlarm((prev) => latchAlarm(prev, ruleCrit, ratio, noData || mode === 'none', mode, at))
  }, [isSim, ruleCrit, ratio, noData, mode, lastAt])

  const dismissAlarm = useCallback(() => {
    setAlarm((a) => (a && a.endedAt != null ? null : a))
    setSimAlarm((a) => (a && a.endedAt != null ? null : a))
  }, [])

  /* -------------------------------------------------------- baseline action */

  const baselineCandidate = useMemo(() => {
    if (mode !== 'live' || serial.status !== 'live') return { value: null as number | null, reason: 'Connect the sensor first.' }
    if (warm != null && warm > 0) return { value: null, reason: `Wait for the gas sensor warm-up (${warm} s left).` }
    const vals = samples.filter((s) => now - s.at <= BASELINE_WINDOW_MS && typeof s.gas === 'number' && !(s.warm != null && s.warm > 0)).map((s) => s.gas as number)
    if (vals.length < BASELINE_MIN_SAMPLES) return { value: null, reason: 'Collecting a few seconds of gas readings…' }
    const m = median(vals)
    if (m == null || m < 5) return { value: null, reason: 'The gas value is near zero — check the AO wire to A0.' }
    return { value: m, reason: null as string | null }
  }, [mode, serial.status, warm, now, samples]) // samples is a mutable ref array; `now` re-runs this every second

  const captureBaseline = useCallback(() => {
    if (!stationId || baselineCandidate.value == null) return
    setBaseline(saveBaseline(stationId, baselineCandidate.value))
  }, [stationId, baselineCandidate.value])
  /** Asks the AURA sketch to skip its warm-up countdown (user confirms the heater was already powered). */
  const sendToSensor = serial.send
  const skipWarmup = useCallback(() => {
    void sendToSensor('s\n')
  }, [sendToSensor])

  const clearBaseline = useCallback(() => {
    if (stationId) setBaseline(saveBaseline(stationId, null))
  }, [stationId])

  /* ------------------------------------------------------------ chart data */

  const liveSeries: ChartPoint[] =
    mode === 'live' || mode === 'sim'
      ? samples
          .filter((s) => now - s.at <= LIVE_WINDOW_MS)
          .map((s) => ({
            x: s.at,
            t: typeof s.t === 'number' ? s.t : null,
            h: typeof s.h === 'number' ? s.h : null,
            g: s.warm != null && s.warm > 0 ? null : base != null ? ratioOf(s.gas, base) : typeof s.gas === 'number' ? s.gas : null,
          }))
      : []
  const liveGasUnit: 'ratio' | 'raw' = base != null ? 'ratio' : 'raw'

  const storedHasRatio = history.rows.some((r) => rowRatio(r) != null)
  const storedSeries: ChartPoint[] = history.rows.map((r) => ({ x: atMs(r), t: r.t, h: r.h, g: storedHasRatio ? rowRatio(r) : (r.gasMax ?? r.gas) }))
  const storedGasUnit: 'ratio' | 'raw' = storedHasRatio ? 'ratio' : 'raw'

  return {
    station,
    serverMode,
    serial,
    mode,
    sim,
    simLeaking,
    startSim,
    stopSim,
    simulateLeak,
    device,
    noise,
    now,
    lastAt,
    age,
    noData,
    temp,
    hum,
    gas,
    alarm,
    simAlarm,
    dismissAlarm,
    baseline,
    baselineCandidate,
    captureBaseline,
    clearBaseline,
    skipWarmup,
    range,
    setRange,
    history,
    latest,
    reloadStored: loadAll,
    upload,
    recorded,
    liveSeries,
    liveGasUnit,
    storedSeries,
    storedGasUnit,
  }
}

export type EnvStationState = ReturnType<typeof useEnvStation>
