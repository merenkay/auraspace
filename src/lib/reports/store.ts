// Client side of "My reports": loads the signed-in person's own reports, keeps the unread-reply count fresh and
// marks replies as read. Read markers live on the server (routes/reportread.php) or in the demo store; only when the
// server has no read-marker module yet does this fall back to a marker kept on this device.
import { useCallback, useEffect, useState } from 'react'
import type { Backend } from '../api'
import { useSession } from '../session'
import type { Report } from '../types'
import { isUnread, reachesReviewer } from './journey'

const LOCAL_KEY = 'aura.reportread.v1'
const EVENT = 'aura:reports-changed'
const POLL_MS = 60_000

/** Tell every open view (nav badge, My reports, inbox) that reports changed. */
export function notifyReportsChanged() {
  window.dispatchEvent(new Event(EVENT))
}

function readLocal(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

function writeLocal(ids: number[]) {
  try {
    const cur = readLocal()
    const now = new Date().toISOString()
    for (const id of ids) cur[id] = now
    localStorage.setItem(LOCAL_KEY, JSON.stringify(cur))
  } catch {
    /* storage unavailable: the reply stays marked unread */
  }
}

/** Fills `readAt` from the device fallback only where the backend gave no read marker at all (field absent). */
export function withLocalReads(list: Report[], local: Record<string, string> = readLocal()): Report[] {
  return list.map((r) => (r.readAt === undefined && local[r.id] ? { ...r, readAt: local[r.id] } : r))
}

export async function loadReports(backend: Backend, crewId?: number): Promise<Report[]> {
  return withLocalReads(await backend.reports(crewId))
}

/** Marks replies as read. If the server cannot store it (module not installed), keeps the marker on this device. */
export async function markRead(backend: Backend, ids: number[]) {
  if (!ids.length) return
  try {
    await backend.markReportsRead(ids)
  } catch {
    writeLocal(ids)
  }
  notifyReportsChanged()
}

/** Re-runs `load` on report changes, when the tab becomes visible again, and once a minute while visible. */
function useRefresh(load: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    load()
    const onVisible = () => document.visibilityState === 'visible' && load()
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS)
    window.addEventListener(EVENT, load)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(t)
      window.removeEventListener(EVENT, load)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load, enabled])
}

/** The signed-in person's own reports, newest first. `null` while loading. */
export function useMyReports() {
  const { backend, user } = useSession()
  const [reports, setReports] = useState<Report[] | null>(null)
  const [error, setError] = useState(false)
  const self = user?.role === 'astronaut' || user?.role === 'member'
  const load = useCallback(() => {
    if (!backend || !user?.crewId) return
    loadReports(backend, user.crewId).then(
      (list) => {
        setReports([...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
        setError(false)
      },
      () => setError(true),
    )
  }, [backend, user?.crewId])
  useRefresh(load, Boolean(backend && self))
  return { reports, error, reload: load }
}

/** Number of unread replies for the nav badge. Always 0 for people whose reports nobody can answer. */
export function useUnreadReplies(): number {
  const { backend, user } = useSession()
  const [count, setCount] = useState(0)
  const on = Boolean(backend && reachesReviewer(user?.role) && user?.crewId)
  const load = useCallback(() => {
    if (!backend || !user?.crewId) return
    loadReports(backend, user.crewId).then((list) => setCount(list.filter((r) => isUnread(r)).length), () => undefined)
  }, [backend, user?.crewId])
  useRefresh(load, on)
  return on ? count : 0
}
