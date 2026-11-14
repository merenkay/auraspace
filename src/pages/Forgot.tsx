import { ArrowLeft, Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { AuthLayout, CodeInput, DemoCodeNote, useCooldown } from '../components/AuthLayout'
import { Button, Field, Input, Notice, PageTransition, PasswordInput, cx } from '../components/ui'
import { useSession } from '../lib/session'
import type { CodeTicket } from '../lib/types'

export default function Forgot() {
  const { backend, signedIn } = useSession()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [ticket, setTicket] = useState<CodeTicket | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cooldown = useCooldown(60)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const request = (e: FormEvent) => {
    e.preventDefault()
    if (!backend) return
    void run(async () => {
      setTicket(await backend.forgot(email))
      setCode('')
      cooldown.restart()
    })
  }
  const reset = (e: FormEvent) => {
    e.preventDefault()
    if (!backend || !ticket) return
    void run(async () => {
      await signedIn(await backend.reset(ticket.email, code, password))
      nav('/', { replace: true })
    })
  }
  const resend = () =>
    backend &&
    ticket &&
    void run(async () => {
      setTicket({ ...(await backend.resend(ticket.email, 'reset')), email: ticket.email })
      cooldown.restart()
    })

  const step = ticket ? 2 : 1
  const steps = [
    'Enter the email address you registered with.',
    `Type the 6-digit code we send there${ticket ? ` (it expires in ${Math.round(ticket.expiresIn / 60)} minutes)` : ''} and choose a new password. You are signed in straight away.`,
  ]

  return (
    <AuthLayout
      eyebrow={`Step ${step} of 2`}
      title="Reset your password"
      lead={
        ticket ? (
          <>
            If an account exists for <strong className="font-medium text-ink">{ticket.email}</strong>, a 6-digit code is on its way.
          </>
        ) : (
          'We email you a code to prove the account is yours. Your measurements are not affected.'
        )
      }
      aside={
        <ol className="max-w-lg divide-y divide-line border-y border-line">
          {steps.map((s, i) => {
            const state = !ticket ? (i === 0 ? 'now' : 'next') : i === 0 ? 'done' : 'now'
            return (
              <li key={i} aria-current={state === 'now' ? 'step' : undefined} className="flex items-baseline gap-4 py-3.5 text-[15px]">
                <span className={cx('flex w-4 shrink-0 justify-center font-mono text-sm', state === 'now' ? 'text-ink' : 'text-dim')}>{state === 'done' ? <Check className="h-4 w-4 translate-y-0.5" aria-label="Done" /> : i + 1}</span>
                <span className={state === 'now' ? 'text-ink' : 'text-dim'}>{s}</span>
              </li>
            )
          })}
        </ol>
      }
    >
      <PageTransition routeKey={ticket ? 'code' : 'email'} direction={ticket ? 1 : -1}>
        {!ticket ? (
          <form onSubmit={request} className="space-y-4">
            <h2 className="border-b border-line pb-3 text-heading text-ink">Your email</h2>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </Field>
            {error && (
              <Notice tone="crit" role="alert">
                {error}
              </Notice>
            )}
            <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!email}>
              Email me a code
            </Button>
            <Button variant="quiet" size="sm" icon={ArrowLeft} to="/login" className="-ml-3">
              Back to sign in
            </Button>
          </form>
        ) : (
          <form onSubmit={reset} className="space-y-4">
            <h2 className="border-b border-line pb-3 text-heading text-ink">Code and new password</h2>
            <DemoCodeNote code={ticket.demoCode} onUse={setCode} />
            <CodeInput value={code} onChange={setCode} disabled={busy} invalid={Boolean(error)} autoFocus />
            <Field label="New password" hint="At least 8 characters.">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required />
            </Field>
            {error && (
              <Notice tone="crit" role="alert">
                {error}
              </Notice>
            )}
            <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={code.length !== 6 || password.length < 8}>
              Set new password
            </Button>
            <div className="flex items-center justify-between gap-3">
              <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => setTicket(null)} className="-ml-3">
                Use another email
              </Button>
              <Button variant="quiet" size="sm" disabled={cooldown.left > 0 || busy} onClick={() => resend()} className="-mr-3">
                {cooldown.left > 0 ? `Resend in ${cooldown.left}s` : 'Resend code'}
              </Button>
            </div>
          </form>
        )}
      </PageTransition>
    </AuthLayout>
  )
}
