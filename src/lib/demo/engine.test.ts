import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NARRATION_GRACE_MS, SETTLE_MS, TourEngine, flatten } from './engine'
import type { Action, Driver, RunContext, Scene, Script, Step, Target } from './types'

const scene = (route: string): Scene => ({ persona: 'okafor', route })
const step = (id: string, extra: Partial<Step> = {}): Step => ({ id, caption: `caption ${id}`, duration: 1000, ...extra })

/** A driver that records what the engine asks for. Targets named "missing…" are never found. */
function fakeDriver(opts: { locateMs?: number; sceneMs?: number; narrateMs?: number; throwOn?: string } = {}) {
  const log: string[] = []
  const driver: Driver = {
    async scene(s: Scene, o: { fresh: boolean }, ctx: RunContext) {
      log.push(`scene ${s.route}${o.fresh ? ' fresh' : ''}`)
      if (opts.sceneMs) await ctx.delay(opts.sceneMs)
    },
    async act(a: Action, ctx: RunContext) {
      log.push(`act ${a.type}${'target' in a && a.target ? ` ${String(a.target)}` : ''}`)
      if (opts.throwOn === a.type) throw new Error('boom')
      if (a.type === 'type') await ctx.sleep(a.text.length * 100)
      if (a.type === 'waitFor') await ctx.delay(a.timeout ?? 0)
      return 'target' in a && String(a.target).startsWith('missing') ? 'missing' : 'ok'
    },
    async locate(t: Target, timeoutMs: number, ctx: RunContext) {
      log.push(`locate ${String(t)}`)
      if (String(t).startsWith('missing')) {
        await ctx.delay(timeoutMs)
        return false
      }
      if (opts.locateMs) await ctx.delay(opts.locateMs)
      return true
    },
    narrate: (text: string) => {
      log.push(`narrate ${text}`)
      return opts.narrateMs ? new Promise<void>((r) => setTimeout(r, opts.narrateMs)) : Promise.resolve()
    },
    cue: (name) => void log.push(`cue ${name}`),
    paused: (p) => void log.push(p ? 'paused' : 'resumed'),
    leave: () => undefined,
  }
  return { driver, log }
}

const SCRIPT: Script = {
  chapters: [
    {
      id: 'a',
      title: 'A',
      subtitle: '',
      scene: scene('/a'),
      steps: [step('a1', { card: { kind: 'delay' } }), step('a2', { target: '#a2', callout: { text: 'note' } }), step('a3', { target: '#a3', before: [{ type: 'select-system', system: 'heart' }] })],
    },
    {
      id: 'b',
      title: 'B',
      subtitle: '',
      scene: scene('/b'),
      steps: [
        step('b1', { card: { kind: 'chapter', number: 2, title: 'B', subtitle: '' } }),
        step('b2', { target: '#b2', rewind: false, during: [{ type: 'type', target: '#field', text: 'hello', submit: true }] }),
        step('b3', { target: '#b3' }),
        step('b4', { target: '#b4' }),
      ],
    },
  ],
}

const ids = (e: TourEngine) => e.getSnapshot().stepId

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('flatten', () => {
  it('gives every step its chapter scene, order and nominal start', () => {
    const f = flatten({
      chapters: [
        { id: 'x', title: 'X', subtitle: '', scene: scene('/x'), steps: [step('x1'), step('x2', { optional: true, target: '#o' }), step('x3', { scene: scene('/other') })] },
        { id: 'y', title: 'Y', subtitle: '', scene: scene('/y'), steps: [step('y1', { duration: 500 })] },
      ],
    })
    expect(f.steps.map((s) => [s.id, s.chapter, s.first, s.startMs, s.scene.route])).toEqual([
      ['x1', 0, true, 0, '/x'],
      ['x2', 0, false, 1000, '/x'],
      ['x3', 0, false, 2000, '/other'],
      ['y1', 1, true, 3000, '/y'],
    ])
    expect(f.chapters.map((c) => [c.id, c.firstStep, c.startMs, c.endMs])).toEqual([
      ['x', 0, 0, 3000],
      ['y', 3, 3000, 3500],
    ])
    expect(f.totalMs).toBe(3500)
  })
})

