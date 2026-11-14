// "Import from Samsung Health" wizard: phone export steps -> choose files -> preview -> save.
// Parsing happens in this browser (a Web Worker); only the daily values the user confirms are saved.
import { ChevronDown, ChevronLeft, Download, EllipsisVertical, FileArchive, FileSpreadsheet, FlaskConical, FolderOpen, Laptop, ShieldCheck, Smartphone, Upload, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, List, Meter, Notice, PageTransition, SourceLink, Tabs, cx, Disclosure, ShowMore } from '../ui'
import Sparkline from '../Sparkline'
import {
  DEVICE_LABEL,
  METRIC_INFO,
  SYNTHETIC_DEVICE_LABEL,
  addDays,
  daysBetween,
  defaultSelection,
  firstDataDate,
  lastDataDate,
  pointsIn,
  toImportRows,
  type DailyPoint,
  type ExportSummary,
  type FileReport,
  type ImportMetric,
  type InputFile,
  type Selection,
} from '../../lib/samsungHealth'
import type { Backend } from '../../lib/api'
import type { ImportResult } from '../../lib/types'
import { runAnalysis, type Progress } from './runAnalysis'

type Step = 'intro' | 'choose' | 'reading' | 'preview' | 'saving' | 'done'

type Props = {
  open: boolean
  onClose: () => void
  crewId: number
  backend: Backend
  /** Called after rows were saved, so the page can reload its data. */
  onImported: (result: ImportResult) => void
}

const SAMPLE_URL = `${import.meta.env.BASE_URL}samples/samsung-health-SYNTHETIC-sample.zip`

const SOURCES = [
  { org: 'Samsung (US)', title: 'Download or erase your personal data from Samsung Health', href: 'https://www.samsung.com/us/support/answer/ANS10001379' },
  { org: 'Samsung (Canada)', title: 'Download or delete your Samsung Health data', href: 'https://www.samsung.com/ca/support/apps-services/download-or-delete-your-samsung-health-data/' },
]

const fmtDate = (d: string, year = false) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: year ? 'numeric' : undefined, timeZone: 'UTC' })

function fmtPoint(metric: ImportMetric, p: DailyPoint) {
  const info = METRIC_INFO[metric]
  const v = metric === 'bp' ? `${p.value}/${p.value2}` : info.digits ? p.value.toFixed(info.digits === 2 ? 2 : 1) : String(p.value)
  return `${v} ${info.unit}`
}

/** Left-to-right order of the screens, used only to pick the slide direction. */
const STEP_ORDER: Record<Step, number> = { intro: 0, choose: 1, reading: 2, preview: 3, saving: 4, done: 5 }
const STEP_INDEX: Record<Step, number> = { intro: 1, choose: 2, reading: 2, preview: 3, saving: 4, done: 4 }
const STEP_TITLE: Record<Step, string> = {
  intro: 'Export from your phone',
  choose: 'Choose the export',
  reading: 'Reading the export',
  preview: 'Check what was found',
  saving: 'Saving daily values',
  done: 'Import finished',
}

/** Collect files from a drag-and-drop, walking dropped folders (the jsons/ detail folder is skipped: never needed). */
async function filesFromDrop(dt: DataTransfer): Promise<InputFile[]> {
  const entries = [...dt.items].filter((i) => i.kind === 'file').map((i) => i.webkitGetAsEntry?.() ?? null)
  if (!entries.length || entries.some((e) => !e)) return [...dt.files].map((f) => ({ path: f.name, blob: f }))
  const out: InputFile[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ path: entry.fullPath.replace(/^\//, ''), blob: f })
    } else if (entry.isDirectory && !/^jsons$/i.test(entry.name)) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (!batch.length) break
        for (const e of batch) await walk(e)
      }
    }
  }
  for (const e of entries) await walk(e!)
  return out
}

const fromFileList = (list: FileList | null): InputFile[] => [...(list ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, blob: f }))

