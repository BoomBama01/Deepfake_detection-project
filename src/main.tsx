import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";

// React.lazy chunk loader with redeploy resilience.
// After a deploy the browser may be handed a stale index.html route handler that
// returns 200 for a now-missing /assets/* chunk, so dynamic imports can fail with a
// "Failed to fetch dynamically imported module" Vite error. We:
//  - listen for Vite's preloadError event and hard-reload the page,
//  - wrap every lazy() import in a retry loader (2 attempts) and then, once, reload
//    the page while a sessionStorage flag prevents a reload loop.
async function retryLazyImportDeferred(
  importFn: () => Promise<{ default: React.ComponentType<{}> }>,
  key: string,
  reloadOnFailure: boolean,
): Promise<React.ComponentType<{}>> {
  const sessionKey = `truthlens.lazy.${key}.attempted`;
  const alreadyReloaded = () => {
    try { return sessionStorage.getItem(sessionKey) === "reloaded"; } catch { return false; }
  };
  const markAttempted = () => {
    try { sessionStorage.setItem(sessionKey, "attempted"); } catch { /* ignore */ }
  };
  const markReloaded = () => {
    try { sessionStorage.setItem(sessionKey, "reloaded"); } catch { /* ignore */ }
  };
  const clearState = () => {
    try { sessionStorage.removeItem(sessionKey); } catch { /* ignore */ }
  };

  markAttempted();
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const mod = await importFn();
      if (typeof mod.default !== "function")
        throw new Error(`Lazy module ${key} has no default export`);
      clearState();
      return mod.default;
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 700));
      }
    }
  }

  console.warn(
    `[truthlens] Lazy chunk failed after 2 attempts for ${key}.`,
    lastError instanceof Error ? lastError.message : lastError,
  );

  if (reloadOnFailure && !alreadyReloaded()) {
    markReloaded();
    window.location.reload();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((React as any).Fragment) as any;
}

function lazyWithRetry(
  key: string,
  importFn: () => Promise<{ default: React.ComponentType<{}> }>,
): React.LazyExoticComponent<React.ComponentType<Record<string, never>>> {
  // Cast through unknown to satisfy React's strict Lazy loader return type while
  // keeping our internal retry loader typed around the default export.
  return React.lazy(() => retryLazyImportDeferred(importFn, key, true) as unknown as Promise<{ default: React.ComponentType<Record<string, never>> }>);
}

const Landing = lazyWithRetry("Landing", () => import("./pages/Landing.tsx"));
const AuthPage = lazyWithRetry("Auth", () => import("./pages/Auth.tsx"));
const Analyze = lazyWithRetry("Analyze", () => import("./pages/Analyze.tsx"));
const Results = lazyWithRetry("Results", () => import("./pages/Results.tsx"));
const Dashboard = lazyWithRetry("Dashboard", () => import("./pages/Dashboard.tsx"));
const Developer = lazyWithRetry("Developer", () => import("./pages/Developer.tsx"));
const Docs = lazyWithRetry("Docs", () => import("./pages/Docs.tsx"));
const Learn = lazyWithRetry("Learn", () => import("./pages/Learn.tsx"));
const About = lazyWithRetry("About", () => import("./pages/About.tsx"));
const Privacy = lazyWithRetry("Privacy", () => import("./pages/Privacy.tsx"));
const Terms = lazyWithRetry("Terms", () => import("./pages/Terms.tsx"));
const Contact = lazyWithRetry("Contact", () => import("./pages/Contact.tsx"));
const NotFound = lazyWithRetry("NotFound", () => import("./pages/NotFound.tsx"));

// Simple loading fallback for route transitions
function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse text-muted-foreground">Loading...</div>
    </div>
  );
}

/** Silent error boundary — if VlyToolbar crashes it renders nothing instead of
 *  crashing the whole app (e.g. hook errors in the browser runtime). */
class ToolbarErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(err: Error) {
    console.warn("[VlyToolbar] Caught error, toolbar disabled:", err.message);
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

/** Hard guard so runtime errors never leave the preview as a blank page. */
class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string; stack: string }
> {
  state = { hasError: false, message: "", stack: "" };
  static getDerivedStateFromError(error: Error) {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
      stack: error.stack || "",
    };
  }
  componentDidCatch(err: Error) {
    console.error("[Preview] Root crash:", err);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
          <div className="max-w-lg text-center">
            <p className="text-sm font-semibold">Preview runtime error</p>
            <p className="mt-2 text-xs text-muted-foreground break-words">
              {this.state.message}
            </p>
            {this.state.stack && (
              <pre className="mt-3 text-left text-[10px] leading-4 text-muted-foreground/80 max-h-40 overflow-auto rounded border border-border/60 p-2">
                {this.state.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

// Global reload guard for Vite chunk-load failures.
// This catches both Vite's own preloadError and any dynamic import that throws,
// then reloads the page so the browser picks up the freshly deployed hashed chunks.
window.addEventListener(
  "vite:preloadError",
  () => {
    try {
      sessionStorage.setItem("truthlens.preloadError.reload", "1");
    } catch {
      /* ignore */
    }
    window.location.reload();
  },
  { once: false },
);

function RouteSyncer() {
  const location = useLocation();
  useEffect(() => {
    window.parent.postMessage(
      { type: "iframe-route-change", path: location.pathname },
      "*",
    );
  }, [location.pathname]);

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data?.type === "navigate") {
        if (event.data.direction === "back") window.history.back();
        if (event.data.direction === "forward") window.history.forward();
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootErrorBoundary>
      <ToolbarErrorBoundary>
        <VlyToolbar />
      </ToolbarErrorBoundary>
      <ConvexAuthProvider client={convex}>
        <BrowserRouter>
          <RouteSyncer />
          <Suspense fallback={<RouteLoading />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage />}
              />
              <Route path="/analyze" element={<Analyze />} />
              <Route path="/results/:id" element={<Results />} />
              <Route path="/docs" element={<Docs />} />
              <Route path="/learn" element={<Learn />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/contact" element={<Contact />} />
              <Route
                path="/dashboard"
                element={
                  <RequireAuth>
                    <Dashboard />
                  </RequireAuth>
                }
              />
              {/* Developer mode exposes implementation detail that helps someone
                  craft an evasion, so it is gated. It contains no secrets and no
                  user data — the gate is about not handing an attacker's playbook
                  to anonymous visitors. */}
              <Route
                path="/developer"
                element={
                  <RequireAuth
                    title="Sign in to view the developer dashboard"
                    description="Detector versions, fusion weights and calibration provenance are only shown to signed-in users."
                  >
                    <Developer />
                  </RequireAuth>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
