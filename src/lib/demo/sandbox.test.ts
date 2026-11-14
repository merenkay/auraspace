import { describe, expect, it, vi } from 'vitest'
import { evaluate } from '../health'
import { MISSION } from '../demoData'
import { bootSandbox, guardFetch, isApiRequest, isExternalRequest, safeFrom, wantsDemo, type BlockedRequest } from './sandbox'
import { KEYS, MEMBER_DAYS, PERSONAS, buildSeed, memberMeasurements, userOf } from './seed'
import { installStorageOverlay, type StorageProto } from './storageOverlay'

/** A minimal Storage with its methods on the prototype, like the browser's. */
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

/** A fresh storage class per test, so patching one prototype cannot leak into another test. */
function storages() {
  class S extends FakeStorage {}
  // put the methods on S.prototype itself, as on Storage.prototype
  for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key'] as const) (S.prototype as unknown as Record<string, unknown>)[k] = FakeStorage.prototype[k]
  Object.defineProperty(S.prototype, 'length', Object.getOwnPropertyDescriptor(FakeStorage.prototype, 'length')!)
  return { proto: S.prototype as unknown as StorageProto, local: new S(), session: new S() }
}

describe('storage overlay', () => {
  it('serves reads and writes from memory and leaves the real store untouched', () => {
    const { proto, local } = storages()
    local.setItem('aura.demo.v3', '{"user":"real"}')
    local.setItem('aura.coach.v1', 'real coach')
    const before = new Map(local.data)

    const overlay = installStorageOverlay(proto, local, { 'aura.demo.v3': '{"user":"tour"}' })
    expect(local.getItem('aura.demo.v3')).toBe('{"user":"tour"}')
    expect(local.getItem('aura.coach.v1')).toBeNull() // the person's own data is not even readable inside the tour
    local.setItem('aura.coach.v1', 'tour coach')
    local.setItem('new.key', '1')
    local.removeItem('aura.demo.v3')
    expect(local.getItem('aura.coach.v1')).toBe('tour coach')
    expect(local.getItem('aura.demo.v3')).toBeNull()
    expect(local.length).toBe(2)
    expect(local.key(0)).toBe('aura.coach.v1')
    expect(overlay.writes()).toBe(3)
    expect(overlay.entries()).toEqual({ 'aura.coach.v1': 'tour coach', 'new.key': '1' })
    local.clear()
    expect(local.length).toBe(0)
    expect(local.data).toEqual(before) // nothing reached the real map

    overlay.uninstall()
    expect(local.getItem('aura.demo.v3')).toBe('{"user":"real"}')
    expect(local.getItem('aura.coach.v1')).toBe('real coach')
    expect(local.getItem('new.key')).toBeNull()
    expect(local.length).toBe(2)
    expect(local.data).toEqual(before)
  })

  it('does not touch other storage objects (sessionStorage)', () => {
    const { proto, local, session } = storages()
    const overlay = installStorageOverlay(proto, local)
    session.setItem('aura.demo.run', 'x')
    expect(session.getItem('aura.demo.run')).toBe('x')
    expect(session.data.get('aura.demo.run')).toBe('x')
    expect(session.length).toBe(1)
    session.removeItem('aura.demo.run')
    expect(session.data.size).toBe(0)
    overlay.uninstall()
    overlay.uninstall() // twice is harmless
    expect(proto.getItem).toBe(FakeStorage.prototype.getItem)
  })
})

