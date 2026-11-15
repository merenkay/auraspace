// The AURA core as a flat line drawing: shown while the 3D engine loads, and for good when WebGL is missing or
// its context is lost. It draws the same four layers from the same data (layers.ts) and the same voice poses
// (model.ts) as the WebGL scene, so a state and a reading look the same either way. Pure SVG; colours come from
// the app's CSS variables. A still picture: the layer in focus is a cut, not a flight.
import { useMemo } from 'react'
import { geodesic, polygon, projectLattice, spread } from './geometry'
import { cabinSlots, EMPTY_DATA, GEO, INNER_SCALE, LAYERS, passFade, vitalSlots, zoomForDepth, type CoreData, type ItemStatus } from './layers'
import { OCTAGON_RADIUS, POSES, TICK_RADIUS, type CoreState, type RingPose, type Tone } from './model'

const U = 100 // SVG units per scene unit
const TONE: Record<Tone, string> = { accent: 'var(--color-accent)', edge: 'var(--color-edge)', dim: 'var(--color-dim)', soft: 'var(--color-soft)', ink: 'var(--color-ink)', crit: 'var(--color-crit)' }
const LATTICE = geodesic(2)
const TICK_LENGTH = 2 * Math.PI * TICK_RADIUS * U
const YAW = 0.5
const PITCH = 0.42

const statusColor = (s: ItemStatus, normal: string) => (s === 'crit' ? 'var(--color-crit)' : s === 'warn' ? 'var(--color-warn)' : s === 'none' ? 'var(--color-edge)' : normal)

/** An arc of a circle as path data: degrees clockwise from the top, y down. */
function arc(from: number, to: number, r: number): string {
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180
    return `${(Math.sin(a) * r * U).toFixed(1)} ${(-Math.cos(a) * r * U).toFixed(1)}`
  }
  return `M${p(from)}A${r * U} ${r * U} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`
}

/** A ring seen from the front: an ellipse (rx along the tilt axis). Motion is left out: the fallback is a still. */
function ellipse(r: RingPose) {
  const flat = Math.abs(Math.cos(r.tilt))
  const upright = r.motion === 'gimbalY'
  return { rx: r.radius * U * (upright ? flat : 1), ry: r.radius * U * (upright ? 1 : flat), rot: (-r.roll * 180) / Math.PI }
}

