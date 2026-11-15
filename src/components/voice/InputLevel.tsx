// The small live input meter shown while AURA listens (lib/voice/level.ts measures; nothing is recorded).
import { useEffect, useRef, useState } from 'react'
import { micLevelNow } from '../../lib/voice/level'
import './mic.css'

/** A few bars beside “Listening…”: proof that sound is arriving, and whether it counts as a voice. */
export default function InputLevel({ className }: { className?: string }) {
  const el = useRef<HTMLSpanElement>(null)
  const [live, setLive] = useState(false)
  useEffect(() => {
    let raf = 0
    let was = false
    const BARS = 7
    const tick = () => {
      const m = micLevelNow()
      if (!!m !== was) {
        was = !!m
        setLive(was)
      }
      const root = el.current
      if (m && root) {
        const on = Math.round(m.level * BARS)
        root.toggleAttribute('data-voiced', m.voiced)
        for (let i = 0; i < root.children.length; i++) root.children[i].toggleAttribute('data-on', i < Math.max(1, on))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  // nothing measured (phones, no permission): show nothing rather than a pretend meter
  return (
    <span ref={el} className={`mic-live ${className ?? ''}`} hidden={!live} role="img" aria-label="Microphone input level">
      {Array.from({ length: 7 }, (_, i) => (
        <i key={i} style={{ transform: `scaleY(${0.45 + (i / 6) * 0.55})` }} />
      ))}
    </span>
  )
}
