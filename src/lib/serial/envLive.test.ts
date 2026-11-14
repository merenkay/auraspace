import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readLocalHistory } from '../envStation'
import { setSerialApi } from './api'
import { EnvLiveStore, REMEMBER_KEY } from './envLive'
import { FakePort, FakeSerial } from './fake'

const SCOPE = { stationId: 'mission', userId: 1, serverMode: false }
const line = (t: number, h = 40, gas = 180) => `{"t":${t},"h":${h},"gas":${gas},"warm":0}\n`

async function until(cond: () => boolean, ms = 1500) {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

let mem: Map<string, string>
let serial: FakeSerial
let port: FakePort
let stores: EnvLiveStore[] = []

function newStore() {
  const s = new EnvLiveStore({ retryDelaysMs: [20, 40] })
  stores.push(s)
  return s
}

async function connected() {
  const s = newStore()
  s.setScope(SCOPE)
  await s.connect()
  await until(() => s.getSnapshot().connected)
  return s
}

beforeEach(() => {
  mem = new Map()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  }
  serial = new FakeSerial()
  port = new FakePort()
  serial.nextChoice = port
  setSerialApi(serial)
})

afterEach(async () => {
  for (const s of stores) {
    await s.disconnect().catch(() => undefined)
    s.conn.dispose()
  }
  stores = []
  setSerialApi(undefined)
})

