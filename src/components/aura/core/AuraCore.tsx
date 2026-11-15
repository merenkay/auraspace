// The AURA core: the presence the person talks to on the consultation page, and an instrument they can enter.
// Four layers, outside to inside: mission shell, vitals orbit, body-systems lattice, voice nucleus. Every mark is
// read from the app's own data (src/.../core/layers.ts); a layer with nothing to show says so. The voice state
// (idle, listening, thinking, speaking, urgent, unavailable) is the posture of the rings and nucleus, with the
// state as a word and the words heard / spoken as text, so nothing depends on colour, motion or sound.
// It only READS the voice store (src/lib/voice/presence.ts) and asks for a conversation through the UI bus.
//
// This file is light (no three.js). The WebGL scene is a separate chunk loaded when the browser is idle; until
// its first picture is drawn, and whenever WebGL is missing or lost, a flat SVG of the same layers is shown.
import { ChevronDown, ChevronRight, ChevronUp, Maximize2, Mic, OctagonAlert, RotateCcw, X } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router'
import { MISSIONS } from '../../../data/missions'
import type { SystemId } from '../../../data/systems'
import { currentCabin } from '../../../lib/cabinLink/current'
import { DEV_HOOKS } from '../../../lib/devHooks'
import { useSession } from '../../../lib/session'
import { emitUi } from '../../../lib/uiBus'
import { getVoiceLevel, getVoicePresence, setVoiceHosted, subscribeVoicePresence, type VoicePhase } from '../../../lib/voice/presence'
import { recognitionSupported } from '../../../lib/voice/recognition'
import { ttsSupported } from '../../../lib/voice/speech'
import { useEnvLive } from '../../env/useEnvLive'
import { registerViewer, useHandMode } from '../../gesture/viewerBridge'
import type { ViewerControls } from '../../three/Body3D'
import { Button, IconButton, cx, useMedia } from '../../ui'
import { getCoreEvaluation, registerCore, subscribeCoreEvaluation } from './control'
import CoreFallback from './CoreFallback'
import type { CorePalette, CoreScene, CoreStats } from './CoreScene'
import { buildCoreData, findItem, itemsOf, LAYERS, MAX_DEPTH, STATUS_WORD, type CoreData, type CoreItem, type ItemStatus } from './layers'
import { coreState, describe, effectivePhase, type CoreState, type LocalHints } from './model'
import './core.css'

/** `panel`: beside the conversation · `side`: narrow column beside a result · `strip`: one compact row (phones) · `full`: fills its parent (full screen). */
export type CoreVariant = 'panel' | 'side' | 'strip' | 'full'

export type AuraCoreProps = {
  variant: CoreVariant
  /** what the page itself knows: its own dictation is running / its result is an emergency */
  listening?: boolean
  urgent?: boolean
  className?: string
  /** whose readings the layers show (the page publishes the evaluation, see control.ts) */
  crewId?: number
  /** "Ask AURA about it" on a vital */
  onExplain?: (vitalKey: string) => void
  fullscreen?: boolean
  onToggleFullscreen?: () => void
}

/** Dev-only overrides (window.__auraCore.set): drive every state without a microphone. */
type Override = { phase?: VoicePhase; urgent?: boolean; available?: boolean; interim?: string; caption?: string; level?: number | 'wave'; webgl?: boolean; reduce?: boolean }

type DevHook = {
  set: (patch: Override | null) => Override
  get: () => { state: CoreState; override: Override; mode: '3d' | 'flat' }
  stats: () => CoreStats | null
  controls: () => ViewerControls | null
  dive: (layer: number) => void
  select: (id: string | null) => void
  layer: () => number
}

// Once the 3D view has failed (no WebGL, context lost) the rest of the visit uses the flat drawing.
let coreBroken = false

function webglOK() {
  return typeof window !== 'undefined' && ('WebGL2RenderingContext' in window || 'WebGLRenderingContext' in window)
}

