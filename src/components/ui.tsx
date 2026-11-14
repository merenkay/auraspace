import { animate, motion, useInView, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts'
import { STATUS_COLOR, STATUS_LABEL, type Status } from '../data/vitals'

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
      <circle cx="18" cy="18" r="16" fill="none" stroke="#53D7FF" strokeWidth="2" />
      <motion.path
        d="M6 19h6l3-7 4 13 3-8 2 2h6"
        fill="none"
        stroke="#A5E9FF"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: 'easeInOut', repeat: Infinity, repeatDelay: 2.4 }}
      />
    </svg>
  )
}

/** Fades and slides children in when they scroll into view. */
export function Reveal({ children, delay = 0, y = 24, className = '' }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

export function Panel({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return (
    <section className={`glass rounded-3xl p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="label">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function StatusPill({ status, small = false }: { status: Status; small?: boolean }) {
  const c = STATUS_COLOR[status]
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-bold tracking-wider ${small ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}`}
      style={{ color: c, background: `${c}1f` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Animated number that counts up when it first becomes visible. */
export function CountUp({ value, decimals = 0, className = '' }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => v.toFixed(decimals))
  const [shown, setShown] = useState('0')
  useEffect(() => text.on('change', setShown), [text])
  useEffect(() => {
    if (!inView) return
    const c = animate(mv, value, { duration: 1.1, ease: 'easeOut' })
    return () => c.stop()
  }, [inView, value, mv])
  return (
    <span ref={ref} className={className}>
      {shown}
    </span>
  )
}

export function ScoreRing({ score, status, size = 168 }: { score: number; status: Status; size?: number }) {
  const r = size / 2 - 12
  const c = 2 * Math.PI * r
  const color = STATUS_COLOR[status]
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Health score ${score} of 100, ${STATUS_LABEL[status]}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1E3A55" strokeWidth="12" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c * (1 - score / 100) }}
          viewport={{ once: true }}
          transition={{ duration: 1.3, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 10px ${color}66)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span style={{ fontSize: size * 0.27 }} className="font-display font-bold leading-none"><CountUp value={score} /></span>
        <span className="mt-1 text-xs text-dim">/ 100</span>
      </div>
    </div>
  )
}

export function Sparkline({ data, color, height = 44 }: { data: { day: number; value: number }[]; color: string; height?: number }) {
  const id = useId().replace(/:/g, '')
  if (data.length < 2) return <div style={{ height }} className="text-xs text-dim">Not enough data</div>
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.45} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#g${id})`} animationDuration={1200} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 text-sm text-dim">
      <motion.span
        className="h-4 w-4 rounded-full border-2 border-cyan border-t-transparent"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.9, ease: 'linear' }}
      />
      {label}…
    </div>
  )
}
