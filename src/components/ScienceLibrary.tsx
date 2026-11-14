import { useMemo, useState } from 'react'
import { ENV_VALUES, EXERCISE_KB, HAZARD_LABEL, KB_RECORDS, type HazardId, type KbRecord } from '../data/kb'

type Props = { onClose: () => void; initialQuery?: string }

export default function ScienceLibrary({ onClose, initialQuery = '' }: Props) {
  const [query, setQuery] = useState(initialQuery)
  const [hazard, setHazard] = useState<HazardId | 'all'>('all')
  const [tab, setTab] = useState<'risks' | 'environment' | 'exercise'>('risks')

  const risks = useMemo(() => {
    const q = query.trim().toLowerCase()
    return KB_RECORDS.filter(
      (r) =>
        (hazard === 'all' || r.hazards.includes(hazard)) &&
        (!q || `${r.title} ${r.summary} ${r.findings.map((f) => f.text).join(' ')}`.toLowerCase().includes(q)),
    )
  }, [query, hazard])

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div
        className="flex w-full max-w-5xl flex-col overflow-hidden border border-white/10 bg-slate-900 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 p-4">
          <div className="mr-auto">
            <h2 className="text-xl font-bold text-white">Science Library</h2>
            <p className="text-xs text-slate-400">
              Facts extracted from official NASA Human Research Program and Canadian Space Agency pages. Each finding shows the
              source sentence it is based on.
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 text-3xl leading-none text-slate-400 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
          {(['risks', 'environment', 'exercise'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold capitalize ${tab === t ? 'bg-sky-500 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}
            >
              {t === 'risks' ? `Health risks (${KB_RECORDS.length})` : t === 'environment' ? `Environment values (${ENV_VALUES.length})` : 'Exercise'}
            </button>
          ))}
          {tab === 'risks' && (
            <>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="ml-auto w-40 rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-sm text-white outline-none focus:border-sky-400 sm:w-56"
              />
              <select
                value={hazard}
                onChange={(e) => setHazard(e.target.value as HazardId | 'all')}
                className="rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 text-sm text-white"
              >
                <option value="all">All hazards</option>
                {(Object.keys(HAZARD_LABEL) as HazardId[]).map((h) => (
                  <option key={h} value={h}>
                    {HAZARD_LABEL[h]}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {tab === 'risks' && (risks.length ? risks.map((r) => <RecordCard key={r.id} r={r} />) : <Empty />)}

          {tab === 'environment' &&
            ENV_VALUES.map((e) => (
              <div key={e.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold text-white">{e.parameter}</h3>
                  <span className="text-xl font-bold tabular-nums text-sky-300">
                    {e.value == null ? 'not verified' : `${e.value}${e.valueMax != null ? `–${e.valueMax}` : ''} ${e.unit}`}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {e.context}
                  {e.confidence === 'secondary' && <span className="ml-2 rounded bg-amber-400/15 px-1.5 text-amber-300">secondary source</span>}
                </p>
                {e.quote && <Quote text={e.quote} />}
                {e.notes && <p className="mt-1 text-xs text-slate-400">{e.notes}</p>}
                <SourceLink url={e.source.url} label={`${e.source.organization} — ${e.source.title}${e.source.date ? ` (${e.source.date})` : ''}`} />
              </div>
            ))}

          {tab === 'exercise' && (
            <>
              {EXERCISE_KB.equipment.map((q) => (
                <div key={q.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <h3 className="font-semibold text-white">
                    {q.name} <span className="ml-1 text-xs uppercase tracking-wider text-slate-400">{q.category}</span>
                  </h3>
                  <p className="mt-1 text-sm text-slate-200">{q.description}</p>
                  {q.capabilities.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-sm text-slate-300">
                      {q.capabilities.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  )}
                  {q.quote && <Quote text={q.quote} />}
                  <SourceLink url={q.source.url} label={q.source.title} />
                </div>
              ))}
              {EXERCISE_KB.facts.map((f) => (
                <div key={f.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-sm text-slate-100">{f.text}</p>
                  {f.quote && <Quote text={f.quote} />}
                  <SourceLink url={f.source.url} label={f.source.title} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function RecordCard({ r, compact = false }: { r: KbRecord; compact?: boolean }) {
  return (
    <details className="group rounded-2xl border border-white/10 bg-white/5 p-4" open={!compact}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center gap-2">
          {r.hazards.map((h) => (
            <span key={h} className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
              {HAZARD_LABEL[h]}
            </span>
          ))}
          {r.lastUpdated && <span className="text-[10px] text-slate-500">updated {r.lastUpdated}</span>}
        </div>
        <h3 className="mt-1 font-semibold text-white">{r.title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-300">{r.summary}</p>
      </summary>
      {r.findings.length > 0 && (
        <ul className="mt-3 space-y-2">
          {r.findings.map((f) => (
            <li key={f.text} className="text-sm text-slate-100">
              • {f.text}
              {f.quote && <Quote text={f.quote} />}
            </li>
          ))}
        </ul>
      )}
      {r.countermeasures.length > 0 && <MiniList title="Countermeasures" items={r.countermeasures} />}
      {r.limitations.length > 0 && <MiniList title="What is still unknown" items={r.limitations} />}
      <SourceLink url={r.url} label={`${r.organization} — ${r.title}`} />
    </details>
  )
}

function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-3">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</p>
      <ul className="mt-1 list-disc pl-5 text-sm text-slate-300">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}

function Quote({ text }: { text: string }) {
  return <blockquote className="mt-1 border-l-2 border-sky-400/40 pl-2 text-xs italic leading-snug text-slate-400">“{text}”</blockquote>
}

function SourceLink({ url, label }: { url: string; label: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 block text-xs text-sky-300 underline">
      Source: {label}
    </a>
  )
}

function Empty() {
  return <p className="py-10 text-center text-sm text-slate-400">No matching records.</p>
}
