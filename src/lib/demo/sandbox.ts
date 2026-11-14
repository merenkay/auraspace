// Jury demo mode: the sandbox the tour runs in.
//
// The tour is its own page load (/?demo=1). Before the app starts, this module
//   1. replaces localStorage with an in-memory copy that holds only the tour's simulated data, and
//   2. turns every request to /api/ and to any other site into a network failure, without sending it
//      (the app's own static files — pages, fonts, the 3D model — still load).
// The app then does what it always does when no server answers: it runs on its in-browser demo store
// (src/lib/api.ts) — here the in-memory one. Nothing the tour does can reach the person's saved data or the
// database, and leaving is a plain reload of the page they came from, so their state is exactly as before.
//
// A marker in sessionStorage (this tab only) keeps the tour alive across a reload, e.g. an app update.
import { buildSeed, KEYS } from './seed'
import { installStorageOverlay, type StorageOverlay, type StorageProto } from './storageOverlay'

const RUN_KEY = 'aura.demo.run'
const MARKER_MAX_AGE_MS = 6 * 3600_000
const FLAG = '__auraDemo'

export type RunMarker = { from: string; at: number; chapter: number }
export type BlockedRequest = { method: string; url: string; at: number; kind: 'api' | 'external' }

export type Sandbox = {
  /** Where to return to when the tour is left. */
  from: string
  /** Chapter to resume at after a reload. */
  chapter: number
  /** Requests to /api/ or to other sites that the app attempted during the tour. None of them was sent. */
  blocked: BlockedRequest[]
  storage: StorageOverlay
  uninstall(): void
}

type Win = Window & typeof globalThis & { [FLAG]?: Sandbox }

/* ------------------------------------------------------------ marker */

function readMarker(win: Window): RunMarker | null {
  try {
    const raw = win.sessionStorage.getItem(RUN_KEY)
    if (!raw) return null
    const m = JSON.parse(raw) as Partial<RunMarker>
    if (typeof m.at !== 'number' || Date.now() - m.at > MARKER_MAX_AGE_MS) return null
    return { from: safeFrom(m.from), at: m.at, chapter: typeof m.chapter === 'number' && m.chapter >= 0 ? Math.floor(m.chapter) : 0 }
  } catch {
    return null
  }
}

function writeMarker(win: Window, m: RunMarker | null) {
  try {
    if (m) win.sessionStorage.setItem(RUN_KEY, JSON.stringify(m))
    else win.sessionStorage.removeItem(RUN_KEY)
  } catch {
    /* no session storage: the tour still runs, it just does not survive a reload */
  }
}

/** Only same-site paths are accepted as a return address, and never one that would start the tour again. */
export function safeFrom(from: unknown): string {
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//')) return '/'
  const [path, query = ''] = from.split('#')[0].split('?')
  const q = new URLSearchParams(query)
  q.delete('demo')
  const rest = q.toString()
  return rest ? `${path}?${rest}` : path
}

export function wantsDemo(search: string): boolean {
  return new URLSearchParams(search).get('demo') === '1'
}

/* ------------------------------------------------------------- guard */

/** True for a request to this site's /api/ (the PHP backend). */
export function isApiRequest(url: string, base: string): boolean {
  try {
    const u = new URL(url, base)
    return u.origin === new URL(base).origin && u.pathname.startsWith('/api/')
  } catch {
    return false
  }
}

/** True for a request that leaves this site (e.g. a live data feed). */
export function isExternalRequest(url: string, base: string): boolean {
  try {
    const u = new URL(url, base)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.origin !== new URL(base).origin
  } catch {
    return false
  }
}

/**
 * Wraps fetch so that requests to /api/ and to other sites fail like a dropped connection and are recorded
 * instead of sent. The tour therefore never depends on the network: features with a live feed fall back to
 * their offline copy, exactly as they do without a connection.
 */
export function guardFetch(host: { fetch: typeof fetch }, base: () => string, blocked: BlockedRequest[]): () => void {
  const real = host.fetch
  const guarded: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const kind = isApiRequest(url, base()) ? 'api' : isExternalRequest(url, base()) ? 'external' : null
    if (kind) {
      const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
      blocked.push({ method, url, at: Date.now(), kind })
      return Promise.reject(new TypeError('AURA demo: nothing is sent over the network during the tour'))
    }
    return real.call(host, input, init)
  }
  host.fetch = guarded
  return () => {
    if (host.fetch === guarded) host.fetch = real
  }
}

/* ----------------------------------------------------------- install */

/**
 * Called once when the page loads (see the bottom of this file). Installs the sandbox when the address asks
 * for the tour (?demo=1) or a tour was running in this tab before a reload. Returns null otherwise.
 */
export function bootSandbox(win: Win): Sandbox | null {
  if (win[FLAG]) return win[FLAG]
  const asked = wantsDemo(win.location.search)
  const marker = readMarker(win)
  if (!asked && !marker) {
    writeMarker(win, null)
    return null
  }
  let storage: StorageOverlay
  const blocked: BlockedRequest[] = []
  let unguard: () => void
  try {
    const real = win.localStorage
    const own = { sfx: real.getItem(KEYS.sfx), voice: real.getItem(KEYS.voice) }
    storage = installStorageOverlay(Object.getPrototypeOf(real) as StorageProto, real, buildSeed(new Date(), own))
    unguard = guardFetch(win, () => win.location.href, blocked)
  } catch {
    // Storage is blocked or cannot be sandboxed in this browser: do not run the tour on real data.
    writeMarker(win, null)
    return null
  }
  // An address that asks for the tour always starts it from the beginning; a reload in the middle resumes.
  const run: RunMarker = { from: marker?.from ?? '/', at: Date.now(), chapter: asked ? 0 : (marker?.chapter ?? 0) }
  writeMarker(win, run)
  const sandbox: Sandbox = {
    from: run.from,
    chapter: run.chapter,
    blocked,
    storage,
    uninstall() {
      storage.uninstall()
      unguard()
      delete win[FLAG]
    },
  }
  win[FLAG] = sandbox
  return sandbox
}

const current = (): Sandbox | null => (typeof window === 'undefined' ? null : ((window as Win)[FLAG] ?? null))

/** True while this page load is the sandboxed tour. */
export const isDemoActive = () => current() !== null
export const demoSandbox = current

/** Remember the chapter so a reload in the middle of the tour resumes there. */
export function rememberChapter(chapter: number) {
  const s = current()
  if (!s) return
  s.chapter = chapter
  writeMarker(window, { from: s.from, at: Date.now(), chapter })
}

/** From the normal app: open the tour. The current address is where "leave" returns to. */
export function startDemo() {
  writeMarker(window, { from: safeFrom(window.location.pathname + window.location.search), at: Date.now(), chapter: 0 })
  window.location.assign('/?demo=1')
}

/** Start the tour again from the first chapter on fresh sandbox data. */
export function restartDemo() {
  const s = current()
  writeMarker(window, { from: s?.from ?? '/', at: Date.now(), chapter: 0 })
  window.location.assign('/?demo=1')
}

/** Leave the tour: forget the sandbox and load the page the person came from. */
export function exitDemo() {
  const s = current()
  writeMarker(window, null)
  window.location.replace(s?.from ?? '/')
}

// Runs when the app's modules are first evaluated, before React renders and before the app picks its backend.
if (typeof window !== 'undefined') {
  try {
    bootSandbox(window as Win)
  } catch {
    /* the app starts normally, without the tour */
  }
}
