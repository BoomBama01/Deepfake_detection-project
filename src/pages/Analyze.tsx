import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useAction, useMutation } from "convex/react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
  Files,
  CheckCircle2,
  Circle,
  FileImage,
  FileVideo,
  Link2,
  Loader2,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Disclaimer } from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnalysis, QuotaError } from "@/hooks/use-analysis";
import { AnalysisError, LIMITS } from "@/lib/engine/runner";
import {
  DEFAULT_SETTINGS,
  type AnalysisSettings,
  type Sensitivity,
  type StageProgress,
} from "@/lib/engine/types";
import { formatBytes } from "@/lib/format";
import { renderPreview, dataUrlToBlob } from "@/lib/engine/artifacts";
import { getDeviceId } from "@/lib/device";
import type { Id } from "@/convex/_generated/dataModel";
import type { DetectionResult } from "@/hooks/use-analysis";

const SETTINGS_KEY = "truthlens-settings";

function loadSettings(): AnalysisSettings {
  try {
    const raw = sessionStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AnalysisSettings>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

const STAGE_ORDER_IMAGE = ["validating", "hashing", "decoding", "faces", "forensics", "report"];
const STAGE_ORDER_VIDEO = [
  "validating",
  "hashing",
  "decoding",
  "extracting frames",
  "analyzing frames",
  "temporal",
  "audio",
  "report",
];

function Stepper({
  progress,
  savingNote,
  elapsedMs,
  kind,
}: {
  progress: StageProgress | null;
  savingNote: string | null;
  elapsedMs: number;
  kind: "image" | "video";
}) {
  const order = kind === "video" ? STAGE_ORDER_VIDEO : STAGE_ORDER_IMAGE;
  const pct = savingNote ? 100 : (progress?.pct ?? 0);
  const eta =
    pct > 5 && pct < 100 ? Math.max(1, Math.round((elapsedMs * (100 - pct)) / pct / 1000)) : null;
  const idx = progress ? order.indexOf(progress.stage) : order.length;

  return (
    <div className="paper-grain rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-base font-semibold">
          <Loader2 className="mr-2 inline size-4 animate-spin text-primary" />
          {savingNote ?? progress?.note ?? "Preparing…"}
        </p>
        <span className="font-mono text-sm tabular-nums text-muted-foreground">{pct}%</span>
      </div>
      <Progress value={pct} className="mt-3 h-2" aria-label="Analysis progress" />
      <div className="mt-3 flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
        <span>{savingNote ? "saving" : progress?.stage}</span>
        <span>{eta !== null ? `≈ ${eta}s remaining` : "estimating…"}</span>
      </div>
      <ol className="mt-4 grid gap-2 sm:grid-cols-2">
        {order.map((s, i) => {
          const done = savingNote ? true : i < idx;
          const active = !savingNote && i === idx;
          return (
            <li
              key={s}
              className={`flex items-center gap-2 font-mono text-xs ${                active ? "text-primary" : done ? "text-foreground/80" : "text-muted-foreground/60"
              }`}
            >
              {done ? (
                <CheckCircle2 className="size-3.5 text-[var(--verdict-real)]" />
              ) : active ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Circle className="size-3.5" />
              )}
              {s}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface BatchItem {
  file: File;
  status: "queued" | "running" | "done" | "error";
  pct: number;
  stage?: string;
  error?: string;
  resultId?: string;
  reused?: boolean;
}

/** Decode a File into an HTMLImageElement for the artifact renderers. */
async function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image."));
    };
    img.src = url;
  });
}

export default function Analyze() {
  const { runFile, quota } = useAnalysis();
  const fetchRemote = useAction(api.proxy.fetchRemoteMedia);
  const navigate = useNavigate();
  const getUploadUrl = useMutation(api.scans.getUploadUrl);
  const createScan = useMutation(api.scans.add);

  const [settings, setSettings] = useState<AnalysisSettings>(loadSettings);
  const [consent, setConsent] = useState(false);
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [tab, setTab] = useState("image");
  const [urlValue, setUrlValue] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchItem[]>([]);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const batchInputRef = useRef<HTMLInputElement>(null);

  const busy = progress !== null || savingNote !== null;

  useEffect(() => {
    try {
      sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  useEffect(() => {
    if (!startedAt || busy === false) return;
    const t = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(t);
  }, [startedAt, busy]);

  const preflight = useCallback((): boolean => {
    if (!consent) {
      toast.error("Confirm you have the right to analyse this media first.");
      return false;
    }
    if (quota && quota.used >= quota.limit) {
      toast.error(`Daily limit reached (${quota.used}/${quota.limit}). Sign in or try tomorrow.`);
      navigate(`/auth?returnTo=${encodeURIComponent("/analyze")}`);
      return false;
    }
    return true;
  }, [consent, navigate, quota]);

  const persistAnalysis = useCallback(
    async (
      file: File,
      source: "upload" | "url" | "sample",
      out: DetectionResult,
    ): Promise<Id<"scans">> => {
      setSavingNote("saving");
      const img = await fileToImage(file);
      const preview = renderPreview(img, img.naturalWidth, img.naturalHeight);
      const uploadUrlResult = await getUploadUrl({
        contentType: preview.dataUrl.split(",")[0].split(";")[0].replace("data:", ""),
        name: file.name + ".preview.jpg",
      });
      const uploadRes = await fetch(uploadUrlResult.url, {
        method: "POST",
        body: dataUrlToBlob(preview.dataUrl),
      });
      const { storageId } = (await uploadRes.json()) as { storageId: Id<"_storage"> };
      if (!storageId) throw new Error("Storage upload did not return an id.");        const analysis = out.analysis;
        const verdict = analysis?.verdict;
        const confidence = analysis?.confidence;
        const createRes = await createScan({
          type: file.type.startsWith("video") ? ("video" as const) : ("image" as const),
          source,
          fileName: file.name,
          status: "done",
          verdict: verdict ?? undefined,
          confidence: confidence ?? undefined,
        settings: JSON.stringify(settings),
        resultJson: JSON.stringify(analysis ?? {}),
        deviceId: getDeviceId(),
        previewId: storageId,
        isPublic: false,
      });
      setSavingNote(null);
      return createRes;
    },
    [settings, getUploadUrl, createScan],
  );

  const runSingle = useCallback(
    async (file: File, source: "upload" | "url" | "sample" = "upload") => {
      if (!preflight()) return;
      cancelled.current = false;
      setStartedAt(Date.now());
      setProgress({ stage: "validating", pct: 2, note: "Validating file" });
      try {
        const out = await runFile(file, settings, source, {
          isCancelled: () => cancelled.current,
        });
        if (out.reused) {
          toast.info("Identical file + settings: reusing the earlier result.");
          navigate(`/results/${out.id}`);
          return;
        }
        const scanId = await persistAnalysis(file, source, out);
        navigate(`/results/${scanId}`);
      } catch (err) {
        setProgress(null);
        setSavingNote(null);
        setStartedAt(null);
        if (err instanceof QuotaError) toast.error(err.message);
        else if (err instanceof AnalysisError)
          toast.error(err.details ? `${err.message} — ${err.details}` : err.message);
        else if ((err as Error)?.name === "AnalysisCancelled") toast.info("Scan cancelled.");
        else {
          const msg = err instanceof Error ? err.message : "Analysis failed.";
          toast.error(msg);
          try {
            await createScan({
              type: file.type.startsWith("video") ? ("video" as const) : ("image" as const),
              source,
              fileName: file.name,
              status: "error",
              errorMessage: msg,
              settings: JSON.stringify(settings),
              deviceId: getDeviceId(),
              isPublic: false,
            });
          } catch {
            /* give up on the error-row write */
          }
        }
      }
    },
    [navigate, preflight, runFile, settings, persistAnalysis, createScan],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void runSingle(file);
  };

  const onBatchDrop = useCallback(
    async (files: FileList | File[]) => {
      if (!preflight()) return;
      const list = Array.from(files).slice(0, LIMITS.batchMax);
      if (!list.length) return;
      if (files.length > LIMITS.batchMax) {
        toast.warning(`Batch limited to ${LIMITS.batchMax} files — extra files were skipped.`);
      }
      setBatch(list.map((f) => ({ file: f, status: "queued", pct: 0 })));
      for (let i = 0; i < list.length; i++) {
        if (cancelled.current) break;
        setBatch((b) =>
          b.map((it, j) => (j === i ? { ...it, status: "running", stage: "starting" } : it)),
        );
        try {
          const out = await runFile(list[i], settings, "upload", {
            isCancelled: () => cancelled.current,
          });
          if (out.reused) {
            setBatch((b) =>
              b.map((it, j) =>
                j === i
                  ? { ...it, status: "done", pct: 100, resultId: out.id, reused: true }
                  : it,
              ),
            );
            continue;
          }
          setBatch((b) =>
            b.map((it, j) =>
              j === i ? { ...it, status: "running", stage: "saving" } : it,
            ),
          );
          const scanId = await persistAnalysis(list[i], "upload", out);
          setBatch((b) =>
            b.map((it, j) =>
              j === i
                ? { ...it, status: "done", pct: 100, resultId: scanId, reused: false }
                : it,
            ),
          );
        } catch (err) {
          setBatch((b) =>
            b.map((it, j) =>
              j === i
                ? {
                    ...it,
                    status: "error",
                    error: err instanceof Error ? err.message : "Failed",
                  }
                : it,
            ),
          );
        }
      }
      toast.success("Batch finished.");
    },
    [preflight, runFile, settings, persistAnalysis, LIMITS.batchMax],
  );

  const submitUrl = async () => {
    setUrlError(null);
    if (!preflight()) return;
    if (!/^https?:\/\//i.test(urlValue.trim())) {
      setUrlError("Enter a full http(s) URL to an image.");
      return;
    }
    setStartedAt(Date.now());
    setProgress({ stage: "validating", pct: 4, note: "Fetching the file server-side" });
    try {
      const remote = await fetchRemote({ url: urlValue.trim() });
      const bytes = Uint8Array.from(atob(remote.base64), (c) => c.charCodeAt(0));
      const file = new File([bytes], remote.fileName, { type: remote.mime });
      setProgress(null);
      await runSingle(file, "url");
    } catch (err) {
      setProgress(null);
      setStartedAt(null);
      const msg = err instanceof Error ? err.message : "URL fetch failed.";
      setUrlError(msg);
    }
  };

  const dropHint = (kind: "image" | "video") => (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Drop ${kind} file`}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-primary/5"
      }`}
    >
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        {kind === "image" ? <FileImage className="size-5" /> : <FileVideo className="size-5" />}
      </span>
      <p className="mt-3 font-display text-lg font-semibold">
        Drop {kind === "image" ? "an image" : "a video"} here
      </p>
      <p className="mt-1 font-body text-sm text-muted-foreground">
        {kind === "image"
          ? "JPG, PNG, WEBP or GIF · max 15 MB"
          : "MP4, MOV, WEBM or AVI · max 200 MB and 3 minutes"}
      </p>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={kind === "image" ? "image/*" : "video/*"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void runSingle(f);
        }}
      />
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar variant="app" />
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
              examination room
            </p>
            <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">
              Analyse media
            </h1>
            <p className="mt-2 max-w-xl font-body text-sm leading-6 text-muted-foreground">
              Files are examined in your browser; only a downscaled preview and derived
              artifacts are stored, purged after 24 hours.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {quota && (
              <div className="rounded-md border border-border bg-card px-3 py-2 text-right">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                  daily quota
                </p>
                <p className="font-mono text-sm font-semibold">
                  {quota.used} / {quota.limit}
                </p>
              </div>
            )}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Settings2 className="size-4" /> Settings
                </Button>
              </SheetTrigger>
              <SheetContent className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                  <SheetTitle className="font-display text-lg">Examination settings</SheetTitle>
                </SheetHeader>
                <div className="mt-6 space-y-6">
                  <div>
                    <Label className="font-display text-sm">Sensitivity</Label>
                    <RadioGroup
                      value={settings.sensitivity}
                      onValueChange={(v) =>
                        setSettings((s) => ({ ...s, sensitivity: v as Sensitivity }))
                      }
                      className="mt-2 space-y-1"
                    >
                      {(
                        [
                          ["low", "Low — only strong evidence calls a fake"],
                          ["balanced", "Balanced — the default"],
                          ["high", "High — flags anything suspicious"],
                        ] as const
                      ).map(([val, label]) => (
                        <label
                          key={val}
                          className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border/70 px-3 py-2 font-body text-sm hover:bg-muted/50"
                        >
                          <RadioGroupItem value={val} />
                          {label}
                        </label>
                      ))}
                    </RadioGroup>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="font-display text-sm">Frame sampling</Label>
                      <RadioGroup
                        value={String(settings.frameRate)}
                        onValueChange={(v) =>
                          setSettings((s) => ({ ...s, frameRate: Number(v) }))
                        }
                        className="mt-2 flex gap-2"
                      >
                        {[1, 2, 4].map((r) => (
                          <label
                            key={r}
                            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 font-mono text-xs hover:bg-muted/50"
                          >
                            <RadioGroupItem value={String(r)} /> {r} fps
                          </label>
                        ))}
                      </RadioGroup>
                    </div>
                    <div>
                      <Label className="font-display text-sm">Max frames</Label>
                      <RadioGroup
                        value={String(settings.maxFrames)}
                        onValueChange={(v) =>
                          setSettings((s) => ({ ...s, maxFrames: Number(v) }))
                        }
                        className="mt-2 flex gap-2"
                      >
                        {[60, 90, 150].map((r) => (
                          <label
                            key={r}
                            className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 font-mono text-xs hover:bg-muted/50"
                          >
                            <RadioGroupItem value={String(r)} /> {r}
                          </label>
                        ))}
                      </RadioGroup>
                    </div>
                  </div>

                  {(
                    [
                      ["enableEla", "Error Level Analysis (heatmap/ELA views)"],
                      ["enableMetadata", "Metadata & provenance (EXIF / C2PA)"],
                      ["enableAudio", "Audio continuity profile (video)"],
                    ] as const
                  ).map(([key, label]) => (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-2.5"
                    >
                      <span className="font-body text-sm">{label}</span>
                      <Switch
                        checked={settings[key]}
                        onCheckedChange={(v) => setSettings((s) => ({ ...s, [key]: v }))}
                        aria-label={label}
                      />
                    </div>
                  ))}

                  <div className="rule-double pt-4">
                    <p className="font-mono text-[11px] leading-5 text-muted-foreground">
                      Sensitivity shifts the verdict thresholds (Low 0.30/0.75 · Balanced
                      0.38/0.62 · High 0.45/0.52). All other numbers stay measured.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setSettings(DEFAULT_SETTINGS)}
                  >
                    Reset to defaults
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <div className="mt-6">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-dashed border-border bg-muted/40 px-4 py-3 font-body text-sm">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              className="mt-0.5"
            />
            <span>
              I have the right to analyze this media.{" "}
              <span className="text-muted-foreground">
                (Required — we never analyse media you have no permission to examine.)
              </span>
            </span>
          </label>
        </div>

        {busy && (
          <div className="mt-6">
            <Stepper
              progress={progress}
              savingNote={savingNote}
              elapsedMs={elapsed}
              kind={tab === "video" ? "video" : "image"}
            />
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="image">Image</TabsTrigger>
            <TabsTrigger value="video">Video</TabsTrigger>
            <TabsTrigger value="url">URL</TabsTrigger>
            <TabsTrigger value="batch">Batch</TabsTrigger>
          </TabsList>

          <TabsContent value="image" className="mt-4">
            <div className="paper-grain rounded-lg border border-border bg-card p-5">
              <h2 className="font-display text-lg font-semibold">Image examination</h2>
              <p className="mt-1 font-body text-sm text-muted-foreground">
                Faces are located with BlazeFace, then noise, spectrum, grid, ELA, histogram
                and provenance checks run over the whole frame.
              </p>
              {dropHint("image")}
            </div>
          </TabsContent>

          <TabsContent value="video" className="mt-4">
            <div className="paper-grain rounded-lg border border-border bg-card p-5">
              <h2 className="font-display text-lg font-semibold">Video examination</h2>
              <p className="mt-1 font-body text-sm text-muted-foreground">
                Frames are sampled at {settings.frameRate} fps (up to {settings.maxFrames}),
                faces tracked across them, and temporal consistency measured for flicker,
                lighting jumps and face-geometry jitter.
              </p>
              {dropHint("video")}
            </div>
          </TabsContent>

          <TabsContent value="url" className="mt-4">
            <div className="paper-grain rounded-lg border border-border bg-card p-5">
              <h2 className="font-display text-lg font-semibold">Examine by URL</h2>
              <p className="mt-1 font-body text-sm text-muted-foreground">
                Direct JPEG/PNG/WebP URLs up to 9 MB. The file is fetched by our server
                (SSRF-validated: private ranges blocked), then analysed locally like any
                upload. Video-by-URL and social-platform links are not supported in v1.
              </p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  placeholder="https://example.com/photo.jpg"
                  inputMode="url"
                  className="font-mono text-sm"
                  aria-label="Image URL"
                />
                <Button onClick={() => void submitUrl()} disabled={busy} className="gap-2">
                  <Link2 className="size-4" /> Examine URL
                </Button>
              </div>
              {urlError && (
                <div
                  role="alert"
                  className="mt-3 rounded-md border border-[var(--verdict-fake)]/50 bg-[var(--verdict-fake)]/10 px-3 py-2 font-body text-sm text-[var(--verdict-fake)]"
                >
                  {urlError}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="batch" className="mt-4">
            <div className="paper-grain rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
                    <Files className="size-4 text-primary" /> Batch examination
                  </h2>
                  <p className="mt-1 font-body text-sm text-muted-foreground">
                    Up to {LIMITS.batchMax} files, processed one at a time with individual
                    progress.
                  </p>
                </div>
                <Button variant="outline" onClick={() => batchInputRef.current?.click()}>
                  Choose files
                </Button>
              </div>
              <input
                ref={batchInputRef}
                type="file"
                multiple
                className="hidden"
                accept="image/*,video/*"
                onChange={(e) => {
                  if (e.target.files) void onBatchDrop(e.target.files);
                  e.target.value = "";
                }}
              />
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files?.length) void onBatchDrop(e.dataTransfer.files);
                }}
                className={`mt-4 rounded-lg border-2 border-dashed px-6 py-8 text-center ${                  dragging ? "border-primary bg-primary/5" : "border-border"
                }`}
              >
                <Upload className="mx-auto size-5 text-primary" />
                <p className="mt-2 font-body text-sm text-muted-foreground">
                  Drop multiple files here
                </p>
              </div>

              {batch.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {batch.map((item, i) => (
                    <li
                      key={`${item.file.name}-${i}`}
                      className="rounded-md border border-border/70 bg-background/60 px-3 py-2.5"
                    >
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate font-body text-sm">
                          {item.file.name}
                        </span>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {formatBytes(item.file.size)}
                        </span>
                        {item.status === "done" && item.resultId && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            onClick={() => navigate(`/results/${item.resultId}`)}
                          >
                            View
                          </Button>
                        )}
                        {item.status === "error" && (
                          <span className="font-mono text-[11px] text-[var(--verdict-fake)]">
                            failed
                          </span>
                        )}
                        {item.status === "running" && (
                          <Loader2 className="size-4 animate-spin text-primary" />
                        )}
                        {item.status === "queued" && (
                          <span className="font-mono text-[11px] text-muted-foreground">
                            queued
                          </span>
                        )}
                      </div>
                      {(item.status === "running" || item.status === "done") && (
                        <div className="mt-2 flex items-center gap-3">
                          <Progress value={item.pct} className="h-1.5 flex-1" />
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {item.stage}
                          </span>
                        </div>
                      )}
                      {item.error && (
                        <p className="mt-1 font-mono text-[11px] text-[var(--verdict-fake)]">
                          {item.error}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-6 flex items-start justify-between gap-4">
          <div className="max-w-xl">
            <Disclaimer />
          </div>
          {busy && (
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                cancelled.current = true;
                setProgress(null);
                setSavingNote(null);
                toast.info("Cancelled.");
              }}
            >
              <X className="size-4" /> Cancel
            </Button>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
