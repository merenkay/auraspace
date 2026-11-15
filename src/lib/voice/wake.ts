// When the always-on wake-word listener runs. Pure orchestration (no React, no browser objects): the voice agent
// feeds it the facts and gives it a factory for the listener (recognition.ts createListener in 'wake' mode).
//
// The rules:
//  - the microphone is never opened for the wake word before the person has deliberately used the microphone in
//    this tab (a tap on the mic button, Alt+V, Space, or switching the wake word on): that is `armed`, kept in
//    sessionStorage so a reload in the same tab keeps it, and never across tabs or browser restarts;
//  - armed + switched on + signed in + not the guided tour + supported + the tab visible + no command being heard
//    = listening, across pages, with the panel open or closed, after every command, reply and error;
//  - a browser refusal (microphone blocked, no microphone, no recognition) disarms it and says why; the next
//    deliberate use of the microphone arms it again. A dropped connection is reported but retried (recognition.ts);
//  - a health check every HEALTH_MS restarts a listener that should be running but is not.
import type { Listener, RecError } from './recognition'

export const WAKE_HEALTH_MS = 5000
const ARMED_KEY = 'aura.voice.wakeArmed'

export type WakeIssue = 'denied' | 'no-mic' | 'unsupported' | 'network' | 'other'
/**
 * off = switched off · tour = the guided tour (always off) · unsupported = no recognition in this browser ·
 * unarmed = on, waiting for the first deliberate use of the microphone · listening · paused = a command is being
 * heard or the tab is hidden (it comes back by itself) · blocked = the browser refused (see issue).
 */
export type WakeStatus = 'off' | 'tour' | 'unsupported' | 'signed-out' | 'unarmed' | 'listening' | 'paused' | 'blocked'

export type WakeInputs = {
  enabled: boolean
  signedIn: boolean
  tour: boolean
  supported: boolean
  visible: boolean
  /** a command listen owns the microphone (browsers run one recognition session at a time) */
  cmdActive: boolean
  /** the listener's configuration (language, timing, wake phrases): a change restarts a running listener */
  key: string
}

export type WakeHooks = { error: (e: RecError) => void; end: () => void }
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export type WakeControllerDeps = {
  /** a new, not yet started wake listener; null when the browser has none */
  make: (hooks: WakeHooks) => Listener | null
  /** where `armed` is kept (sessionStorage); null = this page only */
  storage?: Store | null
  onStatus?: (status: WakeStatus, issue: WakeIssue | null) => void
  healthMs?: number
}

const FATAL: Partial<Record<RecError, WakeIssue>> = { denied: 'denied', 'no-mic': 'no-mic', unsupported: 'unsupported' }

export class WakeController {
  private l: Listener | null = null
  private runningKey = ''
  private armed = false
  private issue: WakeIssue | null = null
  private inputs: WakeInputs = { enabled: false, signedIn: false, tour: false, supported: false, visible: true, cmdActive: false, key: '' }
  private timer: ReturnType<typeof setInterval> | undefined
  private last = ''
  private disposed = false
  /** listeners started so far (tests: no microphone before the first deliberate use) */
  starts = 0

  constructor(private deps: WakeControllerDeps) {
    try {
      this.armed = deps.storage?.getItem(ARMED_KEY) === '1'
    } catch {
      this.armed = false
    }
    this.timer = setInterval(() => this.sync(), deps.healthMs ?? WAKE_HEALTH_MS)
  }

  set(patch: Partial<WakeInputs>) {
    this.inputs = { ...this.inputs, ...patch }
    this.sync()
  }

  /** The person deliberately used the microphone (or switched the wake word on): wake listening may start. */
  arm() {
    if (!this.armed) {
      this.armed = true
      try {
        this.deps.storage?.setItem(ARMED_KEY, '1')
      } catch {
        /* this page only */
      }
    }
    this.issue = null
    this.sync()
  }

  isArmed() {
    return this.armed
  }

  running() {
    return this.l !== null
  }

  private disarm(issue: WakeIssue) {
    this.armed = false
    this.issue = issue
    try {
      this.deps.storage?.removeItem(ARMED_KEY)
    } catch {
      /* nothing kept */
    }
    this.stop()
    this.publish()
  }

  private should() {
    const i = this.inputs
    return !this.disposed && this.armed && i.enabled && i.signedIn && !i.tour && i.supported && i.visible && !i.cmdActive
  }

  status(): WakeStatus {
    const i = this.inputs
    if (!i.enabled) return 'off'
    if (i.tour) return 'tour'
    if (!i.supported) return 'unsupported'
    if (!i.signedIn) return 'signed-out'
    if (!this.armed) return this.issue && this.issue !== 'network' ? 'blocked' : 'unarmed'
    if (!i.visible || i.cmdActive) return 'paused'
    return 'listening'
  }

  currentIssue(): WakeIssue | null {
    return this.issue
  }

  sync() {
    if (this.should()) {
      if (this.l && this.runningKey !== this.inputs.key) this.stop()
      if (!this.l) this.start()
    } else this.stop()
    this.publish()
  }

  private start() {
    const key = this.inputs.key
    let mine: Listener | null = null
    const hooks: WakeHooks = {
      error: (e) => {
        if (this.l !== mine || !mine) return
        const fatal = FATAL[e]
        if (fatal) return this.disarm(fatal)
        if (e === 'network') {
          this.issue = 'network'
          this.publish()
        }
      },
      end: () => {
        if (this.l !== mine) return
        // the listener gave up on its own: the health check (or the next sync) starts a new one if it should run
        this.l = null
        this.publish()
      },
    }
    mine = this.deps.make(hooks)
    if (!mine) {
      this.disarm('unsupported')
      return
    }
    this.l = mine
    this.runningKey = key
    this.starts++
    if (this.issue === 'network') this.issue = null
    mine.start()
  }

  private stop() {
    const l = this.l
    this.l = null
    l?.abort()
  }

  private publish() {
    const s = this.status()
    const sig = `${s}|${this.issue ?? ''}`
    if (sig === this.last) return
    this.last = sig
    this.deps.onStatus?.(s, this.issue)
  }

  dispose() {
    this.disposed = true
    clearInterval(this.timer)
    this.stop()
  }
}
