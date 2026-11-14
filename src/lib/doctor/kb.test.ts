// The 2026-11 knowledge-base extension: integrity of every entry, English/Turkish symptom understanding (with the
// look-alike words that once caused real bugs), end-to-end assessments for the new conditions, and the interview's
// safety ordering and question cap.
import { describe, expect, it } from 'vitest'
import { CONDITION_BY_ID, CONDITIONS, SOURCES, type Condition, type Urgency } from '../../data/conditions'
import { ALLERGIES, emptyProfile, KNOWN_CONDITIONS, MEDICINES, type HealthProfile } from '../../data/conditions/profile'
import { consultStep, MAX_QUESTIONS, newConsult, type ConsultCtx } from '../voice/consult'
import { correct } from '../voice/fuzzy'
import { assess, type Answers } from './engine'
import { FINDING_BY_ID, FINDINGS } from './findings'
import { localise } from './localise'
import { parseFindings } from './parse'
import { carePlan } from './plan'

const NOW = Date.parse('2026-11-14T12:00:00Z')
const profile = (p: Partial<HealthProfile> = {}): HealthProfile => ({ ...emptyProfile(), updatedAt: '2026-11-01T00:00:00Z', ...p })
const run = (answers: Answers, context: 'space' | 'polar' | 'home' = 'home') => assess({ answers, context, profile: profile(), now: NOW })
const yes = (...ids: string[]): Answers => Object.fromEntries(ids.map((id) => [id, 'yes']))
const NEW = ['uti', 'gastroenteritis', 'constipation', 'appendicitis', 'reflux', 'stomach-ulcer', 'hyperglycaemia', 'urinary-retention', 'dental-abscess', 'chest-infection', 'common-cold', 'headache-warning', 'migraine', 'tension-headache', 'concussion', 'seizure', 'fainting', 'vertigo', 'atrial-fibrillation', 'dvt', 'pulmonary-embolism', 'postural-hypotension', 'delirium', 'space-congestion', 'nosebleed', 'burn', 'severe-bleeding', 'sprain-strain', 'eye-injury', 'conjunctivitis', 'cellulitis', 'contact-dermatitis', 'shingles', 'gout', 'pressure-sores', 'chilblains', 'trench-foot']

const referenced = (c: Condition) => [
  ...c.findings.map((f) => f.id),
  ...[...(c.emergencyIf ?? []), ...(c.urgentIf ?? [])].flatMap((r) => (r.need ?? []).flat()),
  ...(c.against ?? []).flatMap((a) => (a.finding ? [a.finding] : [])),
]

