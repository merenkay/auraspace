import { ClipboardCheck } from 'lucide-react'
import { useState } from 'react'
import type { Context } from '../../data/contexts'
import { EW } from '../../data/earlyWarning/rules'
import { ACVPU_LABEL, NEWS2_FOOTNOTES, NEWS2_LABEL, NEWS2_POPULATION, NEWS2_UNIT, type Acvpu, type News2Param } from '../../data/earlyWarning/news2'
import { EW_SOURCES } from '../../data/earlyWarning/sources'
import { MISSIONS } from '../../data/missions'
import type { Status } from '../../data/vitals'
import { timeAgo } from '../../lib/health'
import type { EarlyWarningReport } from '../../lib/earlyWarning'
import { triggerText } from '../../lib/earlyWarning/news2'
import { actionFor } from '../../lib/triage'
import { useSession } from '../../lib/session'
import { Badge, Button, Card, Metric, Notice, SourceLink } from '../ui'
import FullCheckDialog from './FullCheckDialog'

/** AURA mapping of the official Chart 2 trigger to its own three statuses (AURA rule). */
const TRIGGER_STATUS = { low: 'ok', red: 'warn', medium: 'crit', high: 'crit' } as const satisfies Record<string, Status>

function valueText(param: News2Param, v: number | string | null) {
  if (v == null) return null
  if (param === 'o2') return v === 'oxygen' ? 'Oxygen' : 'Air'
  if (param === 'acvpu') return ACVPU_LABEL[v as Acvpu]
  return `${v}${NEWS2_UNIT[param] ? ` ${NEWS2_UNIT[param]}` : ''}`
}

/** The red-score notice. Rendered by the caller outside any collapsed area (alerts are never hidden). */
export function News2RedNotice({ report, ctx }: { report: EarlyWarningReport; ctx: Context }) {
  const { mission } = useSession()
  const n = report.news2
  if (!n.red.length) return null
  const delay = (MISSIONS.find((m) => m.id === mission?.profileId) ?? MISSIONS[0]).delaySec
  const names = n.red.map((p) => NEWS2_LABEL[p].toLowerCase()).join(' and ')
  return (
    <Notice tone="warn" role="alert" title={`NEWS2 single-parameter score of 3: ${names}`}>
      <p>
        In NEWS2 a score of 3 in any one parameter is a “red score”; the RCP chart lists it as low–medium clinical risk needing an “urgent ward-based response”. {actionFor('crit', delay, ctx)}
      </p>
      <p className="mt-1 text-xs text-dim">Rule-based (RCP NEWS2 Chart 2). NEWS2 is validated for adults in hospital and ambulance care, not for this setting.</p>
    </Notice>
  )
}

export default function News2Card({ report, ctx, crewId, ownRecord }: { report: EarlyWarningReport; ctx: Context; crewId: number; ownRecord: boolean }) {
  const { mission } = useSession()
  const [open, setOpen] = useState(false)
  const n = report.news2
  const trig = n.trigger ? triggerText(n.trigger) : null
  const status: Status | null = n.trigger ? TRIGGER_STATUS[n.trigger] : null
  const delay = (MISSIONS.find((m) => m.id === mission?.profileId) ?? MISSIONS[0]).delaySec

  return (
    <Card tone="well">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-ink">NEWS2 acuity score</h3>
        <Badge>{n.complete ? 'Complete · 7 of 7' : `Partial · ${n.scored} of 7 parameters`}</Badge>
      </div>

      {n.complete && trig ? (
        <div className="mt-3 space-y-3">
          <Metric label="NEWS2 total" value={n.points} size="md" status={status === 'ok' ? undefined : status} hint={`Full check ${timeAgo(n.checkAt ?? undefined)}`} />
          <div className="rounded-lg border border-line p-3 text-sm">
            <p className="label">Official NEWS2 trigger (RCP Chart 2, hospital wording)</p>
            <p className="mt-1 text-soft">
              {trig.band} · Clinical risk: <span className="text-ink">{trig.risk}</span> · Response: <span className="text-ink">{trig.response}</span>
            </p>
            {trig.response.includes('*') && (
              <ul className="mt-2 space-y-1 text-xs text-dim">
                {NEWS2_FOOTNOTES.filter((f) => (trig.response.includes('**') ? true : !f.startsWith('**'))).map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </div>
          {status !== 'ok' && status && <p className="text-sm text-soft">{actionFor(status, delay, ctx)}</p>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-soft">
          <span className="font-medium text-ink">
            {n.points} point{n.points === 1 ? '' : 's'} from {n.scored} of 7 parameters — not a NEWS2 total.
          </span>{' '}
          AURA measures pulse, blood oxygen, temperature and systolic pressure. Respiration rate, supplemental oxygen and consciousness are not measured, so the official risk bands and responses are not shown.
          {n.expiredCheckAt && ` The last full check (${timeAgo(n.expiredCheckAt)}) is older than ${EW.NEWS2_FULLCHECK_MAX_AGE_H} h and no longer counts.`}
        </p>
      )}

      <ul className="mt-3 divide-y divide-line border-y border-line text-sm">
        {n.items.map((i) => (
          <li key={i.param} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2">
            <span className="min-w-0 text-soft">{NEWS2_LABEL[i.param]}</span>
            <span className="ml-auto flex items-center gap-2 text-right">
              {i.score == null ? (
                <span className="text-dim">{i.note ?? 'Not measured'}</span>
              ) : (
                <>
                  <span className="text-ink">{valueText(i.param, i.value)}</span>
                  <Badge tone={i.score === 3 ? 'warn' : 'neutral'}>{i.score} pt</Badge>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm text-dim">{NEWS2_POPULATION}</p>
      <p className="mt-1 text-xs text-dim">
        Readings count for the partial score if under {EW.NEWS2_READING_MAX_AGE_H} h old (AURA rule). Values are rounded to the chart’s recording precision. Oxygen saturation uses Scale 1; Scale 2 is only for use under the direction of a qualified clinician.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {[EW_SOURCES.news2Chart1, EW_SOURCES.news2Chart2, EW_SOURCES.news2Summary].map((s) => (
          <SourceLink key={s.id} href={s.url} org={s.org} title={s.title} />
        ))}
      </div>

      {ownRecord ? (
        <div className="mt-4">
          <Button icon={ClipboardCheck} onClick={() => setOpen(true)}>
            {n.complete ? 'Redo the full check' : 'Do a full NEWS2 check'}
          </Button>
          <p className="mt-2 text-xs text-dim">Adds respiration rate, oxygen and alertness for a complete score. Saved on this device only.</p>
          <FullCheckDialog open={open} onClose={() => setOpen(false)} crewId={crewId} report={report} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-dim">A complete NEWS2 needs respiration rate, oxygen use and alertness, which only the person can enter on their own device (it stays on that device).</p>
      )}
    </Card>
  )
}
