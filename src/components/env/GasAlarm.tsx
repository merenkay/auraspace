import { Siren, TriangleAlert, X } from 'lucide-react'
import type { Context } from '../../data/contexts'
import { GAS_ALARM_RATIO } from '../../lib/envStation'
import { GAS_GUIDANCE, SENSOR_HONESTY } from './gasGuidance'
import { ExtLink, clockTime } from './parts'
import type { AlarmState } from './useEnvStation'

/** Numbered, sourced action steps for the user's context. */
export function GasGuidance({ context, compact = false }: { context: Context; compact?: boolean }) {
  const g = GAS_GUIDANCE[context]
  return (
    <div>
      <p className="font-semibold text-ink">{g.heading}</p>
      <p className="mt-1 text-sm text-soft">{g.intro}</p>
      <ol className="mt-3 space-y-2">
        {g.steps.map((s, i) => (
          <li key={s.text} className="flex gap-3 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-line font-bold text-ink" aria-hidden="true">
              {i + 1}
            </span>
            <span className="text-ink">
              {s.text}{' '}
              <span className="text-xs text-dim">
                {s.sources.length ? (
                  <>
                    Source:{' '}
                    {s.sources.map((src, j) => (
                      <span key={src.url + j}>
                        {j > 0 && ' · '}
                        <ExtLink href={src.url}>{src.org}</ExtLink>
                        {!compact && <q className="ml-1 italic">{src.quote}</q>}
                      </span>
                    ))}
                  </>
                ) : (
                  'Common-sense step — no official source.'
                )}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-dim">
        {g.note} {SENSOR_HONESTY}
      </p>
    </div>
  )
}

const SOURCE_TEXT: Record<AlarmState['mode'], string> = { live: 'live sensor', stored: 'stored reading', sim: 'simulated values', none: 'no data' }

/** Persistent, text-first gas alarm. Stays until a current reading falls back AND the user dismisses it. */
export function GasAlarmBanner({ alarm, context, simRunning = false, onDismiss }: { alarm: AlarmState; context: Context; simRunning?: boolean; onDismiss: () => void }) {
  const active = alarm.endedAt == null
  const simulated = alarm.mode === 'sim'
  const ratio = alarm.last > 0 ? alarm.last : null
  if (!active) {
    return (
      <div className="rounded-2xl border-2 border-warn bg-warn/10 p-4" role="status">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-6 w-6 shrink-0 text-warn" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-warn">
              {simulated && 'SIMULATED · '}Gas alarm ended at {clockTime(alarm.endedAt!)} — peak {alarm.peak.toFixed(1)}× the clean-air baseline.
            </p>
            <p className="mt-1 text-sm text-soft">The reading is back below the alarm level. Check the area and the source before carrying on.</p>
          </div>
          <button type="button" onClick={onDismiss} className="flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-soft hover:border-ice">
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Dismiss
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-2xl border-2 border-crit bg-crit/15 p-4 sm:p-5" role="alert" aria-live="assertive">
      <div className="flex items-start gap-3">
        <Siren className="mt-0.5 h-8 w-8 shrink-0 text-crit" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-display text-xl font-bold leading-tight text-crit sm:text-2xl">
            {simulated ? 'SIMULATED GAS ALARM' : 'GAS ALARM'} — {ratio != null ? `${ratio.toFixed(1)}×` : 'high'} the clean-air baseline
          </p>
          <p className="mt-1 text-sm text-soft">
            Since {clockTime(alarm.startedAt)} · peak {alarm.peak.toFixed(1)}× · alarm level {GAS_ALARM_RATIO}× (AURA demo threshold) · from {SOURCE_TEXT[alarm.mode]}
          </p>
          {simulated && <p className="mt-1 text-sm font-semibold text-ink">This is a drill with simulated numbers — nothing is wrong with the air.</p>}
          {alarm.noData && <p className="mt-1 text-sm font-semibold text-warn">No newer reading since then — treat the alarm as still active.</p>}
          {!simulated && simRunning && (
            <p className="mt-1 text-sm font-semibold text-warn">This alarm comes from real data. The simulation running below does not change it.</p>
          )}
        </div>
      </div>
      <div className="mt-4 rounded-xl bg-space/60 p-4">
        <GasGuidance context={context} compact />
      </div>
    </div>
  )
}
