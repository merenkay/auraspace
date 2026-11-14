// The sandbox with the real data layer (src/lib/api.ts): inside the tour the app must run on its in-browser
// demo store, on the tour's simulated data, without a single request to the server and without changing what
// the person had saved — even in a browser that normally talks to the real server.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backend } from '../api'
import { bootSandbox, type Sandbox } from './sandbox'
import { KEYS, MEMBER_DAYS, PERSONAS, userOf } from './seed'

class FakeStorage {
  data = new Map<string, string>()
  getItem(k: string) {
    return this.data.has(k) ? this.data.get(k)! : null
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v))
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
  clear() {
    this.data.clear()
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null
  }
  get length() {
    return this.data.size
  }
}

let local: FakeStorage
let session: FakeStorage
let server: ReturnType<typeof vi.fn>
let box: Sandbox
let before: Map<string, string>

async function backend(): Promise<Backend> {
  vi.resetModules()
  const mod = await import('../api')
  return mod.getBackend()
}

beforeEach(() => {
  class S extends FakeStorage {}
  for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) (S.prototype as unknown as Record<string, unknown>)[k] = FakeStorage.prototype[k]
  Object.defineProperty(S.prototype, 'length', Object.getOwnPropertyDescriptor(FakeStorage.prototype, 'length')!)
  local = new S()
  session = new S()
  // A browser that is signed in to the real server and has data of its own.
  local.setItem('aura.server.v1', JSON.stringify({ mail: true, signup: true, demo: true }))
  local.setItem('aura.coach.v1', JSON.stringify({ profiles: { 1: { focus: ['balance'] } }, logs: {} }))
  local.setItem('aura.open.v1', JSON.stringify({ 'coach.how-built': true }))
  before = new Map(local.data)
  // The real server would answer every request.
  server = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, db: true, mail: true }), text: async () => '{"ok":true,"db":true}' }))
  const win = { location: { search: '?demo=1', href: 'https://auraspace.space/?demo=1', pathname: '/' }, localStorage: local, sessionStorage: session, fetch: server }
  box = bootSandbox(win as unknown as Parameters<typeof bootSandbox>[0])!
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('fetch', (win as unknown as { fetch: typeof fetch }).fetch)
  vi.stubGlobal('setTimeout', (fn: () => void) => {
    queueMicrotask(fn)
    return 0
  })
})

afterEach(() => {
  box.uninstall()
  vi.unstubAllGlobals()
})

describe('the app inside the tour sandbox', () => {
  it('runs on the in-browser demo store although this browser normally uses the server', async () => {
    const b = await backend()
    expect(b.mode).toBe('demo')
    expect(server).not.toHaveBeenCalled()
    expect(box.blocked.map((r) => `${r.method} ${r.kind}`)).toEqual(['GET api'])
    expect(await b.me()).toMatchObject({ id: 1, role: 'astronaut', name: 'Mira Okafor' })
  })

  it('serves the simulated crew and the two simulated members, and keeps every write in memory', async () => {
    const b = await backend()

    // Okafor: the built-in simulated crew
    const okafor = await b.measurements(1)
    expect(okafor.length).toBeGreaterThan(1000)
    const added = await b.addMeasurements(1, { sys: 139, dia: 88 }, 'device', 'Omron BP monitor')
    expect(added).toHaveLength(2)
    expect((await b.measurements(1)).length).toBe(okafor.length + 2)
    await b.toggleTask(1, 'water')

    // switch persona the way the driver does: demo crew through demoLogin, members through the sandboxed store
    expect(await b.demoLogin('astronaut', 2)).toMatchObject({ id: 2, name: 'Daniel Reyes' })
    const store = JSON.parse(local.getItem(KEYS.store)!)
    local.setItem(KEYS.store, JSON.stringify({ ...store, user: userOf('home') }))
    expect(await b.me()).toMatchObject({ role: 'member', crewId: PERSONAS.home.crewId, context: 'home' })
    expect(await b.mission()).toMatchObject({ context: 'home', day: MEMBER_DAYS, profileId: 'home' })
    const home = await b.measurements(PERSONAS.home.crewId)
    expect(new Set(home.map((m) => m.metric))).toEqual(new Set(['sys', 'dia', 'hr', 'spo2', 'temp', 'glucose', 'sleep', 'mood', 'exercise', 'water']))
    const { tasks } = await b.tasks(PERSONAS.home.crewId)
    expect(tasks.filter((t) => t.done).map((t) => t.id)).toEqual(['bp', 'walk', 'mood'])
    // a member cannot read another record, exactly as outside the tour
    await expect(b.measurements(1)).rejects.toMatchObject({ status: 403 })

    // nothing was sent, and nothing the person had saved was read or changed
    expect(server).not.toHaveBeenCalled()
    expect(box.blocked.every((r) => r.method === 'GET')).toBe(true)
    expect(box.storage.writes()).toBeGreaterThan(3)
    expect(local.data).toEqual(before)
  })

  it('leaving puts the person’s own storage and the network back exactly as they were', async () => {
    const b = await backend()
    await b.addMeasurements(1, { hr: 70 }, 'manual', 'Manual entry')
    local.setItem('aura.open.v1', JSON.stringify({ 'coach.how-built': false, 'aura.sources': true }))
    box.uninstall()

    expect(local.data).toEqual(before)
    expect(JSON.parse(local.getItem('aura.coach.v1')!).profiles[1].focus).toEqual(['balance'])
    expect(JSON.parse(local.getItem('aura.open.v1')!)).toEqual({ 'coach.how-built': true })
    expect(local.getItem(KEYS.store)).toBeNull()

    // a fresh page load after leaving talks to the server again
    vi.stubGlobal('fetch', server)
    const real = await backend()
    expect(real.mode).toBe('server')
    expect(server).toHaveBeenCalledTimes(1)
  })
})
