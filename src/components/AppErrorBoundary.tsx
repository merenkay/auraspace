import { Component, type ErrorInfo, type ReactNode } from 'react'
import { CHUNK_ERROR, reloadForNewBuild } from '../lib/recover'
import { Logo, Button } from './ui'


type Props = {
  children: ReactNode
  /** When this value changes (e.g. the URL path) the boundary tries to render its children again. */
  resetKey?: string
}
type State = { error: Error | null }

/**
 * Last line of defence: a render error in one page shows this calm screen instead of a blank page.
 * Deliberately self-contained: it uses plain links and window.location (not the router) so it still
 * works when the error came from the router or the session itself.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AURA render error', error, info.componentStack)
    // A page chunk that no longer exists means a new version was deployed while this tab was open.
    // Reload to pick it up; reloadForNewBuild() refuses to loop if the server is simply unreachable.
    if (CHUNK_ERROR.test(error.message)) reloadForNewBuild()
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const offlineChunk = CHUNK_ERROR.test(error.message)
    return (
      <div role="alert" className="flex min-h-screen items-center justify-center bg-space px-4 py-10 text-ink">
        <div className="w-full max-w-md">
          <Logo size={32} wordmark className="mb-8" />
          <h1 className="text-xl font-semibold">{offlineChunk ? 'This part of AURA could not load' : 'Something went wrong on this screen'}</h1>
          <p className="mt-3 text-soft">
            {offlineChunk
              ? 'The page did not download. You may be offline, or a newer version of AURA was published while this tab was open. Reloading usually fixes it.'
              : 'AURA hit a problem while drawing this page. Your measurements are not affected: nothing was changed or deleted. Reloading usually fixes it.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
            <Button onClick={() => window.location.assign('/')}>Go to overview</Button>
          </div>
          <details className="mt-8 text-sm text-dim">
            <summary className="cursor-pointer select-none py-1 text-soft">What happened</summary>
            <p className="mt-2">If this keeps happening, tell the team and include this text.</p>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-deep p-3 font-mono text-xs text-soft">
              {error.name}: {error.message}
            </pre>
          </details>
        </div>
      </div>
    )
  }
}
