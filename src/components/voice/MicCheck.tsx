// Voice settings: microphone sensitivity and the microphone check (speak, see the level, the peak, the room, a
// verdict in words, which microphone is in use, and try another one). The check opens its own short-lived stream
// (lib/voice/level.ts); nothing is recorded. Loaded only when the voice settings are opened.
import { AudioLines, CircleCheck, Mic, Volume1, Volume2, VolumeX, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DEV_HOOKS } from '../../lib/devHooks'
import { activity, listMicrophones, micOpenError, openMicCheck, parallelCaptureOK, setMicSensitivity, type MicCheck as Check, type MicDevice, type MicOpenError, type MicReading } from '../../lib/voice/level'
import { holdRecognition } from '../../lib/voice/recognition'
import { fromDb, micVerdict, VERDICT_TEXT, VoiceActivity, type MicVerdict, type Sensitivity } from '../../lib/voice/vad'
import { Button, Select, Tabs } from '../ui'
import './mic.css'

const SENS_HINT: Record<Sensitivity, string> = {
  auto: 'Adjusts to your voice and the room as you use AURA.',
  low: 'For noisy rooms: only a clear, close voice counts as speech.',
  normal: 'For a quiet room and a normal speaking voice.',
  high: 'For quiet voices or a distant microphone: softer sounds count as speech and AURA waits longer for you to start.',
}
const OPEN_ERROR: Record<MicOpenError, string> = {
  denied: 'Microphone access is blocked. Allow it in the browser’s site settings (the icon beside the address), then try again.',
  'no-mic': 'No microphone was found. Plug one in or choose another input in the system sound settings.',
  unsupported: 'This browser cannot open the microphone for a check.',
  other: 'The microphone could not be opened. Another app may be using it.',
}
const VERDICT_ICON: Record<MicVerdict, LucideIcon> = { waiting: Mic, silent: VolumeX, quiet: Volume1, loud: Volume2, noisy: AudioLines, good: CircleCheck }

/** the meter shows −70 … 0 dBFS */
const LO = -70
const pct = (db: number) => Math.min(100, Math.max(0, ((db - LO) / -LO) * 100))
const dB = (v: number) => (Number.isFinite(v) && v > -99 ? `${Math.round(v)} dB` : '—')
/** the check closes itself, so a forgotten panel does not keep the microphone open */
const AUTO_STOP_MS = 45_000

type DemoKind = Exclude<MicVerdict, 'waiting'>
/** Development only: a synthetic microphone, so the panel can be shown without one (screenshots). */
function demoCheck(kind: DemoKind): Check {
  const P: Record<DemoKind, [room: number, speech: number, peak: number]> = { good: [-58, -24, 0.4], quiet: [-62, -46, 0.05], loud: [-56, -5, 1], noisy: [-36, -22, 0.4], silent: [-100, -100, 0] }
  const [room, speech, peak] = P[kind]
  const vad = new VoiceActivity(activity.sensitivity)
  vad.mark()
  const at = (t: number) => {
    const talking = kind !== 'silent' && t > 900 && t % 420 < 300
    vad.push(fromDb(talking ? speech + 2 * Math.sin(t / 70) : room + 1.5 * Math.sin(t / 130)), t, { peak: talking ? peak : 0.01 })
  }
  const now = performance.now()
  for (let t = now - 5000; t < now; t += 20) at(t) // five seconds of history, so the verdict is there at once
  return {
    label: 'Demo microphone (synthetic signal)',
    deviceId: 'demo',
    read: () => {
      at(performance.now())
      const stats = vad.stats()
      return { levelDb: vad.levelDb, floorDb: vad.floorDb, thresholdDb: vad.thresholdDb, peakDb: stats.peakDb, voiced: vad.voiced, stats }
    },
    restart: () => vad.mark(),
    stop: () => undefined,
  }
}

type Shown = { verdict: MicVerdict; level: number; peak: number; room: number; threshold: number }

