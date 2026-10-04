/**
 * Developer / evaluation dashboard.
 *
 * Shows the internals a forensic engineer needs and an ordinary user does not:
 * detector and model versions, the per-detector portfolio, how confidence and
 * uncertainty are computed, the calibration provenance for the thresholds, and
 * the decision rules actually in force.
 *
 * Access: the route is wrapped in `RequireAuth` in the router, so signed-out
 * visitors are sent to sign-in and returned. This page contains no secrets and
 * no user data — it is a static description of the engine that is currently
 * deployed, plus live statistics computed from the signed-in user's own scans.
 * That is why it is gated rather than open: it exposes implementation detail
 * that helps someone craft an evasion, without exposing anything confidential.
 *
 * Everything on this page is derived from the same modules the browser runner
 * uses, so it cannot drift out of sync with what the engine actually does.
 */
import { useMemo } from "react";
import { useQuery } from "convex/react";
import {
  Activity,
  Boxes,
  Gauge,
  Layers,
  Scale,
  Sigma,
  Timer,
  TriangleAlert,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Disclaimer } from "@/components/Disclaimer";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  defaultDetectors,
  FUSION_WEIGHTS,
  HEURISTIC_FEATURE_WEIGHTS,
  currentBackend,
} from "@/lib/engine/detectors";
import {
  CALIBRATION,
  CONFIDENCE_CAP,
  DISAGREEMENT_LIMIT,
  OK_SCORE_FLOOR,
  STRUCTURAL_FLOOR,
  THRESHOLDS,
  UNCERTAIN_BAND,
} from "@/lib/engine/verdict";
import { EVIDENCE, WEIGHTS } from "@/lib/engine/forensics";
import { PROVENANCE_MIN_QF } from "@/lib/engine/forensics";
import { LIMITS } from "@/lib/engine/runner";
import { resolveOutcomeLabel } from "@/lib/engine/report";

interface ScanRow {
  verdict: string | null;
  confidence: number | null;
  score: number | null;
  outcome?: string;
  uncertainty?: number;
  evidenceStrength?: number;
  processingTimeMs?: number;
}

