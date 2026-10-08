import '@vly-ai/integrations';
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import { VlyToolbar } from "../vly-toolbar-readonly.tsx";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import React, { StrictMode, useEffect, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes, useLocation } from "react-router";
import "./index.css";
import { lazyWithRetry } from "@/lib/lazy-retry";

// Route chunks are loaded through lazyWithRetry() (src/lib/lazy-retry.ts):
// it retries a failed dynamic import twice, then reloads the page once with a
// sessionStorage guard against reload loops — recovering from stale-shell
// redeploys where /assets/* hashes no longer exist ("Failed to fetch dynamically
// imported module"). A global vite:preloadError listener below covers Vite's own
// preload failures.

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

/**
 * Route-level error boundary. Catches render errors below it — notably a
 * Convex `useQuery` re-throwing a server error such as
 * "[CONVEX Q(scans:get)] … Server Error" — and renders a friendly recovery UI
 * instead of the raw crash panel, so the app never shows a blank screen.
 * It is keyed by pathname, so navigating away resets it automatically.
 */
class RouteErrorBoundary extends React.Component<
  { children: React.ReactNode; path: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error) {
    console.error("[RouteBoundary] caught on", this.props.path, error);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    const isResults = this.props.path.startsWith("/results");
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center text-foreground">
        <div className="max-w-lg">
          <h1 className="font-display text-2xl font-semibold">
            {isResults ? "Scan not found" : "Something went wrong"}
          </h1>
          <p className="mt-3 font-body text-sm leading-6 text-muted-foreground">
            {isResults
              ? "This result could not be loaded — it may have been deleted, expired, or the link is out of date."
              : "This page hit an unexpected error. Going back usually clears it."}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="rounded-md border border-border bg-card px-4 py-2 font-body text-sm hover:bg-muted"
            >
              Go back
            </button>
            <a
              href={isResults ? "/analyze" : "/"}
              className="rounded-md border border-border bg-primary px-4 py-2 font-body text-sm text-primary-foreground hover:opacity-90"
            >
              {isResults ? "Run a new examination" : "Back to home"}
            </a>
          </div>
        </div>
      </div>
    );
  }
}

function RouteBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <RouteErrorBoundary key={location.pathname} path={location.pathname}>
      {children}
    </RouteErrorBoundary>
  );
}

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
            <RouteBoundary>
              <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/auth"
                element={<AuthPage redirectAfterAuth="/dashboard" />}
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
            </RouteBoundary>
          </Suspense>
        </BrowserRouter>
        <Toaster />
      </ConvexAuthProvider>
    </RootErrorBoundary>
  </StrictMode>,
);