function readPalette(el: Element): CorePalette {
  const css = getComputedStyle(el)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  // fallbacks are only for a missing variable; the tokens in src/index.css are the source
  return { accent: v('--color-accent', '#92c1fd'), edge: v('--color-edge', '#716e69'), dim: v('--color-dim', '#9b9891'), soft: v('--color-soft', '#c7c4bd'), ink: v('--color-ink', '#f3f0ea'), crit: v('--color-crit', '#f75d59'), warn: v('--color-warn', '#fac547'), bg: v('--color-space', '#12110f') }
}

const idle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 1200 })
    return () => cancelIdleCallback(id)
  }
  const id = setTimeout(fn, 200)
  return () => clearTimeout(id)
}

/** Status as a shape and a word (never colour alone): diamond = attention, octagon = urgent, hollow ring = no data. */
function StatusMark({ status }: { status: ItemStatus }) {
  if (status === 'ok') return null
  return <span className="aura-core__mark" data-status={status} aria-hidden="true" />
}

const valueOf = (it: CoreItem) => (it.value ? `${it.value}${it.unit && it.unit.length <= 5 ? ` ${it.unit}` : ''}` : STATUS_WORD.none)

/** What the layer in focus holds, in one honest line. */
function layerNote(layer: number, data: CoreData, stateLabel: string): string {
  if (layer === 0) return [data.mission ? data.mission.value : 'No mission data', data.mission?.note, data.cabin.length ? `${data.cabin.length} cabin reading${data.cabin.length === 1 ? '' : 's'}` : data.cabinEmpty].filter(Boolean).join(' · ')
  if (layer === 1) {
    if (!data.vitals.length) return data.vitalsEmpty
    const measured = data.vitals.filter((v) => v.status !== 'none')
    const need = measured.filter((v) => v.status !== 'ok').length
    return `${measured.length} of ${data.vitals.length} measured · ${need ? `${need} need${need === 1 ? 's' : ''} attention` : 'none out of range'}`
  }
  if (layer === 2) {
    if (!data.systems.length) return 'No body-system data yet'
    const need = data.systems.filter((s) => s.status === 'warn' || s.status === 'crit').length
    const blank = data.systems.filter((s) => s.status === 'none').length
    return `${data.systems.length} systems · ${need ? `${need} need${need === 1 ? 's' : ''} attention` : 'none flagged'}${blank ? ` · ${blank} without current readings` : ''}`
  }
  return `${stateLabel} · the ring of bars is the last three seconds of sound level`
}

/**
 * `listening` / `urgent`: what the page itself knows (its own dictation is running; its result is an emergency).
 * They fill in while the voice store is idle. Memoised: typing in the composer does not re-render the core.
 */
