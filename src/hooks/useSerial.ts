import { useCallback, useRef, useState } from 'react'

// Reads newline-delimited JSON from an Arduino over Web Serial (Chrome / Edge desktop).
// Expected line format, any subset of keys:  {"t":23.4,"h":41,"hr":72,"spo2":98,"temp":36.7}
export type SerialReading = { t?: number; h?: number; hr?: number; spo2?: number; temp?: number }

export function useSerial(onReading: (r: SerialReading) => void) {
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const portRef = useRef<any>(null)
  const readerRef = useRef<any>(null)
  const cb = useRef(onReading)
  cb.current = onReading

  const supported = typeof navigator !== 'undefined' && 'serial' in navigator

  const disconnect = useCallback(async () => {
    try {
      await readerRef.current?.cancel()
    } catch {
      /* already closed */
    }
    setConnected(false)
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    try {
      const port = await (navigator as any).serial.requestPort()
      await port.open({ baudRate: 9600 })
      portRef.current = port
      setConnected(true)
      const decoder = new TextDecoder()
      const reader = port.readable.getReader()
      readerRef.current = reader
      let buffer = ''
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            try {
              const obj = JSON.parse(line.trim())
              if (obj && typeof obj === 'object') cb.current(obj)
            } catch {
              /* ignore non-JSON lines */
            }
          }
        }
      } finally {
        reader.releaseLock()
        await port.close().catch(() => {})
        setConnected(false)
      }
    } catch (e: any) {
      if (e?.name !== 'NotFoundError') setError(e?.message ?? 'Could not open the serial port')
      setConnected(false)
    }
  }, [])

  return { supported, connected, error, connect, disconnect }
}