describe('TourEngine: ordering', () => {
  it('plays every step in order and finishes', async () => {
    const { driver, log } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    const seen: string[] = []
    e.subscribe(() => {
      const s = e.getSnapshot()
      if (s.phase === 'showing' && s.stepId && seen[seen.length - 1] !== s.stepId) seen.push(s.stepId)
    })
    e.start()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(seen).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'b4'])
    expect(e.getSnapshot().status).toBe('finished')
    expect(e.getSnapshot().positionMs).toBe(e.totalMs)
    // scene first, then set-up actions, then the target, then narration
    const a3 = log.slice(log.indexOf('narrate caption a2') + 1, log.indexOf('narrate caption a3') + 1)
    expect(a3).toEqual(['scene /a', 'act select-system', 'locate #a3', 'narrate caption a3'])
  })

  it('shows a card before the page behind it changes, and keeps the previous step up while the next one is prepared', async () => {
    const { driver } = fakeDriver({ sceneMs: 400, locateMs: 300 })
    const e = new TourEngine(SCRIPT, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'a1', phase: 'showing', card: { kind: 'delay' }, caption: 'caption a1' })
    await vi.advanceTimersByTimeAsync(1400 + 100) // card done, a2 is being prepared
    expect(e.getSnapshot()).toMatchObject({ stepId: 'a2', phase: 'preparing', card: { kind: 'delay' }, caption: 'caption a1' })
    await vi.advanceTimersByTimeAsync(700)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'a2', phase: 'showing', card: null, caption: 'caption a2', highlight: { key: 'a2', target: '#a2', callout: { text: 'note' } } })
  })

  it('a step with on-screen actions lasts until they are done, plus time to read the result', async () => {
    const { driver } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    e.start(1)
    await vi.advanceTimersByTimeAsync(1000 + 50) // title card
    expect(ids(e)).toBe('b2')
    // typing takes 500 ms; the step's own second is over at 1000, so only the settle time is added after typing
    await vi.advanceTimersByTimeAsync(1000)
    expect(ids(e)).toBe('b2')
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    expect(ids(e)).toBe('b3')
  })

  it('waits for spoken narration to end, but not for ever', async () => {
    const slow = fakeDriver({ narrateMs: 2500 })
    const e = new TourEngine(SCRIPT, slow.driver)
    e.start()
    await vi.advanceTimersByTimeAsync(1100)
    expect(ids(e)).toBe('a1')
    await vi.advanceTimersByTimeAsync(1500)
    expect(ids(e)).toBe('a2')

    const stuck = fakeDriver({ narrateMs: 10 * 60_000 })
    const e2 = new TourEngine(SCRIPT, stuck.driver)
    e2.start()
    await vi.advanceTimersByTimeAsync(1000 + NARRATION_GRACE_MS + 100)
    expect(ids(e2)).toBe('a2')
  })
})

