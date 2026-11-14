// Data access. Uses the PHP/MySQL API on Hostinger when it answers; otherwise falls back to an
// in-browser demo store (same simulated crew) so the app always works — including offline.
import { CREW, MISSION, STAFF, TASKS, generateMeasurements } from './demoData'
import type { CrewMember, Measurement, Mission, Report, ReportSummary, Role, Task, User } from './types'
import type { FieldId } from '../data/vitals'

export type Mode = 'server' | 'demo'

export interface Backend {
  mode: Mode
  me(): Promise<User | null>
  login(username: string, password: string): Promise<User>
  demoLogin(role: Role, crewId?: number): Promise<User>
  logout(): Promise<void>
  mission(): Promise<Mission>
  crew(): Promise<CrewMember[]>
  measurements(crewId: number, sinceDay?: number): Promise<Measurement[]>
  addMeasurements(crewId: number, values: Partial<Record<FieldId, number>>, source: string, device: string): Promise<Measurement[]>
  tasks(crewId: number): Promise<{ tasks: Task[]; streak: number }>
  toggleTask(crewId: number, taskId: string): Promise<{ tasks: Task[]; streak: number }>
  reports(crewId?: number): Promise<Report[]>
  sendReport(crewId: number, summary: ReportSummary): Promise<Report>
  reviewReport(id: number, note: string): Promise<Report>
}

/* ------------------------------------------------------------------ server */

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function call<T>(route: string, opts: { method?: string; body?: unknown; query?: Record<string, string | number> } = {}): Promise<T> {
  const q = new URLSearchParams({ r: route, ...Object.fromEntries(Object.entries(opts.query ?? {}).map(([k, v]) => [k, String(v)])) })
  const res = await fetch(`/api/index.php?${q}`, {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  const text = await res.text()
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new ApiError('The server returned an unexpected response.', res.status)
  }
  if (!res.ok || data?.error) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status)
  return data as T
}

const server: Backend = {
  mode: 'server',
  me: () => call<{ user: User | null }>('auth/me').then((d) => d.user),
  login: (username, password) => call<{ user: User }>('auth/login', { method: 'POST', body: { username, password } }).then((d) => d.user),
  demoLogin: (role, crewId) => call<{ user: User }>('auth/demo', { method: 'POST', body: { role, crewId } }).then((d) => d.user),
  logout: () => call('auth/logout', { method: 'POST', body: {} }).then(() => undefined),
  mission: () => call<{ mission: Mission }>('mission').then((d) => d.mission),
  crew: () => call<{ crew: CrewMember[] }>('crew').then((d) => d.crew),
  measurements: (crewId, sinceDay = 1) =>
    call<{ measurements: Measurement[] }>('measurements', { query: { crew: crewId, since: sinceDay } }).then((d) => d.measurements),
  addMeasurements: (crewId, values, source, device) =>
    call<{ measurements: Measurement[] }>('measurements', { method: 'POST', body: { crewId, values, source, device } }).then((d) => d.measurements),
  tasks: (crewId) => call('tasks', { query: { crew: crewId } }),
  toggleTask: (crewId, taskId) => call('tasks/toggle', { method: 'POST', body: { crewId, taskId } }),
  reports: (crewId) => call<{ reports: Report[] }>('reports', { query: crewId ? { crew: crewId } : {} }).then((d) => d.reports),
  sendReport: (crewId, summary) => call<{ report: Report }>('reports', { method: 'POST', body: { crewId, summary } }).then((d) => d.report),
  reviewReport: (id, note) => call<{ report: Report }>('reports/review', { method: 'POST', body: { id, note } }).then((d) => d.report),
}

/* -------------------------------------------------------------------- demo */

const KEY = 'aura.demo.v2'
type Store = {
  user: User | null
  extra: Measurement[]
  done: Record<number, string[]>
  reports: Report[]
}

function readStore(): Store {
  const fresh: Store = {
    user: null,
    extra: [],
    done: Object.fromEntries(CREW.map((c) => [c.id, c.doneTasks])),
    reports: [],
  }
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...fresh, ...JSON.parse(raw) } : fresh
  } catch {
    return fresh
  }
}
function writeStore(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* storage unavailable: demo state lives for this page only */
  }
}

let baseCache: Measurement[] | null = null
function base(): Measurement[] {
  if (!baseCache) {
    baseCache = generateMeasurements().map((m, i) => ({ ...m, id: i + 1, metric: m.metric as FieldId }))
  }
  return baseCache
}

