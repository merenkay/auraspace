import { Save } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AGE_BANDS, ALLERGIES, CHOICE_LABEL, KNOWN_CONDITIONS, MEDICINES, emptyProfile, type Choice, type HealthProfile } from '../../data/conditions/profile'
import { Badge, Button, Checkbox, Field, Notice, Section, Select, Textarea } from '../ui'

type ListKey = 'conditions' | 'allergies' | 'medicines'

function Group({ title, choices, value, onToggle }: { title: string; choices: Choice[]; value: string[]; onToggle: (id: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1 text-[15px] font-semibold text-ink">{title}</legend>
      <div className="grid gap-x-6 sm:grid-cols-2">
        {choices.map((c) => (
          <Checkbox key={c.id} label={c.label} checked={value.includes(c.id)} onChange={() => onToggle(c.id)} />
        ))}
      </div>
    </fieldset>
  )
}

function ReadOnly({ p }: { p: HealthProfile }) {
  const groups: [string, string[]][] = [
    ['Known conditions', p.conditions],
    ['Allergies', p.allergies],
    ['Current medicines', p.medicines],
  ]
  return (
    <dl className="grid max-w-3xl gap-x-6 gap-y-5 sm:grid-cols-2">
      <div>
        <dt className="text-sm text-dim">Age band</dt>
        <dd className="mt-1 text-[15px]">{p.ageBand ? CHOICE_LABEL[p.ageBand] : 'Not recorded'}</dd>
      </div>
      {groups.map(([k, v]) => (
        <div key={k}>
          <dt className="text-sm text-dim">{k}</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5">{v.length ? v.map((id) => <Badge key={id}>{CHOICE_LABEL[id] ?? id}</Badge>) : <span className="text-soft">None recorded</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function ProfileEditor({ profile, editable, onSave }: { profile: HealthProfile | null; editable: boolean; onSave: (p: HealthProfile) => Promise<void> }) {
  const [draft, setDraft] = useState<HealthProfile>(profile ?? emptyProfile())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'crit'; text: string } | null>(null)
  useEffect(() => setDraft(profile ?? emptyProfile()), [profile])

  const toggle = (k: ListKey) => (id: string) => setDraft((d) => ({ ...d, [k]: d[k].includes(id) ? d[k].filter((x) => x !== id) : [...d[k], id] }))
  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await onSave(draft)
      setMsg({ tone: 'ok', text: 'Saved. AURA and your coach now use this profile.' })
    } catch (e) {
      setMsg({ tone: 'crit', text: e instanceof Error ? e.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title="Health profile"
      description="AURA uses this to weigh possible causes and to check first-aid medicines against your allergies and medicines. Only you and your care team can see it."
    >
      {profile?.simulated && <div className="mb-4"><Badge>Simulated record</Badge></div>}
      {!profile && <Notice tone="warn" className="mb-6" title="No profile yet">Without it AURA cannot check medicines against your allergies, so it will ask you to check the cautions yourself.</Notice>}
      {!editable ? (
        profile ? <ReadOnly p={profile} /> : <p className="text-soft">This person has not recorded a health profile.</p>
      ) : (
        <div className="max-w-3xl space-y-6 [&>fieldset]:border-t [&>fieldset]:border-line [&>fieldset]:pt-6">
          <Field label="Age band" className="max-w-xs">
            <Select value={draft.ageBand ?? ''} onChange={(e) => setDraft({ ...draft, ageBand: (e.target.value || null) as HealthProfile['ageBand'] })}>
              <option value="">Prefer not to say</option>
              {AGE_BANDS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </Field>
          <Group title="Known conditions" choices={KNOWN_CONDITIONS} value={draft.conditions} onToggle={toggle('conditions')} />
          <Group title="Allergies" choices={ALLERGIES} value={draft.allergies} onToggle={toggle('allergies')} />
          <Group title="Medicines you take" choices={MEDICINES} value={draft.medicines} onToggle={toggle('medicines')} />
          <Field label="Anything else your care team should know" optional hint="Up to 300 characters. AURA does not read this field.">
            <Textarea value={draft.notes} maxLength={300} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          </Field>
          {msg && <Notice tone={msg.tone} role={msg.tone === 'crit' ? 'alert' : 'status'}>{msg.text}</Notice>}
          <Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>
            Save profile
          </Button>
        </div>
      )}
    </Section>
  )
}
