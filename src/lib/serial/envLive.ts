// App-level live sensor store (singleton). Owns the Arduino serial connection, line parsing, the clean-air
// baseline, the gas-alarm latch on live data and the 10-second recording to local history / the server upload
// queue. It is independent of any page: the Environment page, the header indicator and the AURA
// consultation are views of it (React reads it with useSyncExternalStore, see src/components/env/useEnvLive.ts).
//
// Simulated readings never come through here (the simulator stays on the Environment page and is never stored).
import { CABIN_LIMITS } from '../../data/missions'
import {
  BUCKET_MS,
  Downsampler,
  FLUSH_EVERY_MS,
  STALE_AFTER_MS,
  evalGas,
  flushQueue,
  appendLocalHistory,
  parseLine,
  pendingCount,
  queueRows,
  ratioOf,
  readBaseline,
  recentGas,
  saveBaseline,
  type Baseline,
  type DeviceInfo,
  type EnvRow,
  type Level,
  type Parsed,
  type Sample,
} from '../envStation'
import { secureContext, serialApi, setSerialApi } from './api'
import { SerialConnection, type ConnState } from './connection'
import { FakePort, FakeSerial } from './fake'

export type SourceMode = 'live' | 'sim' | 'stored' | 'none'
export type SerialStatus = 'unsupported' | 'idle' | 'connecting' | 'live' | 'stale' | 'reconnecting' | 'error'

/** startedAt = time of the first reading in alarm; last = newest ratio seen while the alarm was latched. */
export type AlarmState = { startedAt: number; endedAt: number | null; peak: number; last: number; mode: SourceMode; noData: boolean }

/**
 * Gas-alarm latch. Starts on a reading at/above the alarm ratio; ends only when a NEW, current reading is
 * below it. Missing or stale data never ends an alarm (it is flagged `noData` instead).
 */
