// Data access. Uses the PHP/MySQL API on Hostinger when it answers; otherwise falls back to an
// in-browser demo store (same simulated crew) so the app always works — including offline.
import { contextOf, type Context } from '../data/contexts'
import type { FieldId } from '../data/vitals'
import { CREW, MISSION, STAFF, TASKS_BY_CONTEXT, generateMeasurements } from './demoData'
import { IMPORT_DEVICES } from './samsungHealth'
import type { CodeTicket, CrewMember, ImportResult, ImportRow, Measurement, Mission, Report, ReportSummary, Role, Task, User } from './types'

export type Mode = 'server' | 'demo'
export type SignupInput = { name: string; email: string; password: string; context: Context; consent: boolean }

export interface Backend {
  mode: Mode
  mailReady: boolean
  /** Whether e-mail sign-up is open (server: `signup` from the health route). Absent means unknown, treat as open. */
  signupOpen?: boolean
  /** Whether demo logins are allowed (server: false when the health route says `demo: false`). */
  demoOpen?: boolean
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
  /** Rows with day >= sinceDay. Default: everything, including imported history before day 1. */
  measurements(crewId: number, sinceDay?: number): Promise<Measurement[]>
  addMeasurements(crewId: number, values: Partial<Record<FieldId, number>>, source: string, device: string): Promise<Measurement[]>
  /**
   * Saves daily values from a device export (source 'device'). Each row keeps its own timestamp; its tracking day
   * is today's day minus the whole days since `localDate` (can be <= 0). Deduplicated by person + metric + local
   * day + device: a day that was already imported keeps its first value. Self users only, own record only.
   */
  importMeasurements(crewId: number, rows: ImportRow[], device: string, onProgress?: (done: number, total: number) => void): Promise<ImportResult>
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

/* ------------------------------------------------------------------ import */

/** Default lower bound for measurements(): include imported history that predates day 1. */
const EARLIEST_DAY = -100000
/** Rows per import request (the server caps at 400). */
const IMPORT_CHUNK = 300
/** Metrics an import may write, with the same plausible ranges as METRICS in public/api/lib.php. */
const IMPORT_RANGES: Partial<Record<FieldId, [number, number]>> = {
  sys: [60, 250], dia: [30, 150], hr: [20, 220], spo2: [50, 100], temp: [30, 43], sleep: [0, 16], exercise: [0, 300], water: [0, 8],
}

/** Shared row validation (demo store; the PHP route applies the same rules). Returns null when the row is invalid. */
function cleanImportRow(r: ImportRow, today: string): ImportRow | null {
  const range = IMPORT_RANGES[r.metric]
  if (!range || typeof r.value !== 'number' || !Number.isFinite(r.value) || r.value < range[0] || r.value > range[1]) return null
  if (typeof r.localDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.localDate)) return null
  const d = Date.parse(`${r.localDate}T00:00:00Z`)
  if (!Number.isFinite(d) || new Date(d).toISOString().slice(0, 10) !== r.localDate) return null
  const ago = Math.round((Date.parse(`${today}T00:00:00Z`) - d) / 86400000)
  if (ago < -1 || ago > 3660) return null
  const at = Date.parse(r.at)
  if (!Number.isFinite(at)) return null
  return { metric: r.metric, value: r.value, localDate: r.localDate, at: new Date(Math.min(at, Date.now())).toISOString() }
}

