// Demo store: report permissions, reply time and read markers (mirrors GET reports, POST reports/review, reportread/*).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../api'
import type { Report } from '../types'
import { isUnread } from './journey'
import { withLocalReads } from './store'

const T0 = new Date(2026, 10, 14, 10, 0, 0)
let b: Backend

beforeEach(async () => {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  vi.stubGlobal('setTimeout', (fn: () => void) => {
    queueMicrotask(fn)
    return 0
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  vi.resetModules()
  b = await (await import('../api')).getBackend()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status: number }) => e.status)
const summary = { overall: 'ok' as const, score: 90, alerts: [], vitals: [] }

describe('demo store: reports, replies and read markers', () => {
  it('astronaut sends -> surgeon replies -> astronaut sees an unread reply -> marks it read', async () => {
    await b.demoLogin('astronaut', 1)
    const sent = await b.sendReport(1, summary)
    expect(sent).toMatchObject({ status: 'queued', reviewedAt: null, readAt: null })
    await b.demoLogin('surgeon')
    vi.setSystemTime(new Date(T0.getTime() + 60_000))
    const r = await b.reviewReport(sent.id, '  Drink more water.  ')
    expect(r).toMatchObject({ status: 'reviewed', reviewNote: 'Drink more water.', reviewedAt: new Date(T0.getTime() + 60_000).toISOString() })
    // the surgeon cannot mark the crew member's reply as read
    expect(await status(b.markReportsRead([sent.id]))).toBe(403)
    await b.demoLogin('astronaut', 1)
    const [mine] = await b.reports()
    expect(isUnread(mine)).toBe(true)
    await b.markReportsRead([sent.id])
    const [after] = await b.reports()
    expect(isUnread(after)).toBe(false)
    // the surgeon sees that it was opened
    await b.demoLogin('surgeon')
    expect((await b.reports()).find((x) => x.id === sent.id)?.readAt).toBeTruthy()
  })

  it('a crew member cannot mark someone else’s report; queued reports stay unmarked', async () => {
    await b.demoLogin('astronaut', 2)
    const other = await b.sendReport(2, summary)
    await b.demoLogin('surgeon')
    await b.reviewReport(other.id, 'ok')
    await b.demoLogin('astronaut', 1)
    vi.setSystemTime(new Date(T0.getTime() + 5_000)) // demo report ids are timestamps
    const own = await b.sendReport(1, summary)
    await b.markReportsRead([other.id, own.id])
    await b.demoLogin('astronaut', 2)
    const [r2] = await b.reports()
    expect(r2.readAt).toBeNull()
    await b.demoLogin('astronaut', 1)
    expect((await b.reports())[0].readAt).toBeNull()
  })

  it('ground sees no reports and cannot mark or review; the surgeon cannot review a member’s summary', async () => {
    await b.demoLogin('astronaut', 3)
    const r = await b.sendReport(3, summary)
    await b.demoLogin('ground')
    expect(await b.reports()).toEqual([])
    expect(await status(b.markReportsRead([r.id]))).toBe(403)
    expect(await status(b.reviewReport(r.id, 'x'))).toBe(403)
    await b.demoLogin('surgeon')
    expect(await status(b.reviewReport(999, 'x'))).toBe(404)
  })
})

describe('device fallback for read markers', () => {
  const base: Report = { id: 7, crewId: 1, crewName: 'A', day: 1, createdAt: T0.toISOString(), status: 'reviewed', summary, reviewNote: 'x', reviewedBy: 'Dr', reviewedAt: undefined, readAt: undefined }
  it('applies only where the backend gave no marker', () => {
    const local = { 7: T0.toISOString() }
    expect(withLocalReads([base], local)[0].readAt).toBe(T0.toISOString())
    expect(withLocalReads([{ ...base, readAt: null }], local)[0].readAt).toBeNull()
  })
})
