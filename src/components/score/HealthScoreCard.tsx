// The health-score card on the Overview: the ring (or "Insufficient data"), how much of the data is current,
// old readings listed separately with their time, other body systems worth a look, and how the score is calculated.
import { FRESHNESS_RULES } from '../../data/freshness'
import type { SystemId } from '../../data/systems'
import type { VitalKey } from '../../data/vitals'
import { timeAgo, VITAL_SYSTEM, type Evaluation } from '../../lib/health'
import { Badge, Card, Disclosure, List, Row, ScoreRing, StatusText, SYSTEM_ICON } from '../ui'

export type HealthScoreCardProps = {
  ev: Evaluation
  /** Systems already covered by an alert shown above the card; they are not repeated in "Also worth a look". */
  excludeSystems?: SystemId[]
  onSelectSystem: (id: SystemId) => void
  /** Opens the entry form for one measurement. Absent when the viewer may not log readings. */
  onLog?: (key: VitalKey) => void
}

/** Same footprint as the ring, but no number: there is not enough current data for a score. */
function NoScoreRing({ size }: { size: number }) {
  const stroke = Math.max(4, Math.round(size / 26))
  const r = size / 2 - stroke
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} strokeDasharray="4 6" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
        <span className="text-[13px] font-medium leading-tight text-soft">No score</span>
        <span className="mt-1 text-xs text-dim">not enough data</span>
      </div>
    </div>
  )
}

export default function HealthScoreCard({ ev, excludeSystems = [], onSelectSystem, onLog }: HealthScoreCardProps) {
  const q = ev.quality
  const driven = ev.alerts.slice(0, 2).map((a) => a.title.split(' ').slice(0, 2).join(' ').toLowerCase()).join(' and ')
  const headline = !ev.scoreReady
    ? 'Insufficient data'
    : ev.alerts[0]
      ? `Driven by ${driven}.`
      : `All ${q.current} current reading${q.current === 1 ? ' is' : 's are'} within range.`
  const skip = new Set(excludeSystems)
  // Systems that need a look but are not already covered by one of the alerts above.
  const otherSystems = ev.systems.filter((s) => ev.systemMeasured[s.id] && ev.systemStatus[s.id] !== 'ok' && !skip.has(s.id)).slice(0, 4)
  const missing = q.items.filter((i) => i.state === 'missing')

  return (
    <Card>
      <div className="flex items-center gap-5">
        <div className="shrink-0">{ev.scoreReady ? <ScoreRing score={ev.score} status={ev.overall} size={120} /> : <NoScoreRing size={120} />}</div>
        <div className="min-w-0">
          <p className="label">Health score</p>
          <p className="mt-1 text-[15px] font-semibold leading-snug text-ink">{headline}</p>
          {!ev.scoreReady && ev.alerts[0] && <p className="mt-1 text-sm text-soft">Current readings still flagged: {driven}.</p>}
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Data behind the score">
            <Badge tone={ev.scoreReady ? 'neutral' : 'warn'}>
              {q.current} of {q.expected} current
            </Badge>
            {q.old > 0 && <Badge>{q.old} old</Badge>}
            {q.missing > 0 && <Badge>{q.missing} missing</Badge>}
          </div>
        </div>
      </div>

      {!ev.scoreReady && (
        <div className="mt-4 text-sm text-soft">
          <p className="font-medium text-ink">What a score needs</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {q.needs.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          {ev.alerts.length === 0 && <p className="mt-1 text-dim">Nothing current is out of range, but that is not the same as “everything is fine”.</p>}
        </div>
      )}

      {ev.lastKnown.length > 0 && (
        <div className="mt-5">
          <p className="label mb-1">Old readings — not counted, re-measure</p>
          <List>
            {ev.lastKnown.map((i) => {
              const d = ev.defByKey[i.key]!
              const abnormal = i.status !== 'ok'
              return (
                <Row
                  key={i.key}
                  title={i.label}
                  description={`Last known ${d.display(ev.values)} ${d.unit} · ${timeAgo(i.at)} · counts for ${i.maxAgeDays} days`}
                  trailing={abnormal ? <StatusText status={i.status!}>last known</StatusText> : <span className="whitespace-nowrap text-sm text-dim">Re-measure</span>}
                  onClick={() => (onLog ? onLog(i.key) : onSelectSystem(VITAL_SYSTEM[i.key]))}
                />
              )
            })}
          </List>
        </div>
      )}

      {missing.length > 0 && (
        <p className="mt-4 text-sm text-dim">
          <span className="text-soft">Not measured yet:</span> {missing.map((i) => i.label).join(', ')}. Not counted as normal or as a problem.
        </p>
      )}

      {otherSystems.length > 0 && (
        <div className="mt-5">
          <p className="label mb-1">Also worth a look</p>
          <List>
            {otherSystems.map((s) => {
              const Icon = SYSTEM_ICON[s.id]
              return <Row key={s.id} title={s.name} leading={<Icon className="h-5 w-5" aria-hidden="true" />} trailing={<StatusText status={ev.systemStatus[s.id]} />} onClick={() => onSelectSystem(s.id)} />
            })}
          </List>
        </div>
      )}
      <Disclosure size="row" id="overview.score-how" title="How the score is calculated" className="mt-4 border-t border-line pt-2">
        <div className="space-y-1.5 text-sm text-dim">
          <p>100 minus 9 points per current reading needing attention and 22 per urgent one{ev.showRad ? ' (radiation dose counts the same way)' : ''}. Rule-based, works offline; AURA explains it but never sets it.</p>
          <p>{FRESHNESS_RULES.window} <span className="text-soft">AURA rule.</span></p>
          <p>{FRESHNESS_RULES.sufficient} <span className="text-soft">AURA rule.</span></p>
          <p>{FRESHNESS_RULES.missing}</p>
          <p>{FRESHNESS_RULES.news2}</p>
        </div>
      </Disclosure>
    </Card>
  )
}
