// Training-profile editor (a Sheet): focus areas with AURA's suggestions and reasons, level, days, minutes,
// equipment and movement limitations.
import { useEffect, useState } from 'react'
import { DAY_OPTIONS, EQUIPMENT, FOCUS, LEVELS, LIMITS, MAX_FOCUS, MINUTE_OPTIONS } from '../../data/coach/catalog'
import type { Context } from '../../data/contexts'
import type { FocusSuggestionFull } from '../../lib/coach/suggest'
import type { EquipmentId, FocusId, Level, LimitId, TrainingProfile } from '../../lib/coach/types'
import { Badge, Button, Checkbox, Field, Notice, Select, Sheet, Tabs } from '../ui'

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function ProfileEditor({ open, onClose, context, initial, suggestions, onSave, saving, error }: { open: boolean; onClose: () => void; context: Context; initial: TrainingProfile; suggestions: FocusSuggestionFull[]; onSave: (p: TrainingProfile) => void; saving: boolean; error: string | null }) {
  const [p, setP] = useState(initial)
  useEffect(() => {
    if (open) setP(initial)
  }, [open, initial])
  const sug = (id: FocusId) => suggestions.find((s) => s.id === id && s.score >= 2)
  const equipment = EQUIPMENT.filter((e) => e.contexts.includes(context))
  const set = <K extends keyof TrainingProfile>(k: K, v: TrainingProfile[K]) => setP((x) => ({ ...x, [k]: v }))
  const level = LEVELS.find((l) => l.id === p.level)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Your training profile"
      description="AURA builds your programme from these answers. Suggestions come from your health profile, readings and last assessment."
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={!p.focus.length} onClick={() => onSave({ ...p, confirmed: true })}>
            Save programme
          </Button>
        </>
      }
    >
      <div className="space-y-8">
        <fieldset>
          <legend className="text-[15px] font-semibold text-ink">What should the programme focus on?</legend>
          <p className="mt-1 text-sm text-dim">Pick up to {MAX_FOCUS}. The first one you pick leads the plan.</p>
          <div className="mt-2 divide-y divide-line">
            {FOCUS.map((f) => {
              const s = sug(f.id)
              const on = p.focus.includes(f.id)
              return (
                <Checkbox
                  key={f.id}
                  checked={on}
                  disabled={!on && p.focus.length >= MAX_FOCUS}
                  onChange={() => set('focus', toggle(p.focus, f.id))}
                  label={
                    <span className="block">
                      <span className="flex flex-wrap items-center gap-2 text-[15px] text-ink">
                        {f.label}
                        {s && <Badge>Suggested</Badge>}
                        {on && p.focus[0] === f.id && <Badge>Leads the plan</Badge>}
                      </span>
                      <span className="mt-0.5 block text-sm text-dim">{f.what}</span>
                      {s && <span className="mt-1 block text-sm text-soft">Why: {s.reasons.join(' ')}</span>}
                    </span>
                  }
                />
              )
            })}
          </div>
        </fieldset>

        <div>
          <p className="text-[15px] font-semibold text-ink">Fitness level</p>
          <Tabs className="mt-2" label="Fitness level" value={p.level} onChange={(v: Level) => set('level', v)} options={LEVELS.map((l) => ({ value: l.id, label: l.label }))} full />
          {level && <p className="mt-2 text-sm text-dim">{level.what}</p>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Days per week">
            <Select value={p.daysPerWeek} onChange={(e) => set('daysPerWeek', Number(e.target.value))}>
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Minutes per session">
            <Select value={p.minutes} onChange={(e) => set('minutes', Number(e.target.value))}>
              {MINUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <fieldset>
          <legend className="text-[15px] font-semibold text-ink">Equipment you have</legend>
          <div className="mt-1 grid sm:grid-cols-2 sm:gap-x-6">
            {equipment.map((e) => (
              <Checkbox key={e.id} label={e.label} checked={p.equipment.includes(e.id)} onChange={() => set('equipment', toggle<EquipmentId>(p.equipment, e.id))} />
            ))}
          </div>
          <p className="mt-1 text-sm text-dim">Body-weight exercises are always included.</p>
        </fieldset>

        <fieldset>
          <legend className="text-[15px] font-semibold text-ink">Anything that limits how you move?</legend>
          <div className="mt-1 grid sm:grid-cols-2 sm:gap-x-6">
            {LIMITS.map((l) => (
              <Checkbox key={l.id} label={l.label} checked={p.limits.includes(l.id)} onChange={() => set('limits', toggle<LimitId>(p.limits, l.id))} />
            ))}
          </div>
          <p className="mt-1 text-sm text-dim">AURA swaps exercises that load these areas and tells you why.</p>
        </fieldset>

        {error && (
          <Notice tone="warn" title="Could not save">
            {error}
          </Notice>
        )}
      </div>
    </Sheet>
  )
}
