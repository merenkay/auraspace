import { Angry, Frown, Laugh, Meh, Smile, type LucideIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { type Values, type VitalDef } from '../data/vitals'
import { Button, Dialog, Field, Input, Notice, StatusText, cx } from './ui'

type Props = {
  def: VitalDef
  values: Values
  onSave: (patch: Partial<Values>) => void
  onClose: () => void
}

// The data layer carries emoji for the 1-5 mood scale; the UI draws these faces instead (same order).
const MOOD_FACES: LucideIcon[] = [Angry, Frown, Meh, Smile, Laugh]

export default function EditVitalModal({ def, values, onSave, onClose }: Props) {
  const formId = useId()
  const [draft, setDraft] = useState<Record<string, string>>(
    Object.fromEntries(def.fields.map((f) => [f.id, String(values[f.id])])),
  )

  const parsed: Partial<Values> = {}
  let valid = true
  for (const f of def.fields) {
    const n = Number(draft[f.id])
    if (draft[f.id].trim() === '' || !Number.isFinite(n) || n < f.min || n > f.max) valid = false
    else parsed[f.id] = n
  }
  const preview = valid ? def.evaluate({ ...values, ...parsed }) : null
  const firstTyped = def.fields.findIndex((f) => !f.scale)

  return (
    <Dialog
      open
      onClose={onClose}
      title={def.label}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={formId} variant="primary" disabled={!valid}>
            Save reading
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onSave(parsed)
        }}
      >
        <Notice title="How to measure">{def.howTo}</Notice>

        {def.fields.map((f, i) => {
          const raw = draft[f.id]
          const n = Number(raw)
          const bad = raw.trim() !== '' && (!Number.isFinite(n) || n < f.min || n > f.max)
          if (f.scale) {
            const labelId = `${formId}-${f.id}`
            return (
              <div key={f.id}>
                <p id={labelId} className="mb-1.5 text-sm font-medium text-soft">
                  {f.label}
                </p>
                <div role="radiogroup" aria-labelledby={labelId} className="flex gap-2">
                  {f.scale.map((s, idx) => {
                    const on = raw === String(idx + 1)
                    const Face = f.id === 'mood' ? MOOD_FACES[idx] : undefined
                    return (
                      <button
                        key={idx}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={`${idx + 1} of ${f.scale!.length}`}
                        onClick={() => setDraft((d) => ({ ...d, [f.id]: String(idx + 1) }))}
                        className={cx('flex h-14 flex-1 items-center justify-center rounded-lg border text-xl font-medium transition-colors', on ? 'border-ink bg-panel text-ink' : 'border-edge text-soft hover:border-soft hover:bg-panel')}
                      >
                        {Face ? <Face className="h-6 w-6" aria-hidden="true" /> : <span aria-hidden="true">{Number.isNaN(Number(s)) ? idx + 1 : s}</span>}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 flex justify-between text-sm text-dim" aria-hidden="true">
                  <span>1</span>
                  <span>{f.scale.length}</span>
                </p>
              </div>
            )
          }
          return (
            <Field key={f.id} label={f.label} hint={`${f.min}–${f.max}${def.unit ? ` ${def.unit}` : ''}`} error={bad ? `Enter a value between ${f.min} and ${f.max}.` : undefined}>
              <Input
                data-autofocus={i === firstTyped ? true : undefined}
                type="number"
                inputMode="decimal"
                min={f.min}
                max={f.max}
                step={f.step}
                value={raw}
                onChange={(e) => setDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                className="h-14 text-metric-md"
              />
            </Field>
          )
        })}

        <div className="min-h-6" aria-live="polite">
          {preview ? <StatusText status={preview}>this reading</StatusText> : <p className="text-sm text-dim">Enter a value in range to see how it is rated.</p>}
        </div>

        <div className="border-t border-line pt-4 text-sm text-dim">
          <p>{def.ranges}</p>
          <p className="mt-1">Source: {def.source}</p>
        </div>
      </form>
    </Dialog>
  )
}
