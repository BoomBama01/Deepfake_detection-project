/**
 * React.lazy() with redeploy resilience.
 *
 * Why this exists: after a redeploy the browser may hold a stale index.html that
 * references hashed /assets/* chunks which no longer exist. Vite then throws
 * "Failed to fetch dynamically imported module". This wrapper:
 *
 *   1. retries the dynamic import twice (700 ms apart),
 *   2. then reloads the page ONCE, guarded by a per-chunk sessionStorage key so
 *      a failing deploy cannot put the tab in a reload loop,
 *   3. on success clears the guard so future failures get a fresh reload budget.
 *
 * CONTRACT (React.lazy requirement — do not "simplify" this away):
 * React's lazyInitializer returns `payload._result.default`, i.e. the loader
 * promise MUST resolve to a *module object* `{ default: Component }`, not to the
 * bare component. Resolving to a bare function makes `.default` undefined and
 * React throws minified error #306 ("Element type is invalid. Received a promise
 * that resolves to: undefined") on the first route render.
 */

import React, { type ComponentType, type LazyExoticComponent } from "react";

type ModuleFactory<P> = () => Promise<{ default: ComponentType<P> }>;

const fallbackComponent = () => null;

/**
 * Load a lazy module with retry + one-shot reload. Resolves to the module
 * object `{ default: Component }` as React.lazy requires.
 */
export async function retryLazyImport<P>(
  importFn: ModuleFactory<P>,
  key: string,
  reloadOnFailure = true,
): Promise<{ default: ComponentType<P> }> {
  const storageKey = `truthlens.lazy.${key}`;
  const readState = (): string | null => {
    try {
      return sessionStorage.getItem(storageKey);
    } catch {
      return null;
    }
  };
  const writeState = (value: string): void => {
    try {
      sessionStorage.setItem(storageKey, value);
    } catch {
      /* storage may be disabled in embedded contexts — reload guard degrades */
    }
  };
  const clearState = (): void => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  const alreadyReloaded = readState() === "reloaded";
  writeState("attempted");

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const mod = await importFn();
      if (mod == null || mod.default == null) {
        throw new Error(`Lazy module "${key}" resolved without a default export.`);
      }
      clearState();
      return { default: mod.default };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        // Pause before retrying — a fresh deploy may already be live.
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
  }

  console.warn(
    `[truthlens] Lazy chunk "${key}" failed after 2 attempts.`,
    lastError instanceof Error ? lastError.message : lastError,
  );

  if (reloadOnFailure && !alreadyReloaded) {
    writeState("reloaded");
    window.location.reload();
  }

  // If the reload is blocked (sandboxed iframe, storage disabled) render nothing
  // rather than crashing the route.
  return { default: fallbackComponent };
}

/**
 * React.lazy wrapper: retries the import twice, then reloads the page once.
 * Preserves the page component's props so routes can pass props normally.
 */
export function lazyWithRetry<P extends object>(
  key: string,
  importFn: ModuleFactory<P>,
): LazyExoticComponent<ComponentType<P>> {
  return React.lazy(() => retryLazyImport(importFn, key, true));
}
