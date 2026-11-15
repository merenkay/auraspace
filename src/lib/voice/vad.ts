// Voice activity from the microphone level: is someone speaking right now, how loud is the room, how loud was the
// speech. Pure (no browser objects): level.ts feeds it one RMS sample per analysis frame with a timestamp, the
// listener (recognition.ts) and the microphone check read it. Nothing is recorded; only these few numbers exist.
//
// How it decides:
//  - Level: the RMS in dBFS, followed twice: quickly (40 ms) and as an envelope (fast attack, slower release).
//  - Noise floor: "minimum statistics". The lowest quick level of the last ~2 s is taken as the room level.
//    Speech always has gaps (between words and syllables), so the minimum stays at the room; a steady noise (a fan,
//    a pump, traffic) has no gaps, so within about three seconds it BECOMES the floor and stops counting as voice.
//  - Speech: the quick level is at least ON dB above the floor for ON_MS (a click is not speech); it ends when the
//    envelope has been below OFF dB above the floor for HANG_MS. ON > OFF (hysteresis), so a level sitting at the threshold does not flicker.
//  - Sensitivity moves ON/OFF and the absolute gate. "auto" starts at normal and learns in this page session from
//    what happened: speech that was recognised although it was only just above the floor lowers the margin; sound
//    that held the microphone open without any words raises it.
//
// All thresholds are AURA's own engineering choices for the demo, not a standard. They are collected in VAD below.

export type Sensitivity = 'auto' | 'low' | 'normal' | 'high'
export const SENSITIVITIES: Sensitivity[] = ['auto', 'low', 'normal', 'high']

export const VAD = {
  /** envelope smoothing, seconds (the envelope decides when speech ENDS: slow release bridges syllables) */
  ATTACK_S: 0.02,
  RELEASE_S: 0.12,
  /** a second, quick follower: it decides when speech STARTS and finds the room in the gaps between words */
  FAST_S: 0.04,
  /** the floor is the minimum of the envelope over BUCKETS × BUCKET_MS */
  BUCKET_MS: 200,
  BUCKETS: 10,
  /** how fast the floor follows that minimum: down at once, up slowly */
  FLOOR_FALL_S: 0.08,
  FLOOR_RISE_S: 0.6,
  /** floor before anything was measured, and the range it may take (dBFS) */
  FLOOR_START_DB: -58,
  FLOOR_MIN_DB: -80,
  FLOOR_MAX_DB: -22,
  /** dB above the floor that starts speech, per sensitivity ("auto" starts at normal and moves inside AUTO_RANGE) */
  ON_DB: { low: 14, normal: 10, high: 6 } as Record<Exclude<Sensitivity, 'auto'>, number>,
  AUTO_RANGE: [5, 15] as [number, number],
  /** speech ends HYSTERESIS_DB below where it starts */
  HYSTERESIS_DB: 4,
  /** nothing below this absolute level is speech, whatever the floor (dBFS), per sensitivity */
  GATE_DB: { low: -50, normal: -56, high: -62 } as Record<Exclude<Sensitivity, 'auto'>, number>,
  /** the level must stay above the threshold this long to count as speech; and below it this long to end */
  ON_MS: 80,
  HANG_MS: 350,
  /** samples needed before the floor can be trusted */
  CALIBRATE_MS: 400,
  /** a signal that never rises above this is dead: a muted or switched-off microphone delivers (near) zeros (dBFS) */
  SILENT_DB: -75,
  /** this much speech-like sound without a single recognised word is "I heard sound but no words" */
  SOUND_NO_WORDS_MS: 250,
} as const

const LN10_20 = Math.LN10 / 20
export const toDb = (rms: number) => (rms > 1e-5 ? Math.log(rms) / LN10_20 : -100)
export const fromDb = (db: number) => Math.exp(db * LN10_20)
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)

