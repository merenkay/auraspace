import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from './api'
import { CREW, TASKS_BY_CONTEXT } from './demoData'

const T0 = new Date(2026, 10, 14, 10, 0, 0)
let b: Backend

async function fresh(): Promise<Backend> {
  vi.resetModules()
  const mod = await import('./api')
  return mod.getBackend()
}

beforeEach(async () => {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  vi.stubGlobal('setTimeout', (fn: () => void) => {
    queueMicrotask(fn)
    return 0
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
  b = await fresh()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms))
const status = async (p: Promise<unknown>) => p.then(() => 0, (e: { status: number }) => e.status)

async function signUp(email = 'a@b.co', context: 'space' | 'polar' | 'home' = 'home', password = 'password1') {
  const t = await b.register({ name: 'Ada Test', email, password, context, consent: true })
  return b.verify(email, t.demoCode!)
}

describe('backend flags', () => {
  it('demo mode: no mail, sign-up and demo logins open', () => {
    expect(b.mode).toBe('demo')
    expect(b.mailReady).toBe(false)
    expect(b.signupOpen).toBe(true)
    expect(b.demoOpen).toBe(true)
  })
})

describe('server backend flags from the health route', () => {
  const serverWith = async (health: Record<string, unknown>) => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, db: true, ...health }) }))
    return fresh()
  }
  it('signup flag is passed through; demo is open unless the server says demo:false', async () => {
    const a = await serverWith({ signup: false, mail: true })
    expect(a).toMatchObject({ mode: 'server', mailReady: true, signupOpen: false, demoOpen: true })
    const c = await serverWith({ signup: true, demo: false })
    expect(c).toMatchObject({ mode: 'server', mailReady: false, signupOpen: true, demoOpen: false })
    const d = await serverWith({})
    expect(d.signupOpen).toBeUndefined()
    expect(d.demoOpen).toBe(true)
  })
  it('an unreachable or database-less server falls back to the demo store', async () => {
    expect((await serverWith({ db: false })).mode).toBe('demo')
  })
})

describe('demo logins', () => {
  it('astronaut 1..4 map to the crew; unknown crew falls back to 1', async () => {
    for (const c of CREW) {
      const u = await b.demoLogin('astronaut', c.id)
      expect(u).toMatchObject({ id: c.id, crewId: c.id, role: 'astronaut', context: 'space', username: c.username })
    }
    expect((await b.demoLogin('astronaut', 99)).crewId).toBe(1)
    expect((await b.demoLogin('astronaut')).crewId).toBe(1)
  })
  it('surgeon and ground have no crew of their own', async () => {
    expect(await b.demoLogin('surgeon')).toMatchObject({ role: 'surgeon', crewId: null, id: 101 })
    expect(await b.demoLogin('ground')).toMatchObject({ role: 'ground', crewId: null, id: 102 })
  })
  it('me() and logout() reflect the session', async () => {
    expect(await b.me()).toBeNull()
    await b.demoLogin('surgeon')
    expect((await b.me())?.role).toBe('surgeon')
    await b.logout()
    expect(await b.me()).toBeNull()
  })
  it('username login works for the crew and staff, and rejects unknown users and short passwords', async () => {
    expect((await b.login('Okafor', 'whatever1')).crewId).toBe(1)
    expect((await b.login('surgeon', 'abcd')).role).toBe('surgeon')
    expect(await status(b.login('nobody', 'abcdefgh'))).toBe(401)
    expect(await status(b.login('okafor', 'abc'))).toBe(401)
  })
})

