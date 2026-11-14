import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ScoreRing, Spinner, StatusPill } from '../components/ui'
import { STATUS_COLOR } from '../data/vitals'
import { evaluate, type Evaluation } from '../lib/health'
import { useSession } from '../lib/session'

export default function Roster() {
  const { crew, backend, mission, user } = useSession()
  const [evals, setEvals] = useState<Record<number, Evaluation>>({})

  useEffect(() => {
    if (!backend || !mission) return
    let alive = true
    Promise.all(crew.map(async (c) => [c.id, evaluate(await backend.measurements(c.id, mission.day - 30), mission.profileId, mission.day, user?.role === 'ground')] as const)).then(
      (list) => alive && setEvals(Object.fromEntries(list)),
    )
    return () => {
      alive = false
    }
  }, [backend, crew, mission, user])

  if (!crew.length) return <Spinner label="Loading crew" />
  const sorted = [...crew].sort((a, b) => (evals[a.id]?.score ?? 100) - (evals[b.id]?.score ?? 100))

  return (
    <div className="space-y-6">
      <div>
        <p className="label">{user?.role === 'surgeon' ? 'Flight surgeon console' : 'Mission control'}</p>
        <h1 className="font-display text-3xl font-bold">Crew status</h1>
        <p className="mt-1 text-sm text-dim">Sorted by who needs attention first.</p>
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        {sorted.map((c, i) => {
          const ev = evals[c.id]
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, ease: [0.22, 1, 0.36, 1] }} whileHover={{ y: -6 }}>
              <Link to={`/crew/${c.id}`} className="glass block h-full rounded-3xl p-5 transition hover:border-cyan/40">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full font-bold text-space" style={{ background: c.color }}>
                    {c.callsign}
                  </span>
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-xs text-dim">{c.position}</div>
                  </div>
                </div>
                {ev ? (
                  <>
                    <div className="mt-5 flex justify-center">
                      <ScoreRing score={ev.score} status={ev.overall} size={132} />
                    </div>
                    <div className="mt-4 flex justify-center">
                      <StatusPill status={ev.overall} />
                    </div>
                    <div className="mt-4 space-y-1.5">
                      {ev.alerts.slice(0, 2).map((a) => (
                        <div key={a.key} className="flex items-center gap-2 text-sm">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_COLOR[a.level] }} />
                          <span className="truncate text-soft">{a.title}</span>
                        </div>
                      ))}
                      {ev.alerts.length === 0 && <div className="text-sm text-ok">No open alerts</div>}
                    </div>
                  </>
                ) : (
                  <div className="mt-6">
                    <Spinner />
                  </div>
                )}
              </Link>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