function userFor(role: Role, crewId?: number): User {
  if (role === 'astronaut') {
    const c = CREW.find((x) => x.id === crewId) ?? CREW[0]
    return { id: c.id, username: c.username, role, name: c.name, title: `${c.position} · ${c.callsign}`, crewId: c.id }
  }
  const s = STAFF.find((x) => x.role === role)!
  return { id: s.id, username: s.username, role, name: s.name, title: s.title, crewId: null }
}

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120))

function tasksFor(store: Store, crewId: number) {
  const done = store.done[crewId] ?? []
  const tasks = TASKS.map((t) => ({ ...t, done: done.includes(t.id) }))
  const c = CREW.find((x) => x.id === crewId)
  const streak = (c?.streak ?? 0) + (tasks.every((t) => t.done) ? 1 : 0)
  return { tasks, streak }
}

const demo: Backend = {
  mode: 'demo',
  me: () => delay(readStore().user),
  async login(username, password) {
    const u = username.trim().toLowerCase()
    const c = CREW.find((x) => x.username === u)
    const s = STAFF.find((x) => x.username === u)
    if ((!c && !s) || password.length < 4) throw new ApiError('Unknown user or wrong password.', 401)
    const user = c ? userFor('astronaut', c.id) : userFor(s!.role)
    const st = readStore()
    writeStore({ ...st, user })
    return delay(user)
  },
  async demoLogin(role, crewId) {
    const user = userFor(role, crewId)
    writeStore({ ...readStore(), user })
    return delay(user)
  },
  async logout() {
    writeStore({ ...readStore(), user: null })
  },
  mission: () => delay({ ...MISSION }),
  crew: async () => {
    const u = readStore().user
    const list = CREW.map(({ id, name, callsign, position, color }) => ({ id, name, callsign, position, color }))
    return delay(u?.role === 'astronaut' ? list.filter((c) => c.id === u.crewId) : list)
  },
  measurements: async (crewId, sinceDay = 1) => {
    const st = readStore()
    const rows = [...base(), ...st.extra].filter((m) => m.crewId === crewId && m.day >= sinceDay)
    const visible = st.user?.role === 'ground' ? rows.filter((m) => m.metric !== 'mood') : rows
    return delay(visible.sort((a, b) => a.at.localeCompare(b.at)))
  },
  addMeasurements: async (crewId, values, source, device) => {
    const st = readStore()
    const now = new Date().toISOString()
    let id = 1_000_000 + st.extra.length
    const rows: Measurement[] = Object.entries(values).map(([metric, value]) => ({
      id: id++, crewId, metric: metric as FieldId, value: value as number, day: MISSION.day, at: now, source, device,
    }))
    writeStore({ ...st, extra: [...st.extra, ...rows] })
    return delay(rows)
  },
  tasks: async (crewId) => delay(tasksFor(readStore(), crewId)),
  toggleTask: async (crewId, taskId) => {
    const st = readStore()
    const cur = st.done[crewId] ?? []
    const next = cur.includes(taskId) ? cur.filter((t) => t !== taskId) : [...cur, taskId]
    const ns = { ...st, done: { ...st.done, [crewId]: next } }
    writeStore(ns)
    return delay(tasksFor(ns, crewId))
  },
  reports: async (crewId) => {
    const all = readStore().reports
    return delay(crewId ? all.filter((r) => r.crewId === crewId) : all)
  },
  sendReport: async (crewId, summary) => {
    const st = readStore()
    const c = CREW.find((x) => x.id === crewId)!
    const report: Report = {
      id: Date.now(), crewId, crewName: c.name, day: MISSION.day, createdAt: new Date().toISOString(),
      status: 'queued', summary, reviewNote: null, reviewedBy: null,
    }
    writeStore({ ...st, reports: [report, ...st.reports] })
    return delay(report)
  },
  reviewReport: async (id, note) => {
    const st = readStore()
    const reports = st.reports.map((r) =>
      r.id === id ? { ...r, status: 'reviewed' as const, reviewNote: note, reviewedBy: st.user?.name ?? 'Flight Surgeon' } : r,
    )
    writeStore({ ...st, reports })
    return delay(reports.find((r) => r.id === id)!)
  },
}

/* ---------------------------------------------------------------- selection */

let chosen: Promise<Backend> | null = null

export function getBackend(): Promise<Backend> {
  if (!chosen) {
    chosen = (async () => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 3000)
        const res = await fetch('/api/index.php?r=health', { signal: ctrl.signal, credentials: 'same-origin' })
        clearTimeout(t)
        const data = await res.json()
        if (res.ok && data?.ok && data?.db) return server
      } catch {
        /* no API reachable */
      }
      return demo
    })()
  }
  return chosen
}

export { ApiError }
