// What AURA's voice is doing right now, as a tiny store any part of the page can read without importing the
// voice panel: the 3D "AURA core" on the consultation page uses it to listen, think and speak visibly.
//
// Written by the voice agent (useVoiceAgent publishes into it); read by visual components. Two channels:
//  - snapshot: low-frequency state, safe for React (useSyncExternalStore).
//  - level: a number updated at audio/frame rate. Read it inside an animation loop with getVoiceLevel();
//    it never triggers a React render.

export type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking'

export type VoicePresence = {
  /** Speech output and/or recognition exist in this browser. */
  available: boolean
  /** The voice panel (or an embedded host) is active. */
  open: boolean
  phase: VoicePhase
  /** An emergency reply is being shown or spoken. */
  urgent: boolean
  /** Words heard so far in the current utterance (interim transcript). */
  interim: string
  /** The latest thing AURA said or is saying, as text. */
  caption: string
  /** A visual host (the AURA core) is on screen and wants to be the face of the voice: the panel may go compact. */
  hosted: boolean
}

let state: VoicePresence = { available: false, open: false, phase: 'idle', urgent: false, interim: '', caption: '', hosted: false }
let level = 0
const listeners = new Set<() => void>()

export function getVoicePresence(): VoicePresence {
  return state
}

export function subscribeVoicePresence(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Publish a change. Only differing fields notify subscribers. */
export function setVoicePresence(patch: Partial<VoicePresence>) {
  let changed = false
  for (const k of Object.keys(patch) as (keyof VoicePresence)[]) {
    if (patch[k] !== undefined && patch[k] !== state[k]) changed = true
  }
  if (!changed) return
  state = { ...state, ...patch }
  for (const fn of [...listeners]) fn()
}

/** 0..1: microphone level while listening, speech energy (real or synthesised envelope) while speaking. */
export function getVoiceLevel(): number {
  return level
}

export function setVoiceLevel(v: number) {
  level = v < 0 ? 0 : v > 1 ? 1 : v
}

/** A visual host mounts/unmounts (call with false in the effect cleanup). */
export function setVoiceHosted(on: boolean) {
  setVoicePresence({ hosted: on })
}
