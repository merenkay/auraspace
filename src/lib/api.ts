// Data access. Uses the PHP/MySQL API on Hostinger when it answers; otherwise falls back to an
// in-browser demo store (same simulated crew) so the app always works — including offline.
import { contextOf, type Context } from '../data/contexts'
import type { FieldId } from '../data/vitals'
import { CREW, MISSION, STAFF, TASKS_BY_CONTEXT, generateMeasurements } from './demoData'
import type { CodeTicket, CrewMember, Measurement, Mission, Report, ReportSummary, Role, Task, User } from './types'

export type Mode = 'server' | 'demo'
export type SignupInput = { name: string; email: string; password: string; context: Context; consent: boolean }

export interface Backend {
  mode: Mode
  mailReady: boolean
  me(): Promise<User | null>
  login(username: string, password: string): Promise<User>
  demoLogin(role: Role, crewId?: number): Promise<User>
  logout(): Promise<void>
  register(input: SignupInput): Promise<CodeTicket>
  verify(email: string, code: string): Promise<User>
  resend(email: string, purpose: 'register' | 'reset'): Promise<CodeTicket>
  forgot(email: string): Promise<CodeTicket>
  reset(email: string, code: string, password: string): Promise<User>
  deleteAccount(password: string): Promise<void>
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

class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/* ------------------------------------------------------------------ server */

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

/** Low-level call to /api/index.php?r=<route> for feature modules (throws ApiError). Only use when getBackend().mode === 'server'. */
export const apiCall = call

const normUser = (u: User): User => ({ ...u, context: contextOf(u.context) })

function makeServer(mailReady: boolean): Backend {
  const post = <T,>(route: string, body: unknown) => call<T>(route, { method: 'POST', body })
  return {
    mode: 'server',
    mailReady,
    me: () => call<{ user: User | null }>('auth/me').then((d) => (d.user ? normUser(d.user) : null)),
    login: (username, password) => post<{ user: User }>('auth/login', { username, password }).then((d) => normUser(d.user)),
    demoLogin: (role, crewId) => post<{ user: User }>('auth/demo', { role, crewId }).then((d) => normUser(d.user)),
    logout: () => post('auth/logout', {}).then(() => undefined),
    register: (input) => post<CodeTicket>('auth/register', input),
    verify: (email, code) => post<{ user: User }>('auth/verify', { email, code }).then((d) => normUser(d.user)),
    resend: (email, purpose) => post<CodeTicket>('auth/resend', { email, purpose }).then((d) => ({ ...d, email })),
    forgot: (email) => post<CodeTicket>('auth/forgot', { email }).then((d) => ({ ...d, email })),
    reset: (email, code, password) => post<{ user: User }>('auth/reset', { email, code, password }).then((d) => normUser(d.user)),
    deleteAccount: (password) => post('auth/delete', { password }).then(() => undefined),
    mission: () => call<{ mission: Mission }>('mission').then((d) => ({ ...d.mission, context: contextOf(d.mission.context) })),
    crew: () => call<{ crew: CrewMember[] }>('crew').then((d) => d.crew),
    measurements: (crewId, sinceDay = 1) => call<{ measurements: Measurement[] }>('measurements', { query: { crew: crewId, since: sinceDay } }).then((d) => d.measurements),
    addMeasurements: (crewId, values, source, device) => post<{ measurements: Measurement[] }>('measurements', { crewId, values, source, device }).then((d) => d.measurements),
    tasks: (crewId) => call('tasks', { query: { crew: crewId } }),
    toggleTask: (crewId, taskId) => post('tasks/toggle', { crewId, taskId }),
    reports: (crewId) => call<{ reports: Report[] }>('reports', { query: crewId ? { crew: crewId } : {} }).then((d) => d.reports),
    sendReport: (crewId, summary) => post<{ report: Report }>('reports', { crewId, summary }).then((d) => d.report),
    reviewReport: (id, note) => post<{ report: Report }>('reports/review', { id, note }).then((d) => d.report),
  }
}

/* -------------------------------------------------------------------- demo */

type DemoMember = { id: number; crewId: number; email: string; name: string; pass: string; context: Context; createdAt: string; color: string }
type Pending = { code: string; purpose: 'register' | 'reset'; expires: number; tries: number; payload?: { name: string; pass: string; context: Context } }

const KEY = 'aura.demo.v3'
type Store = {
  user: User | null
  extra: Measurement[]
  done: Record<string, string[]> // key: `${crewId}:${day}`
  reports: Report[]
  members: DemoMember[]
  pending: Record<string, Pending>
}

function readStore(): Store {
  const fresh: Store = {
    user: null,
    extra: [],
    done: Object.fromEntries(CREW.map((c) => [`${c.id}:${MISSION.day}`, c.doneTasks])),
    reports: [],
    members: [],
    pending: {},
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

// Demo-only obfuscation so plain passwords are not left in localStorage. Not a security boundary.
async function digest(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`aura-demo|${text}`))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

let baseCache: Measurement[] | null = null
function base(): Measurement[] {
  if (!baseCache) baseCache = generateMeasurements().map((m, i) => ({ ...m, id: i + 1, metric: m.metric as FieldId }))
  return baseCache
}

function userFor(role: Role, crewId?: number): User {
  if (role === 'astronaut') {
    const c = CREW.find((x) => x.id === crewId) ?? CREW[0]
    return { id: c.id, username: c.username, role, name: c.name, title: `${c.position} · ${c.callsign}`, crewId: c.id, context: 'space' }
  }
  const s = STAFF.find((x) => x.role === role)!
  return { id: s.id, username: s.username, role, name: s.name, title: s.title, crewId: null, context: 'space' }
}

const POSITION: Record<Context, string> = { space: 'Space crew', polar: 'Polar station', home: 'Home care' }
const memberUser = (m: DemoMember): User => ({ id: m.id, username: m.email, email: m.email, role: 'member', name: m.name, title: POSITION[m.context], crewId: m.crewId, context: m.context })

function memberDay(m: DemoMember) {
  const start = new Date(m.createdAt)
  start.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((today.getTime() - start.getTime()) / 86400000) + 1
}

function dayFor(st: Store, crewId: number) {
  const m = st.members.find((x) => x.crewId === crewId)
  return m ? memberDay(m) : MISSION.day
}
function ctxFor(st: Store, crewId: number): Context {
  return st.members.find((x) => x.crewId === crewId)?.context ?? 'space'
}

const delay = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 150))

