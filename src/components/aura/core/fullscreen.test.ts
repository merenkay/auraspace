import { describe, expect, it } from 'vitest'
import { captionOf, fullscreenKey, popupPlan, type PopupInput } from './popups'

const base: PopupInput = { done: false, emergency: false, voiceUrgent: false, pending: false, dismissed: false, sheetMin: false }

describe('full-screen pop-ups: what is on screen', () => {
  it('shows the message card with typed input before any question', () => {
    expect(popupPlan(base)).toEqual({ sheet: null, bar: false, side: 'message', composer: true })
  })

  it('shows the question card while a question is waiting', () => {
    expect(popupPlan({ ...base, pending: true }).side).toBe('question')
  })

  it('a dismissed card leaves a chip, so a question is never lost', () => {
    expect(popupPlan({ ...base, pending: true, dismissed: true }).side).toBe('chip')
  })

  it('an emergency result is the centre sheet, not a side card, and typed input is gone', () => {
    expect(popupPlan({ ...base, done: true, emergency: true })).toEqual({ sheet: 'emergency', bar: false, side: null, composer: false })
  })

  it('"Stay here" folds the emergency into a bar: it is still on screen', () => {
    const p = popupPlan({ ...base, done: true, emergency: true, sheetMin: true })
    expect(p.sheet).toBeNull()
    expect(p.bar).toBe(true)
  })

  it('an emergency cannot be dismissed with the message card', () => {
    expect(popupPlan({ ...base, done: true, emergency: true, dismissed: true }).sheet).toBe('emergency')
  })

  it('an emergency spoken by the voice assistant also raises the sheet, and the conversation stays', () => {
    const p = popupPlan({ ...base, voiceUrgent: true, pending: true })
    expect(p.sheet).toBe('voice')
    expect(p.side).toBe('question')
  })

  it('the consultation’s own emergency wins over the voice one', () => {
    expect(popupPlan({ ...base, done: true, emergency: true, voiceUrgent: true }).sheet).toBe('emergency')
  })

  it('a result that is not an emergency is a card on the side', () => {
    expect(popupPlan({ ...base, done: true })).toEqual({ sheet: null, bar: false, side: 'result', composer: false })
  })
})

describe('full-screen caption', () => {
  const quiet = { phase: 'idle' as const, interim: '', caption: '', dictating: false, dictText: '' }

  it('is not live when nothing happens (the card fades)', () => {
    expect(captionOf({ ...quiet, caption: 'An earlier reply' }).live).toBe(false)
  })

  it('quotes the words heard so far', () => {
    expect(captionOf({ ...quiet, phase: 'listening', interim: ' my chest hurts ' })).toEqual({ label: 'Listening', line: 'my chest hurts', quote: true, live: true })
  })

  it('invites speech before any word arrives', () => {
    const c = captionOf({ ...quiet, phase: 'listening' })
    expect(c.quote).toBe(false)
    expect(c.line).toMatch(/listening/i)
  })

  it('shows the page’s own dictation as listening', () => {
    expect(captionOf({ ...quiet, dictating: true, dictText: 'dizzy' })).toEqual({ label: 'Listening', line: 'dizzy', quote: true, live: true })
  })

  it('speech wins over dictation, and is never quoted as the person’s words', () => {
    const c = captionOf({ ...quiet, phase: 'speaking', caption: 'Do you feel sick?', dictating: true, dictText: 'x' })
    expect(c).toEqual({ label: 'Speaking', line: 'Do you feel sick?', quote: false, live: true })
  })

  it('keeps what was heard while AURA works on it', () => {
    expect(captionOf({ ...quiet, phase: 'thinking', interim: 'headache' }).line).toBe('headache')
  })
})

describe('full-screen keys', () => {
  it('F toggles, in either case', () => {
    expect(fullscreenKey({ key: 'f' }, false, null)).toBe('toggle')
    expect(fullscreenKey({ key: 'F' }, false, 'api')).toBe('toggle')
  })

  it('F is a letter while typing', () => {
    expect(fullscreenKey({ key: 'f' }, true, null)).toBeNull()
  })

  it('shortcuts with a modifier, repeats and handled keys are left alone', () => {
    expect(fullscreenKey({ key: 'f', ctrlKey: true }, false, null)).toBeNull()
    expect(fullscreenKey({ key: 'f', metaKey: true }, false, null)).toBeNull()
    expect(fullscreenKey({ key: 'f', altKey: true }, false, null)).toBeNull()
    expect(fullscreenKey({ key: 'f', repeat: true }, false, null)).toBeNull()
    expect(fullscreenKey({ key: 'f', defaultPrevented: true }, false, null)).toBeNull()
  })

  it('Esc leaves the CSS fallback only (the browser handles the real API)', () => {
    expect(fullscreenKey({ key: 'Escape' }, false, 'css')).toBe('exit')
    expect(fullscreenKey({ key: 'Escape' }, true, 'css')).toBe('exit')
    expect(fullscreenKey({ key: 'Escape' }, false, 'api')).toBeNull()
    expect(fullscreenKey({ key: 'Escape' }, false, null)).toBeNull()
  })
})
