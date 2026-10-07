/**
 * useRetryLazy() — a small wrapper around React.lazy() for route chunks.
 *
 * Motivation
 * ----------
 * Single-page apps that ship hashed chunks can fail to load a route after a
 * redeploy if the visitor still holds a stale shell page. The browser requests
 * the old chunk path, the host either:
 *   - serves a cached index.html with status 200 (the common SPA misconfiguration
 *     behind "Failed to fetch dynamically imported module"), or
 *   - returns a genuine 404 if the host is configured correctly.
 *
 * This helper issues the dynamic import up to two times with a short pause
 * between attempts, then reloads the page once. A sessionStorage key prevents the
 * reload from becoming a loop: after one reload the helper will not reload again
 * for the same chunk in the same tab session.
 *
 * This is a defensive layer. The primary fix is correct host caching and routing
 * (see docs/deploy-cache-routing.md and the host config files in the repo root).
 *
 * Usage
 * -----
 *   import { useRetryLazy } from "@/hooks/use-retry-lazy";
 *   const Results = useRetryLazy("Results", () => import("@/pages/Results"));
 *
 * The returned value is a React.LazyExoticComponent that you can use directly as a
 * route element or inside <Suspense>.
 */

import React from "react";

export interface RetryLazyOptions {
  /**
   * Unique key for the chunk. Used to key the sessionStorage flags so that two
   * different lazy imports in the same tab do not interfere.
   */
  key: string;
  /**
   * Factory that returns the dynamic import promise. It must resolve to a module
   * with a default export that is a valid React component.
   */
  importFn: () => Promise<{ default: React.ComponentType<{}> }>;
  /**
   * If true, the helper will reload the page once after both attempts fail.
   * Set this to false for non-critical lazy payloads where a blank fallback is
   * acceptable.
   */
  reloadOnFailure?: boolean;
}

/**
 * Internal state values written to sessionStorage for a given chunk key.
 */
const STATE_ATTEMPTED = "attempted";
const STATE_RELOADED = "reloaded";

function sessionGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* storage may be disabled in some embedded contexts; ignore */
  }
}

function sessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * Attempt to load a lazy module with up to two retries, then optionally reload
 * the page once.
 */
export async function retryLazyImport(opts: RetryLazyOptions): Promise<React.ComponentType<{}>> {
  const { key, importFn, reloadOnFailure = true } = opts;

  const storageKey = `truthlens.lazy.${key}`;
  const alreadyReloaded = sessionGet(storageKey) === STATE_RELOADED;

  sessionSet(storageKey, STATE_ATTEMPTED);

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const mod = await importFn();
      if (mod == null || typeof mod.default !== "function") {
        throw new Error(`Lazy module ${key} has no default export`);
      }
      sessionRemove(storageKey);
      return mod.default;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        // Pause briefly before retrying. On a redeploy the new hashed chunk may
        // already be live by the time we try again.
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[truthlens] Lazy chunk failed after 2 attempts for ${key}.`,
    lastError instanceof Error ? lastError.message : lastError,
  );

  if (reloadOnFailure && !alreadyReloaded) {
    sessionSet(storageKey, STATE_RELOADED);
    // A hard reload is the cleanest recovery for a stale-shell-page situation.
    window.location.reload();
  }

  // As a last resort, return a no-op component so the app does not crash if the
  // reload itself does not resolve things (for example, storage disabled in a very
  // constrained iframe).
  return React.Fragment;
}

/**
 * Create a lazy component from a dynamic import, wrapped with retry + reload logic.
 */
export function useRetryLazy(opts: RetryLazyOptions): React.LazyExoticComponent<React.ComponentType<{}>> {
  return React.lazy(() => retryLazyImport(opts));
}
