// timing.ts
export interface Timing {
  t0: number;
  t1?: number;
  stage?: string;
  note?: string;
}

export function start(): Timing {
  return { t0: performance.now() };
}

export function mark(t: Timing, label: string): Timing {
  t.t1 = performance.now();
  t.stage = label;
  return t;
}

export function elapsed(t: Timing): number {
  return t.t1 !== undefined ? t.t1 - t.t0 : performance.now() - t.t0;
}

export function log(t: Timing): string {
  return `${t.stage ?? "stage"} ${Math.round(elapsed(t))}ms`;
}
