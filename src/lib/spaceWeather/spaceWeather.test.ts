import { describe, expect, it } from 'vitest'
import sample from '../../data/spaceweather/sample.json'
import may2024 from './__fixtures__/donki-may2024.json'
import { AURA_LIMITS, advisoryFor } from './advisory'
import { loadSpaceWeather, mergeMissing } from './client'
import { buildModel, condition, freshness, radiationStorm, recentEvents, STALE_MS } from './derive'
import { DRILL_EVENT, handleDrillEvent, isDrill, setDrill, subscribeDrill } from './drill'
import { flareInfo, flareRank, gFromKp, rFromFlare, scaleName, sFromFlux } from './explain'
import { noticeSummary, parseFlares, parseNotices, parseProtons, parseScales, parseSeps, parseStorms, parseTime } from './parse'
import { REF } from './refs'
import { sanitizeSource, SOURCE_KEYS } from './sanitize'
import type { Snapshot, SourceState } from './types'
import { upstreamUrls, windowFor } from './upstream'

const SAMPLE_AT = Date.parse(sample.capturedAt)
const sampleSnap = (): Snapshot => ({ origin: 'sample', receivedAt: sample.capturedAt, capturedAt: sample.capturedAt, sources: sample.sources as unknown as Snapshot['sources'] })
const st = (data: unknown, fetchedAt: string): SourceState => ({ ok: true, fetchedAt, error: null, data })

/** NOAA scales payload with the given current S/G and S1+ forecast chance. */
const scales = (s: string, g = '0', prob = '5') => ({
  '0': { DateStamp: '2026-11-14', TimeStamp: '16:31:00', R: { Scale: '0', Text: 'none' }, S: { Scale: s, Text: 'x', Prob: null }, G: { Scale: g, Text: 'x' } },
  '1': { DateStamp: '2026-11-14', TimeStamp: '16:31:00', R: { Scale: null, MinorProb: '20', MajorProb: '5' }, S: { Scale: null, Prob: prob }, G: { Scale: '0' } },
  '2': { DateStamp: '2026-11-15', TimeStamp: '00:00:00', R: { Scale: null, MinorProb: '35', MajorProb: '5' }, S: { Scale: null, Prob: '5' }, G: { Scale: '0' } },
})

describe('upstream', () => {
  it('asks DONKI for a 7-day UTC window without any key', () => {
    const t = Date.UTC(2026, 10, 14, 16, 0)
    expect(windowFor(t)).toEqual({ start: '2026-11-07', end: '2026-11-14' })
    const u = upstreamUrls(t)
    expect(u.flr).toBe('https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR?startDate=2026-11-07&endDate=2026-11-14')
    expect(u.notifications).toContain('type=all')
    for (const url of Object.values(u)) {
      expect(url.startsWith('https://')).toBe(true)
      expect(url).not.toMatch(/api_key|DEMO_KEY/i)
    }
  })
})