describe('registration', () => {
  it('register -> code -> verify creates a member with the chosen context', async () => {
    for (const [i, ctx] of (['space', 'polar', 'home'] as const).entries()) {
      const email = `p${i}@x.org`
      const t = await b.register({ name: ' Pat ', email: ` ${email.toUpperCase()} `, password: 'password1', context: ctx, consent: true })
      expect(t).toMatchObject({ email, expiresIn: 900 })
      expect(t.demoCode).toMatch(/^\d{6}$/)
      const u = await b.verify(email, ` ${t.demoCode} `)
      expect(u).toMatchObject({ role: 'member', context: ctx, email, name: 'Pat' })
      expect(u.crewId).toBe(u.id)
      expect((await b.me())?.id).toBe(u.id)
      const m = await b.mission()
      expect(m.context).toBe(ctx)
      expect(m.day).toBe(1)
      expect(m.totalDays).toBeNull()
      await b.logout()
      expect((await b.login(email, 'password1')).id).toBe(u.id)
    }
  })

  it('validates input', async () => {
    const ok = { name: 'Ada', email: 'a@b.co', password: 'password1', context: 'home' as const, consent: true }
    expect(await status(b.register({ ...ok, email: 'nope' }))).toBe(400)
    expect(await status(b.register({ ...ok, name: ' A ' }))).toBe(400)
    expect(await status(b.register({ ...ok, password: 'short' }))).toBe(400)
    expect(await status(b.register({ ...ok, consent: false }))).toBe(400)
    await signUp('a@b.co')
    expect(await status(b.register(ok))).toBe(409)
  })

  it('wrong codes: counts tries down, locks after 5, and a new code is needed', async () => {
    const t = await b.register({ name: 'Ada', email: 'a@b.co', password: 'password1', context: 'home', consent: true })
    const wrong = t.demoCode === '000000' ? '111111' : '000000'
    await expect(b.verify('a@b.co', wrong)).rejects.toThrow(/4 tries left/)
    await expect(b.verify('a@b.co', wrong)).rejects.toThrow(/3 tries left/)
    for (let i = 0; i < 3; i++) await status(b.verify('a@b.co', wrong))
    expect(await status(b.verify('a@b.co', t.demoCode!))).toBe(429) // even the right code is refused now
    expect(await b.me()).toBeNull()
  })

  it('codes expire after 15 minutes', async () => {
    const t = await b.register({ name: 'Ada', email: 'a@b.co', password: 'password1', context: 'home', consent: true })
    advance(15 * 60000 + 1000)
    expect(await status(b.verify('a@b.co', t.demoCode!))).toBe(410)
  })

  it('a code works once', async () => {
    const t = await b.register({ name: 'Ada', email: 'a@b.co', password: 'password1', context: 'home', consent: true })
    await b.verify('a@b.co', t.demoCode!)
    expect(await status(b.verify('a@b.co', t.demoCode!))).toBe(410)
  })

  it('resend is blocked for a minute, then issues a fresh code that still completes the registration', async () => {
    const t = await b.register({ name: 'Ada', email: 'a@b.co', password: 'password1', context: 'polar', consent: true })
    expect(await status(b.resend('a@b.co', 'register'))).toBe(429)
    advance(59_000)
    expect(await status(b.resend('a@b.co', 'register'))).toBe(429)
    advance(2_000)
    const r = await b.resend('a@b.co', 'register')
    expect(r.demoCode).toMatch(/^\d{6}$/)
    const u = await b.verify('a@b.co', r.demoCode!)
    expect(u.context).toBe('polar')
    expect(t.email).toBe(r.email)
  })
})

describe('forgot and reset password', () => {
  it('unknown email gets no code (does not reveal who is registered)', async () => {
    const t = await b.forgot('ghost@x.org')
    expect(t.demoCode).toBeUndefined()
    expect(await status(b.reset('ghost@x.org', '123456', 'newpassword1'))).toBe(410)
  })
  it('known email: code resets the password; old password stops working', async () => {
    await signUp('a@b.co')
    await b.logout()
    const t = await b.forgot('a@b.co')
    expect(t.demoCode).toMatch(/^\d{6}$/)
    expect(await status(b.reset('a@b.co', t.demoCode!, 'short'))).toBe(400)
    const u = await b.reset('a@b.co', t.demoCode!, 'brandnew-pass')
    expect(u.email).toBe('a@b.co')
    await b.logout()
    expect(await status(b.login('a@b.co', 'password1'))).toBe(401)
    expect((await b.login('a@b.co', 'brandnew-pass')).email).toBe('a@b.co')
  })
  it('wrong reset codes are counted and the reset cooldown applies', async () => {
    await signUp('a@b.co')
    const t = await b.forgot('a@b.co')
    await expect(b.reset('a@b.co', t.demoCode === '000000' ? '111111' : '000000', 'brandnew-pass')).rejects.toThrow(/Wrong code/)
    expect(await status(b.forgot('a@b.co'))).toBe(429)
  })
  it('a registration code cannot be used to reset a password', async () => {
    const t = await b.register({ name: 'Ada', email: 'a@b.co', password: 'password1', context: 'home', consent: true })
    expect(await status(b.reset('a@b.co', t.demoCode!, 'brandnew-pass'))).toBe(410)
  })
})

