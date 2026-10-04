import { useMemo, useRef, useState } from "react";
import { ImageOff, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Check, FaceResult, TimelinePoint } from "@/lib/engine/types";

/* ------------------------------------------------------------------ */
/* Original ↔ heatmap comparison slider                                */
/* ------------------------------------------------------------------ */

export function CompareSlider({
  original,
  overlay,
  overlayAlt,
}: {
  original: string;
  overlay: string;
  overlayAlt: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);

  const update = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.max(0, Math.min(100, pct)));
  };

  return (
    <div
      ref={ref}
      className="relative select-none overflow-hidden rounded-lg border border-border bg-muted"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        update(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) update(e.clientX);
      }}
      role="slider"
      aria-label="Compare original and heatmap"
      aria-valuenow={Math.round(pos)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 4));
        if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 4));
      }}
    >
      <img src={original} alt="Original media" className="block w-full" draggable={false} />
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      >
        <img
          src={overlay}
          alt={overlayAlt}
          className="block h-full w-full object-cover"
          draggable={false}
        />
      </div>
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-[var(--verdict-uncertain)] shadow-[0_0_10px] shadow-[var(--verdict-uncertain)]"
        style={{ left: `${pos}%` }}
      />
      <div
        className="pointer-events-none absolute top-1/2 flex size-7 -translate-y-1/2 -translate-x-1/2 items-center justify-center rounded-full border-2 border-[var(--verdict-uncertain)] bg-background/90 font-mono text-[10px]"
        style={{ left: `${pos}%` }}
      >
        ↔
      </div>
      <Badge className="absolute left-2 top-2 border border-border bg-background/90 font-mono text-[10px] uppercase tracking-widest">
        anomaly map
      </Badge>
      <Badge className="absolute right-2 top-2 border border-border bg-background/90 font-mono text-[10px] uppercase tracking-widest">
        original
      </Badge>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Checks list                                                         */
/* ------------------------------------------------------------------ */

const STATUS_TONE: Record<Check["status"], string> = {
  ok: "border-[var(--verdict-real)]/50 bg-[var(--verdict-real)]/10 text-[var(--verdict-real)]",
  warn: "border-[var(--verdict-uncertain)]/60 bg-[var(--verdict-uncertain)]/10 text-[var(--verdict-uncertain)]",
  flag: "border-[var(--verdict-fake)]/50 bg-[var(--verdict-fake)]/10 text-[var(--verdict-fake)]",
  skip: "border-border bg-muted text-muted-foreground",
};

const STATUS_WORD: Record<Check["status"], string> = {
  ok: "within range",
  warn: "elevated",
  flag: "flagged",
  skip: "not run",
};

