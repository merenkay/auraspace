import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, Inbox, Send } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Badge, Button, EmptyState, Field, Input, Notice, PageHeader, Skeleton, Stagger, StaggerItem, StatusIcon, StatusPill, StatusText, statusLabel, DUR, EASE, cx } from '../components/ui'
import Journey from '../components/reports/Journey'
import { MISSIONS } from '../data/missions'
import { timeAgo } from '../lib/health'
import { loadReports } from '../lib/reports/store'
import { useSession } from '../lib/session'
import type { Report } from '../lib/types'

// Stored status only. 'delivered' is never set by either backend; signal-delay steps are a labelled simulation (Journey).
const REPORT_BADGE: Record<Report['status'], string> = { queued: 'Awaiting reply', delivered: 'Awaiting reply', reviewed: 'Replied' }

export default function Reports() {
  const { backend, mission } = useSession()
  const [reports, setReports] = useState<Report[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  // one draft reply per report, so text typed for one row never ends up in another
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [failed, setFailed] = useState<number | null>(null)
  const uid = useId()
  const delaySec = mission?.context === 'space' ? (MISSIONS.find((m) => m.id === mission.profileId)?.delaySec ?? 0) : 0

  useEffect(() => {
    if (!backend) return
    loadReports(backend).then(setReports, () => setLoadFailed(true))
  }, [backend])

  const header = <PageHeader eyebrow="Flight surgeon" title="Reports inbox" description="Reports sent by the crew. Open one to read it and send a reply." />

  if (!reports)
    return (
      <div>
        {header}
        {loadFailed ? (
          <Notice tone="warn" role="alert" title="Reports could not be loaded">
            Check your connection and reload the page.
          </Notice>
        ) : (
        <div role="status" aria-label="Loading reports" className="space-y-px border-y border-line">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-4">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="ml-auto h-6 w-20" />
            </div>
          ))}
        </div>
        )}
      </div>
    )

  const review = async (id: number) => {
    if (!backend) return
    setFailed(null)
    try {
      const r = await backend.reviewReport(id, notes[id]?.trim() || 'Reviewed — continue monitoring.')
      setReports((list) => list?.map((x) => (x.id === id ? r : x)) ?? null)
      setNotes(({ [id]: _sent, ...rest }) => rest)
    } catch {
      setFailed(id)
      return
    }
    // The review answer has no reply time / read marker; reload to show the stored ones.
    loadReports(backend).then(setReports, () => undefined)
  }

  return (
    <div>
      {header}
      {reports.length === 0 ? (
        <EmptyState icon={Inbox} title="No reports yet" description="Astronauts send one from their Overview with “Send report to flight surgeon”." />
      ) : (
        <Stagger as="ul" className="divide-y divide-line border-y border-line">
          {reports.map((r) => {
            const isOpen = open === r.id
            const panelId = `${uid}-${r.id}`
            return (
              <StaggerItem as="li" key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : r.id)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  className={cx('press flex min-h-14 w-full flex-wrap items-center gap-x-3 gap-y-1 px-2 py-3 text-left transition-colors hover:bg-panel2', isOpen && 'bg-panel2')}
                >
                  <StatusIcon status={r.summary.overall} size={18} />
                  <span className="sr-only">{statusLabel(r.summary.overall)}</span>
                  <span className="text-[15px] font-semibold text-ink">{r.crewName}</span>
                  <span className="font-mono text-xs text-dim">
                    Day {r.day} · {timeAgo(r.createdAt)}
                  </span>
                  <span className="ml-auto flex items-center gap-3">
                    <Badge icon={r.status === 'reviewed' ? Check : undefined} tone={r.status === 'reviewed' ? 'neutral' : 'accent'}>
                      {REPORT_BADGE[r.status]}
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
                      <div className="px-2 pb-5 pt-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <StatusPill status={r.summary.overall} />
                          <span className="text-sm text-soft">{r.summary.scoreReady === false ? `No score: insufficient data (${r.summary.data?.current ?? 0} of ${r.summary.data?.expected ?? '?'} measurements current)` : `Score ${r.summary.score} / 100`}</span>
                        </div>
                        <ul className="mt-4 grid border-t border-line sm:grid-cols-2 sm:gap-x-8">
                          {r.summary.vitals.map((v) => (
                            <li key={v.label} className="flex min-h-11 items-center justify-between gap-3 border-b border-line px-2 py-2 text-sm">
                              <span className="text-soft">{v.label}</span>
                              <span className="flex items-center gap-2">
                                <span className={cx('font-medium', v.status === 'warn' ? 'text-warn' : v.status === 'crit' ? 'text-crit' : 'text-ink')}>{v.value}</span>
                                {v.status !== 'ok' && <StatusText status={v.status} />}
                              </span>
                            </li>
                          ))}
                        </ul>
                        {failed === r.id && (
                          <Notice tone="warn" role="alert" className="mt-5" title="The reply was not saved">
                            Check your connection and try again.
                          </Notice>
                        )}
                        {r.status === 'reviewed' ? (
                          <Notice tone="info" title={`Reply sent by ${r.reviewedBy ?? 'the flight surgeon'}`} className="mt-5">
                            <span className="whitespace-pre-wrap">{r.reviewNote}</span>
                          </Notice>
                        ) : (
                          <form
                            className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
                            onSubmit={(e) => {
                              e.preventDefault()
                              void review(r.id)
                            }}
                          >
                            <Field label="Reply to the crew member" hint="Leave empty to send “Reviewed — continue monitoring.”" className="min-w-0 flex-1">
                              <Input autoComplete="off" enterKeyHint="send" value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} placeholder="Reply to the crew member…" />
                            </Field>
                            <Button type="submit" variant="primary" icon={Send}>
                              Send reply
                            </Button>
                          </form>
                        )}
                        <div className="mt-5 border-t border-line pt-4">
                          <Journey report={r} delaySec={delaySec} perspective="surgeon" />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </StaggerItem>
            )
          })}
        </Stagger>
      )}
    </div>
  )
}