function tasksFor(st: Store, crewId: number) {
  const day = dayFor(st, crewId)
  const done = st.done[`${crewId}:${day}`] ?? []
  const tasks = TASKS_BY_CONTEXT[ctxFor(st, crewId)].map((t) => ({ ...t, done: done.includes(t.id) }))
  const streak = (CREW.find((x) => x.id === crewId)?.streak ?? 0) + (tasks.every((t) => t.done) ? 1 : 0)
  return { tasks, streak }
}

function newCode(st: Store, email: string, purpose: Pending['purpose'], payload?: Pending['payload']): CodeTicket {
  const prev = st.pending[`${purpose}:${email}`]
  if (prev && prev.expires - 15 * 60000 + 60000 > Date.now()) throw new ApiError('Please wait a minute before asking for another code.', 429)
  const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
  st.pending[`${purpose}:${email}`] = { code, purpose, payload: payload ?? prev?.payload, expires: Date.now() + 15 * 60000, tries: 0 }
  writeStore(st)
  return { email, expiresIn: 900, demoCode: code }
}

function takeCode(st: Store, email: string, purpose: Pending['purpose'], code: string): Pending {
  const p = st.pending[`${purpose}:${email}`]
  if (!p || p.expires < Date.now()) throw new ApiError('This code has expired. Ask for a new one.', 410)
  if (p.tries >= 5) throw new ApiError('Too many wrong codes. Ask for a new one.', 429)
  if (p.code !== code.trim()) {
    p.tries++
    writeStore(st)
    throw new ApiError(`Wrong code. ${5 - p.tries} tries left.`, 400)
  }
  delete st.pending[`${purpose}:${email}`]
  return p
}

const cleanEmail = (e: string) => {
  const v = e.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new ApiError('Please enter a valid email address.', 400)
  return v
}

