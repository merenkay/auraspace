// Mounted once in the AppShell header: the hand-control toggle. Everything else (camera, MediaPipe, cursor,
// HUD) is in lazy chunks that load only when the person switches hand control on.
import { Hand, LoaderCircle } from 'lucide-react'
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, IconButton, Notice, cx } from '../ui'
import type { HandErrorKind } from './engine'
import './viewerBridge' // starts tracking the HUD state before any page needs it

const HandSession = lazy(() => import('./HandSession'))

export type HandStatus = { state: 'off'; note?: string } | { state: 'intro' | 'starting' | 'active' } | { state: 'error'; kind: HandErrorKind | 'load' }

const ERRORS: Record<HandErrorKind | 'load', { title: string; detail: string; retry: boolean }> = {
  insecure: { title: 'Hand control needs a secure connection', detail: 'Browsers allow the camera only on https:// pages and on localhost.', retry: false },
  unsupported: { title: 'This browser cannot run hand control', detail: 'It needs camera access and WebAssembly. A current Chrome, Edge, Firefox or Safari has both.', retry: false },
  denied: { title: 'Camera access is blocked', detail: 'Allow the camera for this site (camera icon in the address bar, or the site settings), then try again.', retry: true },
  'no-camera': { title: 'No camera found', detail: 'Connect a webcam or check that it is switched on, then try again.', retry: true },
  busy: { title: 'The camera is in use', detail: 'Another app or browser tab is using it. Close that, then try again.', retry: true },
  model: { title: 'The hand-tracking model did not load', detail: 'It downloads once (about 22 MB) and then also works offline. Check the connection and try again.', retry: true },
  load: { title: 'Hand control could not be loaded', detail: 'Open it once while online; after that it also works offline. Check the connection and try again.', retry: true },
}

class SessionBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function HandControl() {
  const [status, setStatus] = useState<HandStatus>({ state: 'off' })
  const [synthetic, setSynthetic] = useState(false)
  const on = status.state === 'intro' || status.state === 'starting' || status.state === 'active'

  // dev-only: start hand mode without a camera and feed synthetic landmark frames (see HandSession)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __auraHand?: Record<string, unknown> }
    const hook = (w.__auraHand ??= {})
    hook.start = (opts?: { synthetic?: boolean }) => {
      setSynthetic(opts?.synthetic !== false)
      setStatus({ state: 'starting' })
    }
    hook.stop = () => setStatus({ state: 'off' })
    hook.status = () => status
  }, [status])

  const label = status.state === 'active' ? 'Hand control is on. Turn it off' : status.state === 'starting' ? 'Hand control is starting. Cancel' : 'Turn on hand control'
  const panel =
    status.state === 'error' ? { ...ERRORS[status.kind], kind: status.kind } : status.state === 'off' && status.note ? { title: 'Hand control is off', detail: status.note, retry: true, kind: 'note' } : null

  return (
    <>
      <span className="relative inline-flex">
        <IconButton
          icon={status.state === 'starting' ? LoaderCircle : Hand}
          label={label}
          aria-pressed={on}
          onClick={() => {
            setSynthetic(false)
            setStatus(on ? { state: 'off' } : { state: 'intro' })
          }}
          className={cx(on && 'bg-panel2 text-ink', status.state === 'starting' && '[&>svg]:animate-spin')}
        />
        {status.state === 'active' && <span aria-hidden="true" className="pointer-events-none absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-accent" />}
      </span>

      {on && (
        <SessionBoundary onError={() => setStatus({ state: 'error', kind: 'load' })}>
          <Suspense fallback={null}>
            <HandSession synthetic={synthetic} onStatus={setStatus} />
          </Suspense>
        </SessionBoundary>
      )}

      {panel &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="fixed right-4 top-16 z-[45] w-[min(360px,calc(100vw-32px))] rounded-xl shadow-overlay" data-hand-panel={panel.kind}>
            <Notice title={panel.title} role="status">
              <p>{panel.detail} Mouse, touch and keyboard work as usual.</p>
              <div className="mt-3 flex gap-2">
                {panel.retry && (
                  <Button size="sm" onClick={() => setStatus({ state: 'intro' })}>
                    {status.state === 'error' ? 'Try again' : 'Turn on again'}
                  </Button>
                )}
                <Button size="sm" variant="quiet" onClick={() => setStatus({ state: 'off' })}>
                  Close
                </Button>
              </div>
            </Notice>
          </div>,
          document.body,
        )}
    </>
  )
}
