// The microphone level: one shared meter for the visuals (the voice orb and the 3D AURA core, published into
// presence.ts at frame rate), for voice activity (vad.ts: noise floor, "is someone speaking", used by the listener
// to time the end of an utterance and to explain a listen that gave no words) and for the microphone check in the
// voice settings. Reference counted: the voice panel, the consultation's dictation and the listener share one
// stream. Nothing is recorded or sent anywhere: each frame is reduced to a level and thrown away.
//
// WHAT A PAGE CAN AND CANNOT CONTROL
// The browser's speech recogniser opens its OWN capture of the default microphone. Nothing asked for here
// (echoCancellation, noiseSuppression, autoGainControl, a deviceId, a sample rate) reaches that capture, and a page
// cannot change the recogniser's acoustic model. This stream exists only so AURA can MEASURE what the room sounds
// like. The constraints are chosen for honest measuring:
//  - autoGainControl off: with it on, the browser turns quiet rooms up between words, which lifts the noise floor
//    toward the speech and defeats a floor-relative detector; it would also make a too-quiet microphone look fine
//    in the microphone check while the recogniser still receives the weak signal.
//  - noiseSuppression off: the detector tracks the floor itself (vad.ts); suppression would hide a noisy room from
//    the check and gates the first syllable of quiet speech.
//  - echoCancellation off: on several systems it switches the device into a "communications" mode for every app
//    using it (other sound is ducked, Bluetooth headsets drop to the telephone profile), and that could change what
//    the recogniser hears. AURA's own voice is kept out another way: frames are dropped while it speaks and for a
//    short tail after (speech.ts selfVoice()).
//  - mono, no sample rate: one channel is enough for a level; forcing a rate only adds a resampler.
// They are "ideal" constraints, never "exact": a device that cannot honour one still opens.
//
// DESKTOP v. PHONES
// On desktop Chrome and Edge a second capture next to speech recognition works: both read the same device. On
// Android (and iOS) the microphone is handed to one user at a time: a getUserMedia stream opened while recognition
// runs can leave the recogniser without audio. So on phones and tablets nothing is measured WHILE listening (the
// visuals get a gentle synthetic pulse, the listener falls back to timing from recognised words alone); the
// microphone check still measures there, because it pauses recognition first (recognition.ts holdRecognition()).
import { setVoiceLevel } from './presence'
import { loadSettings } from './settings'
import { isSpeaking, selfVoice } from './speech'
import { VoiceActivity, type ActivityStats, type Sensitivity } from './vad'

export const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }
/** analysis window: 1024 samples, about 21 ms at 48 kHz */
const FFT = 1024
/** the level is also sampled on a timer, so voice activity keeps working when no frame is drawn (ms) */
const SAMPLE_EVERY_MS = 50
/** after AURA stops speaking the meter ignores the room for this long (echo dies quickly; the recogniser's own
 *  tail, SELF_VOICE_TAIL_MS in speech.ts, is longer) */
const METER_TAIL_MS = 250
/** visual level: this many dB above the room is "full" (the orb and the core then react to quiet voices too) */
const VISUAL_SPAN_DB = 30

/** The page session's detector: the noise floor and what "auto" sensitivity learned survive from listen to listen. */
export const activity = new VoiceActivity(settingsSensitivity())

function settingsSensitivity(): Sensitivity {
  try {
    return loadSettings().sensitivity
  } catch {
    return 'auto'
  }
}

/** Apply a new sensitivity at once (the settings panel calls this; every listen also re-reads the setting). */
export function setMicSensitivity(s: Sensitivity) {
  activity.setSensitivity(s)
}

/** A second capture may run next to speech recognition here (see the note at the top). */
export function parallelCaptureOK(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent ?? '')) return false
  return !(typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches)
}

// ---------------------------------------------------------------------------------------------------------
// One capture, reduced to numbers

type Tap = { stream: MediaStream; ac: AudioContext; read: () => { rms: number; peak: number } | null; label: string; deviceId: string; close: () => void }

