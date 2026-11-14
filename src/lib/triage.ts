import { formatDelay } from '../data/missions'
import type { Status } from '../data/vitals'

// Delay-aware triage text: the further from Earth, the more the crew must handle alone.
export function actionFor(status: Status, delaySec: number): string {
  const roundTrip = formatDelay(delaySec * 2)
  const remote = delaySec >= 60
  if (status === 'ok') return 'Within normal range. Keep your routine and measure again at the next scheduled check.'
  if (status === 'warn')
    return remote
      ? `Re-measure in 15 minutes and tell your crew medical officer. Follow the onboard protocol first — a reply from Earth takes at least ${roundTrip}.`
      : 'Re-measure in 15 minutes and tell a crewmate. If it stays out of range, raise it at the next ground conference.'
  return remote
    ? `Alert your crew medical officer now and send the flight-surgeon report. The earliest reply from Earth is in about ${roundTrip} — start the onboard steps while you wait.`
    : 'Alert a crewmate and contact the flight surgeon now. Follow the steps below while you wait.'
}
