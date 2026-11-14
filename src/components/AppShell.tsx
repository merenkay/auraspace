import { ChartLine, ChevronDown, ChevronLeft, CloudSun, Dumbbell, Ellipsis, FileText, HeartPulse, Inbox, LogOut, MessagesSquare, Orbit, PersonStanding, UserRound, Users, type LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useOutlet, useParams } from 'react-router'
import OfflineBadge from './OfflineBadge'
import DemoEntry from './demo/DemoEntry'
import LiveSensorBadge from './env/LiveSensorBadge'
import HandControl from './gesture/HandControl'
import AuraVoice from './voice/AuraVoice'
import { CONTEXTS, type Context } from '../data/contexts'
import { CAREER_LIMIT_MSV, MISSIONS, formatDelay } from '../data/missions'
import { radiation } from '../lib/health'
import { prefetchRoute, prefetchWhenIdle } from '../lib/prefetch'
import { useUnreadReplies } from '../lib/reports/store'
import { useSession } from '../lib/session'
import type { User } from '../lib/types'
import { Avatar, Button, CONTEXT_ICON, List, Logo, Meter, MotionRoot, PageTransition, Row, SPRING, Sheet, StatusIcon, cx, useContextAccent } from './ui'

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean; /** unread count shown next to the label (My reports) */ badge?: number }

/** Count bubble for a nav item; the number is also read out ("2 new replies"). */
function NavCount({ n, className }: { n?: number; className?: string }) {
  if (!n) return null
  return (
    <span className={cx('inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 font-mono text-[11px] font-semibold leading-none text-space', className)}>
      <span aria-hidden="true">{n}</span>
      <span className="sr-only">{`, ${n} new ${n === 1 ? 'reply' : 'replies'}`}</span>
    </span>
  )
}

/** `primary` is the product navigation. `subject` appears for staff while they look at one crew member. */
function navFor(user: User | null, crewId: string | undefined): { primary: NavItem[]; subject: NavItem[] } {
  if (!user) return { primary: [], subject: [] }
  if ((user.role === 'astronaut' || user.role === 'member') && user.crewId != null) {
    const b = `/crew/${user.crewId}`
    return {
      primary: [
        { to: b, label: 'Overview', icon: HeartPulse, end: true },
        { to: `${b}/diagnostics`, label: 'Diagnostics', icon: PersonStanding },
        { to: `${b}/aura`, label: 'AURA', icon: MessagesSquare },
        { to: `${b}/coach`, label: CONTEXTS[user.context].activityTab, icon: Dumbbell },
        { to: `${b}/history`, label: 'History', icon: ChartLine },
        user.context === 'space' ? { to: '/environment', label: 'Environment', icon: Orbit } : { to: '/environment', label: 'Conditions', icon: CloudSun },
        // Last, so the hand-control tab order and the phone bar (first four) stay as they were; on phones it sits under "More".
        { to: '/my-reports', label: 'My reports', icon: Inbox },
      ],
      subject: [],
    }
  }
  const primary: NavItem[] = [{ to: '/crew', label: 'Crew', icon: Users }]
  if (user.role === 'surgeon') primary.push({ to: '/reports', label: 'Reports', icon: FileText })
  primary.push({ to: '/environment', label: 'Environment', icon: Orbit })
  if (!crewId) return { primary, subject: [] }
  const b = `/crew/${crewId}`
  const subject: NavItem[] =
    user.role === 'surgeon'
      ? [
          { to: b, label: 'Overview', icon: HeartPulse, end: true },
          { to: `${b}/diagnostics`, label: 'Diagnostics', icon: PersonStanding },
          { to: `${b}/aura`, label: 'AURA', icon: MessagesSquare },
          { to: `${b}/coach`, label: 'Coach', icon: Dumbbell },
          { to: `${b}/history`, label: 'History', icon: ChartLine },
        ]
      : [
          { to: b, label: 'Overview', icon: HeartPulse, end: true },
          { to: `${b}/history`, label: 'History', icon: ChartLine },
        ]
  return { primary, subject }
}

const isActive = (item: NavItem, path: string) => (item.end ? path === item.to : path === item.to || path.startsWith(`${item.to}/`))

type Fact = { label: string; value: ReactNode; sub?: ReactNode; /** show `sub` only from the lg breakpoint up */ subWide?: boolean; meter?: ReactNode; lead?: ReactNode }

