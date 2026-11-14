// Short synthesised interface sounds (no audio files, works offline). Off until the person turns sound on;
// the choice is remembered on this device. Safe to call anywhere: it does nothing when muted or unsupported.
export type Sfx = 'tick' | 'select' | 'open' | 'close' | 'confirm' | 'listen' | 'done' | 'warn' | 'alarm'

const KEY = 'aura.sfx.v1'
let ctx: AudioContext | null = null
let enabled: boolean | null = null

export function sfxEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(KEY) === '1'
    } catch {
      enabled = false
    }
  }
  return enabled
}

export function setSfxEnabled(on: boolean) {
  enabled = on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* remembered for this page only */
  }
}

// [frequency Hz, start s, duration s, peak gain]
const TONES: Record<Sfx, [number, number, number, number][]> = {
  tick: [[1800, 0, 0.03, 0.04]],
  select: [[880, 0, 0.06, 0.06], [1320, 0.05, 0.09, 0.05]],
  open: [[520, 0, 0.08, 0.05], [780, 0.07, 0.12, 0.05]],
  close: [[780, 0, 0.08, 0.05], [520, 0.07, 0.12, 0.05]],
  confirm: [[660, 0, 0.07, 0.06], [990, 0.08, 0.14, 0.06]],
  listen: [[1040, 0, 0.05, 0.05], [1560, 0.06, 0.07, 0.04]],
  done: [[1560, 0, 0.05, 0.04], [1040, 0.06, 0.09, 0.04]],
  warn: [[440, 0, 0.14, 0.07], [440, 0.2, 0.14, 0.07]],
  alarm: [[880, 0, 0.16, 0.09], [660, 0.18, 0.16, 0.09], [880, 0.36, 0.16, 0.09]],
}

export function sfx(name: Sfx) {
  if (!sfxEnabled() || typeof window === 'undefined') return
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx ??= new AC()
    if (ctx.state === 'suspended') void ctx.resume()
    const t0 = ctx.currentTime
    for (const [freq, at, dur, peak] of TONES[name]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0, t0 + at)
      gain.gain.linearRampToValueAtTime(peak, t0 + at + 0.008)
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t0 + at)
      osc.stop(t0 + at + dur + 0.02)
    }
  } catch {
    /* sound is decoration: never break the app over it */
  }
}
