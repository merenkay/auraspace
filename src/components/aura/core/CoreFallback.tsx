// The AURA core as a flat line drawing: shown while the 3D engine loads, and for good when WebGL is missing or
// its context is lost. It draws the same poses from the same table as the WebGL scene (src/.../core/model.ts),
// so a state reads the same either way. Pure SVG; colours come from the app's CSS variables.
import { useMemo } from 'react'
import { geodesic, polygon, projectLattice } from './geometry'
import { OCTAGON_RADIUS, POSES, TICK_RADIUS, type CoreState, type RingPose, type Tone } from './model'

const U = 100 // SVG units per scene unit
const TONE: Record<Tone, string> = { accent: 'var(--color-accent)', edge: 'var(--color-edge)', dim: 'var(--color-dim)', soft: 'var(--color-soft)', ink: 'var(--color-ink)', crit: 'var(--color-crit)' }
const LATTICE = geodesic(2)
const TICK_LENGTH = 2 * Math.PI * TICK_RADIUS * U

/** A ring seen from the front: an ellipse (rx along the tilt axis). Motion is left out: the fallback is a still. */
function ellipse(r: RingPose) {
  const flat = Math.abs(Math.cos(r.tilt))
  const upright = r.motion === 'gimbalY'
  return { rx: r.radius * U * (upright ? flat : 1), ry: r.radius * U * (upright ? 1 : flat), rot: (-r.roll * 180) / Math.PI }
}

export default function CoreFallback({ state, compact }: { state: CoreState; compact: boolean }) {
  const pose = POSES[state]
  const lattice = useMemo(() => projectLattice(LATTICE, 0.5, 0.42, U), [])
  const sw = compact ? 4 : 1 // the compact strip is drawn at about a quarter of the size
  const nucleus = TONE[pose.nucleus.tone]
  const octagon = polygon(8, OCTAGON_RADIUS * U)
  return (
    <svg className="aura-core__flat" viewBox="-170 -170 340 340" fill="none" aria-hidden="true" focusable="false" data-flat={state}>
      <circle r={TICK_RADIUS * U + 3} stroke={TONE.edge} strokeWidth={compact ? 9 : 6} strokeDasharray={`${compact ? 3 : 1.2} ${TICK_LENGTH / (compact ? 24 : 72) - (compact ? 3 : 1.2)}`} opacity={state === 'off' ? 0.6 : 0.95} />
      {!compact && (
        <g transform={`scale(${pose.shell.radius})`}>
          {pose.shell.edges > 0 && <path d={lattice.back} stroke={TONE.dim} strokeWidth={1 / pose.shell.radius} opacity={pose.shell.edges * 0.3} />}
          {pose.shell.edges > 0 && <path d={lattice.front} stroke={TONE.dim} strokeWidth={1 / pose.shell.radius} opacity={pose.shell.edges} />}
          <path d={lattice.dotsBack} stroke={TONE[pose.shell.tone]} strokeWidth={3} strokeLinecap="round" opacity={pose.shell.points * 0.35} />
          <path d={lattice.dotsFront} stroke={TONE[pose.shell.tone]} strokeWidth={3.6} strokeLinecap="round" opacity={pose.shell.points} />
        </g>
      )}
      {pose.rings.map((r, i) => {
        const e = ellipse(r)
        if (r.opacity <= 0) return null
        return <ellipse key={i} rx={e.rx} ry={Math.max(e.ry, 0.5)} transform={`rotate(${e.rot})`} stroke={TONE[r.tone]} strokeWidth={r.width * sw} opacity={r.opacity} strokeDasharray={r.dashed ? '5 7' : undefined} />
      })}
      {pose.arc > 0 && (
        <g className="aura-core__flat-arc">
          <path d={`M0 ${-pose.rings[2].radius * U}A${pose.rings[2].radius * U} ${pose.rings[2].radius * U} 0 0 1 ${pose.rings[2].radius * U} 0`} stroke={TONE.accent} strokeWidth={3 * sw} strokeLinecap="round" />
        </g>
      )}
      {pose.octagon > 0 && <path d={`M${octagon.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`} stroke={TONE.crit} strokeWidth={2.5 * sw} strokeLinejoin="miter" />}
      <g className={state === 'idle' ? 'aura-core__flat-nucleus' : undefined}>
        <circle r={pose.nucleus.radius * U} fill="var(--color-space)" />
        <circle r={pose.nucleus.radius * U} fill={nucleus} fillOpacity={pose.nucleus.fill} stroke={nucleus} strokeWidth={1.5 * sw} strokeDasharray={state === 'off' ? '5 7' : undefined} />
        {pose.nucleus.dot > 0 && <circle r={pose.nucleus.dot * U} fill={nucleus} />}
      </g>
    </svg>
  )
}