function localToday() {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`
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

function makeServer(mailReady: boolean, signupOpen?: boolean, demoOpen = true): Backend {
  const post = <T,>(route: string, body: unknown) => call<T>(route, { method: 'POST', body })
  return {
    mode: 'server',
    mailReady,
    signupOpen,
    demoOpen,
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
    measurements: async (crewId, sinceDay = EARLIEST_DAY) => {
      // The core route only serves day >= 1; imported history from before day 1 comes from the import module.
      // If that module is not deployed (or fails), the app still works with the core rows.
      const [main, early] = await Promise.all([
        call<{ measurements: Measurement[] }>('measurements', { query: { crew: crewId, since: Math.max(1, sinceDay) } }).then((d) => d.measurements),
        sinceDay < 1
          ? call<{ measurements: Measurement[] }>('import/early', { query: { crew: crewId, since: sinceDay } }).then((d) => d.measurements).catch(() => [] as Measurement[])
          : Promise.resolve([] as Measurement[]),
      ])
      return early.length ? [...early, ...main].sort((a, b) => a.at.localeCompare(b.at)) : main
    },
    addMeasurements: (crewId, values, source, device) => post<{ measurements: Measurement[] }>('measurements', { crewId, values, source, device }).then((d) => d.measurements),
    importMeasurements: async (crewId, rows, device, onProgress) => {
      const total: ImportResult = { added: 0, unchanged: 0, conflicts: 0, rejected: 0, measurements: [] }
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
        const r = await post<ImportResult>('import/measurements', { crewId, device, rows: rows.slice(i, i + IMPORT_CHUNK) })
        total.added += r.added
        total.unchanged += r.unchanged
        total.conflicts += r.conflicts
        total.rejected += r.rejected
        total.measurements.push(...(r.measurements ?? []))
        onProgress?.(Math.min(rows.length, i + IMPORT_CHUNK), rows.length)
      }
      return total
    },
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
  /** Device-import dedupe index: `${crewId}|${metric}|${localDate}|${device}` -> id of the row in `extra`. Optional for older stores. */
  imports?: Record<string, number>
}

function readStore(): Store {
  const fresh: Store = {
    user: null,
    extra: [],
    done: Object.fromEntries(CREW.map((c) => [`${c.id}:${MISSION.day}`, c.doneTasks])),
    reports: [],
    members: [],
    pending: {},
    imports: {},
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
/** Like writeStore, but reports failure (used where silently losing data would mislead, e.g. imports). */
function writeStoreOrThrow(s: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    throw new ApiError('This browser has no room left to store the imported data. Import a shorter date range.', 507)
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

/** Same rules as can_view_crew() on the server: self users see only their own record, staff only the simulated demo crew. */
function guardView(st: Store, crewId: number) {
  const u = st.user
  if (!u) throw new ApiError('Please sign in.', 401)
  const ok = u.role === 'astronaut' || u.role === 'member' ? u.crewId === crewId : CREW.some((c) => c.id === crewId)
  if (!ok) throw new ApiError('Not allowed', 403)
}
/** Writes: only a self user, only their own record. */
function guardOwn(st: Store, crewId: number) {
  const u = st.user
  if (!u) throw new ApiError('Please sign in.', 401)
  if ((u.role !== 'astronaut' && u.role !== 'member') || u.crewId !== crewId) throw new ApiError('Not allowed', 403)
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
  signupOpen: true,
  demoOpen: true,
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
    // Never reuse an id: after an account is deleted, members.length would hand out a live member's id again.
    const id = Math.max(1000, ...st.members.map((x) => x.id + 1))
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
      imports: Object.fromEntries(Object.entries(st.imports ?? {}).filter(([k]) => !k.startsWith(`${m.crewId}|`))),
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
  measurements: async (crewId, sinceDay = EARLIEST_DAY) => {
    const st = readStore()
    guardView(st, crewId)
    const rows = [...base(), ...st.extra].filter((m) => m.crewId === crewId && m.day >= sinceDay)
    const visible = st.user?.role === 'ground' ? rows.filter((m) => m.metric !== 'mood') : rows
    return delay(visible.sort((a, b) => a.at.localeCompare(b.at)))
  },
  addMeasurements: async (crewId, values, source, device) => {
    const st = readStore()
    guardOwn(st, crewId)
    const now = new Date().toISOString()
    const day = dayFor(st, crewId)
    let id = Math.max(1_000_000, ...st.extra.map((m) => m.id + 1))
    const rows: Measurement[] = Object.entries(values).map(([metric, value]) => ({ id: id++, crewId, metric: metric as FieldId, value: value as number, day, at: now, source, device }))
    writeStore({ ...st, extra: [...st.extra, ...rows] })
    return delay(rows)
  },
  importMeasurements: async (crewId, rows, device, onProgress) => {
    const st = readStore()
    const u = st.user
    if (!u || (u.role !== 'astronaut' && u.role !== 'member') || u.crewId !== crewId) throw new ApiError('You can only import data into your own record.', 403)
    if (!(IMPORT_DEVICES as readonly string[]).includes(device)) throw new ApiError('Unknown device label.', 400)
    const today = localToday()
    const curDay = dayFor(st, crewId)
    const index = { ...(st.imports ?? {}) }
    const extra = [...st.extra]
    const byId = new Map(extra.map((m, i) => [m.id, i]))
    let id = Math.max(1_000_000 + extra.length, ...extra.map((m) => m.id + 1))
    const result: ImportResult = { added: 0, unchanged: 0, conflicts: 0, rejected: 0, measurements: [] }
    for (const raw of rows) {
      const r = cleanImportRow(raw, today)
      if (!r) {
        result.rejected++
        continue
      }
      const key = `${crewId}|${r.metric}|${r.localDate}|${device}`
      const prevIdx = index[key] != null ? byId.get(index[key]) : undefined
      if (prevIdx != null) {
        if (Math.abs(extra[prevIdx].value - r.value) < 0.005) result.unchanged++
        else result.conflicts++ // append-only: keep the value imported first
        continue
      }
      const ago = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.localDate}T00:00:00Z`)) / 86400000)
      const m: Measurement = { id: id++, crewId, metric: r.metric, value: r.value, day: curDay - ago, at: r.at, source: 'device', device }
      byId.set(m.id, extra.length)
      extra.push(m)
      index[key] = m.id
      result.added++
      result.measurements.push(m)
    }
    writeStoreOrThrow({ ...st, extra, imports: index })
    onProgress?.(rows.length, rows.length)
    return delay(result)
  },
  tasks: async (crewId) => {
    const st = readStore()
    guardView(st, crewId)
    return delay(tasksFor(st, crewId))
  },
  toggleTask: async (crewId, taskId) => {
    const st = readStore()
    guardOwn(st, crewId)
    const key = `${crewId}:${dayFor(st, crewId)}`
    const cur = st.done[key] ?? []
    const next = cur.includes(taskId) ? cur.filter((t) => t !== taskId) : [...cur, taskId]
    const ns = { ...st, done: { ...st.done, [key]: next } }
    writeStore(ns)
    return delay(tasksFor(ns, crewId))
  },
  reports: async (crewId) => {
    const st = readStore()
    const u = st.user
    // Mirrors GET reports: self users read their own, the surgeon reads the demo crew's, ground has no access to reports.
    const all =
      u?.role === 'surgeon' ? st.reports.filter((r) => CREW.some((c) => c.id === r.crewId))
      : u?.role === 'astronaut' || u?.role === 'member' ? st.reports.filter((r) => r.crewId === u.crewId)
      : []
    return delay(crewId ? all.filter((r) => r.crewId === crewId) : all)
  },
  sendReport: async (crewId, summary) => {
    const st = readStore()
    guardOwn(st, crewId)
    const name = CREW.find((x) => x.id === crewId)?.name ?? st.members.find((m) => m.crewId === crewId)?.name ?? 'Member'
    const report: Report = { id: Date.now(), crewId, crewName: name, day: dayFor(st, crewId), createdAt: new Date().toISOString(), status: 'queued', summary, reviewNote: null, reviewedBy: null }
    writeStore({ ...st, reports: [report, ...st.reports] })
    return delay(report)
  },
  reviewReport: async (id, note) => {
    const st = readStore()
    if (st.user?.role !== 'surgeon') throw new ApiError('Not allowed', 403)
    const reports = st.reports.map((r) => (r.id === id ? { ...r, status: 'reviewed' as const, reviewNote: note, reviewedBy: st.user?.name ?? 'Flight Surgeon' } : r))
    writeStore({ ...st, reports })
    return delay(reports.find((r) => r.id === id)!)
  },
}

