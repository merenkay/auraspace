import { AnimatePresence, motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout, CodeInput, DemoCodeNote, inputCls, primaryBtn, useCooldown } from '../components/AuthLayout'
import { CONTEXT_LIST, type Context } from '../data/contexts'
import { useSession } from '../lib/session'
import type { CodeTicket } from '../lib/types'

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

  return (
    <AuthLayout>
      <AnimatePresence mode="wait">
        {!ticket ? (
          <motion.div key="form" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
            <h1 className="mt-8 font-display text-3xl font-bold">Create your account</h1>
            <p className="mt-2 text-soft">Who will use AURA?</p>
            <div className="mt-4 grid gap-2">
              {CONTEXT_LIST.map((c, i) => (
                <motion.button
                  key={c.id}
                  type="button"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * i }}
                  onClick={() => setContext(c.id)}
                  aria-pressed={context === c.id}
                  className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${context === c.id ? 'border-cyan bg-cyan/10' : 'glass hover:border-cyan/50'}`}
                >
                  <span className="text-3xl" aria-hidden="true">
                    {c.icon}
                  </span>
                  <span>
                    <span className="block font-semibold">{c.label}</span>
                    <span className="block text-sm text-dim">{c.blurb}</span>
                  </span>
                </motion.button>
              ))}
            </div>

            <form onSubmit={submit} className="glass mt-5 space-y-3 rounded-3xl p-5">
              <label className="block">
                <span className="label">Full name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} className={inputCls} />
              </label>
              <label className="block">
                <span className="label">Email</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required className={inputCls} />
              </label>
              <label className="block">
                <span className="label">Password (8+ characters)</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required minLength={8} className={inputCls} />
              </label>
              <label className="flex items-start gap-3 text-sm text-soft">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-cyan" />
                <span>I understand AURA is a hackathon prototype for self-monitoring. It does not diagnose and does not replace a doctor or emergency services. My data is stored to show my own history, and I can delete my account at any time.</span>
              </label>
              {error && (
                <p role="alert" className="text-sm text-crit">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy || !context || !consent} className={primaryBtn}>
                {busy ? 'Sending code…' : 'Send verification code'}
              </button>
            </form>
            <p className="mt-4 text-sm text-dim">
              Already have an account?{' '}
              <Link to="/login" className="text-cyan underline">
                Sign in
              </Link>
            </p>
          </motion.div>
        ) : (
          <motion.div key="code" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -30 }}>
            <h1 className="mt-8 font-display text-3xl font-bold">Check your email</h1>
            <p className="mt-2 text-soft">
              We sent a 6-digit code to <strong className="text-ink">{ticket.email}</strong>. It expires in 15 minutes.
            </p>
            <form onSubmit={verify} className="glass mt-6 space-y-4 rounded-3xl p-5">
              <DemoCodeNote code={ticket.demoCode} />
              <CodeInput value={code} onChange={setCode} disabled={busy} />
              {error && (
                <p role="alert" className="text-sm text-crit">
                  {error}
                </p>
              )}
              <button type="submit" disabled={busy || code.length !== 6} className={primaryBtn}>
                {busy ? 'Checking…' : 'Verify and create account'}
              </button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={() => setTicket(null)} className="text-dim hover:text-ink">
                  ← Change details
                </button>
                <button type="button" disabled={cooldown.left > 0 || busy} onClick={resend} className="text-cyan disabled:text-dim">
                  {cooldown.left > 0 ? `Resend in ${cooldown.left}s` : 'Resend code'}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </AuthLayout>
  )
}
