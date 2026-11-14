import type { ReactElement } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router'
import AppShell from './components/AppShell'
import { Spinner } from './components/ui'
import { useSession } from './lib/session'
import type { Role } from './lib/types'
import Aura from './pages/Aura'
import Coach from './pages/Coach'
import Diagnostics from './pages/Diagnostics'
import Forgot from './pages/Forgot'
import Register from './pages/Register'
import Environment from './pages/Environment'
import History from './pages/History'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Reports from './pages/Reports'
import Roster from './pages/Roster'

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
function CrewPage({ page: Page, roles }: { page: (p: { crewId: number }) => ReactElement; roles?: Role[] }) {
  const { user } = useSession()
  const { crewId } = useParams()
  const id = Number(crewId)
  if (!user) return <Navigate to="/login" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to={`/crew/${id}`} replace />
  if (isSelf(user.role) && user.crewId !== id) return <Navigate to={`/crew/${user.crewId}`} replace />
  return <Page key={id} crewId={id} />
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
  if (!ready) return <Splash />
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/forgot" element={user ? <Navigate to="/" replace /> : <Forgot />} />
      <Route path="/" element={<Home />} />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/crew" element={<RequireAuth roles={['surgeon', 'ground']}><Roster /></RequireAuth>} />
        <Route path="/crew/:crewId" element={<CrewPage page={Overview} />} />
        <Route path="/crew/:crewId/diagnostics" element={<CrewPage page={Diagnostics} roles={['astronaut', 'member', 'surgeon']} />} />
        <Route path="/crew/:crewId/aura" element={<CrewPage page={Aura} roles={['astronaut', 'member', 'surgeon']} />} />
        <Route path="/crew/:crewId/coach" element={<CrewPage page={Coach} roles={['astronaut', 'member']} />} />
        <Route path="/crew/:crewId/history" element={<CrewPage page={History} />} />
        <Route path="/environment" element={<Environment />} />
        <Route path="/reports" element={<RequireAuth roles={['surgeon']}><Reports /></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
