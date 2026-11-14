import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Panel, Spinner, StatusPill } from '../components/ui'
import { STATUS_COLOR } from '../data/vitals'
import { timeAgo } from '../lib/health'
import { useSession } from '../lib/session'
import type { Report } from '../lib/types'

export default function Reports() {
  const { backend } = useSession()
  const [reports, setReports] = useState<Report[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    backend?.reports().then(setReports)
  }, [backend])

  if (!reports) return <Spinner label="Loading reports" />

  const review = async (id: number) => {
    if (!backend) return
    const r = await backend.reviewReport(id, note || 'Reviewed — continue monitoring.')
    setReports((list) => list?.map((x) => (x.id === id ? r : x)) ?? null)
    setNote('')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="label">Flight surgeon</p>
        <h1 className="font-display text-3xl font-bold">Reports inbox</h1>
      </div>
      {reports.length === 0 && (
        <Panel>
          <p className="text-sm text-dim">No reports yet. Astronauts send one from their Overview with “Send report to flight surgeon”.</p>
        </Panel>
      )}
      {reports.map((r, i) => (
        <motion.div key={r.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
          <Panel>
            <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full flex-wrap items-center gap-3 text-left">
              <span className="h-3 w-3 rounded-full" style={{ background: STATUS_COLOR[r.summary.overall] }} />
              <span className="font-semibold">{r.crewName}</span>
              <span className="text-sm text-dim">
                Day {r.day} · {timeAgo(r.createdAt)}
              </span>
              <span className="ml-auto rounded-full bg-panel2 px-3 py-1 text-xs font-semibold text-soft">{r.status.toUpperCase()}</span>
            </button>
            <AnimatePresence>
              {open === r.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="mt-4 flex items-center gap-3">
                    <StatusPill status={r.summary.overall} />
                    <span className="text-sm text-soft">Score {r.summary.score} / 100</span>
                  </div>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {r.summary.vitals.map((v) => (
                      <div key={v.label} className="flex justify-between rounded-xl bg-deep/70 px-3 py-2 text-sm">
                        <span className="text-soft">{v.label}</span>
                        <span className="font-semibold" style={{ color: STATUS_COLOR[v.status] }}>
                          {v.value}
                        </span>
                      </div>
                    ))}
                  </div>
                  {r.status === 'reviewed' ? (
                    <p className="mt-4 rounded-xl border border-ok/50 bg-ok/10 p-3 text-sm text-ok">
                      Reviewed by {r.reviewedBy}: {r.reviewNote}
                    </p>
                  ) : (
                    <div className="mt-4 flex gap-2">
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="Reply to the crew member…"
                        className="min-w-0 flex-1 rounded-xl border border-line bg-space/70 px-3 py-2.5 text-sm outline-none focus:border-cyan"
                      />
                      <button type="button" onClick={() => void review(r.id)} className="rounded-xl bg-cyan px-4 text-sm font-semibold text-space">
                        Mark reviewed
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </Panel>
        </motion.div>
      ))}
    </div>
  )
}
