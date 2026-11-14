// Jury demo mode: the browser driver. It carries out the engine's actions on the live app: signs the tour's
// simulated people in (inside the sandbox only), navigates, clicks, types and waits for elements.
// It refuses to do anything unless the sandbox is installed, so it can never act on a real account.
import type { NavigateFunction } from 'react-router'
import type { Backend } from '../api'
import { sfx } from '../sfx'
import type { Role, User } from '../types'
import { emitUi } from '../uiBus'
import { DATA_CHANGED } from '../voice/pending'
import { cancelSpeech, speak, ttsSupported } from '../voice/speech'
import { boxOf, bringIntoView, resolveTarget, setFieldValue, toggleState } from './dom'
import { isDemoActive } from './sandbox'
import { KEYS, PERSONAS, userOf } from './seed'
import type { Action, Driver, PersonaId, RunContext, Scene, Target } from './types'

const POLL_MS = 80
const PAGE_TIMEOUT_MS = 9000
const ACTION_TIMEOUT_MS = 5000

/** What the driver needs from React, read fresh on every use. */
export type DriverEnv = {
  navigate: NavigateFunction
  user: User | null
  backend: Backend | null
  demoLogin: (role: Role, crewId?: number) => Promise<void>
  signedIn: (u: User) => Promise<void>
  /** The person has sound on for the tour. */
  sound: boolean
  reducedMotion: boolean
  /** Height of the tour's caption bar, px: targets are scrolled clear of it. */
  bottomInset: number
  /** Show a mark where the tour is about to click. */
  pointer: (x: number, y: number) => void
}

const pathOf = (route: string, persona: PersonaId) => route.replace(':id', String(PERSONAS[persona].crewId))

/** The page has rendered its title and nothing in it says "loading". */
function pageReady(path: string) {
  if (window.location.pathname !== path) return false
  const main = document.getElementById('main')
  if (!main || !main.querySelector('h1')) return false
  return !main.querySelector('[aria-busy="true"], [role="status"][aria-label^="Loading"]')
}

