// The speech lifecycle guard: speech never outlives the page and stops in a page nobody is looking at.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HIDDEN_SPEECH_MS, installSpeechGuard } from './speech'

function fakePage() {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { hidden: false })
  const synth = { cancelled: 0, urgent: false }
  const off = installSpeechGuard(win, doc, { cancel: () => synth.cancelled++, urgentNow: () => synth.urgent })
  const setHidden = (h: boolean) => {
    doc.hidden = h
    doc.dispatchEvent(new Event('visibilitychange'))
  }
  return { win, doc, synth, off, setHidden }
}

describe('speech guard', () => {
  afterEach(() => vi.useRealTimers())

  it('cancels all speech when the page is left (pagehide, beforeunload)', () => {
    const p = fakePage()
    p.win.dispatchEvent(new Event('pagehide'))
    expect(p.synth.cancelled).toBe(1)
    p.win.dispatchEvent(new Event('beforeunload'))
    expect(p.synth.cancelled).toBe(2)
    p.off()
    p.win.dispatchEvent(new Event('pagehide'))
    expect(p.synth.cancelled).toBe(2)
  })

  it('stops non-urgent speech a few seconds after the page is hidden, not before', () => {
    vi.useFakeTimers()
    const p = fakePage()
    p.setHidden(true)
    vi.advanceTimersByTime(HIDDEN_SPEECH_MS - 100)
    expect(p.synth.cancelled).toBe(0)
    vi.advanceTimersByTime(200)
    expect(p.synth.cancelled).toBe(1)
  })

  it('a quick look away and back does not cut speech off', () => {
    vi.useFakeTimers()
    const p = fakePage()
    p.setHidden(true)
    vi.advanceTimersByTime(1000)
    p.setHidden(false)
    vi.advanceTimersByTime(HIDDEN_SPEECH_MS * 2)
    expect(p.synth.cancelled).toBe(0)
  })

  it('lets emergency instructions finish while hidden', () => {
    vi.useFakeTimers()
    const p = fakePage()
    p.synth.urgent = true
    p.setHidden(true)
    vi.advanceTimersByTime(HIDDEN_SPEECH_MS * 2)
    expect(p.synth.cancelled).toBe(0)
    // but leaving the page still silences everything
    p.win.dispatchEvent(new Event('pagehide'))
    expect(p.synth.cancelled).toBe(1)
  })
})