describe('deleteAccount', () => {
  it('needs the right password', async () => {
    const u = await signUp('a@b.co')
    expect(await status(b.deleteAccount('wrongpass'))).toBe(401)
    expect((await b.me())?.id).toBe(u.id)
  })
  it('removes the person (login, rows, reports) and leaves everyone else untouched', async () => {
    const a = await signUp('a@b.co', 'home')
    await b.addMeasurements(a.crewId!, { hr: 70, sys: 120 }, 'manual', 'Self')
    await b.sendReport(a.crewId!, { overall: 'ok', score: 100, alerts: [], vitals: [] })
    await b.logout()
    const c = await signUp('c@d.co', 'polar')
    await b.addMeasurements(c.crewId!, { hr: 80 }, 'manual', 'Self')
    await b.sendReport(c.crewId!, { overall: 'ok', score: 100, alerts: [], vitals: [] })

    await b.logout()
    await b.login('a@b.co', 'password1')
    await b.deleteAccount('password1')
    expect(await b.me()).toBeNull()
    expect(await status(b.login('a@b.co', 'password1'))).toBe(401)

    await b.login('c@d.co', 'password1')
    expect((await b.measurements(c.crewId!)).map((m) => m.value)).toEqual([80])
    expect(await b.reports()).toHaveLength(1)
    // the deleted person's rows are gone from the store
    const raw = JSON.parse(localStorage.getItem('aura.demo.v3')!)
    expect(raw.extra.every((m: { crewId: number }) => m.crewId !== a.crewId)).toBe(true)
    expect(raw.reports.every((r: { crewId: number }) => r.crewId !== a.crewId)).toBe(true)
    expect(raw.members.map((m: { email: string }) => m.email)).toEqual(['c@d.co'])
  })
  it('imported-day bookkeeping is removed too, so the email can register again with a clean record', async () => {
    const a = await signUp('a@b.co', 'home')
    const d = new Date()
    const ld = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const dev = 'Galaxy Watch · Samsung Health'
    expect((await b.importMeasurements(a.crewId!, [{ metric: 'hr', value: 70, localDate: ld, at: new Date().toISOString() }], dev)).added).toBe(1)
    await b.deleteAccount('password1')
    const again = await signUp('a@b.co', 'home')
    const r = await b.importMeasurements(again.crewId!, [{ metric: 'hr', value: 71, localDate: ld, at: new Date().toISOString() }], dev)
    expect(r).toMatchObject({ added: 1, conflicts: 0, unchanged: 0 })
  })
  it('ids are never reused: a new member after a deletion cannot inherit a live member id', async () => {
    await signUp('one@x.org')
    await b.logout()
    const second = await signUp('two@x.org')
    await b.logout()
    await b.login('one@x.org', 'password1')
    await b.deleteAccount('password1')
    const third = await signUp('three@x.org')
    expect(new Set([second.id, third.id]).size).toBe(2)
    expect(third.crewId).not.toBe(second.crewId)
  })
  it('measurement row ids stay unique after rows were deleted with an account', async () => {
    const a = await signUp('a@b.co')
    await b.addMeasurements(a.crewId!, { hr: 70, sys: 120, dia: 80 }, 'manual', 'Self')
    await b.logout()
    const c = await signUp('c@d.co')
    await b.addMeasurements(c.crewId!, { hr: 71 }, 'manual', 'Self')
    await b.logout()
    await b.login('a@b.co', 'password1')
    await b.deleteAccount('password1')
    await b.login('c@d.co', 'password1')
    await b.addMeasurements(c.crewId!, { hr: 72 }, 'manual', 'Self')
    const ids = (await b.measurements(c.crewId!)).map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('privacy', () => {
  it('astronaut sees only their own crew entry; staff see the four simulated crew', async () => {
    await b.demoLogin('astronaut', 3)
    expect((await b.crew()).map((c) => c.id)).toEqual([3])
    await b.demoLogin('surgeon')
    expect((await b.crew()).map((c) => c.id)).toEqual([1, 2, 3, 4])
    await b.demoLogin('ground')
    expect((await b.crew()).map((c) => c.id)).toEqual([1, 2, 3, 4])
  })
  it('a member sees only themselves, never the simulated crew or other members', async () => {
    const a = await signUp('a@b.co')
    expect((await b.crew()).map((c) => c.id)).toEqual([a.crewId])
    await b.logout()
    const c = await signUp('c@d.co')
    expect((await b.crew()).map((x) => x.id)).toEqual([c.crewId])
  })
  it('self users cannot read or write another record', async () => {
    await b.demoLogin('astronaut', 1)
    expect(await status(b.measurements(2))).toBe(403)
    expect(await status(b.tasks(2))).toBe(403)
    expect(await status(b.toggleTask(2, 'bp'))).toBe(403)
    expect(await status(b.addMeasurements(2, { hr: 1 }, 'manual', 'x'))).toBe(403)
    expect(await status(b.sendReport(2, { overall: 'ok', score: 100, alerts: [], vitals: [] }))).toBe(403)
    expect((await b.measurements(1)).length).toBeGreaterThan(0)
    const m = await signUp('a@b.co')
    expect(await status(b.measurements(1))).toBe(403)
    expect(await status(b.measurements(m.crewId!))).toBe(0)
  })
  it('staff cannot read a registered member', async () => {
    const m = await signUp('a@b.co')
    await b.addMeasurements(m.crewId!, { hr: 70 }, 'manual', 'Self')
    await b.logout()
    await b.demoLogin('surgeon')
    expect(await status(b.measurements(m.crewId!))).toBe(403)
    expect(await status(b.tasks(m.crewId!))).toBe(403)
    await b.demoLogin('ground')
    expect(await status(b.measurements(m.crewId!))).toBe(403)
  })
  it('requests without a session are refused', async () => {
    expect(await status(b.measurements(1))).toBe(401)
  })
  it('ground gets no mood rows; surgeon and the person themselves do', async () => {
    await b.demoLogin('ground')
    const g = await b.measurements(2)
    expect(g.length).toBeGreaterThan(0)
    expect(g.some((m) => m.metric === 'mood')).toBe(false)
    await b.demoLogin('surgeon')
    expect((await b.measurements(2)).some((m) => m.metric === 'mood')).toBe(true)
    await b.demoLogin('astronaut', 2)
    expect((await b.measurements(2)).some((m) => m.metric === 'mood')).toBe(true)
  })
  it('measurements are returned oldest first and sinceDay filters', async () => {
    await b.demoLogin('astronaut', 1)
    const rows = await b.measurements(1, 140)
    expect(rows.every((r) => r.day >= 140)).toBe(true)
    expect([...rows].map((r) => r.at)).toEqual([...rows].map((r) => r.at).sort())
  })
  it('reports: surgeon lists only demo crew; members only their own; ground none; only the surgeon reviews', async () => {
    await b.demoLogin('astronaut', 2)
    const demoReport = await b.sendReport(2, { overall: 'crit', score: 40, alerts: [], vitals: [] })
    expect(demoReport).toMatchObject({ crewId: 2, crewName: 'Daniel Reyes', status: 'queued', day: 142 })
    const m = await signUp('a@b.co')
    advance(5)
    await b.sendReport(m.crewId!, { overall: 'ok', score: 100, alerts: [], vitals: [] })
    expect((await b.reports()).map((r) => r.crewId)).toEqual([m.crewId])
    await b.demoLogin('surgeon')
    expect((await b.reports()).map((r) => r.crewId)).toEqual([2])
    expect((await b.reports(1)).length).toBe(0)
    const reviewed = await b.reviewReport(demoReport.id, 'Rest and recheck')
    expect(reviewed).toMatchObject({ status: 'reviewed', reviewNote: 'Rest and recheck', reviewedBy: 'Dr. Selin Arslan' })
    await b.demoLogin('ground')
    expect(await b.reports()).toEqual([])
    expect(await status(b.reviewReport(demoReport.id, 'x'))).toBe(403)
    await b.demoLogin('astronaut', 2)
    expect(await status(b.reviewReport(demoReport.id, 'x'))).toBe(403)
  })
})

describe('tasks and streak', () => {
  it('each context gets its own task list', async () => {
    await b.demoLogin('astronaut', 1)
    expect((await b.tasks(1)).tasks.map((t) => t.id)).toEqual(TASKS_BY_CONTEXT.space.map((t) => t.id))
    for (const ctx of ['polar', 'home'] as const) {
      const m = await signUp(`${ctx}@x.org`, ctx)
      const { tasks, streak } = await b.tasks(m.crewId!)
      expect(tasks.map((t) => t.id)).toEqual(TASKS_BY_CONTEXT[ctx].map((t) => t.id))
      expect(tasks.every((t) => !t.done)).toBe(true)
      expect(streak).toBe(0)
      await b.logout()
    }
  })
  it('pre-done tasks and streaks come from the demo crew; completing every task adds one to the streak', async () => {
    await b.demoLogin('astronaut', 1)
    const start = await b.tasks(1)
    expect(start.tasks.filter((t) => t.done).map((t) => t.id)).toEqual(['bp', 'temp', 'mood'])
    expect(start.streak).toBe(12)
    let res = start
    for (const id of ['ared', 'vision', 'water']) res = await b.toggleTask(1, id)
    expect(res.tasks.every((t) => t.done)).toBe(true)
    expect(res.streak).toBe(13)
    res = await b.toggleTask(1, 'water')
    expect(res.tasks.find((t) => t.id === 'water')!.done).toBe(false)
    expect(res.streak).toBe(12)
    expect((await b.tasks(1)).streak).toBe(12)
  })
  it('toggling is per person and per day', async () => {
    await b.demoLogin('astronaut', 4)
    await b.toggleTask(4, 'bp')
    expect((await b.tasks(4)).tasks.find((t) => t.id === 'bp')!.done).toBe(true)
    await b.demoLogin('astronaut', 3)
    expect((await b.tasks(3)).tasks.find((t) => t.id === 'water')!.done).toBe(false)
    const m = await signUp('a@b.co', 'home')
    await b.toggleTask(m.crewId!, 'walk')
    expect((await b.tasks(m.crewId!)).tasks.find((t) => t.id === 'walk')!.done).toBe(true)
    advance(86400000) // next day: a fresh checklist
    expect((await b.tasks(m.crewId!)).tasks.every((t) => !t.done)).toBe(true)
  })
})

describe('addMeasurements', () => {
  it('astronauts write on mission day 142', async () => {
    await b.demoLogin('astronaut', 1)
    const rows = await b.addMeasurements(1, { sys: 150, dia: 95 }, 'manual', 'Omron')
    expect(rows).toHaveLength(2)
    expect(rows.every((r) => r.day === 142 && r.crewId === 1 && r.source === 'manual' && r.device === 'Omron')).toBe(true)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
    const all = await b.measurements(1)
    expect(all.filter((r) => r.metric === 'sys').at(-1)!.value).toBe(150)
  })
  it('members: day 1 on the day of registration, then counts calendar days', async () => {
    const m = await signUp('a@b.co', 'home')
    expect((await b.addMeasurements(m.crewId!, { hr: 70 }, 'manual', 'x'))[0].day).toBe(1)
    advance(86400000)
    expect((await b.addMeasurements(m.crewId!, { hr: 71 }, 'manual', 'x'))[0].day).toBe(2)
    advance(2 * 86400000)
    expect((await b.addMeasurements(m.crewId!, { hr: 72 }, 'manual', 'x'))[0].day).toBe(4)
    expect((await b.mission()).day).toBe(4)
  })
  it('a member starts with no measurements', async () => {
    const m = await signUp('a@b.co', 'polar')
    expect(await b.measurements(m.crewId!)).toEqual([])
  })
  it('only the person themselves can write', async () => {
    await b.demoLogin('surgeon')
    expect(await status(b.addMeasurements(1, { hr: 60 }, 'manual', 'x'))).toBe(403)
  })
})

describe('addMeasurements validation (demo store matches the server)', () => {
  it('rejects unknown metrics, non-numbers and out-of-range values, saving nothing', async () => {
    await b.demoLogin('astronaut', 1)
    const before = (await b.measurements(1)).length
    for (const bad of [{ hr: 9999 }, { hr: Number.NaN }, { nope: 1 }, { hr: 70, sys: 5 }, {}]) {
      await expect(b.addMeasurements(1, bad as never, 'manual', 'x')).rejects.toMatchObject({ status: 400 })
    }
    expect((await b.measurements(1)).length).toBe(before)
  })
})
