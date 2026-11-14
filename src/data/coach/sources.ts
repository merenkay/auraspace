// Sources behind the training programme. Every rule the coach shows as guidance points at one of these,
// with a short verbatim quote copied from the page that was fetched (Nov 2026). Journal abstracts and
// open full texts were read through Europe PMC (PubMed blocks automated reading), so those links point there.
import type { FocusId } from '../../lib/coach/types'

export type CoachSource = { org: string; title: string; url: string }

export const COACH_SOURCES = {
  'nasa-tb031': { org: 'NASA OCHMO', title: 'OCHMO-TB-031 Exercise overview', url: 'https://www.nasa.gov/ochmo-tb-031-exercise-overview-2/' },
  'nasa-exercise': { org: 'NASA', title: 'Astronaut exercise', url: 'https://www.nasa.gov/missions/station/iss-research/astronaut-exercise/' },
  'esa-ared': { org: 'ESA', title: 'Staying strong in orbit with ARED', url: 'https://www.esa.int/ESA_Multimedia/Images/2026/07/Staying_strong_in_orbit_with_ARED' },
  'nasa-ared-1rm': { org: 'NASA NTRS', title: 'Reliability of strength testing using ARED and free weights', url: 'https://ntrs.nasa.gov/citations/20090005240' },
  'who-pa': { org: 'WHO', title: 'Physical activity fact sheet', url: 'https://www.who.int/news-room/fact-sheets/detail/physical-activity' },
  'cdc-adults': { org: 'CDC', title: 'Adult activity: an overview', url: 'https://www.cdc.gov/physical-activity-basics/guidelines/adults.html' },
  'cdc-older': { org: 'CDC', title: 'Older adult activity: an overview', url: 'https://www.cdc.gov/physical-activity-basics/guidelines/older-adults.html' },
  'cdc-intensity': { org: 'CDC', title: 'Measuring physical activity intensity', url: 'https://www.cdc.gov/physical-activity-basics/measuring/index.html' },
  'nia-types': { org: 'NIH · NIA', title: 'Three types of exercise can improve your health and physical ability', url: 'https://www.nia.nih.gov/health/exercise-and-physical-activity/four-types-exercise-can-improve-your-health-and-physical' },
  'nhs-older': { org: 'NHS', title: 'Physical activity guidelines for older adults', url: 'https://www.nhs.uk/live-well/exercise/physical-activity-guidelines-older-adults/' },
  'nhs-strength': { org: 'NHS', title: 'Strength exercises', url: 'https://www.nhs.uk/live-well/exercise/strength-and-flexibility-exercises/strength-exercises/' },
  'nhs-balance': { org: 'NHS', title: 'Balance exercises', url: 'https://www.nhs.uk/live-well/exercise/strength-and-flexibility-exercises/balance-exercises/' },
  'nhs-sitting': { org: 'NHS', title: 'Sitting exercises', url: 'https://www.nhs.uk/live-well/exercise/strength-and-flexibility-exercises/sitting-exercises/' },
  'nhs-flex': { org: 'NHS', title: 'Flexibility exercises', url: 'https://www.nhs.uk/live-well/exercise/strength-and-flexibility-exercises/flexibility-exercises/' },
  'nhs-back': { org: 'NHS', title: 'Back pain', url: 'https://www.nhs.uk/conditions/back-pain/' },
  'nhs-insomnia': { org: 'NHS', title: 'Insomnia', url: 'https://www.nhs.uk/conditions/insomnia/' },
  'nhs-depression': { org: 'NHS', title: 'Exercise for depression', url: 'https://www.nhs.uk/mental-health/self-help/guides-tools-and-activities/exercise-for-depression/' },
  'nice-ng59': { org: 'NICE', title: 'NG59 Low back pain and sciatica in over 16s', url: 'https://www.nice.org.uk/guidance/ng59/chapter/Recommendations' },
  'nice-ng226': { org: 'NICE', title: 'NG226 Osteoarthritis in over 16s', url: 'https://www.nice.org.uk/guidance/ng226/chapter/Recommendations' },
  'nice-ng222': { org: 'NICE', title: 'NG222 Depression in adults', url: 'https://www.nice.org.uk/guidance/ng222/chapter/Recommendations' },
  'acsm-progression': { org: 'ACSM (Med Sci Sports Exerc 2009)', title: 'Progression models in resistance training for healthy adults', url: 'https://europepmc.org/article/MED/19204579' },
  'acsm-quantity': { org: 'ACSM (Med Sci Sports Exerc 2011)', title: 'Quantity and quality of exercise for healthy adults', url: 'https://europepmc.org/article/MED/21694556' },
  'acsm-htn': { org: 'ACSM (Med Sci Sports Exerc 2004)', title: 'Exercise and hypertension', url: 'https://europepmc.org/article/MED/15076798' },
  'aha-rt': { org: 'American Heart Association (Circulation 2024)', title: 'Resistance exercise training: 2023 update', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC11209834/' },
  'ada-pa': { org: 'American Diabetes Association (Diabetes Care 2016)', title: 'Physical activity/exercise and diabetes', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6908414/' },
  'icfsr-sarcopenia': { org: 'ICFSR (J Nutr Health Aging 2018)', title: 'International clinical practice guidelines for sarcopenia', url: 'https://europepmc.org/article/MED/30498820' },
  'prot-age': { org: 'PROT-AGE Study Group (JAMDA 2013)', title: 'Optimal dietary protein intake in older people', url: 'https://europepmc.org/article/MED/23867520' },
  'falls-world': { org: 'World Falls Guidelines (Age Ageing 2022)', title: 'World guidelines for falls prevention and management', url: 'https://europepmc.org/article/PMC/PMC9523684' },
  'ros-osteoporosis': { org: 'Royal Osteoporosis Society consensus (Br J Sports Med 2022)', title: 'Strong, steady and straight', url: 'https://europepmc.org/article/PMC/PMC9304091' },
  'bedrest-older': { org: 'J Gerontol A (2008)', title: 'Functional impact of 10 days of bed rest in healthy older adults', url: 'https://europepmc.org/article/MED/18948558' },
} as const satisfies Record<string, CoachSource>

export type CoachSourceId = keyof typeof COACH_SOURCES

/** One sourced rule: plain-language text, the verbatim quote and where it comes from. */
export type CoachRule = { id: string; t: string; q: string; s: CoachSourceId }

const R = (id: string, s: CoachSourceId, t: string, q: string): CoachRule => ({ id, t, q, s })

export const COACH_RULES = {
  // ------------------------------------------------------------ general dose
  adultsWeekly: R('adultsWeekly', 'cdc-adults', 'Adults need about 150 minutes of moderate activity a week plus muscle strengthening on at least 2 days.', 'In addition, adults need at least 2 days of muscle-strengthening activity each week.'),
  allMuscles: R('allMuscles', 'cdc-older', 'Strength work on 2 or more days should cover all major muscle groups.', 'Muscle-strengthening activities on 2 or more days a week that work all major muscle groups'),
  olderWeekly: R('olderWeekly', 'nhs-older', 'Older adults should do strength, balance and flexibility activities on at least 2 days a week.', 'do activities that improve strength, balance and flexibility on at least 2 days a week'),
  abilities: R('abilities', 'cdc-older', 'If a condition limits you, do as much as your abilities allow — some activity beats none.', 'If you have trouble meeting these recommendations, be as physically active as your abilities and conditions allow.'),
  anyAmount: R('anyAmount', 'who-pa', 'Any amount of activity is better than none.', 'any amount of physical activity is better than none'),
  sedentary: R('sedentary', 'who-pa', 'Limit time spent sitting.', 'all age groups should limit the amount of time being sedentary'),
  setsReps: R('setsReps', 'nia-types', 'One set of 8–12 repetitions works; two or three sets may work better.', 'One set of eight to 12 repetitions of each exercise is effective, although two or three sets may be more effective.'),
  toEffort: R('toEffort', 'nia-types', 'Strength exercises should reach the point where another repetition would be difficult.', 'be performed to the point at which it would be difficult to do another repetition'),
  noConsecutive: R('noConsecutive', 'nia-types', 'Do not work the same muscle group two days in a row.', 'avoid working the same muscle group on any two days in a row to allow for muscle recovery between sessions'),
  beginnerNoWeights: R('beginnerNoWeights', 'nia-types', 'Beginners start without weights or bands until the movement feels comfortable.', 'If you are a beginner, try exercises without weights or resistance bands'),
  gradual: R('gradual', 'nia-types', 'Gradual increases in weight, sets, repetitions or days make muscles stronger.', 'Gradual increases in the amount of weight, number of sets or repetitions, or the number of days a week of exercise will result in stronger muscles.'),
  buildSlowly: R('buildSlowly', 'nhs-strength', 'Build up slowly, adding repetitions over time.', 'Build up slowly'),
  rest: R('rest', 'acsm-progression', 'Rest 1–2 minutes between strength sets.', 'emphasis on the 6-12 RM zone using 1- to 2-min rest periods between sets'),
  loadStep: R('loadStep', 'acsm-progression', 'A load increase of 2–10% is appropriate once you can do 1–2 repetitions more than the target.', 'it is recommended that 2-10% increase in load be applied when the individual can perform the current workload for one to two repetitions over the desired number'),
  novice: R('novice', 'acsm-progression', 'Novices train strength 2–3 days a week with loads they can lift 8–12 times.', 'The recommendation for training frequency is 2-3 d x wk(-1) for novice training'),
  flexibility: R('flexibility', 'acsm-quantity', 'Stretch each major muscle group on at least 2 days a week, about 60 seconds per stretch in total.', 'completing a series of flexibility exercises for each the major muscle-tendon groups (a total of 60 s per exercise) on ≥2 d·wk is recommended'),
  progressionSafety: R('progressionSafety', 'acsm-quantity', 'Gradual progression of intensity and volume may reduce the risks of exercise.', 'gradual progression of exercise intensity and volume may reduce the risks of exercise'),
  talkTest: R('talkTest', 'cdc-intensity', 'Moderate effort: you can talk, but not sing.', 'a person doing moderate-intensity aerobic activity can talk, but not sing, during the activity'),
  effortScale: R('effortScale', 'cdc-intensity', 'On a 0–10 effort scale, moderate is 5 or 6 and vigorous starts at 7 or 8.', 'Relatively moderate-intensity activity is a level of effort of 5 or 6 on a scale of 0 to 10'),
  warmUp: R('warmUp', 'nia-types', 'Warm up and cool down with a little light activity such as easy walking.', 'Do a little light activity, such as easy walking, before and after your aerobic activities to warm up and cool down.'),
  breathing: R('breathing', 'nia-types', 'Never hold your breath during strength exercises: breathe out on the effort.', 'Don’t hold your breath during strength exercises — breathe out during the effort and breathe in as you relax.'),
  warningSigns: R('warningSigns', 'aha-rt', 'Dizziness, unusual breathlessness, chest pain or palpitations mean stop and get checked before training again.', 'adverse signs and symptoms (eg, dizziness, excessive dyspnea, chest pain and pressure, palpitations) require immediate medical evaluation'),
  aerobicSigns: R('aerobicSigns', 'nia-types', 'Aerobic activity should not cause dizziness, chest pain or pressure, or nausea.', 'Aerobic activities should not cause dizziness, chest pain or pressure, or nausea.'),
  chair: R('chair', 'nhs-strength', 'Use a solid chair without wheels that will not slip.', 'choose a solid, stable chair that does not have wheels and that will not slip'),
  stretchSafe: R('stretchSafe', 'nia-types', 'Stretch after warming up, keep breathing and never stretch so far that it hurts.', 'remember to breathe, and don’t stretch so far that it hurts'),

  // ------------------------------------------------------------ space
  spaceSchedule: R('spaceSchedule', 'nasa-tb031', 'Long missions schedule exercise 6–7 days a week.', '6-7 days/week'),
  spaceAerobic: R('spaceAerobic', 'nasa-tb031', 'Aerobic work in flight is about 30 minutes of interval or steady exercise.', 'Approximately 30 minutes of interval or steady-state exercise'),
  spaceResistive: R('spaceResistive', 'nasa-tb031', 'Resistive work in flight is 30–60 minutes of load-bearing training.', '30-60 minutes load-bearing training'),
  spaceStrengthStd: R('spaceStrengthStd', 'nasa-tb031', 'NASA’s standard: keep in-mission muscle strength at or above 80% of baseline.', 'Countermeasures shall maintain in-mission skeletal muscle strength at or above 80% of baseline values.'),
  spaceBoneLoss: R('spaceBoneLoss', 'nasa-tb031', 'Bone loss in flight is estimated at 1–1.5% per month.', 'Bone loss is a known risk of spaceflight with estimates ranging from potential loss of 1-1.5 % loss per month.'),
  spaceVolume: R('spaceVolume', 'nasa-tb031', 'Resistance and treadmill volume were the key countermeasure factors.', 'Resistance and treadmill volume loads were the key countermeasure factors'),
  spaceAtrophy: R('spaceAtrophy', 'nasa-exercise', 'Without gravity, bone and muscle become smaller and weaker.', 'Without Earth\'s gravity, both bone and muscle atrophy, or become smaller and weaker.'),
  spaceSpecialist: R('spaceSpecialist', 'nasa-tb031', 'NASA exercise specialists write each crew member’s prescription from their ability and performance.', 'develop exercise prescriptions based on crew ability and performance'),
  spaceIntensity: R('spaceIntensity', 'nasa-exercise', 'High-intensity, lower-volume training gave similar results in less crew time.', 'The outcomes were similar, but shorter workouts save crew time'),
  cevisDose: R('cevisDose', 'nasa-tb031', 'CEVIS work rates are prescribed from the pre-flight fitness test.', 'CEVIS protocols were developed using the pre-flight VO2peak test with prescribed work rates between 70-100% VO2peak.'),
  t2Dose: R('t2Dose', 'nasa-tb031', 'T2 treadmill sessions are prescribed from heart rate.', 'T2 protocols were based on pre-flight training and prescribed at 70–100% HRmax.'),
  aredExercises: R('aredExercises', 'esa-ared', 'ARED sessions include squats, single-leg squats, wide-stance squats and deadlifts.', 'including standard squats, single-leg squats, wide-stance squats and deadlift pulls,'),
  aredHeelRaise: R('aredHeelRaise', 'nasa-ared-1rm', 'Squat, heel raise and deadlift are standard ARED strength exercises.', 'During each session, 1RM was measured for the squat, heel raise, and deadlift exercises.'),

  // ------------------------------------------------------------ focus areas
  sarcopeniaAge: R('sarcopeniaAge', 'icfsr-sarcopenia', 'Age-related loss of muscle mass and function (sarcopenia) affects about 6–22% of older adults.', 'Sarcopenia, defined as an age-associated loss of skeletal muscle function and muscle mass, occurs in approximately 6 - 22 % of older adults.'),
  sarcopeniaRT: R('sarcopeniaRT', 'icfsr-sarcopenia', 'For age-related muscle loss, resistance training is strongly recommended.', 'To treat sarcopenia, we strongly recommend the prescription of resistance-based physical activity'),
  sarcopeniaProtein: R('sarcopeniaProtein', 'icfsr-sarcopenia', 'A protein-rich diet is conditionally recommended alongside it.', 'conditionally recommend protein supplementation/a protein-rich diet'),
  protein: R('protein', 'prot-age', 'People over 65 are advised at least 1.0–1.2 g of protein per kg of body weight a day, more if active.', 'the PROT-AGE study group recommends average daily intake at least in the range of 1.0 to 1.2 g protein per kilogram of body weight per day'),
  proteinKidney: R('proteinKidney', 'prot-age', 'Severe kidney disease is an exception: protein may need to be limited — ask your doctor.', 'Older people with severe kidney disease (ie, estimated GFR <30 mL/min/1.73 m(2)), but who are not on dialysis, are an exception to this rule'),
  bedRest: R('bedRest', 'bedrest-older', 'Ten days of bed rest cut leg strength in healthy older adults.', '10 days of bed rest results in a substantial loss of lower extremity strength, power, and aerobic capacity'),
  muscleDisuse: R('muscleDisuse', 'nia-types', 'Strength work slows the loss of muscle mass and helps prevent falls.', 'This type of exercise is also key to maintaining existing strength, slowing the loss of muscle mass'),
  boneResistImpact: R('boneResistImpact', 'ros-osteoporosis', 'For bone: resistance and impact exercise, strength and balance, and back-extension work.', 'people with osteoporosis should undertake (1) resistance and impact exercise to maximise bone strength'),
  boneImpactDose: R('boneImpactDose', 'ros-osteoporosis', 'Moderate impact (stamping, jogging, low jumps) on most days, about 50 impacts a session — for people without spine fractures.', 'Moderate impact exercise is recommended on most days to promote bone strength (eg, stamping, jogging, low-level jumping, hopping) to include at least 50 impacts per session'),
  boneProgressive: R('boneProgressive', 'ros-osteoporosis', 'Muscle strengthening for bone should be progressive.', 'For maximum benefit, muscle strengthening should include progressive muscle resistance training.'),
  boneSets: R('boneSets', 'ros-osteoporosis', 'Use a weight you can lift 8–12 times, building up to three sets.', 'In practice, this is the maximum that can be lifted 8–12 times (building up to three sets for each exercise).'),
  boneExtension: R('boneExtension', 'ros-osteoporosis', 'Back-extension exercises: 3–5 repeats held for 3–5 seconds, at least twice a week.', 'Aim for exercises repeated 3–5 times and held for 3–5 s at least twice a week.'),
  osteoFlexion: R('osteoFlexion', 'ros-osteoporosis', 'With osteoporosis, avoid postures with a lot of forward bending of the spine.', 'For safety, we recommend avoiding postures involving a high degree of spinal flexion during exercise or daily life.'),
  osteoEndRange: R('osteoEndRange', 'ros-osteoporosis', 'Sustained, repeated or end-range forward bending should be modified or avoided.', 'Movements or exercise that involve sustained, repeated or end-range flexion should be modified or avoided.'),
  osteoCurlUp: R('osteoCurlUp', 'ros-osteoporosis', 'Swap curl-ups and roll-downs for other core exercises.', 'As a precaution, alternatives to exercises such as the ‘roll down ‘and ‘curl up’ in Pilates should be considered.'),
  osteoImpactCap: R('osteoImpactCap', 'ros-osteoporosis', 'With spine fractures or several low-trauma fractures, keep impact to brisk-walking level.', 'People with vertebral fracture or multiple low trauma fractures should usually exercise only up to an impact equivalent to brisk walking.'),
  osteoThinkStraight: R('osteoThinkStraight', 'ros-osteoporosis', 'Keep the upper back straight whenever you bend and lift.', '‘Think straight’—a straight upper back (and keeping the neck in line with the spine) is the key principle for all movements that involve bending and lifting.'),
  fallsStart: R('fallsStart', 'ros-osteoporosis', 'People at risk of falls should start with targeted strength and balance training.', 'Those at risk of falls should start with targeted strength and balance training.'),
  fallsDose: R('fallsDose', 'falls-world', 'Fall prevention: balance-challenging and functional exercise three or more times a week, progressed for at least 12 weeks.', 'should be offered with sessions three times or more weekly which are individualised, progressed in intensity for at least 12 weeks'),
  fallsChallenge: R('fallsChallenge', 'falls-world', 'Balance work should be challenging but safe and achievable.', 'Exercises should be challenging (to enhance neural, muscular and skeletal function) but safe (to prevent injuries) and achievable'),
  balanceThree: R('balanceThree', 'nia-types', 'Aim for about three balance sessions a week.', 'Aim for about three sessions of balance exercises a week.'),
  balanceSupport: R('balanceSupport', 'nia-types', 'Have a sturdy chair, person or wall within reach during balance exercises.', 'Have a sturdy chair, person, or wall nearby to hold onto for support.'),
  balanceNearWall: R('balanceNearWall', 'nhs-balance', 'Do balance exercises near a wall or stable chair.', 'exercises near a wall or a stable chair just in case you lose your balance'),
  backGroup: R('backGroup', 'nice-ng59', 'For low back pain, an exercise programme (strengthening, aerobic, mind–body or a mix) is recommended.', 'Consider a group exercise programme (biomechanical, aerobic, mind–body or a combination of approaches)'),
  backActive: R('backActive', 'nhs-back', 'With back pain, stay active and avoid long periods in bed.', 'stay active and try to continue with your daily activities'),
  backStop: R('backStop', 'nhs-back', 'Stop a back exercise if the pain gets worse and see a doctor.', 'But stop if your pain gets worse and see a GP for advice.'),
  backRedFlag: R('backRedFlag', 'nhs-back', 'Back pain with numbness around the genitals or bladder or bowel changes is an emergency.', 'a loss of feeling around your genitals or anus'),
  htnEndurance: R('htnEndurance', 'acsm-htn', 'For blood pressure, endurance exercise comes first, supplemented by resistance work.', 'Type: primarily endurance physical activity supplemented by resistance exercise.'),
  htnLowers: R('htnLowers', 'acsm-htn', 'Endurance exercise lowers blood pressure in people with and without hypertension.', 'Exercise programs that primarily involve endurance activities prevent the development of HTN and lower blood pressure (BP) in adults with normal BP and those with HTN.'),
  htnRT: R('htnRT', 'aha-rt', 'With controlled high blood pressure, low-to-moderate strength training with proper breathing is safe.', 'Patients with controlled hypertension can safely participate in low- to moderate-intensity RT with proper breathing techniques.'),
  htnCooldown: R('htnCooldown', 'aha-rt', 'If you take blood-pressure medicine, use a longer cool-down.', 'patients taking antihypertensive medications should incorporate extended cooldowns to prevent hypotension'),
  rtClearance: R('rtClearance', 'aha-rt', 'With heart disease, ask a doctor about contraindications before starting strength training.', 'Before initiating an RT program, patients should consult with a physician for absolute and relative contraindications.'),
  rtDose: R('rtDose', 'aha-rt', 'One set of 8–12 repetitions at a moderate load, 8–10 exercises, twice a week is highly effective.', 'a single set of 8 to 12 repetitions to volitional fatigue, using moderate weight loads of 40% to 60% of 1-RM, for 8 to 10 different exercises involving major muscle groups, performed twice per week are highly effective'),
  dmBoth: R('dmBoth', 'ada-pa', 'With type 2 diabetes, do both aerobic and resistance training.', 'Adults with type 2 diabetes should ideally perform both aerobic and resistance exercise training for optimal glycemic and health outcomes.'),
  dmGap: R('dmGap', 'ada-pa', 'Do not let more than 2 days pass between exercise sessions.', 'Daily exercise, or at least not allowing more than 2 days to elapse between exercise sessions, is recommended to enhance insulin action.'),
  dmResistance: R('dmResistance', 'ada-pa', 'Resistance exercise 2–3 times a week on non-consecutive days.', 'Adults with diabetes should engage in 2–3 sessions/week of resistance exercise on nonconsecutive days.'),
  dmSitting: R('dmSitting', 'ada-pa', 'Break up sitting with light activity every 30 minutes.', 'Prolonged sitting should be interrupted with bouts of light activity every 30 min for blood glucose benefits'),
  dmPostMeal: R('dmPostMeal', 'ada-pa', 'With type 2 diabetes, walking after meals improves blood-sugar control.', 'interrupting prolonged sitting with 15 min of postmeal walking'),
  dmOrder: R('dmOrder', 'ada-pa', 'Doing resistance before aerobic exercise in one session lowers the risk of a hypo (type 1 diabetes).', 'performing resistance exercise first results in less hypoglycemia than when aerobic exercise is performed first'),
  moodGroup: R('moodGroup', 'nice-ng222', 'For depression, a programme of moderate aerobic exercise, usually more than once a week for 10 weeks, is a recommended option.', 'Usually consists of more than 1 session per week for 10 weeks.'),
  moodModerate: R('moodModerate', 'nice-ng222', 'It includes moderate-intensity aerobic exercise.', 'Includes moderate intensity aerobic exercise.'),
  moodAny: R('moodAny', 'nhs-depression', 'Even a brisk 10-minute walk can help clear your mind.', 'Any exercise is better than none and even a brisk 10-minute walk can clear your mind and help you relax.'),
  moodEnjoy: R('moodEnjoy', 'nhs-depression', 'Pick exercise you enjoy, so you keep doing it.', 'Exercise should be something you enjoy'),
  sleepDaytime: R('sleepDaytime', 'nhs-insomnia', 'For poor sleep: exercise regularly during the day.', 'exercise regularly during the day'),
  sleepLate: R('sleepLate', 'nhs-insomnia', 'Do not exercise in the 4 hours before bed.', 'do not exercise at least 4 hours before bed'),
  oaExercise: R('oaExercise', 'nice-ng226', 'For joint pain from osteoarthritis: tailored exercise — local muscle strengthening and general aerobic fitness.', 'offer therapeutic exercise tailored to their needs (for example, local muscle strengthening, general aerobic fitness)'),
  oaPain: R('oaPain', 'nice-ng226', 'Joint pain may increase at first when you start exercising.', 'Advise people with osteoarthritis that joint pain may increase when they start therapeutic exercise.'),
} as const satisfies Record<string, CoachRule>

export type CoachRuleId = keyof typeof COACH_RULES

export const ruleSource = (id: CoachRuleId): CoachSource => COACH_SOURCES[COACH_RULES[id].s]

/** The core guidance for each focus area (always listed under "How this plan was built"). */
export const FOCUS_RULES: Record<FocusId, CoachRuleId[]> = {
  muscle: ['sarcopeniaRT', 'setsReps', 'noConsecutive', 'muscleDisuse', 'sarcopeniaProtein'],
  bone: ['boneResistImpact', 'boneProgressive', 'boneSets', 'boneExtension', 'boneImpactDose'],
  balance: ['fallsDose', 'fallsChallenge', 'balanceThree', 'balanceSupport'],
  back: ['backGroup', 'backActive', 'backStop'],
  bp: ['htnEndurance', 'htnLowers', 'htnRT', 'breathing'],
  glucose: ['dmBoth', 'dmGap', 'dmResistance', 'dmSitting'],
  mood: ['moodGroup', 'moodModerate', 'moodAny', 'moodEnjoy'],
  sleep: ['sleepDaytime', 'sleepLate'],
  joints: ['oaExercise', 'oaPain'],
  fitness: ['adultsWeekly', 'allMuscles', 'flexibility', 'talkTest'],
}
