import {
  ArrowRight,
  BrainCircuit,
  Eye,
  Fingerprint,
  ScanFace,
  Video,
} from "lucide-react";
import { Link } from "react-router";
import { Footer } from "@/components/site/Footer";
import { Navbar } from "@/components/site/Navbar";
import { Disclaimer } from "@/components/Disclaimer";
import { Button } from "@/components/ui/button";

const FAMILIES = [
  {
    icon: ScanFace,
    title: "GAN & diffusion faces",
    body: "Models like StyleGAN and Stable Diffusion synthesise a face that never existed. They leave statistical traces: an unnaturally smooth noise floor, a characteristic frequency spectrum, and generator fingerprints — sometimes literally, in C2PA metadata that names the tool.",
  },
  {
    icon: Video,
    title: "Face swaps & reenactment",
    body: "Deepfake video replaces one person's face with another's, or drives it from another's expressions. Beyond the face itself, the rest of the frame stays authentic — so the strongest signals are local: edge seams around the face, inconsistent lighting, and temporal jitter frame to frame.",
  },
  {
    icon: Fingerprint,
    title: "Splices & edits",
    body: "Even a hand-cut collage betrays itself: mismatched grain between regions, a seam where two photos meet, JPEG blocks that don't line up on the 8-pixel grid, and error-level halos around the pasted area.",
  },
];

const SELF_CHECK = [
  "Does the skin texture repeat or look airbrushed at 100% zoom?",
  "Do the ears, glasses, teeth or hair edges look melted or asymmetric?",
  "Is the background geometry straight — walls, tiles, text, jewellery?",
  "Does the lighting in the eyes match the lighting on the face?",
  "In video: do blinking, mouth shapes and background motion stay in sync?",
  "Where did the file come from, and who posted it first?",
];

export default function Learn() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
        <header className="rule-double pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Field guide
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Living with synthetic media
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            Anyone with a laptop can now fabricate a face, a voice or an event.
            This guide covers what fakes look like today, how to interrogate a
            suspicious file yourself — and where tools like TruthLens help and
            where they cannot.
          </p>
        </header>

        {/* The three families */}
        <section className="mt-10 space-y-5">
          <h2 className="font-display text-2xl font-semibold">
            Three families of fakes
          </h2>
          {FAMILIES.map((f) => (
            <article
              key={f.title}
              className="paper-grain flex gap-4 rounded-xl border border-border bg-card p-5"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="size-5" />
              </div>
              <div>
                <h3 className="font-display text-lg font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </div>
            </article>
          ))}
        </section>

        {/* Human checks */}
        <section className="mt-12 space-y-4">
          <h2 className="font-display text-2xl font-semibold">
            Before you trust any tool: six human checks
          </h2>
          <div className="rounded-xl border border-border bg-card p-5">
            <ul className="space-y-3">
              {SELF_CHECK.map((item, i) => (
                <li key={item} className="flex gap-3 text-sm leading-relaxed">
                  <span className="font-mono text-xs text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-muted-foreground">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Provenance often matters more than pixels: check the source, reverse
            search the image, and look for corroborating coverage. A perfect
            fake from an untrustworthy account is still untrustworthy.
          </p>
        </section>

        {/* What the tool does */}
        <section className="mt-12 space-y-4">
          <h2 className="font-display text-2xl font-semibold">
            What a detector can and cannot tell you
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--verdict-real)]/40 bg-[var(--verdict-real)]/5 p-5">
              <div className="mb-2 flex items-center gap-2 text-[var(--verdict-real)]">
                <Eye className="size-4" />
                <p className="font-mono text-[11px] uppercase tracking-widest">
                  Can help
                </p>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>· Flag statistical traces of generators and edits</li>
                <li>· Compare face regions against the rest of the frame</li>
                <li>· Measure frame-to-frame instability in video</li>
                <li>· Read embedded provenance (EXIF, C2PA) honestly</li>
                <li>· Give you evidence to look at, not just a verdict</li>
              </ul>
            </div>
            <div className="rounded-xl border border-[var(--verdict-fake)]/40 bg-[var(--verdict-fake)]/5 p-5">
              <div className="mb-2 flex items-center gap-2 text-[var(--verdict-fake)]">
                <BrainCircuit className="size-4" />
                <p className="font-mono text-[11px] uppercase tracking-widest">
                  Cannot
                </p>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>· Prove an image is real — absence of traces ≠ authenticity</li>
                <li>· Defeat a determined adversary who knows the checks</li>
                <li>· Replace human judgement or source verification</li>
                <li>· Guarantee anything: no detector is 100% accurate</li>
                <li>· Be equally sure about every file — borderline results come back low-confidence</li>
              </ul>
            </div>
          </div>
          <Disclaimer />
        </section>

        {/* FAQ */}
        <section className="mt-12 space-y-4">
          <h2 className="font-display text-2xl font-semibold">Common questions</h2>
          <div className="space-y-3">
            {[
              {
                q: "Why is my selfie only around 50% confident?",
                a: "Heavy phone processing (beauty modes, HDR stacking, recompression) blurs the line between captured and generated. TruthLens does not resolve that blur by guessing: where the evidence is genuinely borderline it returns INCONCLUSIVE and tells you which measurements fell apart.",
              },
              {
                q: "A screenshot lost all its metadata — is it fake?",
                a: "No. Screenshots legitimately strip EXIF. Missing provenance leaves the metadata check unresolved, not the image suspicious; the pixel-level checks still run.",
              },
              {
                q: "Can deepfake detectors keep up?",
                a: "It is an arms race. Generators improve, forensic checks adapt. Treat every verdict as one input among several, and re-check important files with fresh tools.",
              },
              {
                q: "Why does a heavily re-compressed or blurry image come back with low confidence?",
                a: "Recompression and resampling destroy the very traces detection relies on. In that situation ‘nothing found’ would be a false all-clear, so the verdict becomes INCONCLUSIVE, with the explanation naming exactly which evidence was washed out rather than reporting a pass it cannot support.",
              },
              {
                q: "Do you store my video?",
                a: "Your original file never leaves your device. Only a small downscaled preview and analysis artifacts are stored, and they are purged after 24 hours.",
              },
            ].map((item) => (
              <div key={item.q} className="rounded-lg border border-border bg-card p-4">
                <p className="font-display text-base font-semibold">{item.q}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 flex flex-col items-start gap-4 rounded-xl border-2 border-border bg-card p-6">
          <h2 className="font-display text-2xl font-semibold">
            Put it into practice
          </h2>
          <p className="text-sm text-muted-foreground">
            Run one of the demo samples or drop in a file you are unsure about.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="cursor-pointer gap-2">
              <Link to="/analyze">
                Analyze a file <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="cursor-pointer">
              <Link to="/about">How detection works</Link>
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
