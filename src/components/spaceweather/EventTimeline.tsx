import { CalendarClock, FlaskConical, Magnet, Radiation, Sun, Wind, ArrowUpRight, type LucideIcon } from 'lucide-react'
import type { TimelineEvent, TimelineKind } from '../../lib/spaceWeather'
import { Badge, List, Row, cx } from '../ui'

const ICON: Record<TimelineKind, LucideIcon> = { flare: Sun, sep: Radiation, cme: Wind, gst: Magnet, arrival: CalendarClock, drill: FlaskConical }

/** Recent DONKI events, newest first. Each row links to the event page in DONKI. */
export default function EventTimeline({ events, hiddenCmes }: { events: TimelineEvent[]; hiddenCmes: number }) {
  if (!events.length) {
    return <p className="text-sm text-dim">No flares, particle events, fast CMEs or geomagnetic storms were recorded in this 7-day window.</p>
  }
  return (
    <div>
      <List>
        {events.map((e) => {
          const Icon = ICON[e.kind]
          return (
            <Row
              key={e.id}
              leading={<Icon className={cx('h-5 w-5', e.notable ? 'text-soft' : 'text-dim')} aria-hidden="true" />}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className={e.notable ? 'text-ink' : 'text-soft'}>{e.title}</span>
                  {e.forecast && <Badge>Forecast</Badge>}
                  {e.simulated && (
                    <Badge icon={FlaskConical} className="border-dashed border-soft text-ink">
                      Simulated
                    </Badge>
                  )}
                </span>
              }
              description={e.detail}
              trailing={
                e.link ? (
                  <a href={e.link} target="_blank" rel="noreferrer noopener" className="link inline-flex min-h-11 items-center gap-1 text-sm">
                    DONKI
                    <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">(event record, opens in a new tab)</span>
                  </a>
                ) : undefined
              }
            />
          )
        })}
      </List>
      {hiddenCmes > 0 && (
        <p className="mt-2 text-sm text-dim">
          {hiddenCmes} slower CME{hiddenCmes > 1 ? 's' : ''} (S-type, under 500 km/s) not modelled to reach Earth are not listed.
        </p>
      )}
    </div>
  )
}
