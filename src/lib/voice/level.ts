// Microphone level for the visuals (the voice orb and the 3D AURA core), published into presence.ts at frame rate.
// One shared meter for every listener (reference counted), so the voice panel and the consultation's dictation
// never open two extra microphone streams. On touch devices a second microphone stream next to speech recognition
// can break recognition, so they get a gentle synthetic pulse instead of the real level. Nothing is recorded.
import { setVoiceLevel } from './presence'

let users = 0
let close: (() => void) | null = null

/** Start metering (or join the running meter). Returns the stop function; safe to call more than once. */
export function startMicLevel(): () => void {
  users++
  if (users === 1) close = open()
  let done = false
  return () => {
    if (done) return
    done = true
    users = Math.max(0, users - 1)
    if (users === 0) {
      close?.()
      close = null
      setVoiceLevel(0)
    }
  }
}

function open(): () => void {
  if (typeof window === 'undefined' || typeof requestAnimationFrame === 'undefined') return () => {}
  let raf = 0
  let alive = true
  let release = () => {}
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (coarse || reduce || !navigator.mediaDevices?.getUserMedia) {
    const t0 = performance.now()
    const tick = () => {
      setVoiceLevel(reduce ? 0.15 : 0.18 + 0.12 * Math.sin((performance.now() - t0) / 260))
      raf = requestAnimationFrame(tick)
    }
    tick()
  } else {
    void navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        if (!alive) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ac = new AC()
        const an = ac.createAnalyser()
        an.fftSize = 512
        ac.createMediaStreamSource(stream).connect(an)
        const buf = new Uint8Array(an.fftSize)
        let smooth = 0
        const tick = () => {
          an.getByteTimeDomainData(buf)
          let sum = 0
          for (const b of buf) sum += ((b - 128) / 128) ** 2
          smooth = smooth * 0.7 + Math.min(1, Math.sqrt(sum / buf.length) * 5) * 0.3
          setVoiceLevel(smooth)
          raf = requestAnimationFrame(tick)
        }
        tick()
        release = () => {
          stream.getTracks().forEach((t) => t.stop()) // the microphone is released as soon as listening ends
          void ac.close()
        }
      })
      .catch(() => {
        /* no level meter: the visuals simply stay calm */
      })
  }
  return () => {
    alive = false
    cancelAnimationFrame(raf)
    release()
  }
}
