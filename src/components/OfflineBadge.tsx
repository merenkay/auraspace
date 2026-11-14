import { useEffect, useState } from 'react'
import { Wifi, WifiOff } from 'lucide-react'
import { cx } from './ui'

/** True while the browser reports a network connection. (The browser can only say "no network" for sure.) */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

/**
 * Small connectivity indicator. Offline it always shows (icon + words, never colour alone);
 * online it shows nothing unless `showOnline` is set, so it stays out of the way.
 * Offline wording is honest: what still works is what is stored on this device.
 */
export default function OfflineBadge({ showOnline = false, className }: { showOnline?: boolean; className?: string }) {
  const online = useOnline()
  if (online && !showOnline) return null
  const Icon = online ? Wifi : WifiOff
  return (
    <span
      role="status"
      title={online ? 'Your device reports a network connection.' : 'No network connection. AURA keeps working with the data stored on this device; nothing is sent until you are back online.'}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        online ? 'border-line text-soft' : 'border-warn/50 text-warn',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {online ? 'Online' : 'Offline · saved data only'}
    </span>
  )
}

export { OfflineBadge }
