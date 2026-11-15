// Voice settings, remembered on this device only (localStorage key aura.voice.v1).
import type { Sensitivity } from './vad'
export type VoiceLang = 'en-US' | 'tr-TR'
/** How long AURA waits for the person to finish: short / normal / long silence windows (see TIMING in endpoint.ts). */
export type ListenLength = 'short' | 'normal' | 'long'
export type VoiceSettings = {
  /** Speak replies aloud. Captions are always shown. */
  speak: boolean
  /**
   * Listen for "hey AURA" / "AURA" (and, with wakeHey, a plain "hey"). On by default, but the microphone is only
   * opened for it after the person has deliberately used the microphone once in this tab (wake.ts: armed).
   */
  wake: boolean
  /** Also wake on a plain, standalone "hey" (the team's request); off = only "hey AURA" and "AURA". */
  wakeHey: boolean
  /** The person flipped the wake switch themselves (otherwise the default applies, see loadSettings). */
  wakeSet: boolean
  /** Language the person speaks to AURA. Replies are always English. */
  lang: VoiceLang
  /** Speech rate 0.7 - 1.3 */
  rate: number
  /** Read consultation questions and results aloud on the AURA tab. */
  readConsult: boolean
  /** Listening time: how much silence ends a spoken command. */
  listen: ListenLength
  /** Chosen speech-synthesis voice (voiceURI); null = the best-ranked English voice on this device. */
  voice: string | null
  /** Microphone sensitivity: how far above the room's noise a sound must be to count as speech (see vad.ts). */
  sensitivity: Sensitivity
}

export const DEFAULTS: VoiceSettings = { speak: true, wake: true, wakeHey: true, wakeSet: false, lang: 'en-US', rate: 1, readConsult: false, listen: 'normal', voice: null, sensitivity: 'auto' }
const KEY = 'aura.voice.v1'

export function loadSettings(): VoiceSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VoiceSettings>
    // Before 2026-11-15 every saved settings object carried `wake: false` (the old default, written with any other
    // change), so a stored false only counts when the person chose it themselves (wakeSet). The guided tour forces
    // the wake word off on its own (useVoiceAgent checks isDemoActive()), whatever is stored here.
    const wakeSet = raw.wakeSet === true
    return {
      speak: typeof raw.speak === 'boolean' ? raw.speak : DEFAULTS.speak,
      wake: wakeSet && typeof raw.wake === 'boolean' ? raw.wake : DEFAULTS.wake,
      wakeHey: typeof raw.wakeHey === 'boolean' ? raw.wakeHey : DEFAULTS.wakeHey,
      wakeSet,
      lang: raw.lang === 'tr-TR' ? 'tr-TR' : 'en-US',
      rate: typeof raw.rate === 'number' && raw.rate >= 0.7 && raw.rate <= 1.3 ? raw.rate : DEFAULTS.rate,
      readConsult: typeof raw.readConsult === 'boolean' ? raw.readConsult : DEFAULTS.readConsult,
      listen: raw.listen === 'short' || raw.listen === 'long' ? raw.listen : 'normal',
      voice: typeof raw.voice === 'string' && raw.voice.length > 0 && raw.voice.length < 300 ? raw.voice : null,
      sensitivity: raw.sensitivity === 'low' || raw.sensitivity === 'normal' || raw.sensitivity === 'high' ? raw.sensitivity : 'auto',
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: VoiceSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* remembered for this page only */
  }
}
