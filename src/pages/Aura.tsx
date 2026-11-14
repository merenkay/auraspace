import { useCallback, useEffect, useMemo, useState } from 'react'
import AssessmentList from '../components/aura/PastAssessments'
import Consultation, { type SaveHandler } from '../components/aura/Consultation'
import ExplainReading from '../components/aura/ExplainReading'
import ProfileEditor from '../components/aura/ProfileEditor'
import { Badge, Notice, PageHeader, PageTransition, ShowMore, Skeleton, Tabs } from '../components/ui'
import type { HealthProfile } from '../data/conditions/profile'
import { CONTEXTS } from '../data/contexts'
import { MISSIONS } from '../data/missions'
import { addAssessment, canReadClinic, canWriteClinic, listAssessments, loadProfile, saveProfile, type SavedAssessment } from '../lib/clinic'
import { readingsFromEvaluation } from '../lib/doctor'
import { useCrewData, useSession } from '../lib/session'
import { DATA_CHANGED } from '../lib/voice/pending'

type View = 'consult' | 'explain' | 'profile' | 'history'

export default function Aura({ crewId }: { crewId: number }) {
  const { mission, user, crew } = useSession()
  const data = useCrewData(crewId)
  const ev = data.ev
  const reloadData = data.reload
  // a value logged by voice elsewhere in the app: pick it up
  useEffect(() => {
    const refresh = () => void reloadData()
    window.addEventListener(DATA_CHANGED, refresh)
    return () => window.removeEventListener(DATA_CHANGED, refresh)
  }, [reloadData])
  const ctx = ev?.context ?? mission?.context ?? 'space'
  const self = canWriteClinic(user, crewId)
  const readable = canReadClinic(user, crewId)
  const [view, setView] = useState<View>('consult')
  const [profile, setProfile] = useState<HealthProfile | null>(null)
  const [history, setHistory] = useState<SavedAssessment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!readable) return
    try {
      const [p, h] = await Promise.all([loadProfile(user, crewId), listAssessments(user, crewId)])
      setProfile(p)
      setHistory(h)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the record')
    }
  }, [user, crewId, readable])
  useEffect(() => void refresh(), [refresh])

  const readings = useMemo(() => readingsFromEvaluation(ev), [ev])
  const delaySec = ctx === 'space' ? (MISSIONS.find((m) => m.id === mission?.profileId)?.delaySec ?? 0) : 0
  const person = crew.find((c) => c.id === crewId)
  const firstName = self ? (user?.name.split(' ')[0] ?? '') : ''

  const onSave: SaveHandler = async (a, answers) => {
    const top = a.candidates[0]
    await addAssessment(user, crewId, {
      context: ctx,
      urgency: a.urgency,
      conditionId: top?.condition.id ?? null,
      conditionName: top ? top.condition.name : 'No clear match',
      strength: top?.strength ?? null,
      findings: Object.entries(answers).map(([id, answer]) => ({ id, answer })),
      note: a.reasons.join('; ').slice(0, 500),
    })
    await refresh()
  }

  const options: { value: View; label: string }[] = [
    { value: 'consult', label: self ? 'Consultation' : 'Walk-through' },
    { value: 'explain', label: 'Explain a reading' },
    { value: 'profile', label: 'Health profile' },
    { value: 'history', label: `Past assessments${history?.length ? ` (${history.length})` : ''}` },
  ]

  return (
    <div>
      <PageHeader
        eyebrow={self ? `Care contact: ${CONTEXTS[ctx].contact}` : `Viewing ${person?.name ?? 'crew member'} · read-only`}
        title="AURA consultation"
        description={
          <ShowMore id="aura.intro" short="Offline, rule-based decision support.">
            Offline, rule-based decision support. AURA compares what you report with a knowledge base built from NASA, NHS, CDC, WHO and ESA sources.
          </ShowMore>
        }
        status={<Badge>Works offline · no AI</Badge>}
      />
      {!readable ? (
        <Notice tone="info" title="Not available for your role">Health profiles and consultations are private to the person and their flight surgeon.</Notice>
      ) : (
        <div className="space-y-6">
          <div>
            <Tabs label="AURA sections" variant="line" value={view} onChange={setView} options={options} />
          </div>
          {error && <Notice tone="crit" role="alert">{error}</Notice>}
          <PageTransition routeKey={view}>
            {view === 'consult' &&
              (data.loading && !ev ? (
                <Skeleton className="h-40 max-w-2xl" />
              ) : (
                <div className="space-y-6">
                  {!self && (
                    <Notice tone="info" title="Read-only walk-through">
                      You can run a consultation for {person?.name ?? 'this crew member'} to see how AURA reasons, but only they can save it to their record.
                    </Notice>
                  )}
                  <Consultation ctx={ctx} readings={readings} profile={profile} delaySec={delaySec} firstName={firstName} onSave={self ? onSave : undefined} />
                </div>
              ))}
            {view === 'explain' &&
              (ev ? <ExplainReading ev={ev} rows={data.rows} today={mission?.day ?? 142} /> : <Notice tone="info" title="No measurements yet">Log a measurement first, then AURA can explain it.</Notice>)}
            {view === 'profile' && (profile === null && history === null && !error ? <Skeleton className="h-40" /> : <ProfileEditor profile={profile} editable={self} onSave={async (p) => setProfile(await saveProfile(user, crewId, p))} />)}
            {view === 'history' && <AssessmentList items={history} error={error} />}
          </PageTransition>
        </div>
      )}
    </div>
  )
}
