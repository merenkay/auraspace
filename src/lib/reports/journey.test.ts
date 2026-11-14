import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRemaining, isUnread, reachesReviewer, simulatedJourney, storedState } from './journey'

const T0 = Date.parse('2026-11-14T10:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('stored status', () => {
  it('only the simulated crew reaches a reviewer', () => {
    expect(reachesReviewer('astronaut')).toBe(true)
    for (const r of ['member', 'surgeon', 'ground', undefined] as const) expect(reachesReviewer(r)).toBe(false)
  })
  it('derives the truthful state from the stored status only', () => {
    expect(storedState({ status: 'queued' }, true)).toBe('awaiting')
    expect(storedState({ status: 'delivered' }, true)).toBe('awaiting')
    expect(storedState({ status: 'queued' }, false)).toBe('saved')
    expect(storedState({ status: 'reviewed' }, true)).toBe('replied')
  })
})

describe('simulated signal delay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
  })
  afterEach(() => vi.useRealTimers())

  it('no simulation without a delay (ISS profile)', () => {
    expect(simulatedJourney({ createdAt: iso(T0), status: 'queued', reviewedAt: null }, 0, Date.now())).toBeNull()
  })

  it('report travels to Earth for the one-way delay, then arrives — the stored status is untouched', () => {
    const r = { createdAt: iso(T0), status: 'queued' as const, reviewedAt: null }
    let j = simulatedJourney(r, 840, Date.now())!
    expect(j.out).toMatchObject({ arrived: false, remainingSec: 840 })
    expect(j.reply).toBeNull()
    vi.advanceTimersByTime(839_000)
    expect(simulatedJourney(r, 840, Date.now())!.out.remainingSec).toBe(1)
    vi.advanceTimersByTime(1_000)
    j = simulatedJourney(r, 840, Date.now())!
    expect(j.out.arrived).toBe(true)
    expect(r.status).toBe('queued')
  })

  it('reply leaves when written but not before the report would have arrived, then travels back', () => {
    // Surgeon replied 60 s after sending: the simulated reply cannot leave before the report arrives (840 s).
    const r = { createdAt: iso(T0), status: 'reviewed' as const, reviewedAt: iso(T0 + 60_000) }
    const j = simulatedJourney(r, 840, Date.now())!
    expect(j.reply!.at).toBe(T0 + 1_680_000)
    vi.setSystemTime(T0 + 1_680_000)
    expect(simulatedJourney(r, 840, Date.now())!.reply!.arrived).toBe(true)
    // Reply written long after arrival: it leaves at the reply time.
    const late = { ...r, reviewedAt: iso(T0 + 3_600_000) }
    expect(simulatedJourney(late, 840, Date.now())!.reply!.at).toBe(T0 + 3_600_000 + 840_000)
  })

  it('no reply leg when the reply time is unknown (server without the read-marker module)', () => {
    expect(simulatedJourney({ createdAt: iso(T0), status: 'reviewed' }, 840, Date.now())!.reply).toBeNull()
  })

  it('formats remaining time', () => {
    expect(formatRemaining(0)).toBe('under a second')
    expect(formatRemaining(40)).toBe('40 s')
    expect(formatRemaining(660)).toBe('about 11 min')
  })
})

describe('unread replies', () => {
  it('only replies can be unread', () => {
    expect(isUnread({ status: 'queued', readAt: null })).toBe(false)
    expect(isUnread({ status: 'reviewed', readAt: null, reviewedAt: iso(T0) })).toBe(true)
    expect(isUnread({ status: 'reviewed', readAt: iso(T0 + 1000), reviewedAt: iso(T0) })).toBe(false)
  })
  it('a reply changed after it was read is unread again', () => {
    expect(isUnread({ status: 'reviewed', readAt: iso(T0), reviewedAt: iso(T0 + 1000) })).toBe(true)
  })
  it('uses the device fallback only when the backend has no marker', () => {
    expect(isUnread({ status: 'reviewed' }, iso(T0))).toBe(false)
    expect(isUnread({ status: 'reviewed' })).toBe(true)
  })
})
