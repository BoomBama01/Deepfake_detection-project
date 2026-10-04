import { Database, HardDrive, Share2, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { Footer } from "@/components/site/Footer";
import { Navbar } from "@/components/site/Navbar";

const SECTIONS = [
  {
    id: "local",
    icon: HardDrive,
    title: "Analysis happens on your device",
    body: "Your original image or video is never uploaded. Frames are decoded and examined inside your browser — the file does not travel to our servers, and the detection models run on-device. Only if you choose to save a result do we store the artifacts described below.",
  },
  {
    id: "stored",
    icon: Database,
    title: "What a saved result contains",
    body: "When you save a scan we store: a downscaled preview (a copy, not your original), heatmap and error-level artifacts, the verdict and confidence, the check breakdown as JSON, the file name and size, a SHA-256 hash of the file (used to deduplicate your own repeat scans), the analysis settings, and a timestamp. Stored media and artifacts are purged automatically 24 hours after the scan; the textual summary remains until you delete it.",
  },
  {
    id: "sharing",
    icon: Share2,
    title: "Sharing is opt-in",
    body: "Results are private by default. Turning on public sharing makes the summary viewable by anyone with the link; you can turn it off again at any time. We never publish, feature or sell individual results.",
  },
  {
    id: "deletion",
    icon: Trash2,
    title: "Deletion is in your hands",
    body: "Every scan can be deleted individually or in bulk from the dashboard, immediately and permanently. Account deletion removes all scans, feedback, API keys and the account record itself. A JSON export of your data is available before you go.",
  },
];

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
        <header className="rule-double pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            Last updated 4 October 2026
          </p>
          <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
            Privacy policy
          </h1>
          <p className="mt-4 max-w-2xl leading-relaxed text-muted-foreground">
            The short version: the thing you are analysing stays on your
            machine. We store small artifacts so your results have a home, we
            keep them for 24 hours, and you can delete everything at any time.
          </p>
        </header>

        <section className="mt-10 grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <article
              key={s.id}
              className="paper-grain rounded-xl border border-border bg-card p-5"
            >
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.icon className="size-4" />
              </div>
              <h2 className="mt-3 font-display text-lg font-semibold">
                {s.title}
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                {s.body}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-10 space-y-5 text-sm leading-relaxed text-muted-foreground">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Accounts & identifiers
            </h2>
            <p className="mt-2">
              Signed-in users authenticate by email one-time code or as an
              anonymous user; we store your email, display name, plan and
              timestamps of activity. For signed-out visitors, a random device
              identifier is kept in your browser's local storage so quota and
              results can be tied to your own session — it is not linked to a
              person. Local storage is also used for your theme preference.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              API keys & rate limits
            </h2>
            <p className="mt-2">
              API secrets are stored only as SHA-256 hashes; we cannot read them
              back. Request counters (per key, per minute) are kept to enforce
              the 30 req/min limit, together with a prefix for recognition in
              your dashboard.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Who processes data
            </h2>
            <p className="mt-2">
              The application runs on Convex infrastructure (database,
              functions, file storage) and optional transactional email is sent
              through the platform's mail provider for contact messages and
              admin notices. We do not sell data, run advertising trackers, or
              share results with third parties for marketing.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Security & retention
            </h2>
            <p className="mt-2">
              Traffic is encrypted in transit. Stored artifacts expire after 24
              hours on a scheduled purge (unless you pin a scan, which keeps
              its media until you unpin it). No system is perfectly secure — if
              we ever learn of a breach affecting your data, we will say so
              plainly.
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Your rights
            </h2>
            <p className="mt-2">
              Depending on where you live, you may request a copy of your data,
              correction of your profile, or complete deletion. Export and
              deletion are self-service in{" "}
              <Link
                to="/dashboard?tab=account"
                className="text-primary underline underline-offset-4"
              >
                Dashboard → Account
              </Link>
              ; for anything else, use the{" "}
              <Link
                to="/contact"
                className="text-primary underline underline-offset-4"
              >
                contact form
              </Link>
              .
            </p>
          </div>

          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">
              Changes
            </h2>
            <p className="mt-2">
              If this policy changes materially, the revision date at the top
              changes with it and continued use of the service means you accept
              the updated policy.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
