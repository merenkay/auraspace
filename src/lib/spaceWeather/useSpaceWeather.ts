import { useCallback, useEffect, useMemo, useState } from 'react'
import { advisoryFor, type AdvisoryContent } from './advisory'
import { loadSpaceWeather, readCache } from './client'
import { buildModel, condition, freshness, radiationStorm, recentEvents, type Condition, type Freshness, type Model, type RadiationStorm, type TimelineEvent } from './derive'
import { isDrill, setDrill, subscribeDrill } from './drill'
import type { Snapshot } from './types'

/** Re-check every 10 minutes while the page is open (the server refreshes from NASA/NOAA every 5–15 min). */
const REFRESH_MS = 10 * 60000

export type SpaceWeatherView = {
  snapshot: Snapshot | null
  model: Model | null
  fresh: Freshness | null
  storm: RadiationStorm | null
  cond: Condition | null
  advisory: AdvisoryContent | null
  events: TimelineEvent[]
  hiddenCmes: number
  loading: boolean
  refresh: () => void
  drill: boolean
  setDrill: (on: boolean) => void
  now: number
}

// one in-flight load shared by every mounted panel
let inflight: Promise<Snapshot> | null = null
let last: Snapshot | null = null
function load(): Promise<Snapshot> {
  if (!inflight) {
    inflight = loadSpaceWeather().then(
      (s) => {
        last = s
        inflight = null
        return s
      },
      (e) => {
        inflight = null
        throw e
      },
    )
  }
  return inflight
}

export function useSpaceWeather(): SpaceWeatherView {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => last ?? readCache())
  const [loading, setLoading] = useState(true)
  const [drill, setDrillState] = useState(isDrill)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(() => {
    setLoading(true)
    load()
      .then((s) => setSnapshot(s))
      .catch(() => undefined)
      .finally(() => {
        setLoading(false)
        setNow(Date.now())
      })
  }, [])

  useEffect(() => subscribeDrill(setDrillState), [])

  useEffect(() => {
    refresh()
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
      else setNow(Date.now())
    }, REFRESH_MS)
    // keep "updated … ago" honest between refreshes
    const tick = window.setInterval(() => setNow(Date.now()), 60000)
    const online = () => refresh()
    window.addEventListener('online', online)
    return () => {
      window.clearInterval(id)
      window.clearInterval(tick)
      window.removeEventListener('online', online)
    }
  }, [refresh])

  const derived = useMemo(() => {
    if (!snapshot) return null
    const model = buildModel(snapshot)
    const fresh = freshness(model, now)
    const storm = radiationStorm(model, now, { drill })
    const cond = condition(model, now, storm)
    const { events, hiddenCmes } = recentEvents(model, now, 7, { drill })
    return { model, fresh, storm, cond, advisory: advisoryFor(storm), events, hiddenCmes }
  }, [snapshot, now, drill])

  return {
    snapshot,
    model: derived?.model ?? null,
    fresh: derived?.fresh ?? null,
    storm: derived?.storm ?? null,
    cond: derived?.cond ?? null,
    advisory: derived?.advisory ?? null,
    events: derived?.events ?? [],
    hiddenCmes: derived?.hiddenCmes ?? 0,
    loading,
    refresh,
    drill,
    setDrill,
    now,
  }
}