export default memo(function AuraCore({ variant, listening: pageListening = false, urgent: pageUrgent = false, className, crewId, onExplain, fullscreen = false, onToggleFullscreen }: AuraCoreProps) {
  const local = useMemo<LocalHints>(() => ({ listening: pageListening, urgent: pageUrgent }), [pageListening, pageUrgent])
  const presence = useSyncExternalStore(subscribeVoicePresence, getVoicePresence, getVoicePresence)
  const [override, setOverride] = useState<Override>({})
  const [failed, setFailed] = useState(coreBroken)
  const [ready, setReady] = useState(false)
  const [keys, setKeys] = useState(false)
  const [layer, setLayer] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const systemReduce = useReducedMotion()
  const reduce = override.reduce ?? !!systemReduce
  const lowPower = useHandMode()
  const coarse = useMedia('(pointer: coarse)')
  const helpId = useId()
  const navigate = useNavigate()
  const full = variant === 'full'
  const compact = variant === 'strip'
  const labelled = variant === 'panel' || full

  const stageRef = useRef<HTMLDivElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CoreScene | null>(null)
  const controlsRef = useRef<ViewerControls | null>(null)
  const gesture = useRef<{ pointers: Map<number, { x: number; y: number }>; moved: boolean; travel: number; pinch: number }>({ pointers: new Map(), moved: false, travel: 0, pinch: 0 })
  const handOver = useRef(false)

  // ----- what the layers show: the page's evaluation, the session's mission, the cabin readings -----
  const { mission } = useSession()
  const published = useSyncExternalStore(subscribeCoreEvaluation, getCoreEvaluation, getCoreEvaluation)
  const ev = published && published.crewId === crewId ? published.ev : null
  const envLive = useEnvLive()
  const liveOn = envLive.connected && !!envLive.latest
  const liveKey = liveOn && envLive.latest ? Math.floor(envLive.latest.at / 10_000) : 0
  const [clock, setClock] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setClock((c) => c + 1), 20_000) // stored cabin readings age; the consultation refreshes them
    return () => window.clearInterval(t)
  }, [])
  const ctx = ev?.context ?? mission?.context ?? 'space'
  const lastData = useRef<{ key: string; data: CoreData } | null>(null)
  const data = useMemo(() => {
    const next = buildCoreData({
      ev,
      mission: mission ? { name: mission.name, day: mission.day, totalDays: mission.totalDays ?? null, delaySec: ctx === 'space' ? (MISSIONS.find((m) => m.id === mission.profileId)?.delaySec ?? null) : null } : null,
      cabin: currentCabin(ctx),
      live: liveOn,
    })
    // same content: keep the same object, so the scene does not rebuild its geometry
    const key = JSON.stringify(next)
    if (lastData.current?.key === key) return lastData.current.data
    lastData.current = { key, data: next }
    return next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ev, mission, ctx, liveOn, liveKey, clock])
  const dataRef = useRef(data)
  dataRef.current = data
  const selected = findItem(data, selectedId)
  const layerItems = useMemo(() => itemsOf(data, LAYERS[layer].id), [data, layer])

  // The store says whether speech exists once the voice hook has published; before that, ask the browser.
  const [capable] = useState(() => recognitionSupported() || ttsSupported())
  const available = override.available ?? (presence.available || capable)
  const phase = override.phase ?? presence.phase
  const input = { available, phase, urgent: override.urgent ?? presence.urgent }
  const state = coreState(input, local)
  const shownPhase = effectivePhase(phase, local)
  const live = state !== 'off' && (shownPhase === 'listening' || shownPhase === 'speaking')
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
  const live3 = useRef({ state, live, reduce, lowPower, full, labelled })
  live3.current = { state, live, reduce, lowPower, full, labelled }

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

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) {
      const it = findItem(dataRef.current, id)
      const li = it ? LAYERS.findIndex((l) => l.id === it.layer) : -1
      if (li >= 0 && sceneRef.current && sceneRef.current.layer() > li) sceneRef.current.diveTo(li) // a passed layer: come back out to it
    }
  }, [])
  const diveTo = useCallback((i: number) => {
    const n = Math.max(0, Math.min(MAX_DEPTH, Math.round(i)))
    if (sceneRef.current) sceneRef.current.diveTo(n)
    else setLayer(n) // flat drawing: the labels and the note still follow the layer
  }, [])
  const layerRef = useRef(layer)
  layerRef.current = layer
  const diveBy = useCallback(
    (delta: 1 | -1) => {
      const next = Math.max(0, Math.min(MAX_DEPTH, layerRef.current + delta))
      if (next === layerRef.current) return false
      diveTo(next)
      return true
    },
    [diveTo],
  )

  // other features (voice commands) may dive through control.ts; the compact strip has no layers to enter
  useEffect(() => {
    if (compact) return
    return registerCore({ dive: diveBy, goTo: diveTo, layer: () => layerRef.current })
  }, [compact, diveBy, diveTo])

  // ----- labels: bracketed readouts with leader lines, placed from the scene's anchors without React renders -----
  const placedSig = useRef(NaN)
  const placeLabels = useCallback((force = false) => {
    const scene = sceneRef.current
    const box = labelsRef.current
    const stage = stageRef.current
    if (!scene || !box || !stage) return
    const w = stage.clientWidth
    const h = stage.clientHeight
    const placed: { x: number; y: number }[] = []
    const els = box.children
    const anchors = scene.layout()
    // most frames move nothing a label hangs on (the shell and the orbit are still while the rings drift):
    // compare a cheap signature of the anchors first and leave the DOM alone when it has not changed
    let sig = els.length * 7919 + w * 13 + h
    for (let i = 0; i < anchors.length; i++) sig = (sig * 31 + Math.round(anchors[i].x * 2) * 3 + Math.round(anchors[i].y * 2) + (anchors[i].front ? 1 : 0)) % 2147483647
    if (!force && sig === placedSig.current) return
    placedSig.current = sig
    for (let i = 0; i < els.length; i++) {
      const el = els[i] as HTMLElement
      const a = anchors.find((p) => p.id === el.dataset.id)
      if (!a || !a.front) {
        if (el.style.opacity !== '0') el.style.opacity = '0'
        continue
      }
      const dx = a.x - w / 2
      const dy = a.y - h / 2
      const len = Math.hypot(dx, dy) || 1
      const reach = Math.max(18, Math.min(34, w * 0.05))
      const lx = a.x + (dx / len) * reach
      const ly = a.y + (dy / len) * reach
      const sel = el.hasAttribute('data-selected')
      // a narrow stage (tablet column, phone) has no room round it: only the selected reading keeps its label
      const clash = !sel && (w < 400 || placed.some((p) => Math.abs(p.x - lx) < 96 && Math.abs(p.y - ly) < 34))
      if (clash) {
        if (el.style.opacity !== '0') el.style.opacity = '0'
        continue
      }
      placed.push({ x: lx, y: ly })
      const t = `translate(${lx.toFixed(1)}px,${ly.toFixed(1)}px)`
      if (el.style.transform !== t) {
        el.style.transform = t
        const side = dx >= 0 ? 'r' : 'l'
        if (el.dataset.side !== side) el.dataset.side = side
        const lead = el.firstElementChild as HTMLElement | null
        if (lead) {
          const lw = `${reach.toFixed(0)}px`
          if (lead.style.width !== lw) lead.style.width = lw
          lead.style.transform = `rotate(${(Math.atan2(-dy, -dx) * 180) / Math.PI}deg)`
        }
      }
      if (el.style.opacity !== '1') el.style.opacity = '1'
    }
  }, [])
  const placeRef = useRef(placeLabels)
  placeRef.current = placeLabels

  // ----- the WebGL scene: created when the browser is idle, on a canvas of its own, disposed on unmount -----
  useEffect(() => {
    const stage = stageRef.current
    if (!use3D || !stage) return
    let alive = true
    let scene: CoreScene | null = null
    let inView = true
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-hidden', 'true')
    stage.insertBefore(canvas, stage.firstChild)

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
            data: dataRef.current,
            full: cur.full,
            onFrame: () => live3.current.labelled && placeRef.current(),
            onLayer: (i) => alive && setLayer(i),
            onReady: () => alive && setReady(true),
            onLost: fail,
          })
          sceneRef.current = scene
          const s = scene
          controlsRef.current = {
            zoom: (direction) => void s.diveBy(direction > 0 ? 1 : -1),
            reset: () => s.reset(),
            rotateBy: (dx, dy) => s.rotateBy(dx, dy),
            // the two-hand spread arrives as a zoom factor: spread = dive in, together = back out
            zoomBy: (factor) => s.zoomBy(factor),
            // a pinch-tap with hand control selects the item under the cursor, or starts a conversation
            pickAt: (x, y) => {
              const r = stage.getBoundingClientRect()
              const hit = s.pick(x - r.left, y - r.top, 40)
              if (hit) setSelectedId(hit.id)
              else talkRef.current('hand')
              return (hit ? hit.key : null) as SystemId | null
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
  useEffect(() => sceneRef.current?.setData(data), [data, ready])
  useEffect(() => sceneRef.current?.setSelected(selectedId), [selectedId, ready])
  useEffect(() => sceneRef.current?.setFull(full), [full, ready])
  // a new set of labels (layer, data, selection): place them once now; the scene keeps them in place afterwards
  useEffect(() => {
    if (labelled && ready) placeLabels(true)
  }, [labelled, ready, layer, layerItems, selectedId, placeLabels])
  // the selection belongs to the data: it goes when its item does
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null)
  }, [selectedId, selected])

  // hand control finds the core (and turns / dives / resets it) while its cursor is over the canvas
  useEffect(() => {
    const el = stageRef.current
    if (!ready || !el) return
    return registerViewer({ el, controls: () => controlsRef.current })
  }, [ready])

  // Ctrl + wheel (and a trackpad pinch) dives; a plain wheel is left to the page (in full screen every wheel dives)
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey || live3.current.full) || !sceneRef.current) return
      e.preventDefault()
      sceneRef.current.zoomBy(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * 0.004))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // dev-only: window.__auraCore.set({ phase, urgent, available, interim, caption, level, webgl, reduce }), .dive(n), .select(id)
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
      dive: (n) => diveTo(n),
      select: (id) => select(id),
      layer: () => layerRef.current,
    }
    w.__auraCore = hook
    return () => {
      if (w.__auraCore === hook) delete w.__auraCore
    }
  }, [diveTo, select])

  // ----- pointer: drag turns, two fingers dive, a tap selects what is under it or talks -----
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
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // the click that ends a drag or a pinch is not a tap
    if (gesture.current.moved) {
      gesture.current.moved = false
      return
    }
    const r = e.currentTarget.getBoundingClientRect()
    const hit = e.detail === 0 ? null : (sceneRef.current?.pick(e.clientX - r.left, e.clientY - r.top, coarse ? 30 : 20) ?? null)
    if (hit) select(hit.id === selectedId ? null : hit.id)
    else if (selectedId) select(null)
    else talk()
  }
  const cycle = (dir: 1 | -1) => {
    if (!layerItems.length) return
    const i = layerItems.findIndex((it) => it.id === selectedId)
    select(layerItems[(i + dir + layerItems.length) % layerItems.length].id)
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
    else if (e.key === '+' || e.key === '=' || e.key === 'PageDown') diveBy(1)
    else if (e.key === '-' || e.key === '_' || e.key === 'PageUp') diveBy(-1)
    else if (e.key >= '1' && e.key <= String(MAX_DEPTH + 1)) diveTo(Number(e.key) - 1)
    else if (e.key === '0' || e.key === 'Home') {
      s?.reset()
      if (!s) setLayer(0)
    } else if (e.key === '.' || e.key === ']') cycle(1)
    else if (e.key === ',' || e.key === '[') cycle(-1)
    else if (e.key === 'Escape' && selectedId) select(null)
    else if ((e.key === 'f' || e.key === 'F') && onToggleFullscreen && !full) onToggleFullscreen()
    else used = false
    if (used) e.preventDefault()
  }

  const listening = shownPhase === 'listening' && state !== 'off'
  const help = keys ? 'Arrows turn · + and − dive · 1–4 jump · , and . pick a reading · 0 resets' : coarse ? 'Drag to turn · pinch to dive in' : `Drag to turn · ${full ? 'scroll' : 'Ctrl + scroll'} to dive in · click a reading`
  const dot = live && state !== 'urgent'
  const note = layerNote(layer, data, text.label)

  const open = (it: CoreItem) => {
    if (it.kind === 'cabin') navigate('/environment')
    else if (it.kind === 'system' && crewId != null) {
      navigate(`/crew/${crewId}/diagnostics`)
      window.setTimeout(() => emitUi('select-system', { system: it.key as SystemId, source: 'page' }), 700)
    } else if (crewId != null) navigate(`/crew/${crewId}`)
  }

  const crumbs = !compact && variant !== 'side' && (
    <nav aria-label="Core layers" className="aura-core__crumbs">
      <ol className="flex flex-wrap items-center">
        {LAYERS.map((l, i) => (
          <li key={l.id} className="flex items-center">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-edge" aria-hidden="true" />}
            <button type="button" aria-current={i === layer ? 'step' : undefined} title={l.title} className="press aura-core__crumb" onClick={() => diveTo(i)}>
              <span className="font-mono text-xs text-dim" aria-hidden="true">
                {i + 1}
              </span>
              {l.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="aura-core__note" role="status">
        <span className="text-soft">{LAYERS[layer].title}.</span> {note}
      </p>
    </nav>
  )

  const diveButtons = !compact && variant !== 'side' && (
    <>
      <Button size={full ? 'md' : 'sm'} icon={ChevronDown} disabled={layer >= MAX_DEPTH} onClick={() => diveBy(1)}>
        Deeper
      </Button>
      <Button size={full ? 'md' : 'sm'} icon={ChevronUp} disabled={layer <= 0} onClick={() => diveBy(-1)}>
        Back out
      </Button>
    </>
  )

  const readout = selected && !compact && (
    <div className={cx('aura-core__readout aura-pop text-left', full ? 'aura-core__readout--full' : 'w-full max-w-sm')} role="group" aria-label={`${selected.label} readout`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs text-dim">[ {LAYERS.find((l) => l.id === selected.layer)?.title} ]</p>
          <p className="mt-0.5 text-[15px] font-semibold text-ink">{selected.label}</p>
        </div>
        <IconButton icon={X} size="sm" label="Close readout" onClick={() => select(null)} />
      </div>
      <p className="mt-1 text-metric-md text-ink">
        {selected.value || '—'} {selected.value && selected.unit ? <span className="text-sm text-dim">{selected.unit}</span> : null}
      </p>
      {selected.kind !== 'mission' && (
        <p className="mt-1 flex items-center gap-2 text-sm text-soft">
          <StatusMark status={selected.status} />
          {STATUS_WORD[selected.status]}
        </p>
      )}
      {selected.note && <p className="mt-1 text-sm leading-snug text-dim">{selected.note}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {(selected.kind === 'cabin' || crewId != null) && (
          <Button size="sm" onClick={() => open(selected)}>
            {selected.kind === 'cabin' ? 'Open the environment page' : selected.kind === 'system' ? 'Open in diagnostics' : selected.kind === 'mission' ? 'Open the overview' : 'Open this reading'}
          </Button>
        )}
        {selected.kind === 'vital' && selected.status !== 'none' && onExplain && (
          <Button size="sm" onClick={() => onExplain(selected.key)}>
            Ask AURA about it
          </Button>
        )}
      </div>
    </div>
  )

  return (
    <section
      aria-label="AURA voice"
      data-aura-core={state}
      data-state={state}
      data-variant={variant}
      data-layer={LAYERS[layer].id}
      data-mode={use3D && ready ? '3d' : 'flat'}
      data-still={reduce ? '' : undefined}
      className={cx('aura-core min-w-0', full ? 'aura-core--full' : compact ? 'flex items-center gap-3 border-b border-line pb-3 text-left' : 'flex flex-col items-center gap-3 text-center', className)}
    >
      {crumbs}
      <div
        ref={stageRef}
        role="button"
        tabIndex={0}
        aria-label="AURA core. Talk to AURA"
        aria-describedby={helpId}
        aria-disabled={!available}
        data-ready={use3D && ready ? '' : undefined}
        className={cx('aura-core__stage', full ? '' : compact ? 'w-[72px]' : variant === 'side' ? 'w-full max-w-52' : 'w-full max-w-[440px]')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onFocus={(e) => setKeys(e.currentTarget.matches(':focus-visible'))}
        onBlur={() => setKeys(false)}
      >
        <CoreFallback state={state} compact={compact} data={data} layer={layer} selected={selectedId} />
        {labelled && use3D && (
          <div ref={labelsRef} className="aura-core__labels" aria-hidden="true">
            {layerItems.map((it) => (
              <div key={it.id} className="aura-core__label" data-id={it.id} data-status={it.status} data-selected={it.id === selectedId ? '' : undefined} style={{ opacity: 0 }}>
                <i className="aura-core__leader" />
                <span className="aura-core__tag">
                  <span className="font-mono text-xs text-dim">[ {it.short} ]</span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                    <StatusMark status={it.status} />
                    {it.kind === 'system' ? STATUS_WORD[it.status] : valueOf(it)}
                    {it.kind !== 'system' && it.status !== 'ok' && it.status !== 'none' && <span className="font-normal text-soft">{STATUS_WORD[it.status]}</span>}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <span id={helpId} className="sr-only">
        A 3D instrument with four layers: mission shell, vitals orbit, body systems and AURA's voice. Press Enter to talk. Arrow keys turn it, plus and minus move between layers, 1 to 4 jump to a layer, comma and full stop pick a reading, 0 resets the view. Everything it shows is also written next to it.
      </span>
      {/* the readings of the layer in focus, for the keyboard and screen readers: focusing one selects it */}
      {!compact && layerItems.length > 0 && (
        <ul className="sr-only" aria-label={`${LAYERS[layer].title}: readings`}>
          {layerItems.map((it) => (
            <li key={it.id}>
              <button type="button" aria-pressed={it.id === selectedId} onFocus={() => select(it.id)} onClick={() => select(it.id)} onKeyDown={(e) => e.key === 'Escape' && select(null)}>
                {it.label}: {it.value || 'no reading'} {it.unit}. {it.kind !== 'mission' ? STATUS_WORD[it.status] : ''}. {it.note}
              </button>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <>
          <div className="aura-core__dock">
            {diveButtons}
            {use3D && <IconButton icon={RotateCcw} variant="secondary" label="Reset view" onClick={() => sceneRef.current?.reset()} />}
            {/* a solid plate: in full screen the rings pass behind the dock */}
            <p className="hidden rounded-lg bg-space px-2 py-1 text-xs text-dim lg:block">{help}</p>
          </div>
          {readout}
        </>
      ) : (
        <>
          {/* a fixed block beside the full-size core, so the buttons under it do not jump as the words change */}
          <div className={cx('min-w-0', compact ? 'flex-1' : variant === 'panel' ? 'flex min-h-24 max-w-sm flex-col items-center' : 'flex max-w-sm flex-col items-center')}>
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
            <div className="flex shrink-0 items-center gap-1">
              <IconButton icon={Mic} label={listening ? 'AURA is listening' : 'Talk to AURA'} variant="secondary" aria-pressed={listening} disabled={!available} className={cx(listening && 'bg-panel2')} onClick={() => talk()} />
              {onToggleFullscreen && <IconButton icon={Maximize2} label="Full screen" variant="secondary" aria-pressed={fullscreen} onClick={onToggleFullscreen} />}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button icon={Mic} aria-pressed={listening} disabled={!available} className={cx(listening && 'bg-panel2')} onClick={() => talk()}>
                  {listening ? 'Listening' : 'Talk to AURA'}
                </Button>
                {onToggleFullscreen &&
                  (variant === 'panel' ? (
                    <Button icon={Maximize2} aria-pressed={fullscreen} onClick={onToggleFullscreen}>
                      Full screen
                    </Button>
                  ) : (
                    <IconButton icon={Maximize2} variant="secondary" label="Full screen" aria-pressed={fullscreen} onClick={onToggleFullscreen} />
                  ))}
                {use3D && <IconButton icon={RotateCcw} label="Reset view" onClick={() => sceneRef.current?.reset()} />}
              </div>
              {variant === 'panel' && <div className="flex items-center justify-center gap-2">{diveButtons}</div>}
              {readout}
              {use3D && variant === 'panel' && <p className="text-xs text-dim">{help}</p>}
            </>
          )}
        </>
      )}
    </section>
  )
})
