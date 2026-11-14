import { useState, type ReactNode } from 'react'
import { SYSTEM_BY_ID, type SystemId } from '../data/systems'
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../data/vitals'

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

// Tooltip anchor (viewBox coords) for each system.
const ANCHOR: Record<SystemId, { x: number; y: number }> = {
  brain: { x: 150, y: 48 },
  eyes: { x: 150, y: 73 },
  heart: { x: 154, y: 156 },
  lungs: { x: 150, y: 152 },
  metabolism: { x: 150, y: 206 },
  immune: { x: 150, y: 100 },
  bones: { x: 150, y: 400 },
  radiation: { x: 150, y: 300 },
}

type PartProps = {
  id: SystemId
  children: ReactNode
  pop?: boolean
  status: Status
  active: boolean
  setHovered: (fn: (h: SystemId | null) => SystemId | null) => void
  onSelect: (id: SystemId) => void
}

function Part({ id, children, pop = true, status, active, setHovered, onSelect }: PartProps) {
  return (
    <g
      className={`organ ${active ? 'is-active' : ''} ${status === 'crit' ? 'is-crit' : ''}`}
      style={{ color: STATUS_COLOR[status] }}
      role="button"
      tabIndex={0}
      aria-label={`${SYSTEM_BY_ID[id].name}: ${STATUS_LABEL[status]}`}
      onPointerEnter={() => setHovered(() => id)}
      onPointerLeave={() => setHovered((h) => (h === id ? null : h))}
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
  summaries: Record<SystemId, string>
  selected: SystemId | null
  onSelect: (id: SystemId) => void
  heartRate: number
}

export default function BodyMap({ statuses, summaries, selected, onSelect, heartRate }: Props) {
  const [hovered, setHovered] = useState<SystemId | null>(null)

  const p = (id: SystemId) => ({
    id,
    status: statuses[id],
    active: hovered === id || selected === id,
    setHovered,
    onSelect,
  })

  const tip = hovered ? SYSTEM_BY_ID[hovered] : null
  const tipPos = hovered ? ANCHOR[hovered] : null
  const tipBelow = tipPos ? tipPos.y < VB_H * 0.55 : true

  return (
    <div className="relative mx-auto h-full w-full" style={{ aspectRatio: `${VB_W} / ${VB_H}`, maxHeight: '100%' }}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-full w-full overflow-visible" role="group" aria-label="Interactive body map">
        <defs>
          <linearGradient id="skin" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.42" />
            <stop offset="0.55" stopColor="#38bdf8" stopOpacity="0.22" />
            <stop offset="1" stopColor="#0ea5e9" stopOpacity="0.12" />
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
          <linearGradient id="scan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#7dd3fc" stopOpacity="0" />
            <stop offset="0.5" stopColor="#bae6fd" stopOpacity="0.5" />
            <stop offset="1" stopColor="#7dd3fc" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* platform ring */}
        <ellipse cx="150" cy="562" rx="92" ry="11" fill="none" stroke="#38bdf8" strokeOpacity="0.35" />
        <ellipse cx="150" cy="562" rx="62" ry="7" fill="#38bdf8" fillOpacity="0.08" />

        {/* whole body = radiation exposure */}
        <Part {...p('radiation')} pop={false}>
          <ellipse cx="150" cy="290" rx="150" ry="290" fill="url(#aura)" pointerEvents="none" />
          <g className="body-shell">
            <path d={HALF_BODY} fill="url(#skin)" />
            <path d={HALF_BODY} fill="url(#skin)" transform={`translate(${VB_W} 0) scale(-1 1)`} />
            <ellipse cx="150" cy="58" rx="26" ry="32" fill="url(#skin)" />
          </g>
        </Part>

        {/* anatomy hints + scan sweep (decorative) */}
        <g clipPath="url(#bodyClip)" pointerEvents="none">
          <g fill="none" stroke="#bae6fd" strokeOpacity="0.28" strokeWidth="1">
            <path d="M150,104 V284" strokeDasharray="3 4" />
            <path d="M150,112 C136,110 122,112 108,120 M150,112 C164,110 178,112 192,120" />
            <path d="M150,130 C132,132 116,140 108,152 M150,130 C168,132 184,140 192,152" />
            <path d="M150,146 C134,148 120,156 112,168 M150,146 C166,148 180,156 188,168" />
            <path d="M150,162 C136,164 124,172 116,184 M150,162 C164,164 176,172 184,184" />
            <path d="M150,178 C138,180 128,186 120,196 M150,178 C162,180 172,186 180,196" />
            <path d="M112,250 C124,266 138,276 150,280 C162,276 176,266 188,250" />
            <path d="M118,250 C130,244 142,246 150,256 C158,246 170,244 182,250" />
          </g>
          <rect className="scanline" x="0" y="0" width={VB_W} height="46" fill="url(#scan)" />
        </g>

        {/* bones & muscles */}
        <Part {...p('bones')} pop={false}>
          {[1, -1].map((s) => (
            <g key={s} transform={s === 1 ? undefined : `translate(${VB_W} 0) scale(-1 1)`}>
              <path d="M176,296 L181,366 M182,394 L178,514" stroke="transparent" strokeWidth="30" strokeLinecap="round" fill="none" />
              <path d="M176,296 L181,366" stroke="currentColor" strokeWidth="6.5" strokeLinecap="round" fill="none" />
              <circle cx="173" cy="292" r="5.5" fill="currentColor" />
              <circle cx="181.5" cy="380" r="7" fill="currentColor" fillOpacity="0.85" />
              <path d="M183,394 L179,514" stroke="currentColor" strokeWidth="5" strokeLinecap="round" fill="none" />
              <path d="M188,396 L186,508" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" strokeOpacity="0.8" />
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
            style={{ animationDuration: `${(60 / Math.max(30, Math.min(200, heartRate))).toFixed(2)}s` }}
            d="M154,169 C141,159 139,149 145,145 C149,142 153,145 154,149 C155,145 159,142 163,145 C169,149 167,159 154,169 Z"
            fill="currentColor"
            stroke="#050b16"
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
            stroke="#050b16"
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
          <circle cx="140" cy="73" r="1.7" fill="#050b16" />
          <circle cx="160" cy="73" r="1.7" fill="#050b16" />
        </Part>
      </svg>

      {tip && tipPos && (
        <div
          className="pointer-events-none absolute left-1/2 z-20 w-60 max-w-[92%] -translate-x-1/2 rounded-xl border bg-slate-950/95 p-3 text-left shadow-2xl backdrop-blur"
          style={{
            top: `${(tipPos.y / VB_H) * 100}%`,
            transform: `translate(-50%, ${tipBelow ? '34px' : 'calc(-100% - 34px)'})`,
            borderColor: STATUS_COLOR[statuses[tip.id]],
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-white">
              {tip.icon} {tip.name}
            </span>
            <span className="text-[10px] font-bold tracking-widest" style={{ color: STATUS_COLOR[statuses[tip.id]] }}>
              {STATUS_LABEL[statuses[tip.id]]}
            </span>
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums" style={{ color: STATUS_COLOR[statuses[tip.id]] }}>
            {summaries[tip.id]}
          </div>
          <p className="mt-1 text-xs leading-snug text-slate-300">{tip.hint}</p>
          <p className="mt-1.5 text-[10px] uppercase tracking-wider text-sky-300/80">Tap for details</p>
        </div>
      )}
    </div>
  )
}
