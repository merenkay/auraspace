// The compact "Cabin air" notice shown near the top of an AURA assessment: what the sensor station measured,
// since when, why it can matter for these symptoms (sourced), the first step, and the sensor's limits.
// It never says "the air is normal" when data is missing or old.
import { Wind } from 'lucide-react'
import type { Cited } from '../../data/conditions/types'
import type { Context } from '../../data/contexts'
import { CABIN_LIMITS } from '../../data/missions'
import { cabinSource, FIRST_STEP, SENSOR_FACTS, WHY } from '../../data/cabinLink/sources'
import { factorOf, gasAlarmRule, LOOKBACK_MS, reportedAirSymptoms, type CabinContext, type CabinFactor } from '../../lib/cabinLink/context'
import type { Answers } from '../../lib/doctor/engine'
import { GAS_ALARM_RATIO, GAS_WARN_RATIO } from '../../lib/envStation'
import { GasGuidance } from '../env/GasAlarm'
import { GAS_GUIDANCE } from '../env/gasGuidance'
import { ageText, clockTime } from '../env/parts'
import { Button, Disclosure, Notice, SourceLink } from '../ui'

export const AIR_TITLE: Record<Context, string> = { space: 'Cabin air', polar: 'Station air', home: 'Room air' }
const HOURS = LOOKBACK_MS / 3_600_000

const at = (ms: number) => clockTime(ms, false)

export function factorLine(f: CabinFactor): string {
  const since = f.now ? `since ${at(f.since)}` : `last seen ${at(f.lastAt)}`
  switch (f.id) {
    case 'gas':
      return `Flammable-gas sensor ${f.now ? 'raised now' : 'was raised'} — up to ${f.peak.toFixed(1)}× its clean-air baseline (${f.level === 'alarm' ? `alarm level ${GAS_ALARM_RATIO}×` : `attention level ${GAS_WARN_RATIO}×`}), ${since}`
    case 'heat':
      return `Temperature ${f.now ? 'is' : 'was'} above ${CABIN_LIMITS.tempMax} °C — up to ${f.peak.toFixed(1)} °C, ${since}`
    case 'humid':
      return `Humidity ${f.now ? 'is' : 'was'} above ${CABIN_LIMITS.rhMax} % — up to ${Math.round(f.peak)} %, ${since}`
    case 'cold':
      return `Temperature ${f.now ? 'is' : 'was'} below ${CABIN_LIMITS.tempMin} °C — down to ${f.peak.toFixed(1)} °C, ${since}`
    case 'dry':
      return `Humidity ${f.now ? 'is' : 'was'} below ${CABIN_LIMITS.rhMin} % (dry air) — down to ${Math.round(f.peak)} %, ${since}`
  }
}

function Cite({ c }: { c: Cited }) {
  const s = cabinSource(c.s)
  return (
    <li>
      <span className="text-ink">{c.t}</span>{' '}
      <span className="whitespace-nowrap">
        <SourceLink href={s.url} org={s.org} />
      </span>
    </li>
  )
}

