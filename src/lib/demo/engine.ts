// Jury demo mode: the script engine. It plays a declarative script (types.ts) step by step through a Driver
// and publishes one immutable snapshot for the UI. It knows nothing about the DOM, React or the app, so it is
// unit-tested with a fake driver and fake timers (engine.test.ts).
//
// One step runs like this:
//   1. scene      the right person is signed in and the right page is open (a card step shows its card first,
//                 so the page changes behind it)
//   2. before     set-up actions
//   3. locate     wait for the target; an optional step whose target is missing is skipped, a required one is
//                 shown without a spotlight
//   4. show       caption + spotlight + sound cue + spoken narration
//   5. during     actions played on screen (typing, clicks, waiting for a result)
//   6. hold       the rest of the step's duration; pause freezes it, speed scales it
// Steps 1–3 never wait for pause or speed: "Next" while paused still brings the next step on screen.
import type { Action, Card, Chapter, ChapterInfo, Driver, FlatStep, Highlight, RunContext, Script, Snapshot } from './types'

const ABORT = Symbol('demo-step-left')

/** Minimum time a step stays after its `during` actions ended, so the result can be read (timeline ms). */
export const SETTLE_MS = 1400
/** Longest extra wait for spoken narration to finish after the step's own time is up (timeline ms). */
export const NARRATION_GRACE_MS = 10_000
export const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

const DEFAULT_TIMEOUT = 6000
const OPTIONAL_TIMEOUT = 1500
const TICK_MS = 100

type Sleeper = { left: number; scaled: boolean; pausable: boolean; since: number | null; handle: ReturnType<typeof setTimeout> | null; resolve: () => void; reject: (e: unknown) => void }

export type EngineOptions = {
  /** Clock, for tests. */
  now?: () => number
  /** Called with errors that an action or the driver threw (the tour carries on). */
  onError?: (error: unknown, where: string) => void
}

/** Flattens chapters into one list of steps with their nominal start times. A skipped optional step simply moves the position on. */
export function flatten(script: Script): { steps: FlatStep[]; chapters: ChapterInfo[]; totalMs: number } {
  const steps: FlatStep[] = []
  const chapters: ChapterInfo[] = []
  let at = 0
  script.chapters.forEach((ch: Chapter, ci) => {
    const startMs = at
    const firstStep = steps.length
    ch.steps.forEach((s, si) => {
      steps.push({ ...s, scene: s.scene ?? ch.scene, chapter: ci, first: si === 0, startMs: at })
      at += s.duration
    })
    chapters.push({ id: ch.id, title: ch.title, index: ci, firstStep, startMs, endMs: at })
  })
  return { steps, chapters, totalMs: at }
}

export class TourEngine {
  readonly steps: FlatStep[]
  readonly chapters: ChapterInfo[]
  readonly totalMs: number

  private driver: Driver
  private now: () => number
  private onError: (error: unknown, where: string) => void
  private listeners = new Set<() => void>()
  private snap: Snapshot
  private run = 0
  private sleepers = new Set<Sleeper>()
  private ticker: ReturnType<typeof setInterval> | null = null
  private lastTick = 0
  /** Timeline ms spent in the current step since it appeared. */
  private held = 0

  constructor(script: Script, driver: Driver, opts: EngineOptions = {}) {
    const flat = flatten(script)
    this.steps = flat.steps
    this.chapters = flat.chapters
    this.totalMs = flat.totalMs
    this.driver = driver
    this.now = opts.now ?? (() => Date.now())
    this.onError = opts.onError ?? (() => undefined)
    this.snap = {
      status: 'idle',
      index: 0,
      stepId: null,
      chapter: 0,
      phase: 'preparing',
      caption: '',
      card: null,
      highlight: null,
      positionMs: 0,
      totalMs: this.totalMs,
      playedMs: 0,
      speed: 1,
      skipped: [],
      missing: [],
    }
  }

  /* ------------------------------------------------------------ store */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
  getSnapshot = () => this.snap

