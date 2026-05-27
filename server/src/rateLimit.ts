const WINDOW_MS = 2000
const MAX_ACTIONS = 30

/** Very small sliding-window limiter per socket id */
export function createRateLimiter() {
  const hits = new Map<string, number[]>()

  return function allow(key: string): boolean {
    const now = Date.now()
    const arr = hits.get(key) ?? []
    const pruned = arr.filter((t) => now - t < WINDOW_MS)
    if (pruned.length >= MAX_ACTIONS) {
      hits.set(key, pruned)
      return false
    }
    pruned.push(now)
    hits.set(key, pruned)
    return true
  }
}