/** Returns null when nothing about the air is relevant (no elevated factor and no air-related symptom). */
export default function CabinAirNotice({ cabin, answers, ctx }: { cabin: CabinContext | null; answers: Answers; ctx: Context }) {
  if (!cabin) return null
  const reported = reportedAirSymptoms(answers)
  const factors = cabin.factors
  if (!factors.length && !reported.length) return null

  const gas = factorOf(cabin, 'gas')
  const heat = factorOf(cabin, 'heat')
  const humid = factorOf(cabin, 'humid')
  const cold = factorOf(cabin, 'cold')
  const dry = factorOf(cabin, 'dry')
  const rule = gasAlarmRule(cabin, answers)
  const title = AIR_TITLE[ctx]
  const ageLine = cabin.latestAt == null ? null : `Newest reading ${ageText(cabin.ageMs)} (${at(cabin.latestAt)}) from the sensor station.`

  const limits = (
    <p className="mt-2 text-sm text-dim">
      Sensor limits: the MQ-2 reacts to combustible gas and smoke (<SourceLink href={cabinSource(SENSOR_FACTS.detects.s).url} org="datasheet" />) — it cannot measure carbon monoxide
      or CO₂, it is not a certified alarm, and a normal reading never rules them out.
    </p>
  )

  // No usable readings: say so plainly — missing data is not "normal air".
  if (!factors.length) {
    const none = cabin.quality === 'none'
    const stale = cabin.quality === 'stale'
    return (
      <div data-demo="cabin-link">
        <Notice
          tone="info"
          title={none || stale ? `${title}: no recent cabin readings` : `${title}: readings in the usual range`}
          action={none || stale ? <Button size="sm" icon={Wind} to="/environment">Sensor station</Button> : undefined}
        >
          {none ? (
            <p>AURA has no sensor readings from the last {HOURS} hours, so it cannot tell whether the air played a part in how you feel.</p>
          ) : stale ? (
            <p>
              The newest reading is {ageText(cabin.ageMs)}, so AURA cannot tell what the air is like now. {ageLine}
            </p>
          ) : (
            <p>
              Temperature, humidity and the gas sensor stayed inside their bands for the last {HOURS} hours. {ageLine}
            </p>
          )}
          {limits}
        </Notice>
      </div>
    )
  }

  const why: Cited[] = [...(gas ? WHY.gas.slice(0, 2) : []), ...(heat ? WHY.heat : []), ...(heat && humid ? WHY.humid : []), ...(cold ? WHY.cold : []), ...(dry ? WHY.dry : [])]
  const steps: { text: string; src: { org: string; url: string } }[] = []
  if (gas) {
    const g = GAS_GUIDANCE[ctx].steps[0]
    steps.push({ text: g.text, src: { org: g.sources[0].org, url: g.sources[0].url } })
    if (ctx !== 'space') steps.push({ text: FIRST_STEP.freshAir.t, src: cabinSource(FIRST_STEP.freshAir.s) })
  }
  if (heat) steps.push({ text: FIRST_STEP.coolPlace.t, src: cabinSource(FIRST_STEP.coolPlace.s) })
  if (cold) steps.push({ text: FIRST_STEP.warmUp.t, src: cabinSource(FIRST_STEP.warmUp.s) })
  const tone = gas?.now && gas.level === 'alarm' ? 'crit' : 'warn'
  const headline = gas ? 'check the air first' : heat ? 'the room is hot' : cold ? 'the room is cold' : 'the air is dry'

  return (
    <div data-demo="cabin-link">
      <Notice tone={tone} role={tone === 'crit' ? 'alert' : 'status'} title={`${title}: ${headline}`}>
        <ul className="space-y-0.5 text-ink">
          {factors.map((f) => (
            <li key={f.id}>{factorLine(f)}.</li>
          ))}
        </ul>
        {ageLine && <p className="mt-1 text-sm text-dim">{ageLine}{cabin.quality === 'stale' ? ' It may not reflect the air now.' : ''}</p>}
        {rule && <p className="mt-2 font-medium text-ink">{rule}.</p>}

        {steps.length > 0 && (
          <div className="mt-3">
            <p className="text-[15px] font-semibold text-ink">First step</p>
            <ol className="mt-1 list-decimal space-y-1 pl-5">
              {steps.map((s) => (
                <li key={s.text}>
                  <span className="text-ink">{s.text}</span>{' '}
                  <span className="whitespace-nowrap">
                    <SourceLink href={s.src.url} org={s.src.org} />
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {why.length > 0 && (
          <div className="mt-3">
            <p className="text-[15px] font-semibold text-ink">Why it can matter</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {why.map((c) => (
                <Cite key={c.t} c={c} />
              ))}
            </ul>
          </div>
        )}

        {limits}
        <p className="mt-1 text-sm text-dim">
          AURA rule: gas attention at {GAS_WARN_RATIO}× and alarm at {GAS_ALARM_RATIO}× your own clean-air baseline (demo thresholds, not a safety standard); the last {HOURS} hours
          are checked and a reading counts as current for 15 minutes. These readings only add supporting weight — they never lower the urgency or hide a red flag.
        </p>
        {gas && (
          <Disclosure size="row" id="cabinlink.gas-steps" title="All gas-alarm steps" className="mt-2">
            <GasGuidance context={ctx} compact />
          </Disclosure>
        )}
      </Notice>
    </div>
  )
}
