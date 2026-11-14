// Exercise library for the Coach. Each exercise belongs to a movement pattern and sits on a rung of that
// pattern's ladder (0 = easiest), so the engine can step up or down, or swap to a safer exercise of the same
// pattern when a restriction applies. `source` names the page the movement and its base dose come from;
// `null` means the instructions are AURA's own plain-language description of a standard exercise.
import type { Context } from '../contexts'
import type { ContraTag, EquipmentId, FocusId, Joint, Kind, Muscle, Pattern } from '../../lib/coach/types'
import type { CoachRuleId, CoachSourceId } from './sources'

export type BaseDose = {
  reps?: [number, number]
  /** Seconds to hold each repetition. */
  hold?: [number, number]
  /** Minutes come from the session plan. */
  timed?: boolean
  perSide?: boolean
  setsMax: number
  /** What the reps count, when not obvious ("steps", "stamps"). */
  unit?: string
}

export type Exercise = {
  id: string
  name: string
  kind: Kind
  pattern: Pattern
  rung: number
  muscles: Muscle[]
  purpose: FocusId[]
  contexts: Context[]
  /** Any one of these is enough; empty = body weight only. */
  needs: EquipmentId[]
  contra: ContraTag[]
  stress: Joint[]
  steps: string[]
  cues: string[]
  easier: string
  harder: string
  dose: BaseDose
  source: CoachSourceId | null
  /** Intensity set by the published protocol instead of the 0–10 effort scale (space hardware). */
  protocol?: { text: string; ruleId: CoachRuleId }
}

const HOME_POLAR: Context[] = ['home', 'polar']
const ALL: Context[] = ['home', 'polar', 'space']
const NHS_REPS: BaseDose = { reps: [5, 10], setsMax: 3 }
const GYM_REPS: BaseDose = { reps: [8, 12], setsMax: 3 }

