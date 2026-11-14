import { Database, HardDrive } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Context } from '../data/contexts'
import { useSession } from '../lib/session'
import OfflineBadge from './OfflineBadge'
import { Button, Logo, MotionRoot, Notice, Stagger, StaggerItem, controlCls, cx, useContextAccent } from './ui'

/**
 * Frame for the signed-out pages. One grid for all three: the story on the left (title, lead, `aside`),
 * the task on the right (`children`). On a phone the order is title → task → aside.
 */
export function AuthLayout({ title, lead, eyebrow, aside, children, context, hero = false }: { title: ReactNode; lead?: ReactNode; eyebrow?: ReactNode; aside?: ReactNode; children: ReactNode; context?: Context | null; hero?: boolean }) {
  const { backend } = useSession()
  useContextAccent(context ?? 'space')
  const server = backend?.mode === 'server'
  const Mode = server ? Database : HardDrive
  return (
    <MotionRoot>
      <div className="flex min-h-dvh flex-col">
        <header className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
          <Link to="/login" aria-label="AURA — sign in" className="-ml-1 flex h-11 items-center rounded-lg px-1">
            <Logo wordmark size={28} />
          </Link>
          <div className="flex items-center gap-3">
          <OfflineBadge />
          <p className="flex items-center gap-2 text-right text-xs text-dim">
            <Mode className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {server ? (
              'Connected to the mission database'
            ) : (
              <span>
                Demo mode<span className="hidden sm:inline"> · data stays in this browser</span>
              </span>
            )}
          </p>
          </div>
        </header>

        <main className="mx-auto grid w-full max-w-[1200px] flex-1 content-start gap-x-16 gap-y-8 px-5 pb-12 pt-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:grid-rows-[auto_1fr] lg:pt-12">
          <Stagger className="lg:col-start-1 lg:row-start-1" step={0.05}>
            {eyebrow && (
              <StaggerItem>
                <p className="mb-2 text-sm text-dim">{eyebrow}</p>
              </StaggerItem>
            )}
            <StaggerItem>
              <h1 className={cx('text-ink', hero ? 'max-w-xl text-[2.125rem] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-display' : 'text-title')}>{title}</h1>
            </StaggerItem>
            {lead && (
              <StaggerItem>
                <p className={cx('max-w-lg text-soft', hero ? 'mt-5 text-[17px] leading-relaxed' : 'mt-3')}>{lead}</p>
              </StaggerItem>
            )}
          </Stagger>

          <div className="w-full max-w-md lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:max-w-none">{children}</div>

          {aside && <div className="lg:col-start-1 lg:row-start-2">{aside}</div>}
        </main>

        <footer className="mx-auto w-full max-w-[1200px] px-5 pb-6 sm:px-8">
          <p className="border-t border-line pt-4 text-xs leading-relaxed text-dim">AURA is decision support, not a diagnosis, and does not replace a doctor or emergency services. A NASA Space Apps 2026 project — not affiliated with NASA.</p>
        </footer>
      </div>
    </MotionRoot>
  )
}

/** @deprecated Use <Input> from ui.tsx. */
export const inputCls = `${controlCls} mt-1.5 h-11`
/** @deprecated Use <Button variant="primary" full> from ui.tsx. */
export const primaryBtn = 'h-12 w-full rounded-lg bg-ink font-medium text-space transition-colors hover:bg-white disabled:opacity-45'

/**
 * Six digit boxes that behave like one field: type, paste, Backspace and arrow keys all work,
 * and the code is announced to password managers as a one-time code. `invalid` shakes the row once.
 */
export function CodeInput({ value, onChange, disabled, invalid = false, autoFocus = false }: { value: string; onChange: (v: string) => void; disabled?: boolean; invalid?: boolean; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = value.replace(/\D/g, '').slice(0, 6)
  const focus = (i: number) => refs.current[Math.max(0, Math.min(5, i))]?.focus()
  const group = useRef<HTMLDivElement>(null)
  // A refused code shakes the row once (skipped when the OS asks for reduced motion).
  useEffect(() => {
    if (!invalid || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    group.current?.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-5px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 320, easing: 'cubic-bezier(0.36, 0.07, 0.19, 0.97)' })
  }, [invalid])
  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus()
  }, [autoFocus])

  return (
    <div ref={group} role="group" aria-label="6-digit verification code" className="flex gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el
          }}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1} of 6`}
          aria-invalid={invalid || undefined}
          maxLength={6}
          disabled={disabled}
          value={digits[i] ?? ''}
          onFocus={(e) => {
            // The code is one string: never leave a gap before the caret.
            if (i > digits.length) focus(digits.length)
            else e.target.select()
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
            if (!t) return
            e.preventDefault()
            onChange(t)
            focus(t.length)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault()
              if (digits[i]) onChange(digits.slice(0, i) + digits.slice(i + 1))
              else if (i > 0) onChange(digits.slice(0, i - 1) + digits.slice(i))
              focus(digits[i] ? i : i - 1)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              focus(i - 1)
            } else if (e.key === 'ArrowRight') {
              e.preventDefault()
              focus(Math.min(i + 1, digits.length))
            }
          }}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '')
            if (!typed) return
            // More than one digit arrives when a password manager or the keyboard suggestion fills the code.
            const next = typed.length > 1 ? typed.slice(0, 6) : (digits.slice(0, i) + typed + digits.slice(i + 1)).slice(0, 6)
            onChange(next)
            focus(typed.length > 1 ? next.length : i + 1)
          }}
          className={cx(
            'h-14 min-w-0 flex-1 rounded-lg border bg-deep text-center font-mono text-2xl font-medium text-ink transition-colors disabled:opacity-50',
            i === 2 && 'mr-2',
            invalid ? 'border-crit' : digits[i] ? 'border-soft' : 'border-edge hover:border-soft',
          )}
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

/** Demo mode has no mail server: show the code on screen and offer to fill it in. */
export function DemoCodeNote({ code, onUse }: { code?: string; onUse?: (code: string) => void }) {
  if (!code) return null
  return (
    <Notice
      tone="info"
      title="Demo mode — no email is sent"
      action={
        onUse && (
          <Button size="sm" onClick={() => onUse(code)}>
            Fill in
          </Button>
        )
      }
    >
      Your code is <strong className="font-mono text-[15px] font-medium tracking-[0.18em] text-ink">{code}</strong>
    </Notice>
  )
}
