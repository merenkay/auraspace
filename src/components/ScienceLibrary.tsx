import { ChevronDown, SearchX } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ENV_VALUES, EXERCISE_KB, HAZARD_LABEL, KB_RECORDS, type HazardId, type KbRecord } from '../data/kb'
import { Badge, Card, Dialog, EmptyState, Field, Input, List, Select, ShowMore, SourceLink, Tabs } from './ui'

type Props = { onClose: () => void; initialQuery?: string }
type LibraryTab = 'risks' | 'environment' | 'exercise'

/** Browser for the sourced NASA / CSA knowledge base. Opens as a dialog (a bottom sheet on phones). */
export default function ScienceLibrary({ onClose, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [hazard, setHazard] = useState<HazardId | 'all'>('all')
  const [tab, setTab] = useState<LibraryTab>('risks')

  const risks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return KB_RECORDS.filter(
      (r) =>
        (hazard === 'all' || r.hazards.includes(hazard)) &&
        (!q || `${r.title} ${r.summary} ${r.findings.map((f) => f.text).join(' ')}`.toLowerCase().includes(q)),
    )
  }, [query, hazard])

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Science Library"
      description="Facts taken from official NASA Human Research Program and Canadian Space Agency pages. Each finding shows the source sentence it is based on."
    >
      <div className="sticky top-0 z-10 -mx-5 space-y-3 bg-panel2 px-5 pb-3 pt-1">
        <Tabs<LibraryTab>
          variant="line"
          label="Library section"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'risks', label: `Health risks (${KB_RECORDS.length})` },
            { value: 'environment', label: `Environment values (${ENV_VALUES.length})` },
            { value: 'exercise', label: 'Exercise' },
          ]}
        />
        {tab === 'risks' && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
            <Field label="Search">
              <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search risks and findings" />
            </Field>
            <Field label="Hazard">
              <Select value={hazard} onChange={(e) => setHazard(e.target.value as HazardId | 'all')}>
                <option value="all">All hazards</option>
                {(Object.keys(HAZARD_LABEL) as HazardId[]).map((h) => (
                  <option key={h} value={h}>
                    {HAZARD_LABEL[h]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
      </div>

      {tab === 'risks' && (
        <div>
          <p className="mb-3 text-sm text-dim" role="status">
            {risks.length} of {KB_RECORDS.length} {risks.length === 1 ? 'record' : 'records'}
          </p>
          {risks.length ? (
            <div className="space-y-4">
              {risks.map((r) => (
                <RecordCard key={r.id} r={r} compact />
              ))}
            </div>
          ) : (
            <EmptyState icon={SearchX} title="No matching records" description="Try a shorter search, or set the hazard back to “All hazards”." />
          )}
        </div>
      )}

      {tab === 'environment' && (
        <List className="border-t-0">
          {ENV_VALUES.map((e) => (
            <li key={e.id} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="text-[15px] font-semibold text-ink">{e.parameter}</h3>
                <span className="text-metric-md text-ink">
                  {e.value == null ? <span className="text-base font-normal text-dim">Not verified</span> : `${e.value}${e.valueMax != null ? `–${e.valueMax}` : ''}`}
                  {e.value != null && <span className="ml-1.5 text-sm font-normal text-dim">{e.unit}</span>}
                </span>
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-dim">
                {e.context}
                {e.confidence === 'secondary' && <Badge tone="warn">Secondary source</Badge>}
              </p>
              {e.quote && <Quote text={e.quote} />}
              {e.notes && (
                <ShowMore lines={1} className="mt-2 text-sm text-dim">
                  {e.notes}
                </ShowMore>
              )}
              <div className="mt-2">
                <SourceLink href={e.source.url} org={e.source.organization} title={`${e.source.title}${e.source.date ? ` (${e.source.date})` : ''}`} />
              </div>
            </li>
          ))}
        </List>
      )}

      {tab === 'exercise' && (
        <List className="border-t-0">
          {EXERCISE_KB.equipment.map((q) => (
            <li key={q.id} className="py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[15px] font-semibold text-ink">{q.name}</h3>
                <Badge>{q.category}</Badge>
              </div>
              <ShowMore lines={2} className="mt-1 text-sm text-soft">
                {q.description}
              </ShowMore>
              {q.capabilities.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-soft">
                  {q.capabilities.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
              {q.quote && <Quote text={q.quote} />}
              <div className="mt-2">
                <SourceLink href={q.source.url} org={hostOf(q.source.url)} title={q.source.title} />
              </div>
            </li>
          ))}
          {EXERCISE_KB.facts.map((f) => (
            <li key={f.id} className="py-4">
              <p className="text-sm text-ink">{f.text}</p>
              {f.quote && <Quote text={f.quote} />}
              <div className="mt-2">
                <SourceLink href={f.source.url} org={f.source.organization ?? hostOf(f.source.url)} title={f.source.title} />
              </div>
            </li>
          ))}
        </List>
      )}
    </Dialog>
  )
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Source'
  }
}

/** One sourced record: hazards, summary, findings with their source sentence, countermeasures, unknowns. `compact` starts it collapsed. */
export function RecordCard({ r, compact = false }: { r: KbRecord; compact?: boolean }) {
  return (
    <Card tone="well" pad="none">
      <details className="group" open={!compact}>
        <summary className="press flex min-h-11 cursor-pointer list-none items-start gap-3 rounded-2xl p-4 [&::-webkit-details-marker]:hidden">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {r.hazards.map((h) => (
                <Badge key={h}>{HAZARD_LABEL[h]}</Badge>
              ))}
              {r.lastUpdated && <span className="meta">updated {r.lastUpdated}</span>}
            </div>
            <h3 className="mt-2 text-[15px] font-semibold leading-snug text-ink">{r.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-soft group-[:not([open])]:line-clamp-2">{r.summary}</p>
          </div>
          <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-dim transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="border-t border-line px-4 pb-4 pt-3">
          {r.findings.length > 0 && (
            <ul className="space-y-3">
              {r.findings.map((f) => (
                <li key={f.text} className="text-sm text-ink">
                  {f.text}
                  {f.quote && <Quote text={f.quote} />}
                </li>
              ))}
            </ul>
          )}
          {r.countermeasures.length > 0 && <MiniList title="Countermeasures" items={r.countermeasures} />}
          {r.limitations.length > 0 && <MiniList title="What is still unknown" items={r.limitations} />}
          <div className="mt-3">
            <SourceLink href={r.url} org={r.organization} title={r.title} />
          </div>
        </div>
      </details>
    </Card>
  )
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4">
      <p className="label">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-soft">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}

function Quote({ text }: { text: string }) {
  return <blockquote className="mt-2 border-l-2 border-edge pl-3 text-sm italic leading-snug text-dim">“{text}”</blockquote>
}
