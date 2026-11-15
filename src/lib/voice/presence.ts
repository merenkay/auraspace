// What AURA's voice is doing right now, as a tiny store any part of the page can read without importing the
// voice panel: the 3D "AURA core" on the consultation page uses it to listen, think and speak visibly.
//
// Written by the voice agent (useVoiceAgent publishes into it), by speech.ts for EVERY spoken reply (also the
// consultation's "Read aloud" and the guided tour) and by recognition.ts for the consultation's own dictation.
// Read by visual components. Two channels:
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
  /**
   * The AURA core fills the display (Fullscreen API, or the full-viewport fallback) and shows AURA's captions,
   * questions and the emergency sheet as pop-ups over the scene. A floating voice panel should hide itself:
   * with the real Fullscreen API it is not painted at all, and in the fallback it would cover the pop-ups.
   */
  fullscreen: boolean
}

let state: VoicePresence = { available: false, open: false, phase: 'idle', urgent: false, interim: '', caption: '', hosted: false, fullscreen: false }
let level = 0
const listeners = new Set<() => void>()

// The published phase combines three writers: the voice agent's own phase, speech output from anywhere in the app
// (speaking wins), and dictation started outside the voice panel (listening when the agent is idle).
let agentPhase: VoicePhase = 'idle'
let speechOn = false
let dictationOn = false
const effective = (): VoicePhase => (speechOn ? 'speaking' : agentPhase !== 'idle' ? agentPhase : dictationOn ? 'listening' : 'idle')

export function getVoicePresence(): VoicePresence {
  return state
}

export function subscribeVoicePresence(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

function apply(patch: Partial<VoicePresence>) {
  let changed = false
  for (const k of Object.keys(patch) as (keyof VoicePresence)[]) {
    if (patch[k] !== undefined && patch[k] !== state[k]) changed = true
  }
  if (!changed) return
  state = { ...state, ...patch }
  for (const fn of [...listeners]) fn()
}

/** Publish a change (the voice agent's view). Only differing fields notify subscribers. */
export function setVoicePresence(patch: Partial<VoicePresence>) {
  if (patch.phase !== undefined) {
    agentPhase = patch.phase
    patch = { ...patch, phase: effective() }
  }
  apply(patch)
}

/** speech.ts: something is being spoken (any caller), or the queue is empty again. */
export function setSpeechActive(on: boolean) {
  if (speechOn === on) return
  speechOn = on
  apply({ phase: effective() })
}

/** recognition.ts: dictation outside the voice panel (e.g. the consultation's microphone) started or ended. */
export function setDictationActive(on: boolean) {
  if (dictationOn === on) return
  dictationOn = on
  apply({ phase: effective() })
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

/** The AURA core entered / left full screen (call with false in the effect cleanup). */
export function setVoiceFullscreen(on: boolean) {
  setVoicePresence({ fullscreen: on })
}
