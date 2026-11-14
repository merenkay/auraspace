import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../data/vitals'
import BodyMap from './BodyMap'
import type { LayerId } from './three/Body3D'
import { Spinner } from './ui'

const Body3D = lazy(() => import('./three/Body3D'))

type Manifest = { files: string[] }
let manifestPromise: Promise<Manifest | null> | null = null
function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('/models/body-manifest.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((m: Manifest | null) => (m && Array.isArray(m.files) && m.files.length ? { files: m.files.map((f) => (f.startsWith('/') ? f : `/models/${f.replace(/^.*\//, '')}`)) } : null))
      .catch(() => null)
  }
  return manifestPromise
}

function webglOK() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

const LAYERS: { id: LayerId; label: string; color: string }[] = [
  { id: 'skeleton', label: 'Skeleton', color: '#e9dfc9' },
  { id: 'organs', label: 'Organs', color: '#e9a3a0' },
  { id: 'arteries', label: 'Arteries', color: '#e0362f' },
  { id: 'veins', label: 'Veins', color: '#3f6ae0' },
  { id: 'nerves', label: 'Nerves', color: '#f5d547' },
  { id: 'muscles', label: 'Muscles', color: '#b9574d' },
]

type Props = {
  statuses: Record<SystemId, Status>
  summaries: Record<SystemId, string>
  selected: SystemId | null
  onSelect: (id: SystemId) => void
  heartRate: number
  compact?: boolean
}

export default function BodyViewer({ statuses, summaries, selected, onSelect, heartRate, compact = false }: Props) {
  const [manifest, setManifest] = useState<Manifest | null | undefined>(undefined)
  const [layers, setLayers] = useState<Record<LayerId, boolean>>({
    skin: true, muscles: true, skeleton: true, organs: true, arteries: true, veins: false, nerves: false,
  })
  const [hover, setHover] = useState<{ id: SystemId; x: number; y: number } | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)

  useEffect(() => {
    let alive = true
    loadManifest().then((m) => alive && setManifest(m && webglOK() ? m : null))
    return () => {
      alive = false
    }
  }, [])

  // resume auto-rotation a few seconds after the user lets go
  useEffect(() => {
    if (autoRotate) return
    const t = setTimeout(() => setAutoRotate(true), 7000)
    return () => clearTimeout(t)
  }, [autoRotate, hover])

  if (manifest === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading body model" />
      </div>
    )
  }

  if (!manifest) {
    return (
      <div className="h-full">
        <BodyMap statuses={statuses} summaries={summaries} selected={selected} onSelect={onSelect} heartRate={heartRate} />
      </div>
    )
  }

  const tip = hover ? SYSTEM_BY_ID[hover.id] : null
  return (
    <div className="relative h-full w-full">
      <Suspense
        fallback={
          <div className="flex h-full items-center justify-center">
            <Spinner label="Loading 3D anatomy" />
          </div>
        }
      >
        <Body3D
          files={manifest.files}
          layers={layers}
          statuses={statuses}
          hovered={hover?.id ?? null}
          selected={selected}
          onSelect={(id) => {
            setAutoRotate(false)
            onSelect(id)
          }}
          onHover={(id, x, y) => setHover(id ? { id, x: x ?? 0, y: y ?? 0 } : null)}
          autoRotate={autoRotate && !hover}
          onInteract={() => setAutoRotate(false)}
        />
      </Suspense>

      <AnimatePresence>
        {tip && hover && (
          <motion.div
            key={tip.id}
            initial={{ opacity: 0, scale: 0.92, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="pointer-events-none absolute z-20 w-60 rounded-2xl border bg-space/95 p-3 shadow-2xl backdrop-blur"
            style={{ left: Math.min(hover.x + 16, 9999), top: hover.y + 16, borderColor: STATUS_COLOR[statuses[tip.id]] }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{tip.name}</span>
              <span className="text-[10px] font-bold tracking-widest" style={{ color: STATUS_COLOR[statuses[tip.id]] }}>
                {STATUS_LABEL[statuses[tip.id]]}
              </span>
            </div>
            <div className="mt-1 text-base font-bold" style={{ color: STATUS_COLOR[statuses[tip.id]] }}>
              {summaries[tip.id]}
            </div>
            <p className="mt-1 text-xs leading-snug text-soft">{tip.hint}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {!compact && (
        <div className="absolute inset-x-2 bottom-2 flex flex-wrap justify-center gap-1.5">
          {LAYERS.map((l) => (
            <button
              key={l.id}
              type="button"
              aria-pressed={layers[l.id]}
              onClick={() => setLayers((s) => ({ ...s, [l.id]: !s[l.id] }))}
              className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition ${
                layers[l.id] ? 'border-cyan/50 bg-cyan/10 text-ink' : 'border-line bg-space/60 text-dim'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: layers[l.id] ? l.color : '#33506b' }} />
              {l.label}
            </button>
          ))}
        </div>
      )}
      <div className="absolute right-2 top-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => onSelect('radiation')}
          className="min-h-9 rounded-full border border-line bg-space/60 px-3 text-xs font-semibold text-soft hover:border-cyan"
        >
          ☢ Whole body
        </button>
        <button
          type="button"
          onClick={() => setAutoRotate((a) => !a)}
          aria-pressed={autoRotate}
          className="min-h-9 rounded-full border border-line bg-space/60 px-3 text-xs font-semibold text-soft hover:border-cyan"
        >
          {autoRotate ? '❚❚ Pause' : '⟳ Rotate'}
        </button>
      </div>
      <p className="pointer-events-none absolute left-3 top-3 text-[11px] text-dim">Drag to rotate 360° · scroll to zoom</p>
    </div>
  )
}