  private set(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  /* --------------------------------------------------------- controls */

  /** Start playing from a chapter (default: the beginning). */
  start(chapter = 0) {
    const ch = this.chapters[Math.min(Math.max(0, chapter), this.chapters.length - 1)]
    this.set({ status: 'playing', skipped: [], missing: [], playedMs: 0 })
    this.startTicker()
    void this.runStep(ch.firstStep, chapter > 0 ? 'jump' : 'sequence')
  }

  play() {
    if (this.snap.status === 'idle') return this.start()
    if (this.snap.status === 'finished') return
    if (this.snap.status === 'playing') return
    this.set({ status: 'playing' })
    this.lastTick = this.now()
    this.sleepers.forEach((s) => this.arm(s))
    this.startTicker()
    this.driver.paused?.(false)
  }

  pause() {
    if (this.snap.status !== 'playing') return
    this.tick()
    this.sleepers.forEach((s) => s.pausable && this.disarm(s))
    this.set({ status: 'paused' })
    this.stopTicker()
    this.driver.paused?.(true)
  }

  toggle() {
    if (this.snap.status === 'playing') this.pause()
    else this.play()
  }

  /** Go to the next step now. Keeps the paused / playing state. */
  next() {
    if (this.snap.status === 'idle') return
    const i = this.snap.index + 1
    if (i >= this.steps.length) return
    this.revive()
    void this.runStep(i, 'sequence')
  }

  /**
   * Go back one step. A step that depends on what happened on the page before it (rewind: false) cannot be
   * re-entered on its own, so Back then returns to the start of its chapter; from a chapter's first step it
   * goes to the start of the previous chapter.
   */
  back() {
    if (this.snap.status === 'idle') return
    const i = this.snap.index
    const cur = this.steps[i]
    const start = this.chapters[cur.chapter].firstStep
    this.revive()
    if (i === start) {
      const prev = this.chapters[Math.max(0, cur.chapter - 1)]
      return void this.runStep(prev.firstStep, 'jump')
    }
    const prev = this.steps[i - 1]
    if (cur.rewind === false || prev.rewind === false || i - 1 === start) return void this.runStep(start, 'jump')
    void this.runStep(i - 1, 'sequence')
  }

  /** Jump to the start of a chapter. */
  seekChapter(chapter: number) {
    if (this.snap.status === 'idle') return
    const ch = this.chapters[chapter]
    if (!ch) return
    this.revive()
    void this.runStep(ch.firstStep, 'jump')
  }

  setSpeed(speed: number) {
    if (speed === this.snap.speed || !(speed > 0)) return
    this.tick()
    const armed = [...this.sleepers].filter((s) => s.since != null)
    armed.forEach((s) => this.disarm(s))
    this.set({ speed })
    armed.forEach((s) => this.arm(s))
  }

  /** Stop everything (leaving the tour). The engine can be started again. */
  stop() {
    this.run++
    this.cancelSleepers()
    this.stopTicker()
    this.driver.leave?.()
    this.set({ status: 'idle', card: null, highlight: null, caption: '', stepId: null, phase: 'preparing' })
  }

  /** A finished tour that is navigated again keeps its controls alive. */
  private revive() {
    if (this.snap.status === 'finished') {
      this.set({ status: 'paused' })
    }
  }

  /* ----------------------------------------------------------- timers */

  private startTicker() {
    if (this.ticker) return
    this.lastTick = this.now()
    this.ticker = setInterval(() => this.tick(), TICK_MS)
  }
  private stopTicker() {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
  }

  /** Advances the clocks shown in the UI (timeline position, wall-clock timer). */
  private tick() {
    if (this.snap.status !== 'playing') return
    const t = this.now()
    const real = Math.max(0, t - this.lastTick)
    this.lastTick = t
    if (!real) return
    const patch: Partial<Snapshot> = { playedMs: this.snap.playedMs + real }
    if (this.snap.phase === 'showing') {
      this.held += real * this.snap.speed
      const step = this.steps[this.snap.index]
      patch.positionMs = step.startMs + Math.min(step.duration, this.held)
    }
    this.set(patch)
  }

  private arm(s: Sleeper) {
    if (s.since != null) return
    if (s.pausable && this.snap.status !== 'playing') return
    s.since = this.now()
    s.handle = setTimeout(() => {
      this.sleepers.delete(s)
      s.resolve()
    }, Math.max(0, s.left / (s.scaled ? this.snap.speed : 1)))
  }
  private disarm(s: Sleeper) {
    if (s.since == null) return
    if (s.handle) clearTimeout(s.handle)
    s.left = Math.max(0, s.left - (this.now() - s.since) * (s.scaled ? this.snap.speed : 1))
    s.since = null
    s.handle = null
  }
  private wait(ms: number, token: number, kind: 'timeline' | 'real'): Promise<void> {
    if (token !== this.run) return Promise.reject(ABORT)
    return new Promise<void>((resolve, reject) => {
      const s: Sleeper = { left: Math.max(0, ms), scaled: kind === 'timeline', pausable: kind === 'timeline', since: null, handle: null, resolve, reject }
      this.sleepers.add(s)
      this.arm(s)
    })
  }
  private cancelSleepers() {
    this.sleepers.forEach((s) => {
      if (s.handle) clearTimeout(s.handle)
      s.reject(ABORT)
    })
    this.sleepers.clear()
  }

  /* ------------------------------------------------------------- play */

  private async safe<T>(where: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (e) {
      if (e === ABORT) throw e
      this.onError(e, where)
      return fallback
    }
  }

  /** `onScreen`: the actions are part of the show, so they wait while the tour is paused. Set-up actions never do. */
  private async actions(list: Action[] | undefined, ctx: RunContext, where: string, onScreen: boolean) {
    for (const a of list ?? []) {
      if (!ctx.alive()) throw ABORT
      if (onScreen) await ctx.sleep(1)
      if (a.type === 'wait') await (onScreen ? ctx.sleep(a.ms) : ctx.delay(a.ms))
      else await this.safe(`${where}:${a.type}`, 'missing' as const, () => this.driver.act(a, ctx))
    }
    if (!ctx.alive()) throw ABORT
  }

  private show(step: FlatStep, card: Card | null, highlight: Highlight | null) {
    this.held = 0
    this.lastTick = this.now()
    this.set({ phase: 'showing', caption: step.caption, card, highlight, positionMs: step.startMs })
  }

  private async runStep(index: number, entry: 'sequence' | 'jump') {
    const token = ++this.run
    this.cancelSleepers()
    this.driver.leave?.()
    const step = this.steps[index]
    const ctx: RunContext = {
      sleep: (ms) => this.wait(ms, token, 'timeline'),
      delay: (ms) => this.wait(ms, token, 'real'),
      alive: () => token === this.run,
    }
    const where = `step ${step.id}`
    this.set({ index, stepId: step.id, chapter: step.chapter, phase: 'preparing', positionMs: step.startMs })
    try {
      // A card covers the page, so it goes up first and the page changes behind it.
      if (step.card) this.show(step, step.card, null)
      await this.safe(`${where}:scene`, undefined, () => this.driver.scene(step.scene, { fresh: entry === 'jump' && step.first }, ctx))
      if (!ctx.alive()) return
      await this.actions(step.before, ctx, `${where}:before`, false)

      let found = false
      if (step.target && !step.card) {
        const timeout = step.timeout ?? (step.optional ? OPTIONAL_TIMEOUT : DEFAULT_TIMEOUT)
        found = await this.safe(`${where}:locate`, false, () => this.driver.locate(step.target!, timeout, ctx))
        if (!ctx.alive()) return
        if (!found && step.optional) {
          this.set({ skipped: [...this.snap.skipped, step.id] })
          return this.advance(index, token)
        }
        if (!found) this.set({ missing: [...this.snap.missing, step.id] })
      }
      if (!step.card) this.show(step, null, found && step.target ? { key: step.id, target: step.target, callout: step.callout, pad: step.pad } : null)
      if (step.cue) this.driver.cue(step.cue)
      let spoken = false
      const narration = this.safe(`${where}:narrate`, undefined, () => this.driver.narrate(step.caption)).then(
        () => void (spoken = true),
        () => void (spoken = true),
      )

      await this.actions(step.during, ctx, `${where}:during`, true)
      const rest = Math.max(step.duration - this.heldNow(), step.during?.length ? SETTLE_MS : 0)
      if (rest > 0) await ctx.sleep(rest)
      if (!spoken) await Promise.race([narration, ctx.sleep(NARRATION_GRACE_MS)])
      if (!ctx.alive()) return
      if (step.manual) {
        // The closing card stays until the person decides; as the last step it also ends the tour.
        if (index === this.steps.length - 1) this.finish()
        return
      }
      this.advance(index, token)
    } catch (e) {
      if (e === ABORT) return
      this.onError(e, where)
      if (ctx.alive() && !step.manual) this.advance(index, token)
    }
  }

  /** Timeline ms the current step has been on screen, including the part since the last tick. */
  private heldNow() {
    return this.held + (this.snap.status === 'playing' ? Math.max(0, this.now() - this.lastTick) * this.snap.speed : 0)
  }

  private advance(index: number, token: number) {
    if (token !== this.run) return
    if (index + 1 < this.steps.length) return void this.runStep(index + 1, 'sequence')
    this.finish()
  }

  private finish() {
    this.tick()
    this.stopTicker()
    this.set({ status: 'finished', positionMs: this.totalMs })
  }
}
