import { AnimatePresence, motion } from 'motion/react'
import { useRef } from 'react'
import { NavLink, useLocation, useNavigate, useOutlet, useParams } from 'react-router'
import { CAREER_LIMIT_MSV, MISSIONS, formatDelay } from '../data/missions'
import { STATUS_COLOR } from '../data/vitals'
import { radiation } from '../lib/health'
import { useSession } from '../lib/session'
import { Logo } from './ui'

type Tab = { to: string; label: string; end?: boolean }

function tabsFor(role: string, crewId: string | undefined, ownId: number | null): Tab[] {
  if (role === 'astronaut' && ownId != null) {
    const b = `/crew/${ownId}`
    return [
      { to: b, label: 'Overview', end: true },
      { to: `${b}/diagnostics`, label: 'Diagnostics' },
      { to: `${b}/aura`, label: 'AURA' },
      { to: `${b}/coach`, label: 'Coach' },
      { to: `${b}/history`, label: 'History' },
      { to: '/environment', label: 'Environment' },
    ]
  }
  const top: Tab[] = [{ to: '/crew', label: 'Crew', end: true }]
  if (role === 'surgeon') top.push({ to: '/reports', label: 'Reports' })
  top.push({ to: '/environment', label: 'Environment' })
  if (!crewId) return top
  const b = `/crew/${crewId}`
  const member: Tab[] =
    role === 'surgeon'
      ? [
          { to: b, label: 'Overview', end: true },
          { to: `${b}/diagnostics`, label: 'Diagnostics' },
          { to: `${b}/aura`, label: 'AURA' },
          { to: `${b}/history`, label: 'History' },
        ]
      : [
          { to: b, label: 'Overview', end: true },
          { to: `${b}/history`, label: 'History' },
        ]
  return [...top, ...member]
}

export default function AppShell() {
  const { user, mission, crew, logout } = useSession()
  const { crewId } = useParams()
  const loc = useLocation()
  const nav = useNavigate()
  const outlet = useOutlet()
  const tabs = tabsFor(user?.role ?? 'astronaut', crewId, user?.crewId ?? null)
  const idx = Math.max(0, tabs.findIndex((t) => (t.end ? loc.pathname === t.to : loc.pathname.startsWith(t.to))))
  const prev = useRef(idx)
  const dir = idx >= prev.current ? 1 : -1
  prev.current = idx

  const prof = MISSIONS.find((m) => m.id === mission?.profileId) ?? MISSIONS[3]
  const day = mission?.day ?? 142
  const total = mission?.totalDays ?? 210
  const rad = radiation(prof.id, day)
  const viewing = crewId ? crew.find((c) => String(c.id) === crewId) : null

  return (
    <div className="min-h-screen">
      <div className="aurora" />
      <header className="sticky top-0 z-30 border-b border-line/70 bg-space/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
          <div className="mr-auto flex items-center gap-3">
            <Logo />
            <div>
              <div className="font-display text-lg font-bold tracking-[0.12em]">AURA</div>
              <div className="text-[10px] tracking-[0.2em] text-dim">FULL BODY DIAGNOSTICS</div>
            </div>
          </div>
          <Stat label="Mission" value={mission?.name ?? '—'} sub={mission?.environment} />
          <div className="min-w-32">
            <div className="label">Mission day</div>
            <div className="font-semibold">
              {day} <span className="font-normal text-dim">/ {total}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-line">
              <motion.div
                className="h-1 rounded-full bg-cyan"
                initial={{ width: 0 }}
                animate={{ width: `${(day / total) * 100}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }}
              />
            </div>
          </div>
          <Stat label="Earth delay" value={formatDelay(prof.delaySec)} sub="one-way" />
          <div className="min-w-36">
            <div className="label">Radiation</div>
            <div className="font-semibold">
              {rad.dose.toFixed(0)} mSv <span className="text-xs font-normal text-dim">{rad.pct.toFixed(0)}% of {CAREER_LIMIT_MSV}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-line">
              <motion.div
                className="h-1 rounded-full"
                style={{ background: STATUS_COLOR[rad.status] }}
                initial={{ width: 0 }}
                animate={{ width: `${rad.pct}%` }}
                transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }}
              />
            </div>
          </div>
          <div className="flex items-center gap-3 border-l border-line pl-5">
            <div className="text-right">
              <div className="text-sm font-semibold">{user?.name}</div>
              <div className="text-[11px] text-dim">{user?.title}</div>
            </div>
            <button
              type="button"
              onClick={async () => {
                await logout()
                nav('/login', { replace: true })
              }}
              className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-soft transition hover:border-cyan hover:text-ink"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav aria-label="Sections" className="mx-auto flex max-w-[1500px] items-center gap-1 overflow-x-auto px-3 sm:px-5">
          {tabs.map((t, i) => {
            const isMember = user?.role !== 'astronaut' && crewId && t.to.startsWith(`/crew/${crewId}`)
            const firstMember = isMember && !tabs[i - 1]?.to.startsWith(`/crew/${crewId}`)
            return (
              <div key={t.to} className="flex items-center">
                {firstMember && (
                  <span className="mx-2 flex items-center gap-2 whitespace-nowrap rounded-full bg-panel2 px-3 py-1 text-xs text-soft">
                    <span className="h-2 w-2 rounded-full" style={{ background: viewing?.color ?? '#53D7FF' }} />
                    {viewing?.name ?? 'Crew member'}
                  </span>
                )}
                <NavLink
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    `relative whitespace-nowrap px-3.5 py-3 text-sm font-medium transition ${isActive ? 'text-ink' : 'text-dim hover:text-ink'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {t.label}
                      {isActive && <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-cyan" />}
                    </>
                  )}
                </NavLink>
              </div>
            )
          })}
        </nav>
      </header>

      <AnimatePresence mode="wait" custom={dir}>
        <motion.main
          key={loc.pathname}
          custom={dir}
          initial={{ opacity: 0, x: dir * 48 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: dir * -48 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-[1500px] px-4 pb-16 pt-6 sm:px-6"
        >
          {outlet}
        </motion.main>
      </AnimatePresence>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className="font-semibold">
        {value} {sub && <span className="text-xs font-normal text-dim">{sub}</span>}
      </div>
    </div>
  )
}