export const EXERCISES: Exercise[] = [
  // ------------------------------------------------------------------ warm-up
  { id: 'march-in-place', name: 'Marching on the spot', kind: 'aerobic', pattern: 'warm', rung: 1, muscles: ['legs', 'hips'], purpose: ['fitness'], contexts: HOME_POLAR, needs: [], contra: ['standing'], stress: [],
    steps: ['Stand tall next to a chair or wall you can touch.', 'March on the spot, lifting your knees a little and swinging your arms.', 'Start slowly and build to an easy, comfortable pace.'],
    cues: ['You should be able to talk easily.'], easier: 'March while seated.', harder: 'Lift your knees higher or march around the room.', dose: { timed: true, setsMax: 1 }, source: 'nia-types' },
  { id: 'seated-march', name: 'Seated hip marching', kind: 'mobility', pattern: 'warm', rung: 0, muscles: ['hips', 'abdomen'], purpose: ['balance', 'fitness'], contexts: HOME_POLAR, needs: ['chair'], contra: [], stress: [],
    steps: ['Sit upright without leaning on the chair back and hold the sides of the chair.', 'Lift one knee as far as is comfortable, then lower the foot with control.', 'Repeat with the other leg.'],
    cues: ['Keep sitting tall the whole time.'], easier: 'Make the lifts smaller.', harder: 'Hold the lift for a second before lowering.', dose: { reps: [5, 10], perSide: true, setsMax: 2 }, source: 'nhs-sitting' },
  { id: 'cevis-easy', name: 'Easy spin on CEVIS', kind: 'aerobic', pattern: 'warm', rung: 0, muscles: ['legs'], purpose: ['fitness'], contexts: ['space'], needs: ['cevis'], contra: [], stress: [],
    steps: ['Clip in and pedal at a light work rate.', 'Let your breathing and heart rate rise gradually.'], cues: ['Light effort: easy conversation.'],
    easier: 'Lower the work rate.', harder: 'Not used for warming up — keep it light.', dose: { timed: true, setsMax: 1 }, source: 'nia-types' },

  // ------------------------------------------------------------------ squat
  { id: 'sit-to-stand-assisted', name: 'Sit-to-stand with hand support', kind: 'strength', pattern: 'squat', rung: 0, muscles: ['legs', 'hips'], purpose: ['muscle', 'balance', 'bone', 'joints'], contexts: HOME_POLAR, needs: ['chair'], contra: [], stress: [],
    steps: ['Sit on the front of a sturdy chair, feet hip-width apart and flat on the floor.', 'Lean slightly forward and stand up, pushing lightly through your hands on your thighs or the seat if you need to.', 'Sit back down slowly, using your hands only to guide you.'],
    cues: ['The slower, the better.', 'Breathe out as you stand up.'], easier: 'Use a higher seat or a cushion.', harder: 'Stand up with your arms crossed (no hands).', dose: NHS_REPS, source: 'nhs-strength' },
  { id: 'sit-to-stand', name: 'Sit-to-stand', kind: 'strength', pattern: 'squat', rung: 1, muscles: ['legs', 'hips'], purpose: ['muscle', 'balance', 'bone', 'joints'], contexts: HOME_POLAR, needs: ['chair'], contra: [], stress: [],
    steps: ['Sit on the edge of a sturdy chair, feet hip-width apart, leaning slightly forward.', 'Stand up slowly using your legs, not your arms. Keep your arms crossed or out in front.', 'Sit back down slowly, with control.'],
    cues: ['Stand up slowly using your legs, not your arms.', 'Breathe out as you stand.'], easier: 'Use your hands to guide you.', harder: 'Pause just above the seat before sitting.', dose: NHS_REPS, source: 'nhs-strength' },
  { id: 'mini-squat', name: 'Mini-squat holding a chair', kind: 'strength', pattern: 'squat', rung: 2, muscles: ['legs', 'hips'], purpose: ['muscle', 'bone', 'joints'], contexts: HOME_POLAR, needs: ['chair'], contra: ['standing'], stress: [],
    steps: ['Hold the back of a sturdy chair, feet hip-width apart.', 'Slowly bend your knees, keeping them pointing forward over your big toes.', 'Come back up gently, squeezing your buttocks.'],
    cues: ['Keep your back straight at all times.'], easier: 'Bend your knees less.', harder: 'Let go of the chair (keep it in reach).', dose: NHS_REPS, source: 'nhs-strength' },
  { id: 'squat', name: 'Body-weight squat', kind: 'strength', pattern: 'squat', rung: 3, muscles: ['legs', 'hips'], purpose: ['muscle', 'bone', 'fitness'], contexts: HOME_POLAR, needs: [], contra: ['standing'], stress: ['knee', 'hip'],
    steps: ['Stand with feet a little wider than hips, a chair behind you.', 'Push your hips back and bend your knees as if to sit, until you lightly touch the chair.', 'Drive up through your whole foot to standing.'],
    cues: ['Chest up, knees over toes.', 'Breathe out on the way up.'], easier: 'Sit fully on the chair between repetitions.', harder: 'Hold a weight at your chest (goblet squat).', dose: GYM_REPS, source: 'nia-types' },
  { id: 'goblet-squat', name: 'Goblet squat', kind: 'strength', pattern: 'squat', rung: 4, muscles: ['legs', 'hips', 'back'], purpose: ['muscle', 'bone', 'fitness'], contexts: ['polar'], needs: ['dumbbells'], contra: ['standing'], stress: ['knee', 'hip'],
    steps: ['Hold one dumbbell upright against your chest with both hands.', 'Squat down with your chest up until your thighs are about level with the seat of a chair.', 'Stand up by pushing through your whole foot.'],
    cues: ['Keep the weight close and your upper back straight.', 'Breathe out on the way up.'], easier: 'Use a lighter dumbbell or none.', harder: 'Your care contact or instructor may raise the weight.', dose: GYM_REPS, source: null },
  { id: 'ared-squat', name: 'ARED squat', kind: 'strength', pattern: 'squat', rung: 1, muscles: ['legs', 'hips', 'back'], purpose: ['muscle', 'bone'], contexts: ['space'], needs: ['ared'], contra: [], stress: ['knee', 'hip', 'back'],
    steps: ['Set the load your exercise specialist prescribed and fit the shoulder harness.', 'Squat down under control with your feet on the footplate.', 'Drive up to standing.'],
    cues: ['Upper back straight, knees in line with toes.', 'Breathe out on the way up — never hold your breath.'], easier: 'Fewer repetitions at the prescribed load.', harder: 'Load changes come from your exercise specialist.', dose: GYM_REPS, source: 'esa-ared' },
  { id: 'ared-squat-wide', name: 'ARED wide-stance squat', kind: 'strength', pattern: 'squat', rung: 1, muscles: ['legs', 'hips'], purpose: ['muscle', 'bone'], contexts: ['space'], needs: ['ared'], contra: [], stress: ['knee', 'hip', 'back'],
    steps: ['Set the prescribed load and fit the harness.', 'Place your feet wider than your shoulders, toes slightly out.', 'Squat down and drive back up.'],
    cues: ['Knees follow the direction of your toes.', 'Breathe out as you rise.'], easier: 'Fewer repetitions at the prescribed load.', harder: 'Load changes come from your exercise specialist.', dose: GYM_REPS, source: 'esa-ared' },
  { id: 'ared-squat-single', name: 'ARED single-leg squat', kind: 'strength', pattern: 'squat', rung: 2, muscles: ['legs', 'hips'], purpose: ['muscle', 'bone'], contexts: ['space'], needs: ['ared'], contra: [], stress: ['knee', 'hip'],
    steps: ['Set the prescribed load and fit the harness.', 'Put your weight on one leg, the other foot just off the plate.', 'Squat down partway and drive back up; switch legs.'],
    cues: ['Keep your hips level.', 'Breathe out as you rise.'], easier: 'Use the standard two-leg squat.', harder: 'Load changes come from your exercise specialist.', dose: { ...GYM_REPS, perSide: true }, source: 'esa-ared' },

  // ------------------------------------------------------------------ hinge (hip extension)
  { id: 'leg-extension-back', name: 'Standing leg extension', kind: 'strength', pattern: 'hinge', rung: 0, muscles: ['hips'], purpose: ['muscle', 'balance', 'back'], contexts: HOME_POLAR, needs: ['chair'], contra: ['standing'], stress: [],
    steps: ['Stand upright holding the back of a chair.', 'Lift one leg straight backwards without leaning forward.', 'Lower it slowly and switch legs.'],
    cues: ['Avoid arching your back as you take your leg back.'], easier: 'Make the movement smaller.', harder: 'Hold the lift for up to 5 seconds.', dose: { ...NHS_REPS, perSide: true }, source: 'nhs-strength' },
  { id: 'glute-bridge', name: 'Glute bridge', kind: 'strength', pattern: 'hinge', rung: 1, muscles: ['hips', 'back'], purpose: ['muscle', 'back', 'bone'], contexts: HOME_POLAR, needs: [], contra: ['floor'], stress: [],
    steps: ['Lie on your back with knees bent and feet flat, hip-width apart.', 'Squeeze your buttocks and lift your hips until your body is straight from knees to shoulders.', 'Lower slowly.'],
    cues: ['Breathe out as you lift.', 'Do not push your lower back into an arch.'], easier: 'Lift only a little way.', harder: 'Lift one foot off the floor.', dose: GYM_REPS, source: null },
  { id: 'db-rdl', name: 'Dumbbell hip hinge (Romanian deadlift)', kind: 'strength', pattern: 'hinge', rung: 2, muscles: ['hips', 'back', 'legs'], purpose: ['muscle', 'bone', 'back'], contexts: ['polar'], needs: ['dumbbells'], contra: ['standing'], stress: ['back', 'hip'],
    steps: ['Stand holding dumbbells in front of your thighs, knees slightly bent.', 'Push your hips back and let the weights slide down your thighs, keeping your back straight.', 'Stand tall again by squeezing your buttocks.'],
    cues: ['Think straight: upper back flat, neck in line with your spine.', 'Breathe out as you stand up.'], easier: 'Use lighter weights and a shorter range.', harder: 'Your instructor may raise the weight.', dose: GYM_REPS, source: null },
  { id: 'ared-deadlift', name: 'ARED deadlift', kind: 'strength', pattern: 'hinge', rung: 1, muscles: ['hips', 'back', 'legs'], purpose: ['muscle', 'bone'], contexts: ['space'], needs: ['ared'], contra: [], stress: ['back', 'hip'],
    steps: ['Set the prescribed load and take the bar.', 'Hinge at the hips with a straight back, then stand tall.', 'Lower under control.'],
    cues: ['Straight upper back throughout.', 'Breathe out as you stand.'], easier: 'Fewer repetitions at the prescribed load.', harder: 'Load changes come from your exercise specialist.', dose: GYM_REPS, source: 'esa-ared' },

  // ------------------------------------------------------------------ push
  { id: 'wall-press-up', name: 'Wall press-up', kind: 'strength', pattern: 'push', rung: 0, muscles: ['chest', 'shoulders', 'arms'], purpose: ['muscle', 'fitness'], contexts: HOME_POLAR, needs: ['wall'], contra: ['standing'], stress: ['wrist', 'shoulder'],
    steps: ['Stand an arm’s length from a wall with your hands flat on it at chest height.', 'Keeping your back straight, bend your arms and bring your body towards the wall, elbows by your sides.', 'Push back to the start.'],
    cues: ['Breathe out as you push away.'], easier: 'Stand closer to the wall.', harder: 'Step further back from the wall.', dose: NHS_REPS, source: 'nhs-strength' },
  { id: 'band-chest-press', name: 'Seated band chest press', kind: 'strength', pattern: 'push', rung: 1, muscles: ['chest', 'shoulders', 'arms'], purpose: ['muscle', 'fitness'], contexts: HOME_POLAR, needs: ['band'], contra: [], stress: ['shoulder'],
    steps: ['Sit tall and pass the band behind your back, holding one end in each hand at chest height.', 'Push both hands forward until your arms are almost straight.', 'Return slowly.'],
    cues: ['Do not lock your elbows.', 'Breathe out as you push.'], easier: 'Use a lighter band.', harder: 'Use a stronger band.', dose: GYM_REPS, source: null },
  { id: 'incline-press-up', name: 'Incline press-up', kind: 'strength', pattern: 'push', rung: 2, muscles: ['chest', 'shoulders', 'arms'], purpose: ['muscle', 'fitness'], contexts: HOME_POLAR, needs: ['bench'], contra: ['standing'], stress: ['wrist', 'shoulder'],
    steps: ['Place your hands on a bench or sturdy table, a little wider than your shoulders.', 'Step back so your body is in a straight line.', 'Lower your chest towards the edge, then push back up.'],
    cues: ['Body straight from head to heels.', 'Breathe out as you push.'], easier: 'Use a higher surface or a wall.', harder: 'Do a press-up on the floor.', dose: GYM_REPS, source: null },
  { id: 'press-up', name: 'Press-up', kind: 'strength', pattern: 'push', rung: 3, muscles: ['chest', 'shoulders', 'arms', 'abdomen'], purpose: ['muscle', 'fitness'], contexts: ['polar'], needs: [], contra: ['floor'], stress: ['wrist', 'shoulder'],
    steps: ['Start on your hands and toes (or knees), hands under your shoulders.', 'Lower your chest towards the floor with your body straight.', 'Push back up.'],
    cues: ['Do not let your hips sag.', 'Breathe out as you push.'], easier: 'Do it on your knees or against a bench.', harder: 'Slow the lowering to 3 seconds.', dose: GYM_REPS, source: 'nia-types' },

  // ------------------------------------------------------------------ pull and upper back
  { id: 'band-pull-apart', name: 'Band pull-apart (reverse fly)', kind: 'strength', pattern: 'pull', rung: 0, muscles: ['back', 'shoulders'], purpose: ['muscle', 'bone', 'back'], contexts: HOME_POLAR, needs: ['band'], contra: [], stress: ['shoulder'],
    steps: ['Sit or stand tall holding a band in front of you at chest height, hands shoulder-width apart.', 'Pull the band apart by squeezing your shoulder blades together.', 'Return slowly.'],
    cues: ['Shoulders down, away from your ears.', 'Breathe out as you pull.'], easier: 'Hold the band with your hands further apart.', harder: 'Use a stronger band.', dose: GYM_REPS, source: null },
  { id: 'band-row', name: 'Seated band row', kind: 'strength', pattern: 'pull', rung: 1, muscles: ['back', 'arms'], purpose: ['muscle', 'back', 'bone'], contexts: HOME_POLAR, needs: ['band'], contra: [], stress: ['shoulder'],
    steps: ['Sit tall with legs out and the band looped around your feet (or tied to a fixed point at chest height).', 'Pull your elbows back past your sides, squeezing your shoulder blades.', 'Return slowly.'],
    cues: ['Sit tall — do not lean back.', 'Breathe out as you pull.'], easier: 'Use a lighter band.', harder: 'Use a stronger band.', dose: GYM_REPS, source: null },
  { id: 'db-row', name: 'Supported one-arm dumbbell row', kind: 'strength', pattern: 'pull', rung: 2, muscles: ['back', 'arms'], purpose: ['muscle', 'back', 'bone'], contexts: ['polar'], needs: ['dumbbells'], contra: [], stress: ['shoulder'],
    steps: ['Put one hand and knee on a bench, back flat.', 'Pull the dumbbell up towards your hip.', 'Lower slowly and switch sides.'],
    cues: ['Keep your back flat and still.', 'Breathe out as you pull.'], easier: 'Use a lighter dumbbell.', harder: 'Your instructor may raise the weight.', dose: { ...GYM_REPS, perSide: true }, source: null },

  // ------------------------------------------------------------------ arms
  { id: 'biceps-curl', name: 'Biceps curl', kind: 'strength', pattern: 'arms', rung: 1, muscles: ['arms'], purpose: ['muscle', 'fitness'], contexts: HOME_POLAR, needs: ['light-weights', 'dumbbells'], contra: [], stress: ['wrist'],
    steps: ['Sit or stand holding a light weight (a filled water bottle works) in each hand, arms by your sides.', 'Bend your arms, keeping your elbows at your sides, until the weights reach your shoulders.', 'Lower slowly.'],
    cues: ['Breathe out as you lift.'], easier: 'Use a lighter weight.', harder: 'Use a heavier weight.', dose: { reps: [5, 10], perSide: true, setsMax: 3 }, source: 'nhs-strength' },

  // ------------------------------------------------------------------ calf
  { id: 'calf-raise-supported', name: 'Calf raise holding a chair', kind: 'strength', pattern: 'calf', rung: 0, muscles: ['calves'], purpose: ['muscle', 'balance', 'bone'], contexts: HOME_POLAR, needs: ['chair'], contra: ['standing'], stress: [],
    steps: ['Stand holding the back of a sturdy chair.', 'Lift both heels off the floor as far as is comfortable, slowly and under control.', 'Lower slowly.'],
    cues: ['Keep your body upright.'], easier: 'Do it sitting down.', harder: 'Do it without holding on (chair in reach).', dose: NHS_REPS, source: 'nhs-strength' },
  { id: 'calf-raise', name: 'Calf raise without support', kind: 'strength', pattern: 'calf', rung: 1, muscles: ['calves'], purpose: ['muscle', 'balance', 'bone'], contexts: HOME_POLAR, needs: [], contra: ['standing', 'unsupported-balance'], stress: [],
    steps: ['Stand next to a chair or wall without holding it.', 'Rise onto your toes, slowly.', 'Lower slowly.'],
    cues: ['Touch the support if you feel unsteady.'], easier: 'Hold the chair.', harder: 'Do it on one leg, holding on.', dose: NHS_REPS, source: 'nhs-strength' },
  { id: 'ared-heel-raise', name: 'ARED heel raise', kind: 'strength', pattern: 'calf', rung: 1, muscles: ['calves'], purpose: ['muscle', 'bone'], contexts: ['space'], needs: ['ared'], contra: [], stress: [],
    steps: ['Set the prescribed load and fit the harness.', 'Rise onto the balls of your feet as high as you can.', 'Lower under control.'],
    cues: ['Full range, no bouncing.', 'Breathe steadily.'], easier: 'Fewer repetitions at the prescribed load.', harder: 'Load changes come from your exercise specialist.', dose: GYM_REPS, source: 'nasa-ared-1rm' },

  // ------------------------------------------------------------------ hip side
  { id: 'side-leg-lift', name: 'Sideways leg lift', kind: 'strength', pattern: 'hip-side', rung: 0, muscles: ['hips'], purpose: ['balance', 'joints', 'muscle'], contexts: HOME_POLAR, needs: ['chair'], contra: ['standing'], stress: [],
    steps: ['Stand holding the back of a chair.', 'Lift one leg out to the side as far as is comfortable, keeping your back and hips straight.', 'Lower slowly and switch legs.'],
    cues: ['Avoid tilting to the side.'], easier: 'Make the lift smaller.', harder: 'Add a band around your ankles.', dose: { ...NHS_REPS, perSide: true }, source: 'nhs-strength' },
  { id: 'band-side-step', name: 'Band side steps', kind: 'strength', pattern: 'hip-side', rung: 1, muscles: ['hips', 'legs'], purpose: ['balance', 'joints', 'muscle'], contexts: HOME_POLAR, needs: ['band'], contra: ['standing'], stress: ['hip', 'knee'],
    steps: ['Loop a band around your legs just above the knees.', 'Bend your knees slightly and step sideways, keeping tension on the band.', 'Step back the other way.'],
    cues: ['Stay near a wall or counter.'], easier: 'Use a lighter band.', harder: 'Use a stronger band.', dose: { reps: [8, 12], perSide: true, setsMax: 3, unit: 'steps' }, source: null },

  // ------------------------------------------------------------------ core (no loaded forward bending unless tagged)
  { id: 'wall-plank', name: 'Wall plank', kind: 'strength', pattern: 'core', rung: 1, muscles: ['abdomen', 'shoulders'], purpose: ['back', 'fitness'], contexts: HOME_POLAR, needs: ['wall'], contra: ['isometric', 'standing'], stress: ['shoulder'],
    steps: ['Stand facing a wall and place your forearms on it at shoulder height.', 'Walk your feet back until your body is in a straight line.', 'Hold while breathing normally, then walk back in.'],
    cues: ['Breathe throughout — never hold your breath.', 'Stop as soon as your body sags.'], easier: 'Stand closer to the wall.', harder: 'Walk your feet further back.', dose: { reps: [2, 3], setsMax: 1 }, source: null },
  { id: 'bird-dog', name: 'Bird dog', kind: 'strength', pattern: 'core', rung: 2, muscles: ['back', 'abdomen', 'hips'], purpose: ['back', 'fitness'], contexts: HOME_POLAR, needs: [], contra: ['floor'], stress: ['wrist'],
    steps: ['Kneel on all fours, hands under shoulders, knees under hips.', 'Reach one arm forward and the opposite leg back until both are level with your body.', 'Return and switch sides.'],
    cues: ['Keep your back flat like a table.', 'Move slowly and breathe.'], easier: 'Move only the leg.', harder: 'Pause for 2 breaths at full reach.', dose: { reps: [5, 10], perSide: true, setsMax: 3 }, source: null },
  { id: 'curl-up', name: 'Curl-up', kind: 'strength', pattern: 'core', rung: 2, muscles: ['abdomen'], purpose: ['fitness'], contexts: ['polar'], needs: [], contra: ['floor', 'spinal-flexion'], stress: ['back'],
    steps: ['Lie on your back with knees bent and hands across your chest.', 'Curl your head and shoulders off the floor.', 'Lower slowly.'],
    cues: ['Breathe out as you curl up.'], easier: 'Make the curl smaller.', harder: 'Slow the lowering.', dose: GYM_REPS, source: null },

  // ------------------------------------------------------------------ back extension (posture, bone)
  { id: 'seated-back-extension', name: 'Seated back extension', kind: 'strength', pattern: 'back-ext', rung: 0, muscles: ['back'], purpose: ['bone', 'back'], contexts: HOME_POLAR, needs: ['chair'], contra: [], stress: [],
    steps: ['Sit on the front of a chair, feet flat.', 'Sit up tall, draw your shoulder blades gently back and down and lift your chest.', 'Hold, then relax.'],
    cues: ['Keep your neck in line with your spine.', 'Breathe normally while holding.'], easier: 'Make the movement smaller.', harder: 'Do it standing with your back to a wall.', dose: { reps: [3, 5], hold: [3, 5], setsMax: 2 }, source: 'ros-osteoporosis' },
  { id: 'prone-back-extension', name: 'Lying back extension', kind: 'strength', pattern: 'back-ext', rung: 1, muscles: ['back'], purpose: ['bone', 'back'], contexts: HOME_POLAR, needs: [], contra: ['floor'], stress: [],
    steps: ['Lie face down with a pillow under your hips and arms by your sides.', 'Gently lift your head and chest a little way off the floor.', 'Hold, then lower slowly.'],
    cues: ['Look at the floor to keep your neck long.', 'Breathe normally.'], easier: 'Lift only your head and shoulders.', harder: 'Place your hands lightly at your temples.', dose: { reps: [3, 5], hold: [3, 5], setsMax: 2 }, source: 'ros-osteoporosis' },

  // ------------------------------------------------------------------ balance
  { id: 'one-leg-stand-supported', name: 'One-leg stand with fingertip support', kind: 'balance', pattern: 'balance-static', rung: 0, muscles: ['hips', 'legs'], purpose: ['balance'], contexts: HOME_POLAR, needs: ['wall', 'chair'], contra: ['standing'], stress: [],
    steps: ['Stand facing a wall or chair with your fingertips touching it.', 'Lift one leg, keeping your hips level.', 'Hold, then put the foot down gently and switch.'],
    cues: ['Look straight ahead.'], easier: 'Hold on with your whole hand.', harder: 'Take your fingertips off (support in reach).', dose: { reps: [3, 3], hold: [5, 10], perSide: true, setsMax: 1 }, source: 'nhs-balance' },
  { id: 'one-leg-stand', name: 'One-leg stand', kind: 'balance', pattern: 'balance-static', rung: 1, muscles: ['hips', 'legs'], purpose: ['balance'], contexts: HOME_POLAR, needs: [], contra: ['standing', 'unsupported-balance'], stress: [],
    steps: ['Stand next to a wall or chair without touching it.', 'Lift one leg and hold, keeping your hips level.', 'Switch legs.'],
    cues: ['Touch the support at once if you wobble.'], easier: 'Rest your fingertips on the support.', harder: 'Do it with your eyes closed (with someone nearby).', dose: { reps: [3, 3], hold: [5, 10], perSide: true, setsMax: 1 }, source: 'nhs-balance' },
  { id: 'sideways-walk', name: 'Sideways walking', kind: 'balance', pattern: 'balance-walk', rung: 0, muscles: ['hips', 'legs'], purpose: ['balance'], contexts: HOME_POLAR, needs: [], contra: ['standing'], stress: [],
    steps: ['Stand with feet together and knees slightly bent, near a wall or counter.', 'Step sideways, then bring the other foot to join it.', 'Walk one way, then back.'],
    cues: ['Avoid dropping your hips as you step.'], easier: 'Keep one hand on the counter.', harder: 'Take slower, more controlled steps.', dose: { reps: [10, 10], perSide: true, setsMax: 2, unit: 'steps' }, source: 'nhs-balance' },
  { id: 'heel-to-toe-walk', name: 'Heel-to-toe walk', kind: 'balance', pattern: 'balance-walk', rung: 1, muscles: ['legs'], purpose: ['balance'], contexts: HOME_POLAR, needs: [], contra: ['standing'], stress: [],
    steps: ['Stand alongside a wall, one hand on it if needed.', 'Place one heel directly in front of the toes of the other foot.', 'Keep stepping heel-to-toe.'],
    cues: ['Keep looking forward at all times.'], easier: 'Leave a small gap between heel and toe.', harder: 'Move away from the wall as you improve.', dose: { reps: [5, 10], setsMax: 2, unit: 'steps' }, source: 'nhs-balance' },
  { id: 'grapevine', name: 'Simple grapevine', kind: 'balance', pattern: 'balance-walk', rung: 2, muscles: ['hips', 'legs'], purpose: ['balance'], contexts: HOME_POLAR, needs: [], contra: ['standing', 'unsupported-balance'], stress: ['hip'],
    steps: ['Stand near a wall.', 'Cross one foot over the other, then bring the back foot out to join it.', 'Repeat in the other direction.'],
    cues: ['The smaller the step, the more you work your balance.'], easier: 'Hold the wall.', harder: 'Cross behind as well as in front.', dose: { reps: [5, 5], perSide: true, setsMax: 2, unit: 'steps' }, source: 'nhs-balance' },
  { id: 'step-up', name: 'Step-up', kind: 'balance', pattern: 'step', rung: 1, muscles: ['legs', 'hips'], purpose: ['balance', 'muscle', 'bone'], contexts: HOME_POLAR, needs: ['step'], contra: ['standing'], stress: ['knee'],
    steps: ['Stand at the bottom of a step with a rail or wall for support.', 'Step up with one leg and bring the other up to join it.', 'Step down again, slowly and in control.'],
    cues: ['Use the rail.'], easier: 'Use a lower step.', harder: 'Step up without the rail (rail in reach).', dose: { reps: [5, 10], perSide: true, setsMax: 2 }, source: 'nhs-balance' },
  { id: 'tai-chi', name: 'Tai chi (beginner video or class)', kind: 'balance', pattern: 'balance-walk', rung: 1, muscles: ['legs', 'hips'], purpose: ['balance', 'back'], contexts: HOME_POLAR, needs: [], contra: ['standing'], stress: [],
    steps: ['Follow a beginner tai chi video or class.', 'Shift your weight slowly and gently while breathing deeply.'], cues: ['Stay near a chair or wall.'],
    easier: 'Do the seated version.', harder: 'Follow a longer routine.', dose: { timed: true, setsMax: 1 }, source: 'nia-types' },

  // ------------------------------------------------------------------ impact (bone)
  { id: 'stamping', name: 'Stamping on the spot', kind: 'impact', pattern: 'impact', rung: 0, muscles: ['legs', 'calves'], purpose: ['bone'], contexts: HOME_POLAR, needs: [], contra: ['impact', 'standing'], stress: ['knee'],
    steps: ['Stand holding a counter or chair.', 'Stamp one foot firmly on the floor, then the other.', 'Walk around between sets.'],
    cues: ['Firm, not violent — on a hard floor in supportive shoes.'], easier: 'Fewer stamps per set.', harder: 'Low jumps (if you have no spine fractures).', dose: { reps: [10, 10], setsMax: 5, unit: 'stamps' }, source: 'ros-osteoporosis' },
  { id: 'low-jumps', name: 'Low jumps', kind: 'impact', pattern: 'impact', rung: 1, muscles: ['legs', 'calves'], purpose: ['bone'], contexts: ['polar'], needs: [], contra: ['impact', 'standing', 'unsupported-balance', 'vigorous'], stress: ['knee'],
    steps: ['Stand with feet hip-width apart near a wall.', 'Jump a few centimetres off the floor and land softly with knees bent.', 'Walk around between sets.'],
    cues: ['Land softly, knees over toes.'], easier: 'Stamping instead of jumping.', harder: 'Hop on one leg.', dose: { reps: [10, 10], setsMax: 5, unit: 'jumps' }, source: 'ros-osteoporosis' },

  // ------------------------------------------------------------------ aerobic
  { id: 'chair-cardio', name: 'Seated marching and arm swings', kind: 'aerobic', pattern: 'aerobic', rung: 0, muscles: ['legs', 'arms'], purpose: ['fitness', 'bp', 'glucose', 'mood'], contexts: HOME_POLAR, needs: ['chair'], contra: [], stress: [],
    steps: ['Sit tall on a sturdy chair.', 'March your knees up and down while swinging your arms.', 'Keep a pace where you breathe faster but can still talk.'],
    cues: ['Moderate: you can talk, but not sing.'], easier: 'Slow down.', harder: 'Lift your knees higher and swing your arms more.', dose: { timed: true, setsMax: 1 }, source: 'nhs-sitting' },
  { id: 'walk-brisk', name: 'Brisk walk', kind: 'aerobic', pattern: 'aerobic', rung: 1, muscles: ['legs'], purpose: ['fitness', 'bp', 'glucose', 'mood', 'sleep', 'back', 'bone'], contexts: HOME_POLAR, needs: [], contra: ['standing'], stress: [],
    steps: ['Walk indoors (a corridor, around the house or station) or outside if it is safe.', 'Walk briskly enough that your breathing quickens.'],
    cues: ['Moderate: you can talk, but not sing.'], easier: 'Split it into 10-minute bouts.', harder: 'Walk faster or add stairs.', dose: { timed: true, setsMax: 1 }, source: 'cdc-intensity' },
  { id: 'bike-steady', name: 'Exercise bike, steady', kind: 'aerobic', pattern: 'aerobic', rung: 1, muscles: ['legs'], purpose: ['fitness', 'bp', 'glucose', 'mood', 'joints'], contexts: HOME_POLAR, needs: ['bike'], contra: [], stress: [],
    steps: ['Set the seat so your knee is slightly bent at the bottom of the pedal stroke.', 'Pedal at a steady, moderate pace.'],
    cues: ['Moderate: you can talk, but not sing.'], easier: 'Lower the resistance.', harder: 'Raise the resistance a little.', dose: { timed: true, setsMax: 1 }, source: 'cdc-intensity' },
  { id: 'treadmill-walk', name: 'Treadmill walk', kind: 'aerobic', pattern: 'aerobic', rung: 1, muscles: ['legs'], purpose: ['fitness', 'bp', 'glucose', 'mood', 'bone'], contexts: ['polar'], needs: ['treadmill'], contra: ['standing'], stress: [],
    steps: ['Start slowly holding the rails, then let go once steady.', 'Walk briskly; add a slight incline if it feels easy.'],
    cues: ['Moderate: you can talk, but not sing.'], easier: 'Slow down.', harder: 'Add incline.', dose: { timed: true, setsMax: 1 }, source: 'cdc-intensity' },
  { id: 'bike-intervals', name: 'Exercise bike intervals', kind: 'aerobic', pattern: 'aerobic-hard', rung: 2, muscles: ['legs'], purpose: ['fitness', 'mood', 'glucose'], contexts: ['polar'], needs: ['bike'], contra: ['vigorous'], stress: [],
    steps: ['After the warm-up, alternate harder pedalling (only a few words possible) with easy pedalling.', 'Keep the hard parts short and the easy parts long enough to recover.'],
    cues: ['Vigorous: you cannot say more than a few words without a breath.'], easier: 'Ride steady instead.', harder: 'Make the hard parts a little longer.', dose: { timed: true, setsMax: 1 }, source: 'cdc-intensity' },
  { id: 'cevis-steady', name: 'CEVIS steady ride', kind: 'aerobic', pattern: 'aerobic', rung: 1, muscles: ['legs'], purpose: ['fitness', 'bp', 'mood'], contexts: ['space'], needs: ['cevis'], contra: [], stress: [],
    steps: ['Clip in and ride at the steady work rate in your prescription.'], cues: ['Stop if you feel dizzy, chest pain or palpitations.'],
    easier: 'Lower work rate.', harder: 'Changes come from your exercise specialist.', dose: { timed: true, setsMax: 1 }, source: 'nasa-tb031', protocol: { text: 'Work rate as prescribed from your pre-flight test', ruleId: 'cevisDose' } },
  { id: 'cevis-intervals', name: 'CEVIS intervals', kind: 'aerobic', pattern: 'aerobic-hard', rung: 2, muscles: ['legs'], purpose: ['fitness'], contexts: ['space'], needs: ['cevis'], contra: ['vigorous'], stress: [],
    steps: ['Ride the interval protocol in your prescription: hard efforts with easy recovery between.'], cues: ['Stop if you feel dizzy, chest pain or palpitations.'],
    easier: 'Ride steady instead.', harder: 'Changes come from your exercise specialist.', dose: { timed: true, setsMax: 1 }, source: 'nasa-tb031', protocol: { text: '70–100% of pre-flight VO2peak, as prescribed', ruleId: 'cevisDose' } },
  { id: 't2-walk', name: 'T2 treadmill walk', kind: 'aerobic', pattern: 'aerobic', rung: 1, muscles: ['legs', 'calves'], purpose: ['bone', 'fitness'], contexts: ['space'], needs: ['t2'], contra: [], stress: [],
    steps: ['Put on the harness and set the bungee load in your prescription.', 'Walk briskly at the prescribed speed.'], cues: ['The harness load is what loads your bones — keep it as prescribed.'],
    easier: 'Slower speed.', harder: 'Changes come from your exercise specialist.', dose: { timed: true, setsMax: 1 }, source: 'nasa-tb031', protocol: { text: 'Heart rate as prescribed (70–100% of max)', ruleId: 't2Dose' } },
  { id: 't2-run', name: 'T2 treadmill run', kind: 'aerobic', pattern: 'aerobic-hard', rung: 2, muscles: ['legs', 'calves'], purpose: ['bone', 'fitness'], contexts: ['space'], needs: ['t2'], contra: ['vigorous', 'impact'], stress: ['knee'],
    steps: ['Put on the harness and set the prescribed load.', 'Run the protocol in your prescription.'], cues: ['Stop if you feel dizzy, chest pain or palpitations.'],
    easier: 'Walk instead.', harder: 'Changes come from your exercise specialist.', dose: { timed: true, setsMax: 1 }, source: 'nasa-tb031', protocol: { text: '70–100% of max heart rate, as prescribed', ruleId: 't2Dose' } },

  // ------------------------------------------------------------------ cool-down stretches
  { id: 'chest-stretch', name: 'Chest stretch', kind: 'mobility', pattern: 'stretch-upper', rung: 0, muscles: ['chest', 'shoulders'], purpose: ['back', 'fitness'], contexts: ALL, needs: [], contra: [], stress: ['shoulder'],
    steps: ['Sit upright and pull your shoulders back and down.', 'Reach your arms out to the sides and push your chest forward and up.', 'Hold, then relax.'],
    cues: ['Do not stretch so far that it hurts.'], easier: 'Keep your hands on your hips.', harder: 'Hold a little longer.', dose: { reps: [5, 5], hold: [5, 10], setsMax: 1 }, source: 'nhs-sitting' },
  { id: 'upper-body-twist', name: 'Seated upper-body twist', kind: 'mobility', pattern: 'stretch-spine', rung: 0, muscles: ['back', 'abdomen'], purpose: ['back', 'fitness'], contexts: ALL, needs: [], contra: [], stress: [],
    steps: ['Sit upright with your arms crossed, hands on your shoulders.', 'Turn your upper body to one side without moving your hips.', 'Hold, return to the centre and turn the other way.'],
    cues: ['Move smoothly and comfortably.'], easier: 'Turn less far.', harder: 'Hold a little longer.', dose: { reps: [5, 5], hold: [5, 5], perSide: true, setsMax: 1 }, source: 'nhs-sitting' },
  { id: 'neck-rotation', name: 'Neck rotation', kind: 'mobility', pattern: 'stretch-upper', rung: 0, muscles: ['shoulders'], purpose: ['fitness'], contexts: ALL, needs: [], contra: [], stress: [],
    steps: ['Sit upright with your shoulders down, looking straight ahead.', 'Slowly turn your head towards one shoulder as far as is comfortable.', 'Hold, return and turn the other way.'],
    cues: ['Slow and gentle.'], easier: 'Turn less far.', harder: 'Not needed — keep it gentle.', dose: { reps: [3, 3], hold: [5, 5], perSide: true, setsMax: 1 }, source: 'nhs-sitting' },
  { id: 'side-bend', name: 'Sideways bend', kind: 'mobility', pattern: 'stretch-spine', rung: 1, muscles: ['back', 'abdomen'], purpose: ['back', 'fitness'], contexts: HOME_POLAR, needs: [], contra: ['standing'], stress: [],
    steps: ['Stand with feet hip-width apart, arms by your sides.', 'Slide one hand down the side of your leg as far as is comfortable.', 'Return and switch sides.'],
    cues: ['Bend to the side, not forward.'], easier: 'Do it seated.', harder: 'Hold a little longer.', dose: { reps: [3, 3], hold: [2, 2], perSide: true, setsMax: 1 }, source: 'nhs-flex' },
  { id: 'ankle-stretch', name: 'Seated ankle stretch', kind: 'mobility', pattern: 'stretch-lower', rung: 0, muscles: ['calves'], purpose: ['joints', 'balance'], contexts: ALL, needs: [], contra: [], stress: [],
    steps: ['Sit upright, holding the side of the chair, and straighten one leg with the foot off the floor.', 'Point your toes away from you, then back towards you.', 'Switch feet.'],
    cues: ['Slow and steady.'], easier: 'Keep your heel on the floor.', harder: 'Draw circles with your foot as well.', dose: { reps: [5, 5], perSide: true, setsMax: 2 }, source: 'nhs-sitting' },
  { id: 'calf-stretch', name: 'Calf stretch', kind: 'mobility', pattern: 'stretch-lower', rung: 1, muscles: ['calves'], purpose: ['joints', 'fitness'], contexts: HOME_POLAR, needs: ['wall'], contra: ['standing'], stress: [],
    steps: ['Hold a wall and step one leg back, keeping it straight with both feet flat.', 'Bend the front knee until you feel a stretch in the back calf.', 'Switch legs.'],
    cues: ['Keep the back heel on the floor.'], easier: 'Take a shorter step back.', harder: 'Hold a little longer.', dose: { reps: [3, 3], perSide: true, setsMax: 1 }, source: 'nhs-flex' },
  { id: 'hamstring-stretch-seated', name: 'Seated hamstring stretch', kind: 'mobility', pattern: 'stretch-lower', rung: 1, muscles: ['legs'], purpose: ['back', 'joints', 'fitness'], contexts: HOME_POLAR, needs: ['chair'], contra: ['spinal-flexion'], stress: ['back'],
    steps: ['Sit on the front of a chair with one leg straight out, heel on the floor.', 'Lean forward over the straight leg until you feel a stretch behind the thigh.', 'Switch legs.'],
    cues: ['Do not stretch so far that it hurts.'], easier: 'Lean less far.', harder: 'Hold a little longer.', dose: { reps: [2, 3], perSide: true, setsMax: 1 }, source: null },
]

export const EXERCISE_BY_ID: Record<string, Exercise> = Object.fromEntries(EXERCISES.map((e) => [e.id, e]))
