import { ScanSearch } from "lucide-react";
import { Link } from "react-router";
import { Disclaimer } from "@/components/Disclaimer";

const COLUMNS: Array<{ title: string; links: Array<{ to: string; label: string }> }> = [
  {
    title: "Product",
    links: [
      { to: "/analyze", label: "Analyze media" },
      { to: "/dashboard", label: "Dashboard" },
      { to: "/#samples", label: "Live samples" },
      { to: "/#pricing", label: "Pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { to: "/docs", label: "API docs" },
      { to: "/learn", label: "Education hub" },
      { to: "/about", label: "How detection works" },
      { to: "/about#limits", label: "Limitations" },
    ],
  },
  {
    title: "Company",
    links: [
      { to: "/about", label: "About" },
      { to: "/contact", label: "Contact" },
      { to: "https://github.com", label: "GitHub" },
      { to: "/docs#status", label: "Status" },
    ],
  },
  {
    title: "Legal",
    links: [
      { to: "/privacy", label: "Privacy" },
      { to: "/terms", label: "Terms" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/80 bg-card/60">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-md border-2 border-primary/70 bg-primary/10 text-primary">
                <ScanSearch className="size-4" />
              </span>
              <span className="font-display text-lg font-semibold">TruthLens</span>
            </div>
            <p className="mt-3 max-w-xs font-body text-sm leading-6 text-muted-foreground">
              A vintage-stamped forensic bench for modern media: measure the pixels, show the
              evidence, admit the uncertainty.
            </p>
            <div className="mt-4">
              <Disclaimer compact />
            </div>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                {col.title}
              </h3>
              <ul className="mt-3 space-y-2">
                {col.links.map((l) => (
                  <li key={l.to + l.label}>
                    <Link
                      to={l.to}
                      className="font-body text-sm text-foreground/80 underline-offset-4 transition-colors hover:text-foreground hover:underline"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="rule-double mt-10 flex flex-col gap-2 pt-6 font-mono text-[11px] tracking-wide text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} TruthLens · Media Forensics Laboratory</span>
          <span>Analysed locally in your browser · media purged after 24 h</span>
        </div>
      </div>
    </footer>
  );
}