async function openTap(deviceId?: string): Promise<Tap> {
  const audio: MediaTrackConstraints = deviceId ? { ...MIC_CONSTRAINTS, deviceId: { exact: deviceId } } : MIC_CONSTRAINTS
  const stream = await navigator.mediaDevices.getUserMedia({ audio })
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ac = new AC()
  const an = ac.createAnalyser()
  an.fftSize = FFT
  an.smoothingTimeConstant = 0
  ac.createMediaStreamSource(stream).connect(an)
  void ac.resume?.().catch(() => undefined)
  const buf = new Float32Array(an.fftSize)
  const track = stream.getAudioTracks()[0]
  let nudged = 0
  return {
    stream,
    ac,
    label: track?.label ?? '',
    deviceId: track?.getSettings?.().deviceId ?? '',
    // a context the browser has not started yet delivers zeros: that is "not measured", never "silence"
    read: () => {
      if (ac.state !== 'running') {
        // opened before the first click or key (wake word at page load): ask again, at most once a second
        const now = Date.now()
        if (ac.state === 'suspended' && now - nudged > 1000) {
          nudged = now
          void ac.resume?.().catch(() => undefined)
        }
        return null
      }
      an.getFloatTimeDomainData(buf)
      let sum = 0
      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i]
        sum += v * v
        const a = v < 0 ? -v : v
        if (a > peak) peak = a
      }
      return { rms: Math.sqrt(sum / buf.length), peak }
    },
    close: () => {
      stream.getTracks().forEach((t) => t.stop()) // the microphone is released as soon as measuring ends
      void ac.close().catch(() => undefined)
    },
  }
}

// ---------------------------------------------------------------------------------------------------------
// The shared meter while AURA listens

let visualUsers = 0
let monitorUsers = 0
let tap: Tap | null = null
let opening = false
let generation = 0
let raf = 0
let timer: ReturnType<typeof setInterval> | undefined
let lastSample = 0
let shown = 0
let synthetic = false
let t0 = 0

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function sample(now: number) {
  if (!tap || now - lastSample < 10) return
  const dt = Math.min(0.25, (now - lastSample) / 1000)
  lastSample = now
  // AURA's own voice from the loudspeaker (and the room's echo of it) is never measured as the person
  const self = selfVoice(Date.now(), METER_TAIL_MS)
  const s = tap.read()
  if (!s) return
  activity.push(s.rms, now, { peak: s.peak, self })
  if (visualUsers === 0 || isSpeaking()) return // while AURA speaks, speech.ts owns the published level
  // the visuals follow how far the voice is above the room, so a quiet speaker moves them as much as a loud one
  const target = Math.min(1, Math.max(0, (activity.levelDb - activity.floorDb - 3) / VISUAL_SPAN_DB))
  shown += (target - shown) * (1 - Math.exp(-dt / (target > shown ? 0.03 : 0.12)))
  setVoiceLevel(reducedMotion() ? 0.15 : shown)
}

function frame() {
  raf = 0
  if (visualUsers === 0) return
  const now = performance.now()
  if (synthetic) setVoiceLevel(reducedMotion() ? 0.15 : 0.18 + 0.12 * Math.sin((now - t0) / 260))
  else sample(now)
  raf = requestAnimationFrame(frame)
}

function sync() {
  const want = visualUsers + monitorUsers > 0
  if (typeof window === 'undefined') return
  if (want && !tap && !opening && !synthetic) {
    if (!parallelCaptureOK()) {
      synthetic = true
      t0 = performance.now()
    } else {
      opening = true
      const my = ++generation
      activity.setSensitivity(settingsSensitivity())
      openTap()
        .then((t) => {
          opening = false
          if (my !== generation || visualUsers + monitorUsers === 0) return t.close()
          tap = t
          lastSample = 0
          shown = 0
          timer = setInterval(() => sample(performance.now()), SAMPLE_EVERY_MS)
          sync()
        })
        .catch(() => {
          opening = false // no level: the visuals stay calm and the listener times the utterance from words alone
        })
    }
  }
  if (!want) {
    generation++
    clearInterval(timer)
    timer = undefined
    tap?.close()
    tap = null
    synthetic = false
    setVoiceLevel(0)
  }
  if (visualUsers > 0 && !raf && typeof requestAnimationFrame !== 'undefined' && (tap || synthetic)) raf = requestAnimationFrame(frame)
  if (visualUsers === 0 && raf) {
    cancelAnimationFrame(raf)
    raf = 0
  }
}