describe('network guard', () => {
  const base = 'https://auraspace.space/crew/1'

  it('recognises requests to the backend and to other sites', () => {
    expect(isApiRequest('/api/index.php?r=health', base)).toBe(true)
    expect(isApiRequest('https://auraspace.space/api/index.php?r=measurements', base)).toBe(true)
    expect(isApiRequest('/models/body.glb', base)).toBe(false)
    expect(isApiRequest('https://example.org/api/x', base)).toBe(false)
    expect(isExternalRequest('https://api.nasa.gov/DONKI/notifications', base)).toBe(true)
    expect(isExternalRequest('/models/body-manifest.json', base)).toBe(false)
    expect(isExternalRequest('blob:https://auraspace.space/1', base)).toBe(false)
  })

  it('never sends a request to /api/ or another site, records it, and lets the app’s own files through', async () => {
    const sent: string[] = []
    const host = {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        sent.push(String(input))
        return new Response('ok')
      }) as unknown as typeof fetch,
    }
    const real = host.fetch
    const blocked: BlockedRequest[] = []
    const unguard = guardFetch(host, () => base, blocked)

    await expect(host.fetch('/api/index.php?r=measurements', { method: 'POST', body: '{}' })).rejects.toThrow(TypeError)
    await expect(host.fetch('/api/index.php?r=health')).rejects.toThrow(TypeError)
    await expect(host.fetch(new URL('https://services.swpc.noaa.gov/products/alerts.json'))).rejects.toThrow(TypeError)
    await expect(host.fetch('/models/body-manifest.json')).resolves.toBeInstanceOf(Response)

    expect(sent).toEqual(['/models/body-manifest.json'])
    expect(blocked.map((b) => [b.method, b.kind, b.url])).toEqual([
      ['POST', 'api', '/api/index.php?r=measurements'],
      ['GET', 'api', '/api/index.php?r=health'],
      ['GET', 'external', 'https://services.swpc.noaa.gov/products/alerts.json'],
    ])
    unguard()
    expect(host.fetch).toBe(real)
  })
})

