// Voice settings, remembered on this device only (localStorage key aura.voice.v1).
export type VoiceLang = 'en-US' | 'tr-TR'
/** How long AURA waits for the person to finish: short / normal / long silence windows (see TIMING in endpoint.ts). */
export type ListenLength = 'short' | 'normal' | 'long'
export type VoiceSettings = {
  /** Speak replies aloud. Captions are always shown. */
  speak: boolean
  /** Listen continuously for "AURA" / "hey AURA" (the microphone stays open while this is on). */
  wake: boolean
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
}

export const DEFAULTS: VoiceSettings = { speak: true, wake: false, lang: 'en-US', rate: 1, readConsult: false, listen: 'normal', voice: null }
const KEY = 'aura.voice.v1'

export function loadSettings(): VoiceSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<VoiceSettings>
    return {
      speak: typeof raw.speak === 'boolean' ? raw.speak : DEFAULTS.speak,
      wake: typeof raw.wake === 'boolean' ? raw.wake : DEFAULTS.wake,
      lang: raw.lang === 'tr-TR' ? 'tr-TR' : 'en-US',
      rate: typeof raw.rate === 'number' && raw.rate >= 0.7 && raw.rate <= 1.3 ? raw.rate : DEFAULTS.rate,
      readConsult: typeof raw.readConsult === 'boolean' ? raw.readConsult : DEFAULTS.readConsult,
      listen: raw.listen === 'short' || raw.listen === 'long' ? raw.listen : 'normal',
      voice: typeof raw.voice === 'string' && raw.voice.length > 0 && raw.voice.length < 300 ? raw.voice : null,
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
