// The week view: block progress, a 7-day strip (training / rest / done), and weekly adherence.
import { Check } from 'lucide-react'
import { WEEKDAY, WEEKDAY_SHORT } from '../../data/coach/catalog'
import type { Programme } from '../../lib/coach/generate'
import { addDays } from '../../lib/coach/profile'
import { cx, Meter, Tabs } from '../ui'
import { dayNumber } from './format'

export function WeekPlan({ p, week, onWeek, selected, onSelect, today }: { p: Programme; week: number; onWeek: (w: number) => void; selected: string; onSelect: (date: string) => void; today: string }) {
  const w = p.weeks[week - 1]
  const start = addDays(p.blockStart, (week - 1) * 7)
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, date: addDays(start, d), s: w.sessions.find((x) => x.weekday === d) ?? null }))
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[15px] font-semibold text-ink">
          Block {p.blockNumber} · week {p.weekIndex} of 4
        </p>
        <p className="text-sm text-dim">{p.weeks[p.weekIndex - 1].label}</p>
      </div>
      <Meter className="mt-2" value={p.weekIndex} min={0} max={4} label={`Week ${p.weekIndex} of 4 in this block`} />

      <Tabs
        className="mt-6"
        label="Week of the block"
        variant="line"
        value={String(week)}
        onChange={(v) => onWeek(Number(v))}
        options={p.weeks.map((x) => ({ value: String(x.index), label: x.index === p.weekIndex ? `Week ${x.index} · now` : `Week ${x.index}` }))}
      />
      <p className="mt-3 text-sm text-soft">
        <span className="text-ink">{w.label}.</span> {w.note}
      </p>

      <ol className="mt-4 grid grid-cols-7 gap-1" aria-label={`Week ${week} schedule`}>
        {days.map(({ d, date, s }) => {
          const done = !!s && p.adherence.doneKeys.includes(s.key)
          const isToday = date === today
          const isSel = date === selected
          return (
            <li key={d}>
              <button
                type="button"
                onClick={() => s && onSelect(date)}
                disabled={!s}
                aria-pressed={isSel}
                aria-label={`${WEEKDAY[d]}${isToday ? ', today' : ''}: ${s ? s.title : 'rest day'}${done ? ', done' : ''}`}
                className={cx(
                  'flex min-h-16 w-full flex-col items-center justify-center gap-1 rounded-lg border px-0.5 py-2 text-center transition-colors',
                  isSel ? 'border-ink bg-panel2' : isToday ? 'border-edge' : 'border-line',
                  s ? 'hover:bg-panel2' : 'cursor-default opacity-70',
                )}
              >
                <span className="text-xs text-dim">{WEEKDAY_SHORT[d]}</span>
                <span className={cx('text-[15px] font-medium', s ? 'text-ink' : 'text-dim')}>{dayNumber(date)}</span>
                {done ? <Check className="h-4 w-4 text-ink" aria-hidden="true" /> : <span className={cx('h-1.5 w-1.5 rounded-full', s ? 'bg-soft' : 'bg-transparent')} aria-hidden="true" />}
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-sm text-dim">Dot: training day. Tick: session logged. Outlined: today.</p>

      {week === p.weekIndex && (
        <div className="mt-6">
          <div className="flex items-baseline justify-between gap-3">
            <p className="label">Sessions done this week</p>
            <p className="text-[15px] text-ink">
              {p.adherence.done} of {p.adherence.planned}
            </p>
          </div>
          <Meter className="mt-2" value={p.adherence.done} max={Math.max(1, p.adherence.planned)} label={`${p.adherence.done} of ${p.adherence.planned} sessions done this week`} />
        </div>
      )}
    </div>
  )
}
