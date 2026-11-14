// SVG body map: the fallback for the 3D viewer (no WebGL, model missing, context lost). Same selection contract.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../data/vitals'
import { StatusText } from './ui'

const VB_W = 300
const VB_H = 580

// Right half of the body outline; mirrored for the left half.
const HALF_BODY =
  'M149.5,84 L161,84 C161,98 163,102 172,106 C185,110 200,112 208,120 C218,128 221,142 222,158 ' +
  'C224,180 226,196 229,214 C232,232 238,252 242,276 C244,284 247,292 246,304 C245,314 240,320 235,318 ' +
  'C230,316 229,306 229,296 C228,286 227,280 225,274 C220,254 215,236 212,218 C210,204 207,188 204,172 ' +
  'C203,166 201,162 198,160 C197,182 190,202 188,222 C187,238 193,254 197,272 C202,300 202,340 198,376 ' +
  'C196,392 198,404 198,420 C198,450 192,490 187,524 C186,534 190,542 196,550 C200,556 198,560 190,560 ' +
  'L170,560 C166,560 165,554 167,546 C169,536 169,528 168,520 C166,490 168,450 168,424 ' +
  'C168,404 166,392 165,376 C163,340 158,310 152,290 L149.5,288 Z'

// One kidney (the one on the viewer's left); mirrored for the other.
const KIDNEY = 'M138,226 C130,224 125,231 125,239 C125,247 130,253 138,251 C141,250 141,246 139,243 C137,240 137,237 139,234 C141,231 141,227 138,226 Z'

// Tooltip anchor (viewBox coords) for each system.
const ANCHOR: Record<SystemId, { x: number; y: number }> = {
  brain: { x: 150, y: 48 },
  eyes: { x: 150, y: 73 },
  heart: { x: 154, y: 156 },
  lungs: { x: 150, y: 152 },
  metabolism: { x: 150, y: 206 },
  renal: { x: 150, y: 240 },
  immune: { x: 150, y: 100 },
  bones: { x: 150, y: 400 },
  radiation: { x: 150, y: 300 },
}

type PartProps = {
  id: SystemId
  children: ReactNode
  pop?: boolean
  status: Status | null
  hovered: boolean
  selected: boolean
  /** another system is selected: step back so the selection stands out */
  dimmed: boolean
  setHovered: (fn: (h: SystemId | null) => SystemId | null) => void
  onSelect: (id: SystemId) => void
}

