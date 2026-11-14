import { ArrowRight, RadioTower, Stethoscope, type LucideIcon } from 'lucide-react'
import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '../components/AuthLayout'
import DemoEntry from '../components/demo/DemoEntry'
import { Avatar, Button, Disclosure, Field, Input, List, Notice, PasswordInput, Row, SourceLink, Stagger, StaggerItem, CONTEXT_ICON, useMedia } from '../components/ui'
import { contextFacts, type Context } from '../data/contexts'
import { ENV_VALUES } from '../data/kb'
import { CREW, MISSION, STAFF } from '../lib/demoData'
import { useSession } from '../lib/session'
import type { Role } from '../lib/types'

// What each simulated crew member's data shows (see src/lib/demoData.ts).
const STORY: Record<number, string> = {
  1: 'blood pressure rising',
  2: 'short sleep, low mood',
  3: 'all readings normal',
  4: 'low water and exercise',
}
const STAFF_NOTE: Record<string, { icon: LucideIcon; note: string }> = {
  surgeon: { icon: Stethoscope, note: 'reviews the whole crew' },
  ground: { icon: RadioTower, note: 'sees crew status, never mood' },
}

type Premise = { context: Context; label: string; value: string; unit: string; text: string; org: string; url: string }

/** Why the product exists, one sourced number per context. Figures come from the knowledge base (src/data/kb, src/data/contexts-kb.json). */
function premises(): Premise[] {
  const mars = ENV_VALUES.find((e) => e.id === 'comms-delay-earth-mars')
  const polar = contextFacts('polar').facts.find((f) => f.quote.includes('nine months'))
  const home = contextFacts('home').facts.find((f) => f.quote.includes('44%'))
  const out: Premise[] = []
  if (mars?.valueMax != null)
    out.push({
      context: 'space',
      label: 'Space crew',
      value: String(mars.valueMax),
      unit: mars.unit,
      text: `for a message from Mars to reach Earth when the planets are farthest apart${mars.value != null ? ` (${mars.value} ${mars.unit} at the closest)` : ''}.`,
      org: mars.source.organization,
      url: mars.source.url,
    })
  if (polar) out.push({ context: 'polar', label: 'Polar station', value: '≈ 9', unit: 'months', text: 'of every year, crews at Concordia station in Antarctica are completely isolated from the outside world.', org: polar.source.org, url: polar.source.url })
  if (home) out.push({ context: 'home', label: 'Home care', value: '44', unit: '%', text: 'of adults with high blood pressure do not know they have it.', org: home.source.org, url: home.source.url })
  return out
}

const UiKit = lazy(() => import('../components/UiKit'))

// Development only: /login?kit shows every shared primitive in every state (see docs/DESIGN.md).
const SHOW_KIT = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('kit')

export default function Login() {
  return SHOW_KIT ? (
    <Suspense fallback={null}>
      <UiKit />
    </Suspense>
  ) : (
    <SignIn />
  )
}

function SignIn() {
  const wide = useMedia('(min-width: 1024px)')
  const { login, demoLogin, backend } = useSession()
  const signupOpen = backend?.signupOpen !== false
  const demoOpen = backend?.demoOpen !== false
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const go = async (key: string, fn: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await fn()
      nav('/', { replace: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed')
    } finally {
      setBusy(null)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void go('form', () => login(username, password))
  }
  const demo = (role: Role, crewId?: number) => void go(`${role}${crewId ?? ''}`, () => demoLogin(role, crewId))

  return (
    <AuthLayout
      hero
      title={
        <>
          Your health, <span className="text-dim">wherever help is far away.</span>
        </>
      }
      lead="Measure, understand, and know when to call for help. Built for astronauts on a long mission, and just as useful at a polar station or at home."
      aside={
        <Premises wide={wide}>
        <Stagger as="ul" delay={0.15} step={0.07} className="max-w-xl border-b border-line">
          {premises().map((p) => {
            const Icon = CONTEXT_ICON[p.context]
            return (
            <StaggerItem as="li" key={p.context} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] gap-x-5 border-t border-line py-5 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
              <div data-accent={p.context}>
                <div className="flex items-center gap-1.5 text-[13px] text-dim">
                  <Icon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                  {p.label}
                </div>
                <div className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
                  <span className="text-metric-lg text-ink">{p.value}</span>
                  <span className="text-sm text-dim">{p.unit}</span>
                </div>
              </div>
              <div className="pt-[26px] text-[15px] leading-relaxed text-soft">
                {p.text} <SourceLink href={p.url} org={p.org} className="whitespace-nowrap" />
              </div>
            </StaggerItem>
            )
          })}
        </Stagger>
        </Premises>
      }
    >
      <DemoEntry placement="login" />
      <form onSubmit={submit} className="space-y-4" aria-labelledby="signin-h">
        <h2 id="signin-h" className="border-b border-line pb-3 text-heading text-ink">
          Sign in
        </h2>
        <Field label="Email or username">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="next" />
        </Field>
        <Field label="Password">
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
        {error && (
          <Notice tone="crit" role="alert">
            {error}
          </Notice>
        )}
        <Button type="submit" variant="primary" size="lg" full loading={busy === 'form'} disabled={Boolean(busy) || !username || !password}>
          Sign in
        </Button>
        <div className="flex items-center justify-between text-sm">
          {signupOpen ? (
            <Link to="/register" className="link -my-3 py-3">
              Create an account
            </Link>
          ) : (
            <span className="text-dim">Sign-up is closed on this server</span>
          )}
          <Link to="/forgot" className="link -my-3 py-3">
            Forgot password?
          </Link>
        </div>
      </form>

      {!demoOpen ? (
        <Notice className="mt-9" title="The demo is switched off on this server">
          Sign in with your own account above.
        </Notice>
      ) : (
      <section className="mt-9" aria-labelledby="demo-h">
        <div className="border-b border-line pb-3">
          <h2 id="demo-h" className="text-heading text-ink">
            Try the demo
          </h2>
          <p className="mt-0.5 text-sm text-dim">
            A simulated crew on {MISSION.name}, day {MISSION.day}. No account needed.
          </p>
        </div>
        <List className="border-t-0">
          {CREW.map((c) => (
            <Row
              key={c.id}
              onClick={() => demo('astronaut', c.id)}
              disabled={Boolean(busy)}
              leading={<Avatar name={c.name} text={c.callsign} />}
              title={c.name}
              description={`${c.position} · ${STORY[c.id] ?? 'simulated data'}`}
              trailing={<ArrowRight className="h-4 w-4 text-dim" aria-hidden="true" />}
            />
          ))}
          {STAFF.map((s) => {
            const n = STAFF_NOTE[s.role]
            return (
              <Row
                key={s.id}
                onClick={() => demo(s.role)}
                disabled={Boolean(busy)}
                leading={
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-soft">
                    <n.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                }
                title={s.title.split(' · ')[0]}
                description={`${s.name} · ${n.note}`}
                trailing={<ArrowRight className="h-4 w-4 text-dim" aria-hidden="true" />}
              />
            )
          })}
        </List>
      </section>
      )}
    </AuthLayout>
  )
}

/** The three sourced facts beside the sign-in form. On phones and tablets they fold under one line, after the form and the demo list. */
function Premises({ wide, children }: { wide: boolean; children: ReactNode }) {
  if (wide) return <>{children}</>
  return (
    <Disclosure size="row" id="login.premises" title={<span className="text-[15px] font-semibold text-ink">Why it matters</span>} meta="3 sourced facts" className="max-w-xl border-t border-line">
      {children}
    </Disclosure>
  )
}
