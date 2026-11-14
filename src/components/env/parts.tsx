import { CircleCheck, Clock, Database, FlaskConical, Radio, Siren, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Level } from '../../lib/envStation'
import type { SourceMode } from './useEnvStation'

/** Status styling: colour always comes with an icon and a text label. */
export const LEVEL: Record<Level, { text: string; soft: string; bar: string; border: string; Icon: LucideIcon }> = {
  ok: { text: 'text-ok', soft: 'bg-ok/12', bar: 'bg-ok', border: 'border-ok', Icon: CircleCheck },
  warn: { text: 'text-warn', soft: 'bg-warn/12', bar: 'bg-warn', border: 'border-warn', Icon: TriangleAlert },
  crit: { text: 'text-crit', soft: 'bg-crit/15', bar: 'bg-crit', border: 'border-crit', Icon: Siren },
  none: { text: 'text-dim', soft: 'bg-line/60', bar: 'bg-line', border: 'border-line', Icon: Clock },
}

export function LevelChip({ level, label }: { level: Level; label: string }) {
  const s = LEVEL[level]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold tracking-wider ${s.text} ${s.soft}`}>
      <s.Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  )
}

const SOURCE: Record<SourceMode, { label: string; Icon: LucideIcon; cls: string }> = {
  live: { label: 'LIVE SENSOR', Icon: Radio, cls: 'border-cyan/60 text-ice' },
  sim: { label: 'SIMULATED', Icon: FlaskConical, cls: 'border-dashed border-ink/70 text-ink' },
  stored: { label: 'STORED', Icon: Database, cls: 'border-line text-soft' },
  none: { label: 'NO DATA', Icon: Clock, cls: 'border-line text-dim' },
}

/** Where the numbers come from. `suffix` adds e.g. "NO SIGNAL" or "25 s ago". */
export function SourceBadge({ mode, suffix, pulse = false, small = false }: { mode: SourceMode; suffix?: string; pulse?: boolean; small?: boolean }) {
  const s = SOURCE[mode]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border font-bold tracking-wider ${s.cls} ${small ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs'}`}
    >
      {pulse ? <span className="live-dot h-2 w-2 rounded-full bg-cyan" aria-hidden="true" /> : <s.Icon className={small ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden="true" />}
      {s.label}
      {suffix && <span className="font-semibold opacity-80">· {suffix}</span>}
    </span>
  )
}

export function ageText(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1500) return 'just now'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export const clockTime = (ms: number, seconds = true) =>
  new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) })

export const fmt = (v: number | null | undefined, digits: number) => (typeof v === 'number' ? v.toFixed(digits) : '—')

/** Reads a theme colour token (so charts follow the design system), with a fallback for SSR/tests. */
export function themeColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return v || fallback
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-ice underline decoration-ice/40 underline-offset-2 hover:decoration-ice">
      {children}
    </a>
  )
}