export function latchAlarm(prev: AlarmState | null, crit: boolean, ratio: number | null, noData: boolean, mode: SourceMode, at: number): AlarmState | null {
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

export type Scope = { stationId: string; userId: number; serverMode: boolean }

export type UploadState = { pending: number; lastSentAt: number | null; error: string | null }

export type LiveSnapshot = {
  supported: boolean
  /** Web Serial API present (false = wrong browser); `supported` also needs a secure page. */
  apiPresent: boolean
  status: SerialStatus
  message: string
  connected: boolean
  conn: ConnState
  stationId: string | null
  samples: readonly Sample[]
  device: DeviceInfo | null
  noise: number
  baseline: Baseline | null
  alarm: AlarmState | null
  recorded: number
  upload: UploadState
  lastRow: EnvRow | null
  now: number
  /** Latest live values, only while the link is up. */
  latest: { at: number; t: number | null; h: number | null; ratio: number | null; gasLevel: Level; fresh: boolean } | null
}

const KEEP_SAMPLES_MS = 10 * 60_000
export const REMEMBER_KEY = 'aura.serial.auto.v1'
const BAUD = 9600

function parseLineSafe(line: string): Parsed {
  try {
    return parseLine(line)
  } catch {
    return { kind: 'noise' }
  }
}

function lastField(samples: readonly Sample[], f: 't' | 'h' | 'gas' | 'warm'): number | null | undefined {
  for (let i = samples.length - 1; i >= 0; i--) {
    const v = samples[i][f]
    if (v !== undefined) return v
  }
  return undefined
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export class EnvLiveStore {
  private listeners = new Set<() => void>()
  private snap: LiveSnapshot
  readonly conn: SerialConnection
  private samples: Sample[] = []
  private device: DeviceInfo | null = null
  private noise = 0
  private baseline: Baseline | null = null
  private alarm: AlarmState | null = null
  private recorded = 0
  private upload: UploadState = { pending: 0, lastSentAt: null, error: null }
  private lastRow: EnvRow | null = null
  private scope: Scope | null = null
  private ds: Downsampler | null = null
  private clock: ReturnType<typeof setInterval> | null = null
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private started = false
  private notifyQueued = false

  constructor(opts: { retryDelaysMs?: number[] } = {}) {
    this.conn = new SerialConnection({
      baudRate: BAUD,
      helloCommand: 'i\n',
      rememberKey: REMEMBER_KEY,
      retryDelaysMs: opts.retryDelaysMs,
      onLine: (l) => this.onLine(l),
      onChange: () => this.changed(),
      onOpen: () => {
        // A real sensor starts a fresh buffer; never mix with older samples.
        this.samples = []
        this.device = null
        this.noise = 0
        this.startClock()
      },
      onClosed: () => {
        // close the open 10-s bucket right away
        this.ds?.flush()
      },
    })
    this.snap = this.build()
  }

  /* ------------------------------------------------------------ store API */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  getSnapshot = () => this.snap

  private changed() {
    this.snap = this.build()
    for (const fn of [...this.listeners]) fn()
  }

  /* ------------------------------------------------------------- lifecycle */

  /**
   * Binds the store to the signed-in person's station (called by the app shell; idempotent, safe under
   * StrictMode double effects). Starts uploads and, on the first call, the silent auto-reopen.
   */
  setScope(scope: Scope | null) {
    const prev = this.scope
    const same = prev && scope && prev.stationId === scope.stationId && prev.userId === scope.userId && prev.serverMode === scope.serverMode
    if (same) return
    if (prev && (!scope || prev.stationId !== scope.stationId || prev.userId !== scope.userId)) {
      // switching person or signing out: write the partial bucket for the old station and stop the sensor
      this.ds?.flush()
      if (this.conn.state.phase !== 'idle' && this.conn.state.phase !== 'error') this.conn.release()
      this.samples = []
      this.alarm = null
    }
    this.scope = scope
    this.conn.setScope(scope?.stationId ?? null)
    this.ds = scope ? new Downsampler((row) => this.recordRow(scope, row)) : null
    this.baseline = scope ? readBaseline(scope.stationId) : null
    this.recorded = 0
    this.lastRow = null
    this.upload = { pending: scope?.serverMode ? pendingCount(scope.userId, scope.stationId) : 0, lastSentAt: null, error: null }
    this.startUploads()
    this.changed()
    if (scope) {
      this.conn.attach()
      void this.conn.autoReopen(scope.stationId)
    }
  }

  /** Global listeners (page unload). Called once from the app shell. */
  start() {
    if (this.started || typeof window === 'undefined') return
    this.started = true
    window.addEventListener('pagehide', (e) => {
      if ((e as PageTransitionEvent).persisted) return // kept in the back-forward cache: the page lives on
      this.ds?.flush()
      this.conn.release()
    })
  }

  connect = (opts?: { choose?: boolean }) => this.conn.connect(opts)
  disconnect = async () => {
    await this.conn.disconnect()
    this.ds?.flush()
    this.stopClock()
    this.changed()
  }
  send = (text: string) => this.conn.send(text)

  setBaseline = (value: number | null) => {
    if (!this.scope) return
    this.baseline = saveBaseline(this.scope.stationId, value)
    this.evalAlarm()
    this.changed()
  }

  dismissAlarm = () => {
    if (this.alarm && this.alarm.endedAt != null) {
      this.alarm = null
      this.changed()
    }
  }

  /* --------------------------------------------------------------- reading */

  private onLine(line: string) {
    const p = parseLineSafe(line)
    if (p.kind === 'info') {
      this.device = p.info
      return
    }
    if (p.kind !== 'sample') {
      this.noise++
      return
    }
    const s: Sample = { at: Date.now(), ...p.sample }
    this.samples.push(s)
    const cutoff = s.at - KEEP_SAMPLES_MS
    let drop = 0
    while (drop < this.samples.length && this.samples[drop].at < cutoff) drop++
    if (drop) this.samples.splice(0, drop)
    const d = this.device
    const label = d ? `Arduino · ${d.dht ?? 'DHT'} + ${d.gasSensor ?? 'gas sensor'}` : 'Arduino sensor'
    this.ds?.push(s, this.baseline?.value ?? null, label)
    this.evalAlarm()
  }

  private recordRow(scope: Scope, row: EnvRow) {
    appendLocalHistory(scope.stationId, [row])
    if (scope.serverMode) {
      queueRows(scope.userId, scope.stationId, [row])
      this.upload = { ...this.upload, pending: pendingCount(scope.userId, scope.stationId) }
    }
    this.recorded++
    this.lastRow = row
    this.queueNotify()
  }

  private queueNotify() {
    if (this.notifyQueued) return
    this.notifyQueued = true
    queueMicrotask(() => {
      this.notifyQueued = false
      this.changed()
    })
  }

  private linkUp() {
    const ph = this.conn.state.phase
    return ph === 'open' || ph === 'connecting' || ph === 'reconnecting'
  }

  private noData(now: number) {
    const last = this.samples[this.samples.length - 1]
    return this.conn.state.phase !== 'open' || !last || now - last.at > STALE_AFTER_MS
  }

  private evalAlarm(now = Date.now()) {
    if (!this.linkUp() && !this.alarm) return
    const raw = lastField(this.samples, 'gas')
    const w = lastField(this.samples, 'warm')
    const warm = typeof w === 'number' ? w : null
    const base = this.baseline?.value ?? null
    const ratio = ratioOf(recentGas(this.samples, now), base)
    const crit = this.samples.length > 0 && evalGas({ raw, ratio, base, warm }).level === 'crit'
    const last = this.samples[this.samples.length - 1]
    this.alarm = latchAlarm(this.alarm, crit, ratio, this.noData(now), 'live', last?.at ?? now)
  }

  /* ----------------------------------------------------------------- timers */

  private startClock() {
    if (this.clock) return
    // Only refreshes "how old is the last reading" for the views; reading itself is stream-driven.
    this.clock = setInterval(() => {
      if (!this.linkUp()) {
        this.stopClock()
        this.changed()
        return
      }
      this.evalAlarm()
      this.changed()
    }, 1000)
  }

  private stopClock() {
    if (this.clock) clearInterval(this.clock)
    this.clock = null
  }

  private startUploads() {
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.flushTimer = null
    const s = this.scope
    if (!s || !s.serverMode || typeof window === 'undefined') return
    const run = async () => {
      const cur = this.scope
      if (!cur || cur.stationId !== s.stationId) return
      const r = await flushQueue(s.userId, s.stationId)
      this.upload = { pending: r.pending, lastSentAt: r.sent ? Date.now() : this.upload.lastSentAt, error: r.error }
      this.changed()
    }
    void run()
    this.flushTimer = setInterval(run, FLUSH_EVERY_MS)
    if (this.onOnline) window.removeEventListener('online', this.onOnline)
    this.onOnline = () => void run()
    window.addEventListener('online', this.onOnline)
  }

  private onOnline: (() => void) | null = null

  /* --------------------------------------------------------------- snapshot */

  /** An EnvRow summarising the last 10 s of live samples (for the consultation), or null when not live. */
  liveRow(now = Date.now()): EnvRow | null {
    if (this.conn.state.phase !== 'open') return null
    const recent = this.samples.filter((s) => now - s.at <= BUCKET_MS)
    if (!recent.length) return null
    const avg = (f: 't' | 'h') => {
      const v = recent.map((s) => s[f]).filter((x): x is number => typeof x === 'number')
      return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null
    }
    const gasV = recent.filter((s) => !(s.warm != null && s.warm > 0)).map((s) => s.gas).filter((x): x is number => typeof x === 'number')
    const gasMax = gasV.length ? Math.max(...gasV) : null
    const base = this.baseline?.value ?? null
    return {
      at: new Date(recent[recent.length - 1].at).toISOString(),
      t: avg('t'),
      h: avg('h'),
      gas: gasV.length ? gasV.reduce((a, b) => a + b, 0) / gasV.length : null,
      gasMax,
      base,
      ratio: ratioOf(gasMax, base),
      n: recent.length,
      device: 'Arduino sensor (live)',
    }
  }

  private build(): LiveSnapshot {
    const now = Date.now()
    const c = this.conn.state
    const apiPresent = !!serialApi()
    const supported = apiPresent && secureContext()
    let status: SerialStatus = 'idle'
    if (!supported) status = 'unsupported'
    else if (c.phase === 'error') status = 'error'
    else if (c.phase === 'connecting') status = 'connecting'
    else if (c.phase === 'reconnecting') status = 'reconnecting'
    else if (c.phase === 'open') {
      const t = Math.max(now, c.lastLineAt ?? 0)
      if (c.lastLineAt != null && t - c.lastLineAt <= STALE_AFTER_MS) status = 'live'
      else if (c.lastLineAt == null && c.openedAt != null && t - c.openedAt <= STALE_AFTER_MS + 3000) status = 'connecting' // board reboots on open
      else status = 'stale'
    }
    const silentFor = c.phase === 'open' ? Math.max(0, Math.round((Math.max(now, c.lastLineAt ?? 0) - (c.lastLineAt ?? c.openedAt ?? now)) / 1000)) : 0
    const label = c.portLabel ?? 'sensor'
    let message: string
    switch (status) {
      case 'unsupported':
        message = !apiPresent
          ? 'This browser cannot talk to USB sensors. Use Chrome or Edge on a desktop or laptop computer.'
          : 'Web Serial needs a secure page: open AURA over https:// or on http://localhost.'
        break
      case 'connecting':
        message = 'Opening the port… waiting for the first reading (the Arduino restarts when the port opens).'
        break
      case 'live':
        message = `Receiving data from the ${label} at ${BAUD} baud. Readings keep being recorded while you use other pages.`
        break
      case 'stale':
        message =
          c.lastLineAt == null
            ? `Port open, but nothing has arrived for ${silentFor} s. Check that the AURA sketch is uploaded, the baud rate is ${BAUD} and the Arduino IDE Serial Monitor is closed.`
            : `No data for ${silentFor} s — values below are NOT current. Check the USB cable and the sensor power.`
        break
      case 'reconnecting': {
        const wait = c.retryAt != null ? Math.max(0, Math.ceil((c.retryAt - now) / 1000)) : null
        message = `${c.auto && c.lineCount === 0 && c.attempt <= 1 ? 'Reconnecting to the sensor you used last time' : c.error ?? 'Connection lost'}${wait != null ? ` · next try in ${wait} s` : ''} (attempt ${c.attempt}).`
        break
      }
      case 'error':
        message = c.error ?? 'Something went wrong with the serial port.'
        break
      default:
        message = c.knownPort ? `Remembered port: ${c.knownPort}. Plug it in and press Connect.` : 'Plug the Arduino into a USB port, then press Connect sensor.'
    }
    let latest: LiveSnapshot['latest'] = null
    if (c.phase === 'open' && this.samples.length) {
      const last = this.samples[this.samples.length - 1]
      const w = lastField(this.samples, 'warm')
      const base = this.baseline?.value ?? null
      const ratio = ratioOf(recentGas(this.samples, now), base)
      const fresh = now - last.at <= STALE_AFTER_MS
      const gasLevel = fresh ? evalGas({ raw: lastField(this.samples, 'gas'), ratio, base, warm: typeof w === 'number' ? w : null }).level : 'none'
      latest = { at: last.at, t: num(lastField(this.samples, 't')), h: num(lastField(this.samples, 'h')), ratio, gasLevel, fresh }
    }
    return {
      supported,
      apiPresent,
      status,
      message,
      connected: c.phase === 'open',
      conn: c,
      stationId: this.scope?.stationId ?? null,
      samples: this.samples.slice(),
      device: this.device,
      noise: this.noise,
      baseline: this.baseline,
      alarm: this.alarm,
      recorded: this.recorded,
      upload: this.upload,
      lastRow: this.lastRow,
      now,
      latest,
    }
  }
}

/** Temperature outside the NASA habitat band (used by the header indicator colour). */
export const tempOutOfBand = (t: number | null) => t != null && (t < CABIN_LIMITS.tempMin || t > CABIN_LIMITS.tempMax)

/** The one store for the whole app. */
export const envLive = new EnvLiveStore()

/* ------------------------------------------------------------------ dev hook */
// Web Serial cannot be driven headlessly. In development only, window.__auraSerial installs a fake port so
// the store can be exercised end to end (tools/shot.mjs eval steps). Stripped from production builds.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  let fake: { serial: FakeSerial; port: FakePort; timer: ReturnType<typeof setInterval> | null } | null = null
  ;(window as unknown as { __auraSerial: unknown }).__auraSerial = {
    store: envLive,
    /** Installs the fake serial API with one granted board. */
    useFake() {
      if (!fake) {
        const serial = new FakeSerial()
        const port = serial.add(new FakePort())
        serial.nextChoice = port
        fake = { serial, port, timer: null }
        setSerialApi(serial)
        envLive.conn.attach()
        // after a reload: reopen silently if this device remembers the connection (no picker)
        void envLive.conn.autoReopen(envLive.getSnapshot().stationId)
      }
      return true
    },
    /** Streams one line per second with the given cabin values (string chunks split mid-line on purpose). */
    stream(t = 22.4, h = 41, gas = 180) {
      if (!fake) return false
      if (fake.timer) clearInterval(fake.timer)
      const f = fake
      f.timer = setInterval(() => {
        const line = `{"t":${t},"h":${h},"gas":${gas},"warm":0}\n`
        f.port.push(line.slice(0, 9))
        f.port.push(line.slice(9))
      }, 1000)
      return true
    },
    unplug: () => fake?.port.unplug(),
    plug: () => fake?.port.plug(),
    readError: (name = 'BufferOverrunError') => fake?.port.readError(name),
    state: () => {
      const s = envLive.getSnapshot()
      return { status: s.status, lines: s.conn.lineCount, samples: s.samples.length, recorded: s.recorded, opens: fake?.port.opens ?? 0, pickers: fake?.serial.requests ?? 0, closes: fake?.port.closes ?? 0, path: location.pathname }
    },
  }
}