describe('TourEngine: waits, timeouts and missing targets', () => {
  const script = (extra: Partial<Step>): Script => ({
    chapters: [{ id: 'c', title: 'C', subtitle: '', scene: scene('/c'), steps: [step('c1', { target: '#c1' }), step('c2', { target: 'missing-feature', ...extra }), step('c3', { target: '#c3' })] }],
  })

  it('skips an optional step whose target never appears, after a short wait', async () => {
    const { driver, log } = fakeDriver()
    const e = new TourEngine(script({ optional: true, timeout: 700 }), driver)
    e.start()
    await vi.advanceTimersByTimeAsync(1000 + 650)
    expect(ids(e)).toBe('c2')
    expect(e.getSnapshot()).toMatchObject({ phase: 'preparing', caption: 'caption c1' })
    await vi.advanceTimersByTimeAsync(100)
    expect(ids(e)).toBe('c3')
    expect(e.getSnapshot().skipped).toEqual(['c2'])
    expect(e.getSnapshot().positionMs).toBe(2000) // the timeline jumps over the skipped step
    expect(log).not.toContain('narrate caption c2')
    await vi.advanceTimersByTimeAsync(5000)
    expect(e.getSnapshot().status).toBe('finished')
  })

  it('shows a required step without a spotlight when its target is missing', async () => {
    const { driver, log } = fakeDriver()
    const e = new TourEngine(script({ timeout: 2000 }), driver)
    e.start()
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 50)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'c2', phase: 'showing', highlight: null, caption: 'caption c2', missing: ['c2'], skipped: [] })
    expect(log).toContain('narrate caption c2')
    await vi.advanceTimersByTimeAsync(1000)
    expect(ids(e)).toBe('c3')
  })

  it('carries on when an action fails or its element is missing', async () => {
    const errors: string[] = []
    const { driver } = fakeDriver({ throwOn: 'click' })
    const s: Script = {
      chapters: [
        {
          id: 'd',
          title: 'D',
          subtitle: '',
          scene: scene('/d'),
          steps: [step('d1', { target: '#d1', before: [{ type: 'click', target: '#gone' }], during: [{ type: 'set', target: 'missing-toggle', on: true }] }), step('d2', { target: '#d2' })],
        },
      ],
    }
    const e = new TourEngine(s, driver, { onError: (_e, where) => errors.push(where) })
    e.start()
    await vi.advanceTimersByTimeAsync(50)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'd1', phase: 'showing' })
    expect(errors).toEqual(['step d1:before:click'])
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1100)
    expect(ids(e)).toBe('d2')
  })

  it('page waits run in real time; timeline waits follow the playback speed', async () => {
    const { driver } = fakeDriver({ sceneMs: 600 })
    const e = new TourEngine(SCRIPT, driver)
    e.setSpeed(2)
    e.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(ids(e)).toBe('a1') // the card is up while the page loads behind it
    await vi.advanceTimersByTimeAsync(590)
    expect(ids(e)).toBe('a1')
    // the card's 1000 ms last 500 ms at 2×, but the page needed 600 ms: a2 starts preparing at 600 and its page wait is not halved
    await vi.advanceTimersByTimeAsync(20)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'a2', phase: 'preparing' })
    await vi.advanceTimersByTimeAsync(600)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'a2', phase: 'showing' })
    await vi.advanceTimersByTimeAsync(450)
    expect(ids(e)).toBe('a2')
    await vi.advanceTimersByTimeAsync(100)
    expect(ids(e)).toBe('a3')
  })
})

describe('TourEngine: pause, resume and speed', () => {
  it('freezes the timeline while paused and continues where it stopped', async () => {
    const { driver, log } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(400)
    e.pause()
    expect(e.getSnapshot().status).toBe('paused')
    const at = e.getSnapshot().positionMs
    expect(at).toBeGreaterThanOrEqual(300)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'a1', positionMs: at, playedMs: 400 })
    e.play()
    await vi.advanceTimersByTimeAsync(550)
    expect(ids(e)).toBe('a1')
    await vi.advanceTimersByTimeAsync(100)
    expect(ids(e)).toBe('a2')
    expect(log.filter((l) => l === 'paused' || l === 'resumed')).toEqual(['paused', 'resumed'])
  })

  it('"Next" while paused brings the next step on screen and stays paused; typing waits for play', async () => {
    const { driver, log } = fakeDriver({ sceneMs: 200 })
    const e = new TourEngine(SCRIPT, driver)
    e.start(1)
    await vi.advanceTimersByTimeAsync(300)
    e.pause()
    e.next()
    await vi.advanceTimersByTimeAsync(500)
    expect(e.getSnapshot()).toMatchObject({ status: 'paused', stepId: 'b2', phase: 'showing', caption: 'caption b2' })
    expect(log).not.toContain('act type #field')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ids(e)).toBe('b2')
    e.play()
    await vi.advanceTimersByTimeAsync(10)
    expect(log).toContain('act type #field')
  })

  it('changes speed in the middle of a step', async () => {
    const { driver } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(500) // 500 of 1000 ms shown
    e.setSpeed(2) // the rest takes 250 ms
    await vi.advanceTimersByTimeAsync(200)
    expect(ids(e)).toBe('a1')
    await vi.advanceTimersByTimeAsync(100)
    expect(ids(e)).toBe('a2')
    expect(e.getSnapshot().speed).toBe(2)
  })

  it('a step marked manual stays until the person moves on; as the last step it ends the tour', async () => {
    const { driver } = fakeDriver()
    const s: Script = { chapters: [{ id: 'm', title: 'M', subtitle: '', scene: scene('/m'), steps: [step('m1'), step('m2', { card: { kind: 'closing' }, manual: true })] }] }
    const e = new TourEngine(s, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'm2', status: 'finished', card: { kind: 'closing' } })
    // still navigable after the end
    e.back()
    await vi.advanceTimersByTimeAsync(10)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'm1', status: 'paused' })
    e.play()
    await vi.advanceTimersByTimeAsync(1100)
    expect(ids(e)).toBe('m2')
  })
})

