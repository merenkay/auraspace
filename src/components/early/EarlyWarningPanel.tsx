import { Info } from 'lucide-react'
import { EW, RULES } from '../../data/earlyWarning/rules'
import { EW_SOURCES } from '../../data/earlyWarning/sources'
import type { EarlyWarning, EarlyWarningReport } from '../../lib/earlyWarning'
import { useSession } from '../../lib/session'
import type { Measurement } from '../../lib/types'
import { Badge, Disclosure, EmptyState, SourceLink, StatusIcon } from '../ui'
import EarlyWarningChart from './EarlyWarningChart'
import News2Card, { News2RedNotice } from './News2Card'
import { useEarlyWarning, useViewer } from './useEarlyWarning'

function WarningItem({ w, today, dateMode }: { w: EarlyWarning; today: number; dateMode: boolean }) {
  const early = w.level === 'early'
  return (
    <li className="border-t border-line pt-5 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">{early ? <StatusIcon status="warn" size={18} /> : <Info className="h-[18px] w-[18px] text-dim" aria-hidden="true" />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="label">{early ? 'Early warning' : 'Worth watching'}</span>
            {w.usesAuraRule && <Badge>AURA rule</Badge>}
            {w.projection && <Badge>Estimate</Badge>}
          </div>
          <p className="mt-1 text-[15px] font-semibold leading-snug text-ink">{w.finding}</p>
          <EarlyWarningChart a={w} today={today} dateMode={dateMode} />
          <div className="mt-3 text-sm">
            <p className="label">What to do next</p>
            <p className="mt-1 text-ink">{w.next}</p>
          </div>
          <Disclosure size="row" title="Why AURA thinks so" className="mt-2">
            <div className="space-y-3 text-sm">
              <div>
                <p className="label">Signs that fired</p>
                <ul className="mt-1 space-y-1">
                  {w.rules.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-baseline gap-x-2 text-soft">
                      <span>{r.text}</span>
                      {r.source ? <span className="meta">{EW_SOURCES[r.source].org}</span> : <Badge>AURA rule</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="label">How sure</p>
                <p className="mt-1 text-soft">{w.quality}</p>
              </div>
              {w.sources.length > 0 && (
                <div className="flex flex-col gap-1">
                  {w.sources.map((id) => (
                    <SourceLink key={id} href={EW_SOURCES[id].url} org={EW_SOURCES[id].org} title={EW_SOURCES[id].title} />
                  ))}
                </div>
              )}
            </div>
          </Disclosure>
        </div>
      </div>
    </li>
  )
}

/** The report body, for a report that is already computed (the Overview block passes its own). */
export function EarlyWarningReportView({ report, crewId }: { report: EarlyWarningReport; crewId: number }) {
  const { mission } = useSession()
  const { ownRecord } = useViewer(crewId)
  const ctx = mission?.context ?? 'space'
  const today = mission?.day ?? 0
  const dateMode = ctx !== 'space'
  return (
    <div className="space-y-8">
      <p className="max-w-prose text-sm text-dim">
        Compares the latest {EW.RECENT_DAYS} days with the person’s own earlier readings to spot slow changes before AURA’s thresholds are crossed. Rule-based and offline; it does not diagnose, and a missing reading is never counted as normal.
      </p>

      {report.warnings.length ? (
        <ol className="space-y-5" aria-label="Early warnings, most important first">
          {report.warnings.map((w) => (
            <WarningItem key={w.metric.field} w={w} today={today} dateMode={dateMode} />
          ))}
        </ol>
      ) : report.checked.length ? (
        <p className="flex items-start gap-2 text-sm text-soft">
          <StatusIcon status="ok" size={16} className="mt-0.5" />
          <span>
            No early warnings. {report.checked.length} measurement{report.checked.length === 1 ? '' : 's'} compared with the personal baseline: {report.checked.map((a) => a.metric.name.toLowerCase()).join(', ')}.
          </span>
        </p>
      ) : (
        <EmptyState title="Not enough data yet" description="Early warnings need a personal baseline: about two weeks of daily readings, then a further week to compare against it." />
      )}

      <News2Card report={report} ctx={ctx} crewId={crewId} ownRecord={ownRecord} />

      {report.unchecked.length > 0 && (
        <div>
          <p className="label">Not checked yet</p>
          <ul className="mt-2 divide-y divide-line border-y border-line text-sm">
            {report.unchecked.map((a) => (
              <li key={a.metric.field} className="flex items-start gap-3 py-2">
                <StatusIcon status={null} size={16} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="text-ink">{a.metric.name}</span>
                  <span className="text-dim"> — {a.needs.join(' ')}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Disclosure size="row" id="early.methods" title="Methods, constants and sources">
        <ul className="space-y-2 text-sm">
          {RULES.map((r) => (
            <li key={r.id} className="text-soft">
              <span className="font-medium text-ink">{r.name}.</span> {r.text}{' '}
              {r.source ? <SourceLink href={EW_SOURCES[r.source].url} org={EW_SOURCES[r.source].org} /> : <Badge>AURA rule</Badge>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-dim">“AURA rule” marks a choice made for this demo, not a clinical guideline. The attention and urgent lines are the same ones AURA uses on every page.</p>
      </Disclosure>
    </div>
  )
}

/** Full early-warning view for one record. Can sit on Diagnostics or History: <EarlyWarningPanel rows={data.rows} crewId={crewId} /> */
export default function EarlyWarningPanel({ rows, crewId }: { rows: Measurement[]; crewId: number }) {
  const { report } = useEarlyWarning(rows, crewId)
  const { mission } = useSession()
  if (!report) return <EmptyState title="Not enough data yet" description="Early warnings start once there are readings to compare." />
  return (
    <div className="space-y-4">
      <News2RedNotice report={report} ctx={mission?.context ?? 'space'} />
      <EarlyWarningReportView report={report} crewId={crewId} />
    </div>
  )
}
