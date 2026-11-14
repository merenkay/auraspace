// View state for the Environment page's sensor station. The live serial link, parsing, baseline, live gas-alarm
// latch and 10-s recording live in the app-level store (src/lib/serial/envLive.ts), so they keep running on
// other pages. This hook adds what only the page needs: the simulator (never stored), stored-history charts
// and polling, and the alarm latch for stored readings (viewers without a sensor, e.g. the flight surgeon).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSerial } from '../../hooks/useSerial'
import {
  BUCKET_MS,
  LIVE_WINDOW_MS,
  STALE_AFTER_MS,
  STALE_EVAL,
  STORED_STALE_MS,
  SIM_BASELINE,
  createSimulator,
  evalGas,
  evalHum,
  evalTemp,
  loadHistory,
  loadLatest,
  localHistoryKey,
  median,
  ratioOf,
  recentGas,
  rowRatio,
  stationFor,
  type EnvRow,
  type Eval,
  type HistoryResult,
  type LatestResult,
  type Sample,
} from '../../lib/envStation'
import { envLive, latchAlarm, type AlarmState, type SourceMode } from '../../lib/serial/envLive'
import { useSession } from '../../lib/session'
import { useEnvLive } from './useEnvLive'

export type { AlarmState, SourceMode }
export type Field = { value: number | null | undefined; eval: Eval }
export type GasField = Field & { raw: number | null | undefined; ratio: number | null; base: number | null; warm: number | null }
export type ChartPoint = { x: number; t: number | null; h: number | null; g: number | null }

const POLL_MS = 10_000
const BASELINE_WINDOW_MS = 10_000
const BASELINE_MIN_SAMPLES = 5

const atMs = (r: EnvRow) => Date.parse(r.at)

function lastField(samples: readonly Sample[], f: 't' | 'h' | 'gas' | 'warm'): number | null | undefined {
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
  const live = useEnvLive()
  const serial = useSerial()
  const serverMode = backend?.mode === 'server'

  const [now, setNow] = useState(() => Date.now())
  const [sim, setSim] = useState(false)
  const simRef = useRef<ReturnType<typeof createSimulator> | null>(null)
  const simSamplesRef = useRef<Sample[]>([])
  const [, setTick] = useState(0)
  const [simLeaking, setSimLeaking] = useState(false)
  const [range, setRange] = useState(60)
  const [history, setHistory] = useState<HistoryResult & { loading: boolean }>({ rows: [], from: 'local', error: null, loading: true })
  const [latest, setLatest] = useState<LatestResult | null>(null)
  const [storedAlarm, setStoredAlarm] = useState<AlarmState | null>(null)
  const [simAlarm, setSimAlarm] = useState<AlarmState | null>(null)
  const rangeRef = useRef(range)
  rangeRef.current = range

  /* ------------------------------------------- rows recorded by the store */

  const lastRow = live.lastRow
  useEffect(() => {
    if (!lastRow) return
    setLatest((prev) => (prev?.row && atMs(prev.row) > atMs(lastRow) ? prev : { row: lastRow, skewMs: prev?.skewMs ?? 0, from: prev?.from ?? 'local', error: null }))
    setHistory((h) => {
      const cutoff = Date.now() - rangeRef.current * 60_000
      const t = atMs(lastRow)
      return { ...h, rows: [...h.rows.filter((r) => atMs(r) >= cutoff && atMs(r) !== t), lastRow] }
    })
  }, [lastRow])

  /* ------------------------------------------------------------ simulator */

  // A real sensor always wins over the simulator.
  const connected = serial.connected
  useEffect(() => {
    if (connected) setSim(false)
  }, [connected])

  useEffect(() => {
    if (!sim) return
    simSamplesRef.current = []
    const g = createSimulator()
    simRef.current = g
    const step = () => {
      simSamplesRef.current.push(g.next())
      const cutoff = Date.now() - 10 * 60_000
      while (simSamplesRef.current.length && simSamplesRef.current[0].at < cutoff) simSamplesRef.current.shift()
      setSimLeaking(g.leaking)
      setTick((t) => t + 1)
    }
    step()
    const id = setInterval(step, 1000)
    return () => {
      clearInterval(id)
      simRef.current = null
      simSamplesRef.current = []
      setSimLeaking(false)
      setTick((t) => t + 1)
    }
  }, [sim])

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

  const linkUp = serial.status === 'live' || serial.status === 'stale' || serial.status === 'connecting' || serial.status === 'reconnecting'
  const mode: SourceMode = sim ? 'sim' : linkUp ? 'live' : latest?.row ? 'stored' : 'none'
  const samples: readonly Sample[] = mode === 'sim' ? simSamplesRef.current : mode === 'live' ? live.samples : []
  const baseline = live.stationId === stationId ? live.baseline : null

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
    ratio = ratioOf(recentGas(samples as Sample[], now), base)
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

  // Live data: the store latches the alarm (it keeps doing so on other pages). Stored and simulated data: here.
  const ruleCrit = mode !== 'none' && evalGas({ raw, ratio, base, warm }).level === 'crit'
  useEffect(() => {
    const at = lastAt ?? Date.now()
    if (mode === 'sim') {
      setSimAlarm((prev) => latchAlarm(prev, ruleCrit && !noData, ratio, noData, 'sim', at))
      return
    }
    setSimAlarm(null)
    if (mode === 'stored' || mode === 'none') setStoredAlarm((prev) => latchAlarm(prev, ruleCrit, ratio, noData || mode === 'none', mode, at))
  }, [mode, ruleCrit, ratio, noData, lastAt])

  const alarm = mode === 'live' ? live.alarm : (live.alarm ?? storedAlarm)

  const dismissAlarm = useCallback(() => {
    envLive.dismissAlarm()
    setStoredAlarm((a) => (a && a.endedAt != null ? null : a))
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
  }, [mode, serial.status, warm, now, samples])

  const captureBaseline = useCallback(() => {
    if (baselineCandidate.value == null) return
    envLive.setBaseline(baselineCandidate.value)
  }, [baselineCandidate.value])
  const clearBaseline = useCallback(() => envLive.setBaseline(null), [])
  /** Asks the AURA sketch to skip its warm-up countdown (user confirms the heater was already powered). */
  const skipWarmup = useCallback(() => {
    void serial.send('s\n')
  }, [serial])

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

  const { storedHasRatio, storedSeries } = useMemo(() => {
    const r = history.rows.some((x) => rowRatio(x) != null)
    return { storedHasRatio: r, storedSeries: history.rows.map((x): ChartPoint => ({ x: atMs(x), t: x.t, h: x.h, g: r ? rowRatio(x) : (x.gasMax ?? x.gas) })) }
  }, [history.rows])
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
    device: live.device,
    noise: live.noise,
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
    upload: live.upload,
    recorded: live.recorded,
    liveSeries,
    liveGasUnit,
    storedSeries,
    storedGasUnit,
  }
}

export type EnvStationState = ReturnType<typeof useEnvStation>
