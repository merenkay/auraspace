// User contexts: the same self-monitoring tool for space crews, polar/remote station crews and older adults at home.
import kb from './contexts-kb.json'
import { SYSTEM_BY_ID, type SystemId } from './systems'
import { VITALS, VITAL_BY_KEY, type VitalDef, type VitalKey } from './vitals'

export type Context = 'space' | 'polar' | 'home'

type Source = { title: string; org: string; url: string }
type KbSystem = { text: string; quote: string; source: Source }

export type ContextDef = {
  id: Context
  label: string
  icon: string
  blurb: string
  contact: string // who reviews findings
  reportButton: string
  envTitle: string
  impactHeading: string // "How space affects it"
  activityTab: string
  hiddenVitals: VitalKey[]
  hiddenSystems: SystemId[]
}

export const CONTEXTS: Record<Context, ContextDef> = {
  space: {
    id: 'space',
    label: 'Space crew',
    icon: '🚀',
    blurb: 'Long missions on a station, spacecraft or planetary base.',
    contact: 'flight surgeon',
    reportButton: 'Send report to flight surgeon',
    envTitle: 'Mission environment',
    impactHeading: 'How space affects it',
    activityTab: 'Coach',
    hiddenVitals: [],
    hiddenSystems: [],
  },
  polar: {
    id: 'polar',
    label: 'Polar & remote station',
    icon: '🧊',
    blurb: 'Antarctic and other remote stations: isolation, darkness, cold and altitude.',
    contact: 'station doctor',
    reportButton: 'Send report to station doctor',
    envTitle: 'Station conditions',
    impactHeading: 'At a remote station',
    activityTab: 'Activity',
    hiddenVitals: ['vision'],
    hiddenSystems: ['radiation'],
  },
  home: {
    id: 'home',
    label: 'Home care',
    icon: '🏡',
    blurb: 'Older adults living at home, with family or a caregiver nearby.',
    contact: 'doctor or caregiver',
    reportButton: 'Prepare report for my doctor',
    envTitle: 'Home conditions',
    impactHeading: 'In later life at home',
    activityTab: 'Activity',
    hiddenVitals: ['vision'],
    hiddenSystems: ['radiation', 'eyes'],
  },
}

export const CONTEXT_LIST = [CONTEXTS.space, CONTEXTS.polar, CONTEXTS.home]

export function contextOf(value: unknown): Context {
  return value === 'polar' || value === 'home' ? value : 'space'
}

const T = kb.thresholds

/** Thresholds that differ by context. Space uses NASA figures; polar/home use WHO and EFSA. */
const OVERRIDES: Record<Exclude<Context, 'space'>, Partial<Record<VitalKey, Partial<VitalDef>>>> = {
  polar: {
    exercise: {
      evaluate: (v) => (v.exercise < 21 ? 'warn' : 'ok'),
      ranges: 'On target ≥ 21 min/day (≈ 150 min per week) · Below target < 21 min',
      howTo: 'Count brisk walking, skiing, gym or cycling. Aim for about 150 minutes a week, plus strength work on 2 days.',
      source: `${T.activity.source.org}: ${T.activity.quote}`,
    },
    water: {
      evaluate: (v) => (v.water < 1.2 ? 'crit' : v.water < 2 ? 'warn' : 'ok'),
      ranges: 'On target ≥ 2.0 L · Low 1.2–1.9 L · Alert < 1.2 L (lower cut-offs are demo values)',
      howTo: 'Count drinks. Cold, dry air at stations increases fluid loss.',
      source: `EFSA adequate intake: ${T.water.womenL} L/day women, ${T.water.menL} L/day men (includes water from food)`,
    },
  },
  home: {
    exercise: {
      evaluate: (v) => (v.exercise < 21 ? 'warn' : 'ok'),
      ranges: 'On target ≥ 21 min/day (≈ 150 min per week) · Below target < 21 min',
      howTo: 'Walking, gardening, dancing or chair exercises all count. Add balance and strength activities on 2 or more days.',
      source: `${T.activity.source.org}: ${T.activity.quote}`,
    },
    water: {
      evaluate: (v) => (v.water < 1.2 ? 'crit' : v.water < 2 ? 'warn' : 'ok'),
      ranges: 'On target ≥ 2.0 L · Low 1.2–1.9 L · Alert < 1.2 L (lower cut-offs are demo values)',
      howTo: 'Count drinks through the day. Pale urine is a simple sign you are drinking enough.',
      source: `EFSA adequate intake: ${T.water.womenL} L/day women, ${T.water.menL} L/day men (includes water from food)`,
    },
    sleep: {
      evaluate: (v) => (v.sleep < 5 ? 'crit' : v.sleep < 7 ? 'warn' : 'ok'),
      ranges: 'Good ≥ 7 h · Short 5–6.9 h · Alert < 5 h',
      source: `CDC: ${T.sleepOlder.quote}`,
    },
  },
}

export function vitalFor(key: VitalKey, ctx: Context): VitalDef {
  const base = VITAL_BY_KEY[key]
  if (ctx === 'space') return base
  const o = OVERRIDES[ctx][key]
  return o ? { ...base, ...o } : base
}

export function vitalsFor(ctx: Context): VitalDef[] {
  const hidden = CONTEXTS[ctx].hiddenVitals
  return VITALS.filter((d) => !hidden.includes(d.key)).map((d) => vitalFor(d.key, ctx))
}

/** Context-specific explanation of a body system, with its source. */
export function impactOf(id: SystemId, ctx: Context): { heading: string; text: string; source: Source | null } {
  const sys = SYSTEM_BY_ID[id]
  if (ctx === 'space') return { heading: CONTEXTS.space.impactHeading, text: sys.space, source: { title: sys.sourceLabel, org: 'NASA', url: sys.sourceUrl } }
  const systems = kb[ctx].systems as Partial<Record<string, KbSystem>>
  const hit = systems[id]
  if (hit) return { heading: CONTEXTS[ctx].impactHeading, text: hit.text, source: hit.source }
  return { heading: 'What it does', text: sys.fn, source: null }
}

export function contextFacts(ctx: Exclude<Context, 'space'>) {
  return { headline: kb[ctx].headline, facts: kb[ctx].facts as { text: string; quote: string; source: Source }[] }
}

export const THRESHOLD_SOURCES = T
