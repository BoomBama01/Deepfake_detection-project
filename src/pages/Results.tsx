import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import {
  ArrowLeft,
  FileJson2,
  Loader2,
  Pin,
  Printer,
  RefreshCw,
  Share2,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChecksList,
  CompareSlider,
  FaceCards,
  MissingArtifact,
  TimelineChart,
  WarningList,
} from "@/components/results/parts";
import { getDeviceId } from "@/lib/device";
import { recallFile } from "@/lib/session";
import type { Analysis, VideoAnalysis } from "@/lib/engine/types";
import { THRESHOLDS } from "@/lib/engine/verdict";
import { ForensicReportView } from "@/components/results/Report";
import { buildReport } from "@/lib/engine/report";
import { formatDate, formatDuration } from "@/lib/format";

type ResultsQuery = ReturnType<typeof useQuery<typeof api.scans.get>>;
type Scan = Exclude<ResultsQuery, undefined | null> & {
  previewUrl?: string | null;
  heatmapUrl?: string | null;
  elaUrl?: string | null;
  mediaExpired?: boolean;
  frameUrls?: Array<{ t: number; imageUrl?: string; heatUrl?: string }>;
};

const VALID_ID = /^[a-zA-Z0-9_-]{20,}$/;

export default function Results() {
  const params = useParams();
  const id = params.id ?? "";
  const valid = VALID_ID.test(id);
  const deviceId = getDeviceId();
  const scan = useQuery(
    api.scans.get,
    valid ? { id: id as Id<"scans"> } : "skip",
  ) as Scan | undefined | null;
  const setVisibility = useMutation(api.scans.setVisibility);
  const setPinned = useMutation(api.scans.setPinned);
  const removeScan = useMutation(api.scans.remove);
  const submitFeedback = useMutation(api.feedback.submit);
  const existingFeedback = useQuery(
    api.feedback.forScan,
    valid && scan ? { scanId: id as Id<"scans"> } : "skip",
  );

  const [tab, setTab] = useState("overview");
  const [copied, setCopied] = useState(false);
  const [fbBusy, setFbBusy] = useState(false);
  const [comment, setComment] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);

  const analysis = useMemo<Analysis | null>(() => {
    if (!scan?.resultJson) return null;
    try {
      return JSON.parse(scan.resultJson) as Analysis;
    } catch {
      return null;
    }
  }, [scan]);

  /* The original video is never uploaded, so it can only be replayed while it is
     still in this tab's in-memory registry. The object URL is derived (not
     stored in state) and the effect exists solely to revoke it, which avoids
     the setState-in-effect cascade. */
  const videoUrl = useMemo(() => {
    if (analysis?.kind !== "video") return null;
    const file = recallFile(id);
    return file ? URL.createObjectURL(file) : null;
  }, [analysis, id]);

  useEffect(() => {
    if (!videoUrl) return;
    return () => URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  if (!valid || scan === undefined) {
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar variant="app" />
        <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-16 sm:px-6">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-64 w-full" />
        </main>
        <Footer />
      </div>
    );
  }

  if (scan === null) {
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar variant="app" />
        <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-20 text-center">
          <h1 className="font-display text-2xl font-semibold">Result not found</h1>
          <p className="mt-3 font-body text-sm leading-6 text-muted-foreground">
            This result does not exist, was deleted, or is private and not yours. Media
            artifacts also expire 24 hours after analysis.
          </p>
          <Button asChild className="mt-6">
            <a href="/analyze">Run a new examination</a>
          </Button>
        </main>
        <Footer />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="flex min-h-screen flex-col">
        <Navbar variant="app" />
        <main className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center px-6">
          <p className="font-body text-sm text-muted-foreground">Stored result is unreadable.</p>
        </main>
        <Footer />
      </div>
    );
  }

  const settings = safeParse(scan.settings);
  const sensitivity = (settings?.sensitivity ?? "balanced") as keyof typeof THRESHOLDS;
  const th = THRESHOLDS[sensitivity] ?? THRESHOLDS.balanced;
  const isVideo = analysis.kind === "video";
  const video = isVideo ? (analysis as VideoAnalysis) : null;
  const shareUrl = `${window.location.origin}/results/${id}`;

  /** Downloads the forensic report — the same document the page renders. */
  const downloadJson = () => {
    const payload = {
      scanId: id,
      fileName: scan.fileName,
      source: scan.source,
      settings: scan.settings,
      createdAt: new Date(scan.createdAt).toISOString(),
      expiresAt: new Date(scan.expiresAt).toISOString(),
      report: buildReport(analysis),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `truthlens-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyLink = async () => {
    try {
      if (!scan.isPublic)          await setVisibility({ id: id as Id<"scans">, isPublic: true });
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not copy the link.");
    }
  };

  const sendFeedback = async (isCorrect: boolean) => {
    setFbBusy(true);
    try {
      await submitFeedback({
        scanId: id as Id<"scans">,
        isCorrect,
        comment: comment.trim() || undefined,
      });
      toast.success("Feedback recorded — thank you, it feeds model review.");
      setComment("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save feedback.");
    } finally {
      setFbBusy(false);
    }
  };

  /* The engine reports three outcomes. Legacy rows stored before the
     three-way engine carry no `outcome` field; `resolveOutcomeLabel` (used by
     ForensicReportView) falls back from the verdict, so a legacy row is never
     silently upgraded to a confident call. */
  /* Legacy rows stored before the three-way engine carry no `outcome` field;
     `resolveOutcomeLabel` (used by ForensicReportView) falls back from the
     verdict, so an old row is never silently upgraded to a confident call. */
  const verdict = scan.verdict ?? analysis.verdict;
  const title = isVideo ? "Video examination" : "Image examination";

  return (
    <div className="flex min-h-screen flex-col">
      <div className="no-print">
        <Navbar variant="app" />
      </div>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <a
            href="/analyze"
            className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> new examination
          </a>
          <p className="font-mono text-[11px] text-muted-foreground">
            case {id.slice(0, 10)} · {formatDate(scan.createdAt)}
          </p>
        </div>

        {/* the forensic report: verdict, confidence, uncertainty, evidence, reasoning */}
        <section className="mt-4">
          <ForensicReportView
            analysis={analysis}
            caseId={id.slice(0, 10)}
            fileName={scan.fileName}
            title={title}
          />
        </section>

        {/* actions */}
        <div className="no-print mt-5 flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={downloadJson}>
            <FileJson2 className="size-4" /> Download JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => window.print()}
          >
            <Printer className="size-4" /> Save as PDF report
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void copyLink()}>
            <Share2 className="size-4" /> {copied ? "Copied!" : "Copy share link"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              try {
                sessionStorage.setItem("truthlens-settings", scan.settings);
              } catch {
                /* ignore */
              }
              toast.info("Settings restored on the Analyze page — drop the file to re-run.");
              window.location.href = "/analyze";
            }}
          >
            <RefreshCw className="size-4" /> Re-analyze
          </Button>
          <div className="ml-auto flex items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5">
            <Label
              htmlFor="public-toggle"
              className="font-mono text-[11px] text-muted-foreground"
            >
              public link
            </Label>
            <Switch
              id="public-toggle"
              checked={scan.isPublic}
              onCheckedChange={(v) =>
                void setVisibility({ id: id as Id<"scans">, isPublic: v }).catch(
                  (e) => toast.error(String(e)),
                )
              }
            />
          </div>
          <div className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-1.5">
            <Pin className="size-3.5 text-muted-foreground" />
            <Label htmlFor="pin-toggle" className="font-mono text-[11px] text-muted-foreground">
              keep media
            </Label>
            <Switch
              id="pin-toggle"
              checked={scan.pinned}
              onCheckedChange={(v) =>
                void setPinned({ id: id as Id<"scans">, pinned: v }).catch((e) =>
                  toast.error(String(e)),
                )
              }
            />
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                <Trash2 className="size-4" /> Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="font-display">
                  Delete this result?
                </AlertDialogTitle>
                <AlertDialogDescription>
                  The stored preview, heatmaps and the result summary will be permanently
                  removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    await removeScan({ id: id as Id<"scans"> });
                    toast.success("Result deleted.");
                    window.location.href = "/dashboard";
                  }}
                >
                  Delete permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* tabs */}
        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="h-auto w-full flex-wrap justify-start">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
            <TabsTrigger value="faces">Faces ({analysis.faces.length})</TabsTrigger>
            {isVideo && <TabsTrigger value="timeline">Timeline</TabsTrigger>}
            <TabsTrigger value="metadata">Metadata</TabsTrigger>
            <TabsTrigger value="forensics">Forensics</TabsTrigger>
            {isVideo && video?.audio && (
              <TabsTrigger value="audio">Audio</TabsTrigger>
            )}
            <TabsTrigger value="technical">Technical</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-5 space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard label="Verdict" value={labelOf(verdict)} />
              <StatCard
                label="Confidence"
                value={`${analysis.confidence.toFixed(0)}% (capped below 100)`}
              />
              <StatCard label="Checks run" value={String(analysis.checks.filter((c) => c.weight > 0).length)} />
              <StatCard
                label="Flags raised"
                value={String(analysis.checks.filter((c) => c.status === "flag").length)}
              />
              <StatCard
                label="Faces analysed"
                value={String(analysis.faces.length)}
              />
              <StatCard label="Content hash" value={analysis.hash ? `${analysis.hash.slice(0, 16)}…` : "—"} />
            </div>
            <div>
              <h3 className="mb-3 font-display text-lg font-semibold">Warnings</h3>
              {analysis.warnings.length ? (
                <WarningList warnings={analysis.warnings} />
              ) : (
                <p className="font-body text-sm text-muted-foreground">
                  No warnings — every stage completed cleanly.
                </p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="heatmap" className="mt-5 space-y-5">
            {!isVideo && scan.previewUrl && scan.heatmapUrl ? (
              <>
                <CompareSlider
                  original={scan.previewUrl}
                  overlay={scan.heatmapUrl}
                  overlayAlt="Suspicious-region heatmap overlay"
                />
                <p className="font-body text-sm leading-6 text-muted-foreground">
                  The overlay brightens regions whose re-compression error concentrates —
                  pasted, retouched or regenerated areas tend to glow while consistent
                  camera content stays even.
                </p>
                {scan.elaUrl && (
                  <figure className="rounded-lg border border-border bg-card p-3">
                    <img
                      src={scan.elaUrl}
                      alt="Error level analysis view"
                      className="w-full rounded"
                    />
                    <figcaption className="mt-2 font-mono text-[11px] text-muted-foreground">
                      Error Level Analysis — brightness = error introduced by a 0.9-quality
                      re-encode.
                    </figcaption>
                  </figure>
                )}
              </>
            ) : isVideo ? (
              <FrameGallery scan={scan as any} analysis={video!} compact />
            ) : scan.mediaExpired ? (
              <MissingArtifact what="Media artifacts expired 24 hours after analysis (privacy policy). The measurements above remain." />
            ) : (
              <MissingArtifact what="No heatmap was generated for this run — ELA was disabled in settings." />
            )}
          </TabsContent>

          <TabsContent value="faces" className="mt-5">
            <FaceCards
              faces={analysis.faces}
              note={
                analysis.engine.faceDetector.status === "unavailable"
                  ? `Face detector unavailable: ${analysis.engine.faceDetector.detail ?? "model failed to load"} — face checks did not run and no face scores were invented.`
                  : isVideo
                    ? "Faces shown are from the most suspicious sampled frame; per-frame face scores feed the timeline."
                    : undefined
              }
            />
          </TabsContent>

          {isVideo && video && (
            <TabsContent value="timeline" className="mt-5 space-y-5">
              {videoUrl ? (
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="max-h-[420px] w-full rounded-lg border border-border bg-black"
                />
              ) : (
                <MissingArtifact what="The original video is never uploaded, so it can't be replayed after a reload. The timeline and captured frames below still show the full analysis." />
              )}
              <TimelineChart
                timeline={video.timeline}
                fakeThreshold={th.fake}
                realThreshold={th.real}
                duration={video.durationSec}
                onSeek={(t) => {
                  const el = videoRef.current;
                  if (el) {
                    el.currentTime = t;
                    void el.play().catch(() => undefined);
                  } else {
                    toast.info(`Spike at ${formatDuration(t)} — open the original file to jump there.`);
                  }
                }}
                markers={video.suspiciousFrames.slice(0, 4).map((f) => ({
                  t: f.t,
                  label: `▲ ${f.t.toFixed(1)}s`,
                }))}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <TemporalCard video={video} />
                <FrameGallery scan={scan as any} analysis={video} compact />
              </div>
            </TabsContent>
          )}

          <TabsContent value="metadata" className="mt-5">
            {analysis.metadata ? (
              <div className="rounded-lg border border-border bg-card p-5">
                {analysis.metadata.aiSignatures.length > 0 && (
                  <div className="mb-4 rounded-md border border-[var(--verdict-fake)]/50 bg-[var(--verdict-fake)]/10 px-3 py-2 font-body text-sm text-[var(--verdict-fake)]">
                    Direct generator signatures found:{" "}
                    {analysis.metadata.aiSignatures.join(", ")}
                  </div>
                )}
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Meta k="container" v={analysis.metadata.format} />
                  <Meta k="camera EXIF" v={analysis.metadata.hasExif ? "present" : "absent"} />
                  <Meta
                    k="camera"
                    v={
                      [analysis.metadata.cameraMake, analysis.metadata.cameraModel]
                        .filter(Boolean)
                        .join(" ") || "—"
                    }
                  />
                  <Meta k="software" v={analysis.metadata.software ?? "—"} />
                  <Meta k="captured" v={analysis.metadata.dateTime ?? "—"} />
                  <Meta k="C2PA" v={analysis.metadata.c2pa ? "present" : "absent"} />
                </dl>
                {analysis.metadata.c2pa && analysis.metadata.c2paDetail && (
                  <pre className="mt-4 overflow-x-auto rounded bg-muted/70 p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                    {analysis.metadata.c2paDetail}
                  </pre>
                )}
                {Object.keys(analysis.metadata.tags).length > 0 && (
                  <div className="mt-5">
                    <h4 className="mb-2 font-display text-sm font-semibold">Tag dump</h4>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(analysis.metadata.tags).map(([k, v]) => (
                        <span
                          key={k}
                          className="rounded border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {k}={String(v).slice(0, 60)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {analysis.metadata.warnings.length > 0 && (
                  <div className="mt-4">
                    <WarningList warnings={analysis.metadata.warnings} />
                  </div>
                )}
              </div>
            ) : (
              <MissingArtifact what="Metadata parsing was disabled for this run." />
            )}
          </TabsContent>

          <TabsContent value="forensics" className="mt-5 space-y-5">
            <p className="font-body text-sm leading-6 text-muted-foreground">
              Every check below ran on this exact file. “Within range” only leans authentic —
              it is not proof of authenticity.
            </p>
            <ChecksList checks={analysis.checks} />
          </TabsContent>

          {isVideo && video && video.audio && (
            <TabsContent value="audio" className="mt-5">
              <div className="rounded-lg border border-border bg-card p-5">
                <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                  <Meta k="track duration" v={`${video.audio.durationSec.toFixed(1)}s`} />
                  <Meta k="sample rate" v={`${video.audio.sampleRate} Hz`} />
                  <Meta k="clipping" v={`${(video.audio.clippingRatio * 100).toFixed(3)}%`} />
                  <Meta k="silence" v={`${(video.audio.silenceRatio * 100).toFixed(1)}%`} />
                  <Meta k="DC offset" v={video.audio.dcOffset.toFixed(4)} />
                  <Meta k="loudness uniformity" v={`${(video.audio.uniformity * 100).toFixed(1)}%`} />
                </dl>
                <p className="mt-4 font-body text-sm leading-6 text-muted-foreground">
                  {video.audio.note}
                </p>
              </div>
            </TabsContent>
          )}

          <TabsContent value="technical" className="mt-5 space-y-5">
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-display text-base font-semibold">Engine</h3>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <Meta k="engine" v={`${analysis.engine.name} v${analysis.engine.version}`} />
                <Meta
                  k="face detector"
                  v={`${analysis.engine.faceDetector.name} — ${analysis.engine.faceDetector.status}`}
                />
                <Meta k="content hash" v={analysis.hash ?? "—"} />
                <Meta k="processing time" v={`${analysis.processingTimeMs} ms`} />
              </dl>
              <p className="mt-4 rounded-md border border-dashed border-border bg-muted/40 p-3 font-body text-sm leading-6 text-muted-foreground">
                {analysis.engine.neuralClassifier.detail}
              </p>
            </div>
            <div className="rounded-lg border border-border bg-card p-5">
              <h3 className="font-display text-base font-semibold">Decision rules in force</h3>
              <ul className="mt-3 space-y-2 font-mono text-xs leading-6 text-muted-foreground">
                <li>
                  thresholds (sensitivity {sensitivity}): real ≤ {th.real.toFixed(2)} · fake ≥{" "}
                  {th.fake.toFixed(2)}
                </li>
                <li>passing checks lean authentic only weakly (floor 0.30)</li>
                <li>
                  direct generator signatures in metadata floor the score at 0.72 (structural
                  evidence)
                </li>
                <li>
                  every score resolves to a binary verdict — Real or AI-side; scores between the
                  thresholds go to the side of the midpoint and are capped at 50% confidence
                </li>
                <li>
                  any flagged check vetoes Real — score floors onto the AI side of the decision
                  midpoint; the worst face measurement ≥ 0.80 floors at the synthetic threshold
                  (likely deepfake)
                </li>
                <li>
                  degraded evidence (JPEG quality ≤ 65 or p90 gradient &lt; 95) keeps its Real call
                  but caps confidence at 50% and marks it low-confidence
                </li>
                <li>
                  face-dominant images up-weight face checks and scale whole-frame checks ×0.4
                </li>
                <li>
                  confidence = boundary distance × check agreement × coverage, capped at 97% (50%
                  for borderline or degraded calls; 40–60% is drawn as the uncertain band)
                </li>
              </ul>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full font-mono text-[11px]">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1.5 pr-3 font-normal">check</th>
                      <th className="py-1.5 pr-3 font-normal">status</th>
                      <th className="py-1.5 pr-3 font-normal">measured</th>
                      <th className="py-1.5 pr-3 font-normal">lean</th>
                      <th className="py-1.5 font-normal">weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.checks.map((c) => (
                      <tr key={c.id + c.label} className="border-b border-border/50">
                        <td className="py-1.5 pr-3 text-foreground/90">{c.label}</td>
                        <td className="py-1.5 pr-3">{c.status}</td>
                        <td className="py-1.5 pr-3">{c.display}</td>
                        <td className="py-1.5 pr-3">{c.score.toFixed(2)}</td>
                        <td className="py-1.5">{c.weight.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* feedback */}
        <section className="no-print mt-10 rounded-lg border border-border bg-card p-5">
          <h3 className="font-display text-base font-semibold">Report incorrect result</h3>
          {existingFeedback && existingFeedback.length > 0 ? (
            <p className="mt-2 font-body text-sm text-muted-foreground">
              You already rated this result ({existingFeedback[0].isCorrect ? "correct" : "incorrect"}
              ). Submitting again adds another note for model review.
            </p>
          ) : (
            <p className="mt-2 font-body text-sm text-muted-foreground">
              Was this verdict right? Feedback is reviewed against future model updates.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={fbBusy}
              onClick={() => void sendFeedback(true)}
            >
              <ThumbsUp className="size-4" /> Correct
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={fbBusy}
              onClick={() => void sendFeedback(false)}
            >
              <ThumbsDown className="size-4" /> Incorrect
            </Button>
            {fbBusy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Optional: what did the real file look like? What should the engine have caught?"
            className="mt-3 font-body text-sm"
            maxLength={1000}
          />
        </section>
      </main>
      <div className="no-print">
        <Footer />
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="uppercase tracking-widest text-muted-foreground">{k}</dt>
      <dd className="text-foreground">{v}</dd>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 font-display text-base font-semibold">{value}</p>
    </div>
  );
}

function TemporalCard({ video }: { video: VideoAnalysis }) {
  const t = video.temporal;
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h4 className="font-display text-sm font-semibold">Temporal consistency</h4>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[11px]">
        <Meta k="noise flicker" v={`${(t.flicker * 100).toFixed(1)}%`} />
        <Meta k="score spread (CV)" v={t.scoreCv.toFixed(2)} />
        <Meta k="lighting jumps" v={String(t.lightJumps)} />
        <Meta k="scene cuts" v={String(t.cuts)} />
        <Meta k="face jitter" v={`${(t.faceJitter * 100).toFixed(1)}%/frame`} />
        <Meta k="frames w/o face" v={`${(t.noFaceRatio * 100).toFixed(0)}%`} />
      </dl>
    </div>
  );
}

function FrameGallery({
  scan,
  analysis,
  compact = false,
}: {
  scan: Scan;
  analysis: VideoAnalysis;
  compact?: boolean;
}) {
  const frames = analysis.suspiciousFrames;
  if (!frames.length) {
    return <MissingArtifact what="No suspicious frames were captured for this video." />;
  }
  const urlFor = (t: number) => (scan as any).frameUrls?.find((f: any) => Math.abs(f.t - t) < 1e-6);
  return (
    <div>
      {!compact && (
        <h3 className="mb-3 font-display text-lg font-semibold">Most suspicious frames</h3>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {frames.slice(0, compact ? 4 : 8).map((f) => {
          const urls = urlFor(f.t);
          return (
            <figure
              key={f.index}
              className="overflow-hidden rounded-lg border border-border bg-card"
            >
              {urls?.imageUrl ? (
                <img
                  src={urls.imageUrl}
                  alt={`Frame at ${f.t.toFixed(1)} seconds`}
                  className="aspect-video w-full object-cover"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-muted">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    frame image expired
                  </span>
                </div>
              )}
              <figcaption className="flex items-center justify-between px-3 py-2 font-mono text-[11px]">
                <span className="text-muted-foreground">t = {f.t.toFixed(1)}s</span>
                <span
                  className={
                    f.score >= 0.62
                      ? "text-[var(--verdict-fake)]"
                      : f.score >= 0.38
                        ? "text-[var(--verdict-uncertain)]"
                        : "text-[var(--verdict-real)]"
                  }
                >
                  lean {(f.score * 100).toFixed(0)}%
                </span>
              </figcaption>
              {urls?.heatUrl && (
                <div className="border-t border-border/70">
                  <img
                    src={urls.heatUrl}
                    alt={`Heatmap for frame at ${f.t.toFixed(1)} seconds`}
                    className="w-full"
                  />
                </div>
              )}
            </figure>
          );
        })}
      </div>
    </div>
  );
}

function labelOf(v: string): string {
  return v.replace(/_/g, " ");
}

function safeParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}
