import { motion } from 'motion/react'
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Logo } from './ui'

const SpaceScene = lazy(() => import('./three/SpaceScene'))

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0">
        <Suspense fallback={null}>
          <SpaceScene />
        </Suspense>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-space via-space/85 to-transparent" />
      <main className="relative z-10 flex min-h-screen items-center px-5 py-10 sm:px-12">
        <motion.div initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="w-full max-w-md">
          <Link to="/login" className="flex w-fit items-center gap-3">
            <Logo size={44} />
            <div>
              <div className="font-display text-2xl font-bold tracking-[0.12em]">AURA</div>
              <div className="text-[11px] tracking-[0.2em] text-dim">FULL BODY DIAGNOSTICS</div>
            </div>
          </Link>
          {children}
        </motion.div>
      </main>
    </div>
  )
}

export const inputCls = 'mt-1.5 w-full rounded-xl border border-line bg-space/70 px-4 py-3 text-ink outline-none transition focus:border-cyan'
export const primaryBtn = 'w-full rounded-xl bg-cyan py-3 font-semibold text-space transition hover:bg-ice disabled:opacity-40'

/** Six separate digit boxes; supports paste and backspace navigation. */
export function CodeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.padEnd(6, ' ').slice(0, 6).split('')
  const set = (i: number, d: string) => {
    const next = digits.map((x, j) => (j === i ? d : x)).join('').replace(/\s+$/, '')
    onChange(next.replace(/ /g, ''))
  }
  return (
    <div className="flex justify-between gap-2" role="group" aria-label="Verification code">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          maxLength={1}
          disabled={disabled}
          value={d.trim()}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
            if (t) {
              e.preventDefault()
              onChange(t)
              refs.current[Math.min(5, t.length)]?.focus()
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !d.trim() && i > 0) refs.current[i - 1]?.focus()
          }}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(-1)
            set(i, v || ' ')
            if (v && i < 5) refs.current[i + 1]?.focus()
          }}
          className="h-14 w-12 rounded-xl border border-line bg-space/70 text-center font-display text-2xl font-bold outline-none transition focus:border-cyan sm:w-14"
        />
      ))}
    </div>
  )
}

/** Countdown for "resend code" (seconds). */
export function useCooldown(initial = 60) {
  const [left, setLeft] = useState(initial)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft((l) => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  return { left, restart: () => setLeft(initial) }
}

export function DemoCodeNote({ code }: { code?: string }) {
  if (!code) return null
  return (
    <p className="rounded-xl border border-warn/60 bg-warn/10 p-3 text-sm text-warn">
      Demo mode: email sending is not connected, so here is your code: <strong className="tracking-widest">{code}</strong>
    </p>
  )
}