/** What was measured since mark(): one listen, one microphone check. */
export type ActivityStats = {
  /** enough samples arrived for the numbers to mean something */
  measured: boolean
  /** ms of the window covered by samples */
  coveredMs: number
  /** ms judged to be speech */
  voicedMs: number
  /** loudest envelope value, dBFS */
  peakDb: number
  /** mean envelope while voiced, dBFS (NaN when nothing was voiced) */
  speechDb: number
  /** room level, dBFS: the quietest the floor has been in this window */
  floorDb: number
  /** loudest speech above the floor, dB (0 when nothing was voiced) */
  snrDb: number
  /** share of samples at or near full scale (clipping), 0..1 */
  clipped: number
}

export class VoiceActivity {
  private sens: Sensitivity
  /** the learned margin for "auto" (dB above the floor) */
  private autoOn: number = VAD.ON_DB.normal
  private env = -100
  private fast = -100
  private stale = true
  private floor: number = VAD.FLOOR_START_DB
  private buckets: number[] = []
  private bucketAt = 0
  private last = 0
  private total = 0
  private aboveSince = 0
  private belowSince = 0
  private speaking = false
  private lastVoice = -Infinity
  // window statistics (since mark)
  private wCovered = 0
  private wVoiced = 0
  private wPeak = -100
  private wSpeechSum = 0
  private wSnr = 0
  private wSamples = 0
  private wClipped = 0
  private wFloor = Infinity

  constructor(sensitivity: Sensitivity = 'auto') {
    this.sens = sensitivity
  }

  setSensitivity(s: Sensitivity) {
    this.sens = s
  }
  get sensitivity(): Sensitivity {
    return this.sens
  }

  /** dB above the floor at which speech starts right now */
  get onDb(): number {
    return this.sens === 'auto' ? this.autoOn : VAD.ON_DB[this.sens]
  }
  /** absolute speech threshold right now, dBFS (the floor-relative one and the gate, whichever is higher) */
  get thresholdDb(): number {
    const gate = this.sens === 'auto' ? VAD.GATE_DB.normal - (VAD.ON_DB.normal - this.autoOn) : VAD.GATE_DB[this.sens]
    return Math.max(this.floor + this.onDb, gate)
  }
  get floorDb(): number {
    return this.floor
  }
  get levelDb(): number {
    return this.env
  }
  /** someone is speaking (after hysteresis and hang-over) */
  get voiced(): boolean {
    return this.speaking
  }
  /** time of the last speech sample (same clock as push), -Infinity when there was none */
  get lastVoiceAt(): number {
    return this.lastVoice
  }
  /** the floor has been measured */
  get calibrated(): boolean {
    return this.total >= VAD.CALIBRATE_MS
  }

