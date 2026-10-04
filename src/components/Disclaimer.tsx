import { TriangleAlert } from "lucide-react";

/**
 * The standing honesty disclaimer — shown on every result surface and key
 * landing sections. Never hide it behind a tooltip.
 */
export function Disclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <p
      role="note"
      className={`flex items-start gap-2 font-mono text-[11px] leading-relaxed tracking-wide text-muted-foreground ${
        compact ? "" : "rounded-md border border-dashed border-border/80 bg-muted/40 px-3 py-2"
      }`}
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[var(--verdict-uncertain)]" />
      <span>
        Results are probabilistic and may be wrong. Do not use as sole evidence. No detector is
        100% accurate — always corroborate with human judgement and other sources.
      </span>
    </p>
  );
}
