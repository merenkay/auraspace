import { useCallback, useEffect, useRef, useState } from 'react'

// Reads newline-delimited text from a USB serial device (Arduino) with the Web Serial API.
// Works in Chrome / Edge on desktop, on HTTPS or http://localhost. Not available on phones or in
// Firefox / Safari.
//
// State machine
//   unsupported  the browser (or an insecure http:// page) has no Web Serial
//   idle         not connected
//   connecting   port opening, or open but the board is still booting (no line yet)
//   live         a line arrived within the last `staleAfterMs`
//   stale        port open but no line for longer than `staleAfterMs` -> callers must NOT treat this as normal
//   error        opening failed, or the device was unplugged (AURA re-opens it when it is plugged back in)

/** Legacy shape: any JSON object line. Prefer `onLine` + a tolerant parser (see src/lib/envStation.ts). */
export type SerialReading = { t?: number; h?: number; hr?: number; spo2?: number; temp?: number; [key: string]: unknown }

export type SerialStatus = 'unsupported' | 'idle' | 'connecting' | 'live' | 'stale' | 'error'

export type SerialOptions = {
  baudRate?: number
  staleAfterMs?: number
  /** Called for every non-empty line (already split on \n / \r\n, not trimmed of content). */
  onLine?: (line: string) => void
  /** Text sent ~2.5 s after opening (e.g. "i\n" asks the AURA sketch for its info line). */
  helloCommand?: string
}

// Minimal Web Serial typings (the API is not part of TypeScript's DOM library).
type PortInfo = { usbVendorId?: number; usbProductId?: number }
interface WebSerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  getInfo(): PortInfo
}
interface WebSerial extends EventTarget {
  requestPort(options?: { filters?: PortInfo[] }): Promise<WebSerialPort>
  getPorts(): Promise<WebSerialPort[]>
}

function serialApi(): WebSerial | null {
  if (typeof navigator === 'undefined' || !('serial' in navigator)) return null
  return (navigator as unknown as { serial: WebSerial }).serial
}

const VENDORS: Record<number, string> = {
  0x2341: 'Arduino board',
  0x2a03: 'Arduino board',
  0x1a86: 'Arduino-compatible board (CH340 USB chip)',
  0x0403: 'USB serial device (FTDI chip)',
  0x10c4: 'USB serial device (CP210x chip)',
}

export function describePort(info: PortInfo | null | undefined): string {
  if (!info || info.usbVendorId == null) return 'serial device'
  return VENDORS[info.usbVendorId] ?? 'USB serial device'
}

const sameDevice = (a: PortInfo, b: PortInfo) => a.usbVendorId != null && a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId

function openErrorMessage(e: unknown): string {
  const name = e instanceof DOMException ? e.name : (e as { name?: string } | null)?.name
  if (name === 'InvalidStateError') return 'This port is already open — probably in another tab or in the Arduino IDE Serial Monitor. Close it there and try again.'
  if (name === 'NetworkError') return 'Could not open the port. Close the Arduino IDE Serial Monitor (or any other program using the port), re-plug the USB cable and try again.'
  if (name === 'SecurityError') return 'The browser blocked access to the serial port.'
  return e instanceof Error && e.message ? e.message : 'Could not open the serial port.'
}

const LOST_MESSAGE = 'Sensor unplugged or USB connection lost. Plug it back in — AURA reconnects automatically — or press Connect.'

