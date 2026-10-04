import { ArrowRight, Scale, ShieldCheck, ScanSearch } from "lucide-react";
import { Link } from "react-router";
import { Footer } from "@/components/site/Footer";
import { Navbar } from "@/components/site/Navbar";
import { Disclaimer } from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";

const PIPELINE = [
  {
    step: "01",
    title: "Validate & fingerprint",
    body: "The file is sniffed byte-by-byte (JPEG/PNG/WebP/GIF/MP4/WebM/AVI) and hashed with SHA-256. Unsupported or oversized files fail fast with a clear error instead of a fake score.",
  },
  {
    step: "02",
    title: "Decode locally",
    body: "Frames are decoded in your browser. For images the canvas is read pixel-by-pixel; for video, frames are sampled at your chosen rate (default 2 fps, up to 90 frames).",
  },
  {
    step: "03",
    title: "Locate faces",
    body: "An on-device face detector (MediaPipe BlazeFace) finds every face and its box. Face regions get their own suite of checks, because a swapped face behaves differently from the wall behind it.",
  },
  {
    step: "04",
    title: "Run the instruments",
    body: "Noise residual, radial frequency spectrum, 8-px block-grid phase, seam detection, histogram statistics, error-level analysis, metadata/C2PA provenance, per-face checks — plus temporal flicker, lighting and jitter analysis for video.",
  },
  {
    step: "05",
    title: "Weigh the evidence",
    body: "Each check returns a score and a confidence band. Checks vote with weights — face checks dominate on face images, structural checks on everything else — so one weak signal cannot outvote the rest.",
  },
  {
    step: "06",
    title: "Decide, honestly",
    body: "Thresholds separate real from fake — but a check that actively fired can never be averaged away into ‘Real’: any flagged measurement floors the result into Inconclusive, and decisive face evidence floors it at Likely deepfake. When the file itself is washed out (heavy recompression, blur, resampling) ‘no signals found’ proves nothing, so Real is withheld. Confidence is capped below certainty so the number never reads as proof.",
  },
];

const PRINCIPLES = [
  {
    icon: ScanSearch,
    title: "Real analysis, never theatre",
    body: "There are no hardcoded verdicts, demo randomisers or canned scores anywhere in the pipeline. Every number shown is computed from your file, and if a capability is missing the result is an explicit error or skip — never a silent guess.",
  },
  {
    icon: Scale,
    title: "Inconclusive is a first-class answer",
    body: "Most tools are embarrassed by uncertainty. We are not: when the evidence conflicts or is weak, the verdict is Inconclusive with a confidence band around the midpoint. A confident answer to an unanswerable question is misinformation.",
  },
  {
    icon: ShieldCheck,
    title: "Your original never leaves the device",
    body: "Detection runs entirely in your browser. Only a small downscaled preview and the analysis artifacts are stored — for 24 hours, deletable at any time, and never shared unless you make the result public.",
  },
];

export default function About() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
        <header className="rule-double pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            The method
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            How detection works
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            TruthLens is a forensic instrument, not an oracle. It measures a
            file for the physical traces that generation and editing leave
            behind, shows you the evidence, and states plainly when the
            evidence runs out. Here is the whole pipeline, in order.
          </p>
        </header>

        <section className="mt-10 space-y-4">
          {PIPELINE.map((p) => (
            <article
              key={p.step}
              className="paper-grain flex gap-5 rounded-xl border border-border bg-card p-5"
            >
              <span className="font-display text-3xl font-semibold text-primary/40 tabular-nums">
                {p.step}
              </span>
              <div>
                <h2 className="font-display text-lg font-semibold">{p.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {p.body}
                </p>
              </div>
            </article>
          ))}
        </section>

        <section className="mt-12 space-y-4">
          <h2 className="font-display text-2xl font-semibold">
            The instruments, in plain terms
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Noise residual", "Real sensors leave a grain floor. Generators often don't — or leave a suspiciously uniform one."],
              ["Frequency spectrum", "Upsampling and synthesis bend the radial power curve; the shape is measurable."],
              ["Block-grid alignment", "JPEG's 8-pixel blocks should agree across one authentic image. Splices break the phase."],
              ["Seam detection", "Column and row discontinuities expose where two images were stitched together."],
              ["Error-level analysis", "Re-compressed regions glow differently — a halo around what changed."],
              ["Provenance", "EXIF, C2PA manifests and generator signatures are read literally: if a file says it came from ChatGPT, we believe the file."],
              ["Per-face checks", "Edge density, colour statistics and noise inside every detected face box."],
              ["Temporal analysis (video)", "Frame-to-frame flicker, lighting drift and landmark jitter — fakes struggle to stay stable."],
              ["Audio profile (video)", "Clipping, DC offset, silence runs and spectral shape. Honest limits: voice-clone classification is not in v1."],
              ["Evidence quality gate", "Sharpness and compression level are measured first: a washed-out file can only be Inconclusive, never cleared as Real."],
            ].map(([name, body]) => (
              <div
                key={name}
                className="rounded-lg border border-border bg-card p-4"
              >
                <p className="font-display text-sm font-semibold">{name}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 space-y-4">
          <h2 className="font-display text-2xl font-semibold">
            Our honesty rules
          </h2>
          <div className="space-y-3">
            {PRINCIPLES.map((p) => (
              <div
                key={p.title}
                className="rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-center gap-2">
                  <p.icon className="size-4 text-primary" />
                  <h3 className="font-display text-base font-semibold">
                    {p.title}
                  </h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
          <Disclaimer />
        </section>

        <section className="mt-12 space-y-4">
          <h2 className="font-display text-2xl font-semibold">Scope of v1</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Version 1 covers two jobs, for the general public:{" "}
            <strong className="text-foreground">deepfake video</strong> and{" "}
            <strong className="text-foreground">AI-generated fake faces</strong>{" "}
            — plus the everyday edits (splices, retouches, provenance lies) that
            come along for the ride. Document forensics, voice-clone
            classification, live-camera capture and enterprise integrations are
            planned for later versions, and today they are simply absent rather
            than stubbed out with placeholders.
          </p>
        </section>

        <section className="mt-12 flex flex-wrap items-center gap-3 rounded-xl border-2 border-border bg-card p-6">
          <div className="mr-auto">
            <h2 className="font-display text-xl font-semibold">
              See it on a real file
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Six demo samples with known provenance are included.
            </p>
          </div>
          <Button asChild className="cursor-pointer gap-2">
            <Link to="/analyze">
              Open the analyzer <ArrowRight className="size-4" />
            </Link>
          </Button>
        </section>
      </main>

      <Footer />
    </div>
  );
}
