// Vocabulary of the training profile: focus areas, fitness levels, equipment and movement limitations.
// The ids are an allow-list mirrored in public/api/routes/coach.php — change both together.
import type { Context } from '../contexts'
import type { EquipmentId, FocusId, Level, LimitId } from '../../lib/coach/types'

export const FOCUS: { id: FocusId; label: string; short: string; what: string }[] = [
  { id: 'muscle', label: 'Muscle loss', short: 'Muscle', what: 'Age-related muscle loss (sarcopenia), muscle wasting in microgravity, or weakness after bed rest or illness.' },
  { id: 'bone', label: 'Bone loss', short: 'Bone', what: 'Thinning bones (osteoporosis) or bone loss in microgravity.' },
  { id: 'balance', label: 'Balance and falls', short: 'Balance', what: 'Feeling unsteady, a recent fall, or wanting to prevent falls.' },
  { id: 'back', label: 'Low back pain', short: 'Back', what: 'Recurring or current low back pain.' },
  { id: 'bp', label: 'Raised blood pressure', short: 'Blood pressure', what: 'High blood pressure, treated or not.' },
  { id: 'glucose', label: 'Blood-sugar control', short: 'Blood sugar', what: 'Diabetes or raised blood sugar.' },
  { id: 'mood', label: 'Low mood and stress', short: 'Mood', what: 'Feeling down, stressed or isolated.' },
  { id: 'sleep', label: 'Poor sleep', short: 'Sleep', what: 'Short or broken sleep.' },
  { id: 'joints', label: 'Joint pain and stiffness', short: 'Joints', what: 'Painful or stiff knees, hips or other joints (for example osteoarthritis).' },
  { id: 'fitness', label: 'General fitness', short: 'Fitness', what: 'Stay fit and strong without a specific problem.' },
]
export const FOCUS_BY_ID = Object.fromEntries(FOCUS.map((f) => [f.id, f])) as Record<FocusId, (typeof FOCUS)[number]>
export const FOCUS_IDS = FOCUS.map((f) => f.id)
export const MAX_FOCUS = 3

export const LEVELS: { id: Level; label: string; what: string }[] = [
  { id: 'starting', label: 'Just starting', what: 'Little or no exercise lately, or coming back after illness.' },
  { id: 'some', label: 'Some activity', what: 'Active on some days, but no regular strength training.' },
  { id: 'regular', label: 'Regular training', what: 'Training most weeks for several months.' },
]

export const EQUIPMENT: { id: EquipmentId; label: string; contexts: Context[] }[] = [
  { id: 'ared', label: 'ARED resistance device', contexts: ['space'] },
  { id: 't2', label: 'T2 treadmill with harness', contexts: ['space'] },
  { id: 'cevis', label: 'CEVIS cycle ergometer', contexts: ['space'] },
  { id: 'chair', label: 'Sturdy chair without wheels', contexts: ['home', 'polar'] },
  { id: 'wall', label: 'Clear wall space', contexts: ['home', 'polar'] },
  { id: 'band', label: 'Resistance band', contexts: ['home', 'polar'] },
  { id: 'light-weights', label: 'Light weights or water bottles', contexts: ['home'] },
  { id: 'dumbbells', label: 'Dumbbells', contexts: ['polar'] },
  { id: 'bench', label: 'Bench or sturdy table', contexts: ['polar', 'home'] },
  { id: 'step', label: 'A step or stairs with a rail', contexts: ['home', 'polar'] },
  { id: 'bike', label: 'Exercise bike', contexts: ['polar', 'home'] },
  { id: 'treadmill', label: 'Treadmill', contexts: ['polar'] },
]
export const EQUIPMENT_BY_ID = Object.fromEntries(EQUIPMENT.map((e) => [e.id, e])) as Record<EquipmentId, (typeof EQUIPMENT)[number]>

export const LIMITS: { id: LimitId; label: string }[] = [
  { id: 'knee', label: 'Knee problems' },
  { id: 'hip', label: 'Hip problems' },
  { id: 'shoulder', label: 'Shoulder problems' },
  { id: 'wrist', label: 'Wrist or hand problems' },
  { id: 'back', label: 'Back problems' },
  { id: 'no-floor', label: 'I can’t get down to the floor' },
  { id: 'seated', label: 'I need to stay seated' },
  { id: 'no-impact', label: 'No jumping or jogging' },
]
export const LIMIT_LABEL = Object.fromEntries(LIMITS.map((l) => [l.id, l.label])) as Record<LimitId, string>

export const DAY_OPTIONS = [2, 3, 4, 5, 6, 7]
export const MINUTE_OPTIONS = [15, 20, 30, 45, 60, 75, 90, 120]

/** Starting values per context (AURA defaults, editable by the person). Space follows the NASA schedule of 6–7 days a week. */
export const CONTEXT_DEFAULTS: Record<Context, { level: Level; daysPerWeek: number; minutes: number; equipment: EquipmentId[] }> = {
  space: { level: 'regular', daysPerWeek: 6, minutes: 90, equipment: ['ared', 't2', 'cevis'] },
  polar: { level: 'some', daysPerWeek: 3, minutes: 45, equipment: ['chair', 'wall', 'band', 'dumbbells', 'bench', 'bike', 'treadmill'] },
  home: { level: 'starting', daysPerWeek: 3, minutes: 30, equipment: ['chair', 'wall'] },
}

export const WEEKDAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
