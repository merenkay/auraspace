import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState, type FormEvent } from 'react'
import { Logo, Panel, Spinner } from '../components/ui'
import { STATUS_COLOR, VITAL_BY_KEY, type VitalKey } from '../data/vitals'
import { answer, topicFor, type AuraAnswer } from '../lib/aura'
import { useCrewData, useSession } from '../lib/session'

type Turn = { id: number; a: AuraAnswer }

export default function Aura({ crewId }: { crewId: number }) {
  const { mission, user } = useSession()
  const data = useCrewData(crewId)
  const ev = data.ev
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [hint, setHint] = useState<string | null>(null)

  const suggestions = useMemo(() => {
    if (!ev) return [] as VitalKey[]
    const fromAlerts = ev.alerts.map((a) => a.key).filter((k): k is VitalKey => k in VITAL_BY_KEY)
    return [...new Set([...fromAlerts, 'bp', 'sleep', 'vision'] as VitalKey[])].slice(0, 4)
  }, [ev])

  if (!ev) return <Spinner />

  const ask = (key: VitalKey, q: string) => {
    setHint(null)
    setTurns((t) => [{ id: Date.now(), a: answer(key, q, ev, data.rows, mission?.day ?? 142) }, ...t].slice(0, 6))
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const q = text.trim()
    if (!q) return
    const k = topicFor(q)
    if (!k) {
      setHint('In onboard mode I can explain a specific measurement — try blood pressure, sleep, mood, vision, water or exercise.')
      return
    }
    setText('')
    ask(k, q)
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="font-display text-2xl font-bold">AURA</h1>
            <p className="text-sm text-dim">Autonomous Understanding & Response Assistant</p>
          </div>
        </div>
        <span className="rounded-full border border-warn/60 px-3 py-1 text-xs font-bold tracking-wider text-warn">ONBOARD MODE · RULES + NASA SOURCES</span>
      </div>

      <form onSubmit={submit} className="glass flex gap-2 rounded-3xl p-2">
        <label htmlFor="ask" className="sr-only">
          Ask AURA
        </label>
        <input
          id="ask"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={user?.role === 'surgeon' ? 'Ask about this crew member’s readings…' : 'Ask about a measurement, e.g. “Why is my blood pressure high?”'}
          className="min-w-0 flex-1 rounded-2xl bg-transparent px-4 py-3 outline-none"
        />
        <button type="submit" className="rounded-2xl bg-cyan px-6 font-semibold text-space transition hover:bg-ice">
          Ask
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {suggestions.map((k, i) => (
          <motion.button
            key={k}
            type="button"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            onClick={() => ask(k, `Explain my ${VITAL_BY_KEY[k].label.toLowerCase()}`)}
            className="rounded-full border border-line bg-deep/60 px-4 py-2 text-sm text-soft transition hover:border-cyan"
          >
            Explain my {VITAL_BY_KEY[k].label.toLowerCase()}
          </motion.button>
        ))}
      </div>
      {hint && <p className="text-sm text-warn">{hint}</p>}

      <AnimatePresence initial={false}>
        {turns.map((t) => (
          <motion.div key={t.id} layout initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-3">
            <div className="ml-auto w-fit max-w-[80%] rounded-3xl rounded-br-md bg-panel2 px-4 py-2.5 text-sm">{t.a.question}</div>
            <Panel>
              <div className="grid gap-4 sm:grid-cols-2">
                {t.a.sections.map((s, i) => (
                  <motion.div key={s.title} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * i }}>
                    <div className="text-[11px] font-bold tracking-widest text-cyan">{s.title}</div>
                    <p className="mt-1 text-sm leading-relaxed text-soft">{s.text}</p>
                  </motion.div>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border p-3" style={{ borderColor: STATUS_COLOR[t.a.escalation.level], background: `${STATUS_COLOR[t.a.escalation.level]}12` }}>
                <div className="text-[11px] font-bold tracking-widest" style={{ color: STATUS_COLOR[t.a.escalation.level] }}>
                  PROFESSIONAL REVIEW
                </div>
                <p className="mt-1 text-sm">{t.a.escalation.text}</p>
              </div>
              {t.a.refs.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {t.a.refs.map((r) => (
                    <a key={r.url + r.title} href={r.url} target="_blank" rel="noreferrer" className="text-cyan underline">
                      {r.org}: {r.title}
                    </a>
                  ))}
                </div>
              )}
            </Panel>
          </motion.div>
        ))}
      </AnimatePresence>

      {turns.length === 0 && (
        <Panel>
          <p className="text-sm leading-relaxed text-soft">
            AURA explains your readings using only recorded data and sourced NASA material. It separates observations from hypotheses, says what is
            missing, and tells you when the flight surgeon should review. It never diagnoses, prescribes, or changes alert thresholds.
          </p>
        </Panel>
      )}
    </div>
  )
}