/* ---------------------------------------------------------------- selection */

let chosen: Promise<Backend> | null = null

// Once this browser has talked to a working server, a failed health check (bad signal, server restart) must not
// drop the person into the in-browser demo store: their real records would seem to have vanished and anything
// they typed would stay on this device only. We remember the server's flags and keep using the server backend;
// its calls then fail with a visible network error until the connection is back.
const SEEN_KEY = 'aura.server.v1'
type Seen = { mail: boolean; signup?: boolean; demo: boolean }

function readSeen(): Seen | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return raw ? (JSON.parse(raw) as Seen) : null
  } catch {
    return null
  }
}

function writeSeen(s: Seen) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(s))
  } catch {
    /* storage blocked: we only lose the memory */
  }
}

export function getBackend(): Promise<Backend> {
  if (!chosen) {
    chosen = (async () => {
      try {
        const ctrl = new AbortController()
        const t = setTimeout(() => ctrl.abort(), 3000)
        const res = await fetch('/api/index.php?r=health', { signal: ctrl.signal, credentials: 'same-origin' })
        clearTimeout(t)
        const data = await res.json()
        if (res.ok && data?.ok && data?.db) {
          const seen: Seen = { mail: !!data.mail, signup: typeof data.signup === 'boolean' ? data.signup : undefined, demo: data.demo !== false }
          writeSeen(seen)
          return makeServer(seen.mail, seen.signup, seen.demo)
        }
      } catch {
        /* no API reachable */
      }
      const seen = readSeen()
      if (seen) {
        // Check again on the next call once the browser reports a connection.
        if (typeof window !== 'undefined') window.addEventListener('online', () => (chosen = null), { once: true })
        return makeServer(seen.mail, seen.signup, seen.demo)
      }
      return demo
    })()
  }
  return chosen
}

export { ApiError }
