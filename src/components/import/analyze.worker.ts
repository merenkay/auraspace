// Parses a Samsung Health export off the main thread. Receives the chosen files (Blobs are cloned, not copied
// into memory) and posts back progress and the summary. Nothing leaves the device.
import { analyzeExport, type InputFile } from '../../lib/samsungHealth'

type Request = { files: InputFile[] }

self.onmessage = async (e: MessageEvent<Request>) => {
  try {
    const summary = await analyzeExport(e.data.files, {
      onProgress: (label, fraction) => self.postMessage({ type: 'progress', label, fraction }),
    })
    self.postMessage({ type: 'done', summary })
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'Could not read the export.' })
  }
}
