import { beforeEach, describe, expect, it } from 'vitest'
import {
  Downsampler,
  appendLocalHistory,
  evalGas,
  evalHum,
  evalTemp,
  parseLine,
  readLocalHistory,
  recentGas,
  LOCAL_HISTORY_MAX,
  type EnvRow,
} from '../../lib/envStation'

describe('parseLine', () => {
  it('reads the AURA sketch line', () => {
    expect(parseLine('{"t":23.4,"h":41.0,"gas":312,"warm":0}\r')).toEqual({ kind: 'sample', sample: { t: 23.4, h: 41, gas: 312, warm: 0 } })
  })
  it('keeps null for a failed sensor and ignores boot garbage around the JSON', () => {
    expect(parseLine('\u0000�{"t":null,"h":null,"gas":200}')).toEqual({ kind: 'sample', sample: { t: null, h: null, gas: 200 } })
  })
  it('understands key aliases and numeric strings', () => {
    expect(parseLine('{"temperature":"21.5","humidity":55,"mq2":120}')).toEqual({ kind: 'sample', sample: { t: 21.5, h: 55, gas: 120 } })
    expect(parseLine('{"temp":19,"hum":30,"smoke":99}')).toEqual({ kind: 'sample', sample: { t: 19, h: 30, gas: 99 } })
  })
  it('parses plain-text sketches and broken JSON with nan', () => {
    expect(parseLine('Humidity: 41.00%  Temperature: 23.40°C  Gas=300')).toEqual({ kind: 'sample', sample: { h: 41, t: 23.4, gas: 300 } })
    expect(parseLine('{"t":nan,"h":40,"gas":10}')).toEqual({ kind: 'sample', sample: { t: null, h: 40, gas: 10 } })
  })
  it('turns impossible values into null, never into a reading', () => {
    expect(parseLine('{"t":999,"h":-3,"gas":70000}')).toEqual({ kind: 'sample', sample: { t: null, h: null, gas: null } })
  })
  it('recognises the info line and noise', () => {
    const p = parseLine('{"hello":"aura-env","fw":1,"dht":"DHT11","gas_sensor":"MQ-2","gas_pin":"A0","warmup_s":120}')
    expect(p.kind).toBe('info')
    expect(parseLine('ets Jan  8 2013,rst cause')).toEqual({ kind: 'noise' })
    expect(parseLine('')).toEqual({ kind: 'noise' })
    expect(parseLine('{"t":2')).toEqual({ kind: 'sample', sample: { t: 2 } }) // a partial line still yields what is certain
  })
})

describe('rules', () => {
  it('uses the NASA cabin band for temperature and humidity', () => {
    expect(evalTemp(22).level).toBe('ok')
    expect(evalTemp(17.9).level).toBe('warn')
    expect(evalTemp(null).label).toBe('SENSOR ERROR')
    expect(evalHum(80).level).toBe('warn')
    expect(evalHum(undefined).label).toBe('NO DATA')
  })
  it('gas: no baseline, warm-up, attention and alarm', () => {
    expect(evalGas({ raw: 300, ratio: null, base: null, warm: 0 }).label).toBe('NO BASELINE')
    expect(evalGas({ raw: 300, ratio: 3, base: 100, warm: 30 }).label).toBe('WARMING UP')
    expect(evalGas({ raw: 150, ratio: 1.5, base: 100, warm: 0 }).level).toBe('warn')
    expect(evalGas({ raw: 200, ratio: 2, base: 100, warm: 0 }).level).toBe('crit')
    expect(evalGas({ raw: 120, ratio: 1.2, base: 100, warm: 0 }).level).toBe('ok')
  })
  it('gas median ignores a single spike', () => {
    const now = 10_000
    expect(recentGas([{ at: 8000, gas: 100 }, { at: 9000, gas: 900 }, { at: 10_000, gas: 110 }], now)).toBe(110)
  })
})

describe('Downsampler', () => {
  it('averages one row per 10-s bucket and keeps warm-up gas out', () => {
    const rows: EnvRow[] = []
    const d = new Downsampler((r) => rows.push(r))
    d.push({ at: 0, t: 20, h: 40, gas: 500, warm: 5 }, 100, 'x')
    d.push({ at: 1000, t: 22, h: null, gas: 100, warm: 0 }, 100, 'x')
    d.push({ at: 2000, t: null, h: 42, gas: 300, warm: 0 }, 100, 'x')
    d.push({ at: 10_000, t: 25, h: 50, gas: 100, warm: 0 }, 100, 'x') // closes the first bucket
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ at: new Date(0).toISOString(), t: 21, h: 41, gas: 200, gasMax: 300, base: 100, ratio: 3, n: 3 })
    d.flush()
    expect(rows).toHaveLength(2)
  })
})

describe('local ring buffer', () => {
  beforeEach(() => {
    const mem = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    }
  })
  it('de-duplicates and caps the history', () => {
    const row = (i: number): EnvRow => ({ at: new Date(i * 10_000).toISOString(), t: 20, h: 40, gas: 100, gasMax: 100, base: null, n: 10 })
    appendLocalHistory('test', [row(1), row(1), row(2)])
    expect(readLocalHistory('test')).toHaveLength(2)
    appendLocalHistory('test', Array.from({ length: LOCAL_HISTORY_MAX + 10 }, (_, i) => row(i + 3)))
    const all = readLocalHistory('test')
    expect(all).toHaveLength(LOCAL_HISTORY_MAX)
    expect(all[all.length - 1].at).toBe(row(LOCAL_HISTORY_MAX + 12).at)
  })
})
