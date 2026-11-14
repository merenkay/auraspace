// The original AURA capability: explain one measurement from recorded data and sourced material.
import { useMemo, useState, type FormEvent } from 'react'
import { VITAL_BY_KEY, type VitalKey } from '../../data/vitals'
import { answer, topicFor, type AuraAnswer } from '../../lib/aura'
import type { Evaluation } from '../../lib/health'
import type { Measurement } from '../../lib/types'
import { Button, Field, Input, Notice, Section, SourceLink } from '../ui'

const TONE = { ok: 'ok', warn: 'warn', crit: 'crit' } as const

export default function ExplainReading({ ev, rows, today }: { ev: Evaluation; rows: Measurement[]; today: number }) {
  const [text, setText] = useState('')
  const [hint, setHint] = useState<string | null>(null)
  const [turns, setTurns] = useState<{ id: number; a: AuraAnswer }[]>([])
  const suggestions = useMemo(() => {
    const fromAlerts = ev.alerts.map((a) => a.key).filter((k): k is VitalKey => k in VITAL_BY_KEY)
    return [...new Set([...fromAlerts, 'bp', 'sleep', 'water'] as VitalKey[])].filter((k) => ev.defByKey[k]).slice(0, 4)
  }, [ev])

  const ask = (key: VitalKey, q: string) => {
    setHint(null)
    setTurns((t) => [{ id: Date.now(), a: answer(key, q, ev, rows, today) }, ...t].slice(0, 4))
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    if (!q) return
    const k = topicFor(q)
    if (!k) return setHint('I can explain one measurement at a time — try blood pressure, sleep, mood, oxygen, water or exercise.')
    setText('')
    ask(k, q)
  }

  return (
    <Section title="Explain a reading" description="AURA explains one of your measurements using only recorded data and sourced material.">
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label="Which measurement?" className="min-w-0 flex-1">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Why is my blood pressure high?" />
        </Field>
        <Button type="submit">Explain</Button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {suggestions.map((k) => (
          <Button key={k} size="sm" variant="quiet" onClick={() => ask(k, `Explain my ${VITAL_BY_KEY[k].label.toLowerCase()}`)}>
            Explain my {VITAL_BY_KEY[k].label.toLowerCase()}
          </Button>
        ))}
      </div>
      {hint && <p className="mt-3 text-sm text-warn">{hint}</p>}
      <div className="mt-8 max-w-3xl space-y-8">
        {turns.map((t) => (
          <article key={t.id} className="space-y-4">
            <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-panel2 px-4 py-3 text-[15px]">{t.a.question}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {t.a.sections.map((s) => (
                <div key={s.title}>
                  <h4 className="text-sm font-semibold text-soft">{s.title.charAt(0) + s.title.slice(1).toLowerCase()}</h4>
                  <p className="mt-1 text-[15px] leading-relaxed">{s.text}</p>
                </div>
              ))}
            </div>
            <Notice tone={TONE[t.a.escalation.level]} title="Professional review">
              {t.a.escalation.text}
            </Notice>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {t.a.refs.map((r) => (
                <SourceLink key={r.url + r.title} href={r.url} org={r.org} title={r.title} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </Section>
  )
}
