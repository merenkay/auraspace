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

// Development (and measurement builds): Alt+P shows a small performance HUD. Not in normal production builds.
if (import.meta.env.DEV || import.meta.env.VITE_PERF_HOOKS === '1') void import('./lib/perfHud').then((m) => m.installPerfHud())

/*
 * Service worker (production only). Update flow:
 *  1. The browser checks /sw.js on load, when the tab becomes visible again, and hourly.
 *  2. A new worker installs and then WAITS; the open page keeps running on its own consistent build.
 *  3. At the next in-app navigation (App.tsx fires "aura:navigated") the page tells the worker to take over
 *     and reloads once it has. Nobody loses a half-filled form and nobody is stranded on an old build.
 *  4. If every tab is closed, the waiting worker simply activates on the next visit.
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // Registered (and its code fetched) once the first screen is up and the browser is idle: installing the worker
  // downloads (precaches) the whole app shell, which should not compete with the first render.
  window.addEventListener('load', () => {
    const run = () => void import('./lib/swRegister').then((m) => m.registerServiceWorker()).catch(() => undefined)
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 })
    else setTimeout(run, 1500)
  })
}
