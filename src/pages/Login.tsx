import { motion } from 'motion/react'
import { lazy, Suspense, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Logo } from '../components/ui'
import { CREW } from '../lib/demoData'
import { useSession } from '../lib/session'
import type { Role } from '../lib/types'

const SpaceScene = lazy(() => import('../components/three/SpaceScene'))

const item = {
  hidden: { opacity: 0, x: -24 },
  show: (i: number) => ({ opacity: 1, x: 0, transition: { delay: 0.15 + i * 0.08, duration: 0.5, ease: [0.22, 1, 0.36, 1] as const } }),
}

export default function Login() {
  const { login, demoLogin, backend } = useSession()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      nav('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void go(() => login(username, password))
  }
  const demo = (role: Role, crewId?: number) => void go(() => demoLogin(role, crewId))

  return (
    <div className="relative min-h-screen overflow-hidden">
      <div className="absolute inset-0">
        <Suspense fallback={null}>
          <SpaceScene />
        </Suspense>
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-space via-space/85 to-transparent" />

      <main className="relative z-10 flex min-h-screen items-center px-5 py-10 sm:px-12">
        <motion.div initial="hidden" animate="show" className="w-full max-w-md">
          <motion.div custom={0} variants={item} className="flex items-center gap-3">
            <Logo size={44} />
            <div>
              <div className="font-display text-2xl font-bold tracking-[0.12em]">AURA</div>
              <div className="text-[11px] tracking-[0.2em] text-dim">FULL BODY DIAGNOSTICS</div>
            </div>
          </motion.div>

          <motion.h1 custom={1} variants={item} className="mt-10 font-display text-4xl font-bold leading-tight sm:text-5xl">
            Your health,
            <br />
            <span className="bg-gradient-to-r from-cyan to-ice bg-clip-text text-transparent">wherever help is far away.</span>
          </motion.h1>
          <motion.p custom={2} variants={item} className="mt-4 max-w-sm text-soft">
            Measure, understand, and know when to call for help — built for astronauts 14 minutes from Earth, and just as useful at a polar station or at home.
          </motion.p>

          <motion.form custom={3} variants={item} onSubmit={submit} className="glass mt-8 space-y-3 rounded-3xl p-5">
            <label className="block">
              <span className="label">Email or username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="mt-1.5 w-full rounded-xl border border-line bg-space/70 px-4 py-3 text-ink outline-none transition focus:border-cyan"
              />
            </label>
            <label className="block">
              <span className="label">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="mt-1.5 w-full rounded-xl border border-line bg-space/70 px-4 py-3 text-ink outline-none transition focus:border-cyan"
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-crit">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="w-full rounded-xl bg-cyan py-3 font-semibold text-space transition hover:bg-ice disabled:opacity-40"
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="flex justify-between text-sm">
              <Link to="/register" className="font-semibold text-cyan">
                Create an account
              </Link>
              <Link to="/forgot" className="text-dim hover:text-ink">
                Forgot password?
              </Link>
            </div>
          </motion.form>

          <motion.div custom={4} variants={item} className="mt-6">
            <p className="label">Demo access for judges</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CREW.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => demo('astronaut', c.id)}
                  className="group flex items-center gap-2 rounded-full border border-line bg-space/60 py-1.5 pl-1.5 pr-3 text-sm transition hover:border-cyan"
                  title={`${c.name} — ${c.position}`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-space" style={{ background: c.color }}>
                    {c.callsign}
                  </span>
                  {c.name.split(' ')[0]}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => demo('surgeon')} className="rounded-full border border-line bg-space/60 px-4 py-2 text-sm transition hover:border-cyan">
                🩺 Flight Surgeon
              </button>
              <button type="button" disabled={busy} onClick={() => demo('ground')} className="rounded-full border border-line bg-space/60 px-4 py-2 text-sm transition hover:border-cyan">
                🛰 Mission Control
              </button>
            </div>
            <p className="mt-4 text-xs text-dim">
              {backend?.mode === 'server' ? '● Connected to the mission database' : '○ Demo mode — data stays in this browser'} · all crew data is simulated
            </p>
          </motion.div>
        </motion.div>
      </main>
    </div>
  )
}