export function createDriver(env: () => DriverEnv): Driver {
  let persona: PersonaId = 'okafor'
  const applied = new Set<string>()
  let speaking = false

  const guard = () => {
    if (!isDemoActive() || env().backend?.mode !== 'demo') throw new Error('The demo tour only runs inside its sandbox')
  }

  async function until<T>(ctx: RunContext, timeout: number, probe: () => T | null | false | undefined): Promise<T | null> {
    const end = Date.now() + timeout
    for (;;) {
      const v = probe()
      if (v) return v
      if (Date.now() >= end) return null
      await ctx.delay(POLL_MS)
    }
  }

  /** Returns true when a different person had to be signed in. */
  async function become(id: PersonaId, ctx: RunContext): Promise<boolean> {
    const want = userOf(id)
    persona = id
    const cur = env().user
    if (cur && cur.id === want.id && cur.role === want.role) return false
    guard()
    if (PERSONAS[id].kind === 'crew') {
      await env().demoLogin('astronaut', want.crewId ?? undefined)
    } else {
      // Members: point the sandboxed demo store at this person, then let the session load them.
      const raw = localStorage.getItem(KEYS.store)
      const store = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      localStorage.setItem(KEYS.store, JSON.stringify({ ...store, user: want }))
      await env().signedIn(want)
    }
    await until(ctx, 3000, () => env().user?.id === want.id)
    return true
  }

  const waitFor = (target: Target, timeout: number, ctx: RunContext) => until(ctx, timeout, () => resolveTarget(target))

  /**
   * Scroll the element clear of the caption bar and wait until it has stopped moving. Other code may move the
   * page at the same moment (an opening panel, a page that scrolls to its own result), so the position is
   * checked again once things are still, and corrected without animation if needed.
   */
  async function settle(target: Target, ctx: RunContext) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const el = resolveTarget(target)
      if (!el) return
      if (!bringIntoView(el, env().bottomInset, attempt === 0 && !env().reducedMotion)) return
      let last = ''
      let same = 0
      for (let i = 0; i < 20 && same < 2; i++) {
        await ctx.delay(60)
        const now = resolveTarget(target)
        if (!now) return
        const b = boxOf(now)
        const sig = `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`
        same = sig === last ? same + 1 : 0
        last = sig
      }
    }
  }

  /**
   * Go to a page and make sure the app stays there. Right after a different person is signed in, the page
   * being left redirects to that person's own record; that redirect can land after ours and undo it.
   */
  async function go(path: string, confirm: boolean, ctx: RunContext) {
    for (let attempt = 0; attempt < 6; attempt++) {
      if (window.location.pathname !== path) env().navigate(path)
      if (!confirm) return
      let held = true
      for (let i = 0; i < 7 && held; i++) {
        await ctx.delay(50)
        held = window.location.pathname === path
      }
      if (held) return
      await ctx.delay(120)
    }
  }

  async function click(el: HTMLElement, ctx: RunContext) {
    const b = boxOf(el)
    env().pointer(b.x + b.w / 2, b.y + b.h / 2)
    await ctx.delay(env().reducedMotion ? 0 : 260)
    el.click()
  }

  return {
    async scene(scene: Scene, opts, ctx) {
      guard()
      const switched = await become(scene.persona, ctx)
      const path = pathOf(scene.route, scene.persona)
      if (window.location.pathname === path && opts.fresh) {
        // Mount the page again from scratch: step out to another page of the same record and come back.
        const base = `/crew/${PERSONAS[scene.persona].crewId}`
        const away = path === base ? '/environment' : base
        await go(away, switched, ctx)
        await until(ctx, 3000, () => window.location.pathname === away)
        await ctx.delay(150)
      }
      await go(path, switched, ctx)
      await until(ctx, PAGE_TIMEOUT_MS, () => pageReady(path))
    },

    async act(action: Action, ctx) {
      guard()
      switch (action.type) {
        case 'navigate':
          env().navigate(pathOf(action.to, persona))
          return 'ok'
        case 'select-system':
          emitUi('select-system', { system: action.system, source: 'page' })
          return 'ok'
        case 'click': {
          if (action.unless && resolveTarget(action.unless)) return 'ok'
          const el = await until(ctx, action.timeout ?? ACTION_TIMEOUT_MS, () => {
            const e = resolveTarget(action.target)
            return e && !(e as HTMLButtonElement).disabled ? e : null
          })
          if (!el) return 'missing'
          await click(el, ctx)
          return 'ok'
        }
        case 'set': {
          const el = await waitFor(action.target, action.timeout ?? ACTION_TIMEOUT_MS, ctx)
          if (!el) return 'missing'
          if (toggleState(el) !== action.on) {
            await click(el, ctx)
            // let an opening panel finish growing before anything is measured or scrolled
            await ctx.delay(env().reducedMotion ? 60 : 320)
          }
          return 'ok'
        }
        case 'type': {
          const el = await waitFor(action.target, ACTION_TIMEOUT_MS, ctx)
          if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return 'missing'
          // The field is filled without taking the keyboard focus, so Space and the arrow keys keep driving the tour.
          const per = 1000 / (action.cps ?? 22)
          for (let i = 1; i <= action.text.length; i++) {
            setFieldValue(el, action.text.slice(0, i))
            await ctx.sleep(per)
          }
          if (action.submit) {
            await ctx.sleep(350)
            el.form?.requestSubmit()
          }
          return 'ok'
        }
        case 'reading': {
          const { backend, user } = env()
          if (!backend || user?.crewId == null) return 'missing'
          if (applied.has(action.key)) return 'ok'
          applied.add(action.key)
          await backend.addMeasurements(user.crewId, action.values, 'device', action.device)
          window.dispatchEvent(new Event(DATA_CHANGED))
          return 'ok'
        }
        case 'waitFor':
          return (await waitFor(action.target, action.timeout ?? ACTION_TIMEOUT_MS, ctx)) ? 'ok' : 'missing'
        case 'scroll':
          if (action.target) await settle(action.target, ctx)
          else window.scrollTo({ top: 0, behavior: env().reducedMotion ? 'auto' : 'smooth' })
          return 'ok'
        case 'close-overlays':
          document.querySelectorAll<HTMLElement>('[data-overlay] [data-overlay-part="close"]').forEach((b) => b.click())
          return 'ok'
        case 'sfx':
          if (env().sound) sfx(action.name)
          return 'ok'
        case 'say':
          if (env().sound) emitUi('say', { text: action.text, priority: action.urgent ? 'urgent' : 'normal' })
          return 'ok'
        case 'wait':
          await ctx.sleep(action.ms)
          return 'ok'
      }
    },

    async locate(target, timeoutMs, ctx) {
      const el = await waitFor(target, timeoutMs, ctx)
      if (!el) return false
      await settle(target, ctx)
      return true
    },

    narrate(text) {
      if (!env().sound || !ttsSupported() || !text.trim()) return Promise.resolve()
      return new Promise<void>((resolve) => {
        cancelSpeech()
        speaking = true
        const ok = speak(text, {
          onEnd: () => {
            speaking = false
            resolve()
          },
        })
        if (!ok) {
          speaking = false
          resolve()
        }
      })
    },

    cue(name) {
      if (env().sound) sfx(name)
    },

    paused(paused) {
      if (!ttsSupported()) return
      try {
        if (paused) window.speechSynthesis.pause()
        else window.speechSynthesis.resume()
      } catch {
        /* speech is optional */
      }
    },

    leave() {
      if (speaking) {
        speaking = false
        cancelSpeech()
      }
    },
  }
}
