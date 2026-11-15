// Layers of the AURA core: the dive maths and what each layer shows (never an invented value).
import { describe as suite, expect, it } from 'vitest'
import { generateMeasurements } from '../../../lib/demoData'
import { evaluate } from '../../../lib/health'
import type { Measurement } from '../../../lib/types'
import { geodesic, spread } from './geometry'
import { buildCoreData, cabinItems, cabinSlots, clampDepth, depthForZoom, diveByFactor, EMPTY_DATA, findItem, itemsOf, LAYERS, MAX_DEPTH, missionItem, nearestLayer, passFade, passFlash, systemItems, vitalItems, vitalSlots, zoomForDepth } from './layers'

suite('dive', () => {
  it('has four layers, outside to inside, each smaller and closer than the last', () => {
    expect(LAYERS.map((l) => l.id)).toEqual(['shell', 'vitals', 'systems', 'voice'])
    for (let i = 1; i < LAYERS.length; i++) {
      expect(LAYERS[i].radius).toBeLessThan(LAYERS[i - 1].radius)
      expect(LAYERS[i].zoom).toBeGreaterThan(LAYERS[i - 1].zoom)
    }
  })
  it('the layer in focus fills the view without leaving it', () => {
    for (const l of LAYERS) {
      expect(l.radius * l.zoom).toBeGreaterThan(1.15)
      expect(l.radius * l.zoom).toBeLessThanOrEqual(1.55)
    }
  })
  it('zoom grows steadily with depth and the two maps undo each other', () => {
    let last = 0
    for (let d = 0; d <= MAX_DEPTH; d += 0.25) {
      const z = zoomForDepth(d)
      expect(z).toBeGreaterThan(last)
      last = z
      expect(depthForZoom(z)).toBeCloseTo(d, 5)
    }
    expect(zoomForDepth(-2)).toBe(1)
    expect(zoomForDepth(99)).toBeCloseTo(LAYERS[MAX_DEPTH].zoom, 6)
    expect(depthForZoom(0.2)).toBe(0)
    expect(depthForZoom(50)).toBe(MAX_DEPTH)
    expect(clampDepth(Number.NaN)).toBe(0)
  })
  it('a factor below 1 dives in, above 1 backs out, and it stays inside the instrument', () => {
    expect(diveByFactor(1, 0.8)).toBeGreaterThan(1)
    expect(diveByFactor(1, 1.25)).toBeLessThan(1)
    expect(diveByFactor(0, 4)).toBe(0)
    expect(diveByFactor(MAX_DEPTH, 0.1)).toBe(MAX_DEPTH)
    expect(diveByFactor(1.4, 0)).toBe(1.4)
  })
  it('settles on the nearest layer when the input stops', () => {
    expect(nearestLayer(0.49)).toBe(0)
    expect(nearestLayer(0.51)).toBe(1)
    expect(nearestLayer(2.6)).toBe(3)
    expect(nearestLayer(7)).toBe(MAX_DEPTH)
  })
  it('the layer in focus and those inside it are fully drawn; a layer two steps behind is gone', () => {
    for (let i = 0; i <= MAX_DEPTH; i++) {
      const z = zoomForDepth(i)
      for (let j = 0; j <= MAX_DEPTH; j++) {
        const f = passFade(LAYERS[j].radius, z)
        if (j >= i) expect(f).toBe(1)
        if (j < i - 1) expect(f).toBeLessThan(0.2)
      }
    }
    expect(passFade(LAYERS[0].radius, zoomForDepth(2))).toBe(0)
  })
  it('the shell being crossed lights up half-way and is dark at every layer', () => {
    for (let i = 0; i <= MAX_DEPTH; i++) expect(passFlash(i)).toBeCloseTo(0, 6)
    expect(passFlash(0.5)).toBeCloseTo(1, 6)
    expect(passFlash(1.5)).toBeCloseTo(1, 6)
  })
})

