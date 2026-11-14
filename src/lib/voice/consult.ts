// Voice-side driver for the offline consultation engine (src/lib/doctor). It mirrors the question flow of
// components/aura/Consultation.tsx and only turns the engine's own wording into spoken text.
import { CONDITION_BY_ID } from '../../data/conditions'
import type { HealthProfile } from '../../data/conditions/profile'
import type { Context } from '../../data/contexts'
import { assess, carePlan, firstStep, parseFindings, FINDING_BY_ID, URGENCY_TEXT, type Answer, type Answers, type Assessment, type CarePlan, type Readings } from '../doctor'

export const MAX_QUESTIONS = 7

export type ConsultState = { answers: Answers; asked: string[]; pending: string | null; done: boolean }
export const newConsult = (): ConsultState => ({ answers: {}, asked: [], pending: null, done: false })

export type ConsultCtx = { context: Context; readings: Readings; profile: HealthProfile | null; delaySec: number }
export type ConsultStep = { state: ConsultState; say: string; emergency: boolean; assessment: Assessment | null; plan: CarePlan | null }

/** Spoken emergency text: where to turn first, then the plan's "do this now" steps word for word. */
export function emergencyPlan(a: Assessment, c: ConsultCtx): { plan: CarePlan | null; text: string } {
  const top = a.candidates[0]
  const plan = top ? carePlan(CONDITION_BY_ID[top.condition.id] ?? top.condition, a, c.context, c.profile, c.delaySec) : null
  const steps = plan ? plan.steps.slice(0, 3).map((s) => s.text) : []
  const first = plan?.first ?? firstStep(a.urgency, c.context, c.delaySec)
  const head = `${URGENCY_TEXT[a.urgency].title}.`
  const named = plan ? ` This is consistent with ${plan.name.toLowerCase()}.` : ''
  const text = [head + named, first, steps.length ? `Do this now. ${steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}` : ''].filter(Boolean).join(' ')
  return { plan, text }
}

function summary(a: Assessment, c: ConsultCtx): { plan: CarePlan | null; text: string } {
  const top = a.candidates[0]
  const plan = top ? carePlan(top.condition, a, c.context, c.profile, c.delaySec) : null
  const lines = [`Thank you. ${URGENCY_TEXT[a.urgency].title}.`]
  if (top) lines.push(`Your answers are most consistent with ${top.condition.name.toLowerCase()}, a ${top.strength} match. This is not a diagnosis.`)
  else lines.push('I could not find a clear match. This is not a diagnosis.')
  lines.push(plan?.first ?? firstStep(a.urgency, c.context, c.delaySec))
  lines.push('Open the AURA tab for the full assessment, the steps and the sources.')
  return { plan, text: lines.join(' ') }
}

/** One turn of the consultation. Give either free text (symptoms) or a yes / no / unsure answer to the pending question. */
export function consultStep(state: ConsultState, c: ConsultCtx, input: { text?: string; answer?: Answer }): ConsultStep {
  let answers = state.answers
  const noted: string[] = []
  if (input.answer) {
    if (!state.pending) return { state, say: 'There is no question waiting. Tell me a symptom, for example chest pain or dizzy.', emergency: false, assessment: null, plan: null }
    answers = { ...answers, [state.pending]: input.answer }
  } else if (input.text?.trim()) {
    const { answers: found } = parseFindings(input.text)
    const ids = Object.keys(found)
    if (!ids.length) return { state, say: 'I could not match that to symptoms I know. Try short phrases such as chest pain or dizzy.', emergency: false, assessment: null, plan: null }
    answers = { ...answers, ...found }
    const yes = ids.filter((id) => found[id] === 'yes').map((id) => FINDING_BY_ID[id].label.toLowerCase())
    const no = ids.filter((id) => found[id] === 'no').map((id) => FINDING_BY_ID[id].label.toLowerCase())
    noted.push(`I noted${yes.length ? `: ${yes.join('; ')}` : ''}${no.length ? `${yes.length ? '. ' : ' '}Not present: ${no.join('; ')}` : ''}.`)
  } else {
    return { state: { ...state, pending: null }, say: 'Tell me what is bothering you, in your own words.', emergency: false, assessment: null, plan: null }
  }

  const a = assess({ answers, context: c.context, readings: c.readings, profile: c.profile })
  const yes = Object.values(answers).some((v) => v === 'yes')
  const base = { answers, asked: state.asked, pending: null as string | null, done: false }

  if (a.urgency === 'emergency') {
    const e = emergencyPlan(a, c)
    return { state: { ...base, done: true }, say: e.text, emergency: true, assessment: a, plan: e.plan }
  }
  if (yes && a.next && state.asked.length < MAX_QUESTIONS) {
    return { state: { ...base, asked: [...state.asked, a.next.id], pending: a.next.id }, say: [...noted, a.next.question].join(' '), emergency: false, assessment: a, plan: null }
  }
  if (yes) {
    const s = summary(a, c)
    return { state: { ...base, done: true }, say: [...noted, s.text].join(' '), emergency: false, assessment: a, plan: s.plan }
  }
  return { state: base, say: [...noted, 'Tell me about a symptom you do have.'].join(' '), emergency: false, assessment: a, plan: null }
}
