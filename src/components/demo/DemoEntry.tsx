// The ways into the guided tour: a clear button on the sign-in page and two discreet entries in the signed-in
// shell. All of them load the tour as its own sandboxed page (src/lib/demo/sandbox.ts); none of them signs
// anyone in or out, and leaving the tour returns to the page the person was on.
import { Play } from 'lucide-react'
import { isDemoActive, startDemo } from '../../lib/demo/sandbox'
import { Button } from '../ui'

export default function DemoEntry({ placement }: { placement: 'login' | 'header' | 'footer' }) {
  // Inside the tour the app is already the demo.
  if (isDemoActive()) return null
  if (placement === 'login')
    return (
      <div className="mb-9">
        <Button size="lg" full icon={Play} onClick={startDemo}>
          Watch the 3-minute demo
        </Button>
        <p className="mt-2 text-sm text-dim">A guided tour of AURA with a simulated crew. No account needed; nothing is saved.</p>
      </div>
    )
  if (placement === 'header')
    return (
      <Button variant="quiet" size="sm" icon={Play} onClick={startDemo} title="Watch the 3-minute guided demo (simulated data)" className="hidden lg:inline-flex">
        Demo
      </Button>
    )
  return (
    <button type="button" onClick={startDemo} className="link">
      Watch the 3-minute demo
    </button>
  )
}
