// One planned session: header, why it is in the plan, and the exercises (each expands to instructions).
import { Check, ChevronDown, Pause, Repeat } from 'lucide-react'
import type { ReactNode } from 'react'
import { EXERCISE_BY_ID } from '../../data/coach/exercises'
import { COACH_RULES, COACH_SOURCES, ruleSource, type CoachRuleId } from '../../data/coach/sources'
import type { PlannedExercise, PlannedSession, Substitution } from '../../lib/coach/types'
import { Badge, cx, SourceLink } from '../ui'
import { doseText, shortDate } from './format'

export function RuleCite({ ruleId, rule, className }: { ruleId?: string; rule?: boolean; className?: string }) {
  const r = ruleId ? COACH_RULES[ruleId as CoachRuleId] : null
  return (
    <span className={cx('mt-1 flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {r && <SourceLink href={ruleSource(r.id as CoachRuleId).url} org={ruleSource(r.id as CoachRuleId).org} title={ruleSource(r.id as CoachRuleId).title} />}
      {rule && <Badge>AURA rule</Badge>}
    </span>
  )
}

function ExerciseItem({ item, swap }: { item: PlannedExercise; swap?: Substitution }) {
  const ex = EXERCISE_BY_ID[item.exerciseId]
  if (!ex) return null
  const src = ex.source ? COACH_SOURCES[ex.source] : null
  const from = swap ? EXERCISE_BY_ID[swap.from] : null
  return (
    <li>
      <details className="group">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-panel2 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-medium leading-snug text-ink">{ex.name}</span>
            <span className="mt-0.5 block text-sm leading-snug text-dim">{doseText(item)}</span>
          </span>
          {swap && <Badge icon={Repeat}>Swapped</Badge>}
          <ChevronDown className="h-4 w-4 shrink-0 text-dim transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="space-y-3 px-2 pb-4 pt-1 text-sm text-soft">
          <ol className="list-decimal space-y-1 pl-5">
            {ex.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {ex.cues.length > 0 && <p className="text-ink">{ex.cues.join(' ')}</p>}
          <dl className="grid gap-1 sm:grid-cols-[auto_1fr] sm:gap-x-3">
            <dt className="text-dim">Easier</dt>
            <dd>{ex.easier}</dd>
            <dt className="text-dim">Harder</dt>
            <dd>{ex.harder}</dd>
          </dl>
          {from && swap && (
            <p>
              <span className="text-dim">Instead of {from.name.toLowerCase()}: </span>
              {swap.reason}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {src ? <SourceLink href={src.url} org={src.org} title={src.title} /> : <Badge>AURA description</Badge>}
            {ex.protocol && <SourceLink href={ruleSource(ex.protocol.ruleId).url} org={ruleSource(ex.protocol.ruleId).org} title="Intensity" />}
          </div>
        </div>
      </details>
    </li>
  )
}

export function SessionView({ session, subs, isToday, done, onHold, footer }: { session: PlannedSession; subs: Substitution[]; isToday: boolean; done: boolean; onHold: boolean; footer?: ReactNode }) {
  const count = session.main.reduce((n, p) => n + p.items.length, 0)
  const swapOf = (id: string) => subs.find((s) => s.to === id)
  const parts = [session.warmup, ...session.main, session.cooldown].filter((p) => p.items.length)
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="meta">{isToday ? `Today · ${shortDate(session.date)}` : shortDate(session.date)}</p>
          <h3 className="mt-1 text-heading text-ink">{session.title}</h3>
          <p className="text-sm text-dim">
            About {session.minutes} min · {count} exercise{count === 1 ? '' : 's'}
          </p>
        </div>
        {onHold && isToday ? (
          <Badge tone="crit" icon={Pause}>
            On hold
          </Badge>
        ) : done ? (
          <Badge icon={Check}>Done</Badge>
        ) : null}
      </div>
      <div className="mt-3 max-w-prose">
        <p className="text-soft">
          <span className="text-dim">Why this is in your plan: </span>
          {session.why}
        </p>
        <RuleCite ruleId={session.whyRule ?? undefined} />
      </div>
      <div className={cx('mt-4 space-y-6', onHold && isToday && 'opacity-60')}>
        {parts.map((p) => (
          <div key={p.title}>
            <h4 className="label mb-1">
              {p.title} · {p.minutes} min
            </h4>
            <ul className="divide-y divide-line border-y border-line">
              {p.items.map((i) => (
                <ExerciseItem key={i.exerciseId} item={i} swap={swapOf(i.exerciseId)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
      {footer}
    </div>
  )
}
