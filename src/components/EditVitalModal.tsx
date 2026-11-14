import { useState } from 'react'
import { STATUS_COLOR, STATUS_LABEL, type Values, type VitalDef } from '../data/vitals'

type Props = {
  def: VitalDef
  values: Values
  onSave: (patch: Partial<Values>) => void
  onClose: () => void
}

export default function EditVitalModal({ def, values, onSave, onClose }: Props) {
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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <form
        className="w-full max-w-md rounded-t-3xl border border-white/10 bg-slate-900 p-5 shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (valid) onSave(parsed)
        }}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold text-white">{def.label}</h2>
          <button type="button" onClick={onClose} className="rounded-lg px-2 text-2xl leading-none text-slate-400 hover:text-white" aria-label="Close">
            ×
          </button>
        </div>
        <p className="mt-2 rounded-xl bg-sky-400/10 p-3 text-sm leading-snug text-sky-100">
          <span className="font-semibold">How to measure: </span>
          {def.howTo}
        </p>

        <div className="mt-4 space-y-4">
          {def.fields.map((f, i) => (
            <label key={f.id} className="block">
              <span className="text-sm text-slate-300">{f.label}</span>
              {f.scale ? (
                <div className="mt-2 flex gap-2">
                  {f.scale.map((s, idx) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, [f.id]: String(idx + 1) }))}
                      className={`h-14 flex-1 rounded-xl border text-2xl transition ${
                        draft[f.id] === String(idx + 1) ? 'border-sky-400 bg-sky-400/20' : 'border-white/10 bg-white/5 hover:bg-white/10'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  autoFocus={i === 0}
                  type="number"
                  inputMode="decimal"
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={draft[f.id]}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-3xl font-bold tabular-nums text-white outline-none focus:border-sky-400"
                />
              )}
            </label>
          ))}
        </div>

        <p className="mt-4 text-xs leading-snug text-slate-400">
          {def.ranges}
          <br />
          <span className="text-slate-500">Source: {def.source}</span>
        </p>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm font-bold tracking-widest" style={{ color: preview ? STATUS_COLOR[preview] : '#94a3b8' }}>
            {preview ? `● ${STATUS_LABEL[preview]}` : 'Enter a value in range'}
          </span>
          <button
            type="submit"
            disabled={!valid}
            className="rounded-xl bg-sky-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-sky-400 disabled:opacity-40"
          >
            Save reading
          </button>
        </div>
      </form>
    </div>
  )
}
