import { useEffect, useId, useState } from 'react'
import { EW } from '../../data/earlyWarning/rules'
import { ACVPU_LABEL, type Acvpu } from '../../data/earlyWarning/news2'
import type { EarlyWarningReport } from '../../lib/earlyWarning'
import { CHECK_RANGE, saveCheck } from '../../lib/earlyWarning/fullCheck'
import type { FullCheck } from '../../lib/earlyWarning/news2'
import { Button, Dialog, Field, Input, Select } from '../ui'

type Num = 'rr' | 'pulse' | 'spo2' | 'temp' | 'sys'
const LABEL: Record<Num, string> = { rr: 'Respiration rate (breaths per minute)', pulse: 'Pulse (beats per minute)', spo2: 'Blood oxygen, SpO₂ (%)', temp: 'Temperature (°C)', sys: 'Systolic blood pressure (upper number, mmHg)' }
const HINT: Partial<Record<Num, string>> = { rr: 'Count the breaths in one full minute while sitting still.' }

/** Reading from the last hour (same window as the full check itself), to prefill the form. */
function freshValue(report: EarlyWarningReport, param: 'pulse' | 'spo2' | 'temp' | 'sys'): string {
  const item = report.news2.items.find((i) => i.param === param)
  if (!item || item.value == null || !item.at || item.source !== 'reading') return ''
  const ageH = (Date.now() - Date.parse(item.at)) / 3600000
  return ageH <= EW.NEWS2_FULLCHECK_MAX_AGE_H ? String(item.value) : ''
}

export default function FullCheckDialog({ open, onClose, crewId, report }: { open: boolean; onClose: () => void; crewId: number; report: EarlyWarningReport }) {
  const formId = useId()
  const [vals, setVals] = useState<Record<Num, string>>({ rr: '', pulse: '', spo2: '', temp: '', sys: '' })
  const [o2, setO2] = useState<'' | 'air' | 'oxygen'>('')
  const [acvpu, setAcvpu] = useState<'' | Acvpu>('')
  const [errors, setErrors] = useState<Partial<Record<Num | 'o2' | 'acvpu' | 'save', string>>>({})

  useEffect(() => {
    if (!open) return
    setVals({ rr: '', pulse: freshValue(report, 'pulse'), spo2: freshValue(report, 'spo2'), temp: freshValue(report, 'temp'), sys: freshValue(report, 'sys') })
    setO2('')
    setAcvpu('')
    setErrors({})
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const e: typeof errors = {}
    const num = {} as Record<Num, number>
    for (const k of Object.keys(LABEL) as Num[]) {
      const v = Number(vals[k].replace(',', '.'))
      const [lo, hi] = CHECK_RANGE[k]
      if (vals[k].trim() === '' || !Number.isFinite(v)) e[k] = 'Enter a number.'
      else if (v < lo || v > hi) e[k] = `Enter a value between ${lo} and ${hi}.`
      else num[k] = v
    }
    if (!o2) e.o2 = 'Choose air or oxygen.'
    if (!acvpu) e.acvpu = 'Choose one.'
    if (Object.keys(e).length) return setErrors(e)
    const check: FullCheck = { at: new Date().toISOString(), rr: num.rr, pulse: num.pulse, spo2: num.spo2, temp: num.temp, sys: num.sys, o2: o2 as 'air' | 'oxygen', acvpu: acvpu as Acvpu }
    if (!saveCheck(crewId, check)) return setErrors({ save: 'This device could not store the check (private browsing or storage blocked).' })
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Full NEWS2 check"
      description={`All seven NEWS2 parameters, taken now. Saved on this device only — not sent to the server and not added to your measurements. Counts for ${EW.NEWS2_FULLCHECK_MAX_AGE_H} hour. NEWS2 is for adults (16+) and not for use in pregnancy.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId}>
            Score it
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault()
          submit()
        }}
      >
        {(Object.keys(LABEL) as Num[]).map((k, i) => (
          <Field key={k} label={LABEL[k]} hint={HINT[k] ?? (vals[k] && k !== 'rr' ? 'From your reading in the last hour — change it if you measure again.' : undefined)} error={errors[k]}>
            <Input inputMode="decimal" value={vals[k]} onChange={(e) => setVals((s) => ({ ...s, [k]: e.target.value }))} data-autofocus={i === 0 ? true : undefined} />
          </Field>
        ))}
        <Field label="Breathing air or extra oxygen?" error={errors.o2}>
          <Select value={o2} onChange={(e) => setO2(e.target.value as '' | 'air' | 'oxygen')}>
            <option value="">Choose…</option>
            <option value="air">Air (no extra oxygen)</option>
            <option value="oxygen">Extra oxygen by mask or nasal tube</option>
          </Select>
        </Field>
        <Field label="Alertness" hint="New confusion means confusion or disorientation that is new compared with usual. If unsure whether it is new, the RCP says to treat it as new." error={errors.acvpu}>
          <Select value={acvpu} onChange={(e) => setAcvpu(e.target.value as '' | Acvpu)}>
            <option value="">Choose…</option>
            {(Object.keys(ACVPU_LABEL) as Acvpu[]).map((a) => (
              <option key={a} value={a}>
                {ACVPU_LABEL[a]}
              </option>
            ))}
          </Select>
        </Field>
        {errors.save && <p className="text-sm text-crit">{errors.save}</p>}
      </form>
    </Dialog>
  )
}
