import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import AppErrorBoundary from './components/AppErrorBoundary'
import { SessionProvider } from './lib/session'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)

/*
 * Service worker (production only). Update flow:
 *  1. The browser checks /sw.js on load, when the tab becomes visible again, and hourly.
 *  2. A new worker installs and then WAITS; the open page keeps running on its own consistent build.
 *  3. At the next in-app navigation (App.tsx fires "aura:navigated") the page tells the worker to take over
 *     and reloads once it has. Nobody loses a half-filled form and nobody is stranded on an old build.
 *  4. If every tab is closed, the waiting worker simply activates on the next visit.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        let waiting: ServiceWorker | null = reg.waiting && navigator.serviceWorker.controller ? reg.waiting : null
        const track = (w: ServiceWorker | null) => {
          if (!w) return
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) waiting = w
          })
        }
        track(reg.installing)
        reg.addEventListener('updatefound', () => track(reg.installing))

        window.addEventListener('aura:navigated', () => {
          if (waiting) {
            waiting.postMessage({ type: 'SKIP_WAITING' })
            waiting = null
          }
        })
        let reloaded = false
        let hadController = !!navigator.serviceWorker.controller
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          // The very first install also claims the page: that is not an update, so do not reload for it.
          if (!hadController) {
            hadController = true
            return
          }
          if (reloaded) return
          reloaded = true
          window.location.reload()
        })

        const check = () => void reg.update().catch(() => undefined)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
        setInterval(check, 60 * 60 * 1000)

        // Once idle, let the worker fetch the 3D viewer and body model so they work offline too.
        void navigator.serviceWorker.ready.then((r) => {
          const warm = () => r.active?.postMessage({ type: 'WARM' })
          const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
          if (w.requestIdleCallback) w.requestIdleCallback(warm, { timeout: 10000 })
          else setTimeout(warm, 5000)
        })
      })
      .catch(() => undefined)
  })
}
