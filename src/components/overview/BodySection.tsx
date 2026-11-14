import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { STATUS_RANK, type Status } from '../../data/vitals'
import type { SystemId } from '../../data/systems'
import type { Evaluation } from '../../lib/health'
import { sfx } from '../../lib/sfx'
import { Button, DUR, EASE, Notice, StatusIcon, cx } from '../ui'
import type { SaveOutcome } from './readingLogic'

/**
 * Phones: the 3D body folds into a section. Closed, the viewer is not mounted at all (no WebGL on a phone that
 * did not ask for it) and a one-line system summary keeps the status visible. Same header look as `Disclosure`;
 * controlled here because the page must open it when a body system gets selected.
 */
export function BodySection({ open, onToggle, ev, onSelect, children }: { open: boolean; onToggle: (open: boolean) => void; ev: Evaluation; onSelect: (s: SystemId) => void; children: ReactNode }) {
  const panelId = `${useId()}-panel`
  const reduce = useReducedMotion()
  return (
    <section data-demo="body">
      <h2 className="m-0 font-[inherit]">
        <button
          type="button"
          data-demo="body-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            onToggle(!open)
            sfx(open ? 'close' : 'open')
          }}
          className="press flex min-h-11 w-full items-center justify-between gap-4 rounded-lg border-b border-line pb-3 pt-1 text-left transition-colors hover:border-edge"
        >
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-heading text-ink">Body systems</span>
            <span className="text-sm text-dim">{open ? '3D body' : 'Show the 3D body'}</span>
          </span>
          <ChevronDown className={cx('h-4 w-4 shrink-0 text-dim transition-transform duration-200', open && 'rotate-180')} aria-hidden="true" />
        </button>
      </h2>
      {!open && <SystemSummary ev={ev} onSelect={onSelect} />}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={panelId}
            key="panel"
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: 'auto', opacity: 1, transition: { height: { duration: DUR.base, ease: EASE.out }, opacity: { duration: DUR.fast, delay: 0.04 } } }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0, transition: { height: { duration: DUR.fast, ease: EASE.in }, opacity: { duration: DUR.instant } } }}
            className="overflow-hidden"
          >
            <div className="pt-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}

/** Closed state: the systems that need attention (each opens its panel), then a count of the rest. */
function SystemSummary({ ev, onSelect }: { ev: Evaluation; onSelect: (s: SystemId) => void }) {
  const flagged = ev.systems
    .filter((s) => ev.systemMeasured[s.id] && ev.systemStatus[s.id] !== 'ok')
    .sort((a, b) => STATUS_RANK[ev.systemStatus[b.id] as Status] - STATUS_RANK[ev.systemStatus[a.id] as Status])
  const normal = ev.systems.filter((s) => ev.systemMeasured[s.id] && ev.systemStatus[s.id] === 'ok').length
  const none = ev.systems.filter((s) => !ev.systemMeasured[s.id]).length
  const rest = [normal && `${normal} normal`, none && `${none} not measured`].filter(Boolean).join(' · ')
  return (
    <div className="pt-3">
      {flagged.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Body systems that need attention">
          {flagged.map((s) => (
            <li key={s.id}>
              <Button size="sm" onClick={() => onSelect(s.id)}>
                <StatusIcon status={ev.systemStatus[s.id]} size={14} />
                {s.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-dim">{flagged.length ? `Other systems: ${rest}.` : `${rest}.`}</p>
    </div>
  )
}

/** After a save: the new value against the previous one and what happened to the alert. Lives in an aria-live region. */
export function SaveStatus({ outcome, onDismiss }: { outcome: SaveOutcome | null; onDismiss: () => void }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {outcome && (
        <Notice
          className="mb-6"
          tone={outcome.tone}
          title={outcome.title}
          action={
            <Button size="sm" variant="quiet" onClick={onDismiss}>
              Dismiss
            </Button>
          }
        >
          {outcome.detail}
        </Notice>
      )}
    </div>
  )
}
