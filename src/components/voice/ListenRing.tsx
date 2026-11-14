// A thin ring around the mic button that drains while AURA waits for you to go on: when it empties,
// AURA takes what you said. It restarts whenever you speak. In push-to-talk it glows steadily instead.
import type { ListenWindow } from '../../lib/voice/recognition'

export default function ListenRing({ win }: { win: ListenWindow }) {
  const hold = win.mode === 'hold' || !win.deadline
  const remain = win.deadline ? Math.max(0, win.deadline - Date.now()) : 0
  const elapsed = Math.max(0, win.total - remain)
  return (
    <svg
      key={win.deadline ?? 'hold'}
      className="vx-listen-ring"
      data-hold={hold}
      viewBox="0 0 52 52"
      aria-hidden="true"
      style={hold ? undefined : ({ '--vx-ring-dur': `${win.total}ms`, '--vx-ring-delay': `-${elapsed}ms` } as React.CSSProperties)}
    >
      <circle cx="26" cy="26" r="24" pathLength={100} />
    </svg>
  )
}
