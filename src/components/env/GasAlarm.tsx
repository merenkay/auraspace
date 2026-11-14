import { X } from 'lucide-react'
import type { Context } from '../../data/contexts'
import { GAS_ALARM_RATIO } from '../../lib/envStation'
import { Button, Notice } from '../ui'
import { GAS_GUIDANCE, SENSOR_HONESTY } from './gasGuidance'
import { ExtLink, clockTime } from './parts'
import type { AlarmState } from './useEnvStation'

/** Numbered, sourced action steps for the user's context. */
export function GasGuidance({ context, compact = false }: { context: Context; compact?: boolean }) {
  const g = GAS_GUIDANCE[context]
  return (
    <div>
      <p className="text-[15px] font-semibold text-ink">{g.heading}</p>
      <p className="mt-1 text-sm text-soft">{g.intro}</p>
      <ol className="mt-3 space-y-3">
        {g.steps.map((s, i) => (
          <li key={s.text} className="flex gap-3 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-edge text-xs font-semibold text-ink" aria-hidden="true">
              {i + 1}
            </span>
            <span className="min-w-0 text-ink">
              {s.text}{' '}
              <span className="block text-sm text-dim">
                {s.sources.length ? (
                  <>
                    Source:{' '}
                    {s.sources.map((src, j) => (
                      <span key={src.url + j}>
                        {j > 0 && ' · '}
                        <ExtLink href={src.url}>{src.org}</ExtLink>
                        {!compact && <q className="ml-1">{src.quote}</q>}
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
      <p className="mt-4 text-sm text-dim">
        {g.note} {SENSOR_HONESTY}
      </p>
    </div>
  )
}

const SOURCE_TEXT: Record<AlarmState['mode'], string> = { live: 'live sensor', stored: 'stored reading', sim: 'simulated values', none: 'no data' }

/**
 * Persistent, text-first gas alarm. Stays until a current reading falls back AND the user dismisses it.
 * It is never inside a revealed or staggered container: it appears the instant the rule fires and does not animate.
 */
export function GasAlarmBanner({ alarm, context, simRunning = false, onDismiss }: { alarm: AlarmState; context: Context; simRunning?: boolean; onDismiss: () => void }) {
  const active = alarm.endedAt == null
  const simulated = alarm.mode === 'sim'
  const ratio = alarm.last > 0 ? alarm.last : null
  if (!active) {
    return (
      <Notice
        tone="warn"
        role="status"
        title={`${simulated ? 'Simulated gas alarm' : 'Gas alarm'} ended at ${clockTime(alarm.endedAt!)}. Peak ${alarm.peak.toFixed(1)}× the clean-air baseline.`}
        action={
          <Button size="sm" icon={X} onClick={onDismiss}>
            Dismiss
          </Button>
        }
      >
        The reading is back below the alarm level. Check the area and the source before carrying on.
      </Notice>
    )
  }
  return (
    <Notice
      tone="crit"
      role="alert"
      title={
        <span className="block text-xl leading-tight sm:text-2xl">
          {simulated ? 'Simulated gas alarm' : 'Gas alarm'}: {ratio != null ? `${ratio.toFixed(1)}×` : 'high'} the clean-air baseline
        </span>
      }
      className="border-2 border-crit p-4 sm:p-5"
    >
      <p>
        Since {clockTime(alarm.startedAt)} · peak {alarm.peak.toFixed(1)}× · alarm level {GAS_ALARM_RATIO}× (AURA demo threshold) · from {SOURCE_TEXT[alarm.mode]}
      </p>
      {simulated && <p className="mt-1 font-semibold text-ink">This is a drill with simulated numbers. Nothing is wrong with the air.</p>}
      {alarm.noData && <p className="mt-1 font-semibold text-warn">No newer reading since then. Treat the alarm as still active.</p>}
      {!simulated && simRunning && <p className="mt-1 font-semibold text-warn">This alarm comes from real data. The simulation running below does not change it.</p>}
      <div className="mt-4 border-t border-crit/30 pt-4">
        <GasGuidance context={context} compact />
      </div>
    </Notice>
  )
}
