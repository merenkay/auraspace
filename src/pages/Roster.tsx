import { Flag } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Avatar, Badge, Card, PageHeader, ScoreRing, Skeleton, Stagger, StaggerItem, StatusIcon, StatusPill, cx } from '../components/ui'
import { evaluate, type Evaluation } from '../lib/health'
import { useSession } from '../lib/session'

function CardSkeleton() {
  return (
    <Card className="h-full">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
      <Skeleton className="mx-auto mt-5 h-[116px] w-[116px] rounded-full" />
      <Skeleton className="mx-auto mt-4 h-7 w-24 rounded-full" />
    </Card>
  )
}

export default function Roster() {
  const { crew, backend, mission, user } = useSession()
  const [evals, setEvals] = useState<Record<number, Evaluation>>({})

  useEffect(() => {
    if (!backend || !mission) return
    let alive = true
    Promise.all(crew.map(async (c) => [c.id, evaluate(await backend.measurements(c.id, mission.day - 30), mission, user?.role === 'ground')] as const)).then(
      (list) => alive && setEvals(Object.fromEntries(list)),
    )
    return () => {
      alive = false
    }
  }, [backend, crew, mission, user])

  const header = <PageHeader eyebrow={user?.role === 'surgeon' ? 'Flight surgeon console' : 'Mission control'} title="Crew status" description="Sorted by who needs attention first." />

  if (!crew.length)
    return (
      <div>
        {header}
        <div role="status" aria-label="Loading crew" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 lg:gap-6">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  const sorted = [...crew].sort((a, b) => (evals[a.id]?.score ?? 100) - (evals[b.id]?.score ?? 100))
  const first = sorted[0] && evals[sorted[0].id]
  const firstNeedsAttention = first != null && first.overall !== 'ok'

  return (
    <div>
      {header}
      <Stagger className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 lg:gap-6">
        {sorted.map((c, i) => {
          const ev = evals[c.id]
          const priority = i === 0 && firstNeedsAttention
          return (
            <StaggerItem key={c.id} className="h-full">
              <Link to={`/crew/${c.id}`} className="block h-full rounded-2xl">
                <Card className={cx('h-full transition-colors hover:bg-panel2', ev?.overall === 'crit' ? 'border-crit/50' : ev?.overall === 'warn' ? 'border-warn/40' : '')}>
                  {priority && (
                    <Badge tone={first.overall} icon={Flag} className="mb-3">
                      Review first
                    </Badge>
                  )}
                  <div className="flex items-center gap-3">
                    <Avatar name={c.name} text={c.callsign} size={40} />
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold leading-snug text-ink">{c.name}</div>
                      <div className="text-sm text-dim">{c.position}</div>
                    </div>
                  </div>
                  {ev ? (
                    <>
                      <div className="mt-5 flex justify-center">
                        <ScoreRing score={ev.score} status={ev.overall} size={116} />
                      </div>
                      <div className="mt-4 flex justify-center">
                        <StatusPill status={ev.overall} />
                      </div>
                      <ul className="mt-4 space-y-2 border-t border-line pt-4">
                        {ev.alerts.slice(0, 2).map((a) => (
                          <li key={a.key} className="flex items-start gap-2 text-sm">
                            <span className="mt-0.5">
                              <StatusIcon status={a.level} size={15} />
                            </span>
                            <span className="min-w-0 text-soft">{a.title}</span>
                          </li>
                        ))}
                        {ev.alerts.length === 0 && <li className="text-sm text-dim">No open alerts</li>}
                      </ul>
                    </>
                  ) : (
                    <div className="mt-5" role="status" aria-label="Loading status">
                      <Skeleton className="mx-auto h-[116px] w-[116px] rounded-full" />
                      <Skeleton className="mx-auto mt-4 h-7 w-24 rounded-full" />
                    </div>
                  )}
                </Card>
              </Link>
            </StaggerItem>
          )
        })}
      </Stagger>
    </div>
  )
}
