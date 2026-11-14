// Route prefetch: fetch the code of the page someone is about to open (on hover, focus or touch of a nav link,
// and for the main navigation once the browser is idle). Uses the same import() specifiers as App.tsx, so the
// bundler shares one chunk and React.lazy finds it already loaded. Never throws; offline it simply does nothing.
const LOADERS: [RegExp, () => Promise<unknown>][] = [
  [/^\/crew\/[^/]+\/diagnostics/, () => import('../pages/Diagnostics')],
  [/^\/crew\/[^/]+\/aura/, () => import('../pages/Aura')],
  [/^\/crew\/[^/]+\/coach/, () => import('../pages/Coach')],
  [/^\/crew\/[^/]+\/history/, () => import('../pages/History')],
  [/^\/crew\/[^/]+$/, () => import('../pages/Overview')],
  [/^\/crew$/, () => import('../pages/Roster')],
  [/^\/environment/, () => import('../pages/Environment')],
  [/^\/reports/, () => import('../pages/Reports')],
]

const done = new Set<string>()

export function prefetchRoute(path: string) {
  const hit = LOADERS.find(([re]) => re.test(path))
  if (!hit || done.has(hit[0].source)) return
  done.add(hit[0].source)
  hit[1]().catch(() => done.delete(hit[0].source))
}

/** Prefetch several routes one after another while the browser is idle (skipped on data-saver / slow links). */
export function prefetchWhenIdle(paths: string[]) {
  if (typeof window === 'undefined') return () => undefined
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '')) return () => undefined
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void }
  let i = 0
  let handle = 0
  const step = () => {
    if (i >= paths.length) return
    prefetchRoute(paths[i++])
    handle = w.requestIdleCallback ? w.requestIdleCallback(step, { timeout: 4000 }) : window.setTimeout(step, 600)
  }
  handle = w.requestIdleCallback ? w.requestIdleCallback(step, { timeout: 4000 }) : window.setTimeout(step, 2500)
  return () => (w.cancelIdleCallback ? w.cancelIdleCallback(handle) : window.clearTimeout(handle))
}
