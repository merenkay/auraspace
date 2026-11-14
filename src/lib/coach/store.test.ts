import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '../types'
import type { TrainingProfile } from './types'

type Store = typeof import('./store')
let s: Store

const u = (role: User['role'], crewId: number | null): User => ({ id: crewId ?? 100, username: role, role, name: role, title: '', crewId, context: 'home' })
const astronaut = u('astronaut', 1)
const member = u('member', 1000)
const surgeon = u('surgeon', null)
const ground = u('ground', null)
const profile: TrainingProfile = { focus: ['muscle'], confirmed: true, level: 'starting', daysPerWeek: 3, minutes: 30, equipment: ['chair'], limits: [], startedAt: '2026-11-16', updatedAt: null, context: 'home' }

beforeEach(async () => {
  const mem = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) })
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))
  vi.resetModules()
  s = await import('./store')
})
afterEach(() => vi.unstubAllGlobals())

describe('coach store (demo mode) privacy', () => {
  it('a person reads and writes only their own record', async () => {
    await s.saveTrainingProfile(member, 1000, profile)
    const st = await s.loadCoach(member, 1000, 'home')
    expect(st.profile?.focus).toEqual(['muscle'])
    await expect(s.loadCoach(member, 1, 'space')).rejects.toThrow()
    await expect(s.saveTrainingProfile(astronaut, 1000, profile)).rejects.toThrow()
    await expect(s.logSession(astronaut, 2, { date: '2026-11-16', sessionKey: 'b1w1d0', minutes: 30, effort: 5, pain: false })).rejects.toThrow()
  })

  it('the flight surgeon reads the simulated crew only, and never writes; ground reads nothing', async () => {
    await s.saveTrainingProfile(astronaut, 1, { ...profile, context: 'space', equipment: ['ared'] })
    expect((await s.loadCoach(surgeon, 1, 'space')).profile?.focus).toEqual(['muscle'])
    await expect(s.loadCoach(surgeon, 1000, 'home')).rejects.toThrow()
    await expect(s.saveTrainingProfile(surgeon, 1, profile)).rejects.toThrow()
    await expect(s.logSession(surgeon, 1, { date: '2026-11-16', sessionKey: 'b1w1d0', minutes: 30, effort: 5, pain: false })).rejects.toThrow()
    await expect(s.loadCoach(ground, 1, 'space')).rejects.toThrow()
    expect(s.canReadCoach(ground, 1)).toBe(false)
  })

  it('re-logging a session replaces it; invalid values are refused', async () => {
    await s.logSession(member, 1000, { date: '2026-11-16', sessionKey: 'b1w1d0', minutes: 30, effort: 5, pain: false })
    await s.logSession(member, 1000, { date: '2026-11-16', sessionKey: 'b1w1d0', minutes: 40, effort: 8, pain: true })
    const st = await s.loadCoach(member, 1000, 'home')
    expect(st.logs).toHaveLength(1)
    expect(st.logs[0]).toMatchObject({ minutes: 40, effort: 8, pain: true })
    await expect(s.logSession(member, 1000, { date: 'yesterday', sessionKey: 'b1w1d0', minutes: 30, effort: 5, pain: false })).rejects.toThrow()
    await expect(s.logSession(member, 1000, { date: '2026-11-16', sessionKey: 'b1w1d0', minutes: 30, effort: 11, pain: false })).rejects.toThrow()
  })

  it('stored profiles are cleaned against the allow-list', async () => {
    localStorage.setItem('aura.coach.v1', JSON.stringify({ profiles: { 1000: { ...profile, focus: ['muscle', 'hacking'], equipment: ['ared', 'chair'], daysPerWeek: 99 } }, logs: {} }))
    const st = await s.loadCoach(member, 1000, 'home')
    expect(st.profile).toMatchObject({ focus: ['muscle'], equipment: ['chair'], daysPerWeek: 3 })
  })
})
