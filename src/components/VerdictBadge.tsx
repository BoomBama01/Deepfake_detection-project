import { BadgeCheck, CircleHelp, Frown, Loader, TriangleAlert } from "lucide-react";
import type { Verdict } from "@/lib/engine/types";

const SHORT: Record<Verdict, string> = {
  real: "Real",
  inconclusive: "Inconclusive",
  likely_ai: "Likely AI-generated",
  likely_deepfake: "Likely deepfake",
  error: "Analysis failed",
};

const TONE: Record<Verdict, { fg: string; border: string; bg: string }> = {
  real: {
    fg: "text-[var(--verdict-real)]",
    border: "border-[var(--verdict-real)]/50",
    bg: "bg-[var(--verdict-real)]/10",
  },
  inconclusive: {
    fg: "text-[var(--verdict-uncertain)]",
    border: "border-[var(--verdict-uncertain)]/60",
    bg: "bg-[var(--verdict-uncertain)]/10",
  },
  likely_ai: {
    fg: "text-[var(--verdict-fake)]",
    border: "border-[var(--verdict-fake)]/50",
    bg: "bg-[var(--verdict-fake)]/10",
  },
  likely_deepfake: {
    fg: "text-[var(--verdict-fake)]",
    border: "border-[var(--verdict-fake)]/50",
    bg: "bg-[var(--verdict-fake)]/10",
  },
  error: {
    fg: "text-muted-foreground",
    border: "border-border",
    bg: "bg-muted",
  },
};

const ICON: Record<Verdict, typeof BadgeCheck> = {
  real: BadgeCheck,
  inconclusive: CircleHelp,
  likely_ai: Frown,
  likely_deepfake: Frown,
  error: TriangleAlert,
};

export function VerdictBadge({
  verdict,
  large = false,
}: {
  verdict: Verdict;
  large?: boolean;
}) {
  const Icon = ICON[verdict] ?? Loader;
  const tone = TONE[verdict] ?? TONE.error;
  return (
    <span
      role="status"
      aria-label={`Verdict: ${SHORT[verdict] ?? verdict}`}
      className={`inline-flex items-center gap-2 rounded-md border-2 ${tone.border} ${tone.bg} ${tone.fg} font-display font-semibold uppercase tracking-[0.14em] ${
        large ? "px-4 py-2 text-base" : "px-2.5 py-1 text-xs"
      }`}
    >
      <Icon className={large ? "size-5" : "size-3.5"} />
      {SHORT[verdict] ?? verdict}
    </span>
  );
}
