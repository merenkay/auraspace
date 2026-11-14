// The concentric-ring orb. While listening it follows the real microphone level (WebAudio AnalyserNode);
// while speaking and thinking it moves by CSS only. Respects prefers-reduced-motion.
import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import type { Phase } from './useVoiceAgent'

export default function VoiceOrb({ phase, urgent }: { phase: Phase; urgent: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    const el = ref.current
    if (!el || phase !== 'listening' || reduce) {
      el?.style.setProperty('--lvl', '0')
      return
    }
    // A second microphone stream next to speech recognition can break recognition on phones,
    // so touch devices get a gentle synthetic pulse instead of the real level.
    const coarse = window.matchMedia('(pointer: coarse)').matches
    let raf = 0
    let stop = () => {}
    let alive = true
    if (coarse || !navigator.mediaDevices?.getUserMedia) {
      const t0 = performance.now()
      const tick = () => {
        el.style.setProperty('--lvl', (0.18 + 0.12 * Math.sin((performance.now() - t0) / 260)).toFixed(3))
        raf = requestAnimationFrame(tick)
      }
      tick()
      stop = () => cancelAnimationFrame(raf)
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
            const rms = Math.sqrt(sum / buf.length)
            smooth = smooth * 0.7 + Math.min(1, rms * 5) * 0.3
            el.style.setProperty('--lvl', smooth.toFixed(3))
            raf = requestAnimationFrame(tick)
          }
          tick()
          stop = () => {
            cancelAnimationFrame(raf)
            stream.getTracks().forEach((t) => t.stop()) // the microphone is released as soon as listening ends
            void ac.close()
          }
        })
        .catch(() => {
          /* no level meter: the orb simply stays calm */
        })
    }
    return () => {
      alive = false
      stop()
      el.style.setProperty('--lvl', '0')
    }
  }, [phase, reduce])

  const ticks = Array.from({ length: 36 }, (_, i) => i)
  return (
    <div ref={ref} className="vx-orb" data-phase={phase} data-urgent={urgent} aria-hidden="true">
      <svg viewBox="0 0 120 120" fill="none" stroke="currentColor">
        <g className="vx-ring-outer">
          <circle cx="60" cy="60" r="57" strokeWidth="1" strokeDasharray="2 5" opacity="0.65" />
        </g>
        <g className="vx-ring-ticks" strokeWidth="1">
          {ticks.map((i) => (
            <line key={i} x1="60" y1="11" x2="60" y2={i % 9 === 0 ? '17' : '14'} transform={`rotate(${i * 10} 60 60)`} opacity={i % 9 === 0 ? 0.9 : 0.4} />
          ))}
        </g>
        <circle cx="60" cy="60" r="41" strokeWidth="1" opacity="0.5" />
        <g className="vx-mid">
          <circle cx="60" cy="60" r="33" strokeWidth="1.25" opacity="0.8" />
        </g>
        <path className="vx-arc" d="M60 20 A40 40 0 0 1 100 60" strokeWidth="2" strokeLinecap="round" />
        <g className="vx-core">
          <circle cx="60" cy="60" r="19" strokeWidth="1.25" fill="currentColor" fillOpacity="0.14" />
          <circle cx="60" cy="60" r="7" fill="currentColor" stroke="none" opacity="0.9" />
        </g>
      </svg>
    </div>
  )
}
