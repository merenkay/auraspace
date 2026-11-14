// AURA shared primitives — "Quiet Cockpit". Usage rules and snippets: docs/DESIGN.md.
// Pages compose these instead of hand-rolling buttons, cards, motion or status colours.
import {
  ArrowUpRight,
  Bone,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Droplet,
  Droplets,
  Dumbbell,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  GlassWater,
  Heart,
  HeartPulse,
  House,
  Info,
  LoaderCircle,
  Moon,
  OctagonAlert,
  Radiation,
  Rocket,
  ShieldPlus,
  Smile,
  Snowflake,
  Thermometer,
  TriangleAlert,
  Wind,
  X,
  type LucideIcon,
} from 'lucide-react'
import { AnimatePresence, MotionConfig, animate, motion, useReducedMotion, type Variants } from 'motion/react'
import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'
import type { SystemId } from '../data/systems'
import { STATUS_COLOR, type Status, type VitalKey } from '../data/vitals'

/* ================================================================== */
/* Foundations                                                         */
/* ================================================================== */

/** Join class names, skipping falsy parts. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

/** Motion durations in seconds. `instant` press feedback · `fast` hover/small state · `base` enter/route · `slow` sheets/number tweens · `draw` charts and rings. */
export const DUR = { instant: 0.09, fast: 0.16, base: 0.24, slow: 0.4, draw: 0.7 } as const

/** Easing curves. `out` for anything entering or responding, `in` for anything leaving, `inOut` for moves between two on-screen places. */
export const EASE = {
  out: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
  in: [0.4, 0, 1, 1] as [number, number, number, number],
  inOut: [0.6, 0, 0.2, 1] as [number, number, number, number],
}

/** Springs: `snappy` for indicators that follow a tap (tab underline, segmented thumb), `soft` for sheets and dialogs. Neither overshoots visibly. */
export const SPRING = {
  snappy: { type: 'spring', stiffness: 520, damping: 40, mass: 0.9 },
  soft: { type: 'spring', stiffness: 320, damping: 34 },
} as const

/** Wrap an app root once: honours the OS "reduce motion" setting for every motion component below it. */
export function MotionRoot({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: DUR.base, ease: EASE.out }}>
      {children}
    </MotionConfig>
  )
}

/** True while a CSS media query matches, e.g. useMedia('(min-width: 768px)'). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** Sets the contextual accent (space · polar · home) for the whole document, including portalled overlays. */
export function useContextAccent(context: 'space' | 'polar' | 'home' | null | undefined) {
  useEffect(() => {
    const root = document.documentElement
    if (context && context !== 'space') root.dataset.context = context
    else delete root.dataset.context
  }, [context])
}

/** Counts up by one each time `value` changes after the first render. Used to replay one-shot "this changed" cues. */
function useChangeTick<T>(value: T): number {
  const [tick, setTick] = useState(0)
  const prev = useRef(value)
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value
      setTick((t) => t + 1)
    }
  }, [value])
  return tick
}

/* ================================================================== */
/* Brand                                                               */
/* ================================================================== */

/** The AURA mark: an open ring with one reading on it. Draws once; never loops. */
export function Logo({ size = 28, wordmark = false, className = '' }: { size?: number; wordmark?: boolean; className?: string }) {
  const mark = (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <motion.circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        transform="rotate(-16 12 12)"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 0.84 }}
        transition={{ duration: DUR.draw, ease: EASE.out }}
      />
      <motion.circle cx="18.36" cy="5.64" r="2.2" fill="var(--color-accent)" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: DUR.draw - 0.15, duration: DUR.base, ease: EASE.out }} />
    </svg>
  )
  if (!wordmark) return <span className={cx('inline-flex text-ink', className)}>{mark}</span>
  return (
    <span className={cx('inline-flex items-center gap-2.5 text-ink', className)}>
      {mark}
      <span className="text-[17px] font-semibold leading-none tracking-[0.06em]">AURA</span>
    </span>
  )
}

/* ================================================================== */
/* Motion primitives                                                   */
/* ================================================================== */

const pageVariants: Variants = {
  enter: (d: number) => ({ opacity: 0, x: d * 16, y: d === 0 ? 8 : 0 }),
  center: { opacity: 1, x: 0, y: 0, transition: { duration: DUR.base, ease: EASE.out } },
  exit: { opacity: 0, transition: { duration: DUR.instant, ease: EASE.in } },
}

/**
 * Route / step change. The old view fades out fast and stays put; the new one settles in from the
 * side it lives on (`direction` 1 = further along, -1 = back, 0 = unrelated: rises 8 px).
 */
export function PageTransition({ routeKey, direction = 0, children, className }: { routeKey: string; direction?: -1 | 0 | 1; children: ReactNode; className?: string }) {
  return (
    <AnimatePresence mode="wait" custom={direction} initial={false}>
      <motion.div key={routeKey} custom={direction} variants={pageVariants} initial="enter" animate="center" exit="exit" className={className}>
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

/** Fades and lifts one block into place the first time it scrolls into view. */
export function Reveal({ children, delay = 0, y = 8, className = '' }: { children: ReactNode; delay?: number; y?: number; className?: string }) {
  return (
    <motion.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-24px' }} transition={{ duration: DUR.base, delay, ease: EASE.out }}>
      {children}
    </motion.div>
  )
}

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.base, ease: EASE.out } },
}

/** A list or grid whose children (`StaggerItem`) enter one after another, 40 ms apart, once. Never use it for urgent alerts. */
export function Stagger({ children, className, step = 0.04, delay = 0, as = 'div' }: { children: ReactNode; className?: string; step?: number; delay?: number; as?: 'div' | 'ul' | 'ol' | 'section' }) {
  const Comp = motion[as] as typeof motion.div
  return (
    <Comp className={className} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-24px' }} variants={{ hidden: {}, show: { transition: { staggerChildren: step, delayChildren: delay } } }}>
      {children}
    </Comp>
  )
}

export function StaggerItem({ children, className, as = 'div' }: { children: ReactNode; className?: string; as?: 'div' | 'li' | 'section' }) {
  const Comp = motion[as] as typeof motion.div
  return (
    <Comp className={className} variants={staggerItem}>
      {children}
    </Comp>
  )
}

