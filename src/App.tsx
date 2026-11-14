import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactElement } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router'
import AppErrorBoundary from './components/AppErrorBoundary'
import DemoHost from './components/demo/DemoHost'
import { Skeleton, Spinner } from './components/ui'
import { useSession } from './lib/session'
import type { Role } from './lib/types'
// Every page is its own chunk: the sign-in screens do not download charts or the 3D viewer,
// and a page is fetched only when someone opens it.
const loadShell = () => import('./components/AppShell')
const loadOverview = () => import('./pages/Overview')
const AppShell = lazy(loadShell)
const Overview = lazy(loadOverview)
const Aura = lazy(() => import('./pages/Aura'))
const Coach = lazy(() => import('./pages/Coach'))
const Diagnostics = lazy(() => import('./pages/Diagnostics'))
const Forgot = lazy(() => import('./pages/Forgot'))
const Register = lazy(() => import('./pages/Register'))
const Environment = lazy(() => import('./pages/Environment'))
const History = lazy(() => import('./pages/History'))
const Login = lazy(() => import('./pages/Login'))
const Reports = lazy(() => import('./pages/Reports'))
const Roster = lazy(() => import('./pages/Roster'))

const isSelf = (r: Role) => r === 'astronaut' || r === 'member'

function Home() {
  const { user } = useSession()
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={isSelf(user.role) ? `/crew/${user.crewId}` : '/crew'} replace />
}

function RequireAuth({ children, roles }: { children: ReactElement; roles?: Role[] }) {
  const { user, ready } = useSession()
  if (!ready) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />
  return children
}

/** Resolves :crewId and enforces that astronauts only see their own record. */
function CrewPage({ page: Page, roles }: { page: ComponentType<{ crewId: number }>; roles?: Role[] }) {
  const { user } = useSession()
  const { crewId } = useParams()
  const id = Number(crewId)
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={`/crew/${id}`} replace />
  if (isSelf(user.role) && user.crewId !== id) return <Navigate to={`/crew/${user.crewId}`} replace />
  return (
    <Late>
      <Page key={id} crewId={id} />
    </Late>
  )
}

/**
 * Route-level loading state. Per docs/DESIGN.md motion: nothing appears for a fast load, so it only
 * shows after 250 ms (no flash), then holds still apart from the Skeleton/Spinner loops.
 */
function RouteFallback({ page = true }: { page?: boolean }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 250)
    return () => clearTimeout(t)
  }, [])
  if (!show) return null
  return page ? (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Spinner label="Loading this page" />
    </div>
  ) : (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Loading" />
    </div>
  )
}

/** Suspense boundary for a lazy page. Inside the shell the header stays; outside it fills the screen. */
function Late({ children, page = true }: { children: ReactElement; page?: boolean }) {
  return <Suspense fallback={<RouteFallback page={page} />}>{children}</Suspense>
}

/** Warm the signed-in screens while the browser is idle, so the first tap after sign-in is instant. */
function usePrefetchSignedIn(signedIn: boolean) {
  useEffect(() => {
    if (!signedIn) return
    const run = () => void Promise.all([loadShell(), loadOverview()]).catch(() => undefined)
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(run)
    else setTimeout(run, 1500)
  }, [signedIn])
}

function Splash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner label="Connecting to mission systems" />
    </div>
  )
}

export default function App() {
  const { ready, user } = useSession()
  const { pathname } = useLocation()
  usePrefetchSignedIn(!!user)
  // Tells src/main.tsx a navigation happened: a waiting service-worker update is applied then (never mid-form).
  useEffect(() => {
    window.dispatchEvent(new Event('aura:navigated'))
  }, [pathname])
  if (!ready) return <Splash />
  return (
    <>
    <AppErrorBoundary resetKey={pathname}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Late page={false}><Login /></Late>} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <Late page={false}><Register /></Late>} />
        <Route path="/forgot" element={user ? <Navigate to="/" replace /> : <Late page={false}><Forgot /></Late>} />
        <Route path="/" element={<Home />} />
        <Route
          element={
            <RequireAuth>
              <Late page={false}>
                <AppShell />
              </Late>
            </RequireAuth>
          }
        >
          <Route path="/crew" element={<RequireAuth roles={['surgeon', 'ground']}><Late><Roster /></Late></RequireAuth>} />
          <Route path="/crew/:crewId" element={<CrewPage page={Overview} />} />
          <Route path="/crew/:crewId/diagnostics" element={<CrewPage page={Diagnostics} roles={['astronaut', 'member', 'surgeon']} />} />
          <Route path="/crew/:crewId/aura" element={<CrewPage page={Aura} roles={['astronaut', 'member', 'surgeon']} />} />
          <Route path="/crew/:crewId/coach" element={<CrewPage page={Coach} roles={['astronaut', 'member', 'surgeon']} />} />
          <Route path="/crew/:crewId/history" element={<CrewPage page={History} />} />
          <Route path="/environment" element={<Late><Environment /></Late>} />
          <Route path="/reports" element={<RequireAuth roles={['surgeon']}><Late><Reports /></Late></RequireAuth>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppErrorBoundary>
    {/* Guided jury demo (src/components/demo): renders nothing unless the page was opened as the sandboxed tour. */}
    <DemoHost />
    </>
  )
}
