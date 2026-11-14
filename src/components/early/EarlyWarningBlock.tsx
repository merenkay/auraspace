import { useSession } from '../../lib/session'
import type { Measurement } from '../../lib/types'
import { Disclosure, StatusIcon } from '../ui'
import { News2RedNotice } from './News2Card'
import { EarlyWarningReportView } from './EarlyWarningPanel'
import { useEarlyWarning } from './useEarlyWarning'

/**
 * Overview: one line ("No early warnings …" or the top warning), detail collapsed by default.
 * A NEWS2 red score is shown above it, never inside the collapsed part.
 */
export default function EarlyWarningBlock({ rows, crewId }: { rows: Measurement[]; crewId: number }) {
  const { mission } = useSession()
  const { report } = useEarlyWarning(rows, crewId)
  if (!report) return null
  const status = report.early ? 'warn' : report.checked.length ? 'ok' : null
  return (
    <section data-demo="early-warning" aria-label="Early warning" className="space-y-3">
      <News2RedNotice report={report} ctx={mission?.context ?? 'space'} />
      <div className="rounded-2xl border border-line bg-panel px-4">
        <Disclosure
          size="row"
          id="overview.early-warning"
          title={
            <span className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                <StatusIcon status={status} size={16} />
              </span>
              <span className="min-w-0">
                <span className="font-semibold text-ink">Early warning</span>
                <span className="text-soft"> · {report.summary}</span>
              </span>
            </span>
          }
        >
          <div className="pb-3 pt-2">
            <EarlyWarningReportView report={report} crewId={crewId} />
          </div>
        </Disclosure>
      </div>
    </section>
  )
}