suite('layer data', () => {
  const rows = generateMeasurements().filter((m) => m.crewId === 1) as unknown as Measurement[]
  const ev = evaluate(rows, { context: 'space', profileId: 'iss', day: 142 })
  it('an empty app draws empty layers and says so', () => {
    const d = buildCoreData({ ev: null, mission: null, cabin: null, live: false })
    expect(d).toEqual(EMPTY_DATA)
    expect(d.cabinEmpty).toMatch(/no cabin/i)
    expect(d.vitalsEmpty).toMatch(/no measurements/i)
    expect(itemsOf(d, 'voice')).toEqual([])
  })
  it('the mission dial is filled only when the mission has a planned length', () => {
    expect(missionItem({ name: 'Mars Transit', day: 142, totalDays: 210, delaySec: 840 })).toMatchObject({ fraction: 142 / 210, item: { value: 'Day 142 of 210', note: 'Signal delay: 14 min' } })
    const open = missionItem({ name: 'Home care', day: 12, totalDays: null, delaySec: null })
    expect(open.fraction).toBeNull()
    expect(open.item).toMatchObject({ value: 'Day 12', note: '' })
  })
  it('one arc per tracked vital: measured ones with their real value and status, the rest as no reading', () => {
    const items = vitalItems(ev)
    expect(items.length).toBe(ev.quality.items.length)
    expect(items.length).toBeGreaterThan(3)
    const bp = items.find((i) => i.key === 'bp')!
    expect(bp.value).toBe(ev.defByKey.bp!.display(ev.values))
    expect(bp.status).toBe(ev.vitalStatus.bp)
    expect(bp.fraction).toBeGreaterThan(0)
    expect(bp.fraction).toBeLessThan(1)
    const missing = items.filter((i) => i.status === 'none')
    expect(missing.length).toBe(ev.quality.missing)
    expect(vitalItems(null)).toEqual([])
    // nothing measured: every arc is "no reading", none is normal
    const blank = vitalItems(evaluate([], { context: 'home', profileId: 'home', day: 3 }))
    expect(blank.length).toBeGreaterThan(0)
    for (const m of blank) expect(m).toMatchObject({ status: 'none', value: '', fraction: null, note: 'Not measured yet' })
  })
  it('a body system without a current reading is "no data", never normal', () => {
    const items = systemItems(ev)
    expect(items.map((i) => i.key)).toEqual(ev.systems.map((s) => s.id))
    for (const it of items) {
      const id = it.key as keyof typeof ev.systemMeasured
      expect(it.status).toBe(ev.systemMeasured[id] ? ev.systemStatus[id] : 'none')
    }
    const blank = systemItems(evaluate([], { context: 'home', profileId: 'home', day: 3 }))
    expect(blank.length).toBeGreaterThan(0)
    for (const s of blank) expect(s.status).toBe('none')
  })
  it('cabin readings come with their source; none means none', () => {
    expect(cabinItems(null, false)).toEqual({ items: [], empty: 'No cabin readings' })
    const base = { context: 'space' as const, latestAt: 0, ageMs: 4 * 60_000, rows: 3 }
    expect(cabinItems({ ...base, quality: 'none', latest: null, factors: [] }, false).items).toEqual([])
    const c = cabinItems({ ...base, quality: 'fresh', latest: { t: 29.5, h: 40, ratio: 2.2 }, factors: [{ id: 'heat', level: 'warn', now: true, since: 0, lastAt: 0, peak: 29.5 }, { id: 'gas', level: 'alarm', now: true, since: 0, lastAt: 0, peak: 2.2 }] }, false)
    expect(c.items.map((i) => [i.key, i.status])).toEqual([['t', 'warn'], ['h', 'ok'], ['gas', 'crit']])
    expect(c.items[0].note).toMatch(/Stored reading · 4 min ago/)
    expect(cabinItems({ ...base, quality: 'fresh', latest: { t: 22, h: null, ratio: null }, factors: [] }, true).items[0].note).toMatch(/Live sensor kit/)
    // a factor that is no longer current does not colour the dial
    expect(cabinItems({ ...base, quality: 'fresh', latest: { t: 22, h: null, ratio: null }, factors: [{ id: 'heat', level: 'warn', now: false, since: 0, lastAt: 0, peak: 30 }] }, false).items[0].status).toBe('ok')
  })
  it('arcs share the orbit without overlapping, and items can be found by id', () => {
    const slots = vitalSlots(vitalItems(ev))
    for (let i = 0; i < slots.length; i++) {
      expect(slots[i].to).toBeGreaterThan(slots[i].from)
      if (i) expect(slots[i].from).toBeGreaterThan(slots[i - 1].to)
    }
    expect(slots[slots.length - 1].to).toBeLessThan(360)
    expect(vitalSlots([])).toEqual([])
    expect(cabinSlots([]).length).toBe(0)
    const d = buildCoreData({ ev, mission: { name: 'ISS', day: 142, totalDays: 180, delaySec: 0 }, cabin: null, live: false })
    expect(findItem(d, 'vital-bp')?.label).toBe('Blood pressure')
    expect(findItem(d, 'mission')?.layer).toBe('shell')
    expect(findItem(d, 'nope')).toBeNull()
    expect(findItem(d, null)).toBeNull()
  })
  it('named nodes sit on distinct, well spread lattice points', () => {
    const l = geodesic(3)
    const picked = spread(l.vertices, 12)
    expect(new Set(picked).size).toBe(12)
    for (let a = 0; a < picked.length; a++)
      for (let b = a + 1; b < picked.length; b++) {
        const [p, q] = [l.vertices[picked[a]], l.vertices[picked[b]]]
        expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeGreaterThan(0.7)
      }
    expect(spread(l.vertices, 0)).toEqual([])
  })
})
