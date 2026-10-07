import { motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Boxes,
  Clock3,
  Eye,
  FileJson2,
  Fingerprint,
  Gauge,
  Layers,
  Lock,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Upload,
  Video,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Disclaimer } from "@/components/Disclaimer";
import { useAnalysis, QuotaError } from "@/hooks/use-analysis";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_SETTINGS } from "@/lib/engine/types";
import { AnalysisError } from "@/lib/engine/runner";

const reveal = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-60px" },
  transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const },
};

function SectionHead({
  kicker,
  title,
  sub,
}: {
  kicker: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-primary">{kicker}</p>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
        {title}
      </h2>
      {sub && <p className="mt-4 font-body text-base leading-7 text-muted-foreground">{sub}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function TrustStrip() {
  const items: Array<{ icon: typeof Lock; label: string; note: string }> = [
    { icon: ShieldCheck, label: "Measured, not guessed", note: "every score shown is computed from your file" },
    { icon: Lock, label: "Private by design", note: "analysed in your browser; media purged after 24 h" },
    { icon: Fingerprint, label: "No face recognition", note: "we detect manipulation, never identity" },
    { icon: Boxes, label: "JPG · PNG · WEBP · MP4 · MOV · WEBM", note: "15 MB images · 200 MB / 3 min video" },
  ];
  return (
    <section aria-label="Trust commitments" className="border-y border-border/70 bg-card/50">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        {items.map((it) => (
          <div key={it.label} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-primary/40 bg-primary/10 text-primary">
              <it.icon className="size-4" />
            </span>
            <div>
              <p className="font-display text-sm font-semibold">{it.label}</p>
              <p className="font-body text-xs leading-5 text-muted-foreground">{it.note}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const STEPS = [
  {
    icon: Upload,
    title: "Submit the media",
    body: "Drop an image or video, paste a direct URL, or run up to ten files in batch. Files are validated by signature — the extension never gets a vote.",
  },
  {
    icon: Gauge,
    title: "Measure the signals",
    body: "Noise floor, frequency spectrum, JPEG block grid, histogram continuity, error-level analysis, EXIF/C2PA provenance, face regions via BlazeFace.",
  },
  {
    icon: Video,
    title: "Video: frames + time",
    body: "Frames are sampled, faces tracked, and temporal consistency measured — flicker, lighting jumps and face-geometry jitter build a per-second timeline.",
  },
  {
    icon: BadgeCheck,
    title: "Read the evidence",
    body: "A verdict with a capped confidence, plain-English reasoning, heatmaps of suspicious regions, and every raw measurement in the technical tab.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHead
        kicker="The procedure"
        title="How a TruthLens examination works"
        sub="Four passes over the evidence — the same order a forensic examiner would take."
      />
      <ol className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <motion.li
            key={s.title}
            {...reveal}
            transition={{ ...reveal.transition, delay: i * 0.08 }}
            className="paper-grain relative rounded-lg border border-border/80 bg-card p-5 shadow-sm"
          >
            <span className="absolute -top-3 left-4 rounded border border-border bg-background px-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              step {i + 1}
            </span>
            <span className="mt-2 flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
              <s.icon className="size-5" />
            </span>
            <h3 className="mt-4 font-display text-lg font-semibold">{s.title}</h3>
            <p className="mt-2 font-body text-sm leading-6 text-muted-foreground">{s.body}</p>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const FEATURES = [
  {
    icon: Eye,
    title: "Heatmap overlays",
    body: "Error-level analysis renders the regions that re-encode differently — the glowing seam where content was pasted or regenerated.",
  },
  {
    icon: Clock3,
    title: "Video timeline",
    body: "Per-second manipulation probability. Click any spike to jump to the exact moment that raised the alarm.",
  },
  {
    icon: Fingerprint,
    title: "Face-by-face breakdown",
    body: "Every detected face gets its own skin-noise, blending-boundary, compression-history and spectrum measurements.",
  },
  {
    icon: FileJson2,
    title: "Reports & JSON",
    body: "Print a laboratory-style PDF report, export the full machine-readable result, or share a public link you can revoke.",
  },
  {
    icon: Sparkles,
    title: "Provenance scanning",
    body: "EXIF camera data, C2PA Content Credentials and known generator signatures are read straight from the bytes.",
  },
  {
    icon: BookOpen,
    title: "Public REST API",
    body: "API keys with per-minute rate limits, documented endpoints and copy-paste cURL, Python and JavaScript examples.",
  },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-y border-border/70 bg-card/40 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          kicker="The toolkit"
          title="Every instrument on the bench"
          sub="Each tool reports what it actually measured — nothing is decorative."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.article
              key={f.title}
              {...reveal}
              transition={{ ...reveal.transition, delay: (i % 3) * 0.07 }}
              className="group rounded-lg border border-border/80 bg-background/70 p-6 transition-colors hover:border-primary/50"
            >
              <span className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <f.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-display text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 font-body text-sm leading-6 text-muted-foreground">{f.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

interface SampleDef {
  src: string;
  fileName: string;
  kind: "image";
  title: string;
  blurb: string;
  credit: string;
}

const SAMPLES: SampleDef[] = [
  {
    src: "/samples/photo-camera.jpg",
    fileName: "photo-camera.jpg",
    kind: "image",
    title: "Camera photograph",
    blurb: "An ordinary scene from a real camera pipeline — the baseline the examiner compares against.",
    credit: "Sample photo via Lorem Picsum (Unsplash)",
  },
  {
    src: "/samples/ai-generated.png",
    fileName: "ai-generated.png",
    kind: "image",
    title: "AI-generated image",
    blurb: "Published with signed C2PA Content Credentials declaring ChatGPT generation — direct evidence.",
    credit: "Sample via Wikimedia Commons (CC license)",
  },
  {
    src: "/samples/photo-spliced.jpg",
    fileName: "photo-spliced.jpg",
    kind: "image",
    title: "Spliced composite",
    blurb: "Two photographs cut and re-encoded into one frame. The seam detector finds the join.",
    credit: "Constructed for this demo from the photos above",
  },
];

export function LiveSamples() {
  const { runFile, quota } = useAnalysis();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const runSample = async (s: SampleDef) => {
    if (quota && quota.used >= quota.limit) {
      toast.error(`Guest limit reached (${quota.used}/${quota.limit} today). Sign in for more scans.`);
      navigate(`/auth?returnTo=${encodeURIComponent("/#samples")}`);
      return;
    }
    setBusy(s.fileName);
    try {
      const res = await fetch(s.src);
      if (!res.ok) throw new Error("Sample could not be fetched.");
      const blob = await res.blob();
      const file = new File([blob], s.fileName, { type: blob.type });
      const out = await runFile(file, DEFAULT_SETTINGS, "sample", {
        onProgress: () => undefined,
      });
      toast.success(out.reused ? "Reused earlier analysis of this sample" : "Sample analysed");
      navigate(`/results/${out.id}`);
    } catch (err) {
      if (err instanceof QuotaError) toast.error(err.message);
      else if (err instanceof AnalysisError) toast.error(err.details ? `${err.message}: ${String(err.details)}` : err.message);
      else toast.error(err instanceof Error ? err.message : "Sample analysis failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="samples" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHead
        kicker="Exhibit A–C"
        title="Live sample examinations"
        sub="Nothing here is pre-baked: pressing “examine” runs the real pipeline on the file, in your browser, right now — the verdict you see is the verdict the engine measured."
      />
      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {SAMPLES.map((s, i) => (
          <motion.article
            key={s.src}
            {...reveal}
            transition={{ ...reveal.transition, delay: i * 0.08 }}
            className="paper-grain overflow-hidden rounded-lg border border-border/80 bg-card"
          >
            <div className="relative aspect-[3/2] overflow-hidden border-b border-border/70 bg-muted">
              <img
                src={s.src}
                alt={s.title}
                loading="lazy"
                className="h-full w-full object-cover"
              />
              <Badge className="absolute left-3 top-3 border border-border bg-background/90 font-mono text-[10px] uppercase tracking-widest">
                sample
              </Badge>
            </div>
            <div className="p-5">
              <h3 className="font-display text-lg font-semibold">{s.title}</h3>
              <p className="mt-1.5 font-body text-sm leading-6 text-muted-foreground">{s.blurb}</p>
              <p className="mt-3 font-mono text-[10px] leading-4 text-muted-foreground/80">
                {s.credit}
              </p>
              <Button
                className="mt-4 w-full gap-2"
                onClick={() => void runSample(s)}
                disabled={busy !== null}
              >
                {busy === s.fileName ? "Examining…" : "Examine this sample"}
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </motion.article>
        ))}
      </div>
      <div className="mt-8">
        <Disclaimer />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const PLANS = [
  {
    id: "free" as const,
    name: "Free",
    price: "$0",
    cadence: "forever",
    scans: "25 scans / day",
    perks: [
      "Image & video analysis",
      "Heatmaps, ELA & timeline",
      "3 scans/day signed out",
      "Community support",
    ],
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: "$12",
    cadence: "per month",
    scans: "500 scans / day",
    perks: [
      "Everything in Free",
      "Batch of 10 files",
      "Public share links & PDF reports",
      "API access (30 req/min)",
      "Priority processing",
    ],
    featured: true,
  },
  {
    id: "team" as const,
    name: "Team",
    price: "$39",
    cadence: "per month",
    scans: "2 000 scans / day",
    perks: [
      "Everything in Pro",
      "5 seats included",
      "Shared result library",
      "Audit log export",
      "Email support",
    ],
  },
];

export function Pricing() {
  const { isAuthenticated, user } = useAuth();
  const setPlan = useMutation(api.account.setPlan);
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const currentPlan = user?.plan ?? "free";

  const choose = async (id: "free" | "pro" | "team") => {
    if (!isAuthenticated) {
      navigate(`/auth?returnTo=${encodeURIComponent("/dashboard?tab=account")}`);
      return;
    }
    if (currentPlan === id) return;
    setBusy(id);
    try {
      await setPlan({ plan: id });
      toast.success(
        `Plan switched to ${id === "free" ? "Free" : id === "pro" ? "Pro" : "Team"} (test mode — no card charged).`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change plan.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="pricing" className="scroll-mt-20 border-y border-border/70 bg-card/40 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          kicker="Terms of examination"
          title="Simple plans, honest limits"
          sub="Checkout runs in test mode for this deployment — no card is charged, and plan limits take effect immediately."
        />
        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {PLANS.map((p, i) => (
            <motion.div
              key={p.id}
              {...reveal}
              transition={{ ...reveal.transition, delay: i * 0.08 }}
              className={`relative flex flex-col rounded-lg border p-7 ${
                p.featured
                  ? "border-primary/60 bg-background shadow-[0_0_30px_-12px] shadow-primary/40"
                  : "border-border/80 bg-background/70"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-3 right-5 rounded border border-primary/60 bg-background px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
                  most chosen
                </span>
              )}
              <h3 className="font-display text-xl font-semibold">{p.name}</h3>
              <p className="mt-3 flex items-baseline gap-1.5">
                <span className="font-display text-4xl font-semibold">{p.price}</span>
                <span className="font-mono text-xs text-muted-foreground">{p.cadence}</span>
              </p>
              <p className="mt-1 font-mono text-xs text-primary">{p.scans}</p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 font-body text-sm">
                    <BadgeCheck className="mt-0.5 size-4 shrink-0 text-[var(--verdict-real)]" />
                    <span className="text-foreground/90">{perk}</span>
                  </li>
                ))}
              </ul>
              <Button
                className="mt-6"
                variant={p.featured ? "default" : "outline"}
                disabled={busy !== null}
                onClick={() => void choose(p.id)}
              >
                {busy === p.id
                  ? "Updating…"
                  : currentPlan === p.id
                    ? "Current plan"
                    : `Choose ${p.name}`}
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const FAQS = [
  {
    q: "How accurate is TruthLens?",
    a: "No detector is 100% accurate. TruthLens shows every measurement it made and caps confidence below 100%. Published academic benchmarks for deepfake detection report high accuracy on known manipulations but degrade on unseen generators — treat any single verdict, including ours, as one piece of evidence.",
  },
  {
    q: "Is this a neural “fake detector”?",
    a: "Face localisation runs a real neural model (MediaPipe BlazeFace) locally in your browser. The authenticity verdict itself comes from transparent signal-forensic checks — noise, spectrum, block grids, ELA, provenance and temporal consistency — whose raw values you can inspect. No black-box probability is invented when a model isn’t available.",
  },
  {
    q: "Do you keep my files?",
    a: "The original file never leaves your device: analysis runs client-side. Only a downscaled preview and derived artifacts (heatmap, ELA) are stored to render your results page, and those are deleted automatically after 24 hours. The numeric result summary stays until you delete it.",
  },
  {
    q: "Can I analyse YouTube or Instagram links?",
    a: "Direct image URLs (JPEG/PNG/WebP, up to 9 MB) are supported with server-side fetching and SSRF protection. Social-platform links are not supported in v1 — download the media and upload it for full analysis.",
  },
  {
    q: "Does TruthLens identify people?",
    a: "No. The system detects manipulation only — it performs no face recognition, identity matching or biometric enrolment, and never will without explicit, separate consent.",
  },
  {
    q: "What about videos longer than 3 minutes?",
    a: "The default limit is 180 seconds and 200 MB so analyses stay responsive in the browser. Trim the clip — or raise the limits in a self-hosted deployment.",
  },
];

export function FAQ() {
  return (
    <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
      <SectionHead kicker="Correspondence" title="Frequently asked questions" />
      <Accordion type="single" collapsible className="mt-10">
        {FAQS.map((f, i) => (
          <AccordionItem key={f.q} value={`faq-${i}`} className="border-border/80">
            <AccordionTrigger className="text-left font-display text-base hover:no-underline">
              {f.q}
            </AccordionTrigger>
            <AccordionContent className="font-body text-sm leading-7 text-muted-foreground">
              {f.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}

/* ------------------------------------------------------------------ */

const USE_CASES = [
  {
    icon: BookOpen,
    role: "Journalists",
    body: "Verify user-submitted footage before publication and document exactly which checks supported the verdict.",
  },
  {
    icon: Layers,
    role: "Students & educators",
    body: "Learn how modern image forensics works by watching each measurement run on your own assignments.",
  },
  {
    icon: ShieldCheck,
    role: "HR & trust teams",
    body: "Screen submitted photos and short videos for obvious manipulation before they enter a hiring workflow.",
  },
  {
    icon: Eye,
    role: "Everyday scrollers",
    body: "Check that suspicious image landing in your group chat before you forward it to everyone you know.",
  },
];

export function UseCases() {
  return (
    <section className="border-y border-border/70 bg-card/40 py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          kicker="Who examines with TruthLens"
          title="Built for careful people"
          sub="Whoever you are, the bench is the same: measure, show the evidence, state the doubt."
        />
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map((u) => (
            <div
              key={u.role}
              className="rounded-lg border border-border/80 bg-background/70 p-6"
            >
              <span className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                <u.icon className="size-4" />
              </span>
              <h3 className="mt-3 font-display text-base font-semibold">{u.role}</h3>
              <p className="mt-2 font-body text-sm leading-6 text-muted-foreground">{u.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCTA() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
      <motion.div {...reveal} className="paper-grain rounded-xl border-2 border-primary/40 bg-card p-10">
        <ScanSearch className="mx-auto size-10 text-primary" />
        <h2 className="mt-4 font-display text-3xl font-semibold sm:text-4xl">
          Put a file on the bench.
        </h2>
        <p className="mx-auto mt-4 max-w-xl font-body text-base leading-7 text-muted-foreground">
          Three examinations a day, no sign-up required. Every measurement in the open.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="gap-2">
            <Link to="/analyze">
              Examine media now <ArrowRight className="size-4" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/learn">Learn the method</Link>
          </Button>
        </div>
        <div className="mt-6 flex justify-center">
          <Disclaimer compact />
        </div>
      </motion.div>
    </section>
  );
}

export function AccessNote({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[11px] tracking-wide text-muted-foreground">{children}</p>
  );
}
