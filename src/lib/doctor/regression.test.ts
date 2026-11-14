// Growing the knowledge base must never make an emergency that fired before quieter, nor change which condition
// leads it. urgencySnapshot.json was recorded from the 26-condition catalogue BEFORE the 2026-11 extension (every
// single finding and every pair of findings, in every context, plus readings that trigger reading rules).
// After any catalogue change: urgency is the same or higher for every combination, and every former emergency is
// still an emergency led by the same condition. One documented exception: "see a professional soon" that was only
// given because NO condition matched may become self-care when a newly added, sourced condition now explains every
// reported symptom (e.g. a plain headache -> tension-type headache, NHS self-care). Urgent and emergency results are
// never lowered. To re-record (only when a reviewed change is intended):
//   AURA_SNAPSHOT=1 AURA_SNAPSHOT_FINDINGS='[...finding ids]' npx vitest run src/lib/doctor/regression.test.ts
import { describe, expect, it } from 'vitest'
import { URGENCY_RANK, type Urgency } from '../../data/conditions'
import { emptyProfile } from '../../data/conditions/profile'
import { assess, type Answers, type Readings } from './engine'
import recorded from './urgencySnapshot.json'

/** The 26 conditions the snapshot was recorded with. */
const ORIGINAL = new Set(['heart-attack', 'stroke', 'anaphylaxis', 'hypoglycaemia', 'hypertensive-crisis', 'panic-attack', 'asthma-attack', 'sepsis', 'fever-infection', 'heat-illness', 'fall-fracture', 'dehydration', 'hypothermia', 'frostbite', 'altitude-sickness', 'carbon-monoxide', 'seasonal-low-mood', 'sleep-loss', 'space-motion-sickness', 'sans-vision', 'renal-stone', 'co2-exposure', 'decompression-sickness', 'space-back-pain', 'behavioural-health', 'suicidal-thoughts'])

type Snapshot = { findings: string[]; readings: string[]; urg: string; lead: Record<string, string> }

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const NOW = Date.parse('2026-11-14T12:00:00Z')
const AT = '2026-11-14T08:00:00Z'
const READINGS: Record<string, Readings> = {
  none: {},
  'bp-crisis': { sys: { value: 186, at: AT }, dia: { value: 122, at: AT } },
  'glucose-low': { glucose: { value: 60, at: AT } },
  'temp-high': { temp: { value: 38.9, at: AT } },
  'temp-low': { temp: { value: 34.5, at: AT } },
}
const RANK_OF = ['selfcare', 'soon', 'urgent', 'emergency'] as Urgency[]

/** Every combination, in a fixed order: context x readings x (each finding alone, then each pair). */
function* combos(findings: string[], readings: string[]) {
  for (const context of ['space', 'polar', 'home'] as const)
    for (const r of readings) {
      const sets: string[][] = findings.map((f) => [f])
      if (r === 'none') for (let i = 0; i < findings.length; i++) for (let j = i + 1; j < findings.length; j++) sets.push([findings[i], findings[j]])
      for (const s of sets) yield { context, r, ids: s }
    }
}

function run(findings: string[], readings: string[]) {
  let urg = ''
  const lead: Record<string, string> = {}
  const explained: boolean[] = []
  let n = 0
  for (const c of combos(findings, readings)) {
    const answers: Answers = Object.fromEntries(c.ids.map((id) => [id, 'yes']))
    const a = assess({ answers, context: c.context, readings: READINGS[c.r], profile: { ...emptyProfile(), updatedAt: AT }, now: NOW })
    urg += String(URGENCY_RANK[a.urgency])
    if (a.urgency === 'emergency') lead[n] = a.candidates[0]?.condition.id ?? ''
    const top = a.candidates.find((x) => x.strength !== 'weak')
    explained.push(!!top && !ORIGINAL.has(top.condition.id) && top.strength !== 'weak' && c.ids.every((id) => top.condition.findings.some((f) => f.id === id)))
    n++
  }
  return { urg, lead, explained }
}

describe('knowledge-base growth never demotes an emergency', () => {
  if (ENV.AURA_SNAPSHOT === '1') {
    it('records the snapshot', async () => {
      const findings = JSON.parse(ENV.AURA_SNAPSHOT_FINDINGS ?? 'null') as string[] | null
      if (!findings) throw new Error('set AURA_SNAPSHOT_FINDINGS to the JSON list of finding ids to record')
      const readings = Object.keys(READINGS)
      const { urg, lead } = run(findings, readings)
      const snap: Snapshot = { findings, readings, urg, lead }
      const fs = (await import('node:fs' as string)) as { writeFileSync: (f: URL, d: string) => void }
      fs.writeFileSync(new URL('./urgencySnapshot.json', import.meta.url), JSON.stringify(snap))
      expect(urg.length).toBeGreaterThan(1000)
    })
    return
  }
  const snap = recorded as Snapshot
  it('covers thousands of combinations', () => {
    expect(snap.urg.length).toBeGreaterThan(7000)
    expect(Object.keys(snap.lead).length).toBeGreaterThan(500)
  })
  it('urgency is unchanged or higher, and former emergencies keep their emergency and lead condition', () => {
    const now = run(snap.findings, snap.readings)
    const list = [...combos(snap.findings, snap.readings)]
    const lower: string[] = []
    const leadChanged: string[] = []
    let newlyExplained = 0
    for (let i = 0; i < snap.urg.length; i++) {
      const before = Number(snap.urg[i])
      const after = Number(now.urg[i])
      const c = list[i]
      const what = `${c.context} ${c.r} ${c.ids.join('+')}: ${RANK_OF[before]} -> ${RANK_OF[after]}`
      if (after === 0 && before === 1 && now.explained[i]) newlyExplained++
      else if (after < before) lower.push(what)
      if (before === 3 && now.lead[i] !== snap.lead[i]) leadChanged.push(`${what} lead ${snap.lead[i]} -> ${now.lead[i]}`)
    }
    expect(lower, lower.slice(0, 10).join('\n')).toEqual([])
    expect(leadChanged, leadChanged.slice(0, 10).join('\n')).toEqual([])
    // the exception stays small and visible
    expect(newlyExplained).toBeLessThan(snap.urg.length * 0.02)
  })
})
