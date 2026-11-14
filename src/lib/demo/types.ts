// Jury demo mode: the vocabulary of the tour script. The script (script.ts) is plain data in these shapes;
// the engine (engine.ts) plays it and a driver (driver.ts in the browser, a fake in tests) carries out each action.
import type { SystemId } from '../../data/systems'
import type { FieldId } from '../../data/vitals'
import type { Sfx } from '../sfx'

/**
 * How to find an element on the page. A plain string is a CSS selector. The object form adds a text filter
 * (the most specific match wins) and can climb to an ancestor. Elements that are not laid out are ignored,
 * so a desktop-only and a phone-only selector can be listed side by side.
 */
export type TargetSpec =
  | string
  | {
      css: string
      /** The element's text must contain this (case-insensitive). */
      text?: string
      /** The element's text must equal `text` exactly (after trimming). */
      exact?: boolean
      /** Use the closest ancestor matching this selector instead of the match itself. */
      closest?: string
    }

/** One spec, or alternatives tried in order (first that exists wins). */
export type Target = TargetSpec | TargetSpec[]

export type PersonaId = 'okafor' | 'reyes' | 'polar' | 'home'

/** Where a step happens: who is signed in (inside the sandbox) and which page. `:id` is that person's record id. */
export type Scene = { persona: PersonaId; route: string }

export type Action =
  /** Go to another page of the app. `:id` is replaced by the current persona's record id. */
  | { type: 'navigate'; to: string }
  /** Ask the page to select a body system (the same event voice and hand control use). */
  | { type: 'select-system'; system: SystemId | null }
  /** Click an element. `unless`: do nothing when that element already exists (makes the click repeatable). */
  | { type: 'click'; target: Target; unless?: Target; timeout?: number }
  /** Set a toggle (aria-pressed / aria-expanded / <details open>) to a state; clicks only when it differs. */
  | { type: 'set'; target: Target; on: boolean; timeout?: number }
  /** Type into a text field one character at a time, then optionally submit its form. */
  | { type: 'type'; target: Target; text: string; cps?: number; submit?: boolean }
  /** Scripted data: a new reading arrives for the signed-in persona (sandbox only). Applied once per `key`. */
  | { type: 'reading'; key: string; values: Partial<Record<FieldId, number>>; device: string }
  /** Hold the timeline (scaled by the playback speed, stops while paused). */
  | { type: 'wait'; ms: number }
  /** Wait until an element exists (real time). The step carries on without it after the timeout. */
  | { type: 'waitFor'; target: Target; timeout?: number }
  /** Scroll the page to the top, or an element into view. */
  | { type: 'scroll'; target?: Target }
  /** Close any open sheet or dialog. */
  | { type: 'close-overlays' }
  /** A sound cue (plays only when the person has sound on). */
  | { type: 'sfx'; name: Sfx }
  /** Ask the AURA voice assistant to speak (uiBus `say`; ignored when voice output is off). */
  | { type: 'say'; text: string; urgent?: boolean }

/** Full-screen cards. The content of each kind lives in components/demo/Cards.tsx. */
export type Card =
  | { kind: 'chapter'; number: number; title: string; subtitle: string }
  | { kind: 'delay' }
  | { kind: 'promise' }
  | { kind: 'context'; context: 'polar' | 'home' }
  | { kind: 'principles' }
  | { kind: 'closing' }

export type Callout = { title?: string; text: string }

export type Step = {
  id: string
  /** Narration. Always shown as a caption; spoken too when sound is on. */
  caption: string
  /** How long the step stays on screen at 1× speed, in ms (longer if its `during` actions need more). */
  duration: number
  /** Overrides the chapter's scene. */
  scene?: Scene
  /** A full-screen card instead of a highlight on the page. The page behind it changes while it is shown. */
  card?: Card
  /** Actions that set the page up, run before the step appears. */
  before?: Action[]
  /** The element to put under the spotlight. */
  target?: Target
  callout?: Callout
  /** Extra space around the target, px. */
  pad?: number
  /** Actions played while the step is on screen (typing, clicks, waiting for a result). */
  during?: Action[]
  /** For features that may not be in the build: skip the whole step when `target` is not found. */
  optional?: boolean
  /** How long to wait for `target`, ms (real time). Default 6000, or 1500 for optional steps. */
  timeout?: number
  /** Sound cue when the step appears. */
  cue?: Sfx
  /** false: the step depends on what earlier steps did on the page (typed text, a running simulation), so Back returns to the chapter start. */
  rewind?: false
  /** Stay on this step until the person moves on (the closing card). */
  manual?: boolean
}

export type Chapter = { id: string; title: string; subtitle: string; scene: Scene; steps: Step[] }

export type Script = { chapters: Chapter[] }

/** A step with its place in the whole tour. */
export type FlatStep = Step & { scene: Scene; chapter: number; first: boolean; startMs: number }

export type ChapterInfo = { id: string; title: string; index: number; firstStep: number; startMs: number; endMs: number }

export type Highlight = { key: string; target: Target; callout?: Callout; pad?: number }

export type Status = 'idle' | 'playing' | 'paused' | 'finished'

export type Snapshot = {
  status: Status
  /** Index of the current step in the flattened script. */
  index: number
  stepId: string | null
  chapter: number
  /** 'preparing': the page is being set up; 'showing': the step is on screen. */
  phase: 'preparing' | 'showing'
  caption: string
  card: Card | null
  highlight: Highlight | null
  /** Position on the nominal timeline, ms. */
  positionMs: number
  totalMs: number
  /** Wall-clock time spent playing (not paused), ms. */
  playedMs: number
  speed: number
  /** Ids of optional steps that were skipped because their target was missing. */
  skipped: string[]
  /** Ids of required targets that were not found (the step was shown without a spotlight). */
  missing: string[]
}

/** What the engine gives a driver while it works on one step. Both waits reject when the step is left. */
export type RunContext = {
  /** Timeline wait: scaled by the playback speed and frozen while paused. */
  sleep: (ms: number) => Promise<void>
  /** Real-time wait (page loading, polling). Not affected by pause or speed. */
  delay: (ms: number) => Promise<void>
  /** False once the engine has moved to another step. */
  alive: () => boolean
}

/** Everything the engine needs from the outside world. */
export interface Driver {
  /** Make sure the right person is signed in and the right page is open. `fresh` forces the page to mount again. */
  scene(scene: Scene, opts: { fresh: boolean }, ctx: RunContext): Promise<void>
  /** Carry out one action. 'missing': its element was not there (the tour carries on). */
  act(action: Action, ctx: RunContext): Promise<'ok' | 'missing'>
  /** Wait for a target to exist and bring it into view. False after the timeout. */
  locate(target: Target, timeoutMs: number, ctx: RunContext): Promise<boolean>
  /** Speak the narration when sound is on. Resolves when the speech has ended (at once when silent). */
  narrate(text: string): Promise<void>
  /** Sound cue. */
  cue(name: Sfx): void
  /** The engine was paused or resumed (pause speech too). */
  paused?(paused: boolean): void
  /** The engine left the current step (stop speech, clear pointer marks). */
  leave?(): void
}