  /**
   * One analysis frame. `rms` is 0..1 (full scale = 1), `now` in ms on any monotonic clock, `peak` the largest
   * absolute sample of the frame (for clipping). `self` = AURA itself is speaking (or just stopped): the frame is
   * dropped, so AURA's own voice from the loudspeaker never counts as the person speaking and never raises the floor.
   */
  push(rms: number, now: number, o: { peak?: number; self?: boolean } = {}) {
    const gap = this.last ? now - this.last : 0
    this.last = now
    if (o.self) {
      this.speaking = false
      this.aboveSince = 0
      this.belowSince = 0
      this.stale = true
      return
    }
    // after a long gap (meter was closed, tab was hidden, AURA was speaking) the old level says nothing about now
    const dt = !this.stale && gap > 0 && gap < 500 ? gap / 1000 : 0
    this.stale = false
    const db = toDb(rms)
    if (dt === 0) {
      this.env = db
      this.fast = db
    } else {
      const tau = db > this.env ? VAD.ATTACK_S : VAD.RELEASE_S
      this.env += (db - this.env) * (1 - Math.exp(-dt / tau))
      this.fast += (db - this.fast) * (1 - Math.exp(-dt / VAD.FAST_S))
    }
    const ms = dt * 1000
    this.total += ms

    // noise floor: minimum of the quick level over the last BUCKETS buckets
    if (!this.buckets.length || now - this.bucketAt >= VAD.BUCKET_MS) {
      this.buckets.push(this.fast)
      if (this.buckets.length > VAD.BUCKETS) this.buckets.shift()
      this.bucketAt = now
    } else {
      const i = this.buckets.length - 1
      if (this.fast < this.buckets[i]) this.buckets[i] = this.fast
    }
    let min = Infinity
    for (const b of this.buckets) if (b < min) min = b
    min = clamp(min, VAD.FLOOR_MIN_DB, VAD.FLOOR_MAX_DB)
    if (this.total < VAD.CALIBRATE_MS) this.floor = min // start-up: take the room as it is, at once
    else {
      const tau = min < this.floor ? VAD.FLOOR_FALL_S : VAD.FLOOR_RISE_S
      this.floor += (min - this.floor) * (1 - Math.exp(-dt / tau))
    }

    // speech with hysteresis
    const on = this.thresholdDb
    const off = on - VAD.HYSTERESIS_DB
    if (!this.speaking) {
      if (this.fast >= on) {
        if (!this.aboveSince) this.aboveSince = now
        if (now - this.aboveSince >= VAD.ON_MS) {
          this.speaking = true
          this.belowSince = 0
        }
      } else this.aboveSince = 0
    } else if (this.env < off) {
      if (!this.belowSince) this.belowSince = now
      if (now - this.belowSince >= VAD.HANG_MS) {
        this.speaking = false
        this.aboveSince = 0
      }
    } else this.belowSince = 0
    // "voice" for the listener is the part actually above the release threshold, not the hang-over
    const loud = this.speaking && this.env >= off
    if (loud) this.lastVoice = now

    // window statistics
    this.wSamples++
    this.wCovered += ms
    if (this.env > this.wPeak) this.wPeak = this.env
    if (this.total >= VAD.CALIBRATE_MS && this.floor < this.wFloor) this.wFloor = this.floor
    if ((o.peak ?? 0) >= 0.985) this.wClipped++
    if (loud) {
      this.wVoiced += ms
      this.wSpeechSum += this.env * ms
      const snr = this.env - this.floor
      if (snr > this.wSnr) this.wSnr = snr
    }
  }

  /** Start a new measuring window (one listen). The floor and what "auto" learned are kept. */
  mark() {
    this.wCovered = 0
    this.wVoiced = 0
    this.wPeak = -100
    this.wSpeechSum = 0
    this.wSnr = 0
    this.wSamples = 0
    this.wClipped = 0
    this.wFloor = Infinity
  }

  stats(): ActivityStats {
    return {
      measured: this.wCovered >= VAD.CALIBRATE_MS,
      coveredMs: this.wCovered,
      voicedMs: this.wVoiced,
      peakDb: this.wPeak,
      speechDb: this.wVoiced > 0 ? this.wSpeechSum / this.wVoiced : NaN,
      floorDb: Number.isFinite(this.wFloor) ? this.wFloor : this.floor,
      snrDb: this.wSnr,
      clipped: this.wSamples ? this.wClipped / this.wSamples : 0,
    }
  }

  /**
   * "auto" only: learn from how a listen ended. Words recognised from speech that was barely above the floor
   * (or not even detected): be more sensitive. Sound that looked like speech but gave no words: be less.
   */
  learn(words: boolean) {
    if (this.sens !== 'auto') return
    const s = this.stats()
    if (!s.measured) return
    const [lo, hi] = VAD.AUTO_RANGE
    if (words) {
      // aim the threshold 5 dB under the loudest speech of this utterance, never above normal by this path
      const want = s.voicedMs > 0 ? s.snrDb - 5 : Math.max(lo, s.peakDb - s.floorDb - 2)
      if (want < this.autoOn) this.autoOn = clamp(this.autoOn + (want - this.autoOn) * 0.5, lo, hi)
      else if (this.autoOn < VAD.ON_DB.normal) this.autoOn = Math.min(VAD.ON_DB.normal, this.autoOn + 0.5) // drift home
    } else if (s.voicedMs >= VAD.SOUND_NO_WORDS_MS) this.autoOn = clamp(this.autoOn + 1.5, lo, hi)
  }