export default function MicSettings({ sensitivity, onSensitivity }: { sensitivity: Sensitivity; onSensitivity: (s: Sensitivity) => void }) {
  const [state, setState] = useState<'idle' | 'opening' | 'running'>('idle')
  const [error, setError] = useState<MicOpenError | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const [label, setLabel] = useState('')
  const [deviceId, setDeviceId] = useState('')
  const [devices, setDevices] = useState<MicDevice[]>([])
  const check = useRef<Check | null>(null)
  const release = useRef<(() => void) | null>(null)
  const raf = useRef(0)
  const stopT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const meter = useRef<HTMLDivElement>(null)
  const fill = useRef<HTMLDivElement>(null)
  const peakEl = useRef<HTMLDivElement>(null)
  const seq = useRef(0)

  const stop = () => {
    seq.current++
    cancelAnimationFrame(raf.current)
    clearTimeout(stopT.current)
    check.current?.stop()
    check.current = null
    release.current?.()
    release.current = null
    setState('idle')
  }
  useEffect(() => stop, []) // eslint-disable-line react-hooks/exhaustive-deps

  const run = (c: Check) => {
    check.current = c
    setLabel(c.label)
    setDeviceId(c.deviceId)
    setError(null)
    setState('running')
    let hold = LO
    let holdAt = 0
    let lastText = 0
    const frame = (now: number) => {
      const r: MicReading | null = c.read()
      if (r) {
        if (r.levelDb >= hold || now - holdAt > 1500) {
          hold = r.levelDb
          holdAt = now
        }
        // the bar moves every frame without React; the numbers and the verdict a few times a second
        if (fill.current) fill.current.style.transform = `scaleX(${pct(r.levelDb) / 100})`
        if (peakEl.current) peakEl.current.style.left = `calc(${pct(hold)}% - 1px)`
        meter.current?.toggleAttribute('data-voiced', r.voiced)
        if (now - lastText > 200) {
          lastText = now
          setShown({ verdict: micVerdict(r.stats), level: r.levelDb, peak: r.stats.peakDb, room: r.stats.floorDb, threshold: r.thresholdDb })
        }
      }
      raf.current = requestAnimationFrame(frame)
    }
    raf.current = requestAnimationFrame(frame)
    clearTimeout(stopT.current)
    stopT.current = setTimeout(stop, AUTO_STOP_MS)
  }

  const start = (id?: string) => {
    stop()
    const my = seq.current
    setShown(null)
    setState('opening')
    // phones and tablets give the microphone to one user at a time: recognition (the wake word) steps aside
    if (!parallelCaptureOK()) release.current = holdRecognition()
    openMicCheck(id)
      .then(async (c) => {
        if (my !== seq.current) return c.stop()
        run(c)
        const list = await listMicrophones() // labels are only readable once access was granted
        if (my === seq.current) setDevices(list)
      })
      .catch((e) => {
        if (my !== seq.current) return
        release.current?.()
        release.current = null
        setState('idle')
        setError(micOpenError(e))
      })
  }

  // development only: window.__auraMic.demo('good' | 'quiet' | 'loud' | 'noisy' | 'silent'), .stop()
  const fns = useRef({ stop, run })
  fns.current = { stop, run }
  useEffect(() => {
    if (!DEV_HOOKS) return
    const w = window as unknown as { __auraMic?: unknown }
    const hook = {
      demo: (kind: DemoKind = 'good') => {
        fns.current.stop()
        fns.current.run(demoCheck(kind))
        setDevices([{ id: 'demo', label: 'Demo microphone (synthetic signal)' }])
      },
      stop: () => fns.current.stop(),
    }
    w.__auraMic = hook
    return () => {
      if (w.__auraMic === hook) delete w.__auraMic
    }
  }, [])

  const verdict = shown ? VERDICT_TEXT[shown.verdict] : null
  const Icon = shown ? VERDICT_ICON[shown.verdict] : Mic
  const measuresLive = parallelCaptureOK()

  return (
    <div className="space-y-3 border-t border-line pt-3" role="group" aria-label="Microphone">
      <div>
        <p className="mb-1.5 text-sm text-dim">Microphone sensitivity</p>
        <Tabs
          label="Microphone sensitivity"
          value={sensitivity}
          onChange={(s) => {
            setMicSensitivity(s)
            onSensitivity(s)
          }}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'High' },
          ]}
        />
        <p className="mt-1.5 text-xs leading-relaxed text-dim">
          {SENS_HINT[sensitivity]} {measuresLive ? 'It sets how far above the room’s noise a sound must be to count as you speaking.' : 'On phones and tablets the level cannot be measured while AURA listens, so here it only changes how long AURA waits.'} Which words are recognised is decided by your browser’s speech service, not by AURA.
        </p>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-dim">Microphone check</p>
          {state === 'running' ? (
            <Button size="sm" onClick={stop}>
              Stop check
            </Button>
          ) : (
            <Button size="sm" icon={Mic} loading={state === 'opening'} onClick={() => start()}>
              Check microphone
            </Button>
          )}
        </div>

        {error && (
          <p role="status" className="mt-2 rounded-lg border border-edge px-3 py-2 text-sm leading-snug text-soft">
            {OPEN_ERROR[error]}
          </p>
        )}
        {state === 'idle' && !error && <p className="mt-1.5 text-xs leading-relaxed text-dim">Speak a sentence and see whether AURA can hear you: too quiet, too loud or a noisy room. Nothing is recorded.</p>}

        {state === 'running' && (
          <div className="mt-3 space-y-3">
            <div>
              <div ref={meter} className="mic-meter" role="meter" aria-label="Microphone level" aria-valuemin={LO} aria-valuemax={0} aria-valuenow={shown ? Math.round(shown.level) : LO} aria-valuetext={shown ? `${dB(shown.level)}, ${VERDICT_TEXT[shown.verdict].title}` : 'Starting'}>
                <div ref={fill} className="mic-meter__fill" />
                <div ref={peakEl} className="mic-peak" style={{ left: 0 }} />
              </div>
              {shown && (
                <div className="mic-scale" aria-hidden="true">
                  <span className="mic-mark" data-side={pct(shown.room) < 12 ? undefined : 'left'} style={{ left: `${pct(shown.room)}%` }}>
                    <span>room</span>
                  </span>
                  {shown.threshold - shown.room > 4 && pct(shown.threshold) - pct(shown.room) > (pct(shown.room) < 12 ? 14 : 2) && pct(shown.threshold) < 70 && (
                    <span className="mic-mark" style={{ left: `${pct(shown.threshold)}%` }}>
                      <span>speech from here</span>
                    </span>
                  )}
                </div>
              )}
              <dl className="grid grid-cols-3 gap-2 font-mono text-xs text-dim">
                <div>
                  <dt>Level now</dt>
                  <dd className="text-sm text-ink">{shown ? dB(shown.level) : '—'}</dd>
                </div>
                <div>
                  <dt>Loudest</dt>
                  <dd className="text-sm text-ink">{shown ? dB(shown.peak) : '—'}</dd>
                </div>
                <div>
                  <dt>Room noise</dt>
                  <dd className="text-sm text-ink">{shown ? dB(shown.room) : '—'}</dd>
                </div>
              </dl>
              <p className="mt-1 text-xs text-dim">dB relative to the loudest the microphone can capture (0 dB). Speech usually sits between −35 and −12.</p>
            </div>

            <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-xl border border-line bg-panel2 p-3">
              <Icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink" aria-hidden="true" />
              <div className="min-w-0 text-sm leading-relaxed text-soft">
                <p className="text-[15px] font-semibold leading-snug text-ink">{verdict?.title ?? 'Starting'}</p>
                {verdict && <p>{verdict.advice}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="vx-mic" className="mb-1.5 block text-sm text-dim">
                Microphone being measured
              </label>
              {devices.length > 1 ? (
                <Select id="vx-mic" className="w-full min-w-0" value={deviceId} onChange={(e) => start(e.target.value)}>
                  {!devices.some((d) => d.id === deviceId) && <option value={deviceId}>{label || 'Default microphone'}</option>}
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <p id="vx-mic" className="text-sm text-ink">
                  {label || 'Default microphone'}
                </p>
              )}
              <p className="mt-1.5 text-xs leading-relaxed text-dim">
                When listening, your browser always uses its own default microphone. If another one measures better here, make it the default in the browser’s site settings (the icon beside the address) or in the system sound settings.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
