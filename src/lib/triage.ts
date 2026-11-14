import { CONTEXTS, type Context } from '../data/contexts'
import { formatDelay } from '../data/missions'
import type { Status } from '../data/vitals'

// Delay-aware triage text. In space, the further from Earth, the more the crew must handle alone;
// at a remote station the station doctor is first contact; at home, the person's doctor or caregiver.
export function actionFor(status: Status, delaySec: number, ctx: Context = 'space'): string {
  if (status === 'ok') return 'Within normal range. Keep your routine and measure again at the next scheduled check.'
  if (ctx === 'home') {
    return status === 'warn'
      ? 'Sit down, rest for 5 minutes and measure again. If it stays out of range, tell your doctor or caregiver today.'
      : 'Measure again now. If it is still out of range, or you feel unwell, contact your doctor or caregiver now. In an emergency, call your local emergency number (112 in Europe).'
  }
  if (ctx === 'polar') {
    return status === 'warn'
      ? 'Re-measure in 15 minutes and tell a colleague. If it stays out of range, see the station doctor today.'
      : 'See the station doctor now and send them your report. Outside medical help can be far away, so act early.'
  }
  const roundTrip = formatDelay(delaySec * 2)
  const remote = delaySec >= 60
  if (status === 'warn')
    return remote
      ? `Re-measure in 15 minutes and tell your crew medical officer. Follow the onboard protocol first — a reply from Earth takes at least ${roundTrip}.`
      : 'Re-measure in 15 minutes and tell a crewmate. If it stays out of range, raise it at the next ground conference.'
  return remote
    ? `Alert your crew medical officer now and send the ${CONTEXTS.space.contact} report. The earliest reply from Earth is in about ${roundTrip} — start the onboard steps while you wait.`
    : 'Alert a crewmate and contact the flight surgeon now. Follow the steps below while you wait.'
}