  /** Forget everything (tests, a new microphone). */
  reset() {
    this.autoOn = VAD.ON_DB.normal
    this.env = -100
    this.fast = -100
    this.stale = true
    this.floor = VAD.FLOOR_START_DB
    this.buckets = []
    this.bucketAt = 0
    this.last = 0
    this.total = 0
    this.aboveSince = 0
    this.belowSince = 0
    this.speaking = false
    this.lastVoice = -Infinity
    this.mark()
  }
}

// ---------------------------------------------------------------------------------------------------------
// Why a listen ended without words

/**
 * `no-words`: speech-like sound was measured, but the recogniser returned no words ·
 * `mic-silent`: the level stayed at the room's noise floor the whole time (muted, too far, or nobody spoke) ·
 * `no-speech`: nothing could be measured (phones, no microphone permission for the meter), so we cannot tell.
 */
export type SilenceReason = 'no-speech' | 'no-words' | 'mic-silent'

/** Nothing was recognised: why? */
export function explainSilence(s: ActivityStats | null): SilenceReason {
  if (!s || !s.measured) return 'no-speech'
  return s.voicedMs >= VAD.SOUND_NO_WORDS_MS ? 'no-words' : 'mic-silent'
}

// ---------------------------------------------------------------------------------------------------------
// Microphone check: a verdict a person can act on

export type MicVerdict = 'waiting' | 'silent' | 'quiet' | 'loud' | 'noisy' | 'good'

export const MIC_CHECK = {
  /** speech must be heard for this long before there is a verdict */
  MIN_SPEECH_MS: 600,
  /** mean speech level under this is too quiet for a recogniser to work with comfortably (dBFS) */
  QUIET_DB: -38,
  /** more than this share of frames at full scale, or a loudest moment above LOUD_DB (RMS, dBFS), is too loud */
  CLIP_SHARE: 0.01,
  LOUD_DB: -9,
  /** a room louder than this, or speech less than MIN_SNR_DB above it, is noisy */
  NOISY_FLOOR_DB: -42,
  MIN_SNR_DB: 12,
  /** no speech after this long: say what we see instead of "waiting" (silent or just nobody speaking) */
  GIVE_UP_MS: 4000,
} as const

export const VERDICT_TEXT: Record<MicVerdict, { title: string; advice: string }> = {
  waiting: { title: 'Say a sentence', advice: 'Speak as you normally would, for example “AURA, how am I doing today?”.' },
  silent: { title: 'No signal', advice: 'The microphone seems muted, switched off or the wrong one. Check the mute key and the input chosen in the browser’s site settings.' },
  quiet: { title: 'Too quiet', advice: 'Move closer to the microphone or raise the input volume in the system sound settings. Setting sensitivity to High also helps.' },
  loud: { title: 'Too loud', advice: 'The signal is distorting. Move back a little or lower the input volume in the system sound settings.' },
  noisy: { title: 'Noisy room', advice: 'Background sound is close to the level of your voice. Move closer, use a headset, or set sensitivity to Low so noise is ignored.' },
  good: { title: 'Good level', advice: 'Your voice is clearly above the room. AURA should hear you well from here.' },
}

export function micVerdict(s: ActivityStats): MicVerdict {
  if (!s.measured) return 'waiting'
  if (s.voicedMs < MIC_CHECK.MIN_SPEECH_MS) {
    if (s.coveredMs < MIC_CHECK.GIVE_UP_MS) return 'waiting'
    return s.peakDb < VAD.SILENT_DB ? 'silent' : s.floorDb > MIC_CHECK.NOISY_FLOOR_DB ? 'noisy' : 'waiting'
  }
  if (s.clipped > MIC_CHECK.CLIP_SHARE || s.peakDb > MIC_CHECK.LOUD_DB) return 'loud'
  if (s.speechDb < MIC_CHECK.QUIET_DB) return 'quiet'
  if (s.floorDb > MIC_CHECK.NOISY_FLOOR_DB || s.snrDb < MIC_CHECK.MIN_SNR_DB) return 'noisy'
  return 'good'
}
