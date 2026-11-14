import { describe, expect, it } from 'vitest'
import { CONTEXTS, contextOf, vitalFor, vitalsFor, type Context } from './contexts'
import { SYSTEMS } from './systems'
import { VITALS, type Values, type VitalKey } from './vitals'

const NORMAL: Values = { sys: 118, dia: 76, hr: 65, spo2: 98, temp: 36.7, glucose: 90, sleep: 7.5, mood: 4, exercise: 100, vision: 5, water: 2.8 }
const ev = (key: VitalKey, ctx: Context, patch: Partial<Values>) => vitalFor(key, ctx).evaluate({ ...NORMAL, ...patch })

describe('contextOf', () => {
  it('falls back to space for anything unknown', () => {
    expect(contextOf('polar')).toBe('polar')
    expect(contextOf('home')).toBe('home')
    expect(contextOf('space')).toBe('space')
    expect(contextOf('mars')).toBe('space')
    expect(contextOf(undefined)).toBe('space')
    expect(contextOf(null)).toBe('space')
  })
})

describe('hidden vitals and systems', () => {
  it('space shows everything', () => {
    expect(vitalsFor('space').map((v) => v.key)).toEqual(VITALS.map((v) => v.key))
    expect(CONTEXTS.space.hiddenSystems).toEqual([])
  })
  it('polar and home hide vision; radiation is hidden outside space', () => {
    for (const c of ['polar', 'home'] as const) {
      expect(vitalsFor(c).map((v) => v.key)).not.toContain('vision')
      expect(CONTEXTS[c].hiddenSystems).toContain('radiation')
    }
  })
  it('a system whose vitals are all hidden is hidden too (no permanent fake normal)', () => {
    for (const c of ['space', 'polar', 'home'] as const) {
      const shown = new Set(vitalsFor(c).map((v) => v.key))
      for (const s of SYSTEMS) {
        if (s.vitals.length === 0) continue
        if (s.vitals.every((k) => !shown.has(k))) expect(CONTEXTS[c].hiddenSystems, `${c}/${s.id}`).toContain(s.id)
      }
    }
  })
})

describe('exercise override (polar, home)', () => {
  for (const c of ['polar', 'home'] as const) {
    it(`${c}: 21 min a day, never urgent`, () => {
      expect(ev('exercise', c, { exercise: 20 })).toBe('warn')
      expect(ev('exercise', c, { exercise: 0 })).toBe('warn')
      expect(ev('exercise', c, { exercise: 21 })).toBe('ok')
      expect(ev('exercise', c, { exercise: 60 })).toBe('ok') // would be warn with the space rule
      expect(vitalFor('exercise', c).ranges).toMatch(/≥ 21 min/)
    })
  }
})

describe('water override (polar, home)', () => {
  for (const c of ['polar', 'home'] as const) {
    it(`${c}: ok at 2.0 L, warn from 1.2 L, crit below`, () => {
      expect(ev('water', c, { water: 1.1 })).toBe('crit')
      expect(ev('water', c, { water: 1.2 })).toBe('warn')
      expect(ev('water', c, { water: 1.9 })).toBe('warn')
      expect(ev('water', c, { water: 2 })).toBe('ok')
      expect(ev('water', c, { water: 2.2 })).toBe('ok') // would be warn in space
      expect(vitalFor('water', c).ranges).toMatch(/≥ 2\.0 L.*1\.2–1\.9 L.*< 1\.2 L/)
    })
  }
})

describe('sleep override (home)', () => {
  it('same cut-offs as space but sourced from CDC', () => {
    expect(ev('sleep', 'home', { sleep: 4.9 })).toBe('crit')
    expect(ev('sleep', 'home', { sleep: 5 })).toBe('warn')
    expect(ev('sleep', 'home', { sleep: 6.9 })).toBe('warn')
    expect(ev('sleep', 'home', { sleep: 7 })).toBe('ok')
    expect(vitalFor('sleep', 'home').source).toMatch(/^CDC:/)
    expect(vitalFor('sleep', 'space').source).toMatch(/NASA/)
  })
  it('polar keeps the space sleep rule', () => {
    expect(vitalFor('sleep', 'polar')).toBe(vitalFor('sleep', 'space'))
  })
})

describe('non-overridden vitals are identical across contexts', () => {
  it('bp, hr, spo2, temp, glucose, mood behave the same', () => {
    for (const k of ['bp', 'hr', 'spo2', 'temp', 'glucose', 'mood'] as const) {
      for (const c of ['polar', 'home'] as const) expect(vitalFor(k, c)).toBe(vitalFor(k, 'space'))
    }
  })
  it('overrides keep label, unit, fields and display', () => {
    const base = vitalFor('water', 'space')
    const o = vitalFor('water', 'home')
    expect(o.label).toBe(base.label)
    expect(o.unit).toBe(base.unit)
    expect(o.fields).toBe(base.fields)
    expect(o.display({ ...NORMAL, water: 1.234 })).toBe('1.2')
  })
})
