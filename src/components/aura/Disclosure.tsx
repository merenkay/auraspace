// A collapsed-by-default group: heading + hairline like <Section>, opens in place. Native <details>, so keyboard and
// screen readers work without extra code.
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../ui'

export default function Disclosure({ title, meta, defaultOpen = false, size = 'section', children, className }: { title: ReactNode; meta?: ReactNode; defaultOpen?: boolean; size?: 'section' | 'row'; children: ReactNode; className?: string }) {
  return (
    <details open={defaultOpen} className={cx('group', className)}>
      <summary className={cx('flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg [&::-webkit-details-marker]:hidden', size === 'section' ? 'border-b border-line pb-3 pt-1 group-open:mb-4' : 'py-2 text-sm text-soft hover:text-ink group-open:mb-2')}>
        <span className="min-w-0">
          <span className={size === 'section' ? 'text-heading text-ink' : 'font-medium'}>{title}</span>
          {meta && <span className="ml-3 text-sm text-dim">{meta}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-dim transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      {children}
    </details>
  )
}
