import { useId } from "react";

/**
 * Soft-glow confidence gauge (0–100, capped below 100 by design).
 * Colour follows the verdict palette; the arc is drawn from real values only.
 */
export function ConfidenceGauge({
  value,
  verdict,
  size = 168,
}: {
  value: number;
  verdict: "real" | "inconclusive" | "likely_ai" | "likely_deepfake" | "error";
  size?: number;
}) {
  const uid = useId();
  const clamped = Math.max(0, Math.min(100, value));
  const stroke = size * 0.09;
  const r = size / 2 - stroke - 4;
  const cx = size / 2;
  const cy = size / 2;
  const start = polar(cx, cy, r, -220);
  const end = polar(cx, cy, r, 40);
  const arc = `M ${start.x} ${start.y} A ${r} ${r} 0 1 1 ${end.x} ${end.y}`;
  const totalLen = r * (260 * (Math.PI / 180));
  const color =
    verdict === "real"
      ? "var(--verdict-real)"
      : verdict === "inconclusive"
        ? "var(--verdict-uncertain)"
        : verdict === "error"
          ? "var(--muted-foreground)"
          : "var(--verdict-fake)";

  return (
    <div
      className="relative"
      style={{ width: size, height: size * 0.78 }}
      role="img"
      aria-label={`Confidence ${clamped.toFixed(0)} percent`}
    >
      <svg width={size} height={size * 0.78} viewBox={`0 0 ${size} ${size * 0.78}`}>
        <defs>
          <filter id={`glow-${uid}`} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.5" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path
          d={arc}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={arc}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          filter={`url(#glow-${uid})`}
          strokeDasharray={`${(clamped / 100) * totalLen} ${totalLen}`}
          style={{ transition: "stroke-dasharray 700ms cubic-bezier(.22,1,.36,1)" }}
        />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <div
          className="font-mono text-3xl font-bold tabular-nums"
          style={{ color }}
        >
          {clamped.toFixed(0)}
          <span className="text-base">%</span>
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          confidence
        </div>
      </div>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
