import { ArrowLeft, Check } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout, CodeInput, DemoCodeNote, useCooldown } from '../components/AuthLayout'
import { Button, CONTEXT_ICON, Checkbox, Field, Input, Notice, PageTransition, PasswordInput, cx } from '../components/ui'
import { CONTEXTS, CONTEXT_LIST, THRESHOLD_SOURCES, vitalsFor, type Context } from '../data/contexts'
import { useSession } from '../lib/session'
import type { CodeTicket } from '../lib/types'

// Which guidance the context-specific targets follow (see OVERRIDES in src/data/contexts.ts and src/data/vitals.ts).
const RANGES: Record<Context, string> = {
  space: 'Sleep, exercise and water targets follow NASA crew-health standards.',
  polar: `Activity and water targets follow ${THRESHOLD_SOURCES.activity.source.org} and EFSA guidance.`,
  home: `Activity and water targets follow ${THRESHOLD_SOURCES.activity.source.org} and EFSA guidance; sleep follows ${THRESHOLD_SOURCES.sleepOlder.source.org}.`,
}

export default function Register() {
  const { backend, signedIn } = useSession()
  const nav = useNavigate()
  const [context, setContext] = useState<Context | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [consent, setConsent] = useState(false)
  const [ticket, setTicket] = useState<CodeTicket | null>(null)
  const [code, setCode] = useState('')
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

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!backend || !context) return
    void run(async () => {
      const t = await backend.register({ name, email, password, context, consent })
      setTicket(t)
      setCode('')
      cooldown.restart()
    })
  }

  const verify = (e: FormEvent) => {
    e.preventDefault()
    if (!backend || !ticket) return
    void run(async () => {
      const u = await backend.verify(ticket.email, code)
      await signedIn(u)
      nav('/', { replace: true })
    })
  }

  const resend = () =>
    backend &&
    ticket &&
    void run(async () => {
      setTicket({ ...(await backend.resend(ticket.email, 'register')), email: ticket.email })
      cooldown.restart()
    })

  const missing = !context ? 'Choose who will use AURA to continue.' : !consent ? 'Tick the box above to continue.' : null
  const minutes = ticket ? Math.round(ticket.expiresIn / 60) : 15

  return (
    <AuthLayout
      context={context}
      eyebrow={ticket ? 'Step 2 of 2' : 'Step 1 of 2'}
      title={ticket ? 'Check your email' : 'Create your account'}
      lead={
        ticket ? (
          <>
            We sent a 6-digit code to <strong className="font-medium text-ink">{ticket.email}</strong>. It expires in {minutes} minutes.
          </>
        ) : (
          'AURA adapts what it tracks, and the reference ranges it uses, to where you are.'
        )
      }
      aside={
        !ticket && (
          <PageTransition routeKey={context ?? 'none'}>
            {context ? (
              <dl className="max-w-lg divide-y divide-line border-y border-line text-[15px]">
                <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-5">
                  <dt className="text-sm text-dim">You will track</dt>
                  <dd className="leading-relaxed text-soft">
                    {vitalsFor(context)
                      .map((v) => v.label.toLowerCase())
                      .join(', ')}
                    .
                  </dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-5">
                  <dt className="text-sm text-dim">Reports go to</dt>
                  <dd className="text-soft">Your {CONTEXTS[context].contact} — only when you choose to send one.</dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[9rem_1fr] sm:gap-5">
                  <dt className="text-sm text-dim">Reference ranges</dt>
                  <dd className="leading-relaxed text-soft">{RANGES[context]}</dd>
                </div>
              </dl>
            ) : (
              <p className="max-w-lg border-y border-line py-4 text-[15px] text-dim">Choose a profile to see what AURA will track for you.</p>
            )}
          </PageTransition>
        )
      }
    >
      <PageTransition routeKey={ticket ? 'code' : 'form'} direction={ticket ? 1 : -1}>
        {!ticket ? (
          <form onSubmit={submit} className="space-y-4">
            <fieldset>
              <legend className="mb-2 w-full border-b border-line pb-3 text-heading text-ink">Who will use AURA?</legend>
              <div role="radiogroup" aria-label="Profile" className="grid gap-2">
                {CONTEXT_LIST.map((c) => {
                  const Icon = CONTEXT_ICON[c.id]
                  const on = context === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-accent={c.id}
                      onClick={() => setContext(c.id)}
                      className={cx('flex min-h-[4.5rem] items-center gap-3.5 rounded-xl border px-4 py-3 text-left transition-colors', on ? 'border-ink bg-panel2' : 'border-line bg-panel hover:border-edge')}
                    >
                      <Icon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] font-medium text-ink">{c.label}</span>
                        <span className="mt-0.5 block text-sm leading-snug text-dim">{c.blurb}</span>
                      </span>
                      <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors', on ? 'border-ink bg-ink text-space' : 'border-edge text-transparent')}>
                        <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                      </span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            <Field label="Full name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} />
            </Field>
            <Checkbox
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              label="I understand AURA is a hackathon prototype for self-monitoring. It does not diagnose and does not replace a doctor or emergency services. My data is stored to show my own history, and I can delete my account at any time."
            />
            {error && (
              <Notice tone="crit" role="alert">
                {error}
              </Notice>
            )}
            <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={!context || !consent}>
              Send verification code
            </Button>
            <p className="text-sm text-dim empty:hidden" aria-live="polite">
              {missing}
            </p>
            <p className="text-sm text-dim">
              Already have an account?{' '}
              <Link to="/login" className="link">
                Sign in
              </Link>
            </p>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <h2 className="border-b border-line pb-3 text-heading text-ink">Enter the code</h2>
            <DemoCodeNote code={ticket.demoCode} onUse={setCode} />
            <CodeInput value={code} onChange={setCode} disabled={busy} invalid={Boolean(error)} autoFocus />
            {error && (
              <Notice tone="crit" role="alert">
                {error}
              </Notice>
            )}
            <Button type="submit" variant="primary" size="lg" full loading={busy} disabled={code.length !== 6}>
              Verify and create account
            </Button>
            <div className="flex items-center justify-between gap-3">
              <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => setTicket(null)} className="-ml-3">
                Change details
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
