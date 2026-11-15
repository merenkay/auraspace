// Full screen for the AURA core. The Fullscreen API where the browser has it; otherwise (iPhone Safari has none
// for ordinary elements, and a request can be refused) a CSS full-viewport fallback: the same element becomes
// `position: fixed; inset: 0` (fullscreen.css) and the page behind stops scrolling. Both report through the same
// state, publish `presence.fullscreen` for the floating voice panel, and give focus back where it came from.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { DEV_HOOKS } from '../../../lib/devHooks'
import { setVoiceFullscreen, setVoicePresence, type VoicePresence } from '../../../lib/voice/presence'
import { fullscreenKey, type FullscreenMode } from './popups'

type FsDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void }
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => void }

const fsElement = (): Element | null => {
  const d = document as FsDocument
  return d.fullscreenElement ?? d.webkitFullscreenElement ?? null
}

function leaveApi() {
  const d = document as FsDocument
  try {
    if (d.exitFullscreen) void d.exitFullscreen().catch(() => undefined)
    else d.webkitExitFullscreen?.()
  } catch {
    /* already left */
  }
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return false
  return !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
}

type DevHook = { set: (on: boolean, mode?: FullscreenMode) => void; get: () => { on: boolean; mode: FullscreenMode | null }; voice: (patch: Partial<VoicePresence>) => void }

export type Fullscreen = { on: boolean; mode: FullscreenMode | null; enter: (force?: FullscreenMode) => void; exit: () => void; toggle: () => void }

/**
 * `preferCss`: use the fallback even where the API exists. Needed while camera hand control is on: its cursor is
 * drawn in a layer on <body>, and the real Fullscreen API paints only the full-screen element's own subtree.
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>, { preferCss = false }: { preferCss?: boolean } = {}): Fullscreen {
  const [mode, setMode] = useState<FullscreenMode | null>(null)
  const modeRef = useRef(mode)
  const preferRef = useRef(preferCss)
  preferRef.current = preferCss
  const trigger = useRef<HTMLElement | null>(null)
  const set = useCallback((m: FullscreenMode | null) => {
    modeRef.current = m
    setMode(m)
  }, [])

  const enter = useCallback(
    (force?: FullscreenMode) => {
      const el = ref.current as FsElement | null
      if (!el || modeRef.current) return
      trigger.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null
      const css = () => {
        if (!modeRef.current) set('css')
      }
      if (force === 'css' || (force !== 'api' && preferRef.current)) return css()
      try {
        if (typeof el.requestFullscreen === 'function') {
          el.requestFullscreen({ navigationUI: 'hide' }).then(() => set('api'), css)
          return
        }
        if (typeof el.webkitRequestFullscreen === 'function') {
          el.webkitRequestFullscreen() // no promise: the change event confirms it, otherwise fall back
          setTimeout(css, 400)
          return
        }
      } catch {
        /* fall through to the CSS fallback */
      }
      css()
    },
    [ref, set],
  )

  const exit = useCallback(() => {
    const m = modeRef.current
    if (!m) return
    set(null)
    if (m === 'api' && fsElement() === ref.current) leaveApi()
  }, [ref, set])

  const toggle = useCallback(() => (modeRef.current ? exit() : enter()), [enter, exit])

  // the browser's own exit (Esc, the system gesture) and a successful webkit request
  useEffect(() => {
    const sync = () => {
      const ours = !!ref.current && fsElement() === ref.current
      if (ours) set('api')
      else if (modeRef.current === 'api') set(null)
    }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [ref, set])

  // F toggles (not while typing); Esc leaves the fallback
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act = fullscreenKey(e, isTyping(e.target), modeRef.current)
      if (!act) return
      e.preventDefault()
      if (act === 'exit') exit()
      else toggle()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [exit, toggle])

  // hand control switched on while in real full screen: its cursor would be invisible, so continue in the fallback
  useEffect(() => {
    if (!preferCss || modeRef.current !== 'api') return
    set('css')
    leaveApi()
  }, [preferCss, set])

  // side effects of the mode: the store, the page scroll, focus
  useEffect(() => {
    const root = document.documentElement
    const el = ref.current
    setVoiceFullscreen(!!mode)
    if (!mode) return
    root.setAttribute('data-aura-fs', mode)
    const overflow = root.style.overflow
    if (mode === 'css') root.style.overflow = 'hidden'
    // focus moves into the full-screen element, so Tab starts at its first control
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    return () => {
      root.style.overflow = overflow
    }
  }, [mode, ref])
  const was = useRef(false)
  useEffect(() => {
    if (mode) {
      was.current = true
      return
    }
    if (!was.current) return
    was.current = false
    document.documentElement.removeAttribute('data-aura-fs')
    const back = trigger.current?.isConnected ? trigger.current : ref.current?.querySelector<HTMLElement>('[data-fs-toggle], [role="button"], button')
    back?.focus({ preventScroll: true })
    trigger.current = null
  }, [mode, ref])

  // leaving the page while in full screen
  useEffect(
    () => () => {
      const el = ref.current
      if (modeRef.current === 'api' && (!el || fsElement() === el)) leaveApi()
      modeRef.current = null
      document.documentElement.removeAttribute('data-aura-fs')
      setVoiceFullscreen(false)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // dev-only: window.__auraFs.set(true, 'css') · .get() · .voice({ phase, interim, caption, urgent })
  useEffect(() => {
    if (!DEV_HOOKS) return
    const w = window as unknown as { __auraFs?: DevHook }
    const hook: DevHook = {
      set: (on, m) => (on ? enter(m ?? 'css') : exit()),
      get: () => ({ on: !!modeRef.current, mode: modeRef.current }),
      voice: (patch) => setVoicePresence(patch),
    }
    w.__auraFs = hook
    return () => {
      if (w.__auraFs === hook) delete w.__auraFs
    }
  }, [enter, exit])

  return { on: !!mode, mode, enter, exit, toggle }
}