const demo: Backend = {
  mode: 'demo',
  mailReady: false,
  me: () => delay(readStore().user),
  async login(username, password) {
    const u = username.trim().toLowerCase()
    const st = readStore()
    const member = st.members.find((m) => m.email === u)
    if (member) {
      if (member.pass !== (await digest(password))) throw new ApiError('Unknown user or wrong password.', 401)
      const user = memberUser(member)
      writeStore({ ...st, user })
      return delay(user)
    }
    const c = CREW.find((x) => x.username === u)
    const s = STAFF.find((x) => x.username === u)
    if ((!c && !s) || password.length < 4) throw new ApiError('Unknown user or wrong password.', 401)
    const user = c ? userFor('astronaut', c.id) : userFor(s!.role)
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
  async register({ name, email, password, context, consent }) {
    const e = cleanEmail(email)
    if (name.trim().length < 2) throw new ApiError('Please enter your name.', 400)
    if (password.length < 8) throw new ApiError('Use a password with at least 8 characters.', 400)
    if (!consent) throw new ApiError('Please accept the terms to continue.', 400)
    const st = readStore()
    if (st.members.some((m) => m.email === e)) throw new ApiError('This email is already registered. Sign in or reset your password.', 409)
    return delay(newCode(st, e, 'register', { name: name.trim(), pass: await digest(password), context }))
  },
  async verify(email, code) {
    const e = cleanEmail(email)
    const st = readStore()
    const p = takeCode(st, e, 'register', code)
    if (!p.payload) throw new ApiError('Registration expired. Please sign up again.', 410)
    const id = 1000 + st.members.length
    const colors = ['#53D7FF', '#B49CFF', '#35D399', '#F6BD60', '#FF8FA3']
    const m: DemoMember = { id, crewId: id, email: e, name: p.payload.name, pass: p.payload.pass, context: p.payload.context, createdAt: new Date().toISOString(), color: colors[id % colors.length] }
    const user = memberUser(m)
    writeStore({ ...st, members: [...st.members, m], user })
    return delay(user)
  },
  async resend(email, purpose) {
    return delay(newCode(readStore(), cleanEmail(email), purpose))
  },
  async forgot(email) {
    const e = cleanEmail(email)
    const st = readStore()
    if (!st.members.some((m) => m.email === e)) return delay({ email: e, expiresIn: 900 })
    return delay(newCode(st, e, 'reset'))
  },
  async reset(email, code, password) {
    const e = cleanEmail(email)
    if (password.length < 8) throw new ApiError('Use a password with at least 8 characters.', 400)
    const st = readStore()
    takeCode(st, e, 'reset', code)
    const pass = await digest(password)
    const members = st.members.map((m) => (m.email === e ? { ...m, pass } : m))
    const user = memberUser(members.find((m) => m.email === e)!)
    writeStore({ ...st, members, user })
    return delay(user)
  },
  async deleteAccount(password) {
    const st = readStore()
    const m = st.members.find((x) => x.id === st.user?.id)
    if (!m || m.pass !== (await digest(password))) throw new ApiError('Wrong password', 401)
    writeStore({
      ...st,
      user: null,
      members: st.members.filter((x) => x.id !== m.id),
      extra: st.extra.filter((x) => x.crewId !== m.crewId),
      reports: st.reports.filter((x) => x.crewId !== m.crewId),
    })
  },
  mission: async () => {
    const st = readStore()
    const m = st.members.find((x) => x.id === st.user?.id && st.user?.role === 'member')
    if (!m) return delay({ ...MISSION, totalDays: MISSION.totalDays as number | null })
    const names: Record<Context, [string, string, string]> = { space: ['Personal space log', 'Spacecraft', 'iss'], polar: ['Polar station', 'Remote station', 'polar'], home: ['Home care', 'Home', 'home'] }
    const [name, environment, profileId] = names[m.context]
    return delay({ name, environment, profileId, day: memberDay(m), totalDays: null, context: m.context })
  },
  crew: async () => {
    const st = readStore()
    const u = st.user
    if (u?.role === 'member') {
      const m = st.members.find((x) => x.id === u.id)
      return delay(m ? [{ id: m.crewId, name: m.name, callsign: m.name.slice(0, 2).toUpperCase(), position: POSITION[m.context], color: m.color, context: m.context }] : [])
    }
    const list = CREW.map(({ id, name, callsign, position, color }) => ({ id, name, callsign, position, color, context: 'space' as Context }))
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
    const day = dayFor(st, crewId)
    let id = 1_000_000 + st.extra.length
    const rows: Measurement[] = Object.entries(values).map(([metric, value]) => ({ id: id++, crewId, metric: metric as FieldId, value: value as number, day, at: now, source, device }))
    writeStore({ ...st, extra: [...st.extra, ...rows] })
    return delay(rows)
  },
  tasks: async (crewId) => delay(tasksFor(readStore(), crewId)),
  toggleTask: async (crewId, taskId) => {
    const st = readStore()
    const key = `${crewId}:${dayFor(st, crewId)}`
    const cur = st.done[key] ?? []
    const next = cur.includes(taskId) ? cur.filter((t) => t !== taskId) : [...cur, taskId]
    const ns = { ...st, done: { ...st.done, [key]: next } }
    writeStore(ns)
    return delay(tasksFor(ns, crewId))
  },
  reports: async (crewId) => {
    const st = readStore()
    const all = st.user?.role === 'surgeon' ? st.reports.filter((r) => CREW.some((c) => c.id === r.crewId)) : st.reports
    return delay(crewId ? all.filter((r) => r.crewId === crewId) : all)
  },
  sendReport: async (crewId, summary) => {
    const st = readStore()
    const name = CREW.find((x) => x.id === crewId)?.name ?? st.members.find((m) => m.crewId === crewId)?.name ?? 'Member'
    const report: Report = { id: Date.now(), crewId, crewName: name, day: dayFor(st, crewId), createdAt: new Date().toISOString(), status: 'queued', summary, reviewNote: null, reviewedBy: null }
    writeStore({ ...st, reports: [report, ...st.reports] })
    return delay(report)
  },
  reviewReport: async (id, note) => {
    const st = readStore()
    const reports = st.reports.map((r) => (r.id === id ? { ...r, status: 'reviewed' as const, reviewNote: note, reviewedBy: st.user?.name ?? 'Flight Surgeon' } : r))
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
        if (res.ok && data?.ok && data?.db) return makeServer(!!data.mail)
      } catch {
        /* no API reachable */
      }
      return demo
    })()
  }
  return chosen
}

export { ApiError }