/**
 * A number that shows the real value immediately and tweens only when the value CHANGES.
 * It never counts up from zero: a measurement must not be shown as something it is not.
 */
export function AnimatedNumber({ value, decimals = 0, className = '', format }: { value: number; decimals?: number; className?: string; format?: (v: number) => string }) {
  const fmt = (v: number) => (format ? format(v) : v.toFixed(decimals))
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const reduce = useReducedMotion()
  useEffect(() => {
    const start = from.current
    from.current = value
    if (start === value || reduce || !Number.isFinite(start) || !Number.isFinite(value)) {
      setShown(value)
      return
    }
    const controls = animate(start, value, { duration: DUR.slow, ease: EASE.out, onUpdate: setShown })
    return () => controls.stop()
  }, [value, reduce])
  return (
    <span className={className}>
      <span aria-hidden="true">{fmt(shown)}</span>
      <span className="sr-only">{fmt(value)}</span>
    </span>
  )
}

/** @deprecated Old name. Same component as AnimatedNumber (no longer counts from zero). */
export const CountUp = AnimatedNumber

/* ================================================================== */
/* Buttons                                                             */
/* ================================================================== */

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

const BTN_BASE =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors active:translate-y-px disabled:pointer-events-none aria-disabled:pointer-events-none'
const BTN_VARIANT: Record<ButtonVariant, string> = {
  // A disabled primary button turns into a plain grey plate: obviously inactive, never a dimmed white slab.
  primary: 'bg-ink text-space hover:bg-white disabled:bg-panel2 disabled:text-dim aria-disabled:bg-panel2 aria-disabled:text-dim',
  secondary: 'border border-edge text-ink hover:border-soft hover:bg-panel2 disabled:opacity-45 aria-disabled:opacity-45',
  quiet: 'text-soft hover:bg-panel2 hover:text-ink disabled:opacity-45 aria-disabled:opacity-45',
  danger: 'border border-crit/60 text-crit hover:bg-crit/10 disabled:opacity-45 aria-disabled:opacity-45',
}
// `sm` is 36 px tall on screen but keeps a 44 px touch target through the ::after hit area.
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']",
  md: 'h-11 px-4 text-[15px]',
  lg: 'h-12 px-5 text-base',
}

type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner, sets aria-busy and blocks clicks. Keep the label unchanged so the width does not jump. */
  loading?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  /** Stretch to the container width. */
  full?: boolean
  /** Render as a router link. */
  to?: string
  /** Render as an external link (opens in a new tab). */
  href?: string
  children?: ReactNode
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>

export function Button({ variant = 'secondary', size = 'md', loading = false, icon: Icon, iconRight: IconRight, full = false, to, href, children, className, disabled, type = 'button', ...rest }: ButtonProps) {
  const cls = cx(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], full && 'w-full', className)
  const inner = (
    <>
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {children}
      {IconRight && <IconRight className="h-4 w-4" aria-hidden="true" />}
    </>
  )
  if (to)
    return (
      <Link to={to} className={cls} aria-disabled={disabled || undefined}>
        {inner}
      </Link>
    )
  if (href)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {inner}
      </a>
    )
  return (
    <button type={type} className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {inner}
    </button>
  )
}

/** A square button that shows only an icon. `label` is required: it becomes the accessible name and the hover title. */
export function IconButton({ icon: Icon, label, variant = 'quiet', size = 'md', className, type = 'button', ...rest }: { icon: LucideIcon; label: string; variant?: 'quiet' | 'secondary'; size?: 'sm' | 'md'; className?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(BTN_BASE, BTN_VARIANT[variant], size === 'sm' ? "h-9 w-9 after:absolute after:-inset-1 after:content-['']" : 'h-11 w-11', className)}
      {...rest}
    >
      <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'} aria-hidden="true" />
    </button>
  )
}

/* ================================================================== */
/* Forms                                                               */
/* ================================================================== */

const FieldCtx = createContext<{ id: string; describedBy?: string; invalid: boolean } | null>(null)

/** Shared look of text controls. Use <Input>/<Select>/<Textarea>; reach for this string only for exotic controls. */
export const controlCls =
  'w-full rounded-lg border border-edge bg-deep px-3.5 text-base text-ink transition-colors placeholder:text-dim hover:border-soft focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-crit'

/** Label + control + hint or error, wired together for screen readers. Put exactly one control inside. */
export function Field({ label, hint, error, optional = false, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; optional?: boolean; children: ReactNode; className?: string }) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-soft">
        {label}
        {optional && <span className="font-normal text-dim"> (optional)</span>}
      </label>
      <FieldCtx.Provider value={{ id, describedBy, invalid: Boolean(error) }}>{children}</FieldCtx.Provider>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-sm text-crit">
          <OctagonAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-dim">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, trailing, ...rest }: InputHTMLAttributes<HTMLInputElement> & { trailing?: ReactNode }) {
  const f = useContext(FieldCtx)
  const el = <input id={f?.id} aria-describedby={f?.describedBy} aria-invalid={f?.invalid || undefined} {...rest} className={cx(controlCls, 'h-11', trailing ? 'pr-12' : '', className)} />
  if (!trailing) return el
  return (
    <div className="relative">
      {el}
      <div className="absolute inset-y-0 right-0 flex items-center pr-1">{trailing}</div>
    </div>
  )
}

