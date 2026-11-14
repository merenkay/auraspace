// The concentric-ring orb. While listening it follows the real microphone level and while speaking the speech
// envelope, both read from the shared voice presence store (src/lib/voice/presence.ts, metered by level.ts and
// speech.ts), so the orb never opens a microphone stream of its own. Respects prefers-reduced-motion.
import { useEffect, useRef } from 'react'
import { useReducedMotion } from 'motion/react'
import { getVoiceLevel } from '../../lib/voice/presence'
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
    let raf = 0
    const tick = () => {
      el.style.setProperty('--lvl', getVoiceLevel().toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
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
