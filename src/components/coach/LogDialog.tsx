// Log a session: minutes, how hard it felt (CDC 0–10 effort scale, in four plain steps) and pain yes/no.
import { useEffect, useState } from 'react'
import type { PlannedSession } from '../../lib/coach/types'
import { Button, Dialog, Field, Input, Notice, SourceLink, Tabs } from '../ui'
import { COACH_SOURCES } from '../../data/coach/sources'

export const EFFORT_OPTIONS = [
  { value: '3', label: 'Easy', hint: 'Breathing easily — below 5 of 10.' },
  { value: '6', label: 'Moderate', hint: 'You could talk, but not sing — about 5–6 of 10.' },
  { value: '8', label: 'Hard', hint: 'Only a few words between breaths — about 7–8 of 10.' },
  { value: '10', label: 'Very hard', hint: 'You could not have kept going — 9–10 of 10.' },
]

export function LogDialog({ open, onClose, session, onSave, saving, error }: { open: boolean; onClose: () => void; session: PlannedSession | null; onSave: (v: { minutes: number; effort: number; pain: boolean }) => void; saving: boolean; error: string | null }) {
  const [minutes, setMinutes] = useState('')
  const [effort, setEffort] = useState('6')
  const [pain, setPain] = useState<'no' | 'yes'>('no')
  useEffect(() => {
    if (open && session) {
      setMinutes(String(session.minutes))
      setEffort('6')
      setPain('no')
    }
  }, [open, session])
  const m = Number(minutes)
  const bad = !Number.isFinite(m) || m < 1 || m > 300
  const hint = EFFORT_OPTIONS.find((o) => o.value === effort)?.hint
  const src = COACH_SOURCES['cdc-intensity']
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Log this session"
      description={session ? session.title : undefined}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} disabled={bad} onClick={() => onSave({ minutes: Math.round(m), effort: Number(effort), pain: pain === 'yes' })} data-autofocus>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <Field label="Minutes" hint="Total time including warm-up and cool-down." error={minutes && bad ? 'Enter 1 to 300 minutes.' : undefined}>
          <Input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
        </Field>
        <div>
          <p className="label">How hard did it feel overall?</p>
          <Tabs className="mt-2" label="Effort" value={effort} onChange={setEffort} options={EFFORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} full />
          <p className="mt-2 text-sm text-soft">{hint}</p>
          <SourceLink className="mt-1" href={src.url} org={src.org} title="0–10 effort scale" />
        </div>
        <div>
          <p className="label">Any pain during or after?</p>
          <Tabs className="mt-2" label="Pain" value={pain} onChange={setPain} options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]} full />
          {pain === 'yes' && <p className="mt-2 text-sm text-soft">The next session will be one step easier. If the pain was in your chest, or came with dizziness or breathlessness, contact your care team now.</p>}
        </div>
        {error && (
          <Notice tone="warn" title="Could not save">
            {error}
          </Notice>
        )}
      </div>
    </Dialog>
  )
}
