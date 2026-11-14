// One Web Serial connection that outlives pages and components. Plain TypeScript, no React.
//
// Why it is built this way
//   - The read loop is driven by the stream itself (`await reader.read()`), never by requestAnimationFrame or
//     timers, so readings keep arriving when the browser tab is in the background or minimised.
//   - Framing / parity / buffer-overrun errors are recoverable in Web Serial (the port gets a fresh `readable`):
//     the loop takes a new reader and goes on, without closing the port.
//   - USB unplug ("NetworkError: The device has been lost", `readable` becomes null): the connection goes to
//     "reconnecting", listens for the browser's `connect` event and also retries with a back-off.
//   - After a page reload, a port the person had connected is reopened silently with `getPorts()` (ports the
//     person granted earlier need no prompt). The choice is remembered on this device in localStorage and is
//     forgotten on an explicit Disconnect.
//   - The port is released only on an explicit Disconnect or when the page is unloaded (`release()`).
import { describePort, sameDevice, secureContext, serialApi, type PortInfo, type WebSerial, type WebSerialPort } from './api'

export type Phase = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error'

export type ConnState = {
  phase: Phase
  error: string | null
  portLabel: string | null
  /** Label of a port this browser may open without asking (remembered or granted earlier). */
  knownPort: string | null
  openedAt: number | null
  lastLineAt: number | null
  lineCount: number
  /** Read errors recovered without closing the port (framing, overrun …). */
  recovered: number
  /** Reconnect attempts since the link was lost. */
  attempt: number
  /** When the next automatic reconnect attempt is due (ms), or null. */
  retryAt: number | null
  /** The connection was reopened automatically (reload or re-plug), not by a click. */
  auto: boolean
}

export type ConnOptions = {
  baudRate?: number
  onLine: (line: string) => void
  onChange: () => void
  /** Called when the port is open (before the first line). */
  onOpen?: () => void
  /** Called when an open port stops (unplug, explicit disconnect, unload). */
  onClosed?: (reason: 'user' | 'lost' | 'unload') => void
  helloCommand?: string
  /** localStorage key that remembers "reconnect this device on reload". */
  rememberKey?: string
  retryDelaysMs?: number[]
}

type Pref = { vid: number | null; pid: number | null; scope: string; at: number }

const RECOVERABLE = new Set(['FramingError', 'ParityError', 'BreakError', 'BufferOverrunError', 'BufferOverflowError'])
const MAX_LINE = 2048

export function openErrorMessage(e: unknown): string {
  const name = (e as { name?: string } | null)?.name
  if (name === 'InvalidStateError') return 'This port is already open — probably in another tab or in the Arduino IDE Serial Monitor. Close it there and try again.'
  if (name === 'NetworkError') return 'Could not open the port. Close the Arduino IDE Serial Monitor (or any other program using the port), re-plug the USB cable and try again.'
  if (name === 'SecurityError') return 'The browser blocked access to the serial port.'
  return e instanceof Error && e.message ? e.message : 'Could not open the serial port.'
}

export const LOST_MESSAGE = 'Sensor unplugged or USB connection lost. AURA keeps trying to reconnect — plug it back in, or press Disconnect to stop.'

const INITIAL: ConnState = { phase: 'idle', error: null, portLabel: null, knownPort: null, openedAt: null, lastLineAt: null, lineCount: 0, recovered: 0, attempt: 0, retryAt: null, auto: false }

export class SerialConnection {
  state: ConnState = INITIAL
  readonly baudRate: number
  private readonly o: ConnOptions
  private port: WebSerialPort | null = null
  private knownInfo: PortInfo | null = null
  private knownPortObj: WebSerialPort | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private loop: Promise<void> | null = null
  /** The person wants the sensor connected (cleared by Disconnect / unload). */
  private want = false
  private scope: string | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private attachedTo: WebSerial | null = null
  private gen = 0

  constructor(o: ConnOptions) {
    this.o = o
    this.baudRate = o.baudRate ?? 9600
  }

  /* ---------------------------------------------------------------- helpers */