describe('app-level serial store', () => {
  it('connects through the picker and joins lines split across chunks', async () => {
    const s = await connected()
    expect(serial.requests).toBe(1)
    const l = line(23.4)
    port.push(l.slice(0, 5))
    port.push(l.slice(5, 17))
    port.push(l.slice(17) + line(23.5).slice(0, 10))
    port.push(line(23.5).slice(10))
    await until(() => s.getSnapshot().samples.length === 2)
    const snap = s.getSnapshot()
    expect(snap.samples.map((x) => x.t)).toEqual([23.4, 23.5])
    expect(snap.conn.lineCount).toBe(2)
    expect(snap.status).toBe('live')
    expect(snap.latest?.t).toBe(23.5)
  })

  it('counts garbage lines as noise and never as readings', async () => {
    const s = await connected()
    port.push('\u0000ÿboot garbage\r\n}}{{\nhello world\n')
    port.push(line(22))
    await until(() => s.getSnapshot().samples.length === 1)
    expect(s.getSnapshot().noise).toBeGreaterThanOrEqual(2)
    expect(s.getSnapshot().samples[0].t).toBe(22)
  })

  it('recovers from framing / buffer-overrun errors without closing the port', async () => {
    const s = await connected()
    port.push(line(21))
    await until(() => s.getSnapshot().samples.length === 1)
    port.readError('BufferOverrunError')
    await until(() => s.getSnapshot().conn.recovered === 1)
    port.push(line(21.5))
    await until(() => s.getSnapshot().samples.length === 2)
    port.readError('FramingError')
    port.push(line(21.7))
    await until(() => s.getSnapshot().samples.length === 3)
    expect(port.opens).toBe(1)
    expect(port.closes).toBe(0)
    expect(s.getSnapshot().connected).toBe(true)
  })

  it('a view unmounting (page change) never closes the port; readings keep flowing with no subscriber', async () => {
    const s = await connected()
    const unsub = s.subscribe(() => undefined)
    port.push(line(22))
    await until(() => s.getSnapshot().samples.length === 1)
    unsub() // the Environment page unmounts
    port.push(line(22.1))
    port.push(line(22.2))
    await until(() => s.getSnapshot().samples.length === 3)
    expect(port.closes).toBe(0)
    expect(s.getSnapshot().connected).toBe(true)
  })

  it('StrictMode double effects: repeated setScope / subscribe open the port once', async () => {
    const s = newStore()
    s.setScope(SCOPE)
    s.setScope({ ...SCOPE })
    const a = s.subscribe(() => undefined)
    const b = s.subscribe(() => undefined)
    a()
    await s.connect()
    await s.connect() // a second click while open is ignored
    await until(() => s.getSnapshot().connected)
    b()
    expect(port.opens).toBe(1)
    expect(serial.requests).toBe(1)
  })

  it('USB unplug → reconnecting with back-off → re-plug reopens and readings continue', async () => {
    const s = await connected()
    port.push(line(22))
    await until(() => s.getSnapshot().samples.length === 1)
    port.unplug()
    await until(() => s.getSnapshot().status === 'reconnecting')
    expect(s.getSnapshot().message).toMatch(/attempt/)
    await new Promise((r) => setTimeout(r, 80)) // a few failed back-off attempts while unplugged
    expect(s.getSnapshot().status).toBe('reconnecting')
    port.plug()
    await until(() => s.getSnapshot().connected)
    port.push(line(22.3))
    await until(() => s.getSnapshot().samples.some((x) => x.t === 22.3))
    expect(port.opens).toBe(2)
    expect(serial.requests).toBe(1) // no new prompt
  })

  it('reconnects by polling getPorts even without a connect event', async () => {
    const s = await connected()
    port.unplug()
    await until(() => s.getSnapshot().status === 'reconnecting')
    port.plugged = true // replugged, but the event was missed
    await until(() => s.getSnapshot().connected, 2000)
    expect(port.opens).toBe(2)
  })

  it('explicit Disconnect closes the port, forgets the auto-reopen choice and stops reconnecting', async () => {
    const s = await connected()
    expect(mem.has(REMEMBER_KEY)).toBe(true)
    port.push(line(22))
    await until(() => s.getSnapshot().samples.length === 1)
    await s.disconnect()
    expect(port.closes).toBe(1)
    expect(port.isOpen).toBe(false)
    expect(s.getSnapshot().status).toBe('idle')
    expect(mem.has(REMEMBER_KEY)).toBe(false)
    port.unplug()
    port.plug()
    await new Promise((r) => setTimeout(r, 600))
    expect(port.opens).toBe(1)
  })

  it('records the partial 10-s bucket to local history when the link stops', async () => {
    const s = await connected()
    port.push(line(24) + line(24.2))
    await until(() => s.getSnapshot().samples.length === 2)
    await s.disconnect()
    const rows = readLocalHistory('mission')
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[rows.length - 1].t).toBeCloseTo(24.1)
    expect(s.getSnapshot().recorded).toBeGreaterThanOrEqual(1)
  })

  it('page reload: silently reopens a previously granted port with getPorts (no picker)', async () => {
    await connected()
    expect(JSON.parse(mem.get(REMEMBER_KEY)!).scope).toBe('mission')
    // "reload": a fresh store and a fresh port object for the same board; the browser lists it in getPorts
    const serial2 = new FakeSerial()
    const port2 = serial2.add(new FakePort())
    setSerialApi(serial2)
    const s2 = newStore()
    s2.setScope(SCOPE)
    await until(() => s2.getSnapshot().connected)
    expect(serial2.requests).toBe(0)
    expect(port2.opens).toBe(1)
    port2.push(line(25))
    await until(() => s2.getSnapshot().samples.length === 1)
  })

  it('a click on Connect while the reload auto-reopen is still pending ends open, not "reconnecting"', async () => {
    await connected()
    const serial2 = new FakeSerial()
    const port2 = serial2.add(new FakePort())
    serial2.nextChoice = port2
    let release: (v: FakePort[]) => void = () => undefined
    const slow = new FakeSerial()
    slow.getPorts = () => new Promise<FakePort[]>((r) => (release = r)) // the browser's getPorts() is slow
    setSerialApi(slow)
    const s2 = newStore()
    s2.setScope(SCOPE) // auto-reopen starts and waits on getPorts()
    setSerialApi(serial2)
    await s2.connect()
    await until(() => s2.getSnapshot().connected)
    release([]) // the stale getPorts() result arrives late
    await new Promise((r) => setTimeout(r, 120))
    expect(s2.getSnapshot().status).not.toBe('reconnecting')
    expect(s2.getSnapshot().connected).toBe(true)
    expect(port2.opens).toBe(1)
  })

  it('does not auto-reopen for another station (another person signed in)', async () => {
    await connected()
    const serial2 = new FakeSerial()
    const port2 = serial2.add(new FakePort())
    setSerialApi(serial2)
    const s2 = newStore()
    s2.setScope({ stationId: 'm1001', userId: 1001, serverMode: false })
    await new Promise((r) => setTimeout(r, 50))
    expect(port2.opens).toBe(0)
    expect(s2.getSnapshot().status).toBe('idle')
  })

  it('page reload with the board unplugged: waits, then opens it when plugged in', async () => {
    await connected()
    const serial2 = new FakeSerial()
    const port2 = serial2.add(new FakePort())
    port2.plugged = false
    setSerialApi(serial2)
    const s2 = newStore()
    s2.setScope(SCOPE)
    await until(() => s2.getSnapshot().status === 'reconnecting')
    port2.plug()
    await until(() => s2.getSnapshot().connected)
    expect(serial2.requests).toBe(0)
  })

  it('latches the live gas alarm with no page open', async () => {
    const s = await connected()
    s.setBaseline(180)
    port.push(line(22, 40, 180) + line(22, 40, 600) + line(22, 40, 610) + line(22, 40, 620))
    await until(() => s.getSnapshot().alarm != null)
    expect(s.getSnapshot().alarm?.endedAt).toBeNull()
    expect(s.getSnapshot().latest?.gasLevel).toBe('crit')
  })

  it('shows "unsupported" when the browser has no Web Serial', () => {
    setSerialApi(null)
    const s = newStore()
    expect(s.getSnapshot().status).toBe('unsupported')
    expect(s.getSnapshot().message).toMatch(/Chrome or Edge/)
  })

  it('a liveRow is a fresh 10-s summary of the stream', async () => {
    const s = await connected()
    port.push(line(31, 78) + line(32, 80))
    await until(() => s.getSnapshot().samples.length === 2)
    const r = s.liveRow()!
    expect(r.t).toBeCloseTo(31.5)
    expect(r.h).toBeCloseTo(79)
    expect(Date.now() - Date.parse(r.at)).toBeLessThan(1000)
  })
})