/** Password field with a show/hide switch. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false)
  return <Input {...props} type={show ? 'text' : 'password'} trailing={<IconButton icon={show ? EyeOff : Eye} label={show ? 'Hide password' : 'Show password'} size="sm" onClick={() => setShow((s) => !s)} />} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const f = useContext(FieldCtx)
  return (
    <div className="relative">
      <select id={f?.id} aria-describedby={f?.describedBy} aria-invalid={f?.invalid || undefined} {...rest} className={cx(controlCls, 'h-11 appearance-none pr-10', className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dim" aria-hidden="true" />
    </div>
  )
}

export function Textarea({ className, rows = 3, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const f = useContext(FieldCtx)
  return <textarea id={f?.id} aria-describedby={f?.describedBy} aria-invalid={f?.invalid || undefined} rows={rows} {...rest} className={cx(controlCls, 'py-2.5 leading-normal', className)} />
}

export function Checkbox({ label, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & { label: ReactNode; className?: string }) {
  return (
    <label className={cx('flex min-h-11 cursor-pointer items-start gap-3 py-2 text-sm text-soft', className)}>
      <span className="relative mt-0.5 flex h-5 w-5 shrink-0">
        <input type="checkbox" {...rest} className="peer h-5 w-5 cursor-pointer appearance-none rounded-[5px] border border-edge bg-deep transition-colors checked:border-ink checked:bg-ink hover:border-soft" />
        <Check className="pointer-events-none absolute inset-0 m-auto h-3.5 w-3.5 text-space opacity-0 transition-opacity peer-checked:opacity-100" strokeWidth={3} aria-hidden="true" />
      </span>
      <span>{label}</span>
    </label>
  )
}

/* ================================================================== */
/* Layout: page header, sections, surfaces, rows                       */
/* ================================================================== */

/** The top of every page: one title, optional line above/below it, status and actions on the right. */
export function PageHeader({ title, eyebrow, description, status, actions, className }: { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; status?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <header className={cx('mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-sm text-dim">{eyebrow}</p>}
        <h1 className="text-title text-ink">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-soft">{description}</p>}
      </div>
      {(status || actions) && (
        <div className="flex flex-wrap items-center gap-3">
          {status}
          {actions}
        </div>
      )}
    </header>
  )
}

/** An unboxed group: heading, hairline, content. The default way to group things — reach for Card only for discrete objects. */
export function Section({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-3">
        <div className="min-w-0">
          <h2 className="text-heading text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-dim">{description}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  )
}

const CARD_TONE = {
  surface: 'border border-line bg-panel',
  raised: 'border border-line bg-panel2',
  well: 'border border-line bg-deep',
  plain: '',
} as const
const CARD_PAD = { none: '', sm: 'p-4', md: 'p-4 sm:p-5' } as const

/** A flat surface with a hairline. No shadow, blur or gradient. Never nest a Card in a Card. */
export function Card({ children, className, tone = 'surface', pad = 'md', as: Tag = 'div' }: { children: ReactNode; className?: string; tone?: keyof typeof CARD_TONE; pad?: keyof typeof CARD_PAD; as?: 'div' | 'section' | 'article' | 'li' }) {
  return <Tag className={cx('rounded-2xl', CARD_TONE[tone], CARD_PAD[pad], className)}>{children}</Tag>
}

/** A Card with a title row. Kept for existing pages; new code can use Card or Section directly. */
export function Panel({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: string; action?: ReactNode }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-panel p-4 sm:p-5', className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-[15px] font-semibold leading-snug text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** Rows separated by hairlines. Use for anything list-like instead of a stack of cards. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx('divide-y divide-line border-y border-line', className)}>{children}</ul>
}

type RowProps = {
  title: ReactNode
  description?: ReactNode
  /** Icon, avatar or status icon on the left. */
  leading?: ReactNode
  /** Value, badge or time on the right. */
  trailing?: ReactNode
  /** Makes the whole row a router link (adds a chevron). */
  to?: string
  onClick?: () => void
  selected?: boolean
  disabled?: boolean
  className?: string
}

export function Row({ title, description, leading, trailing, to, onClick, selected = false, disabled = false, className }: RowProps) {
  const interactive = Boolean(to || onClick)
  const cls = cx('flex min-h-14 w-full items-center gap-3 px-2 py-2.5 text-left', interactive && 'transition-colors hover:bg-panel2', selected && 'bg-panel2', disabled && 'pointer-events-none opacity-45', className)
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center text-dim">{leading}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug text-ink">{title}</span>
        {description && <span className="mt-0.5 block text-sm leading-snug text-dim">{description}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-sm text-soft">{trailing}</span>}
      {to && <ChevronRight className="h-4 w-4 shrink-0 text-dim" aria-hidden="true" />}
    </>
  )
  return (
    <li>
      {to ? (
        <Link to={to} className={cls}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} disabled={disabled} aria-pressed={selected || undefined} className={cls}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  )
}

/** Initials in a neutral disc. People are told apart by name, never by a personal colour (colour is reserved for status). */
export function Avatar({ name, text, size = 36, className }: { name: string; text?: string; size?: number; className?: string }) {
  const initials =
    text ??
    name
      .split(/\s+/)
      .filter((p) => /^[A-Za-zÀ-ÿ]/.test(p) && !p.endsWith('.'))
      .map((p) => p[0])
      .slice(0, 2)
      .join('')
      .toUpperCase()
  return (
    <span aria-hidden="true" style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * (initials.length > 2 ? 0.3 : 0.36))) }} className={cx('inline-flex shrink-0 items-center justify-center rounded-full border border-line bg-panel2 font-mono font-medium leading-none text-soft', className)}>
      {initials}
    </span>
  )
}

/* ================================================================== */
/* Status                                                              */
/* ================================================================== */

/** A health status, or `null` when there is no reading. Missing data is its own state — it is never shown as Normal. */
export type StatusOrNone = Status | null

type StatusKey = Status | 'none'
const STATUS_ICON: Record<StatusKey, LucideIcon> = { ok: CircleCheck, warn: TriangleAlert, crit: OctagonAlert, none: CircleDashed }
const STATUS_TEXT: Record<StatusKey, string> = { ok: 'Normal', warn: 'Attention', crit: 'Urgent', none: 'No data' }
const STATUS_TEXT_CLS: Record<StatusKey, string> = { ok: 'text-ok', warn: 'text-warn', crit: 'text-crit', none: 'text-dim' }

/** Sentence-case status word: Normal · Attention · Urgent · No data. */
export function statusLabel(status: StatusOrNone): string {
  return STATUS_TEXT[status ?? 'none']
}