  private set(patch: Partial<ConnState>) {
    this.state = { ...this.state, ...patch }
    this.o.onChange()
  }

  get supported() {
    return !!serialApi() && secureContext()
  }

  get isOpen() {
    return this.state.phase === 'open'
  }

  private readPref(): Pref | null {
    if (!this.o.rememberKey) return null
    try {
      const raw = localStorage.getItem(this.o.rememberKey)
      const p = raw ? (JSON.parse(raw) as Pref) : null
      return p && typeof p.scope === 'string' ? p : null
    } catch {
      return null
    }
  }

  private writePref(info: PortInfo) {
    if (!this.o.rememberKey || !this.scope) return
    try {
      const p: Pref = { vid: info.usbVendorId ?? null, pid: info.usbProductId ?? null, scope: this.scope, at: Date.now() }
      localStorage.setItem(this.o.rememberKey, JSON.stringify(p))
    } catch {
      /* storage blocked: no auto-reconnect after a reload, everything else works */
    }
  }

  private clearPref() {
    if (!this.o.rememberKey) return
    try {
      localStorage.removeItem(this.o.rememberKey)
    } catch {
      /* ignore */
    }
  }

  /** Whether this device remembers an open connection for `scope` (used to show "reconnecting" on reload). */
  remembers(scope: string | null) {
    const p = this.readPref()
    return !!p && !!scope && p.scope === scope
  }

  private matches(port: WebSerialPort) {
    if (this.knownPortObj && port === this.knownPortObj) return true
    if (!this.knownInfo) return false
    if (this.knownInfo.usbVendorId == null) return false
    return sameDevice(port.getInfo(), this.knownInfo)
  }

  /** Listens for USB plug / unplug once per serial implementation. */
  attach() {
    const api = serialApi()
    if (!api || api === this.attachedTo) return
    if (this.attachedTo) {
      this.attachedTo.removeEventListener('connect', this.onConnectEv)
      this.attachedTo.removeEventListener('disconnect', this.onDisconnectEv)
    }
    api.addEventListener('connect', this.onConnectEv)
    api.addEventListener('disconnect', this.onDisconnectEv)
    this.attachedTo = api
    // A port granted earlier can be opened again without a prompt: show it as "remembered".
    api
      .getPorts()
      .then((ports) => {
        if (ports.length && !this.state.knownPort) {
          if (!this.knownPortObj) this.knownPortObj = ports[0]
          this.set({ knownPort: describePort(ports[0].getInfo()) })
        }
      })
      .catch(() => undefined)
  }

  private portOf(e: Event): WebSerialPort | null {
    const p = (e as Event & { port?: WebSerialPort }).port ?? (e.target as WebSerialPort | null)
    return p && typeof (p as WebSerialPort).getInfo === 'function' ? p : null
  }