export default function CoreFallback({ state, compact, data = EMPTY_DATA, layer = 0, selected = null }: { state: CoreState; compact: boolean; data?: CoreData; layer?: number; selected?: string | null }) {
  const pose = POSES[state]
  const lattice = useMemo(() => projectLattice(LATTICE, YAW, PITCH, U), [])
  // the named nodes: the same even spread as the 3D scene, on this drawing's own lattice
  const nodes = useMemo(() => {
    const cy = Math.cos(YAW)
    const sy = Math.sin(YAW)
    const cp = Math.cos(PITCH)
    const sp = Math.sin(PITCH)
    return spread(LATTICE.vertices, 12).map((i) => {
      const [x, y, z] = LATTICE.vertices[i]
      const x1 = x * cy + z * sy
      const z1 = -x * sy + z * cy
      return { x: x1 * U, y: -(y * cp - z1 * sp) * U, front: y * sp + z1 * cp >= 0 }
    })
  }, [])
  const sw = compact ? 4 : 1 // the compact strip is drawn at about a quarter of the size
  const nucleus = TONE[pose.nucleus.tone]
  const octagon = polygon(8, OCTAGON_RADIUS * U)
  const zoom = compact ? 1 : zoomForDepth(layer)
  const inner = compact ? 1 : INNER_SCALE
  const line = (w: number) => (w * sw) / zoom // line widths stay the same on screen at every layer
  const dim = (id: string) => (selected && selected !== id ? 0.42 : 1)
  const shellFade = passFade(LAYERS[0].radius, zoom)
  const vitalsFade = passFade(LAYERS[1].radius, zoom)
  const dial = GEO.dial
  const step = 360 / dial.segments
  const flown = data.missionFraction == null ? 0 : Math.round(data.missionFraction * dial.segments)
  const dialR = (dial.r0 + dial.r1) / 2
  const V = GEO.vitals
  const vr = (V.r0 + V.r1) / 2
  const vs = vitalSlots(data.vitals)
  const cs = cabinSlots(data.cabin)
  return (
    <svg className="aura-core__flat" viewBox="-170 -170 340 340" fill="none" aria-hidden="true" focusable="false" data-flat={state}>
      <g transform={`scale(${zoom})`}>
        {shellFade > 0.01 && (
          <g opacity={shellFade}>
            <circle r={TICK_RADIUS * U + 3} stroke={TONE.edge} strokeWidth={(compact ? 9 : 6) / zoom} strokeDasharray={`${compact ? 3 : 1.2} ${TICK_LENGTH / (compact ? 24 : 72) - (compact ? 3 : 1.2)}`} opacity={state === 'off' ? 0.6 : 0.95} />
            {!compact && (
              <>
                {/* mission dial: 60 segments, filled = days flown of the planned length (none filled when there is no plan) */}
                <circle r={dialR * U} stroke={TONE.edge} strokeOpacity={0.38 * dim('mission')} strokeWidth={(dial.r1 - dial.r0) * U} strokeDasharray={`${((step - dial.gap) / 360) * 2 * Math.PI * dialR * U} ${(dial.gap / 360) * 2 * Math.PI * dialR * U}`} transform={`rotate(${-90 + dial.gap / 2})`} />
                {flown > 0 && <path d={arc(dial.gap / 2, flown * step - dial.gap / 2, dialR)} stroke={TONE.soft} strokeOpacity={0.95 * dim('mission')} strokeWidth={(dial.r1 - dial.r0) * U} strokeDasharray={`${((step - dial.gap) / 360) * 2 * Math.PI * dialR * U} ${(dial.gap / 360) * 2 * Math.PI * dialR * U}`} />}
                <circle r={GEO.rail * U} stroke={TONE.edge} strokeOpacity={data.cabin.length ? 0.5 : 0.7} strokeWidth={line(1)} strokeDasharray={data.cabin.length ? undefined : '2 5'} />
                {cs.map((slot, i) => {
                  const it = data.cabin[i]
                  return (
                    <g key={slot.id} opacity={dim(it.id)}>
                      <path d={arc(slot.from, slot.to, GEO.rail)} stroke={TONE.edge} strokeOpacity={0.55} strokeWidth={4} />
                      {it.fraction != null && <path d={arc(slot.from, slot.from + (slot.to - slot.from) * Math.max(0.03, it.fraction), GEO.rail)} stroke={statusColor(it.status, TONE.ink)} strokeWidth={4} />}
                    </g>
                  )
                })}
              </>
            )}
          </g>
        )}
        {!compact && vitalsFade > 0.01 && (
          <g opacity={vitalsFade}>
            {!vs.length && <circle r={V.track * U} stroke={TONE.edge} strokeOpacity={0.7} strokeWidth={line(1)} strokeDasharray="2 5" />}
            {vs.map((slot, i) => {
              const it = data.vitals[i]
              const end = it.fraction == null ? slot.to : slot.from + (slot.to - slot.from) * Math.max(0.04, it.fraction)
              const a = (slot.mid * Math.PI) / 180
              const mx = Math.sin(a) * V.marker * U
              const my = -Math.cos(a) * V.marker * U
              return (
                <g key={slot.id} opacity={dim(it.id)}>
                  {it.status === 'none' ? (
                    <path d={arc(slot.from, slot.to, vr)} stroke={TONE.edge} strokeOpacity={0.85} strokeWidth={3} strokeDasharray="2.4 4" />
                  ) : (
                    <>
                      <path d={arc(slot.from, slot.to, V.track)} stroke={TONE.edge} strokeOpacity={0.6} strokeWidth={line(1)} />
                      <path d={arc(slot.from, end, vr)} stroke={statusColor(it.status, TONE.soft)} strokeWidth={(V.r1 - V.r0) * U} />
                    </>
                  )}
                  {it.status === 'warn' && <rect x={mx - 2.4} y={my - 2.4} width={4.8} height={4.8} transform={`rotate(45 ${mx} ${my})`} stroke="var(--color-warn)" strokeWidth={1.6} />}
                  {it.status === 'crit' && <path d={`M${polygon(8, 3.6).map(([x, y]) => `${(mx + x).toFixed(1)} ${(my + y).toFixed(1)}`).join('L')}Z`} stroke="var(--color-crit)" strokeWidth={1.6} />}
                  {selected === it.id && <path d={`${arc(slot.from - 0.9, slot.from - 0.3, vr)}${arc(slot.to + 0.3, slot.to + 0.9, vr)}`} stroke={TONE.ink} strokeWidth={(V.r1 - V.r0 + 0.07) * U} />}
                </g>
              )
            })}
          </g>
        )}
        <g transform={`scale(${inner})`}>
          {!compact && (
            <g transform={`scale(${pose.shell.radius})`} opacity={passFade(pose.shell.radius * inner, zoom)}>
              {pose.shell.edges > 0 && <path d={lattice.back} stroke={TONE.dim} strokeWidth={line(1) / (pose.shell.radius * inner)} opacity={pose.shell.edges * 0.3} />}
              {pose.shell.edges > 0 && <path d={lattice.front} stroke={TONE.dim} strokeWidth={line(1) / (pose.shell.radius * inner)} opacity={pose.shell.edges} />}
              <path d={lattice.dotsBack} stroke={TONE[pose.shell.tone]} strokeWidth={4 / Math.sqrt(zoom)} strokeLinecap="round" opacity={pose.shell.points * 0.35} />
              <path d={lattice.dotsFront} stroke={TONE[pose.shell.tone]} strokeWidth={4.6 / Math.sqrt(zoom)} strokeLinecap="round" opacity={pose.shell.points} />
              {/* body systems: disc = normal, diamond = attention, octagon = urgent, hollow ring = no current reading */}
              {data.systems.slice(0, nodes.length).map((it, i) => {
                const n = nodes[i]
                const r = (it.id === selected ? 13 : 9) / Math.sqrt(zoom)
                const c = statusColor(it.status, TONE.ink)
                const o = (n.front ? 1 : 0.3) * dim(it.id)
                if (it.status === 'ok') return <circle key={it.id} cx={n.x} cy={n.y} r={r * 0.6} fill={c} opacity={o} />
                if (it.status === 'warn') return <rect key={it.id} x={n.x - r * 0.6} y={n.y - r * 0.6} width={r * 1.2} height={r * 1.2} transform={`rotate(45 ${n.x} ${n.y})`} fill="var(--color-space)" stroke={c} strokeWidth={r * 0.36} opacity={o} />
                if (it.status === 'crit') return <path key={it.id} d={`M${polygon(8, r * 0.85).map(([x, y]) => `${(n.x + x).toFixed(1)} ${(n.y + y).toFixed(1)}`).join('L')}Z`} fill="var(--color-space)" stroke={c} strokeWidth={r * 0.36} opacity={o} />
                return <circle key={it.id} cx={n.x} cy={n.y} r={r * 0.7} fill="var(--color-space)" stroke={c} strokeWidth={r * 0.22} opacity={o} />
              })}
            </g>
          )}
          {pose.rings.map((r, i) => {
            const e = ellipse(r)
            const o = r.opacity * (compact ? 1 : passFade(r.radius * inner, zoom))
            if (o <= 0.01) return null
            return <ellipse key={i} rx={e.rx} ry={Math.max(e.ry, 0.5)} transform={`rotate(${e.rot})`} stroke={TONE[r.tone]} strokeWidth={line(r.width) / inner} opacity={o} strokeDasharray={r.dashed ? '5 7' : undefined} />
          })}
          {pose.arc > 0 && (
            <g className="aura-core__flat-arc">
              <path d={`M0 ${-pose.rings[2].radius * U}A${pose.rings[2].radius * U} ${pose.rings[2].radius * U} 0 0 1 ${pose.rings[2].radius * U} 0`} stroke={TONE.accent} strokeWidth={line(3) / inner} strokeLinecap="round" />
            </g>
          )}
          {pose.octagon > 0 && <path d={`M${octagon.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`} stroke={TONE.crit} strokeWidth={line(2.5) / inner} strokeLinejoin="miter" />}
          <g className={state === 'idle' ? 'aura-core__flat-nucleus' : undefined}>
            <circle r={pose.nucleus.radius * U} fill="var(--color-space)" />
            <circle r={pose.nucleus.radius * U} fill={nucleus} fillOpacity={pose.nucleus.fill} stroke={nucleus} strokeWidth={line(1.5) / inner} strokeDasharray={state === 'off' ? '5 7' : undefined} />
            {pose.nucleus.dot > 0 && <circle r={pose.nucleus.dot * U} fill={nucleus} />}
          </g>
        </g>
        {/* the level history is flat in a still picture: 72 short marks round the nucleus */}
        {!compact && <circle r={GEO.bars.r * U} stroke={state === 'off' ? TONE.edge : nucleus} strokeOpacity={0.9} strokeWidth={1.2} strokeDasharray={`${(2.6 / 360) * 2 * Math.PI * GEO.bars.r * U} ${(2.4 / 360) * 2 * Math.PI * GEO.bars.r * U}`} />}
      </g>
    </svg>
  )
}
