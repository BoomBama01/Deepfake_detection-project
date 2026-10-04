import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Tracks whether the viewport is below the mobile breakpoint.
 *
 * Uses `useSyncExternalStore` so the value is read directly from
 * `matchMedia` — no setState-in-effect, no cascading render, and correct
 * behaviour when several components mount at different times.
 */
export function useIsMobile(): boolean {
  const query = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

  const subscribe = React.useCallback((onChange: () => void) => {
    const mql = window.matchMedia(query)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  const getSnapshot = React.useCallback(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia(query).matches
  }, [query])

  // Server snapshot: assume desktop so the first paint matches the markup.
  const getServerSnapshot = React.useCallback(() => false, [])

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}