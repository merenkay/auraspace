// A fake Web Serial implementation for unit tests and the dev-only browser check (never used in production
// builds: see the import.meta.env.DEV guard in envLive.ts). It behaves like Chromium's API in the ways AURA
// relies on: open() twice throws InvalidStateError, a read error replaces `readable` with a fresh stream,
// unplugging errors the stream with NetworkError, sets `readable` to null and fires "disconnect", and
// plugging back in fires "connect" with the port as the event's port.
import type { PortInfo, WebSerial, WebSerialPort } from './api'

const err = (name: string, message = name) => {
  const e = new Error(message)
  e.name = name
  return e
}

export class FakePort extends EventTarget implements WebSerialPort {
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  isOpen = false
  plugged = true
  opens = 0
  closes = 0
  written: string[] = []
  failNextOpen: string | null = null
  private ctrl: ReadableStreamDefaultController<Uint8Array> | null = null
  private readonly info: PortInfo
  owner: FakeSerial | null = null

  constructor(info: PortInfo = { usbVendorId: 0x2341, usbProductId: 0x0043 }) {
    super()
    this.info = info
  }

  getInfo() {
    return this.info
  }

  private freshStream() {
    this.readable = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.ctrl = c
      },
    })
  }

  async open(_o: { baudRate: number }) {
    if (!this.plugged) throw err('NetworkError', 'The device has been lost.')
    if (this.failNextOpen) {
      const name = this.failNextOpen
      this.failNextOpen = null
      throw err(name)
    }
    if (this.isOpen) throw err('InvalidStateError', 'The port is already open.')
    this.isOpen = true
    this.opens++
    this.freshStream()
    this.writable = new WritableStream<Uint8Array>({ write: (chunk) => void this.written.push(new TextDecoder().decode(chunk)) })
  }

  async close() {
    if (!this.isOpen) throw err('InvalidStateError', 'The port is already closed.')
    if (this.readable?.locked) throw err('TypeError', 'Cannot close a port with a locked stream.')
    this.isOpen = false
    this.closes++
    this.readable = null
    this.writable = null
    this.ctrl = null
  }

  /** Sends raw text as one chunk (lines may be split anywhere). */
  push(text: string) {
    try {
      this.ctrl?.enqueue(new TextEncoder().encode(text))
    } catch {
      /* stream closed */
    }
  }

  /** A recoverable read error (framing, parity, buffer overrun): the stream errors and a new one replaces it. */
  readError(name = 'FramingError') {
    const c = this.ctrl
    this.freshStream()
    c?.error(err(name))
  }

  /** Pulls the USB cable. */
  unplug() {
    this.plugged = false
    const c = this.ctrl
    this.readable = null
    this.writable = null
    this.isOpen = false
    this.ctrl = null
    c?.error(err('NetworkError', 'The device has been lost.'))
    this.owner?.fire('disconnect', this)
  }

  /** Plugs the cable back in. */
  plug() {
    this.plugged = true
    this.owner?.fire('connect', this)
  }
}

export class FakeSerial extends EventTarget implements WebSerial {
  granted: FakePort[] = []
  /** Port the next requestPort() "chooses"; null = the person closes the picker. */
  nextChoice: FakePort | null = null
  requests = 0

  add(port: FakePort, granted = true) {
    port.owner = this
    if (granted && !this.granted.includes(port)) this.granted.push(port)
    return port
  }

  async requestPort() {
    this.requests++
    const p = this.nextChoice
    if (!p) throw err('NotFoundError', 'No port selected by the user.')
    this.add(p)
    return p
  }

  async getPorts() {
    return this.granted.filter((p) => p.plugged)
  }

  fire(type: 'connect' | 'disconnect', port: FakePort) {
    const ev = new Event(type) as Event & { port?: FakePort }
    ev.port = port
    this.dispatchEvent(ev)
  }
}
