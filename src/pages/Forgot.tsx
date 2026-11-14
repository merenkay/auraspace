import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout, CodeInput, DemoCodeNote, inputCls, primaryBtn, useCooldown } from '../components/AuthLayout'
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

  return (
    <AuthLayout>
      <h1 className="mt-8 font-display text-3xl font-bold">Reset your password</h1>
      {!ticket ? (
        <form onSubmit={request} className="glass mt-6 space-y-3 rounded-3xl p-5">
          <label className="block">
            <span className="label">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className={inputCls} />
          </label>
          {error && <p role="alert" className="text-sm text-crit">{error}</p>}
          <button type="submit" disabled={busy || !email} className={primaryBtn}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
        </form>
      ) : (
        <form onSubmit={reset} className="glass mt-6 space-y-4 rounded-3xl p-5">
          <p className="text-sm text-soft">
            If an account exists for <strong className="text-ink">{ticket.email}</strong>, a 6-digit code is on its way.
          </p>
          <DemoCodeNote code={ticket.demoCode} />
          <CodeInput value={code} onChange={setCode} disabled={busy} />
          <label className="block">
            <span className="label">New password (8+ characters)</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required className={inputCls} />
          </label>
          {error && <p role="alert" className="text-sm text-crit">{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6 || password.length < 8} className={primaryBtn}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
          <button
            type="button"
            disabled={cooldown.left > 0 || busy}
            onClick={() =>
              backend &&
              void run(async () => {
                setTicket({ ...(await backend.resend(ticket.email, 'reset')), email: ticket.email })
                cooldown.restart()
              })
            }
            className="w-full text-sm text-cyan disabled:text-dim"
          >
            {cooldown.left > 0 ? `Resend in ${cooldown.left}s` : 'Resend code'}
          </button>
        </form>
      )}
      <p className="mt-4 text-sm text-dim">
        <Link to="/login" className="text-cyan underline">
          Back to sign in
        </Link>
      </p>
    </AuthLayout>
  )
}