/** The status glyph. Each status has its own SHAPE (circle-check · triangle · octagon · dashed circle), so it reads without colour. Pings once when the status changes. */
export function StatusIcon({ status, size = 16, className }: { status: StatusOrNone; size?: number; className?: string }) {
  const key = status ?? 'none'
  const Icon = STATUS_ICON[key]
  const tick = useChangeTick(key)
  return (
    <span className={cx('relative inline-flex shrink-0', STATUS_TEXT_CLS[key], className)} style={{ width: size, height: size }}>
      {tick > 0 && <span key={tick} className="absolute inset-0 animate-status-ping rounded-full border-2 border-current" aria-hidden="true" />}
      <Icon width={size} height={size} aria-hidden="true" />
    </span>
  )
}

/** Inline status: icon + word (+ optional detail). The quiet default next to a number. */
export function StatusText({ status, children, className }: { status: StatusOrNone; children?: ReactNode; className?: string }) {
  const key = status ?? 'none'
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-sm', className)}>
      <StatusIcon status={status} size={15} />
      <span className={cx('font-medium', key === 'ok' ? 'text-soft' : STATUS_TEXT_CLS[key])}>{STATUS_TEXT[key]}</span>
      {children && <span className="text-dim">· {children}</span>}
    </span>
  )
}

const PILL_TONE: Record<StatusKey, string> = {
  ok: 'border-line text-soft',
  warn: 'border-warn/30 bg-warn/10 text-warn',
  crit: 'border-crit/40 bg-crit/10 text-crit',
  none: 'border-dashed border-edge text-dim',
}

/**
 * Boxed status: icon + word. "Normal" stays quiet (hairline, neutral text); Attention and Urgent get a tint;
 * `status={null}` renders "No data". `announce` makes screen readers speak the change (use it once per page, on the overall status).
 */
export function StatusPill({ status, small = false, label, announce = false, className }: { status: StatusOrNone; small?: boolean; label?: string; announce?: boolean; className?: string }) {
  const key = status ?? 'none'
  return (
    <span role={announce ? 'status' : undefined} className={cx('inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border font-medium', small ? 'h-6 px-2 text-xs' : 'h-7 px-2.5 text-[13px]', PILL_TONE[key], className)}>
      <StatusIcon status={status} size={small ? 13 : 15} />
      {label ?? STATUS_TEXT[key]}
    </span>
  )
}

/* Shared icon vocabulary, so every page draws the same thing the same way. */
export const CONTEXT_ICON: Record<'space' | 'polar' | 'home', LucideIcon> = { space: Rocket, polar: Snowflake, home: House }
export const VITAL_ICON: Record<VitalKey, LucideIcon> = { bp: Gauge, hr: HeartPulse, spo2: Wind, temp: Thermometer, glucose: Droplet, sleep: Moon, mood: Smile, exercise: Dumbbell, vision: Eye, water: GlassWater }
export const SYSTEM_ICON: Record<SystemId, LucideIcon> = { brain: Brain, eyes: Eye, heart: Heart, lungs: Wind, metabolism: Flame, immune: ShieldPlus, bones: Bone, renal: Droplets, radiation: Radiation }

type Tone = 'neutral' | 'accent' | Status
const BADGE_TONE: Record<Tone, string> = {
  neutral: 'border-line text-soft',
  accent: 'border-accent/40 text-accent',
  ok: 'border-ok/40 text-ok',
  warn: 'border-warn/40 text-warn',
  crit: 'border-crit/50 text-crit',
}

/** Small metadata tag (source, "Simulated", counts). Mono, sentence case. For health status use StatusPill. */
export function Badge({ children, tone = 'neutral', icon: Icon, className }: { children: ReactNode; tone?: Tone; icon?: LucideIcon; className?: string }) {
  return (
    <span className={cx('inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 font-mono text-xs', BADGE_TONE[tone], className)}>
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  )
}

/** "This is streaming now". The only thing in the product allowed to pulse continuously. */
export function LiveDot({ label = 'Live', className }: { label?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 font-mono text-xs text-accent', className)}>
      <span className="h-1.5 w-1.5 animate-live rounded-full bg-accent" aria-hidden="true" />
      {label}
    </span>
  )
}

const NOTICE_TONE = {
  info: { box: 'border-line bg-panel', icon: 'text-dim', Icon: Info },
  ok: { box: 'border-ok/30 bg-ok/10', icon: 'text-ok', Icon: CircleCheck },
  warn: { box: 'border-warn/30 bg-warn/10', icon: 'text-warn', Icon: TriangleAlert },
  crit: { box: 'border-crit/40 bg-crit/10', icon: 'text-crit', Icon: OctagonAlert },
} as const