export default function SamsungImportWizard({ open, onClose, crewId, backend, onImported }: Props) {
  const [step, setStep] = useState<Step>('intro')
  const [progress, setProgress] = useState<Progress>({ label: '', fraction: 0 })
  const [summary, setSummary] = useState<ExportSummary | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [usedSample, setUsedSample] = useState(false)
  const cancelRef = useRef<() => void>(() => {})
  const prevStep = useRef<Step>('intro')
  const direction: 1 | -1 = STEP_ORDER[step] >= STEP_ORDER[prevStep.current] ? 1 : -1
  useEffect(() => {
    prevStep.current = step
  }, [step])

  // fresh wizard every time it opens
  useEffect(() => {
    if (!open) return
    setStep('intro')
    setSummary(null)
    setSel(null)
    setError(null)
    setResult(null)
    setUsedSample(false)
  }, [open])
  useEffect(() => () => cancelRef.current(), [])

  const analyze = async (files: InputFile[], sample = false) => {
    if (!files.length) return
    setError(null)
    setUsedSample(sample)
    setStep('reading')
    setProgress({ label: 'Opening files', fraction: 0.01 })
    const run = runAnalysis(files, setProgress)
    cancelRef.current = run.cancel
    try {
      const s = await run.promise
      setSummary(s)
      setSel(defaultSelection(s))
      setStep('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the export.')
      setStep('choose')
    }
  }

  const loadSample = async () => {
    setError(null)
    try {
      const res = await fetch(SAMPLE_URL)
      if (!res.ok) throw new Error(`The sample could not be loaded (${res.status}).`)
      await analyze([{ path: 'samsung-health-SYNTHETIC-sample.zip', blob: await res.blob() }], true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The sample could not be loaded.')
    }
  }

  const synthetic = !!summary && (summary.synthetic || usedSample)
  const rows = useMemo(() => (summary && sel ? toImportRows(summary, sel) : []), [summary, sel])

  const save = async () => {
    if (!summary || !sel || !rows.length) return
    setStep('saving')
    setProgress({ label: 'Saving', fraction: 0 })
    try {
      const r = await backend.importMeasurements(crewId, rows, synthetic ? SYNTHETIC_DEVICE_LABEL : DEVICE_LABEL, (done, total) => setProgress({ label: 'Saving', fraction: done / total }))
      setResult(r)
      setStep('done')
      onImported(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saving failed.')
      setStep('preview')
    }
  }

  const close = () => {
    cancelRef.current()
    onClose()
  }

  const footer: ReactNode = (() => {
    switch (step) {
      case 'intro':
        return (
          <>
            <Button variant="quiet" onClick={close}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setStep('choose')} data-autofocus>
              I have the export
            </Button>
          </>
        )
      case 'choose':
        return (
          <Button variant="quiet" icon={ChevronLeft} onClick={() => setStep('intro')}>
            Back to the phone steps
          </Button>
        )
      case 'reading':
        return (
          <Button
            variant="quiet"
            onClick={() => {
              cancelRef.current()
              setStep('choose')
            }}
          >
            Cancel
          </Button>
        )
      case 'preview':
        return (
          <>
            <Button variant="quiet" icon={ChevronLeft} onClick={() => setStep('choose')}>
              Choose other files
            </Button>
            <Button variant="primary" disabled={!rows.length} onClick={save}>
              {rows.length ? `Import ${rows.length} daily value${rows.length === 1 ? '' : 's'}` : 'Nothing selected'}
            </Button>
          </>
        )
      case 'saving':
        return null
      case 'done':
        return (
          <Button variant="primary" onClick={close} data-autofocus>
            Show my history
          </Button>
        )
    }
  })()

  return (
    <Dialog open={open} onClose={close} wide title={STEP_TITLE[step]} description={`Step ${STEP_INDEX[step]} of 4 · Samsung Health import`} footer={footer}>
    <PageTransition routeKey={step} direction={direction}>
      {step === 'intro' && <Intro />}
      {step === 'choose' && <Choose onFiles={analyze} onSample={loadSample} error={error} />}
      {(step === 'reading' || step === 'saving') && <ProgressView progress={progress} saving={step === 'saving'} />}
      {step === 'preview' && summary && sel && <Preview summary={summary} sel={sel} onSel={setSel} synthetic={synthetic} rows={rows.length} demo={backend.mode === 'demo'} error={error} />}
      {step === 'done' && result && <Done result={result} synthetic={synthetic} demo={backend.mode === 'demo'} />}
    </PageTransition>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ steps */

function PhoneStep({ n, icon: Icon, children }: { n: number; icon: LucideIcon; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-deep text-soft" aria-hidden="true">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 text-sm leading-relaxed text-soft">
        <span className="meta mr-1.5">{n}</span>
        {children}
      </div>
    </li>
  )
}

function Intro() {
  return (
    <div className="space-y-5">
      <p className="text-soft">
        Samsung Health can give you a copy of everything it has stored from your Galaxy Watch. AURA reads that copy here and keeps <strong className="font-medium text-ink">one value per day</strong> for heart rate,
        sleep, blood oxygen, blood pressure, exercise and water.
      </p>
      <ol className="divide-y divide-line border-y border-line">
        <PhoneStep n={1} icon={Smartphone}>
          On your phone, open the <strong className="font-medium text-ink">Samsung Health</strong> app.
        </PhoneStep>
        <PhoneStep n={2} icon={EllipsisVertical}>
          Tap <strong className="font-medium text-ink">⋮ More options</strong>, then <strong className="font-medium text-ink">Settings</strong>.
        </PhoneStep>
        <PhoneStep n={3} icon={Download}>
          Scroll to <strong className="font-medium text-ink">Download personal data</strong> and tap <strong className="font-medium text-ink">Download</strong>. Allow the permissions, sign in to your Samsung account
          if asked, wait for it to finish and tap <strong className="font-medium text-ink">OK</strong>.
        </PhoneStep>
        <PhoneStep n={4} icon={FolderOpen}>
          Open <strong className="font-medium text-ink">My Files › Downloads › Samsung Health</strong>. Your export is the folder named like <span className="font-mono text-ink">samsunghealth_name_20261114…</span>
        </PhoneStep>
        <PhoneStep n={5} icon={Laptop}>
          Copy that folder (or a .zip of it) to this computer — for example with a USB cable or your cloud drive. Then continue here.
        </PhoneStep>
      </ol>
      <Notice tone="info" title="Stays on this device">
        The export is read inside this browser. The raw files never leave your device — only the daily values you confirm in the next steps are saved to your AURA record.
      </Notice>
      <Disclosure size="row" id="import.sources" title={`Sources (${SOURCES.length})`}>
        <div className="space-y-1">
          <p className="text-xs text-dim">Steps from Samsung’s support pages. Menu names can differ slightly between app versions.</p>
          {SOURCES.map((s) => (
            <div key={s.href}>
              <SourceLink href={s.href} org={s.org} title={s.title} />
            </div>
          ))}
        </div>
      </Disclosure>
    </div>
  )
}

function Choose({ onFiles, onSample, error }: { onFiles: (f: InputFile[]) => void; onSample: () => Promise<void>; error: string | null }) {
  const zipRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  const csvRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [sampleBusy, setSampleBusy] = useState(false)

  // React does not type the non-standard folder attribute: set it directly
  useEffect(() => {
    dirRef.current?.setAttribute('webkitdirectory', '')
    dirRef.current?.setAttribute('directory', '')
  }, [])

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    onFiles(await filesFromDrop(e.dataTransfer))
  }

  return (
    <div className="space-y-5">
      {error && (
        <Notice tone="crit" role="alert" title="That did not work">
          {error}
        </Notice>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cx('flex flex-col items-center gap-3 rounded-xl border border-dashed bg-deep px-4 py-7 text-center transition-colors', over ? 'border-ink' : 'border-edge')}
      >
        <Upload className="h-6 w-6 text-dim" aria-hidden="true" />
        <p className="text-sm text-soft">
          Drop the <span className="font-mono text-ink">.zip</span> or the <span className="font-mono text-ink">samsunghealth_…</span> folder here, or choose:
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" icon={FileArchive} onClick={() => zipRef.current?.click()}>
            .zip file
          </Button>
          <Button size="sm" icon={FolderOpen} onClick={() => dirRef.current?.click()}>
            Folder
          </Button>
          <Button size="sm" icon={FileSpreadsheet} onClick={() => csvRef.current?.click()}>
            Single CSV files
          </Button>
        </div>
        <p className="max-w-md text-xs text-dim">If your browser asks whether to “upload” the folder: that only lets this page read it. Nothing is sent anywhere.</p>
        <input ref={zipRef} type="file" accept=".zip,application/zip,application/x-zip-compressed" hidden onChange={(e) => onFiles(fromFileList(e.target.files))} />
        <input ref={dirRef} type="file" multiple hidden onChange={(e) => onFiles(fromFileList(e.target.files))} />
        <input ref={csvRef} type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => onFiles(fromFileList(e.target.files))} />
      </div>

      <Card tone="well" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 text-sm text-soft">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
            No export at hand? <Badge icon={FlaskConical}>Synthetic sample</Badge>
          </p>
          <p className="mt-1">Try 45 days of invented Galaxy Watch data in the real export format. Anything imported from it stays labelled as a synthetic sample.</p>
        </div>
        <Button
          size="sm"
          loading={sampleBusy}
          onClick={async () => {
            setSampleBusy(true)
            await onSample()
            setSampleBusy(false)
          }}
        >
          Try the synthetic sample
        </Button>
      </Card>
      <p className="flex items-start gap-2 text-xs text-dim">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Only the summary tables AURA needs are opened; heart-rate detail files and everything else are left untouched.
      </p>
    </div>
  )
}

function ProgressView({ progress, saving }: { progress: Progress; saving: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress.fraction)) * 100)
  return (
    <div className="space-y-3 py-6" role="status" aria-live="polite">
      <p className="text-soft">{saving ? 'Saving the daily values to your record…' : `${progress.label}…`}</p>
      <Meter value={pct} min={0} max={100} label={saving ? 'Saving progress' : 'Reading progress'} />
      <p className="meta">{pct}% done{saving ? '' : ' · the files stay on this device'}</p>
    </div>
  )
}

