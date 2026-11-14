// React access to the app-level live sensor store (src/lib/serial/envLive.ts).
import { useEffect, useSyncExternalStore } from 'react'
import { stationFor } from '../../lib/envStation'
import { envLive, type LiveSnapshot } from '../../lib/serial/envLive'
import { useSession } from '../../lib/session'

export function useEnvLive(): LiveSnapshot {
  return useSyncExternalStore(envLive.subscribe, envLive.getSnapshot, envLive.getSnapshot)
}

/**
 * Binds the store to the signed-in person's station. Mounted once by the app shell (header indicator).
 * Idempotent: StrictMode's double effects and re-renders never open or close the port.
 */
export function useEnvLiveBinding() {
  const { user, backend } = useSession()
  const stationId = stationFor(user)?.id ?? null
  const userId = user?.id ?? null
  const serverMode = backend?.mode === 'server'
  useEffect(() => {
    envLive.start()
    envLive.setScope(stationId && userId != null ? { stationId, userId, serverMode } : null)
  }, [stationId, userId, serverMode])
}