export default function AppShell() {
  const { user, mission, crew, logout } = useSession()
  const { crewId } = useParams()
  const loc = useLocation()
  const go = useNavigate()
  const outlet = useOutlet()
  const [moreOpen, setMoreOpen] = useState(false)

  const ctx: Context = mission?.context ?? user?.context ?? 'space'
  useContextAccent(ctx)

  const unread = useUnreadReplies()
  const nav0 = navFor(user, crewId)
  const subject = nav0.subject
  const primary = unread ? nav0.primary.map((t) => (t.to === '/my-reports' ? { ...t, badge: unread } : t)) : nav0.primary
  const path = loc.pathname

  // Where the current page sits in the navigation: drives the direction of the page transition.
  const subjectIdx = subject.findIndex((t) => isActive(t, path))
  const primaryIdx = primary.findIndex((t) => isActive(t, path))
  const pos = { depth: subjectIdx >= 0 ? 1 : 0, order: subjectIdx >= 0 ? subjectIdx : primaryIdx }
  const [nav, setNav] = useState<{ path: string; depth: number; order: number; dir: -1 | 0 | 1 }>({ path, ...pos, dir: 0 })
  if (nav.path !== path) {
    const dir = nav.depth !== pos.depth || nav.order === pos.order ? 0 : pos.order > nav.order ? 1 : -1
    setNav({ path, ...pos, dir })
  }

  useEffect(() => {
    setMoreOpen(false)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [path])

  // Warm the code of the other main pages once the browser is idle, so tab switches do not wait for the network.
  const navKey = [...primary, ...subject].map((t) => t.to).join('|')
  useEffect(() => (navKey ? prefetchWhenIdle(navKey.split('|')) : undefined), [navKey])

  const prof = MISSIONS.find((m) => m.id === mission?.profileId)
  const day = mission?.day ?? 1
  const total = mission?.totalDays ?? null
  const viewing = crewId && subject.length ? crew.find((c) => String(c.id) === crewId) : null
  const ContextIcon = CONTEXT_ICON[ctx]
  // Whose record the voice assistant talks about: the crew member being viewed, else the signed-in person's own.
  const voiceCrewId = crewId ? Number(crewId) : (user?.crewId ?? null)

  const facts: Fact[] = []
  if (ctx === 'space') {
    const rad = prof ? radiation(prof.id, day) : null
    facts.push({ label: 'Mission', value: mission?.name ?? '—', sub: mission?.environment, subWide: true })
    facts.push({
      label: 'Mission day',
      value: day,
      sub: total ? `of ${total}` : undefined,
      meter: total ? <Meter value={day} max={total} label={`Mission day ${day} of ${total}`} /> : undefined,
    })
    if (prof) facts.push({ label: 'Earth delay', value: formatDelay(prof.delaySec), sub: prof.delaySec >= 0.5 ? 'one-way' : undefined })
    if (rad)
      facts.push({
        label: 'Radiation',
        lead: rad.status !== 'ok' ? <StatusIcon status={rad.status} size={14} /> : undefined,
        value: `${rad.dose.toFixed(0)} mSv`,
        sub: `${rad.pct.toFixed(0)}% of ${CAREER_LIMIT_MSV} career limit`,
        subWide: true,
        meter: <Meter value={rad.pct} status={rad.status} marks={[{ at: 50 }, { at: 80 }]} label={`Radiation dose, ${rad.pct.toFixed(0)}% of the career limit`} />,
      })
  } else {
    facts.push({ label: 'Profile', lead: <ContextIcon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />, value: CONTEXTS[ctx].label })
    facts.push({ label: 'Tracking', value: `Day ${day}` })
    facts.push({ label: 'Care contact', value: CONTEXTS[ctx].contact.replace(/^./, (c) => c.toUpperCase()) })
    facts.push({ label: 'Today', value: new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) })
  }

  const signOut = async () => {
    await logout()
    go('/login', { replace: true })
  }

  // Phone: at most four destinations in the bottom bar, the rest (plus mission facts and the account) live behind "More".
  const barItems = primary.length > 4 ? primary.slice(0, 4) : primary
  const overflow = primary.slice(barItems.length)
  const overflowActive = overflow.some((t) => isActive(t, path))
  const overflowCount = overflow.reduce((n, t) => n + (t.badge ?? 0), 0)

  return (
    <MotionRoot>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-space">
        Skip to content
      </a>

      <div className="flex min-h-dvh flex-col">
        {/* ---- Row 1: brand, navigation, account (sticky) ---- */}
        <header className="sticky top-0 z-30 border-b border-line bg-space pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-2 px-4 sm:px-6">
            <Link to="/" aria-label="AURA home" className="-ml-1 mr-2 flex h-11 shrink-0 items-center rounded-lg px-1 lg:mr-4">
              <Logo wordmark size={26} />
            </Link>

            <nav aria-label="Main" className="no-scrollbar hidden h-full min-w-0 items-stretch overflow-x-auto md:flex">
              {primary.map((t) => {
                const on = isActive(t, path)
                return (
                  <Link key={t.to} to={t.to} onPointerEnter={() => prefetchRoute(t.to)} onFocus={() => prefetchRoute(t.to)} aria-current={on ? 'page' : undefined} className={cx('press relative flex shrink-0 items-center px-2 text-sm font-medium transition-colors lg:px-3', on ? 'text-ink' : 'text-dim hover:text-ink')}>
                    {t.label}
                    <NavCount n={t.badge} className="ml-1.5" />
                    {on && <motion.span layoutId="nav-underline" transition={SPRING.snappy} className="absolute inset-x-3 -bottom-px h-0.5 bg-accent" />}
                  </Link>
                )
              })}
            </nav>

            <div className="ml-auto flex shrink-0 items-center gap-2 lg:gap-3">
              <DemoEntry placement="header" />
              <OfflineBadge />
              <LiveSensorBadge />
              {/* Hands-free controls: each renders its own header button and portals its overlay. */}
              <AuraVoice crewId={voiceCrewId} />
              <HandControl />
              <div className="hidden items-center gap-3 md:flex">
                <div className="hidden text-right leading-tight lg:block">
                  <div className="text-sm font-medium text-ink">{user?.name}</div>
                  <div className="text-xs text-dim">{user?.title}</div>
                </div>
                <Avatar name={user?.name ?? ''} size={32} className="lg:hidden" />
                <Button variant="quiet" size="sm" icon={LogOut} onClick={signOut} aria-label="Sign out">
                  <span className="hidden lg:inline">Sign out</span>
                </Button>
              </div>

              {/* Phone: the one fact that orients you; tap for everything else */}
              <button type="button" onClick={() => setMoreOpen(true)} aria-label="Mission details and account" className="press -mr-2 flex h-11 items-center gap-1.5 rounded-lg px-2 text-sm md:hidden">
                {ctx === 'space' ? (
                  <>
                    <span className="text-dim">Day</span>
                    <span className="font-medium text-ink">{day}</span>
                    {total && <span className="text-dim">/ {total}</span>}
                  </>
                ) : (
                  <>
                    <ContextIcon className="h-4 w-4 text-accent" aria-hidden="true" />
                    <span className="font-medium text-ink">Day {day}</span>
                  </>
                )}
                <ChevronDown className="h-4 w-4 text-dim" aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>

        {/* ---- Row 2: where you are (scrolls away) ---- */}
        <div className="hidden border-b border-line md:block">
          <dl className="no-scrollbar mx-auto flex h-11 max-w-[1500px] items-center overflow-x-auto px-4 sm:px-6">
            {facts.map((f, i) => (
              <div key={f.label} className={cx('flex shrink-0 items-center gap-2 whitespace-nowrap', i > 0 && 'ml-4 border-l border-line pl-4 lg:ml-5 lg:pl-5')}>
                <dt className="text-[13px] text-dim">{f.label}</dt>
                <dd className="flex items-center gap-1.5 text-sm">
                  {f.lead}
                  <span className="font-medium text-ink">{f.value}</span>
                  {f.sub && <span className={cx('text-dim', f.subWide && 'hidden lg:inline')}>{f.sub}</span>}
                </dd>
                {f.meter && <div className="hidden w-16 lg:block">{f.meter}</div>}
              </div>
            ))}
          </dl>
        </div>

        {/* ---- Staff: whose record this is, and its sections (sticky under row 1) ---- */}
        {subject.length > 0 && (
          <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 border-b border-line bg-space">
            <div className="mx-auto flex max-w-[1500px] items-center gap-x-5 px-4 sm:px-6">
              <Link to="/crew" className="-ml-2 flex h-11 shrink-0 items-center gap-2 rounded-lg px-2 text-sm text-soft transition-colors hover:text-ink">
                <ChevronLeft className="h-4 w-4 text-dim" aria-hidden="true" />
                <span className="sr-only">Back to crew. Viewing </span>
                <span className="font-medium text-ink">{viewing?.name ?? 'Crew member'}</span>
                {viewing && <span className="hidden text-dim sm:inline">{viewing.position}</span>}
              </Link>
              <nav aria-label={`Sections for ${viewing?.name ?? 'this crew member'}`} className="no-scrollbar flex items-stretch gap-1 overflow-x-auto border-l border-line pl-3">
                {subject.map((t) => {
                  const on = isActive(t, path)
                  return (
                    <Link key={t.to} to={t.to} onPointerEnter={() => prefetchRoute(t.to)} onFocus={() => prefetchRoute(t.to)} aria-current={on ? 'page' : undefined} className={cx('press relative flex h-11 shrink-0 items-center rounded-md px-2.5 text-sm font-medium transition-colors', on ? 'text-ink' : 'text-dim hover:text-ink')}>
                      {t.label}
                      {on && <motion.span layoutId="subject-underline" transition={SPRING.snappy} className="absolute inset-x-2.5 -bottom-px h-0.5 bg-accent" />}
                    </Link>
                  )
                })}
              </nav>
            </div>
          </div>
        )}

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1500px] flex-1 px-4 pb-10 pt-6 outline-none sm:px-6 md:pt-8">
          <PageTransition routeKey={path} direction={nav.dir}>
            {outlet}
          </PageTransition>
        </main>

        <footer className="mx-auto w-full max-w-[1500px] px-4 pb-28 sm:px-6 md:pb-8">
          <p className="border-t border-line pt-4 text-xs leading-relaxed text-dim">Decision support, not a diagnosis. Crew data in this demo is simulated. Not affiliated with NASA.</p>
          <DemoEntry placement="footer" />
        </footer>

        {/* ---- Phone: bottom navigation ---- */}
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-space pb-[env(safe-area-inset-bottom)] md:hidden">
          <div className="mx-auto flex max-w-lg items-stretch">
            {barItems.map((t) => (
              <BarLink key={t.to} item={t} active={isActive(t, path)} />
            ))}
            <button type="button" onClick={() => setMoreOpen(true)} aria-haspopup="dialog" data-sfx="tick" className={cx('press bar-item relative flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors', overflowActive ? 'text-ink' : 'text-dim')}>
              {overflowActive && <motion.span layoutId="bar-indicator" transition={SPRING.snappy} className="absolute inset-x-5 top-0 h-0.5 bg-accent" />}
              {overflow.length ? <Ellipsis className="h-5 w-5" aria-hidden="true" /> : <UserRound className="h-5 w-5" aria-hidden="true" />}
              <span>{overflow.length ? 'More' : 'Account'}</span>
              <NavCount n={overflowCount} className="absolute left-1/2 top-1.5 ml-2" />
            </button>
          </div>
        </nav>
      </div>

      {/* ---- Phone: everything that does not fit in the bars ---- */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={user?.name ?? 'Account'} description={user?.title}>
        {overflow.length > 0 && (
          <List className="mb-6">
            {overflow.map((t) => (
              <Row key={t.to} to={t.to} title={t.label} leading={<t.icon className="h-5 w-5" aria-hidden="true" />} trailing={<NavCount n={t.badge} />} selected={isActive(t, path)} />
            ))}
          </List>
        )}
        <dl className="mb-6 divide-y divide-line border-y border-line">
          {facts.map((f) => (
            <div key={f.label} className="py-3">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-sm text-dim">{f.label}</dt>
                <dd className="flex items-center gap-1.5 text-right text-[15px]">
                  {f.lead}
                  <span className="font-medium text-ink">{f.value}</span>
                  {f.sub && <span className="text-dim">{f.sub}</span>}
                </dd>
              </div>
              {f.meter && <div className="mt-2">{f.meter}</div>}
            </div>
          ))}
        </dl>
        <Button variant="secondary" full icon={LogOut} onClick={signOut}>
          Sign out
        </Button>
      </Sheet>
    </MotionRoot>
  )
}

function BarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link to={item.to} onPointerDown={() => prefetchRoute(item.to)} data-sfx="tick" aria-current={active ? 'page' : undefined} className={cx('press bar-item relative flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors', active ? 'text-ink' : 'text-dim')}>
      {active && <motion.span layoutId="bar-indicator" transition={SPRING.snappy} className="absolute inset-x-5 top-0 h-0.5 bg-accent" />}
      <item.icon className="h-5 w-5" aria-hidden="true" />
      <span className="max-w-full truncate px-1">{item.label}</span>
      <NavCount n={item.badge} className="absolute left-1/2 top-1.5 ml-2" />
    </Link>
  )
}
