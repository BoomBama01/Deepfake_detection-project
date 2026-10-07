import { motion } from "framer-motion";
import {
  ArrowRight,
  Fingerprint,
  Loader2,
  ScanSearch,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Footer } from "@/components/site/Footer";
import { Navbar } from "@/components/site/Navbar";
import { Disclaimer } from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useAnalysis, QuotaError } from "@/hooks/use-analysis";
import { AnalysisError } from "@/lib/engine/runner";
import { DEFAULT_SETTINGS, type StageProgress } from "@/lib/engine/types";
import {
  FAQ,
  Features,
  FinalCTA,
  HowItWorks,
  LiveSamples,
  Pricing,
  TrustStrip,
  UseCases,
} from "@/components/landing/sections";

const INSTRUMENTS = [
  { name: "Noise residual", measures: "sensor grain floor & field continuity" },
  { name: "Frequency spectrum", measures: "radial power slope & upsampling peaks" },
  { name: "Block-grid alignment", measures: "8-px JPEG quantisation phase" },
  { name: "Error Level Analysis", measures: "localized re-compression anomalies" },
  { name: "Provenance", measures: "EXIF · C2PA · generator signatures" },
  { name: "Temporal consistency", measures: "flicker, lighting & face jitter (video)" },
];

function HeroDrop() {
  const { runFile, quota } = useAnalysis();
  const navigate = useNavigate();
  const [consent, setConsent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<StageProgress | null>(null);
  const [savingNote, setSavingNote] = useState<string | null>(null);
  const cancelled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = progress !== null || savingNote !== null;

  const handleFile = useCallback(
    async (file: File) => {
      if (!consent) {
        toast.error("Confirm you have the right to analyse this media first.");
        return;
      }
      if (quota && quota.used >= quota.limit) {
        toast.error(
          `Guest limit reached (${quota.used}/${quota.limit} today). Sign in for more scans.`,
        );
        navigate(`/auth?returnTo=${encodeURIComponent("/")}`);
        return;
      }
      cancelled.current = false;
      setProgress({ stage: "validating", pct: 2, note: "Starting" });
      try {
        const out = await runFile(file, DEFAULT_SETTINGS, "upload", {
          onProgress: (pct) => setProgress({ stage: "forensics", pct, note: "Analyzing" }),
          onSaving: () => {
            setProgress(null);
          },
          isCancelled: () => cancelled.current,
        });
        if (out.reused) {
          toast.info("Identical file analysed earlier — showing the existing result.");
        }
        navigate(`/results/${out.id}`);
      } catch (err) {
        setProgress(null);
        setSavingNote(null);
        if (err instanceof QuotaError) toast.error(err.message);
        else if (err instanceof AnalysisError)
          toast.error(err.details ? `${err.message} (${err.details})` : err.message);
        else if (err && (err as Error).name === "AnalysisCancelled") toast.info("Scan cancelled.");
        else toast.error(err instanceof Error ? err.message : "Analysis failed.");
      }
    },
    [consent, navigate, quota, runFile],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  return (
    <div className="paper-grain rounded-xl border-2 border-border bg-card p-6 shadow-[0_18px_50px_-30px] shadow-foreground/40">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
          intake desk
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {quota ? `${quota.used}/${quota.limit} today` : "3 free / day"}
        </p>
      </div>

      {!busy ? (
        <div
          role="button"
          tabIndex={0}
          aria-label="Drop a file to analyse, or click to choose one"
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
          className={`mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/60 hover:bg-primary/5"
          }`}
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Upload className="size-5" />
          </span>
          <p className="mt-3 font-display text-lg font-semibold">
            Drop an image or video to examine
          </p>
          <p className="mt-1 font-body text-sm text-muted-foreground">
            or click to choose a file · JPG PNG WEBP GIF · MP4 MOV WEBM AVI
          </p>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-msvideo"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleFile(f);
            }}
          />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-background/60 px-5 py-6">
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-primary" />
            <p className="font-display text-base font-semibold">
              {savingNote ?? progress?.note ?? "Working…"}
            </p>
            <span className="ml-auto font-mono text-sm tabular-nums text-muted-foreground">
              {savingNote ? 100 : Math.round(progress?.pct ?? 0)}%
            </span>
          </div>
          <Progress
            value={savingNote ? 100 : progress?.pct ?? 0}
            className="mt-4 h-2"
            aria-label="Analysis progress"
          />
          <div className="mt-4 flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {progress?.stage ?? "saving"}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={() => {
                cancelled.current = true;
                setProgress(null);
                setSavingNote(null);
                toast.info("Scan cancelled.");
              }}
            >
              <X className="size-3.5" /> Cancel
            </Button>
          </div>
        </div>
      )}

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 font-body text-sm text-foreground/90">
        <Checkbox
          checked={consent}
          onCheckedChange={(v) => setConsent(v === true)}
          className="mt-0.5"
          aria-label="I have the right to analyze this media"
        />
        <span>I have the right to analyse this media, and I accept the privacy notice.</span>
      </label>

      <div className="mt-4">
        <Disclaimer />
      </div>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border/70">
      {/* archival ruling */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 34px, color-mix(in oklch, var(--border) 45%, transparent) 35px)",
        }}
      />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-20">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.34em] text-primary">
            Est. 2026 · media forensic bench
          </p>
          <h1 className="mt-4 font-display text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl">
            Know what&apos;s{" "}
            <span className="italic text-primary underline decoration-primary/40 decoration-2 underline-offset-8">
              real
            </span>
            .
          </h1>
          <p className="mt-6 max-w-xl font-body text-lg leading-8 text-muted-foreground">
            TruthLens examines images and videos for AI generation and face manipulation —
            then shows you every measurement behind the verdict, including the ones that say
            “not sure.”
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="gap-2">
              <a href="#intake">
                Examine a file <ArrowRight className="size-4" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline" className="gap-2">
              <a href="#how">See the method</a>
            </Button>
          </div>
          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ScanSearch className="size-3.5 text-primary" /> analysis runs in your browser
            </span>
            <span className="flex items-center gap-1.5">
              <Fingerprint className="size-3.5 text-primary" /> no face recognition, ever
            </span>
          </div>
        </motion.div>

        <motion.div
          id="intake"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          className="scroll-mt-24"
        >
          <HeroDrop />
        </motion.div>

        <div className="lg:col-span-2">
          <div className="rule-double mt-2 grid gap-x-8 gap-y-3 pt-6 sm:grid-cols-2 lg:grid-cols-3">
            {INSTRUMENTS.map((ins) => (
              <div key={ins.name} className="flex items-baseline gap-3">
                <span className="font-display text-sm font-semibold text-foreground">
                  {ins.name}
                </span>
                <span className="flex-1 border-b border-dotted border-border" />
                <span className="font-mono text-[10.5px] text-muted-foreground">
                  {ins.measures}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1">
        <Hero />
        <TrustStrip />
        <HowItWorks />
        <Features />
        <LiveSamples />
        <Pricing />
        <UseCases />
        <FAQ />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
