// Compact "environment check" for an AURA assessment: one visible line (the most important note), the rest folded.
// Notes come from src/lib/cabinLink/envDx.ts; every line carries its source. Never says "normal air" without data.
import { Thermometer } from 'lucide-react'
import { cabinSource } from '../../data/cabinLink/sources'
import type { Cited } from '../../data/conditions/types'
import { EXPECTED_DISCOUNT, type EnvAssessment, type EnvNote } from '../../lib/cabinLink/envDx'
import { Disclosure, SourceLink, cx } from '../ui'

const ORDER: EnvNote['kind'][] = ['watch', 'not-expected', 'expected', 'strain', 'cancelled', 'no-data']

function Src({ c }: { c?: Cited }) {
  if (!c) return null
  const s = cabinSource(c.s)
  return (
    <span className="whitespace-nowrap">
      {' '}
      <SourceLink href={s.url} org={s.org} />
    </span>
  )
}

export default function EnvironmentNotes({ a }: { a: EnvAssessment }) {
  const e = a.environment
  const notes = [...e.notes].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind))
  const all = [...e.vitalNotes, ...notes]
  if (!all.length) return null
  const lead = all[0]
  const hi = e.heatIndexC != null && e.heatCategory && e.heatCategory.id !== 'none' ? e.heatCategory : null
  return (
    <div data-testid="env-notes" className="max-w-3xl rounded-xl border border-line bg-panel p-3.5">
      <p className="flex items-start gap-2.5 text-[15px] leading-relaxed text-ink">
        <Thermometer className={cx('mt-1 h-4 w-4 shrink-0', lead.kind === 'watch' ? 'text-warn' : 'text-dim')} aria-hidden="true" />
        <span>
          {lead.text}
          <Src c={lead.cite} />
        </span>
      </p>
      <Disclosure size="row" id="cabinlink.envdx" title="How the environment was weighed" meta={all.length > 1 ? `${all.length} notes` : undefined} className="mt-1">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-soft">
          {all.slice(1).map((n) => (
            <li key={n.finding + n.kind}>
              {n.text}
              <Src c={n.cite} />
            </li>
          ))}
          {hi && (
            <li>
              Heat index about {Math.round(e.heatIndexC!)} °C — NWS band “{hi.label}”: {hi.effect}. An estimate from NOAA’s formula for shade and light wind, not a measurement.
              <Src c={{ t: '', q: '', s: 'nws-heat-index' }} />
            </li>
          )}
        </ul>
        <p className="mt-2 text-sm text-dim">
          AURA rule: with a fresh reading (15 min) a symptom the environment explains counts at {EXPECTED_DISCOUNT * 100} % weight when ranking possible illnesses, and a symptom it does not
          explain adds a little weight. Red-flag rules use your answers unchanged; an urgent or emergency result is never lowered; severe, sudden or at-rest symptoms cancel the
          explanation. The DHT11 reads about ±2 °C and ±5 % humidity
          <Src c={{ t: '', q: '', s: 'adafruit-dht' }} />; the MQ-2 does not measure carbon monoxide or CO₂.
        </p>
      </Disclosure>
    </div>
  )
}
