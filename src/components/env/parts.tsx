import { Database, FlaskConical, Radio, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Level } from '../../lib/envStation'
import { Badge, LiveDot, StatusPill, type StatusOrNone } from '../ui'
import type { SourceMode } from './useEnvStation'

/** Sensor level to health status. `none` (no reading, warming up, error) is "no data", never "normal". */
export const LEVEL_STATUS: Record<Level, StatusOrNone> = { ok: 'ok', warn: 'warn', crit: 'crit', none: null }

/** "GAS ALARM" -> "Gas alarm". The rule layer writes upper case; the interface is sentence case. */
export function sentence(text: string): string {
  const t = text.trim().toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Status as icon + word + colour. Levels without a reading use the dashed "no data" shape. */
export function LevelChip({ level, label, small = false }: { level: Level; label: string; small?: boolean }) {
  return <StatusPill status={LEVEL_STATUS[level]} label={sentence(label)} small={small} />
}

const SOURCE: Record<SourceMode, { label: string; Icon: LucideIcon; tone: 'accent' | 'neutral' }> = {
  live: { label: 'Live sensor', Icon: Radio, tone: 'accent' },
  sim: { label: 'Simulated', Icon: FlaskConical, tone: 'neutral' },
  stored: { label: 'Stored', Icon: Database, tone: 'neutral' },
  none: { label: 'No data', Icon: Database, tone: 'neutral' },
}

/** Where the numbers come from. `suffix` adds e.g. "No signal" or "25 s ago". A pulsing dot only while data really streams. */
export function SourceBadge({ mode, suffix, pulse = false }: { mode: SourceMode; suffix?: string; pulse?: boolean; small?: boolean }) {
  const s = SOURCE[mode]
  const text = suffix ? `${s.label} · ${sentence(suffix)}` : s.label
  if (pulse) return <LiveDot label={text} />
  return (
    <Badge tone={s.tone} icon={s.Icon} className={mode === 'sim' ? 'border-dashed border-soft text-ink' : undefined}>
      {text}
    </Badge>
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

// toLocaleTimeString with options builds a new Intl formatter on every call; the live charts call this for every
// axis tick of every chart once a second, so the two formatters are made once and reused (same output).
let clockFmt: [Intl.DateTimeFormat, Intl.DateTimeFormat] | null = null
export const clockTime = (ms: number, seconds = true) => {
  clockFmt ??= [
    new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }),
    new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  ]
  return clockFmt[seconds ? 1 : 0].format(ms)
}

export const fmt = (v: number | null | undefined, digits: number) => (typeof v === 'number' ? v.toFixed(digits) : '—')

/** Reads a theme colour token (so charts follow the design system), with a fallback for SSR/tests. */
export function themeColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  return v || fallback
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="link">
      {children}
    </a>
  )
}
