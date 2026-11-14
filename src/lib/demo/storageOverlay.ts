// Jury demo mode: an in-memory stand-in for one Storage object (localStorage).
// While it is installed, every read and write on that object goes to a private map: the real store is neither
// read nor changed, so leaving the tour (or closing the tab in the middle of it) leaves the person's data
// exactly as it was. Other Storage objects (sessionStorage) keep working normally.

/** The part of Storage.prototype the overlay replaces. */
export type StorageProto = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  clear(): void
  key(index: number): string | null
}

export type StorageOverlay = {
  /** Put the original methods back. The map is discarded with the overlay. */
  uninstall(): void
  /** Current contents of the sandboxed store. */
  entries(): Record<string, string>
  /** Number of writes the app made while sandboxed (all of them stayed in memory). */
  writes(): number
}

/**
 * @param proto  the prototype that carries the storage methods (Storage.prototype in a browser)
 * @param real   the storage object to sandbox (window.localStorage)
 * @param seed   what the sandboxed store contains at the start
 */
export function installStorageOverlay(proto: StorageProto, real: object, seed: Record<string, string> = {}): StorageOverlay {
  const map = new Map<string, string>(Object.entries(seed))
  let writes = 0
  const original = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem, clear: proto.clear, key: proto.key }
  const lengthDesc = Object.getOwnPropertyDescriptor(proto, 'length')

  proto.getItem = function (this: unknown, key: string) {
    if (this !== real) return original.getItem.call(this, key)
    const k = String(key)
    return map.has(k) ? map.get(k)! : null
  }
  proto.setItem = function (this: unknown, key: string, value: string) {
    if (this !== real) return original.setItem.call(this, key, value)
    writes++
    map.set(String(key), String(value))
  }
  proto.removeItem = function (this: unknown, key: string) {
    if (this !== real) return original.removeItem.call(this, key)
    writes++
    map.delete(String(key))
  }
  proto.clear = function (this: unknown) {
    if (this !== real) return original.clear.call(this)
    writes++
    map.clear()
  }
  proto.key = function (this: unknown, index: number) {
    if (this !== real) return original.key.call(this, index)
    return [...map.keys()][index] ?? null
  }
  if (lengthDesc?.get && lengthDesc.configurable) {
    const realLength = lengthDesc.get
    Object.defineProperty(proto, 'length', {
      configurable: true,
      enumerable: lengthDesc.enumerable,
      get(this: unknown) {
        return this === real ? map.size : (realLength.call(this) as number)
      },
    })
  }

  let installed = true
  return {
    uninstall() {
      if (!installed) return
      installed = false
      proto.getItem = original.getItem
      proto.setItem = original.setItem
      proto.removeItem = original.removeItem
      proto.clear = original.clear
      proto.key = original.key
      if (lengthDesc?.get && lengthDesc.configurable) Object.defineProperty(proto, 'length', lengthDesc)
    },
    entries: () => Object.fromEntries(map),
    writes: () => writes,
  }
}
