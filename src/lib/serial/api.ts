// Minimal Web Serial typings (the API is not part of TypeScript's DOM library) and the one place that
// decides which implementation is used: the browser's `navigator.serial`, or an injected one (unit tests and
// the dev-only fake port, see fake.ts). Web Serial exists only in Chromium desktop browsers (Chrome, Edge,
// Opera) on https:// or http://localhost.

export type PortInfo = { usbVendorId?: number; usbProductId?: number }

export interface WebSerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  getInfo(): PortInfo
}

export interface WebSerial extends EventTarget {
  requestPort(options?: { filters?: PortInfo[] }): Promise<WebSerialPort>
  getPorts(): Promise<WebSerialPort[]>
}

let injected: WebSerial | null | undefined

/** Replaces the serial implementation (tests / dev fake). `undefined` restores the browser's own. */
export function setSerialApi(api: WebSerial | null | undefined) {
  injected = api
}

export function serialApi(): WebSerial | null {
  if (injected !== undefined) return injected
  if (typeof navigator === 'undefined' || !('serial' in navigator)) return null
  return (navigator as unknown as { serial: WebSerial }).serial
}

export const isInjected = () => injected !== undefined

/** Web Serial needs a secure context (https:// or http://localhost). */
export function secureContext(): boolean {
  if (injected !== undefined) return true
  return typeof window === 'undefined' || window.isSecureContext !== false
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

export const sameDevice = (a: PortInfo, b: PortInfo) => a.usbVendorId != null && a.usbVendorId === b.usbVendorId && a.usbProductId === b.usbProductId
