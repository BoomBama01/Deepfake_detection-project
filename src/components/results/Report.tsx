/**
 * Forensic report UI.
 *
 * Visual language: a forensic bench, not a consumer AI product. Everything is
 * labelled with what it actually is, and the three-way outcome is the first
 * thing on the page.
 *
 * Layout order deliberately mirrors how a report is read:
 *   1. verdict, confidence, uncertainty      — the call
 *   2. why it is inconclusive (if it is)    — the honest caveat
 *   3. evidence categories                   — which physical layer spoke
 *   4. narrative                             — the reasoning in plain English
 *   5. expandables                           — provenance, faces, model, checks
 *
 * Provenance is rendered in its own block, never folded into the evidence
 * list, because "this file has no content credentials" and "this file looks
 * synthesised" are different claims with different consequences.
 */
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { VerdictBadge } from "@/components/VerdictBadge";
import { ConfidenceGauge } from "@/components/ConfidenceGauge";
import { Disclaimer } from "@/components/Disclaimer";
import {
  REPORT_LIMITATIONS,
  resolveOutcomeLabel,
  shouldFlagLowConfidence,
} from "@/lib/engine/report";
import { CONFIDENCE_CAP, UNCERTAIN_BAND } from "@/lib/engine/verdict";
import { HEURISTIC_BACKEND } from "@/lib/engine/detectors";
import type { Analysis, EvidenceCategoryReport, VideoAnalysis } from "@/lib/engine/types";

const STRENGTH_TONE: Record<string, string> = {
  flagged: "border-[var(--verdict-fake)]/50 bg-[var(--verdict-fake)]/10 text-[var(--verdict-fake)]",
  elevated: "border-[var(--verdict-uncertain)]/60 bg-[var(--verdict-uncertain)]/10 text-[var(--verdict-uncertain)]",
  "within-range": "border-[var(--verdict-real)]/50 bg-[var(--verdict-real)]/10 text-[var(--verdict-real)]",
  "not-measured": "border-border bg-muted text-muted-foreground",
};

const STRENGTH_WORD: Record<string, string> = {
  flagged: "FLAGGED",
  elevated: "ELEVATED",
  "within-range": "WITHIN RANGE",
  "not-measured": "NOT MEASURED",
};

function categoryStrength(cat: EvidenceCategoryReport): keyof typeof STRENGTH_TONE {
  const active = cat.signals.filter((s) => s.weight > 0);
  if (active.length === 0) return "not-measured";
  const worst = Math.max(...active.map((s) => s.score));
  if (worst >= 0.65) return "flagged";
  if (worst >= 0.4) return "elevated";
  return "within-range";
}

