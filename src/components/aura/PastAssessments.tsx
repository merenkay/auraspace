import { History } from 'lucide-react'
import { URGENCY_TEXT } from '../../lib/doctor'
import { FINDING_BY_ID } from '../../lib/doctor/findings'
import type { SavedAssessment } from '../../lib/clinic'
import { Badge, EmptyState, List, Row, Section } from '../ui'

const TONE = { emergency: 'crit', urgent: 'warn', soon: 'neutral', selfcare: 'neutral' } as const

export default function PastAssessments({ items, error }: { items: SavedAssessment[] | null; error?: string | null }) {
  return (
    <Section title="Past assessments" description="Saved consultations, newest first. Your coach uses the latest one.">
      {error ? (
        <p className="text-sm text-crit">{error}</p>
      ) : !items?.length ? (
        <EmptyState icon={History} title="Nothing saved yet" description="After a consultation, choose “Save to my record” to keep it here." />
      ) : (
        <List>
          {items.map((a) => {
            const yes = a.findings.filter((f) => f.answer === 'yes').map((f) => FINDING_BY_ID[f.id]?.label ?? f.id)
            return (
              <Row
                key={a.id}
                title={a.conditionName}
                description={`${new Date(a.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} · ${yes.slice(0, 4).join(', ') || 'no symptoms recorded'}${yes.length > 4 ? '…' : ''}`}
                trailing={<Badge tone={TONE[a.urgency]}>{URGENCY_TEXT[a.urgency].short}</Badge>}
              />
            )
          })}
        </List>
      )}
    </Section>
  )
}
