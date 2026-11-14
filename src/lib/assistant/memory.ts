// Short-term conversation memory for one session (never stored). It lets AURA answer follow-ups such as
// "and yesterday?", "why?" or "tell me more", and remember what the person likes to be called.
import type { VitalKey } from '../../data/vitals'

export type Offer =
  | { kind: 'logMood'; value: number }
  | { kind: 'consult' }
  | { kind: 'nav'; target: 'coach' | 'history' | 'environment' | 'aura' | 'overview' }
  | { kind: 'joke' }

export type Memory = {
  /** Turn counter, also the seed for wording variation. */
  turn: number
  /** What the person asked to be called this session ("call me Mira"). */
  name: string | null
  /** Topic of the last answer: a vital key, 'status', 'score', 'alerts', 'joke', 'weather', ... */
  lastTopic: string | null
  /** Last vital the person asked about (for "and yesterday?"). */
  lastReading: VitalKey | null
  /** Reason behind the last answer (for "why?"). */
  why: string | null
  /** More detail for the last answer (for "tell me more"). */
  more: string | null
  /** Something AURA offered that "yes" accepts. */
  offer: Offer | null
  /** Index of the last joke told, so the next one differs. */
  joke: number
}

export const newMemory = (): Memory => ({ turn: 0, name: null, lastTopic: null, lastReading: null, why: null, more: null, offer: null, joke: -1 })

/** Deterministic variation: the same situation gets different wording on different turns, never random. */
export function vary<T>(options: readonly T[], turn: number, salt = ''): T {
  let h = 0
  for (let i = 0; i < salt.length; i++) h = (h * 31 + salt.charCodeAt(i)) | 0
  return options[Math.abs(h + turn) % options.length]
}