export function ChecksList({ checks }: { checks: Check[] }) {
  return (
    <ul className="space-y-3">
      {checks.map((c) => (
        <li
          key={c.id + c.label}
          className={`rounded-lg border bg-card p-4 ${STATUS_TONE[c.status].split(" ")[0]} border-border`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className={`stamp px-2 py-0.5 text-[10px] ${STATUS_TONE[c.status]}`}>
              {STATUS_WORD[c.status]}
            </span>
            <h4 className="font-display text-sm font-semibold">{c.label}</h4>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {c.display} · weight {c.weight > 0 ? c.weight.toFixed(2) : "—"}
            </span>
          </div>
          <p className="mt-2 font-body text-sm leading-6 text-muted-foreground">{c.finding}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${
                  c.status === "flag"
                    ? "bg-[var(--verdict-fake)]"
                    : c.status === "warn"
                      ? "bg-[var(--verdict-uncertain)]"
                      : c.status === "skip"
                        ? "bg-border"
                        : "bg-[var(--verdict-real)]"
                }`}
                style={{ width: `${Math.round(c.score * 100)}%` }}
              />
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">
              lean {(c.score * 100).toFixed(0)}%
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Face cards                                                          */
/* ------------------------------------------------------------------ */

export function FaceCards({ faces, note }: { faces: FaceResult[]; note?: string }) {
  if (!faces.length) {
    return (
      <p className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center font-body text-sm text-muted-foreground">
        {note ?? "No faces were detected in this media."}
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {note && (
        <p className="font-mono text-[11px] leading-5 text-muted-foreground">{note}</p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {faces.map((f) => (
          <article key={f.index} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-md border border-border bg-muted font-mono text-xs">
                F{f.index + 1}
              </span>
              <div>
                <h4 className="font-display text-sm font-semibold">Face {f.index + 1}</h4>
                <p className="font-mono text-[10px] text-muted-foreground">
                  box {(f.box.x * 100).toFixed(0)}%,{(f.box.y * 100).toFixed(0)}% ·{" "}
                  {(f.box.w * 100).toFixed(0)}×{(f.box.h * 100).toFixed(0)}%
                </p>
              </div>
              <div className="ml-auto text-right">
                <p
                  className={`font-mono text-lg font-bold ${
                    f.score >= 0.65
                      ? "text-[var(--verdict-fake)]"
                      : f.score >= 0.4
                        ? "text-[var(--verdict-uncertain)]"
                        : "text-[var(--verdict-real)]"
                  }`}
                >
                  {(f.score * 100).toFixed(0)}%
                </p>
                <p className="font-mono text-[10px] text-muted-foreground">
                  conf {f.confidence.toFixed(0)}%
                </p>
              </div>
            </div>
            <ul className="mt-3 space-y-1.5">
              {f.checks.map((c) => (
                <li
                  key={c.id}
                  className="flex items-start gap-2 font-body text-xs leading-5 text-muted-foreground"
                >
                  <span
                    className={`mt-1 size-1.5 shrink-0 rounded-full ${
                      c.status === "flag"
                        ? "bg-[var(--verdict-fake)]"
                        : c.status === "warn"
                          ? "bg-[var(--verdict-uncertain)]"
                          : c.status === "skip"
                            ? "bg-border"
                            : "bg-[var(--verdict-real)]"
                    }`}
                  />
                  <span>
                    <span className="font-medium text-foreground/90">{c.label}:</span>{" "}
                    {c.finding}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Video timeline                                                      */
/* ------------------------------------------------------------------ */

export function TimelineChart({
  timeline,
  fakeThreshold,
  realThreshold,
  duration,
  onSeek,
  markers,
}: {
  timeline: TimelinePoint[];
  fakeThreshold: number;
  realThreshold: number;
  duration: number;
  onSeek: (t: number) => void;
  markers?: Array<{ t: number; label: string }>;
}) {
  const W = 640;
  const H = 150;
  const PAD = { l: 34, r: 8, t: 10, b: 22 };

  const path = useMemo(() => {
    if (!timeline.length) return "";
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    return timeline
      .map((p, i) => {
        const x = PAD.l + (p.t / Math.max(1, duration - 1)) * innerW;
        const y = PAD.t + (1 - p.score) * innerH;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(" ");
  }, [timeline, duration]);

  const yFor = (v: number) => PAD.t + (1 - v) * (H - PAD.t - PAD.b);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const innerW = W - PAD.l - PAD.r;
    const frac = Math.max(0, Math.min(1, (x - PAD.l) / innerW));
    onSeek(frac * Math.max(1, duration - 1));
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        onClick={handleClick}
        role="img"
        aria-label="Per-second manipulation probability timeline. Click to jump to that moment."
      >
        <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="var(--muted)" opacity="0.5" />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="var(--border)"
              strokeDasharray={v === 0 || v === 1 ? "none" : "3 4"}
            />
            <text x={4} y={yFor(v) + 3} fontSize="9" fill="var(--muted-foreground)" fontFamily="monospace">
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={yFor(fakeThreshold)}
          y2={yFor(fakeThreshold)}
          stroke="var(--verdict-fake)"
          strokeWidth="1.2"
          strokeDasharray="6 4"
        />
        <text x={W - PAD.r - 60} y={yFor(fakeThreshold) - 4} fontSize="9" fill="var(--verdict-fake)" fontFamily="monospace">
          fake ≥ {fakeThreshold.toFixed(2)}
        </text>
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={yFor(realThreshold)}
          y2={yFor(realThreshold)}
          stroke="var(--verdict-real)"
          strokeWidth="1.2"
          strokeDasharray="6 4"
        />
        <path d={path} fill="none" stroke="var(--verdict-uncertain)" strokeWidth="2" strokeLinejoin="round" />
        {timeline.map((p) =>
          p.score >= fakeThreshold ? (
            <circle
              key={p.t}
              cx={PAD.l + (p.t / Math.max(1, duration - 1)) * (W - PAD.l - PAD.r)}
              cy={yFor(p.score)}
              r="3.5"
              fill="var(--verdict-fake)"
            />
          ) : null,
        )}
        {(markers ?? []).map((m) => (
          <g key={m.label}>
            <line
              x1={PAD.l + (m.t / Math.max(1, duration - 1)) * (W - PAD.l - PAD.r)}
              x2={PAD.l + (m.t / Math.max(1, duration - 1)) * (W - PAD.l - PAD.r)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="var(--primary)"
              strokeWidth="1"
            />
            <text
              x={PAD.l + (m.t / Math.max(1, duration - 1)) * (W - PAD.l - PAD.r) + 3}
              y={PAD.t + 10}
              fontSize="8.5"
              fill="var(--primary)"
              fontFamily="monospace"
            >
              {m.label}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} fontSize="9" fill="var(--muted-foreground)" fontFamily="monospace">
          0s
        </text>
        <text x={W - PAD.r - 30} y={H - 6} fontSize="9" fill="var(--muted-foreground)" fontFamily="monospace">
          {Math.round(duration)}s
        </text>
      </svg>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        click anywhere to jump · red dots = spikes above the fake threshold
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function MissingArtifact({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6">
      <ImageOff className="size-5 text-muted-foreground" />
      <p className="font-body text-sm text-muted-foreground">{what}</p>
    </div>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="space-y-1.5">
      {warnings.map((w) => (
        <li
          key={w}
          className="flex items-start gap-2 font-body text-sm leading-6 text-muted-foreground"
        >
          <TriangleAlert className="mt-1 size-3.5 shrink-0 text-[var(--verdict-uncertain)]" />
          {w}
        </li>
      ))}
    </ul>
  );
}