describe('entering and leaving', () => {
  function fakeWindow(search: string, marker?: object) {
    const { proto, local, session } = storages()
    local.setItem('aura.demo.v3', JSON.stringify({ user: { id: 7, name: 'Real Person' }, extra: [{ id: 1 }] }))
    local.setItem('aura.server.v1', '{"mail":true,"demo":true}')
    local.setItem('aura.sfx.v1', '1')
    local.setItem('aura.voice.v1', JSON.stringify({ speak: true, wake: true, readConsult: true, rate: 1.2 }))
    if (marker) session.setItem('aura.demo.run', JSON.stringify(marker))
    void proto
    const fetchSpy = vi.fn(async () => new Response('{}'))
    const win = { location: { search, href: `https://auraspace.space/${search}`, pathname: '/' }, localStorage: local, sessionStorage: session, fetch: fetchSpy }
    return { win: win as unknown as Parameters<typeof bootSandbox>[0], local, session, fetchSpy }
  }

  it('does nothing on a normal page load', () => {
    const { win, local } = fakeWindow('')
    expect(bootSandbox(win)).toBeNull()
    expect(JSON.parse(local.getItem(KEYS.store)!).user.name).toBe('Real Person')
  })

  it('?demo=1 starts the tour on simulated data; the server is unreachable and the app falls back to its demo store', async () => {
    const { win, local, session, fetchSpy } = fakeWindow('?demo=1')
    const real = new Map(local.data)
    const box = bootSandbox(win)!
    expect(box).not.toBeNull()
    expect(bootSandbox(win)).toBe(box) // installing twice is the same sandbox

    // what the app sees
    const store = JSON.parse(local.getItem(KEYS.store)!)
    expect(store.user).toMatchObject({ id: 1, role: 'astronaut', name: 'Mira Okafor' })
    expect(store.members.map((m: { name: string }) => m.name)).toEqual([PERSONAS.polar.name, PERSONAS.home.name])
    expect(local.getItem('aura.server.v1')).toBeNull() // so getBackend() picks the in-browser demo store
    expect(local.getItem(KEYS.sfx)).toBe('1') // the person's sound choice is kept
    expect(JSON.parse(local.getItem(KEYS.voice)!)).toMatchObject({ speak: true, rate: 1.2, wake: false, readConsult: false }) // the microphone stays closed
    await expect(win.fetch('/api/index.php?r=health')).rejects.toThrow()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(box.blocked).toHaveLength(1)

    // the app writes; nothing reaches the real store
    local.setItem(KEYS.store, JSON.stringify({ ...store, extra: [] }))
    local.setItem('aura.coach.v1', '{"profiles":{}}')
    expect(local.data).toEqual(real)
    expect(JSON.parse(session.getItem('aura.demo.run')!)).toMatchObject({ from: '/', chapter: 0 })

    // leaving: everything is as before
    box.uninstall()
    expect(local.data).toEqual(real)
    expect(JSON.parse(local.getItem(KEYS.store)!).user.name).toBe('Real Person')
    expect(local.getItem('aura.coach.v1')).toBeNull()
    await win.fetch('/api/index.php?r=health')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('resumes in the same tab after a reload, at the chapter it was in, and remembers where to return to', () => {
    const { win } = fakeWindow('', { from: '/crew/7/coach', at: Date.now(), chapter: 4 })
    const box = bootSandbox(win)!
    expect(box).toMatchObject({ from: '/crew/7/coach', chapter: 4 })
    box.uninstall()
  })

  it('an address that asks for the tour starts from the beginning; a stale marker is ignored', () => {
    const a = fakeWindow('?demo=1', { from: '/login', at: Date.now(), chapter: 5 })
    const box = bootSandbox(a.win)!
    expect(box).toMatchObject({ from: '/login', chapter: 0 })
    box.uninstall()

    const b = fakeWindow('', { from: '/login', at: Date.now() - 7 * 3600_000, chapter: 5 })
    expect(bootSandbox(b.win)).toBeNull()
    expect(b.session.getItem('aura.demo.run')).toBeNull()
  })

  it('only accepts a same-site return address that does not start the tour again', () => {
    expect(wantsDemo('?demo=1')).toBe(true)
    expect(wantsDemo('?demo=0&x=1')).toBe(false)
    expect(safeFrom('/crew/1/history')).toBe('/crew/1/history')
    expect(safeFrom('/?demo=1')).toBe('/')
    expect(safeFrom('/login?kit&demo=1')).toBe('/login?kit=')
    expect(safeFrom('//evil.example/x')).toBe('/')
    expect(safeFrom('https://evil.example/x')).toBe('/')
    expect(safeFrom(undefined)).toBe('/')
  })
})

describe('tour data', () => {
  const now = new Date('2026-11-14T12:00:00')
  const rows = memberMeasurements(now)
  const of = (who: 'polar' | 'home') => rows.filter((r) => r.crewId === PERSONAS[who].crewId)

  it('gives the two simulated members a full history that ends today', () => {
    for (const who of ['polar', 'home'] as const) {
      const r = of(who)
      expect(Math.min(...r.map((x) => x.day))).toBe(1)
      expect(Math.max(...r.map((x) => x.day))).toBe(MEMBER_DAYS)
      expect(r.some((x) => x.metric === 'vision')).toBe(false)
      expect(new Set(r.map((x) => x.id)).size).toBe(r.length)
    }
    const seed = buildSeed(now)
    const store = JSON.parse(seed[KEYS.store])
    expect(store.extra).toHaveLength(rows.length)
    // the store's own day arithmetic (src/lib/api.ts memberDay) must land on MEMBER_DAYS
    const start = new Date(store.members[0].createdAt)
    start.setHours(0, 0, 0, 0)
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    expect(Math.round((today.getTime() - start.getTime()) / 86400000) + 1).toBe(MEMBER_DAYS)
  })

  it('tells the stories the tour narrates, through the app’s own rules', () => {
    const polar = evaluate(of('polar'), { context: 'polar', profileId: 'polar', day: MEMBER_DAYS })
    expect(polar.overall).toBe('crit')
    expect(polar.alerts.map((a) => a.key).sort()).toEqual(['mood', 'sleep'])

    const home = evaluate(of('home'), { context: 'home', profileId: 'home', day: MEMBER_DAYS })
    expect(home.overall).toBe('warn')
    expect(home.alerts.map((a) => a.key).sort()).toEqual(['bp', 'water'])
  })

  it('builds the same user objects the demo store would', () => {
    expect(userOf('okafor')).toEqual({ id: 1, username: 'okafor', role: 'astronaut', name: 'Mira Okafor', title: 'Commander · CDR', crewId: 1, context: 'space' })
    expect(userOf('home')).toMatchObject({ id: 2002, role: 'member', crewId: 2002, context: 'home', title: 'Home care' })
    expect(MISSION.day).toBeGreaterThan(MEMBER_DAYS)
  })
})