describe('knowledge base integrity (all entries, old and new)', () => {
  it('has the extension: 37 new conditions, ids the server accepts', () => {
    for (const id of NEW) expect(CONDITION_BY_ID[id], id).toBeTruthy()
    expect(CONDITIONS.length).toBeGreaterThanOrEqual(63)
    expect(new Set(CONDITIONS.map((c) => c.id)).size).toBe(CONDITIONS.length)
    // public/api/routes/clinic.php: condition id /^[a-z0-9-]{1,48}$/, finding id /^[a-z0-9-]{1,40}$/
    for (const c of CONDITIONS) expect(c.id).toMatch(/^[a-z0-9-]{1,48}$/)
    for (const f of FINDINGS) expect(f.id).toMatch(/^[a-z0-9-]{1,40}$/)
    expect(new Set(FINDINGS.map((f) => f.id)).size).toBe(FINDINGS.length)
  })
  it('every displayed statement has text, a verbatim quote and a known https source', () => {
    let n = 0
    for (const c of CONDITIONS) {
      expect(c.ev.summary?.length, `${c.id} summary`).toBeGreaterThan(0)
      expect((c.ev.action?.length ?? 0) + (c.ev.escalate?.length ?? 0), `${c.id} action/escalate`).toBeGreaterThan(0)
      for (const [kind, list] of Object.entries(c.ev)) {
        if (kind === 'meds') continue
        for (const x of list as { t: string; q: string; s: string }[]) {
          expect(x.t.trim().length, `${c.id}.${kind} text`).toBeGreaterThan(3)
          expect(x.q.trim().length, `${c.id}.${kind} quote`).toBeGreaterThan(5)
          expect(SOURCES[x.s]?.url, `${c.id}.${kind} source ${x.s}`).toMatch(/^https:\/\//)
          n++
        }
      }
      for (const m of c.ev.meds ?? []) {
        expect(m.q.length, `${c.id} med ${m.name}`).toBeGreaterThan(10)
        expect(SOURCES[m.s]?.url, `${c.id} med source`).toMatch(/^https:\/\//)
        for (const k of m.cautions) {
          expect(k.q.length).toBeGreaterThan(5)
          expect(SOURCES[k.s]?.url, `${c.id} caution source ${k.s}`).toMatch(/^https:\/\//)
          expect(Array.isArray(k.tags)).toBe(true)
        }
      }
    }
    expect(n).toBeGreaterThan(1300)
  })
  it('every finding referenced by a condition, a rule or an against entry exists, with a question', () => {
    for (const c of CONDITIONS) for (const id of referenced(c)) expect(FINDING_BY_ID[id], `${c.id} -> ${id}`).toBeTruthy()
    for (const f of FINDINGS) {
      expect(f.question.trim().endsWith('?'), f.id).toBe(true)
      expect(f.match.length, f.id).toBeGreaterThan(0)
      for (const m of f.match) expect(() => new RegExp(m), `${f.id}: ${m}`).not.toThrow()
    }
  })
  it('profile factors only use ids the health profile (and the server) already know', () => {
    const cond = new Set(KNOWN_CONDITIONS.map((c) => c.id))
    const med = new Set(MEDICINES.map((c) => c.id))
    for (const c of CONDITIONS)
      for (const f of c.factors ?? []) {
        if (f.kind !== 'profile') continue
        if (f.condition) expect(cond.has(f.condition), `${c.id} ${f.condition}`).toBe(true)
        if (f.medicine) expect(med.has(f.medicine), `${c.id} ${f.medicine}`).toBe(true)
      }
    expect(KNOWN_CONDITIONS.length + ALLERGIES.length + MEDICINES.length).toBe(38) // profile.ts allow-list unchanged (mirrored in PHP)
  })
  it('every new condition has at least one red-flag or escalation statement, except where the source gives none', () => {
    const none = new Set(['constipation', 'space-congestion', 'trench-foot', 'urinary-retention', 'postural-hypotension'])
    for (const id of NEW) {
      const c = CONDITION_BY_ID[id]
      if (none.has(id)) continue
      expect((c.ev.redflag?.length ?? 0) + (c.ev.escalate?.length ?? 0), id).toBeGreaterThan(0)
    }
  })
})

describe('symptom understanding (English and Turkish)', () => {
  const cases: [string, string[]][] = [
    ['It burns when I pee and I need to pee all the time', ['painful-urination', 'urinate-often']],
    ['İdrarımda yanma var ve sık sık idrara çıkıyorum', ['painful-urination', 'urinate-often']],
    ['I have diarrhoea and stomach cramps', ['diarrhoea', 'tummy-pain']],
    ['İshalim var, midem ağrıyor', ['diarrhoea', 'tummy-pain']],
    ['the pain moved to the lower right side of my tummy', ['pain-lower-right']],
    ['Karnımın sağ alt tarafı ağrıyor', ['pain-lower-right']],
    ['I threw up blood', ['vomit-blood', 'vomiting']],
    ['Kan kustum', ['vomit-blood']],
    ['my poo is black and sticky', ['black-stool']],
    ['my blood sugar is high and my breath smells fruity', ['high-sugar', 'fruity-breath']],
    ['Şekerim çok yüksek', ['high-sugar']],
    ['I have a migraine with flashing lights and bright light hurts', ['visual-aura', 'light-sensitive']],
    ['tight band around my head', ['head-band-pressure']],
    ['I hit my head and now I keep being sick', ['head-injury', 'vomiting']],
    ['Kafamı çarptım', ['head-injury']],
    ['he is having a seizure', ['fit']],
    ['Nöbet geçirdi', ['fit']],
    ["my nose won't stop bleeding", ['nosebleed', 'bleeding-wont-stop']],
    ['Burnum kanıyor', ['nosebleed']],
    ['I burned my hand on the stove', ['burn']],
    ['Elim yandım, haşlandı', ['burn']],
    ['I twisted my ankle. My ankle is swollen', ['joint-twist', 'limb-pain-swelling']],
    ['Ayağımı burktum', ['joint-twist']],
    ['bleach splashed in my eye', ['eye-chemical']],
    ['red eyes, sticky eyes', ['eye-red', 'eye-sticky']],
    ['I have toothache and my cheek is swollen', ['toothache', 'face-swelling']],
    ['Dişim ağrıyor', ['toothache']],
    ['my calf is swollen and painful', ['calf-pain-swelling']],
    ['coughing up blood', ['cough-blood', 'cough']],
    ['coughing up green phlegm', ['phlegm']],
    ['blocked nose and a sore throat', ['blocked-nose', 'sore-throat']],
    ['Burnum tıkalı, boğazım ağrıyor', ['blocked-nose', 'sore-throat']],
    ['I feel dizzy when I stand up', ['dizzy-standing', 'lightheaded']],
    ['she suddenly became confused', ['confusion-sudden', 'confusion']],
    ['the room is spinning and I have ringing in my ears', ['spinning', 'hearing-loss']],
    ['stiff neck and a headache', ['stiff-neck', 'headache']],
    ['a painful rash in a band on one side', ['rash-one-side']],
    ['my big toe is red, hot and swollen', ['joint-hot-swollen']],
    ['he has a pressure sore on his heel', ['pressure-sore']],
    ['my feet have been wet for two days', ['wet-cold-feet']],
    ['itchy red toes after the cold', ['chilblain-patches']],
    ['my face is puffy and my nose is congested', ['face-puffy', 'blocked-nose']],
    ['I have pressure in my chest', ['chest-pain']],
  ]
  it.each(cases)('%s', (text, ids) => {
    const { answers } = parseFindings(text)
    for (const id of ids) expect(answers[id], `${id} in "${text}"`).toBe('yes')
  })
  it('look-alike words do not match the wrong symptom', () => {
    const not = (text: string, id: string) => expect(parseFindings(text).answers[id], `${id} must not match "${text}"`).toBeUndefined()
    not('Sol kolum uyuşuyor', 'chills') // uyuşuyor (numb) is not üşüyor (cold)
    not('Burnum kanıyor', 'burn') // burun (nose) is not the English burn
    not('Midem yanıyor', 'burn') // heartburn in Turkish, not a burn
    not('heartburn after dinner', 'burn')
    not('it burns when I pee', 'burn')
    not('I am fit and healthy', 'fit')
    not('Bu gece nöbetteyim', 'fit') // on duty tonight
    not('I have a stuffy nose', 'co2-alarm')
    not('chest congestion', 'blocked-nose')
    not('I cannot wake up early in the morning', 'not-waking')
    not('Dışarıda yürüdüm', 'toothache') // dışarı (outside) is not diş (tooth)
    not('I have pressure in my chest', 'head-band-pressure')
    not('I feel confused today about this screen', 'confusion-sudden')
    not('after using the toilet it stings', 'skin-irritant')
    not('I got a nosebleed', 'bleeding')
    not('I have stomach cramps', 'cramps') // tummy pain, not a muscle cramp
    expect(parseFindings('cramps in my legs').answers.cramps).toBe('yes')
  })
  it('negation still works for the new symptoms', () => {
    expect(parseFindings('No blood in my poo, but I have diarrhoea').answers).toMatchObject({ 'blood-in-stool': 'no', diarrhoea: 'yes' })
    expect(parseFindings('İshalim yok ama karnım ağrıyor').answers).toMatchObject({ diarrhoea: 'no', 'tummy-pain': 'yes' })
    expect(parseFindings('I have not hit my head').answers['head-injury']).toBe('no')
  })
})

describe('new conditions end to end', () => {
  const expectCase = (answers: Answers, context: 'space' | 'polar' | 'home', lead: string, urgency: Urgency) => {
    const a = run(answers, context)
    expect(a.candidates[0]?.condition.id, JSON.stringify(answers)).toBe(lead)
    expect(a.urgency, JSON.stringify(answers)).toBe(urgency)
    return a
  }
  it('emergencies from the sources' + "' 999 / A&E lists", () => {
    expectCase(yes('vomit-blood'), 'home', 'stomach-ulcer', 'emergency')
    expectCase(yes('high-sugar', 'vomiting'), 'home', 'hyperglycaemia', 'emergency')
    expectCase(yes('cough-blood', 'breathless'), 'home', 'pulmonary-embolism', 'emergency')
    expectCase(yes('calf-pain-swelling', 'breathless'), 'home', 'pulmonary-embolism', 'emergency') // a leg clot with breathlessness: possible clot in the lung
    expectCase(yes('calf-pain-swelling'), 'home', 'dvt', 'urgent')
    expectCase(yes('head-injury', 'drowsy'), 'home', 'concussion', 'emergency')
    expectCase(yes('burn', 'burn-severe'), 'home', 'burn', 'emergency')
    expectCase(yes('nosebleed', 'bleeding-wont-stop'), 'polar', 'nosebleed', 'emergency')
    expectCase(yes('eye-chemical'), 'space', 'eye-injury', 'emergency')
    expectCase(yes('tummy-severe', 'pain-lower-right'), 'polar', 'appendicitis', 'emergency')
    expectCase(yes('confusion', 'confusion-sudden'), 'home', 'delirium', 'emergency')
    expectCase(yes('skin-red-hot-swollen', 'fever'), 'home', 'cellulitis', 'emergency')
    expectCase(yes('palpitations', 'breathless'), 'home', 'atrial-fibrillation', 'emergency')
    expectCase(yes('joint-twist', 'injury-crack-deform'), 'home', 'sprain-strain', 'emergency')
    for (const ctx of ['space', 'polar', 'home'] as const) expectCase(yes('fit'), ctx, 'seizure', 'emergency')
  })
  it('urgent and self-care tiers', () => {
    expectCase(yes('painful-urination', 'urinate-often', 'cloudy-urine', 'fever'), 'home', 'uti', 'urgent')
    expectCase(yes('pain-lower-right', 'tummy-pain'), 'home', 'appendicitis', 'urgent')
    expectCase(yes('headache', 'head-band-pressure'), 'home', 'tension-headache', 'selfcare')
    expectCase(yes('headache', 'visual-aura', 'light-sensitive'), 'home', 'migraine', 'selfcare')
    expectCase(yes('diarrhoea', 'vomiting', 'nausea'), 'home', 'gastroenteritis', 'selfcare')
    expectCase(yes('wet-cold-feet', 'numb-cold-skin'), 'polar', 'trench-foot', 'urgent')
    expectCase(yes('chilblain-patches', 'cold-exposure'), 'polar', 'chilblains', 'selfcare')
    expectCase(yes('pressure-sore', 'bed-bound', 'fever'), 'home', 'pressure-sores', 'urgent')
  })
  it('context availability: space congestion in flight, a cold at home; trench foot only in polar stations', () => {
    expectCase(yes('blocked-nose', 'face-puffy', 'first-days'), 'space', 'space-congestion', 'selfcare')
    expect(run(yes('blocked-nose', 'sore-throat'), 'home').candidates[0].condition.id).toBe('common-cold')
    expect(run(yes('wet-cold-feet'), 'home').candidates.some((c) => c.condition.id === 'trench-foot')).toBe(false)
    expect(run(yes('cant-urinate', 'pee-hard-to-start'), 'space').candidates[0].condition.id).toBe('urinary-retention')
  })
  it('a symptom the best match does not explain keeps "see a professional soon"', () => {
    const a = run(yes('headache', 'pale-blue-skin'))
    expect(a.urgency).not.toBe('selfcare')
    expect(a.reasons.join(' ')).toMatch(/does not explain|professional/)
  })
  it('a milder condition ranked first never hides a more urgent one that also fits', () => {
    // vertigo (self-care) can outrank an asthma pattern on score; breathlessness keeps its tier
    expect(['urgent', 'emergency']).toContain(run(yes('breathless', 'spinning')).urgency)
  })
  it('the heart-attack, stroke, anaphylaxis and crisis leads are unchanged by the extension', () => {
    expectCase(yes('chest-pain', 'pain-spread', 'breathless', 'sweating'), 'home', 'heart-attack', 'emergency')
    expectCase(yes('face-droop'), 'home', 'stroke', 'emergency')
    expectCase(yes('throat-swelling'), 'home', 'anaphylaxis', 'emergency')
    for (const ctx of ['space', 'polar', 'home'] as const) expectCase(yes('self-harm', 'low-mood', 'fatigue', 'confusion'), ctx, 'suicidal-thoughts', 'emergency')
    // a FAST sign with a new condition's finding is still led by stroke
    expectCase(yes('speech', 'head-injury'), 'home', 'stroke', 'emergency')
    expectCase(yes('speech', 'painful-urination'), 'home', 'stroke', 'emergency')
  })
  it('medicines: only sourced ones, NASA kit items in space only and only as issued, allergies respected', () => {
    const cong = assess({ answers: yes('blocked-nose', 'face-puffy'), context: 'space', profile: profile(), now: NOW })
    const plan = carePlan(CONDITION_BY_ID['space-congestion'], cong, 'space', profile(), 0)
    const pse = plan.meds.find((m) => /pseudoephedrine/i.test(m.name))!
    expect(pse.status).toBe('if-prescribed')
    expect(pse.reasons.join(' ')).toMatch(/crew medical officer/)
    const home = carePlan(CONDITION_BY_ID['common-cold'], run(yes('blocked-nose')), 'home', profile({ allergies: ['nsaid'] }), 0)
    const pi = home.meds.find((m) => /paracetamol or ibuprofen/i.test(m.name))!
    expect(pi.status).toBe('not-for-you')
    expect(home.meds.some((m) => /decongestant|pseudoephedrine/i.test(m.name))).toBe(false)
    const urine = carePlan(CONDITION_BY_ID['urinary-retention'], run(yes('cant-urinate'), 'space'), 'space', profile(), 0)
    expect(urine.meds.every((m) => m.status === 'if-prescribed')).toBe(true)
  })
  it('an emergency never reads self-care advice as "do this now"', () => {
    const a = run(yes('vomit-blood'))
    const plan = carePlan(CONDITION_BY_ID['stomach-ulcer'], a, 'home', profile(), 0)
    expect(plan.urgency).toBe('emergency')
    expect(plan.steps).toEqual([])
    expect(plan.first).toMatch(/^Call 112/)
    const e = consultStep(newConsult(), { context: 'home', readings: {}, profile: null, delaySec: 0, cabin: null }, { text: 'I vomited blood' })
    expect(e.say).not.toMatch(/meals|stress/)
    // first aid stays: a nosebleed that will not stop still says how to pinch the nose
    const nb = run(yes('nosebleed', 'bleeding-wont-stop'))
    expect(carePlan(CONDITION_BY_ID.nosebleed, nb, 'home', profile(), 0).steps.length).toBeGreaterThan(0)
  })
  it('localises NHS routes for the crew and the station without broken sentences', () => {
    expect(localise('Ask for an urgent GP appointment or get help from NHS 111 if you think you have DVT.', 'space')).toBe('Tell the crew medical officer and contact the flight surgeon today if you think you have DVT.')
    expect(localise('Ask for an urgent dentist appointment or get help from NHS 111 if you think you have a dental abscess.', 'polar')).toBe('See the station doctor today if you think you have a dental abscess.')
    expect(localise('A pharmacist can suggest a suitable laxative.', 'polar')).toBe('The station doctor can suggest a suitable laxative.')
    for (const c of NEW.map((id) => CONDITION_BY_ID[id]))
      for (const kind of ['escalate', 'redflag', 'action'] as const)
        for (const x of c.ev[kind] ?? []) {
          const t = localise(x.t, 'space')
          if (t) expect(t, `${c.id}: ${x.t}`).not.toMatch(/\bGP\b|NHS 111|\b999\b|A&E|urgent the|an the/)
        }
  })
})

describe('voice: mis-hearings of the new vocabulary', () => {
  it('corrects common mis-recognitions and leaves look-alike words alone', () => {
    const fixed = (t: string) => correct(t).text
    expect(parseFindings(fixed('I have dire rhea')).answers.diarrhoea).toBe('yes')
    expect(parseFindings(fixed('coughing up green flem')).answers.phlegm).toBe('yes')
    expect(parseFindings(fixed('he is having a seasure')).answers.fit).toBe('yes')
    expect(parseFindings(fixed('I have a bad tooth egg')).answers.toothache).toBe('yes')
    expect(parseFindings(fixed('I get heart burn after dinner')).answers.heartburn).toBe('yes')
    expect(parseFindings(fixed('nose bleed')).answers.nosebleed).toBe('yes')
    for (const keep of ['spring is here', 'two singles please', 'I want to migrate', 'my feet are numb']) expect(fixed(keep)).toBe(keep.toLowerCase())
  })
})

describe('interview safety', () => {
  const ctxOf = (context: 'space' | 'polar' | 'home'): ConsultCtx => ({ context, readings: {}, profile: null, delaySec: 0, cabin: null })
  it('asks the red-flag question first for every new condition that has one', () => {
    for (const id of NEW) {
      const c = CONDITION_BY_ID[id]
      for (const h of c.findings.filter((f) => f.hallmark))
        for (const context of c.contexts) {
          const a = run(yes(h.id), context)
          if (a.urgency === 'emergency' || !a.next) continue
          const own = (c.emergencyIf ?? []).some((r) => {
            const need = r.need ?? []
            if (!need.some((g) => g.includes(h.id))) return false
            const others = need.filter((g) => !g.includes(h.id))
            return others.length === 0 ? false : others.length === 1 // one more group would complete it
          })
          const lead = a.candidates[0]?.condition.id === id
          if (own && lead) expect(a.next.why, `${id} from ${h.id} (${context}): next ${a.next.id}`).toMatch(/^Safety check/)
        }
    }
  })
  it(`never asks more than ${MAX_QUESTIONS} questions, starting from any symptom in any context`, () => {
    for (const context of ['space', 'polar', 'home'] as const)
      for (const f of FINDINGS) {
        let step = consultStep(newConsult(), ctxOf(context), { text: f.label })
        let guard = 0
        while (step.state.pending && guard++ < 20) step = consultStep(step.state, ctxOf(context), { answer: 'no' })
        expect(step.state.asked.length, `${context} ${f.id}`).toBeLessThanOrEqual(MAX_QUESTIONS)
      }
  })
  it('spoken summaries stay short; emergencies lead with the instruction', () => {
    const s = consultStep(newConsult(), ctxOf('home'), { text: 'I have a blocked nose and a sore throat' })
    let step = s
    let guard = 0
    while (step.state.pending && guard++ < 10) step = consultStep(step.state, ctxOf('home'), { answer: 'no' })
    expect(step.say.length).toBeLessThan(520)
    const e = consultStep(newConsult(), ctxOf('home'), { text: 'Kan kustum' })
    expect(e.emergency).toBe(true)
    expect(e.say).toMatch(/^Emergency — get help now/)
  })
  it('Turkish consultation by voice reaches the new conditions', () => {
    const uti = consultStep(newConsult(), ctxOf('home'), { text: 'İdrarımda yanma var, sık sık idrara çıkıyorum ve ateşim var' })
    expect(uti.assessment?.candidates[0].condition.id).toBe('uti')
    expect(uti.assessment?.urgency).toBe('urgent')
    const app = consultStep(newConsult(), ctxOf('polar'), { text: 'Karnımın sağ alt tarafı şiddetli karın ağrısı' })
    expect(app.emergency).toBe(true)
  })
})
