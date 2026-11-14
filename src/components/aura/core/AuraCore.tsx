// The AURA core: the presence the person talks to on the consultation page. It shows what the voice assistant
// is doing (idle, listening, thinking, speaking, urgent, unavailable) as the shape of a small 3D instrument, with
// the state as a word and the words heard / spoken as text beside it, so nothing depends on colour, motion or
// sound. It only READS the voice store (src/lib/voice/presence.ts) and asks for a conversation through the UI
// bus; it never touches the microphone itself.
//
// This file is light (no three.js). The WebGL scene is a separate chunk loaded when the browser is idle; until
// its first picture is drawn, and whenever WebGL is missing or lost, a flat SVG of the same pose is shown.
import { Mic, OctagonAlert, RotateCcw } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { DEV_HOOKS } from '../../../lib/devHooks'
import { emitUi } from '../../../lib/uiBus'
import { getVoiceLevel, getVoicePresence, setVoiceHosted, subscribeVoicePresence, type VoicePhase } from '../../../lib/voice/presence'
import { recognitionSupported } from '../../../lib/voice/recognition'
import { ttsSupported } from '../../../lib/voice/speech'
import { registerViewer, useHandMode } from '../../gesture/viewerBridge'
import type { ViewerControls } from '../../three/Body3D'
import { Button, IconButton, cx, useMedia } from '../../ui'
import CoreFallback from './CoreFallback'
import type { CorePalette, CoreScene, CoreStats } from './CoreScene'
import { coreState, describe, effectivePhase, type CoreState, type LocalHints } from './model'
import './core.css'

/** `panel`: beside the conversation · `side`: narrow column beside a result · `strip`: one compact row (phones). */
export type CoreVariant = 'panel' | 'side' | 'strip'

/** Dev-only overrides (window.__auraCore.set): drive every state without a microphone. */
type Override = { phase?: VoicePhase; urgent?: boolean; available?: boolean; interim?: string; caption?: string; level?: number | 'wave'; webgl?: boolean; reduce?: boolean }

type DevHook = { set: (patch: Override | null) => Override; get: () => { state: CoreState; override: Override; mode: '3d' | 'flat' }; stats: () => CoreStats | null; controls: () => ViewerControls | null }

// Once the 3D view has failed (no WebGL, context lost) the rest of the visit uses the flat drawing.
let coreBroken = false

function webglOK() {
  return typeof window !== 'undefined' && ('WebGL2RenderingContext' in window || 'WebGLRenderingContext' in window)
}

function readPalette(el: Element): CorePalette {
  const css = getComputedStyle(el)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  // fallbacks are only for a missing variable; the tokens in src/index.css are the source
  return { accent: v('--color-accent', '#92c1fd'), edge: v('--color-edge', '#716e69'), dim: v('--color-dim', '#9b9891'), soft: v('--color-soft', '#c7c4bd'), ink: v('--color-ink', '#f3f0ea'), crit: v('--color-crit', '#f75d59'), bg: v('--color-space', '#12110f') }
}

const idle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 1200 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 200)
  return () => clearTimeout(id)
}

/**
 * `listening` / `urgent`: what the page itself knows (its own dictation is running; its result is an emergency).
 * They fill in while the voice store is idle. Memoised: typing in the composer does not re-render the core.
 */