  private onConnectEv = (e: Event) => {
    const port = this.portOf(e)
    if (!port || !this.want || this.state.phase === 'open' || this.state.phase === 'connecting') return
    if (!this.matches(port)) return
    this.clearRetry()
    // give the USB driver a moment before opening
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.want && this.state.phase !== 'open' && this.state.phase !== 'connecting') void this.open(port, true)
    }, 400)
  }

  private onDisconnectEv = (e: Event) => {
    const port = this.portOf(e)
    if (port && port === this.port) this.reader?.cancel().catch(() => undefined)
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  private scheduleRetry() {
    this.clearRetry()
    if (!this.want) return
    const delays = this.o.retryDelaysMs ?? [1000, 2000, 4000, 8000, 15000, 30000]
    const attempt = this.state.attempt
    const delay = delays[Math.min(attempt, delays.length - 1)]
    this.set({ phase: 'reconnecting', attempt: attempt + 1, retryAt: Date.now() + delay })
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.tryReconnect()
    }, delay)
  }

  private async tryReconnect() {
    if (!this.want || this.state.phase === 'open' || this.state.phase === 'connecting') return
    const api = serialApi()
    if (!api) return
    let port: WebSerialPort | null = null
    try {
      const ports = await api.getPorts()
      port = ports.find((p) => this.matches(p)) ?? null
    } catch {
      port = null
    }
    if (port && this.want) await this.open(port, true)
    else this.scheduleRetry()
  }

  /* ------------------------------------------------------------- public API */

  /** Sets whose station the connection records for (the remembered choice is per station). */
  setScope(scope: string | null) {
    this.scope = scope
  }

  /** Opens the remembered port, or shows the browser's port picker (`choose: true` always shows it). Needs a click. */
  async connect(opts?: { choose?: boolean }) {
    const api = serialApi()
    if (!api || !secureContext()) return
    if (this.state.phase === 'connecting' || this.state.phase === 'open') return
    this.attach()
    let port: WebSerialPort | null = null
    try {
      // requestPort must run straight from the click, so call it first when there is nothing remembered
      if (opts?.choose || (!this.knownPortObj && !this.knownInfo)) port = await api.requestPort()
      else {
        const ports = await api.getPorts()
        port = ports.find((p) => this.matches(p)) ?? null
        if (!port) {
          this.knownPortObj = null
          this.knownInfo = null
          this.set({ knownPort: null })
          port = await api.requestPort()
        }
      }
    } catch (e) {
      const name = (e as { name?: string } | null)?.name
      if (name === 'NotFoundError') return // picker closed without choosing a port
      this.set({ phase: 'error', error: name === 'SecurityError' ? 'The browser blocked the port picker. Click the button again.' : openErrorMessage(e) })
      return
    }
    this.clearRetry()
    this.want = true
    this.set({ attempt: 0, retryAt: null })
    await this.open(port, false)
  }

  /**
   * After a page load: if this device remembers an open connection for `scope`, reopen it without a prompt
   * (`getPorts()` lists ports the person granted before). If the board is not plugged in yet, wait for it.
   * Returns true when a reconnect is under way.
   */
  async autoReopen(scope: string | null): Promise<boolean> {
    this.scope = scope
    if (!this.supported || !scope || this.want) return false
    const pref = this.readPref()
    if (!pref || pref.scope !== scope) return false
    this.attach()
    this.want = true
    this.knownInfo = { usbVendorId: pref.vid ?? undefined, usbProductId: pref.pid ?? undefined }
    let port: WebSerialPort | null = null
    try {
      const ports = await serialApi()!.getPorts()
      port = ports.find((p) => (pref.vid == null ? ports.length === 1 : this.matches(p))) ?? null
    } catch {
      port = null
    }
    if (!this.want) return false
    if (port) {
      this.knownPortObj = port
      await this.open(port, true)
    } else {
      this.set({ knownPort: describePort(this.knownInfo), auto: true })
      this.scheduleRetry()
    }
    return true
  }

  private async open(port: WebSerialPort, auto: boolean) {
    if (this.state.phase === 'connecting' || this.state.phase === 'open') return
    const gen = ++this.gen
    this.set({ phase: 'connecting', error: null, auto })
    try {
      await port.open({ baudRate: this.baudRate })
    } catch (e) {
      if (gen !== this.gen) return
      if (auto && this.want) {
        this.set({ error: openErrorMessage(e) })
        this.scheduleRetry()
      } else {
        this.want = false
        this.set({ phase: 'error', error: openErrorMessage(e) })
      }
      return
    }
    if (gen !== this.gen || !this.want) {
      // disconnected while opening
      port.close().catch(() => undefined)
      return
    }
    this.port = port
    this.knownPortObj = port
    this.knownInfo = port.getInfo()
    this.writePref(this.knownInfo)
    const label = describePort(this.knownInfo)
    const now = Date.now()
    this.set({ phase: 'open', error: null, portLabel: label, knownPort: label, openedAt: now, lastLineAt: null, lineCount: 0, attempt: 0, retryAt: null })
    this.o.onOpen?.()
    this.loop = this.readLoop(port, gen)
    // Boards that do not reset when the port opens never re-print their info line: ask for it.
    const hello = this.o.helloCommand
    if (hello) {
      setTimeout(() => {
        if (this.port === port) void this.send(hello)
      }, 2500)
    }
  }

  private async readLoop(port: WebSerialPort, gen: number) {
    const decoder = new TextDecoder()
    let buffer = ''
    let burst = 0
    let burstAt = 0
    let reason: 'user' | 'lost' = 'lost'
    while (port.readable && this.want && gen === this.gen) {
      const reader = port.readable.getReader()
      this.reader = reader
      let ended = false
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) {
            ended = true
            break
          }
          if (!value || !value.length) continue
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split(/\r\n|\n|\r/)
          buffer = parts.pop() ?? ''
          if (buffer.length > MAX_LINE) buffer = '' // a runaway line without newlines is noise (wrong baud rate?)
          for (const line of parts) this.handleLine(line)
        }
      } catch (e) {
        const name = (e as { name?: string } | null)?.name ?? ''
        if (RECOVERABLE.has(name) && port.readable) {
          // recoverable: keep the port, drop the half line, take a fresh reader
          buffer = ''
          const t = Date.now()
          burst = t - burstAt < 1000 ? burst + 1 : 1
          burstAt = t
          this.set({ recovered: this.state.recovered + 1 })
          if (burst > 50) ended = true // an error storm: treat as lost and reopen
        } else ended = true
      } finally {
        try {
          reader.releaseLock()
        } catch {
          /* already released */
        }
        if (this.reader === reader) this.reader = null
      }
      if (ended) break
    }
    if (!this.want) reason = 'user'
    try {
      await port.close()
    } catch {
      /* already closed (device lost) */
    }
    if (this.port === port) this.port = null
    if (gen !== this.gen) return
    this.o.onClosed?.(reason)
    if (reason === 'user') {
      this.set({ phase: 'idle', error: null })
    } else {
      this.set({ error: LOST_MESSAGE })
      this.scheduleRetry()
    }
  }

  private handleLine(line: string) {
    if (!line.trim()) return
    this.state = { ...this.state, lastLineAt: Date.now(), lineCount: this.state.lineCount + 1 }
    try {
      this.o.onLine(line)
    } catch {
      /* a consumer error must never stop the read loop */
    }
    this.o.onChange()
  }

  async send(text: string) {
    const port = this.port
    if (!port?.writable || port.writable.locked) return false
    const writer = port.writable.getWriter()
    try {
      await writer.write(new TextEncoder().encode(text))
      return true
    } catch {
      return false
    } finally {
      writer.releaseLock()
    }
  }

  /** Explicit Disconnect: closes the port, stops reconnecting and forgets the auto-reopen choice. */
  async disconnect() {
    this.want = false
    this.clearRetry()
    this.clearPref()
    const wasOpen = this.state.phase === 'open'
    const reader = this.reader
    if (reader) await reader.cancel().catch(() => undefined)
    if (this.loop) {
      await this.loop.catch(() => undefined)
      this.loop = null
    } else if (this.port) {
      await this.port.close().catch(() => undefined)
      this.port = null
    }
    this.gen++
    if (!wasOpen) this.o.onClosed?.('user')
    this.set({ phase: 'idle', error: null, attempt: 0, retryAt: null, auto: false })
  }

  /** Page unload: release the port for other tabs / the Arduino IDE, but keep the auto-reopen choice. */
  release() {
    if (!this.want && !this.port) return
    this.want = false
    this.clearRetry()
    this.gen++
    this.o.onClosed?.('unload')
    const port = this.port
    this.port = null
    const reader = this.reader
    if (reader) reader.cancel().catch(() => undefined).finally(() => port?.close().catch(() => undefined))
    else port?.close().catch(() => undefined)
  }

  /** Forget the remembered port so the next Connect shows the picker. */
  forget() {
    this.knownPortObj = null
    this.knownInfo = null
    this.clearPref()
    this.set({ knownPort: null })
  }

  /** Test helper: drop listeners and timers. */
  dispose() {
    this.clearRetry()
    if (this.attachedTo) {
      this.attachedTo.removeEventListener('connect', this.onConnectEv)
      this.attachedTo.removeEventListener('disconnect', this.onDisconnectEv)
      this.attachedTo = null
    }
  }
}