describe('sanitize (mirror of the PHP whitelist)', () => {
  it('keeps only known fields, bounds strings and refuses foreign links', () => {
    const out = sanitizeSource('flr', [
      { flrID: 'a', beginTime: '2026-11-07T12:26Z', classType: 'M1.2', link: 'https://evil.example/x', secret: 'drop me', note: 'x'.repeat(5000) },
      { flrID: 'b', beginTime: '2026-11-07T12:26Z', classType: 'M1.2', link: 'http://ccmc.gsfc.nasa.gov/DONKI/view/FLR/1/-1' },
      { flrID: 'c', beginTime: '2026-11-07T12:26Z', classType: 'M1.2'.repeat(10), link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/1/-1' },
    ]) as Record<string, unknown>[]
    expect(out[0]).toEqual({ flrID: 'a', beginTime: '2026-11-07T12:26Z', classType: 'M1.2', link: null })
    expect(out[1].link).toBeNull()
    expect(out[2].link).toBe('https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/1/-1')
    expect((out[2].classType as string).length).toBe(8)
  })
  it('rejects payloads with the wrong top-level shape', () => {
    expect(sanitizeSource('flr', { error: 'x' })).toBeNull()
    expect(sanitizeSource('scales', [1, 2])).toBeNull()
    expect(sanitizeSource('protons', 'nope')).toBeNull()
  })
  it('keeps only the ≥10 MeV proton channel', () => {
    const out = sanitizeSource('protons', [
      { time_tag: '2026-11-14T16:25:00Z', satellite: 18, flux: 0.2, energy: '>=10 MeV' },
      { time_tag: '2026-11-14T16:25:00Z', satellite: 18, flux: 0.4, energy: '>=1 MeV' },
    ]) as unknown[]
    expect(out).toHaveLength(1)
  })
  it('the bundled sample is already in whitelisted form', () => {
    for (const k of SOURCE_KEYS) {
      const s = (sample.sources as Record<string, { data: unknown }>)[k]
      expect(sanitizeSource(k, s.data)).toEqual(s.data)
    }
  })
})

describe('parsing real captured DONKI / NOAA payloads', () => {
  it('reads DONKI and NOAA time formats', () => {
    expect(parseTime('2026-11-07T12:43Z')).toBe(Date.UTC(2026, 10, 7, 12, 43))
    expect(parseTime('2026-11-14T16:25:00Z')).toBe(Date.UTC(2026, 10, 14, 16, 25))
    expect(parseTime('2026-11-14 05:03:51.727')).toBe(Date.UTC(2026, 10, 14, 5, 3, 51))
    expect(parseTime('yesterday')).toBeNull()
  })
  it('flares from the 14 Nov 2026 sample', () => {
    const f = parseFlares(sample.sources.flr.data)
    expect(f.length).toBe(7)
    expect(f.every((x) => x.cls && /^[ABCMX]/.test(x.cls))).toBe(true)
    expect(f[0].begin).toBeGreaterThanOrEqual(f[f.length - 1].begin)
    const m19 = f.find((x) => x.cls === 'M1.9')
    expect(m19?.region).toBe(14566)
  })
  it('SEP and geomagnetic storm records from May 2024', () => {
    const seps = parseSeps(may2024.sep)
    expect(seps).toHaveLength(3)
    expect(seps.at(-1)?.linked).toContain('2024-05-09T08:45:00-FLR-001')
    const g = parseStorms(may2024.gst)[0]
    expect(g.maxKp).toBe(9)
    expect(gFromKp(g.maxKp)).toBe(5)
  })
  it('notification summaries drop the header, links and disclaimer', () => {
    const n = parseNotices(may2024.notifications)[0]
    expect(n.type).toBe('SEP')
    expect(n.summary).not.toMatch(/##|Disclaimer|https?:\/\//)
    expect(n.summary.length).toBeGreaterThan(20)
    expect(noticeSummary('## Summary:\n\nLine one.\nhttps://x.nasa.gov/a\n\n## Notes:\nignored')).toBe('Line one.')
  })
  it('NOAA scales and protons', () => {
    const s = parseScales(sample.sources.scales.data)!
    expect(s.now?.s).toBe(0)
    expect(s.forecast.length).toBe(3)
    expect(s.forecast[0].sProb).toBe(5)
    const p = parseProtons(sample.sources.protons.data)
    expect(p.length).toBeGreaterThan(200)
    expect(p.every((x) => x.flux > 0)).toBe(true)
  })
})

describe('classes and scales', () => {
  it('flare classes follow NOAA flux levels and R thresholds', () => {
    expect(flareInfo('M1.9')).toMatchObject({ letter: 'M', magnitude: 1.9, r: 1 })
    expect(flareInfo('M1.9')!.peakWm2).toBeCloseTo(1.9e-5)
    expect(rFromFlare('M', 4.9)).toBe(1)
    expect(rFromFlare('M', 5)).toBe(2)
    expect(rFromFlare('X', 1)).toBe(3)
    expect(rFromFlare('X', 10)).toBe(4)
    expect(rFromFlare('X', 20)).toBe(5)
    expect(rFromFlare('C', 9.9)).toBe(0)
    expect(flareInfo('Q1')).toBeNull()
    expect(flareRank('X1.0')).toBeGreaterThan(flareRank('M9.9'))
    expect(flareInfo('C2.8')!.meaning).toMatch(/too weak to noticeably affect Earth/)
    expect(flareInfo('X1')!.sources).toContain(REF.nasaFlares)
  })
  it('S-scale from ≥10 MeV proton flux', () => {
    expect(sFromFlux(0.2)).toBe(0)
    expect(sFromFlux(9.99)).toBe(0)
    expect(sFromFlux(10)).toBe(1)
    expect(sFromFlux(100)).toBe(2)
    expect(sFromFlux(1000)).toBe(3)
    expect(sFromFlux(1e4)).toBe(4)
    expect(sFromFlux(1e5)).toBe(5)
    expect(sFromFlux(null)).toBeNull()
  })
  it('G-scale from Kp thirds (9- is still G4)', () => {
    expect(gFromKp(4.33)).toBe(0)
    expect(gFromKp(4.67)).toBe(1)
    expect(gFromKp(6.67)).toBe(3)
    expect(gFromKp(7.67)).toBe(4)
    expect(gFromKp(8.67)).toBe(4)
    expect(gFromKp(9)).toBe(5)
  })
  it('names', () => {
    expect(scaleName('S', 0)).toBe('none')
    expect(scaleName('S', 3)).toBe('S3 (Strong)')
    expect(scaleName('G', null)).toBe('unknown')
  })
})

describe('level derivation', () => {
  it('the captured quiet day: no radiation storm, M-class activity, events listed', () => {
    const m = buildModel(sampleSnap())
    const now = SAMPLE_AT + 5 * 60000
    const storm = radiationStorm(m, now)
    expect(storm).toMatchObject({ level: 0, basis: 'noaa-scale', status: 'ok', advisory: 'none', drill: false })
    const c = condition(m, now, storm)
    expect(c.topFlare?.cls).toBe('M1.9')
    expect(['quiet', 'active']).toContain(c.level)
    const { events, hiddenCmes } = recentEvents(m, now)
    expect(events.filter((e) => e.kind === 'flare')).toHaveLength(7)
    expect(hiddenCmes).toBeGreaterThan(0)
    expect(events.some((e) => e.kind === 'cme')).toBe(true)
  })
  it('NOAA S3 now → urgent, severe advisory with sourced EVA guidance', () => {
    const at = '2026-11-14T16:40:00Z'
    const m = buildModel({ origin: 'server', receivedAt: at, sources: { scales: st(scales('3'), at) } })
    const s = radiationStorm(m, Date.parse(at) + 60000)
    expect(s).toMatchObject({ level: 3, status: 'crit', advisory: 'severe' })
    const a = advisoryFor(s)!
    expect(a.tone).toBe('crit')
    expect(a.lines.some((l) => /Radiation hazard avoidance recommended for astronauts on EVA/.test(l.text))).toBe(true)
    expect(a.lines.some((l) => l.source === REF.ochmoShelter)).toBe(true)
    expect(a.limits).toBe(AURA_LIMITS)
    expect(a.limits).toMatch(/does not measure or estimate the radiation dose/)
  })
  it('fresh GOES flux above 100 pfu raises the level even before the NOAA scale updates', () => {
    const at = '2026-11-14T16:40:00Z'
    const t = Date.parse(at)
    const protons = [{ time_tag: '2026-11-14T16:35:00Z', flux: 150, energy: '>=10 MeV' }]
    const m = buildModel({ origin: 'server', receivedAt: at, sources: { scales: st(scales('0'), at), protons: st(protons, at) } })
    expect(radiationStorm(m, t)).toMatchObject({ level: 2, basis: 'goes-flux', status: 'warn', advisory: 'storm' })
    // the same reading an hour later no longer counts as "now"
    expect(radiationStorm(m, t + 60 * 60000)).toMatchObject({ level: 0, basis: 'noaa-scale' })
  })
  it('a DONKI SEP in the last 24 h means attention even at S0', () => {
    const at = '2024-05-10T20:00:00Z'
    const m = buildModel({ origin: 'server', receivedAt: at, sources: { scales: st(scales('0'), at), sep: st(may2024.sep, at) } })
    const s = radiationStorm(m, Date.parse(at))
    expect(s.recentSep?.id).toBe('2024-05-10T12:59:00-SEP-001')
    expect(s).toMatchObject({ status: 'warn', advisory: 'watch' })
    expect(advisoryFor(s)!.title).toMatch(/particle event/)
  })
  it('NOAA forecast chance at the demo threshold gives an info note, not an alarm', () => {
    const at = '2026-11-14T16:40:00Z'
    const m = buildModel({ origin: 'server', receivedAt: at, sources: { scales: st(scales('0', '0', '30'), at) } })
    const s = radiationStorm(m, Date.parse(at))
    expect(s).toMatchObject({ status: 'ok', advisory: 'watch', maxForecastProb: 30 })
    expect(advisoryFor(s)!.tone).toBe('info')
  })
})

describe('staleness', () => {
  it('an old copy is never shown as a current "normal"', () => {
    const m = buildModel(sampleSnap())
    const later = SAMPLE_AT + STALE_MS + 60000
    const f = freshness(m, later)
    expect(f.stale).toBe(true)
    expect(f.asOf).toBe(f.newest)
    const s = radiationStorm(m, later)
    expect(s.level).toBeNull()
    expect(s.status).toBeNull()
    expect(s.lastKnown).toBe(0)
    // the saved copy still lists its own 7 days
    expect(recentEvents(m, SAMPLE_AT + 30 * 86400000).events.length).toBeGreaterThan(0)
  })
  it('nothing at all → unknown, no data', () => {
    const m = buildModel({ origin: 'sample', receivedAt: '', sources: {} })
    const s = radiationStorm(m, Date.now())
    expect(s.status).toBeNull()
    expect(condition(m, Date.now(), s).level).toBe('unknown')
  })
})

describe('drill', () => {
  it('window event switches a clearly simulated S3 on and off', () => {
    const seen: boolean[] = []
    const off = subscribeDrill((v) => seen.push(v))
    handleDrillEvent(new CustomEvent(DRILL_EVENT, { detail: { on: true } }))
    expect(isDrill()).toBe(true)
    const m = buildModel(sampleSnap())
    const s = radiationStorm(m, SAMPLE_AT, { drill: true })
    expect(s).toMatchObject({ level: 3, basis: 'drill', status: 'crit', drill: true })
    const a = advisoryFor(s)!
    expect(a.title).toMatch(/^Drill — simulated/)
    expect(a.lead).toMatch(/practice alert/)
    const ev = recentEvents(m, SAMPLE_AT, 7, { drill: true }).events
    expect(ev[0]).toMatchObject({ kind: 'drill', simulated: true })
    handleDrillEvent(new CustomEvent(DRILL_EVENT, { detail: { on: false } }))
    expect(isDrill()).toBe(false)
    handleDrillEvent(new CustomEvent(DRILL_EVENT))
    expect(isDrill()).toBe(true)
    setDrill(false)
    off()
    expect(seen).toEqual([true, false, true, false])
  })
})

describe('loading order and offline fallback', () => {
  const ok = (data: unknown): SourceState => ({ ok: true, fetchedAt: '2026-11-14T16:40:00Z', error: null, data })
  const fail = (): SourceState => ({ ok: false, fetchedAt: null, error: 'Upstream unreachable', data: null })
  const now = () => Date.UTC(2026, 10, 14, 16, 45)

  it('server first; feeds the server lacks are asked directly', async () => {
    let asked: string[] = []
    const saved: Snapshot[] = []
    const s = await loadSpaceWeather({
      now,
      mode: async () => 'server',
      server: async () => ({ sources: { flr: ok(sample.sources.flr.data), sep: { ...fail(), status: 'error' } } }),
      direct: async (keys) => {
        asked = keys
        return Object.fromEntries(keys.map((k) => [k, k === 'scales' ? ok(sample.sources.scales.data) : fail()]))
      },
      cache: () => null,
      save: (x) => saved.push(x),
    })
    expect(s.origin).toBe('server')
    expect(asked).not.toContain('flr')
    expect(asked).toContain('sep')
    expect(s.sources.scales?.data).toBeTruthy()
    expect(s.sources.sep?.error).toBe('Upstream unreachable')
    expect(saved).toHaveLength(1)
  })
  it('API down → direct from NASA/NOAA', async () => {
    const s = await loadSpaceWeather({
      now,
      mode: async () => 'server',
      server: async () => {
        throw new Error('503')
      },
      direct: async (keys) => Object.fromEntries(keys.map((k) => [k, ok((sample.sources as Record<string, { data: unknown }>)[k].data)])),
      cache: () => null,
      save: () => undefined,
    })
    expect(s.origin).toBe('direct')
    expect(s.window).toEqual({ start: '2026-11-07', end: '2026-11-14' })
  })
  it('offline → last good copy on this device, then the bundled sample', async () => {
    const cached: Snapshot = { origin: 'direct', receivedAt: '2026-11-13T10:00:00Z', sources: { flr: ok(sample.sources.flr.data) } }
    const offline = { now, mode: async () => 'demo' as const, direct: async () => Promise.reject(new Error('offline')), save: () => undefined }
    expect((await loadSpaceWeather({ ...offline, cache: () => cached })).origin).toBe('cache')
    const s = await loadSpaceWeather({ ...offline, cache: () => null, sample: async () => sampleSnap() })
    expect(s.origin).toBe('sample')
    expect(s.capturedAt).toBe(sample.capturedAt)
  })
  it('a failed feed keeps the older copy from this device, with its own time', () => {
    const merged = mergeMissing({ flr: fail() }, { flr: { ...ok([]), fetchedAt: '2026-11-13T10:00:00Z' } })
    expect(merged.flr).toMatchObject({ ok: false, fetchedAt: '2026-11-13T10:00:00Z', error: 'Upstream unreachable', data: [] })
  })
})