type RangePreset = '7' | '30' | '90' | 'all' | 'custom'

function Preview({ summary, sel, onSel, synthetic, rows, demo, error }: { summary: ExportSummary; sel: Selection; onSel: (s: Selection) => void; synthetic: boolean; rows: number; demo: boolean; error: string | null }) {
  const first = firstDataDate(summary)
  const last = lastDataDate(summary)
  const [preset, setPreset] = useState<RangePreset>('30')
  const end = last && last < summary.today ? last : summary.today
  const applyPreset = (p: RangePreset) => {
    setPreset(p)
    if (p === 'custom') return
    onSel({ ...sel, from: p === 'all' ? first ?? end : addDays(end, -(Number(p) - 1)), to: end })
  }
  const toggle = (m: ImportMetric, on: boolean) => onSel({ ...sel, metrics: on ? [...sel.metrics, m] : sel.metrics.filter((x) => x !== m) })
  const exportName = summary.files.find((f) => f.status === 'used')?.path.split('/').slice(-2, -1)[0]
  const used = summary.files.filter((f) => f.status === 'used' || f.status === 'reference')
  const other = summary.files.filter((f) => f.status !== 'used' && f.status !== 'reference')

  if (!summary.metrics.length) {
    return (
      <div className="space-y-4">
        {summary.warnings.map((w) => (
          <Notice key={w} tone="warn" title="Nothing to import">
            {w}
          </Notice>
        ))}
        <FilesReport files={summary.files} sidecars={summary.sidecars} open />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {error && (
        <Notice tone="crit" role="alert" title="Saving failed">
          {error}
        </Notice>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {synthetic && (
          <Badge icon={FlaskConical}>
            Synthetic sample
          </Badge>
        )}
        {exportName && <Badge>{exportName}</Badge>}
        {summary.exportDate && <Badge>exported {fmtDate(summary.exportDate, true)}</Badge>}
        {first && last && (
          <Badge>
            data {fmtDate(first, true)} – {fmtDate(last, true)}
          </Badge>
        )}
      </div>

      <section className="space-y-3">
        <h3 className="text-[15px] font-semibold text-ink">Date range</h3>
        <Tabs<RangePreset>
          label="Date range"
          value={preset}
          onChange={applyPreset}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
            { value: 'all', label: 'All' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Field label="From">
            <Input
              type="date"
              value={sel.from}
              min={first ?? undefined}
              max={sel.to}
              onChange={(e) => {
                setPreset('custom')
                if (e.target.value) onSel({ ...sel, from: e.target.value <= sel.to ? e.target.value : sel.to })
              }}
            />
          </Field>
          <Field label="To">
            <Input
              type="date"
              value={sel.to}
              min={sel.from}
              max={summary.today}
              onChange={(e) => {
                setPreset('custom')
                if (e.target.value) onSel({ ...sel, to: e.target.value >= sel.from ? e.target.value : sel.from })
              }}
            />
          </Field>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-[15px] font-semibold text-ink">Measurements</h3>
        <p className="mb-2 text-sm text-dim">One value per day. Untick anything you do not want to import.</p>
        <List>
          {summary.metrics.map((m) => {
            const info = METRIC_INFO[m.metric]
            const pts = pointsIn(m, sel)
            const checked = sel.metrics.includes(m.metric) && pts.length > 0
            const lastPt = pts[pts.length - 1]
            return (
              <li key={m.metric} className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                <div className="min-w-0">
                  <Checkbox
                    checked={checked}
                    disabled={!pts.length}
                    onChange={(e) => toggle(m.metric, e.target.checked)}
                    label={
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-ink">{info.label}</span>
                        <Badge>
                          {pts.length} day{pts.length === 1 ? '' : 's'}
                        </Badge>
                        {pts.length > 0 && (
                          <span className="text-dim">
                            {fmtDate(pts[0].date)} – {fmtDate(lastPt.date)} · latest {fmtPoint(m.metric, lastPt)}
                          </span>
                        )}
                      </span>
                    }
                    className="py-1"
                  />
                  <ShowMore id="import.method" label="How it is calculated" className="ml-8 text-xs leading-relaxed text-dim">
                    {info.method}
                  </ShowMore>
                  {m.notes.map((n) => (
                    <p key={n} className="ml-8 mt-1 text-xs leading-relaxed text-soft">
                      {n}
                    </p>
                  ))}
                  {!pts.length && <p className="ml-8 mt-1 text-xs text-dim">{m.points.length ? 'No days in the chosen range.' : 'The table was found but had no usable values.'}</p>}
                </div>
                <div className="ml-8 self-center sm:ml-0">
                  <Sparkline data={pts.map((p) => ({ day: daysBetween(sel.from, p.date), value: p.value }))} color="var(--color-ink)" height={40} />
                </div>
              </li>
            )
          })}
          {summary.steps && (
            <li className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-soft">Steps</span>
                <Badge>found, not imported</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-dim">
                {summary.steps.days} days ({fmtDate(summary.steps.from)} – {fmtDate(summary.steps.to)}), about {summary.steps.average.toLocaleString('en-GB')} steps a day. Steps are not an AURA measurement, so they are only shown here.
              </p>
            </li>
          )}
        </List>
      </section>

      {summary.warnings.map((w) => (
        <Notice key={w} tone="warn">
          {w}
        </Notice>
      ))}

      <FilesReport files={[...used, ...other]} sidecars={summary.sidecars} />

      <Notice tone="info" title={demo ? 'Offline demo' : 'What gets saved'}>
        {rows} daily value{rows === 1 ? '' : 's'} will be saved as device data labelled “{synthetic ? SYNTHETIC_DEVICE_LABEL : DEVICE_LABEL}”, each with its own date and time. The raw export stays on this device.
        {demo && ' In this offline demo they are stored in this browser only.'} Importing the same export again does not create duplicates.
      </Notice>
    </div>
  )
}

const STATUS_BADGE: Record<FileReport['status'], { label: string; tone: 'neutral' | 'ok' | 'warn' | 'crit' | 'accent' }> = {
  used: { label: 'Used', tone: 'ok' },
  reference: { label: 'Reference', tone: 'neutral' },
  skipped: { label: 'Not imported', tone: 'neutral' },
  unrecognised: { label: 'Not recognised', tone: 'neutral' },
  error: { label: 'Problem', tone: 'crit' },
}

function FilesReport({ files, sidecars, open = false }: { files: FileReport[]; sidecars: number; open?: boolean }) {
  const counts = files.reduce<Record<string, number>>((acc, f) => ((acc[f.status] = (acc[f.status] ?? 0) + 1), acc), {})
  return (
    <details className="group rounded-xl border border-line" open={open}>
      <summary className="press flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3.5 py-2 text-sm text-soft [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-4 w-4 shrink-0 text-dim transition-transform group-open:rotate-180" aria-hidden="true" />
        <span className="font-medium text-ink">Files in the export ({files.length + sidecars})</span>
        <span className="meta ml-auto text-right">
          {counts.used ?? 0} used · {(counts.skipped ?? 0) + (counts.reference ?? 0)} not imported · {counts.unrecognised ?? 0} not recognised{counts.error ? ` · ${counts.error} with problems` : ''}
        </span>
      </summary>
      <ul className="max-h-72 divide-y divide-line overflow-y-auto border-t border-line">
        {files.map((f) => (
          <li key={f.path} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3.5 py-2 text-xs">
            <Badge tone={STATUS_BADGE[f.status].tone}>{STATUS_BADGE[f.status].label}</Badge>
            <div className="min-w-0 flex-1">
              <p className="break-all font-mono text-soft">{f.path.split('/').pop()}</p>
              <p className="text-dim">{f.note}</p>
            </div>
          </li>
        ))}
        {sidecars > 0 && (
          <li className="flex items-start gap-3 px-3.5 py-2 text-xs">
            <Badge>Skipped</Badge>
            <p className="text-dim">
              {sidecars.toLocaleString('en-GB')} detail file{sidecars === 1 ? '' : 's'} in <span className="font-mono">jsons/</span> — never opened; AURA only needs the summary tables.
            </p>
          </li>
        )}
      </ul>
    </details>
  )
}

function Done({ result, synthetic, demo }: { result: ImportResult; synthetic: boolean; demo: boolean }) {
  const lines: [string, number][] = [
    ['New daily values added', result.added],
    ['Already imported, unchanged', result.unchanged],
    ['Already imported with a different value — the earlier value was kept', result.conflicts],
    ['Rejected as out of range', result.rejected],
  ]
  return (
    <div className="space-y-5">
      <Notice tone={result.added ? 'ok' : 'info'} title={result.added ? `Imported ${result.added} daily value${result.added === 1 ? '' : 's'}` : 'Nothing new to import'}>
        {result.added
          ? `They appear in History, tagged as ${synthetic ? 'synthetic sample' : 'Galaxy Watch'} device data. The newest one now counts as your latest reading where it is newer than what you had.`
          : 'Everything in this range had already been imported.'}
        {demo && ' Stored in this browser (offline demo).'}
      </Notice>
      <dl className="divide-y divide-line border-y border-line">
        {lines
          .filter(([, n], i) => i < 2 || n > 0)
          .map(([label, n]) => (
            <div key={label} className="flex items-baseline justify-between gap-4 py-2.5 text-sm">
              <dt className="text-soft">{label}</dt>
              <dd className="font-mono text-ink">{n}</dd>
            </div>
          ))}
      </dl>
      <p className="text-xs text-dim">Records are append-only: an import never overwrites or deletes an earlier value.</p>
    </div>
  )
}
