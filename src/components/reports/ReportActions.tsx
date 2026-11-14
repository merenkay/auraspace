// Overview actions for the person themselves: send today's summary to their care contact, and ask AURA.
// Simulated crew: the report is stored for the flight surgeon (who can reply). Registered members (any context): the
// summary is saved on their own record and offered to copy, e-mail or print — nobody else can read or answer it.
import { Check, Copy, FileText, Inbox, Mail, MessageCircle, Printer } from 'lucide-react'
import { useState } from 'react'
import { CONTEXTS, type Context } from '../../data/contexts'
import { formatDelay } from '../../data/missions'
import type { Evaluation } from '../../lib/health'
import { summaryOf } from '../../lib/health'
import { reachesReviewer } from '../../lib/reports/journey'
import { notifyReportsChanged } from '../../lib/reports/store'
import { useSession } from '../../lib/session'
import { Button, Dialog, Notice } from '../ui'

export type ReportActionsProps = {
  crewId: number
  ev: Evaluation
  ctx: Context
  /** Name printed on the summary. */
  name: string
  /** Mission or tracking day. */
  day: number
  /** One-way signal delay of the mission profile, in seconds. */
  delaySec: number
}

export default function ReportActions({ crewId, ev, ctx, name, day, delaySec }: ReportActionsProps) {
  const { backend, user } = useSession()
  const [sent, setSent] = useState<string | null>(null)
  const [sendError, setSendError] = useState(false)
  const [sending, setSending] = useState(false)
  const [printable, setPrintable] = useState(false)
  // Only the simulated crew's reports reach a reviewer (the flight surgeon sees the demo crew only). Everyone else
  // gets a summary saved on their own record to copy, e-mail or print; nothing is sent on their behalf.
  const reviewable = reachesReviewer(user?.role)
  const label = reviewable || ctx === 'home' ? CONTEXTS[ctx].reportButton : `Prepare report for my ${CONTEXTS[ctx].contact}`

  const sendReport = async () => {
    if (!backend) return
    setSending(true)
    setSendError(false)
    setSent(null)
    try {
      await backend.sendReport(crewId, summaryOf(ev))
      notifyReportsChanged()
      if (reviewable) {
        const sim = ctx === 'space' && delaySec > 0 ? ` Simulated signal delay: it would reach Earth in about ${formatDelay(delaySec)}, and a reply would take at least ${formatDelay(delaySec * 2)}.` : ''
        setSent(`Report stored for the flight surgeon.${sim}`)
      } else {
        setSent(`Summary saved in My reports. AURA does not send it to your ${CONTEXTS[ctx].contact}; share it yourself.`)
        setPrintable(true)
      }
    } catch {
      setSendError(true)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <Button variant="primary" size="lg" icon={FileText} loading={sending} onClick={() => void sendReport()} full>
          {label}
        </Button>
        <Button size="lg" icon={MessageCircle} to={`/crew/${crewId}/aura`} full>
          Ask AURA
        </Button>
      </div>
      {sent && (
        <Notice tone="info" role="status" action={<Button size="sm" icon={Inbox} to="/my-reports">{reviewable ? 'Track it in My reports' : 'Open My reports'}</Button>}>
          {sent}
        </Notice>
      )}
      {sendError && (
        <Notice tone="warn" role="alert" title="The report was not sent">
          Check your connection and try again.
        </Notice>
      )}
      {printable && <PrintableReport ev={ev} name={name} ctx={ctx} day={day} onClose={() => setPrintable(false)} />}
    </div>
  )
}

function PrintableReport({ ev, name, ctx, day, onClose }: { ev: Evaluation; name: string; ctx: Context; day: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const s = summaryOf(ev)
  const text = [
    `AURA health summary — ${name}`,
    `${new Date().toLocaleString()} · day ${day} of tracking · ${CONTEXTS[ctx].label}`,
    `Overall: ${s.overall.toUpperCase()} · ${s.scoreReady === false ? `no score, insufficient data (${s.data?.current} of ${s.data?.expected} measurements current)` : `score ${s.score}/100`}`,
    '',
    'Readings:',
    ...s.vitals.map((v) => `- ${v.label}: ${v.value} (${v.status})`),
    '',
    s.alerts.length ? 'Needs attention:' : 'No alerts.',
    ...s.alerts.map((a) => `- ${a.title}`),
    '',
    'Self-reported and device readings; AURA does not diagnose.',
  ].join('\n')
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Report for your ${CONTEXTS[ctx].contact}`}
      description="Copy it, email it or print it. AURA does not send this anywhere by itself."
      footer={
        <>
          <Button
            icon={copied ? Check : Copy}
            onClick={() => {
              void navigator.clipboard?.writeText(text)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy text'}
          </Button>
          <Button icon={Mail} onClick={() => window.location.assign(`mailto:?subject=${encodeURIComponent('My AURA health summary')}&body=${encodeURIComponent(text)}`)}>
            Email it
          </Button>
          <Button icon={Printer} onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="primary" onClick={onClose} data-autofocus>
            Done
          </Button>
        </>
      }
    >
      <pre data-print-report className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-deep p-4 font-mono text-[13px] leading-relaxed text-soft">{text}</pre>
    </Dialog>
  )
}