describe('TourEngine: moving around', () => {
  it('next skips the rest of the current step', async () => {
    const { driver } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(100)
    e.next()
    await vi.advanceTimersByTimeAsync(10)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'a2', phase: 'showing', status: 'playing' })
    await vi.advanceTimersByTimeAsync(1000)
    expect(ids(e)).toBe('a3')
  })

  it('a step that was left never comes back: late results of its actions are ignored', async () => {
    const { driver } = fakeDriver({ locateMs: 800 })
    const e = new TourEngine(SCRIPT, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(1100) // a2 is waiting for its target
    expect(e.getSnapshot()).toMatchObject({ stepId: 'a2', phase: 'preparing' })
    e.seekChapter(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(e.getSnapshot()).toMatchObject({ stepId: 'b1', phase: 'showing', card: { kind: 'chapter' } })
    await vi.advanceTimersByTimeAsync(900) // a2's locate would have resolved by now
    expect(e.getSnapshot().stepId).toBe('b1')
    expect(e.getSnapshot().caption).toBe('caption b1')
  })

  it('back goes one step back when that step can stand on its own', async () => {
    const { driver, log } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(2100)
    expect(ids(e)).toBe('a3')
    e.back()
    await vi.advanceTimersByTimeAsync(10)
    expect(ids(e)).toBe('a2')
    expect(log[log.lastIndexOf('scene /a')]).toBe('scene /a') // same page, not mounted again
  })

  it('back returns to a fresh chapter start when the page state cannot be rewound', async () => {
    const { driver, log } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    e.start(1)
    await vi.advanceTimersByTimeAsync(1000 + 1000 + SETTLE_MS + 100)
    expect(ids(e)).toBe('b3') // b2 typed into the page; b3 depends on it
    e.back()
    await vi.advanceTimersByTimeAsync(10)
    expect(ids(e)).toBe('b1')
    expect(log[log.length - 1]).toBe('narrate caption b1')
    expect(log).toContain('scene /b fresh')

    // from the first step of a chapter, back goes to the start of the previous chapter
    e.back()
    await vi.advanceTimersByTimeAsync(10)
    expect(ids(e)).toBe('a1')
    expect(log).toContain('scene /a fresh')
  })

  it('jumping to a chapter mounts its page afresh; playing into it does not', async () => {
    const { driver, log } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(3100)
    expect(ids(e)).toBe('b1')
    expect(log).not.toContain('scene /b fresh')
    e.seekChapter(1)
    await vi.advanceTimersByTimeAsync(10)
    expect(log).toContain('scene /b fresh')
  })

  it('stop cancels everything and the engine can start again', async () => {
    const { driver } = fakeDriver()
    const e = new TourEngine(SCRIPT, driver)
    e.start()
    await vi.advanceTimersByTimeAsync(500)
    e.stop()
    expect(e.getSnapshot()).toMatchObject({ status: 'idle', stepId: null, card: null, highlight: null })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(e.getSnapshot().status).toBe('idle')
    e.start()
    await vi.advanceTimersByTimeAsync(1100)
    expect(ids(e)).toBe('a2')
  })
})
