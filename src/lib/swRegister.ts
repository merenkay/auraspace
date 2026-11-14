// Service worker registration and update flow (see the comment in main.tsx). A separate chunk, loaded once
// the first screen is up and the browser is idle, so none of this is in the entry chunk or on the first render.
export function registerServiceWorker() {
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
}