/** Start metering for the visuals (or join the running meter). Returns the stop function; safe to call twice. */
export function startMicLevel(): () => void {
  visualUsers++
  sync()
  let done = false
  return () => {
    if (done) return
    done = true
    visualUsers = Math.max(0, visualUsers - 1)
    if (visualUsers === 0) setVoiceLevel(0)
    sync()
  }
}

/**
 * For a small live input meter while AURA listens: how far the sound is above the room (0..1) and whether it counts
 * as speech. null when nothing is being measured (phones, no permission, not listening).
 */
export function micLevelNow(): { level: number; voiced: boolean } | null {
  if (!tap || tap.ac.state !== 'running' || lastSample === 0) return null
  return { level: Math.min(1, Math.max(0, (activity.levelDb - activity.floorDb - 3) / VISUAL_SPAN_DB)), voiced: activity.voiced }
}

export type MicMonitor = {
  /** the detector once the microphone is really being measured; null before that and where it cannot be */
  activity: () => VoiceActivity | null
  /** start a new measuring window (one utterance); valid before the microphone is live */
  mark: () => void
  stop: () => void
}

/**
 * Measure voice activity for a listener, without driving any visuals. Returns null where a second capture next
 * to speech recognition is not safe (phones, tablets) or not possible: the caller then works from words alone.
 */
export function startMicMonitor(): MicMonitor | null {
  if (!parallelCaptureOK()) return null
  activity.setSensitivity(settingsSensitivity())
  monitorUsers++
  sync()
  let done = false
  return {
    activity: () => (tap && tap.ac.state === 'running' && lastSample > 0 ? activity : null),
    mark: () => activity.mark(),
    stop: () => {
      if (done) return
      done = true
      monitorUsers = Math.max(0, monitorUsers - 1)
      sync()
    },
  }
}

// ---------------------------------------------------------------------------------------------------------
// The microphone check (voice settings): its own stream, on the device the person picked

export type MicReading = { levelDb: number; floorDb: number; thresholdDb: number; peakDb: number; voiced: boolean; stats: ActivityStats }
export type MicCheck = { label: string; deviceId: string; read: () => MicReading | null; restart: () => void; stop: () => void }
export type MicDevice = { id: string; label: string }

export type MicOpenError = 'denied' | 'no-mic' | 'unsupported' | 'other'

export function micOpenError(e: unknown): MicOpenError {
  const name = (e as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'no-mic'
  return 'other'
}

/** Open the microphone for a check. Rejects with the browser's error (see micOpenError). */
export async function openMicCheck(deviceId?: string): Promise<MicCheck> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' })
  const t = await openTap(deviceId)
  const vad = new VoiceActivity(settingsSensitivity())
  vad.mark()
  return {
    label: t.label,
    deviceId: t.deviceId,
    read: () => {
      const s = t.read()
      if (!s) return null
      vad.setSensitivity(activity.sensitivity)
      vad.push(s.rms, performance.now(), { peak: s.peak })
      return { levelDb: vad.levelDb, floorDb: vad.floorDb, thresholdDb: vad.thresholdDb, peakDb: vad.stats().peakDb, voiced: vad.voiced, stats: vad.stats() }
    },
    restart: () => vad.mark(),
    stop: t.close,
  }
}

/** Microphones the browser will name (labels are empty until microphone access was granted once). */
export async function listMicrophones(): Promise<MicDevice[]> {
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }))
  } catch {
    return []
  }
}
