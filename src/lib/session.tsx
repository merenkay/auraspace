import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getBackend, type Backend } from './api'
import { evaluate, type Evaluation } from './health'
import type { CrewMember, Measurement, Mission, Role, Task, User } from './types'
import type { FieldId } from '../data/vitals'

type Session = {
  backend: Backend | null
  user: User | null
  mission: Mission | null
  crew: CrewMember[]
  ready: boolean
  login: (u: string, p: string) => Promise<void>
  demoLogin: (role: Role, crewId?: number) => Promise<void>
  logout: () => Promise<void>
}

const Ctx = createContext<Session | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [mission, setMission] = useState<Mission | null>(null)
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [ready, setReady] = useState(false)

  const loadFor = useCallback(async (b: Backend, u: User | null) => {
    setUser(u)
    if (u) {
      const [m, c] = await Promise.all([b.mission(), b.crew()])
      setMission(m)
      setCrew(c)
    } else {
      setCrew([])
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const b = await getBackend()
      if (!alive) return
      setBackend(b)
      try {
        await loadFor(b, await b.me())
      } catch {
        setUser(null)
      }
      if (alive) setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [loadFor])

  const value = useMemo<Session>(
    () => ({
      backend,
      user,
      mission,
      crew,
      ready,
      login: async (u, p) => {
        if (!backend) return
        await loadFor(backend, await backend.login(u, p))
      },
      demoLogin: async (role, crewId) => {
        if (!backend) return
        await loadFor(backend, await backend.demoLogin(role, crewId))
      },
      logout: async () => {
        if (!backend) return
        await backend.logout()
        await loadFor(backend, null)
      },
    }),
    [backend, user, mission, crew, ready, loadFor],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSession() {
  const s = useContext(Ctx)
  if (!s) throw new Error('useSession outside provider')
  return s
}

export type CrewData = {
  rows: Measurement[]
  tasks: Task[]
  streak: number
  loading: boolean
  error: string | null
  ev: Evaluation | null
  add: (values: Partial<Record<FieldId, number>>, source: string, device: string) => Promise<void>
  toggleTask: (id: string) => Promise<void>
  reload: () => Promise<void>
}

export function useCrewData(crewId: number | null): CrewData {
  const { backend, mission, user } = useSession()
  const [rows, setRows] = useState<Measurement[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [streak, setStreak] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!backend || crewId == null) return
    setLoading(true)
    setError(null)
    try {
      const [m, t] = await Promise.all([backend.measurements(crewId), backend.tasks(crewId)])
      setRows(m)
      setTasks(t.tasks)
      setStreak(t.streak)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load data')
    } finally {
      setLoading(false)
    }
  }, [backend, crewId])

  useEffect(() => {
    void reload()
  }, [reload])

  const ev = useMemo(
    () => (mission && rows.length ? evaluate(rows, mission.profileId, mission.day, user?.role === 'ground') : null),
    [rows, mission, user],
  )

  return {
    rows,
    tasks,
    streak,
    loading,
    error,
    ev,
    reload,
    add: async (values, source, device) => {
      if (!backend || crewId == null) return
      const added = await backend.addMeasurements(crewId, values, source, device)
      setRows((r) => [...r, ...added])
    },
    toggleTask: async (id) => {
      if (!backend || crewId == null) return
      setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
      const res = await backend.toggleTask(crewId, id)
      setTasks(res.tasks)
      setStreak(res.streak)
    },
  }
}
