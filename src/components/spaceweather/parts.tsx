import { Archive, CloudOff, RadioTower } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Freshness, Snapshot } from '../../lib/spaceWeather'
import { Badge, Disclosure as UiDisclosure, cx } from '../ui'

export function ago(ms: number | null): string {
  if (ms == null) return 'never'
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export const dateUtc = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** Where the data on screen comes from and how old it is. Never a pulsing "live" dot: this is polled, not streamed. */
export function OriginBadge({ snapshot, fresh }: { snapshot: Snapshot; fresh: Freshness }) {
  if (snapshot.origin === 'sample') {
    return (
      <Badge icon={Archive} className="border-dashed border-soft text-ink">
        Saved sample · {snapshot.capturedAt ? dateUtc(Date.parse(snapshot.capturedAt)) : 'date unknown'}
      </Badge>
    )
  }
  if (snapshot.origin === 'cache') {
    return <Badge icon={CloudOff}>Offline copy · {ago(fresh.ageMs)}</Badge>
  }
  if (fresh.stale) {
    return (
      <Badge tone="warn" icon={RadioTower}>
        Out of date · {ago(fresh.ageMs)}
      </Badge>
    )
  }
  return (
    <Badge tone="accent" icon={RadioTower}>
      Updated {ago(fresh.ageMs)}
    </Badge>
  )
}

/** One line under the heading: what "updated" means for this copy. */
export function originSentence(snapshot: Snapshot, fresh: Freshness): string {
  const when = fresh.newest == null ? 'never' : ago(fresh.ageMs)
  switch (snapshot.origin) {
    case 'server':
      return `From AURA's server copy of NASA DONKI and NOAA SWPC, refreshed every 5–15 minutes. Last fetched ${when}.`
    case 'direct':
      return `Fetched by this browser directly from NASA DONKI and NOAA SWPC ${when}.`
    case 'cache':
      return `No connection: showing the last copy saved on this device (fetched ${when}). Events are listed for the week before that.`
    case 'sample':
      return `No connection and no saved copy: showing a saved sample of real events captured on ${snapshot.capturedAt ? dateUtc(Date.parse(snapshot.capturedAt)) : '—'}. It is not current.`
  }
}

/** The page's row-style disclosure (44 px target, hairline above), remembered per device. */
export function Fold({ id, title, meta, summary, children }: { id: string; title: string; meta?: ReactNode; summary?: ReactNode; children: ReactNode }) {
  return (
    <UiDisclosure size="row" id={id} title={<span className="text-[15px] font-semibold text-ink">{title}</span>} meta={meta} summary={summary} className="border-t border-line">
      <div className="pb-3 pt-1">{children}</div>
    </UiDisclosure>
  )
}

export function Quote({ children, className }: { children: ReactNode; className?: string }) {
  return <blockquote className={cx('border-l border-line pl-3 text-sm italic text-soft', className)}>{children}</blockquote>
}
