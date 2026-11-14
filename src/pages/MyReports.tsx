// "My reports": the signed-in person's own reports, newest first. Simulated crew (astronauts): what they sent to the
// flight surgeon, its truthful status, the reply and an unread marker, plus a labelled simulation of the signal delay.
// Registered members: their saved summaries — AURA sends these to nobody, so there is no reply to wait for.
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, Clock, FileText, Inbox, MessageSquareText, RotateCw } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import Journey, { clock } from '../components/reports/Journey'
import { Badge, Button, EmptyState, Notice, PageHeader, Skeleton, StatusIcon, StatusPill, StatusText, statusLabel, DUR, EASE, cx } from '../components/ui'
import { CONTEXTS } from '../data/contexts'
import { MISSIONS } from '../data/missions'
import { isUnread, reachesReviewer, storedState, STORED_LABEL } from '../lib/reports/journey'
import { markRead, useMyReports } from '../lib/reports/store'
import { useSession } from '../lib/session'
import type { Report } from '../lib/types'

export default function MyReports() {
  const { backend, user, mission } = useSession()
  const { reports, error, reload } = useMyReports()
  const [open, setOpen] = useState<number | null>(null)
  const uid = useId()
  const ctx = mission?.context ?? user?.context ?? 'space'
  const reviewable = reachesReviewer(user?.role)
  const delaySec = reviewable && ctx === 'space' ? (MISSIONS.find((m) => m.id === mission?.profileId)?.delaySec ?? 0) : 0
  const contact = CONTEXTS[ctx].contact
  const unread = reports?.filter((r) => isUnread(r)).length ?? 0

  // Announce new replies that arrive while this page is open (not the count found on first load).
  const prev = useRef<number | null>(null)
  const [said, setSaid] = useState('')
  useEffect(() => {
    if (!reports) return
    if (prev.current != null && unread > prev.current) setSaid(`${unread} new ${unread === 1 ? 'reply' : 'replies'} from the flight surgeon.`)
    prev.current = unread
  }, [reports, unread])

  const toggle = (r: Report) => {
    setOpen((o) => (o === r.id ? null : r.id))
    if (backend && isUnread(r)) void markRead(backend, [r.id])
  }

  const header = reviewable ? (
    <PageHeader eyebrow="To the flight surgeon" title="My reports" description="Reports you sent to the flight surgeon, newest first, with their replies." status={unread > 0 ? <Badge tone="accent" icon={MessageSquareText}>{`${unread} new ${unread === 1 ? 'reply' : 'replies'}`}</Badge> : undefined} />
  ) : (
    <PageHeader eyebrow="Your summaries" title="My reports" description={`Summaries you prepared for your ${contact}. AURA does not send them to anyone: you shared them yourself by copying, e-mailing or printing. Nobody can reply here.`} />
  )

  return (
    <div>
      {header}
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      {error && (
        <Notice tone="warn" role="alert" className="mb-6" title="Your reports could not be loaded" action={<Button size="sm" icon={RotateCw} onClick={reload}>Try again</Button>}>
          Check your connection.
        </Notice>
      )}
      {!reports ? (
        !error && (
          <div role="status" aria-label="Loading your reports" className="space-y-px border-y border-line">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-4">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-4 w-40" />
                <Skeleton className="ml-auto h-6 w-24" />
              </div>
            ))}
          </div>
        )
      ) : reports.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={reviewable ? 'No reports sent yet' : 'No saved summaries yet'}
          description={reviewable ? `Send one from your Overview with “${CONTEXTS[ctx].reportButton}”. It will appear here with its status and the reply.` : `Prepare one from your Overview. It is saved here so you can find it again.`}
          action={user?.crewId != null ? <Button icon={FileText} to={`/crew/${user.crewId}`}>Go to Overview</Button> : undefined}
        />
      ) : (
        <ul className="divide-y divide-line border-y border-line">
          {reports.map((r) => {
            const isOpen = open === r.id
            const panelId = `${uid}-${r.id}`
            const state = storedState(r, reviewable)
            const fresh = isUnread(r)
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cx('press flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3 text-left transition-colors hover:bg-panel2', isOpen && 'bg-panel2')}
                >
                  <StatusIcon status={r.summary.overall} size={18} />
                  <span className="sr-only">{statusLabel(r.summary.overall)} report.</span>
                  <span className="text-[15px] font-semibold text-ink">Day {r.day}</span>
                  <span className="font-mono text-xs text-dim">{reviewable ? 'Sent' : 'Saved'} {clock(r.createdAt)}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {fresh && (
                      <Badge tone="accent" icon={MessageSquareText}>
                        New reply
                      </Badge>
                    )}
                    <Badge tone="neutral" icon={state === 'awaiting' ? Clock : undefined}>
                      {STORED_LABEL[state]}
                    </Badge>
                    <ChevronDown className={cx('h-4 w-4 text-dim transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={panelId}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1, transition: { duration: DUR.base, ease: EASE.out } }}
                      exit={{ height: 0, opacity: 0, transition: { duration: DUR.fast, ease: EASE.in } }}
                      className="overflow-hidden"
                    >
                      <div className="grid gap-6 px-2 pb-5 pt-4 lg:grid-cols-2">
                        <div className="space-y-4">
                          {r.status === 'reviewed' && (
                            <Notice tone="info" title={`Reply from ${r.reviewedBy ?? 'the flight surgeon'}`}>
                              <span className="whitespace-pre-wrap">{r.reviewNote}</span>
                            </Notice>
                          )}
                          {reviewable && <Journey report={r} delaySec={delaySec} perspective="crew" />}
                          {!reviewable && <p className="text-sm text-soft">Saved on your own record only. Share it with your {contact} yourself if you want their view.</p>}
                        </div>
                        <Summary r={r} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Summary({ r }: { r: Report }) {
  const s = r.summary
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={s.overall} />
        <span className="text-sm text-soft">{s.scoreReady === false ? `No score: insufficient data (${s.data?.current ?? 0} of ${s.data?.expected ?? '?'} measurements current)` : `Score ${s.score} / 100`}</span>
      </div>
      <ul className="mt-3 border-t border-line">
        {s.vitals.map((v) => (
          <li key={v.label} className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-2 py-2 text-sm">
            <span className="text-soft">{v.label}</span>
            <span className="flex items-center gap-2">
              <span className={cx('font-medium', v.status === 'warn' ? 'text-warn' : v.status === 'crit' ? 'text-crit' : 'text-ink')}>{v.value}</span>
              {v.status !== 'ok' && <StatusText status={v.status} />}
            </span>
          </li>
        ))}
      </ul>
      {s.alerts.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-soft">
          {s.alerts.map((a) => (
            <li key={a.title} className="flex items-center gap-2">
              <StatusIcon status={a.level} size={14} />
              <span className="sr-only">{statusLabel(a.level)}:</span>
              {a.title}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
