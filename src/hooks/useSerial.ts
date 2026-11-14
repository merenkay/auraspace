import { useSyncExternalStore } from 'react'
import { envLive, type SerialStatus } from '../lib/serial/envLive'

// The Arduino serial link as a React view. The connection itself lives in an app-level store
// (src/lib/serial/envLive.ts + connection.ts) so it is NOT closed when a page unmounts: readings keep
// flowing, being stored and evaluated while the person uses other tabs of the app.
//
// Status
//   unsupported   the browser (or an insecure http:// page) has no Web Serial
//   idle          not connected
//   connecting    port opening, or open but the board is still booting (no line yet)
//   live          a line arrived within the last 5 s
//   stale         port open but no line for longer than 5 s -> callers must NOT treat this as normal
//   reconnecting  the sensor was unplugged / lost, or is being reopened after a reload; AURA retries
//   error         opening failed

/** Legacy shape: any JSON object line. Prefer the tolerant parser in src/lib/envStation.ts. */
export type SerialReading = { t?: number; h?: number; hr?: number; spo2?: number; temp?: number; [key: string]: unknown }
export type { SerialStatus }

export type SerialOptions = {
  baudRate?: number
  staleAfterMs?: number
  onLine?: (line: string) => void
  helloCommand?: string
}

export { describePort } from '../lib/serial/api'

/** The shared serial link (options are kept for backward compatibility; the store owns parsing and timing). */
export function useSerial(_onReading?: (r: SerialReading) => void, _options: SerialOptions = {}) {
  const s = useSyncExternalStore(envLive.subscribe, envLive.getSnapshot, envLive.getSnapshot)
  const c = s.conn
  const silentFor = s.connected ? Math.max(0, Math.round((s.now - (c.lastLineAt ?? c.openedAt ?? s.now)) / 1000)) : 0
  return {
    supported: s.supported,
    status: s.status,
    message: s.message,
    connected: s.connected,
    error: c.error,
    portLabel: c.portLabel,
    knownPort: c.knownPort,
    lastLineAt: c.lastLineAt,
    lineCount: c.lineCount,
    recovered: c.recovered,
    silentFor,
    connect: envLive.connect,
    disconnect: envLive.disconnect,
    forget: () => envLive.conn.forget(),
    send: envLive.send,
  }
}
