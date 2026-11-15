// Recovery when this tab runs an older build than the server: after a deploy the old page's lazy chunks no
// longer exist, so a part of a page (or a whole page) fails to load. The cure is one reload, which fetches the
// current build. Guarded by time, not by a one-off flag: a session can outlive several deploys, and a reload loop
// must still be impossible when the server is simply unreachable.
// Only messages browsers use for a failed module import. A plain "Failed to fetch" is NOT one of them: that is any
// network request (an API call, a blocked third-party request) and must never trigger a reload.
export const CHUNK_ERROR = /dynamically imported module|importing a module script failed|error loading dynamically|unable to preload|loading (css )?chunk/i

const KEY = 'aura.chunk-reload'
const MIN_GAP_MS = 20_000

/** Reloads once for a missing chunk. Returns false when it reloaded too recently or the device is offline. */
export function reloadForNewBuild(): boolean {
  if (typeof window === 'undefined' || !navigator.onLine) return false
  try {
    const last = Number(sessionStorage.getItem(KEY))
    if (Number.isFinite(last) && last > 0 && Date.now() - last < MIN_GAP_MS) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch {
    return false // storage blocked: no way to prevent a loop, so do not reload automatically
  }
  window.location.reload()
  return true
}

/** Catches chunk failures that never reach a React error boundary (lazy pieces inside a page, preloads). */
export function installChunkRecovery() {
  window.addEventListener('vite:preloadError', (e) => {
    if (reloadForNewBuild()) e.preventDefault()
  })
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e.reason instanceof Error ? e.reason.message : String(e.reason ?? '')
    if (CHUNK_ERROR.test(msg)) reloadForNewBuild()
  })
}