/** A message that needs reading: alerts, demo-mode notes, errors. Appears instantly — alerts are never delayed by animation. */
export function Notice({ tone = 'info', title, children, action, role, className }: { tone?: 'info' | Status; title?: ReactNode; children?: ReactNode; action?: ReactNode; role?: 'alert' | 'status'; className?: string }) {
  const t = NOTICE_TONE[tone]
  return (
    <div role={role} className={cx('flex items-start gap-3 rounded-xl border p-3.5', t.box, className)}>
      <t.Icon className={cx('mt-0.5 h-[18px] w-[18px] shrink-0', t.icon)} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-soft">
        {title && <p className="text-[15px] font-semibold leading-snug text-ink">{title}</p>}
        {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ================================================================== */
/* Numbers and data display                                            */
/* ================================================================== */

const METRIC_SIZE = { md: 'text-metric-md', lg: 'text-metric-lg', xl: 'text-metric-xl' } as const

/**
 * A labelled number. The number is ink when normal and takes the status colour only when it needs attention;
 * the status line below always says it in words too.
 */
export function Metric({ label, value, unit, decimals = 0, size = 'lg', status, hint, className }: { label: ReactNode; value: number | string | null; unit?: ReactNode; decimals?: number; size?: keyof typeof METRIC_SIZE; status?: StatusOrNone; hint?: ReactNode; className?: string }) {
  const tone = status === 'warn' ? 'text-warn' : status === 'crit' ? 'text-crit' : 'text-ink'
  return (
    <div className={className}>
      <div className="label">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cx(METRIC_SIZE[size], value == null ? 'text-dim' : tone)}>{value == null ? '—' : typeof value === 'number' ? <AnimatedNumber value={value} decimals={decimals} /> : value}</span>
        {unit && value != null && <span className={cx('text-dim', size === 'md' ? 'text-sm' : 'text-base')}>{unit}</span>}
      </div>
      {status !== undefined ? (
        <StatusText status={status} className="mt-2">
          {hint}
        </StatusText>
      ) : hint ? (
        <p className="mt-2 text-sm text-dim">{hint}</p>
      ) : null}
    </div>
  )
}

/**
 * A thin scale showing where a value sits between min and max, with optional threshold ticks.
 * Use instead of decorative progress bars. The fill grows once.
 */
export function Meter({ value, min = 0, max = 100, marks = [], status, label, className }: { value: number; min?: number; max?: number; marks?: { at: number; status?: Status }[]; status?: Status; label: string; className?: string }) {
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - min) / (max - min || 1)) * 100))
  return (
    <div role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={Math.round(value * 100) / 100} className={cx('relative h-1.5', className)}>
      <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 overflow-hidden rounded-full bg-line">
        <motion.div className="h-full origin-left rounded-full" style={{ width: `${pct(value)}%`, background: status ? STATUS_COLOR[status] : 'var(--color-ink)' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: DUR.draw, ease: EASE.out }} />
      </div>
      {marks.map((m) => (
        <span key={m.at} aria-hidden="true" className="absolute top-0 h-full w-px" style={{ left: `${pct(m.at)}%`, background: m.status ? STATUS_COLOR[m.status] : 'var(--color-edge)' }} />
      ))}
    </div>
  )
}