function Part({ id, children, pop = true, status, hovered, selected, dimmed, setHovered, onSelect }: PartProps) {
  return (
    <g
      className={`organ ${hovered || selected ? 'is-active' : ''} ${dimmed ? 'is-dimmed' : ''} ${status === 'crit' ? 'is-crit' : ''}`}
      style={{ color: status === null ? 'var(--color-dim)' : status === 'ok' ? 'var(--color-soft)' : STATUS_COLOR[status] }}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${SYSTEM_BY_ID[id].name}: ${status ? STATUS_LABEL[status] : 'Not measured yet'}`}
      data-system={id}
      onPointerEnter={() => setHovered(() => id)}
      onPointerLeave={() => setHovered((h) => (h === id ? null : h))}
      onPointerCancel={() => setHovered((h) => (h === id ? null : h))}
      onFocus={() => setHovered(() => id)}
      onBlur={() => setHovered((h) => (h === id ? null : h))}
      onClick={() => {
        setHovered(() => null)
        onSelect(id)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(id)
        }
      }}
    >
      {pop ? <g className="pop">{children}</g> : children}
    </g>
  )
}

type Props = {
  statuses: Record<SystemId, Status>
  measured?: Record<SystemId, boolean>
  summaries: Record<SystemId, string>
  selected: SystemId | null
  onSelect: (id: SystemId) => void
  heartRate: number
  /** false: the whole-body (radiation) target is not offered */
  showRadiation?: boolean
}

export default function BodyMap({ statuses, measured, summaries, selected, onSelect, heartRate, showRadiation = true }: Props) {
  const shown = (id: SystemId): Status | null => (measured && measured[id] === false ? null : statuses[id])
  const [hovered, setHovered] = useState<SystemId | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  // the whole body is the selection when 'radiation' is selected, so nothing is dimmed then
  const focus = selected && selected !== 'radiation' ? selected : null
  const p = (id: SystemId) => ({
    id,
    status: shown(id),
    hovered: hovered === id,
    selected: selected === id,
    dimmed: focus !== null && focus !== id,
    setHovered,
    onSelect,
  })

  const tip = hovered ? SYSTEM_BY_ID[hovered] : null

  // Place the tooltip next to the hovered part. The drawing is letterboxed inside the box, so map through its real scale.
  useLayoutEffect(() => {
    const el = tipRef.current
    const svg = svgRef.current
    const box = boxRef.current
    if (!el || !svg || !box || !hovered) return
    const sr = svg.getBoundingClientRect()
    const br = box.getBoundingClientRect()
    const scale = Math.min(sr.width / VB_W, sr.height / VB_H)
    const y = sr.top - br.top + (sr.height - VB_H * scale) / 2 + ANCHOR[hovered].y * scale
    const h = el.offsetHeight
    const below = y + 30 + h <= br.height || y - 30 - h < 0
    el.style.top = `${Math.max(4, below ? y + 30 : y - 30 - h)}px`
  }, [hovered])

  const shell = (
    <>
      <ellipse cx="150" cy="290" rx="150" ry="290" fill="url(#aura)" pointerEvents="none" />
      <g className="body-shell">
        <path d={HALF_BODY} fill="url(#skin)" />
        <path d={HALF_BODY} fill="url(#skin)" transform={`translate(${VB_W} 0) scale(-1 1)`} />
        <ellipse cx="150" cy="58" rx="26" ry="32" fill="url(#skin)" />
      </g>
    </>
  )

  return (
    <div ref={boxRef} className="relative mx-auto h-full w-full" data-viewer="svg">
      <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full overflow-visible" role="group" aria-label="Interactive body map">
        <defs>
          <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-soft)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--color-soft)" stopOpacity="0.08" />
          </linearGradient>
          <radialGradient id="aura" cx="0.5" cy="0.45" r="0.6">
            <stop offset="0" stopColor="currentColor" stopOpacity="0.1" />
            <stop offset="1" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
          <clipPath id="bodyClip">
            <path d={HALF_BODY} />
            <path d={HALF_BODY} transform={`translate(${VB_W} 0) scale(-1 1)`} />
            <ellipse cx="150" cy="58" rx="26" ry="32" />
          </clipPath>
        </defs>

        {/* whole body = radiation exposure (only a backdrop where radiation is not tracked) */}
        {showRadiation ? (
          <Part {...p('radiation')} pop={false}>
            {shell}
          </Part>
        ) : (
          <g style={{ color: STATUS_COLOR.ok }} pointerEvents="none">
            {shell}
          </g>
        )}

        {/* anatomy hints (decorative) */}
        <g clipPath="url(#bodyClip)" pointerEvents="none">
          <g fill="none" stroke="var(--color-soft)" strokeOpacity="0.25" strokeWidth="1">
            <path d="M150,104 V284" strokeDasharray="3 4" />
            <path d="M150,112 C136,110 122,112 108,120 M150,112 C164,110 178,112 192,120" />
            <path d="M150,130 C132,132 116,140 108,152 M150,130 C168,132 184,140 192,152" />
            <path d="M150,146 C134,148 120,156 112,168 M150,146 C166,148 180,156 188,168" />
            <path d="M150,162 C136,164 124,172 116,184 M150,162 C164,164 176,172 184,184" />
            <path d="M150,178 C138,180 128,186 120,196 M150,178 C162,180 172,186 180,196" />
            <path d="M112,250 C124,266 138,276 150,280 C162,276 176,266 188,250" />
            <path d="M118,250 C130,244 142,246 150,256 C158,246 170,244 182,250" />
          </g>
        </g>

        {/* bones & muscles: arms and legs */}
        <Part {...p('bones')} pop={false}>
          {[1, -1].map((s) => (
            <g key={s} transform={s === 1 ? undefined : `translate(${VB_W} 0) scale(-1 1)`}>
              <path d="M176,296 L181,366 M182,394 L178,514" stroke="transparent" strokeWidth="30" strokeLinecap="round" fill="none" />
              <path d="M176,296 L181,366" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" fill="none" />
              <circle cx="173" cy="292" r="5.5" fill="currentColor" />
              <circle cx="181.5" cy="380" r="7" fill="currentColor" fillOpacity="0.85" />
              <path d="M183,394 L179,514" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
              <path d="M188,396 L186,508" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" strokeOpacity="0.8" />
              <path d="M207,128 L216,206 M219,222 L236,292" stroke="transparent" strokeWidth="22" strokeLinecap="round" fill="none" />
              <path d="M207,130 L216,204" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" fill="none" />
              <circle cx="217.5" cy="213" r="5" fill="currentColor" fillOpacity="0.85" />
              <path d="M219,222 L235,290" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" fill="none" />
            </g>
          ))}
        </Part>

        {/* immune: lymph nodes */}
        <Part {...p('immune')} pop={false}>
          <path
            d="M141,100 L110,152 M159,100 L190,152 M110,152 L136,268 M190,152 L164,268"
            stroke="currentColor"
            strokeOpacity="0.35"
            strokeWidth="1"
            strokeDasharray="2 4"
            fill="none"
            pointerEvents="none"
          />
          {[
            [141, 100],
            [159, 100],
            [110, 152],
            [190, 152],
            [136, 268],
            [164, 268],
          ].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="11" fill="transparent" />
              <circle cx={x} cy={y} r="4.2" fill="currentColor" />
              <circle cx={x} cy={y} r="7" fill="none" stroke="currentColor" strokeOpacity="0.5" />
            </g>
          ))}
        </Part>

        {/* kidneys, ureters and bladder */}
        <Part {...p('renal')}>
          <circle cx="132" cy="239" r="14" fill="transparent" />
          <circle cx="168" cy="239" r="14" fill="transparent" />
          <path d={KIDNEY} fill="currentColor" fillOpacity="0.85" />
          <path d={KIDNEY} fill="currentColor" fillOpacity="0.85" transform={`translate(${VB_W} 0) scale(-1 1)`} />
          <path d="M140,246 C142,258 145,268 148,274 M160,246 C158,258 155,268 152,274" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          <ellipse cx="150" cy="278" rx="6.5" ry="5.5" fill="currentColor" fillOpacity="0.7" />
        </Part>

        {/* metabolism: stomach / pancreas */}
        <Part {...p('metabolism')}>
          <path d="M138,194 C150,187 167,192 167,204 C167,216 153,223 142,218 C134,214 131,201 138,194 Z" fill="currentColor" fillOpacity="0.85" />
        </Part>

        {/* lungs */}
        <Part {...p('lungs')}>
          <path d="M143,122 C133,122 122,135 120,152 C118,167 120,180 127,182 C136,183 143,175 144,164 Z" fill="currentColor" fillOpacity="0.7" />
          <path d="M157,122 C167,122 178,135 180,152 C182,167 180,180 173,182 C164,183 157,175 156,164 Z" fill="currentColor" fillOpacity="0.7" />
          <path d="M150,108 V126 M150,126 L143,134 M150,126 L157,134" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </Part>

        {/* heart */}
        <Part {...p('heart')}>
          <circle cx="154" cy="156" r="15" fill="transparent" />
          <path
            className="heartbeat"
            style={{ animationDuration: `${(60 / Math.max(30, Math.min(200, heartRate || 60))).toFixed(2)}s` }}
            d="M154,169 C141,159 139,149 145,145 C149,142 153,145 154,149 C155,145 159,142 163,145 C169,149 167,159 154,169 Z"
            fill="currentColor"
            stroke="var(--color-deep)"
            strokeWidth="1.2"
          />
        </Part>

        {/* brain */}
        <Part {...p('brain')}>
          <path
            d="M150,33 C136,31 127,41 129,51 C127,58 134,65 142,63 C146,67 154,67 158,63 C166,65 173,58 171,51 C173,41 164,31 150,33 Z"
            fill="currentColor"
            fillOpacity="0.8"
          />
          <path
            d="M150,35 V64 M138,40 C142,44 142,50 137,54 M162,40 C158,44 158,50 163,54 M133,48 C137,48 140,46 141,43 M167,48 C163,48 160,46 159,43"
            stroke="var(--color-deep)"
            strokeOpacity="0.55"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
          />
        </Part>

        {/* eyes */}
        <Part {...p('eyes')}>
          <rect x="127" y="66" width="46" height="15" rx="7" fill="transparent" />
          <ellipse cx="140" cy="73" rx="6" ry="3.6" fill="currentColor" />
          <ellipse cx="160" cy="73" rx="6" ry="3.6" fill="currentColor" />
          <circle cx="140" cy="73" r="1.7" fill="var(--color-deep)" />
          <circle cx="160" cy="73" r="1.7" fill="var(--color-deep)" />
        </Part>
      </svg>

      {tip && (
        <div ref={tipRef} data-viewer-tip={tip.id} className="pointer-events-none absolute left-1/2 z-20 w-60 max-w-[92%] -translate-x-1/2 rounded-2xl border border-line bg-panel2 p-3 text-left shadow-overlay">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-ink">{tip.name}</span>
            <StatusText status={shown(tip.id)} className="text-xs" />
          </div>
          <div className="mt-1 text-base font-semibold" style={{ color: shown(tip.id) === 'warn' || shown(tip.id) === 'crit' ? STATUS_COLOR[statuses[tip.id]] : undefined }}>
            {summaries[tip.id]}
          </div>
          <p className="mt-1 text-xs leading-snug text-soft">{tip.hint}</p>
        </div>
      )}
    </div>
  )
}