export default memo(function AuraCore({ variant, listening: pageListening = false, urgent: pageUrgent = false, className }: { variant: CoreVariant; listening?: boolean; urgent?: boolean; className?: string }) {
  const local = useMemo<LocalHints>(() => ({ listening: pageListening, urgent: pageUrgent }), [pageListening, pageUrgent])
  const presence = useSyncExternalStore(subscribeVoicePresence, getVoicePresence, getVoicePresence)
  const [override, setOverride] = useState<Override>({})
  const [failed, setFailed] = useState(coreBroken)
  const [ready, setReady] = useState(false)
  const [keys, setKeys] = useState(false)
  const systemReduce = useReducedMotion()
  const reduce = override.reduce ?? !!systemReduce
  const lowPower = useHandMode()
  const coarse = useMedia('(pointer: coarse)')
  const helpId = useId()

  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CoreScene | null>(null)
  const controlsRef = useRef<ViewerControls | null>(null)
  const gesture = useRef<{ pointers: Map<number, { x: number; y: number }>; moved: boolean; travel: number; pinch: number }>({ pointers: new Map(), moved: false, travel: 0, pinch: 0 })
  const handOver = useRef(false)

  // The store says whether speech exists once the voice hook has published; before that, ask the browser.
  const [capable] = useState(() => recognitionSupported() || ttsSupported())
  const available = override.available ?? (presence.available || capable)
  const phase = override.phase ?? presence.phase
  const input = { available, phase, urgent: override.urgent ?? presence.urgent }
  const state = coreState(input, local)
  const shownPhase = effectivePhase(phase, local)
  const live = state !== 'off' && (shownPhase === 'listening' || shownPhase === 'speaking')
  const compact = variant === 'strip'
  const text = describe(state, { phase: shownPhase, interim: override.interim ?? presence.interim, caption: override.caption ?? presence.caption }, compact)
  const use3D = !failed && override.webgl !== false && webglOK()

  // read inside the draw loop, never through React state
  const levelRef = useRef<() => number>(() => 0)
  levelRef.current = () => {
    const o = override.level
    if (o === 'wave') return 0.5 + 0.45 * Math.sin(performance.now() / 170) * Math.sin(performance.now() / 910)
    if (typeof o === 'number') return o
    // the consultation's own dictation has no level meter: a gentle stand-in, as the voice orb does on phones
    if (phase === 'idle' && local.listening) return 0.18 + 0.12 * Math.sin(performance.now() / 260)
    return getVoiceLevel()
  }
  const live3 = useRef({ state, live, reduce, lowPower })
  live3.current = { state, live, reduce, lowPower }

  // this component is the face of the voice while it is on screen
  useEffect(() => {
    setVoiceHosted(true)
    return () => setVoiceHosted(false)
  }, [])

  const talk = useCallback(
    (source: 'page' | 'hand' = 'page') => {
      if (!available) return
      emitUi('voice', { action: 'open', listen: true, source })
    },
    [available],
  )
  const talkRef = useRef(talk)
  talkRef.current = talk

  // ----- the WebGL scene: created when the browser is idle, on a canvas of its own, disposed on unmount -----
  useEffect(() => {
    const stage = stageRef.current
    if (!use3D || !stage) return
    let alive = true
    let scene: CoreScene | null = null
    let inView = true
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    stage.appendChild(canvas)

    const fail = () => {
      coreBroken = true
      if (alive) setFailed(true)
    }
    const applyPause = () => scene?.pause(!inView || document.hidden)
    const cancelIdle = idle(() => {
      import('./CoreScene')
        .then(({ CoreScene }) => {
          if (!alive) return
          const cur = live3.current
          scene = new CoreScene({
            canvas,
            palette: readPalette(stage),
            state: cur.state,
            live: cur.live,
            reduced: cur.reduce,
            lowPower: cur.lowPower,
            width: stage.clientWidth,
            height: stage.clientHeight,
            level: () => levelRef.current(),
            onReady: () => alive && setReady(true),
            onLost: fail,
          })
          sceneRef.current = scene
          const s = scene
          controlsRef.current = {
            zoom: (direction) => s.zoomBy(direction > 0 ? 1 / 1.18 : 1.18, true),
            reset: () => s.reset(),
            rotateBy: (dx, dy) => s.rotateBy(dx, dy),
            zoomBy: (factor) => s.zoomBy(factor),
            // a pinch-tap with hand control on the core starts a conversation; there is nothing to select
            pickAt: () => {
              talkRef.current('hand')
              return null
            },
            hoverAt: (x) => {
              const over = x !== null
              if (over === handOver.current) return
              handOver.current = over
              stage.toggleAttribute('data-hand', over)
            },
            hovered: () => null,
            anchor: () => null,
          }
          applyPause()
        })
        .catch(fail)
    })

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => scene?.resize(stage.clientWidth, stage.clientHeight))
    ro?.observe(stage)
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            inView = entries[entries.length - 1].isIntersecting
            applyPause()
          })
    io?.observe(stage)
    document.addEventListener('visibilitychange', applyPause)
    // the accent follows the profile (data-context / data-accent on <html>)
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => scene?.setPalette(readPalette(stage)))
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-context', 'data-accent', 'class', 'style'] })

    return () => {
      alive = false
      cancelIdle()
      ro?.disconnect()
      io?.disconnect()
      mo?.disconnect()
      document.removeEventListener('visibilitychange', applyPause)
      controlsRef.current = null
      sceneRef.current = null
      handOver.current = false
      stage.removeAttribute('data-hand')
      scene?.dispose()
      canvas.remove()
      setReady(false)
    }
  }, [use3D])

  useEffect(() => sceneRef.current?.setState(state, live), [state, live, ready])
  useEffect(() => sceneRef.current?.setReduced(reduce), [reduce, ready])
  useEffect(() => sceneRef.current?.setLowPower(lowPower), [lowPower, ready])

  // hand control finds the core (and turns / zooms / resets it) while its cursor is over the canvas
  useEffect(() => {
    const el = stageRef.current
    if (!ready || !el) return
    return registerViewer({ el, controls: () => controlsRef.current })
  }, [ready])

  // Ctrl + wheel (and a trackpad pinch) zooms; a plain wheel is left to the page
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !sceneRef.current) return
      e.preventDefault()
      sceneRef.current.zoomBy(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.004))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // dev-only: window.__auraCore.set({ phase, urgent, available, interim, caption, level, webgl, reduce })
  const overrideRef = useRef(override)
  overrideRef.current = override
  const stateRef = useRef(state)
  stateRef.current = state
  const modeRef = useRef<'3d' | 'flat'>('flat')
  modeRef.current = use3D && ready ? '3d' : 'flat'
  useEffect(() => {
    if (!DEV_HOOKS) return
    const w = window as unknown as { __auraCore?: DevHook }
    const hook: DevHook = {
      set: (patch) => {
        const next = patch ? { ...overrideRef.current, ...patch } : {}
        overrideRef.current = next
        setOverride(next)
        return next
      },
      get: () => ({ state: stateRef.current, override: overrideRef.current, mode: modeRef.current }),
      stats: () => sceneRef.current?.stats() ?? null,
      controls: () => controlsRef.current,
    }
    w.__auraCore = hook
    return () => {
      if (w.__auraCore === hook) delete w.__auraCore
    }
  }, [])

  // ----- pointer: drag turns, two fingers zoom, a tap talks -----
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const g = gesture.current
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (g.pointers.size === 1) {
      g.moved = false
      g.travel = 0
    } else {
      g.moved = true // a second finger: this is a pinch, never a tap
      const [a, b] = [...g.pointers.values()]
      g.pinch = Math.hypot(a.x - b.x, a.y - b.y)
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* synthetic pointers cannot be captured */
    }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    const p = g.pointers.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x
    const dy = e.clientY - p.y
    p.x = e.clientX
    p.y = e.clientY
    if (g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (g.pinch > 0 && d > 0) sceneRef.current?.zoomBy(g.pinch / d)
      g.pinch = d
      return
    }
    g.travel += Math.hypot(dx, dy)
    if (!g.moved && g.travel > 6) {
      g.moved = true
      e.currentTarget.setAttribute('data-dragging', '')
    }
    if (g.moved) sceneRef.current?.rotateBy(dx, dy)
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    g.pointers.delete(e.pointerId)
    g.pinch = 0
    if (g.pointers.size === 0) e.currentTarget.removeAttribute('data-dragging')
  }
  const onClick = () => {
    // the click that ends a drag or a pinch is not a tap
    if (gesture.current.moved) {
      gesture.current.moved = false
      return
    }
    talk()
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return
    const s = sceneRef.current
    const step = 28
    let used = true
    if (e.key === 'Enter' || e.key === ' ') talk()
    else if (e.key === 'ArrowLeft') s?.rotateBy(-step, 0)
    else if (e.key === 'ArrowRight') s?.rotateBy(step, 0)
    else if (e.key === 'ArrowUp') s?.rotateBy(0, -step)
    else if (e.key === 'ArrowDown') s?.rotateBy(0, step)
    else if (e.key === '+' || e.key === '=') s?.zoomBy(1 / 1.12, true)
    else if (e.key === '-' || e.key === '_') s?.zoomBy(1.12, true)
    else if (e.key === '0' || e.key === 'Home') s?.reset()
    else used = false
    if (used) e.preventDefault()
  }

  const listening = shownPhase === 'listening' && state !== 'off'
  const help = keys ? 'Arrow keys turn · + and − zoom · 0 resets' : coarse ? 'Drag to turn · pinch to zoom' : 'Drag to turn · Ctrl + scroll to zoom'
  const dot = live && state !== 'urgent'

  return (
    <section
      aria-label="AURA voice"
      data-aura-core={state}
      data-state={state}
      data-variant={variant}
      data-mode={use3D && ready ? '3d' : 'flat'}
      data-still={reduce ? '' : undefined}
      className={cx('aura-core min-w-0', compact ? 'flex items-center gap-3 border-b border-line pb-3 text-left' : 'flex flex-col items-center gap-3 text-center', className)}
    >
      <div
        ref={stageRef}
        role="button"
        tabIndex={0}
        aria-label="AURA core. Talk to AURA"
        aria-describedby={helpId}
        aria-disabled={!available}
        data-ready={use3D && ready ? '' : undefined}
        className={cx('aura-core__stage', compact ? 'w-[72px]' : variant === 'side' ? 'w-full max-w-52' : 'w-full max-w-[360px]')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={(e) => setKeys(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => setKeys(false)}
      >
        <CoreFallback state={state} compact={compact} />
      </div>
      <span id={helpId} className="sr-only">
        A 3D figure that shows what AURA is doing. Press Enter to talk. Arrow keys turn it, plus and minus zoom, 0 resets the view. It is decoration for the voice assistant: everything it shows is also written next to it.
      </span>

      {/* a fixed block beside the full-size core, so the buttons under it do not jump as the words change */}
      <div className={cx('min-w-0', compact ? 'flex-1' : variant === 'panel' ? 'flex min-h-28 max-w-sm flex-col items-center' : 'flex max-w-sm flex-col items-center')}>
        <p role="status" className={cx('flex items-center gap-2 text-[15px] font-semibold text-ink', !compact && 'justify-center')}>
          {state === 'urgent' ? <OctagonAlert className="h-4 w-4 shrink-0 text-crit" aria-hidden="true" /> : dot ? <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" /> : null}
          {text.label}
        </p>
        <p className={cx('aura-core__clamp mt-0.5 leading-snug', compact ? 'text-sm' : 'text-base', text.quote ? 'text-ink' : 'text-soft')} style={{ WebkitLineClamp: compact ? 2 : 3 }}>
          {text.quote ? `“${text.line}”` : text.line}
        </p>
        {text.sub && !compact && (
          <p className="aura-core__clamp mt-1 text-sm leading-snug text-dim" style={{ WebkitLineClamp: 2 }}>
            {text.sub}
          </p>
        )}
      </div>

      {compact ? (
        <IconButton icon={Mic} label={listening ? 'AURA is listening' : 'Talk to AURA'} variant="secondary" aria-pressed={listening} disabled={!available} className={cx('shrink-0', listening && 'bg-panel2')} onClick={() => talk()} />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button icon={Mic} aria-pressed={listening} disabled={!available} className={cx(listening && 'bg-panel2')} onClick={() => talk()}>
              {listening ? 'Listening' : 'Talk to AURA'}
            </Button>
            {use3D && <IconButton icon={RotateCcw} label="Reset view" onClick={() => sceneRef.current?.reset()} />}
          </div>
          {use3D && variant === 'panel' && <p className="text-xs text-dim">{help}</p>}
        </>
      )}
    </section>
  )
})
