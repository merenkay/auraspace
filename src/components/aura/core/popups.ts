// Pure rules of the full-screen pop-ups: which cards are on screen for a given consultation / voice state, what
// the caption card says, and which keys enter and leave full screen. No DOM and no React: unit tested.
import type { VoicePhase } from '../../../lib/voice/presence'

export type FullscreenMode = 'api' | 'css'

/** Milliseconds a caption stays after AURA stops listening / speaking, then it fades so the core is clear again. */
export const CAPTION_HOLD_MS = 4000

export type PopupInput = {
  /** the consultation has produced a result */
  done: boolean
  /** that result is an emergency */
  emergency: boolean
  /** the voice assistant is giving an emergency reply (presence.urgent) */
  voiceUrgent: boolean
  /** a yes / no / not sure question is waiting */
  pending: boolean
  /** the person closed the message card for the current message */
  dismissed: boolean
  /** the person chose "Stay here" on the emergency sheet */
  sheetMin: boolean
}

export type PopupPlan = {
  /** the centre sheet: the one pop-up allowed to cover the core */
  sheet: 'emergency' | 'voice' | null
  /** the emergency stays on screen as a bar after "Stay here": it can be reopened, never lost */
  bar: boolean
  /** the card in the right column */
  side: 'question' | 'message' | 'result' | 'chip' | null
  /** typed input is offered (never after the result: the page has the result's own actions) */
  composer: boolean
}

export function popupPlan(i: PopupInput): PopupPlan {
  const urgent = i.done && i.emergency ? 'emergency' : i.voiceUrgent ? 'voice' : null
  return {
    sheet: urgent && !i.sheetMin ? urgent : null,
    bar: !!urgent && i.sheetMin,
    // an emergency result is the sheet, not a side card; a dismissed card leaves a chip so a question is never lost
    side: i.done ? (i.emergency ? null : 'result') : i.dismissed ? 'chip' : i.pending ? 'question' : 'message',
    composer: !i.done,
  }
}

export type CaptionInput = {
  phase: VoicePhase
  /** words heard so far by the voice assistant */
  interim: string
  /** what AURA is saying */
  caption: string
  /** the consultation's own dictation is running, with the words it has so far */
  dictating: boolean
  dictText: string
}

export type Caption = { label: string; line: string; /** the line is the person's own words */ quote: boolean; /** something is happening now: the card stays */ live: boolean }

export function captionOf(i: CaptionInput): Caption {
  const heard = i.interim.trim()
  const said = i.caption.trim()
  if (i.phase === 'speaking') return { label: 'Speaking', line: said || 'The answer is in the conversation.', quote: false, live: true }
  if (i.dictating) {
    const t = i.dictText.trim()
    return { label: 'Listening', line: t || 'Go ahead, I am listening.', quote: !!t, live: true }
  }
  if (i.phase === 'listening') return { label: 'Listening', line: heard || 'Go ahead, I am listening.', quote: !!heard, live: true }
  if (i.phase === 'thinking') return { label: 'Working on it', line: heard || 'One moment.', quote: !!heard, live: true }
  return { label: 'Ready', line: '', quote: false, live: false }
}

export type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; repeat?: boolean; defaultPrevented?: boolean }

/**
 * `F` toggles full screen unless the person is typing; `Esc` leaves the CSS fallback (the browser itself handles
 * Esc for the real Fullscreen API and reports it with `fullscreenchange`).
 */
export function fullscreenKey(e: KeyLike, typing: boolean, mode: FullscreenMode | null): 'toggle' | 'exit' | null {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null
  if ((e.key === 'f' || e.key === 'F') && !typing) return 'toggle'
  if (e.key === 'Escape' && mode === 'css') return 'exit'
  return null
}
