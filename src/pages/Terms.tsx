import { Scale } from "lucide-react";
import { Link } from "react-router";
import { Footer } from "@/components/site/Footer";
import { Navbar } from "@/components/site/Navbar";
import { Disclaimer } from "@/components/Disclaimer";

const CLAUSES = [
  {
    n: "1",
    title: "The service",
    body: "TruthLens is a forensic analysis tool for images and video. It inspects files for statistical and structural signs of AI generation or manipulation and reports a verdict with a confidence score. The service is provided as-is, for informational and educational use.",
  },
  {
    n: "2",
    title: "No warranty on results",
    body: "Detection results are probabilistic and may be wrong in either direction. A file judged Real may be synthetic; a file judged Likely fake may be authentic. No detector is 100% accurate — treat every verdict as one piece of evidence, never as proof, and never as the sole basis for an accusation, publication, or decision about a person.",
  },
  {
    n: "3",
    title: "Permitted use",
    body: "You may analyse files you own or have the right to process. You confirm you hold the necessary rights and permissions before uploading or linking any media. Do not use the service to harass people, produce non-consensual imagery, impersonate, or to attempt to deanonymise or investigate individuals without lawful basis.",
  },
  {
    n: "4",
    title: "Accounts",
    body: "You are responsible for activity under your account and for keeping any API key secret. We may suspend accounts that abuse the service, including automated scraping, rate-limit circumvention, or attempts to reverse-engineer and resell the detector as your own service.",
  },
  {
    n: "5",
    title: "Plans, quota & billing",
    body: "Each plan carries a daily scan quota (free 25, pro 500, team 2,000 per day). Plan switching in this release operates in test mode: limits apply immediately and no card is charged. Paid billing terms will be presented before any real charge is introduced.",
  },
  {
    n: "6",
    title: "API",
    body: "The API is rate-limited to 30 requests per minute per key. Automated access must respect robots-style fair use: do not hammer the service, resell raw access, or present API output without the accompanying disclaimer.",
  },
  {
    n: "7",
    title: "Your content",
    body: "You keep all rights to the files you analyse. Originals stay on your device; small derived artifacts are stored temporarily as described in the Privacy Policy. Feedback you submit (thumbs, comments) may be used to improve detection, non-commercially, without identifying you.",
  },
  {
    n: "8",
    title: "Liability",
    body: "To the maximum extent permitted by law, TruthLens and its operators are not liable for indirect, incidental or consequential damages arising from reliance on a verdict — including reputational harm, publication decisions, or lost opportunities. The service's total liability is limited to the amount you paid us in the twelve months before the claim, or USD 50, whichever is greater.",
  },
  {
    n: "9",
    title: "Changes & termination",
    body: "We may modify or discontinue features (including whole detector versions) and will note material changes here. You may delete your account at any time; on termination, stored data is removed as described in the Privacy Policy.",
  },
  {
    n: "10",
    title: "Governing law",
    body: "These terms are governed by the laws applicable at our principal place of business, without regard to conflict-of-law rules. If any clause is found unenforceable, the remainder stays in effect.",
  },
];

export default function Terms() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
        <header className="rule-double pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Last updated 4 October 2026
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Terms of service
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            Plain-language terms, because a contract nobody can read is not a
            contract. The single most important clause is{" "}
            <strong className="text-foreground">number 2</strong>.
          </p>
        </header>

        <div className="mt-10 space-y-4">
          {CLAUSES.map((c) => (
            <section
              key={c.n}
              className="paper-grain flex gap-5 rounded-xl border border-border bg-card p-5"
            >
              <span className="font-display text-2xl font-semibold text-primary/40 tabular-nums">
                {c.n}
              </span>
              <div>
                <h2 className="font-display text-lg font-semibold">{c.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {c.body}
                </p>
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-4 rounded-xl border-2 border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Scale className="size-4 text-primary" />
            <p className="font-display text-base font-semibold">
              Questions about these terms
            </p>
          </div>
          <Disclaimer />
          <p className="text-sm text-muted-foreground">
            Write to us via the{" "}
            <Link
              to="/contact"
              className="text-primary underline underline-offset-4"
            >
              contact page
            </Link>
            , or read how we handle data in the{" "}
            <Link
              to="/privacy"
              className="text-primary underline underline-offset-4"
            >
              privacy policy
            </Link>
            .
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}