export function useSerial(onReading?: (r: SerialReading) => void, options: SerialOptions = {}) {
  const baudRate = options.baudRate ?? 9600
  const staleAfterMs = options.staleAfterMs ?? 5000

  const api = serialApi()
  const secure = typeof window === 'undefined' || window.isSecureContext !== false
  const supported = !!api && secure

  const [phase, setPhase] = useState<'idle' | 'connecting' | 'open' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [openedAt, setOpenedAt] = useState<number | null>(null)
  const [lastLineAt, setLastLineAt] = useState<number | null>(null)
  const [lineCount, setLineCount] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [knownPort, setKnownPort] = useState<string | null>(null) // label of a previously allowed port
  const [portLabel, setPortLabel] = useState<string | null>(null)

  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const portRef = useRef<WebSerialPort | null>(null)
  const knownRef = useRef<WebSerialPort | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const loopRef = useRef<Promise<void> | null>(null)
  const userClosedRef = useRef(false)
  const reconnectRef = useRef(false) // re-open automatically when the same device is plugged back in
  const onReadingRef = useRef(onReading)
  onReadingRef.current = onReading
  const onLineRef = useRef(options.onLine)
  onLineRef.current = options.onLine
  const helloRef = useRef(options.helloCommand)
  helloRef.current = options.helloCommand

  const send = useCallback(async (text: string) => {
    const port = portRef.current
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
  }, [])

  const handleLine = useCallback((line: string) => {
    if (!line.trim()) return
    setLastLineAt(Date.now())
    setLineCount((c) => c + 1)
    onLineRef.current?.(line)
    if (onReadingRef.current) {
      try {
        const obj: unknown = JSON.parse(line.trim())
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) onReadingRef.current(obj as SerialReading)
      } catch {
        /* not JSON: ignored by the legacy callback */
      }
    }
  }, [])

  const readLoop = useCallback(
    async (port: WebSerialPort) => {
      const decoder = new TextDecoder()
      let buffer = ''
      let lost = false
      while (port.readable && !userClosedRef.current) {
        const reader = port.readable.getReader()
        readerRef.current = reader
        let ended = false
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) {
              ended = true
              break
            }
            if (!value) continue
            buffer += decoder.decode(value, { stream: true })
            const parts = buffer.split(/\r\n|\n|\r/)
            buffer = parts.pop() ?? ''
            if (buffer.length > 2048) buffer = '' // a runaway line without newlines is noise (wrong baud rate?)
            for (const line of parts) handleLine(line)
          }
        } catch (e) {
          // Framing / parity / overrun errors are recoverable (port.readable is replaced and the loop goes on).
          // "NetworkError: The device has been lost" is fatal: port.readable becomes null.
          const name = (e as { name?: string } | null)?.name
          if (name === 'NetworkError' || !port.readable) lost = true
        } finally {
          try {
            reader.releaseLock()
          } catch {
            /* already released */
          }
          readerRef.current = null
        }
        if (ended) break
      }
      try {
        await port.close()
      } catch {
        /* already closed (device lost) */
      }
      if (portRef.current === port) portRef.current = null
      if (userClosedRef.current) {
        setPhase('idle')
      } else {
        reconnectRef.current = true
        setError(lost ? LOST_MESSAGE : 'The connection to the sensor stopped. Press Connect to try again.')
        setPhase('error')
      }
    },
    [handleLine],
  )

  const openPort = useCallback(
    async (port: WebSerialPort) => {
      if (phaseRef.current === 'connecting' || phaseRef.current === 'open') return
      userClosedRef.current = false
      setError(null)
      setPhase('connecting')
      phaseRef.current = 'connecting'
      try {
        await port.open({ baudRate })
      } catch (e) {
        setError(openErrorMessage(e))
        setPhase('error')
        return
      }
      portRef.current = port
      knownRef.current = port
      const label = describePort(port.getInfo())
      setKnownPort(label)
      setPortLabel(label)
      setOpenedAt(Date.now())
      setLastLineAt(null)
      setLineCount(0)
      setNow(Date.now())
      setPhase('open')
      reconnectRef.current = false
      loopRef.current = readLoop(port)
      // Boards that do not reset when the port opens never re-print their info line: ask for it.
      const hello = helloRef.current
      if (hello) {
        setTimeout(() => {
          if (portRef.current === port) void send(hello)
        }, 2500)
      }
    },
    [baudRate, readLoop, send],
  )

  /** Opens the remembered port, or shows the browser's port picker (`choose: true` always shows it). */
  const connect = useCallback(
    async (opts?: { choose?: boolean }) => {
      const s = serialApi()
      if (!s || !secure) return
      if (phaseRef.current === 'connecting' || phaseRef.current === 'open') return
      let port: WebSerialPort | null = null
      try {
        // requestPort must run straight from the click, so call it first when there is nothing remembered
        if (opts?.choose || !knownRef.current) port = await s.requestPort()
        else {
          const ports = await s.getPorts()
          port = ports.find((p) => p === knownRef.current) ?? ports.find((p) => sameDevice(p.getInfo(), knownRef.current!.getInfo())) ?? null
          if (!port) {
            knownRef.current = null
            setKnownPort(null)
            port = await s.requestPort()
          }
        }
      } catch (e) {
        const name = (e as { name?: string } | null)?.name
        if (name === 'NotFoundError') return // picker closed without choosing a port
        setError(name === 'SecurityError' ? 'The browser blocked the port picker. Click the button again.' : openErrorMessage(e))
        setPhase('error')
        return
      }
      await openPort(port)
    },
    [openPort, secure],
  )

  const disconnect = useCallback(async () => {
    userClosedRef.current = true
    reconnectRef.current = false
    const reader = readerRef.current
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        /* already cancelled */
      }
    }
    if (loopRef.current) {
      await loopRef.current.catch(() => undefined)
      loopRef.current = null
    } else if (portRef.current) {
      try {
        await portRef.current.close()
      } catch {
        /* not open */
      }
      portRef.current = null
    }
    setError(null)
    setPhase('idle')
  }, [])

  /** Forget the remembered port so the next Connect shows the picker. */
  const forget = useCallback(() => {
    knownRef.current = null
    setKnownPort(null)
  }, [])

  // Remember previously allowed ports; reconnect automatically after an unplug + re-plug.
  useEffect(() => {
    const s = serialApi()
    if (!s) return
    let alive = true
    s.getPorts()
      .then((ports) => {
        if (!alive || !ports.length || knownRef.current) return
        knownRef.current = ports[0]
        setKnownPort(describePort(ports[0].getInfo()))
      })
      .catch(() => undefined)
    const onConnect = (e: Event) => {
      const port = e.target as WebSerialPort | null
      if (!port || typeof port.getInfo !== 'function') return
      const known = knownRef.current
      if (!reconnectRef.current || !known || (port !== known && !sameDevice(port.getInfo(), known.getInfo()))) return
      knownRef.current = port
      // give the USB driver a moment before opening
      setTimeout(() => {
        if (alive && reconnectRef.current) void openPort(port)
      }, 1200)
    }
    s.addEventListener('connect', onConnect)
    return () => {
      alive = false
      s.removeEventListener('connect', onConnect)
      // leaving the page: release the port so other tabs / the Arduino IDE can use it
      userClosedRef.current = true
      reconnectRef.current = false
      const reader = readerRef.current
      if (reader) reader.cancel().catch(() => undefined)
      else if (portRef.current) portRef.current.close().catch(() => undefined)
    }
  }, [openPort])

  // 1-second clock while connected, so "live" turns into "stale" without new data.
  useEffect(() => {
    if (phase !== 'open') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [phase])

  let status: SerialStatus = 'idle'
  if (!supported) status = 'unsupported'
  else if (phase === 'error') status = 'error'
  else if (phase === 'connecting') status = 'connecting'
  else if (phase === 'open') {
    const t = Math.max(now, lastLineAt ?? 0)
    if (lastLineAt != null && t - lastLineAt <= staleAfterMs) status = 'live'
    else if (lastLineAt == null && openedAt != null && t - openedAt <= staleAfterMs + 3000) status = 'connecting' // board reboots on open
    else status = 'stale'
  }

  const silentFor = phase === 'open' ? Math.max(0, Math.round((Math.max(now, lastLineAt ?? 0) - (lastLineAt ?? openedAt ?? now)) / 1000)) : 0

  let message: string
  switch (status) {
    case 'unsupported':
      message = !api
        ? 'This browser cannot talk to USB sensors. Use Chrome or Edge on a desktop or laptop computer.'
        : 'Web Serial needs a secure page: open AURA over https:// or on http://localhost.'
      break
    case 'connecting':
      message = 'Opening the port… waiting for the first reading (the Arduino restarts when the port opens).'
      break
    case 'live':
      message = `Receiving data from the ${portLabel ?? 'sensor'} at ${baudRate} baud.`
      break
    case 'stale':
      message =
        lastLineAt == null
          ? `Port open, but nothing has arrived for ${silentFor} s. Check that the AURA sketch is uploaded, the baud rate is ${baudRate} and the Arduino IDE Serial Monitor is closed.`
          : `No data for ${silentFor} s — values below are NOT current. Check the USB cable and the sensor power.`
      break
    case 'error':
      message = error ?? 'Something went wrong with the serial port.'
      break
    default:
      message = knownPort ? `Remembered port: ${knownPort}. Plug it in and press Connect.` : 'Plug the Arduino into a USB port, then press Connect sensor.'
  }

  return {
    supported,
    status,
    message,
    connected: phase === 'open',
    error,
    portLabel,
    knownPort,
    lastLineAt,
    lineCount,
    silentFor,
    connect,
    disconnect,
    forget,
    send,
  }
}