/** Overall score as a ring. Draws once; no glow. */
export function ScoreRing({ score, status, size = 168 }: { score: number; status: Status; size?: number }) {
  const stroke = Math.max(4, Math.round(size / 26))
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} role="img" aria-label={`Health score ${score} of 100, ${STATUS_TEXT[status]}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={STATUS_COLOR[status]}
          strokeWidth={stroke}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.min(100, Math.max(0, score)) / 100) }}
          transition={{ duration: DUR.draw, ease: EASE.out }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span style={{ fontSize: size * 0.3, letterSpacing: '-0.03em' }} className="font-medium leading-none text-ink">
          <AnimatedNumber value={score} />
        </span>
        <span className="mt-1.5 text-sm text-dim">of 100</span>
      </div>
    </div>
  )
}

/** A trend at a glance: straight segments between real measurements, a dot on the latest one. No fill, no smoothing. */
export function Sparkline({ data, color, height = 44 }: { data: { day: number; value: number }[]; color: string; height?: number }) {
  if (data.length < 2)
    return (
      <div style={{ height }} className="flex items-end text-xs text-dim">
        Not enough data for a trend
      </div>
    )
  const last = data[data.length - 1]
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 1 }}>
          <XAxis hide type="number" dataKey="day" domain={['dataMin', 'dataMax']} />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line type="linear" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} activeDot={false} animationDuration={DUR.draw * 1000} animationEasing="ease-out" />
          <ReferenceDot x={last.day} y={last.value} r={2.5} fill={color} stroke="none" ifOverflow="visible" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ================================================================== */
/* Charts (recharts): spread these instead of hand-picking colours     */
/* ================================================================== */

const TICK = { fill: 'var(--color-dim)', fontSize: 12, fontFamily: 'var(--font-mono)' }

/**
 * One look for every recharts chart. Usage:
 *   <LineChart data={d} margin={chart.margin}>
 *     <CartesianGrid {...chart.grid} /> <XAxis dataKey="day" {...chart.xAxis} /> <YAxis {...chart.yAxis} />
 *     <ReferenceArea y1={90} y2={130} {...chart.band('ok')} /> <ReferenceLine y={118} {...chart.refLine()} />
 *     <Tooltip {...chart.tooltip} content={<ChartTooltip unit="mmHg" />} />
 *     <Line dataKey="value" {...chart.line} />
 *   </LineChart>
 */
export const chart = {
  margin: { top: 8, right: 12, bottom: 0, left: 0 },
  /** Data is drawn in ink. A second series uses `chart.series[1]`; status colours are for status only. */
  series: ['var(--color-ink)', 'var(--color-dim)', 'var(--color-accent)'],
  grid: { stroke: 'var(--color-line)', strokeDasharray: '0', vertical: false },
  xAxis: { tick: TICK, tickLine: false, axisLine: { stroke: 'var(--color-line)' }, tickMargin: 8, minTickGap: 28 },
  yAxis: { tick: TICK, tickLine: false, axisLine: false, tickMargin: 4, width: 44 },
  /** Straight segments: a curve would invent values between measurements. */
  line: { type: 'linear' as const, stroke: 'var(--color-ink)', strokeWidth: 1.75, dot: false, activeDot: { r: 4, fill: 'var(--color-ink)', stroke: 'var(--color-space)', strokeWidth: 2 }, animationDuration: DUR.draw * 1000, animationEasing: 'ease-out' as const },
  bar: { fill: 'var(--color-soft)', radius: [3, 3, 0, 0] as [number, number, number, number], maxBarSize: 28, animationDuration: DUR.draw * 1000, animationEasing: 'ease-out' as const },
  /** A reference range, e.g. the normal band. Always explain it in a caption under the chart. */
  band: (status: Status = 'ok') => ({ fill: STATUS_COLOR[status], fillOpacity: 0.08, stroke: 'none', ifOverflow: 'hidden' as const }),
  /** A threshold or baseline. Pass a status for a limit; omit it for a neutral baseline. */
  refLine: (status?: Status) => ({ stroke: status ? STATUS_COLOR[status] : 'var(--color-edge)', strokeDasharray: '4 4', strokeWidth: 1, ifOverflow: 'extendDomain' as const }),
  tooltip: { cursor: { stroke: 'var(--color-edge)', strokeWidth: 1 }, isAnimationActive: false, wrapperStyle: { outline: 'none' } },
}

type TooltipEntry = { name?: unknown; value?: unknown; dataKey?: unknown; color?: string }

/** Tooltip body for recharts: <Tooltip {...chart.tooltip} content={<ChartTooltip unit="bpm" />} /> */
export function ChartTooltip({ active, payload, label, unit, formatLabel, formatValue }: { active?: boolean; payload?: readonly TooltipEntry[]; label?: unknown; unit?: string; formatLabel?: (label: unknown) => ReactNode; formatValue?: (value: unknown, entry: TooltipEntry) => ReactNode }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-overlay">
      <div className="meta">{formatLabel ? formatLabel(label) : String(label ?? '')}</div>
      {payload.map((p, i) => (
        <div key={i} className="mt-1 flex items-baseline justify-between gap-4 text-sm">
          {payload.length > 1 && <span className="text-dim">{String(p.name ?? p.dataKey ?? '')}</span>}
          <span className="font-medium text-ink">
            {formatValue ? formatValue(p.value, p) : String(p.value ?? '—')}
            {unit && <span className="ml-1 font-normal text-dim">{unit}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

/* ================================================================== */
/* Tabs / segmented control                                            */
/* ================================================================== */

type TabOption<T extends string> = { value: T; label: ReactNode; icon?: LucideIcon; status?: Status; disabled?: boolean }

/**
 * One control for "pick one of a few". `pill` = segmented filter (the thumb slides to the choice),
 * `line` = section tabs with an underline. Scrolls sideways instead of wrapping. Arrow keys move the selection.
 */
export function Tabs<T extends string>({ value, onChange, options, variant = 'pill', label, full = false, className }: { value: T; onChange: (value: T) => void; options: TabOption<T>[]; variant?: 'pill' | 'line'; label: string; full?: boolean; className?: string }) {
  const id = useId()
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (e: ReactKeyboardEvent, i: number) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    for (let n = 1; n <= options.length; n++) {
      const j = (i + step * n + options.length * n) % options.length
      if (!options[j].disabled) {
        onChange(options[j].value)
        refs.current[j]?.focus()
        refs.current[j]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        break
      }
    }
  }
  const pill = variant === 'pill'
  return (
    <div role="tablist" aria-label={label} className={cx('no-scrollbar max-w-full overflow-x-auto', pill ? 'rounded-[10px] border border-line bg-deep p-1' : 'border-b border-line', full ? 'flex' : 'inline-flex', pill ? 'gap-1' : 'gap-6', className)}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-sm font-medium transition-colors disabled:opacity-40',
              pill ? "h-9 rounded-md px-3 after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']" : 'h-11',
              full && 'flex-1',
              on ? 'text-ink' : 'text-dim hover:text-ink',
            )}
          >
            {on && (pill ? <motion.span layoutId={`${id}-thumb`} transition={SPRING.snappy} className="absolute inset-0 rounded-md border border-line bg-panel2" /> : <motion.span layoutId={`${id}-thumb`} transition={SPRING.snappy} className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />)}
            <span className="relative inline-flex items-center gap-1.5">
              {o.icon && <o.icon className="h-4 w-4" aria-hidden="true" />}
              {o.label}
              {o.status && o.status !== 'ok' && <StatusIcon status={o.status} size={13} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/* ================================================================== */
/* Overlays: dialog, side sheet, tooltip                               */
/* ================================================================== */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

type OverlayProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Action buttons; primary action last. */
  footer?: ReactNode
}

const overlayVariants: Record<'center' | 'right' | 'bottom', Variants> = {
  center: {
    closed: { opacity: 0, y: 10, scale: 0.98, transition: { duration: DUR.fast, ease: EASE.in } },
    open: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.base, ease: EASE.out } },
  },
  right: {
    closed: { x: '100%', transition: { duration: DUR.base, ease: EASE.in } },
    open: { x: 0, transition: SPRING.soft },
  },
  bottom: {
    closed: { y: '100%', transition: { duration: DUR.base, ease: EASE.in } },
    open: { y: 0, transition: SPRING.soft },
  },
}

function Overlay({ open, onClose, title, description, children, footer, kind, wide = false }: OverlayProps & { kind: 'dialog' | 'sheet'; wide?: boolean }) {
  const desktop = useMedia('(min-width: 640px)')
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const before = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const raf = requestAnimationFrame(() => (panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? panel.current)?.focus())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !panel.current) return
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (!items.length) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const at = document.activeElement
      if (e.shiftKey && (at === first || at === panel.current)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && at === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      before?.focus?.()
    }
  }, [open])

  if (typeof document === 'undefined') return null
  const mode = !desktop ? 'bottom' : kind === 'sheet' ? 'right' : 'center'
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="overlay" initial="closed" animate="open" exit="closed" className={cx('fixed inset-0 z-50 flex', mode === 'bottom' ? 'items-end' : mode === 'right' ? 'justify-end' : 'items-center justify-center p-6')}>
          <motion.div variants={{ closed: { opacity: 0 }, open: { opacity: 1 } }} transition={{ duration: DUR.fast }} className="absolute inset-0 bg-black/65" onClick={onClose} aria-hidden="true" />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            variants={overlayVariants[mode]}
            className={cx(
              'relative flex w-full flex-col bg-panel2 shadow-overlay outline-none',
              mode === 'bottom' && 'max-h-[90dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]',
              mode === 'right' && 'h-full max-w-md',
              mode === 'center' && cx('max-h-[min(44rem,calc(100dvh-3rem))] rounded-2xl', wide ? 'max-w-2xl' : 'max-w-lg'),
            )}
          >
            <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
              <div className="min-w-0 pt-1.5">
                <h2 id={titleId} className="text-heading text-ink">
                  {title}
                </h2>
                {description && <p className="mt-1 text-sm text-dim">{description}</p>}
              </div>
              <IconButton icon={X} label="Close" onClick={onClose} className="-mr-2" />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            {footer && <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:gap-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** A question or short task that blocks the page. Centered on desktop, a bottom sheet on phones. Esc and backdrop close it; focus is trapped and restored. */
export function Dialog(props: OverlayProps & { wide?: boolean }) {
  return <Overlay {...props} kind="dialog" />
}

/** Detail or a longer form beside the page. Slides in from the right on desktop, from the bottom on phones. */
export function Sheet(props: OverlayProps) {
  return <Overlay {...props} kind="sheet" />
}

/** A short hint on hover or keyboard focus. Not for essential information (touch users never see it). */
export function Tooltip({ label, children, side = 'top', align = 'center' }: { label: ReactNode; children: ReactElement<{ 'aria-describedby'?: string }>; side?: 'top' | 'bottom'; align?: 'start' | 'center' | 'end' }) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const show = () => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOpen(true), 350)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setOpen(false)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return (
    <span className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onFocus={() => setOpen(true)} onBlur={hide} onKeyDown={(e) => e.key === 'Escape' && hide()}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span
        id={id}
        role="tooltip"
        data-open={open}
        className={cx(
          'pointer-events-none absolute z-40 w-max max-w-64 rounded-md border border-line bg-panel2 px-2.5 py-1.5 text-xs leading-snug text-soft opacity-0 shadow-overlay transition-opacity data-[open=true]:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'start' ? 'left-0' : 'right-0',
        )}
      >
        {label}
      </span>
    </span>
  )
}

/* ================================================================== */
/* Loading, empty, sources                                             */
/* ================================================================== */

/** Placeholder with the size of the content that is loading: <Skeleton className="h-9 w-24" /> */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx('block animate-skeleton rounded-md bg-line', className)} />
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2.5 text-sm text-dim">
      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}…
    </div>
  )
}

/** "Nothing here yet" — say why, and offer the one action that fixes it. */
export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col items-start gap-3 rounded-2xl border border-dashed border-line p-5 sm:p-6', className)}>
      {Icon && (
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-line text-dim">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      )}
      <div>
        <p className="text-[15px] font-semibold text-ink">{title}</p>
        {description && <p className="mt-1 max-w-prose text-sm text-dim">{description}</p>}
      </div>
      {action}
    </div>
  )
}

/** A citation: organization first, then the document title. Opens in a new tab. */
export function SourceLink({ href, org, title, className }: { href: string; org: string; title?: string; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cx('link inline-flex items-baseline gap-1 text-sm', className)}>
      <span>
        {org}
        {title && <span> — {title}</span>}
      </span>
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/* ================================================================== */
/* Living reference (development only): http://localhost:5173/login?kit */
/* ================================================================== */

const KIT_TREND = [118, 117, 121, 119, 122, 120, 124, 126, 125, 129, 131, 130, 134, 133, 138].map((value, i) => ({ day: 128 + i, value }))

/** Every primitive on one page, in every state. Open /login?kit in the dev server. Only reachable in development. */
export function UiKit() {
  const [tab, setTab] = useState<'bp' | 'hr' | 'spo2' | 'sleep'>('bp')
  const [range, setRange] = useState<'7' | '30' | 'all'>('30')
  const [dialog, setDialog] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [status, setStatus] = useState<Status>('warn')
  const [value, setValue] = useState(138)
  const [loading, setLoading] = useState(false)
  const next: Record<Status, Status> = { ok: 'warn', warn: 'crit', crit: 'ok' }
  const fakeSave = () => {
    setLoading(true)
    window.setTimeout(() => setLoading(false), 1400)
  }
  return (
    <MotionRoot>
      <div className="mx-auto max-w-[1100px] space-y-12 px-4 py-10 sm:px-6">
        <PageHeader
          eyebrow="docs/DESIGN.md"
          title="AURA primitives"
          description="Every shared component in every state. If a page needs something that is not here, ask for it instead of hand-rolling it."
          status={<StatusPill status={status} announce />}
          actions={<Button onClick={() => setStatus(next[status])}>Change status</Button>}
        />

        <Section title="Type" description="IBM Plex Sans for everything a person reads; IBM Plex Mono for machine-written metadata.">
          <div className="space-y-3">
            <p className="text-display">Display 44 — auth headline</p>
            <p className="text-title">Title 28 — one per page</p>
            <p className="text-heading">Heading 18 — section headings</p>
            <p>Body 16 — Rest 5 minutes and re-measure. Tell your flight surgeon if it stays at or above 130/80.</p>
            <p className="text-sm text-soft">Small 14 — secondary text in the soft colour.</p>
            <p className="label">Label 13 — field labels and captions, sentence case</p>
            <p className="meta">meta 12 mono — D142 · 08:30 · Omron BP monitor</p>
          </div>
        </Section>

        <Section title="Buttons" description="One primary per view. Everything else is secondary or quiet.">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" loading={loading} onClick={fakeSave}>
              Save measurement
            </Button>
            <Button>Secondary</Button>
            <Button variant="quiet">Quiet</Button>
            <Button variant="danger">Delete account</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button size="sm" icon={Info}>
              Small
            </Button>
            <Button size="lg" iconRight={ChevronRight}>
              Large
            </Button>
            <Tooltip label="Icon buttons always carry a label">
              <IconButton icon={X} label="Close" variant="secondary" />
            </Tooltip>
          </div>
        </Section>

        <Section title="Forms">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <Field label="Systolic" hint="Upper number, in mmHg.">
              <Input inputMode="numeric" placeholder="120" />
            </Field>
            <Field label="Diastolic" error="Enter a value between 30 and 150.">
              <Input inputMode="numeric" defaultValue="300" />
            </Field>
            <Field label="Source">
              <Select defaultValue="device">
                <option value="device">Omron BP monitor</option>
                <option value="manual">Typed in by hand</option>
              </Select>
            </Field>
            <Field label="Password">
              <PasswordInput defaultValue="correct horse" />
            </Field>
            <Field label="Note" optional className="sm:col-span-2">
              <Textarea placeholder="Anything your flight surgeon should know" />
            </Field>
            <Checkbox className="sm:col-span-2" label="Share this reading with my flight surgeon" defaultChecked />
          </div>
        </Section>

        <Section title="Status" description="Icon shape + word + colour. Normal stays quiet; colour appears only when a reading needs you.">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill status="ok" />
            <StatusPill status="warn" />
            <StatusPill status="crit" />
            <StatusPill status={null} />
            <StatusPill status="warn" small />
            <StatusText status="ok">within your range</StatusText>
            <StatusText status="crit">below 5 h</StatusText>
            <Badge>Device</Badge>
            <Badge tone="accent">Simulated</Badge>
            <LiveDot />
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <Notice tone="warn" title="Blood pressure 138/86 mmHg" action={<Button size="sm">Re-measure</Button>}>
              Rest 5 minutes and re-measure. Tell your care contact if it stays at or above 130/80.
            </Notice>
            <Notice tone="crit" title="Sleep 4.4 h">
              Keep a fixed sleep window and dim the lights an hour before sleep.
            </Notice>
            <Notice tone="info">Simulated data. Thresholds marked “demo” are our own choices, not clinical limits.</Notice>
            <Notice tone="ok" title="Report delivered">
              Dr. Arslan will see it after the 14-minute signal delay.
            </Notice>
          </div>
        </Section>

        <Section
          title="Numbers"
          description="Numbers never count up from zero. They tween only when the value changes."
          action={
            <Button size="sm" onClick={() => setValue((v) => (v === 138 ? 121 : 138))}>
              Change value
            </Button>
          }
        >
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Metric size="xl" label="Systolic" value={value} unit="mmHg" status={value > 130 ? 'warn' : 'ok'} hint={value > 130 ? 'above 130' : 'in range'} />
            <Metric label="Heart rate" value={67} unit="bpm" status="ok" />
            <Metric label="Body temperature" value={36.8} decimals={1} unit="°C" hint="today 08:42" />
            <Metric label="Blood sugar" value={null} unit="mg/dL" status={null} hint="log a first reading" />
          </div>
          <div className="mt-8 grid items-center gap-8 sm:grid-cols-[auto_1fr]">
            <ScoreRing score={status === 'ok' ? 96 : status === 'warn' ? 82 : 56} status={status} size={132} />
            <div className="max-w-md space-y-4">
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-dim">Radiation dose</span>
                  <span className="text-ink">
                    256 mSv <span className="text-dim">of 600</span>
                  </span>
                </div>
                <Meter
                  value={43}
                  marks={[
                    { at: 50, status: 'warn' },
                    { at: 80, status: 'crit' },
                  ]}
                  label="Radiation dose, 43% of the career limit"
                />
              </div>
              <Sparkline data={KIT_TREND} color={STATUS_COLOR[status]} />
            </div>
          </div>
        </Section>

        <Section
          title="Chart"
          description="Ink line, hairline grid, mono ticks, a tinted reference band. Straight segments between real measurements."
          action={
            <Tabs
              label="Range"
              value={range}
              onChange={setRange}
              options={[
                { value: '7', label: '7 days' },
                { value: '30', label: '30 days' },
                { value: 'all', label: 'All' },
              ]}
            />
          }
        >
          <Tabs
            label="Measurement"
            variant="line"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'bp', label: 'Blood pressure', status: 'warn' },
              { value: 'hr', label: 'Heart rate' },
              { value: 'spo2', label: 'Blood oxygen' },
              { value: 'sleep', label: 'Sleep', status: 'crit' },
            ]}
          />
          <div className="mt-4 h-64 rounded-xl border border-line bg-deep p-3">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={KIT_TREND} margin={chart.margin}>
                <CartesianGrid {...chart.grid} />
                <XAxis dataKey="day" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(d) => `D${d}`} {...chart.xAxis} />
                <YAxis domain={[110, 145]} {...chart.yAxis} />
                <ReferenceArea y1={110} y2={130} {...chart.band('ok')} />
                <ReferenceLine y={130} {...chart.refLine('warn')} />
                <ReferenceLine y={118} {...chart.refLine()} />
                <RTooltip {...chart.tooltip} content={<ChartTooltip unit="mmHg" formatLabel={(l) => `Day ${String(l)}`} />} />
                <Line dataKey="value" name="Systolic" {...chart.line} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-sm text-dim">Green band: normal range. Dashed amber: attention threshold. Dashed grey: your baseline.</p>
        </Section>

        <Section title="Surfaces and lists" description="Group with space and hairlines first. A Card is for a discrete object; never nest cards.">
          <div className="grid gap-6 lg:grid-cols-2">
            <List className="self-start">
              <Row leading={<Avatar name="Mira Okafor" text="CDR" />} title="Mira Okafor" description="Commander" trailing={<StatusPill status="warn" small />} to="/login?kit" />
              <Row leading={<Avatar name="Aiko Tanaka" text="MS1" />} title="Aiko Tanaka" description="Mission Specialist" trailing={<StatusPill status="ok" small />} to="/login?kit" />
              <Row title="Morning blood pressure" description="Omron BP monitor" trailing={<span className="meta">08:30</span>} />
            </List>
            <div className="space-y-4">
              <Card>
                <Metric size="md" label="Water today" value={1.6} decimals={1} unit="L" status="warn" hint="target 2.5 L" />
              </Card>
              <EmptyState icon={Info} title="No readings yet" description="Log your first blood pressure reading and AURA will start your baseline." action={<Button size="sm">Log a measurement</Button>} />
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-24" />
                <Spinner label="Loading health data" />
              </div>
            </div>
          </div>
        </Section>

        <Section title="Overlays and sources">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => setDialog(true)}>Open dialog</Button>
            <Button onClick={() => setSheet(true)}>Open sheet</Button>
          </div>
          <p className="mt-4 text-sm text-dim">
            Source: <SourceLink href="https://www.who.int/news-room/fact-sheets/detail/hypertension" org="WHO" title="Hypertension" />
          </p>
        </Section>
      </div>

      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="Send report to flight surgeon?"
        description="It arrives after the 14-minute signal delay."
        footer={
          <>
            <Button onClick={() => setDialog(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setDialog(false)} data-autofocus>
              Send report
            </Button>
          </>
        }
      >
        <p className="text-soft">The report contains today’s readings, open alerts and your 7-day trends.</p>
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Blood pressure" description="How to measure">
        <p className="text-soft">Rest 5 minutes. Cuff on the upper arm at heart level, stay still and silent, then start.</p>
      </Sheet>
    </MotionRoot>
  )
}
