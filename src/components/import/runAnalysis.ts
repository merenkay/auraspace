import { analyzeExport, type ExportSummary, type InputFile } from '../../lib/samsungHealth'

export type Progress = { label: string; fraction: number }

/**
 * Runs the export analysis in a Web Worker so large exports never freeze the page.
 * Falls back to the main thread if workers are unavailable (the parser itself streams rows and
 * only opens the few CSV files it needs, so this stays usable for typical exports).
 */
export function runAnalysis(files: InputFile[], onProgress: (p: Progress) => void): { promise: Promise<ExportSummary>; cancel: () => void } {
  let worker: Worker | null = null
  try {
    worker = new Worker(new URL('./analyze.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  if (!worker) {
    return { promise: analyzeExport(files, { onProgress: (label, fraction) => onProgress({ label, fraction }) }), cancel: () => {} }
  }
  const w = worker
  const promise = new Promise<ExportSummary>((resolve, reject) => {
    w.onmessage = (e: MessageEvent<{ type: 'progress'; label: string; fraction: number } | { type: 'done'; summary: ExportSummary } | { type: 'error'; message: string }>) => {
      const m = e.data
      if (m.type === 'progress') onProgress({ label: m.label, fraction: m.fraction })
      else if (m.type === 'done') {
        resolve(m.summary)
        w.terminate()
      } else {
        reject(new Error(m.message))
        w.terminate()
      }
    }
    w.onerror = (e) => {
      e.preventDefault()
      w.terminate()
      // e.g. the worker script failed to load: do the work here instead
      analyzeExport(files, { onProgress: (label, fraction) => onProgress({ label, fraction }) }).then(resolve, reject)
    }
    w.postMessage({ files })
  })
  return { promise, cancel: () => w.terminate() }
}