export default function Developer() {
  const scans = useQuery(api.scans.listMine, { limit: 500 });
  const backend = currentBackend();

  /* live stats from this account's own scans — nothing leaves the browser */
  const stats = useMemo(() => {
    const rows = (scans ?? []) as ScanRow[];
    const withConf = rows.filter((r) => r.confidence != null);
    const withUnc = rows.filter((r) => r.uncertainty != null);
    const withEv = rows.filter((r) => r.evidenceStrength != null);
    const withTime = rows.filter((r) => r.processingTimeMs != null);
    const avg = (xs: number[]) =>
      xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
    const outcomes = { authentic: 0, synthetic: 0, inconclusive: 0, error: 0 } as Record<
      string,
      number
    >;
    for (const r of rows) {
      const key =
        r.verdict === "error"
          ? "error"
          : r.verdict === "inconclusive"
            ? "inconclusive"
            : r.verdict === "real"
              ? "authentic"
              : "synthetic";
      outcomes[key]++;
    }
    return {
      total: rows.length,
      outcomes,
      avgConfidence: avg(withConf.map((r) => r.confidence as number)),
      avgUncertainty: avg(withUnc.map((r) => r.uncertainty as number)),
      avgEvidenceStrength: avg(withEv.map((r) => r.evidenceStrength as number)),
      p50Time: avg(withTime.map((r) => r.processingTimeMs as number)),
      instrumented: withEv.length,
    };
  }, [scans]);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar variant="app" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        <header className="rule-double pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
            developer mode
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
            Detection internals
          </h1>
          <p className="mt-3 max-w-2xl font-body text-sm leading-6 text-muted-foreground">
            Detector portfolio, fusion weights, confidence model and calibration
            provenance for the engine currently deployed. Every value below is read
            from the same module the analysis runner imports, so it cannot drift
            out of sync with the engine that produced your results.
          </p>
        </header>

        {/* ---------- model versions ---------- */}
        <section className="mt-8">
          <SectionHead icon={Boxes} title="Models and versions" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Panel title="Generation classifier">
              <Row k="id" v={`${backend.id} v${backend.version}`} />
              <Row k="type" v={backend.modelBacked ? "trained model" : "measured-feature blend"} />
              <Row k="trained weights" v={backend.modelBacked ? "yes" : "none — see README"} />
              <p className="mt-3 font-body text-xs leading-5 text-muted-foreground">
                The shipped classifier is a deterministic weighted blend of calibrated
                measurements. It is not a neural network and never claims a
                fake/real probability. A trained backend can be registered against
                the same interface without changing the decision or report layers.
              </p>
            </Panel>
            <Panel title="Face detector">
              <Row k="model" v="MediaPipe BlazeFace (short-range, float16)" />
              <Row k="runs" v="locally in the browser (WASM)" />
              <Row k="used for" v="localisation only — not identity" />
              <p className="mt-3 font-body text-xs leading-5 text-muted-foreground">
                Face boxes only. No face recognition, no embedding, no identity
                inference: the model answers "where is a face", never "who".
              </p>
            </Panel>
          </div>
        </section>

        {/* ---------- detector portfolio ---------- */}
        <section className="mt-8">
          <SectionHead icon={Layers} title="Detector portfolio" />
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="font-mono text-[11px]">detector</TableHead>
                  <TableHead className="font-mono text-[11px]">version</TableHead>
                  <TableHead className="font-mono text-[11px]">evidence family</TableHead>
                  <TableHead className="font-mono text-[11px]">fusion weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {defaultDetectors().map((d) => (
                  <TableRow key={d.name}>
                    <TableCell className="font-body text-sm">{d.name}</TableCell>
                    <TableCell className="font-mono text-xs">v{d.version}</TableCell>
                    <TableCell className="font-mono text-xs">{d.group}</TableCell>
                    <TableCell className="font-mono text-xs tabular-nums">
                      {FUSION_WEIGHTS[d.group].toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            A detector that cannot run reports weight 0 and cannot move the fused score in
            either direction — a skipped measurement is never treated as a clean result.
          </p>
        </section>

        {/* ---------- classifier features ---------- */}
        <section className="mt-8">
          <SectionHead icon={Sigma} title="Classifier feature weights" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              Object.entries(HEURISTIC_FEATURE_WEIGHTS) as Array<
                [keyof typeof HEURISTIC_FEATURE_WEIGHTS, number]
              >
            )
              .filter(([, w]) => w > 0)
              .map(([k, w]) => (
                <div key={k} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-xs text-foreground">{k}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {w.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${w * 100 * 3}%` }}
                    />
                  </div>
                </div>
              ))}
          </div>
        </section>

        {/* ---------- decision core ---------- */}
        <section className="mt-8">
          <SectionHead icon={Scale} title="Decision core" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Panel title="Thresholds and calibration">
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-normal">sensitivity</th>
                      <th className="py-1 pr-3 font-normal">authentic ≤</th>
                      <th className="py-1 font-normal">synthetic ≥</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(THRESHOLDS).map(([k, v]) => (
                      <tr key={k} className="border-b border-border/40">
                        <td className="py-1 pr-3">{k}</td>
                        <td className="py-1 pr-3 tabular-nums">{v.real.toFixed(2)}</td>
                        <td className="py-1 tabular-nums">{v.fake.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 font-body text-xs leading-5 text-muted-foreground">
                A score strictly between the two thresholds returns{" "}
                <span className="font-mono text-foreground">INCONCLUSIVE</span>. The verdict is
                never rounded to the nearer side.
              </p>
            </Panel>
            <Panel title="Constants">
              <Row k="passing-check floor" v={OK_SCORE_FLOOR.toFixed(2)} />
              <Row k="structural evidence floor" v={STRUCTURAL_FLOOR.toFixed(2)} />
              <Row k="disagreement limit" v={DISAGREEMENT_LIMIT.toFixed(2)} />
              <Row k="confidence cap" v={`${CONFIDENCE_CAP}%`} />
              <Row k="uncertain band" v={`${UNCERTAIN_BAND.lo}–${UNCERTAIN_BAND.hi}%`} />
              <Row k="degraded: JPEG QF ≤" v={String(EVIDENCE.heavyJpegQf)} />
              <Row k="degraded: p90 gradient <" v={String(EVIDENCE.minSharpness)} />
              <Row k="provenance inference QF ≥" v={String(PROVENANCE_MIN_QF)} />
            </Panel>
          </div>

          <Panel title="Calibration provenance" className="mt-3">
            <Row k="method" v={CALIBRATION.method} />
            <Row k="metric" v={CALIBRATION.metric} />
            <Row k="split unit" v={CALIBRATION.separatedBy} />
            <Row k="min samples to adopt" v={String(CALIBRATION.minSamplesForAdoption)} />
            <Row k="thresholds adopted" v={CALIBRATION.adopted ? "yes" : "no"} />
            <p className="mt-3 font-body text-xs leading-5 text-muted-foreground">
              {CALIBRATION.note}
            </p>
          </Panel>
        </section>

        {/* ---------- check weights ---------- */}
        <section className="mt-8">
          <SectionHead icon={Gauge} title="Check weights" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(WEIGHTS).map(([k, w]) => (
              <div key={k} className="rounded-lg border border-border bg-card p-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {k}
                </p>
                <p className="mt-1 font-display text-lg font-semibold tabular-nums">
                  {w.toFixed(2)}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- ingestion limits ---------- */}
        <section className="mt-8">
          <SectionHead icon={TriangleAlert} title="Ingestion limits" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["image max", `${(LIMITS.imageMaxBytes / 1024 / 1024).toFixed(0)} MB`],
                ["video max", `${(LIMITS.videoMaxBytes / 1024 / 1024).toFixed(0)} MB`],
                ["video duration", `${LIMITS.videoMaxSeconds}s`],
                ["batch max", String(LIMITS.batchMax)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border bg-card p-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  {k}
                </p>
                <p className="mt-1 font-display text-lg font-semibold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 font-body text-xs leading-5 text-muted-foreground">
            Container type is validated from file signature bytes, never from the
            extension or the browser-reported MIME type.
          </p>
        </section>

        {/* ---------- live stats ---------- */}
        <section className="mt-8">
          <SectionHead icon={Activity} title="Your account's results" />
          {stats.total === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center font-body text-sm text-muted-foreground">
              No scans yet — run an analysis and these statistics populate from your own
              results. They are computed in the browser and never leave this page.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="scans" value={String(stats.total)} />
                <Stat
                  label="avg confidence"
                  value={`${stats.avgConfidence}%`}
                  hint={`capped at ${CONFIDENCE_CAP}%`}
                />
                <Stat
                  label="avg uncertainty"
                  value={`${stats.avgUncertainty}%`}
                  hint="distance to boundary"
                />
                <Stat
                  label="median engine time"
                  value={`${stats.p50Time} ms`}
                  hint="browser, on-device"
                />
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-mono text-[11px]">outcome</TableHead>
                      <TableHead className="font-mono text-[11px]">scans</TableHead>
                      <TableHead className="font-mono text-[11px]">share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(["authentic", "synthetic", "inconclusive", "error"] as const).map(
                      (k) => (
                        <TableRow key={k}>
                          <TableCell className="font-body text-sm">
                            {resolveOutcomeLabel({
                              verdict:
                                k === "error"
                                  ? "error"
                                  : k === "inconclusive"
                                    ? "inconclusive"
                                    : k === "authentic"
                                      ? "real"
                                      : "likely_ai",
                              outcome: k === "error" ? "error" : k,
                            })}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {stats.outcomes[k] ?? 0}
                          </TableCell>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {((stats.outcomes[k] ?? 0) / stats.total * 100).toFixed(0)}%
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
              </div>
              {stats.instrumented < stats.total ? (
                <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                  {stats.total - stats.instrumented} scan(s) predate the detector-fusion layer
                  and carry no per-detector breakdown.
                </p>
              ) : null}
            </>
          )}
        </section>

        <section className="mt-10">
          <Disclaimer />
        </section>
      </main>
      <Footer />
    </div>
  );
}

function SectionHead({ icon: Icon, title }: { icon: typeof Boxes; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <Icon className="size-4 text-primary" />
      <h2 className="font-display text-lg font-semibold">{title}</h2>
    </div>
  );
}

function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border bg-card p-4 ${className}`}>
      <h3 className="font-display text-sm font-semibold">{title}</h3>
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1">
      <span className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        {k}
      </span>
      <span className="truncate text-right font-mono text-[11px] text-foreground">{v}</span>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        <Timer className="size-3" />
        {label}
      </p>
      <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="font-mono text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}