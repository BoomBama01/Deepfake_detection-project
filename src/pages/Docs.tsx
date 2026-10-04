import { useState } from "react";
import { Check, Copy, KeyRound, Terminal } from "lucide-react";
import { Link } from "react-router";
import { Footer } from "@/components/site/Footer";
import { Navbar } from "@/components/site/Navbar";
import { Disclaimer } from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const ENDPOINTS = [
  {
    method: "GET",
    path: "/api/v1/health",
    auth: false,
    desc: "Liveness check. No key required.",
    resp: '{\n  "ok": true,\n  "service": "truthlens",\n  "time": 1759560000000\n}',
  },
  {
    method: "GET",
    path: "/api/v1/quota",
    auth: true,
    desc: "Today’s scan allowance for the key’s account.",
    resp: '{\n  "used": 7,\n  "limit": 25,\n  "plan": "free"\n}',
  },
  {
    method: "GET",
    path: "/api/v1/scans",
    auth: true,
    desc: "Your stored scan summaries, newest first (max 50).",
    resp: '{\n  "scans": [\n    {\n      "id": "k57abc...",\n      "type": "video",\n      "fileName": "interview.mp4",\n      "verdict": "likely_deepfake",\n      "confidence": 0.81,\n      "createdAt": 1759551234567\n    }\n  ]\n}',
  },
  {
    method: "GET",
    path: "/api/v1/scans/:id",
    auth: true,
    desc: "One scan with its full check breakdown (owner only).",
    resp: '{\n  "id": "k57abc...",\n  "verdict": "likely_deepfake",\n  "confidence": 0.81,\n  "disclaimer": "…",\n  "result": { "checks": [ "…" ] }\n}',
  },
];

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the text stays selectable */
    }
  };
  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-muted/50">
      {label ? (
        <p className="border-b border-border/70 px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {label}
        </p>
      ) : null}
      <pre className="overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed">
        {code}
      </pre>
      <button
        type="button"
        onClick={copy}
        aria-label="Copy code"
        className="absolute top-2 right-2 rounded border border-border bg-card p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      >
        {copied ? (
          <Check className="size-3.5 text-primary" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}

function Endpoint({ ep }: { ep: (typeof ENDPOINTS)[number] }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-primary">
          {ep.method}
        </span>
        <code className="font-mono text-sm break-all">{ep.path}</code>
        <span
          className={`ml-auto rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            ep.auth
              ? "border-border text-muted-foreground"
              : "border-[var(--verdict-real)]/50 text-[var(--verdict-real)]"
          }`}
        >
          {ep.auth ? "Bearer key" : "public"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{ep.desc}</p>
      <div className="mt-3">
        <CodeBlock code={ep.resp} label="200 response" />
      </div>
    </div>
  );
}

export default function Docs() {
  const curl = `curl -H "Authorization: Bearer tl_..." \\
  https://<your-deployment>.convex.site/api/v1/scans`;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
        <header className="rule-double pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Reference · v1
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            API reference
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            A small, honest REST API: it serves results your account has
            already produced in the browser. Detection itself runs on your
            device — the original image or video never travels to a server —
            so the API exposes verdicts, confidence and quota rather than an
            upload-to-analyze endpoint.
          </p>
        </header>

        <section className="mt-10 space-y-4">
          <h2 className="font-display text-2xl font-semibold">Authentication</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every endpoint except{" "}
            <code className="font-mono">/api/v1/health</code> expects a secret
            key as a bearer token. Create one under{" "}
            <Link
              to="/dashboard?tab=api"
              className="text-primary underline underline-offset-4"
            >
              Dashboard → API keys
            </Link>
            . The secret is shown once at creation, and requests are limited to
            30 per minute per key.
          </p>
          <CodeBlock code={curl} label="Request" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Card className="border-border/70 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base">
                  Rate limit
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                30 requests per minute per key, fixed window. Exceeding it
                returns <code className="font-mono">429</code> with the reason
                in the body.
              </CardContent>
            </Card>
            <Card className="border-border/70 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-base">Errors</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                Errors are JSON{" "}
                <code className="font-mono">{"{ \"error\": \"reason\" }"}</code>{" "}
                with 401 (bad or revoked key), 403 (not your scan), 404, or 429.
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mt-12 space-y-4">
          <h2 className="font-display text-2xl font-semibold">Endpoints</h2>
          {ENDPOINTS.map((ep) => (
            <Endpoint key={ep.path} ep={ep} />
          ))}
        </section>

        <section className="mt-12 space-y-4">
          <h2 className="font-display text-2xl font-semibold">Verdict values</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-2">Value</th>
                  <th className="px-4 py-2">Meaning</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                <tr>
                  <td className="px-4 py-2 font-mono text-xs">real</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    Passed every forensic check — but still probabilistic.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-xs">likely_ai</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    Synthetic-image signatures or structural anomalies dominate.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-xs">
                    likely_deepfake
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    Face or temporal manipulation evidence dominates (video /
                    face edits).
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-xs">inconclusive</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    Legacy records only (old three-way engine). New analyses
                    are always binary — real, likely_ai or likely_deepfake —
                    and express uncertainty as low confidence instead.
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-xs">error</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    The analysis could not run (bad file, missing capability).
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="font-mono text-xs leading-relaxed text-muted-foreground">
            confidence: 0–1 — calibrated to the strength of the evidence and
            capped below certainty. A high confidence score is still not proof.
          </p>
        </section>

        <section className="mt-12 flex flex-col items-start gap-4 rounded-xl border-2 border-border bg-card p-6">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold">
              Get an API key
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Free accounts get the same 30 req/min limit as paid plans.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="cursor-pointer gap-2">
              <Link to="/dashboard?tab=api">
                <KeyRound className="size-4" /> Create a key
              </Link>
            </Button>
            <Button asChild variant="outline" className="cursor-pointer gap-2">
              <Link to="/analyze">
                <Terminal className="size-4" /> Try the analyzer
              </Link>
            </Button>
          </div>
        </section>

        <div className="mt-10">
          <Disclaimer />
        </div>
      </main>

      <Footer />
    </div>
  );
}
