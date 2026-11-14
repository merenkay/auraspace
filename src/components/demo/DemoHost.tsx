// Mounted once in App.tsx. Outside the guided tour it renders nothing. During the tour (a sandboxed page load,
// see src/lib/demo/sandbox.ts) it loads the tour interface on top of the app.
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { exitDemo, isDemoActive } from '../../lib/demo/sandbox'
import { Button } from '../ui'

const DemoTour = lazy(() => import('./DemoTour'))

/** Opaque until the tour is ready: the app behind is never shown without the "simulated data" label. */
function Cover() {
  return <div data-demo-ui="" className="fixed inset-0 z-[80] bg-space" aria-hidden="true" />
}

/** A fault in the tour must not take the app down with it: offer the way out instead. */
class TourBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div data-demo-ui="" role="alert" className="fixed inset-x-4 bottom-4 z-[80] mx-auto flex max-w-xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel2 p-4 shadow-overlay">
        <p className="text-[15px] text-ink">
          The guided tour stopped unexpectedly. <span className="text-dim">You are still looking at simulated data.</span>
        </p>
        <Button variant="primary" onClick={exitDemo}>
          Leave the demo
        </Button>
      </div>
    )
  }
}

export default function DemoHost() {
  if (!isDemoActive()) return null
  return (
    <TourBoundary>
      <Suspense fallback={<Cover />}>
        <DemoTour />
      </Suspense>
    </TourBoundary>
  )
}