/** One evidence family, with its signals behind a disclosure. */
function EvidenceCategoryCard({ cat }: { cat: EvidenceCategoryReport }) {
  const strength = categoryStrength(cat);
  const active = cat.signals.filter((s) => s.weight > 0);

  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`stamp px-2 py-0.5 text-[10px] ${STRENGTH_TONE[strength]}`}
        >
          {STRENGTH_WORD[strength]}
        </span>
        <h4 className="font-display text-sm font-semibold">{cat.label}</h4>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {active.length === 0
            ? "did not run"
            : `${active.length} signal${active.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {active.length === 0 ? (
        <p className="mt-2 font-body text-xs leading-5 text-muted-foreground">
          {cat.signals[0]?.evidence ??
            "This evidence family produced no measurement for this file, so it does not influence the verdict either way."}
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {cat.signals.map((s) => (
            <li key={s.id}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-body text-xs font-medium text-foreground/90">
                  {s.label}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {s.raw}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${
                      s.score >= 0.65
                        ? "bg-[var(--verdict-fake)]"
                        : s.score >= 0.4
                          ? "bg-[var(--verdict-uncertain)]"
                          : s.weight > 0
                            ? "bg-[var(--verdict-real)]"
                            : "bg-border"
                    }`}
                    style={{ width: `${Math.round(s.score * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">
                  lean {(s.score * 100).toFixed(0)}%
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** Provenance as its own, explicitly-separate block. */
function ProvenanceBlock({ analysis }: { analysis: Analysis }) {
  const md = analysis.metadata;
  if (!md) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/40 p-4">
        <p className="font-body text-sm text-muted-foreground">
          Metadata parsing was disabled for this run, so provenance could not be assessed.
          Absent provenance is neutral — it is not evidence for or against authenticity.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-display text-sm font-semibold">
            Provenance — kept separate from detection
          </h4>
          <Badge
            className={`font-mono text-[10px] uppercase tracking-widest ${
              md.c2pa
                ? "border border-[var(--verdict-real)]/50 text-[var(--verdict-real)]"
                : "border border-border text-muted-foreground"
            }`}
          >
            {md.c2pa ? "content credentials present" : "no content credentials"}
          </Badge>
        </div>

        <p className="mt-3 rounded-md border border-dashed border-border bg-muted/30 p-3 font-body text-xs leading-6 text-muted-foreground">
          <strong className="text-foreground">Detection</strong> asks whether the pixels and
          encoding history behave like synthesised media. <strong className="text-foreground">
            Provenance
          </strong>{" "}
          asks whether the file carries a signed claim about its own origin. A file with no
          provenance is <em>not</em> automatically fake — and a missing EXIF is not treated as
          evidence of generation anywhere in this engine.
        </p>

        {md.aiSignatures.length > 0 ? (
          <div className="mt-3 rounded-md border border-[var(--verdict-fake)]/50 bg-[var(--verdict-fake)]/10 px-3 py-2 font-body text-sm text-[var(--verdict-fake)]">
            The file names AI tooling: {md.aiSignatures.join(", ")}. This is a claim the file
            makes about itself, and it is reported here rather than silently folded into a
            detection score.
          </div>
        ) : null}

        <dl className="mt-4 grid gap-x-6 gap-y-2 font-mono text-[11px] sm:grid-cols-2">
          <ProvenanceRow
            k="content credentials (C2PA)"
            v={md.c2pa ? "present — verify claims at contentcredentials.org" : "absent"}
          />
          <ProvenanceRow k="camera EXIF" v={md.hasExif ? "present" : "absent"} />
          <ProvenanceRow
            k="camera"
            v={[md.cameraMake, md.cameraModel].filter(Boolean).join(" ") || "—"}
          />
          <ProvenanceRow k="software" v={md.software ?? "—"} />
          <ProvenanceRow k="captured" v={md.dateTime ?? "—"} />
        </dl>

        {md.c2pa && md.c2paDetail ? (
          <pre className="mt-4 overflow-x-auto rounded bg-muted/70 p-3 font-mono text-[10px] leading-5 text-muted-foreground">
            {md.c2paDetail}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function ProvenanceRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/50 pb-1">
      <dt className="uppercase tracking-widest text-muted-foreground">{k}</dt>
      <dd className="truncate text-right text-foreground">{v}</dd>
    </div>
  );
}

/**
 * The report. `scanTitle` and `caseId` are presentation-only context; every
 * number here comes from the analysis object.
 */
export function ForensicReportView({
  analysis,
  caseId,
  fileName,
  title,
}: {
  analysis: Analysis;
  caseId?: string;
  fileName?: string;
  title?: string;
}) {
  const outcome = resolveOutcomeLabel(analysis);
  const lowConfidence = shouldFlagLowConfidence(analysis);
  const categories = analysis.evidence?.categories ?? [];
  const video = analysis.kind === "video" ? (analysis as VideoAnalysis) : null;

  return (
    <div className="space-y-6">
      {/* ---------- 1. the call ---------- */}
      <section className="paper-grain rounded-xl border-2 border-border bg-card p-5 sm:p-7">
        <div className="grid gap-7 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              forensic report
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <VerdictBadge verdict={analysis.verdict} large />
              <Badge
                variant="outline"
                className="font-mono text-[10px] uppercase tracking-[0.18em]"
              >
                {outcome}
              </Badge>
            </div>

            <h1 className="mt-4 font-display text-2xl font-semibold leading-snug">
              {title ?? (analysis.kind === "video" ? "Video" : "Image")} examination
              {fileName ? `: ${fileName}` : ""}
            </h1>

            {/* uncertainty — always shown, never buried */}
            <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-border/70 pt-4 sm:grid-cols-4">
              <Metric
                k="confidence"
                v={`${analysis.confidence.toFixed(0)}%`}
                hint={`capped at ${CONFIDENCE_CAP}%`}
              />
              <Metric
                k="uncertainty"
                v={`${analysis.uncertainty ?? 0}%`}
                hint="distance to a boundary"
              />
              <Metric
                k="evidence strength"
                v={`${Math.round((analysis.evidenceStrength ?? 0) * 100)}%`}
                hint="independent families"
              />
              <Metric
                k="synthetic lean"
                v={analysis.score.toFixed(3)}
                hint="0 real · 1 synthetic"
              />
            </dl>

            {lowConfidence ? (
              <p
                role="status"
                className="mt-4 rounded-md border border-[var(--verdict-uncertain)]/60 bg-[var(--verdict-uncertain)]/10 px-3 py-2 font-mono text-[11px] leading-5 text-[var(--verdict-uncertain)]"
              >
                LOW CONFIDENCE — the evidence does not firmly support the verdict above. Treat it
                as a lean, not a finding.
              </p>
            ) : null}
          </div>

          <div className="flex flex-col items-center gap-4">
            <ConfidenceGauge value={analysis.confidence} verdict={analysis.verdict} />
            <dl className="w-full space-y-1.5 border-t border-border/70 pt-4 font-mono text-[11px]">
              <Meta k="case" v={caseId ?? "—"} />
              <Meta
                k="analysed"
                v={new Date().toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              />
              <Meta k="engine time" v={`${analysis.processingTimeMs} ms`} />
              <Meta k="checks run" v={String(analysis.checks.filter((c) => c.weight > 0).length)} />
              <Meta k="faces" v={String(analysis.faces.length)} />
              {analysis.hash ? (
                <Meta k="sha-256" v={`${analysis.hash.slice(0, 20)}…`} />
              ) : null}
            </dl>
          </div>
        </div>
      </section>

      {/* ---------- 2. why inconclusive ---------- */}
      {analysis.inconclusiveReason ? (
        <section className="rounded-xl border-2 border-[var(--verdict-uncertain)]/50 bg-[var(--verdict-uncertain)]/5 p-5">
          <h2 className="font-display text-lg font-semibold">
            Why this result is inconclusive
          </h2>
          <p className="mt-2 font-body text-sm leading-6 text-foreground/90">
            {analysis.inconclusiveReason}
          </p>
          <p className="mt-3 font-body text-sm leading-6 text-muted-foreground">
            This is reported as its own outcome rather than being rounded to the nearest side. If
            you need a firmer answer, look for another copy of this media at higher quality, check
            whether it carries content credentials, or corroborate with an independent source.
          </p>
        </section>
      ) : null}

      {/* ---------- 3. evidence categories ---------- */}
      <section>
        <h2 className="font-display text-lg font-semibold">Evidence</h2>
        <p className="mt-1 font-body text-sm leading-6 text-muted-foreground">
          Each family below is measured independently. No single one of them decides the verdict,
          and a family that could not run is reported as not measured rather than guessed.
        </p>
        {categories.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center font-body text-sm text-muted-foreground">
            This result was produced before the detector-fusion layer existed, so no per-category
            evidence breakdown is stored with it. The individual measurements it did record are in
            the Technical details below.
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {categories.map((cat) => (
              <EvidenceCategoryCard key={cat.id} cat={cat} />
            ))}
          </div>
        )}
      </section>

      {/* ---------- 4. narrative ---------- */}
      <section>
        <h2 className="font-display text-lg font-semibold">Reasoning</h2>
        <ol className="mt-3 space-y-3">
          {analysis.explanation.map((line, i) => (
            <li key={i} className="flex gap-3 font-body text-sm leading-6 text-foreground/85">
              <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
        <div className="mt-5">
          <Disclaimer />
        </div>
      </section>

      {/* ---------- 5. expandables ---------- */}
      <section>
        <h2 className="font-display text-lg font-semibold">Technical details</h2>
        <Accordion type="multiple" className="mt-3">
          <AccordionItem value="provenance">
            <AccordionTrigger className="font-display text-sm">
              Provenance and metadata
            </AccordionTrigger>
            <AccordionContent>
              <ProvenanceBlock analysis={analysis} />
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="warnings">
            <AccordionTrigger className="font-display text-sm">
              Warnings and skipped checks ({analysis.warnings.length})
            </AccordionTrigger>
            <AccordionContent>
              {analysis.warnings.length === 0 ? (
                <p className="font-body text-sm text-muted-foreground">
                  Every stage completed cleanly.
                </p>
              ) : (
                <ul className="space-y-2">
                  {analysis.warnings.map((w) => (
                    <li
                      key={w}
                      className="rounded-md border border-[var(--verdict-uncertain)]/40 bg-[var(--verdict-uncertain)]/5 px-3 py-2 font-body text-sm text-muted-foreground"
                    >
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="model">
            <AccordionTrigger className="font-display text-sm">
              Model and detector versions
            </AccordionTrigger>
            <AccordionContent>
              <dl className="space-y-2 font-mono text-[11px]">
                <Meta k="engine" v={`${analysis.engine.name} v${analysis.engine.version}`} />
                <Meta
                  k="face detector"
                  v={`${analysis.engine.faceDetector.name} — ${analysis.engine.faceDetector.status}`}
                />
                <Meta
                  k="generation classifier"
                  v={`${HEURISTIC_BACKEND.id} v${HEURISTIC_BACKEND.version} (${
                    HEURISTIC_BACKEND.modelBacked ? "trained model" : "no trained weights"
                  })`}
                />
                <Meta k="confidence cap" v={`${CONFIDENCE_CAP}%`} />
                <Meta
                  k="uncertain band"
                  v={`${UNCERTAIN_BAND.lo}–${UNCERTAIN_BAND.hi}%`}
                />
              </dl>
              <p className="mt-3 rounded-md border border-dashed border-border bg-muted/40 p-3 font-body text-sm leading-6 text-muted-foreground">
                {analysis.engine.neuralClassifier.detail}
              </p>
            </AccordionContent>
          </AccordionItem>

          {analysis.evidence?.perDetector?.length ? (
            <AccordionItem value="detectors">
              <AccordionTrigger className="font-display text-sm">
                Detector portfolio ({analysis.evidence.activeDetectors}/
                {analysis.evidence.perDetector.length} contributed)
              </AccordionTrigger>
              <AccordionContent>
                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-[10px]">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-1.5 pr-3 font-normal">detector</th>
                        <th className="py-1.5 pr-3 font-normal">version</th>
                        <th className="py-1.5 pr-3 font-normal">group</th>
                        <th className="py-1.5 pr-3 font-normal">score</th>
                        <th className="py-1.5 pr-3 font-normal">conf</th>
                        <th className="py-1.5 pr-3 font-normal">state</th>
                        <th className="py-1.5 font-normal">ms</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.evidence.perDetector.map((d) => (
                        <tr key={d.detector} className="border-b border-border/50">
                          <td className="py-1.5 pr-3 text-foreground/90">{d.detector}</td>
                          <td className="py-1.5 pr-3">{d.version}</td>
                          <td className="py-1.5 pr-3">{d.group}</td>
                          <td className="py-1.5 pr-3">{d.score.toFixed(2)}</td>
                          <td className="py-1.5 pr-3">{d.confidence}</td>
                          <td className="py-1.5 pr-3">{d.reliability}</td>
                          <td className="py-1.5">{d.ranInMs}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 font-body text-xs leading-5 text-muted-foreground">
                  Fusion score over the signals that actually ran:{" "}
                  <span className="font-mono text-foreground">
                    {(analysis.evidence.fusionScore ?? analysis.score).toFixed(3)}
                  </span>
                  . Signals that could not be measured carry weight 0 and cannot move the score in
                  either direction.
                </p>
              </AccordionContent>
            </AccordionItem>
          ) : null}

          {video?.temporal ? (
            <AccordionItem value="temporal">
              <AccordionTrigger className="font-display text-sm">
                Temporal measurements
              </AccordionTrigger>
              <AccordionContent>
                <dl className="grid gap-x-6 gap-y-2 font-mono text-[11px] sm:grid-cols-2">
                  <Meta k="noise flicker" v={`${(video.temporal.flicker * 100).toFixed(1)}%`} />
                  <Meta k="score dispersion" v={video.temporal.scoreCv.toFixed(2)} />
                  <Meta k="lighting jumps" v={String(video.temporal.lightJumps)} />
                  <Meta k="scene cuts" v={String(video.temporal.cuts)} />
                  <Meta
                    k="face jitter"
                    v={`${(video.temporal.faceJitter * 100).toFixed(1)}%/frame`}
                  />
                  <Meta
                    k="frames without a face"
                    v={`${(video.temporal.noFaceRatio * 100).toFixed(0)}%`}
                  />
                </dl>
              </AccordionContent>
            </AccordionItem>
          ) : null}

          <AccordionItem value="limitations">
            <AccordionTrigger className="font-display text-sm">
              Known limitations of this detector
            </AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-2">
                {REPORT_LIMITATIONS.map((l) => (
                  <li
                    key={l}
                    className="flex gap-2 font-body text-xs leading-5 text-muted-foreground"
                  >
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--verdict-uncertain)]" />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </section>
    </div>
  );
}

function Metric({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        {k}
      </dt>
      <dd className="mt-0.5 font-display text-xl font-semibold tabular-nums">{v}</dd>
      {hint ? (
        <p className="font-mono text-[9px] leading-3 text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-1">
      <dt className="uppercase tracking-widest text-muted-foreground">{k}</dt>
      <dd className="truncate text-right text-foreground">{v}</dd>
    </div>
  );
}