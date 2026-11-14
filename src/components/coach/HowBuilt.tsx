// "How this plan was built": the sourced rules behind this programme, then AURA's own modelling choices.
import { COACH_RULES, ruleSource, type CoachRuleId } from '../../data/coach/sources'
import { Badge, Disclosure, SourceLink } from '../ui'

const AURA_RULES = [
  'Weekly split: each focus area sets a minimum number of strength, aerobic and balance days; the plan takes the highest of your focus areas and fits them into your days.',
  'Your fitness level picks the starting exercise on each ladder (easiest, middle or hardest that your equipment allows) and the effort band: just starting 5–6, some activity 6–7, regular training 7–8 of 10.',
  'Session time: 5-minute warm-up and cool-down, about 4 minutes per strength exercise including rest, aerobic bouts of at least 10 minutes.',
  'Progression: after two sessions in a row at effort 6 or less with no pain, add repetitions, then a set (up to 3), then the next exercise on the ladder. The block plans no step in week 1, one in week 2, two in week 3 and holds in week 4.',
  'Regression: pain, or effort 9–10, makes the next session one step easier. Pain twice in a row: talk to your care contact.',
  'An active caution pauses all progression: a step up becomes a suggestion for your care contact. Loads on machines and weights are never raised by AURA.',
]

export function HowBuilt({ rules }: { rules: CoachRuleId[] }) {
  const list = [...new Set(rules)].filter((r) => COACH_RULES[r])
  return (
    <Disclosure id="coach.how-built" title="How this plan was built" meta={`${list.length} sources · ${AURA_RULES.length} AURA rules`}>
      <h3 className="text-[15px] font-semibold text-ink">Guidance behind your plan</h3>
      <ul className="mt-2 divide-y divide-line">
        {list.map((id) => {
          const r = COACH_RULES[id]
          const s = ruleSource(id)
          return (
            <li key={id} className="py-3">
              <p className="text-[15px] text-ink">{r.t}</p>
              <p className="mt-1 text-sm italic text-dim">“{r.q}”</p>
              <SourceLink className="mt-1" href={s.url} org={s.org} title={s.title} />
            </li>
          )
        })}
      </ul>
      <h3 className="mt-6 text-[15px] font-semibold text-ink">AURA’s own rules</h3>
      <p className="mt-1 text-sm text-dim">These are AURA’s modelling choices, not published numbers. They keep steps small and never raise a load on their own.</p>
      <ul className="mt-2 divide-y divide-line">
        {AURA_RULES.map((t) => (
          <li key={t} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3 text-sm text-soft">
            <Badge>AURA rule</Badge>
            <span className="min-w-0 flex-1">{t}</span>
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}
