# TruthLens

A multimodal media-authenticity instrument for images and video. TruthLens runs a
modular, evidence-first forensic pipeline in the browser and returns one of three
outcomes — **LIKELY AUTHENTIC**, **LIKELY AI-GENERATED or MANIPULATED**, or
**INCONCLUSIVE** — together with the measurements that produced it.

It is built on the principle that a detector which cannot tell fake from real
should say so. The third outcome is not a failure state that gets rounded to a
side; it is a first-class result with its own explanation.

---

## Table of contents

- [What TruthLens does](#what-truthlens-does)
- [Architecture](#architecture)
- [The three-outcome methodology](#the-three-outcome-methodology)
- [Detector portfolio](#detector-portfolio)
- [Detection vs provenance](#detection-vs-provenance)
- [Forensic reports](#forensic-reports)
- [Developer dashboard](#developer-dashboard)
- [Evaluation](#evaluation)
- [Calibration](#calibration)
- [Supported media and limits](#supported-media-and-limits)
- [Privacy model](#privacy-model)
- [Security model](#security-model)
- [Known failure cases](#known-failure-cases)
- [Repository layout](#repository-layout)
- [Commands](#commands)
- [Platform conventions](#platform-conventions)

---

## What TruthLens does

| | |
|---|---|
| **Media** | JPEG, PNG, WebP, GIF (image); MP4, WebM, MOV, AVI (video) |
| **Runs** | Fully client-side in the browser via WebAssembly / Canvas / WebCodecs |
| **Video analysis** | Temporal consistency across sampled frames + audio/video continuity profile |
| **Output** | Three-outcome verdict, confidence, uncertainty, evidence strength, full check breakdown, JSON forensic report |
| **Uploaded to server** | Nothing of the original. A downscaled preview and derived artifacts, purged after 24 h |

---

## Architecture

```
                    ┌──────────────────────────────────────────────┐
  image / video ───▶│  runner.ts   decode · downscale · frame sample│
                    └───────────────┬──────────────────────────────┘
                                    │  normalised pixels + metadata
                                    ▼
        ┌───────────────────────────────────────────────────────────┐
        │  forensics.ts        measured checks (pixel + encoding)   │
        │  ───────────────────────────────────────────────────────  │
        │  spectral · resampling · noise · ELA · tiles · texture ·   │
        │  metadata · face geometry · temporal · audio continuity    │
        └───────────────┬───────────────────────────────────────────┘
                        │  Check[]  (score, weight, status, evidence)
                        ├──────────────────────────────┐
                        ▼                              ▼
   ┌────────────────────────────────┐   ┌────────────────────────────────┐
   │ detectors.ts  evidence fusion  │   │ verdict.ts  three-way decision │
   │  image · spectral · compression│   │  thresholds + floors +         │
   │  metadata · provenance · face  │   │  agreement + evidence strength  │
   │  temporal · audio              │   │  → authentic / synthetic /     │
   │  ClassifierBackend (pluggable) │   │    inconclusive                │
   └───────────────┬────────────────┘   └───────────────┬────────────────┘
                   │ EvidenceReport (categories, signals, provenance)
                   └──────────────────┬─────────────────┘
                                      ▼
        ┌───────────────────────────────────────────────────────────┐
        │ report.ts  ForensicReport  →  serializeReport (JSON)      │
        │  Report.tsx  on-screen report · Results.tsx  download     │
        └───────────────────────────────────────────────────────────┘
```

**Where each piece lives**

| File | Responsibility |
|---|---|
| `src/lib/engine/runner.ts` | Decode, downscale, sample frames, orchestrate, stream stage progress |
| `src/lib/engine/forensics.ts` | The measured checks, their weights, evidence quality |
| `src/lib/engine/detectors.ts` | Detector abstraction, evidence fusion, pluggable classifier backend |
| `src/lib/engine/verdict.ts` | Three-way decision core, thresholds, calibration metadata |
| `src/lib/engine/report.ts` | Forensic report serializer, disclaimer, limitations |
| `src/lib/engine/types.ts` | `VerdictBlock`, `Outcome`, `EvidenceReport` shared shapes |
| `src/components/results/Report.tsx` | On-screen forensic report |

**Data flow guarantees**

- The verdict is computed from the fused evidence score, not from a single
  dominant check. A single flagged signal can no longer be averaged away by a
  field of quiet ones — the flag-veto floors handle that case explicitly.
- A detector that could not run emits weight `0`. Skipped detectors cannot move
  the score in either direction.
- Provenance (EXIF, C2PA, generator signatures) is reported **separately** from
  detection evidence and never contributes a synthetic-leaning score.

---

## The three-outcome methodology

The decision core lives in `src/lib/engine/verdict.ts`.

1. **Score** — a weighted blend of every check that actually ran, in `0..1`,
   where higher means more synthetic-leaning.
2. **Thresholds** — a per-sensitivity pair (`real`, `fake`) defines the three
   regions. `balanced` is `0.38 / 0.62`.
3. **Floors** — a strongly structural manipulation signal (≥ `STRUCTURAL_FLOOR`
   = 0.72) forces the synthetic outcome even if the blend sits lower, so a lone
   decisive splice cannot be diluted.
4. **Abstention** — the verdict becomes **INCONCLUSIVE** when any of these hold:
   - the score falls between the two thresholds (inside the band);
   - the score is below `OK_SCORE_FLOOR` = 0.30 *and* evidence is degraded;
   - measured `evidenceStrength` < 0.30 (too few checks actually ran);
   - weighted dispersion between checks exceeds `DISAGREEMENT_LIMIT` = 0.34,
     i.e. the measurements contradict each other.
5. **Confidence** — distance from the **nearest decision boundary** (not from the
   midpoint), weighted by inter-check agreement and evidence strength, capped at
   `CONFIDENCE_CAP` = 97. A score sitting exactly on a boundary reports low
   confidence, not high.
6. **Uncertainty** — the complement, surfaced separately so the UI can render the
   40–60% `UNCERTAIN_BAND` honestly.

### Thresholds per sensitivity

| Sensitivity | Authentic below | Synthetic above | Behaviour |
|---|---|---|---|
| `low` | 0.30 | 0.75 | Cautious about calling anything synthetic; abstains more |
| `balanced` | 0.38 | 0.62 | Default |
| `high` | 0.45 | 0.52 | Cautious about calling anything authentic; abstains more |

> **There is no "REAL" or "FAKE" label anywhere in the product.** The strongest
> claims available are *likely*. See `Known failure cases` for why.

---

## Detector portfolio

Detectors are self-contained classes implementing one `Detector` interface. They
run against a shared `DetectorContext` and emit `DetectorSignal`s carrying a
score, a reliability, and prose evidence. The fusion weight is shared by every
detector in a group (`FUSION_WEIGHTS`):

| Detector | Group | Group weight | Runs on |
|---|---|---|---|
| AI-generation classifier | `image` | 0.30 | image, video frame |
| Visual artifact detector | `image` | 0.30 | image, video frame |
| Frequency-domain detector | `spectral` | 0.18 | image, video frame |
| Compression & resampling detector | `compression` | 0.26 | image, video frame |
| Metadata detector | `metadata` | 0.16 | image, video frame |
| Provenance detector (C2PA) | `provenance` | 0.08 | image, video frame |
| Face manipulation detector | `face` | 0.26 | faces present, not portrait-filling |
| Video temporal consistency detector | `temporal` | 0.28 | video only |
| Audio / video continuity detector | `audio` | 0.06 | video with an audio track |

Face detection uses MediaPipe Tasks Vision (local WASM). No model weights are
downloaded from a third party at analysis time, and no classifier API key exists
anywhere in the client bundle.

### Pluggable classifiers

`registerBackend(backend)` swaps the feature-blend heuristic
(`truthlens-feature-blend`, `modelBacked: false`) for a real classifier. The
default backend is explicitly **not** model-backed and says so in the developer
dashboard — the score comes from measured physical and encoding signals, not from
a neural fake/real probability. This is reported to users rather than implied.

---

## Detection vs provenance

These are different questions and the product keeps them apart.

- **Detection** — do the pixels and encoding show generation or manipulation?
  This is what moves the score, and it is always uncertain.
- **Provenance** — what does the file *claim* about itself? Camera EXIF, C2PA
  content credentials, generator software signatures.

The absence of EXIF or of C2PA credentials is **not** evidence of AI generation.
It is reported as absent and carries **zero weight** in the authentic direction —
inferring authenticity from missing provenance would be backwards. Provenance is
rendered in its own report section, explicitly separate from the evidence
categories, and its own field is named `absenceIsNeutral` so a downstream
consumer cannot miss the rule.

---

## Forensic reports

Every analysis produces a `ForensicReport` (`src/lib/engine/report.ts`) with:

- `reportVersion`, `generatedAt`, and the standing `REPORT_DISCLAIMER`;
- the three-way `outcome` plus `confidence`, `uncertainty`, `evidenceStrength`,
  `score`, `uncertainBand`, and a human-readable `inconclusiveReason` when
  applicable;
- subject identity: kind, dimensions, duration, frame count, SHA-256 hash;
- a plain-language `narrative` in the order the engine produced it;
- per-category `evidence` with each signal's raw measurement, lean, confidence,
  weight, whether it ran, and its detector + version;
- every `check` with real numbers — nothing hidden;
- a `provenance` block (with the inference stated as an inference);
- `warnings`, `model`/detector versions, and `limitations`.

Export it from the Results page ("Download report") — it is the JSON that the
API returns too, so a programmatic consumer and a human read the same document.

Legacy rows stored before the three-way engine carry no `outcome`.
`resolveOutcomeLabel()` falls back to the stored verdict and **fails closed** to
`INCONCLUSIVE` for anything unrecognised, rather than defaulting to authentic.

---

## Developer dashboard

`/developer` (auth-protected) is the transparency surface. It shows the live
configuration of the engine rather than a marketing summary:

- classifier backend id, type, and whether weights are trained;
- the active face detector and its runtime;
- the full detector portfolio with group, weight and run conditions;
- feature weights, decision thresholds, and every exported constant
  (`OK_SCORE_FLOOR`, `STRUCTURAL_FLOOR`, `UNCERTAIN_BAND`, `CONFIDENCE_CAP`,
  `DISAGREEMENT_LIMIT`);
- calibration provenance — method, metrics, sample floor, `adopted` flag;
- check weights and ingestion limits;
- the signed-in account's own live scan statistics.

---

## Evaluation

All harnesses run offline against a manifest and share
`scripts/lib/dataset.ts`, which **refuses to run on leaky data**:
`auditLeakage()` throws if two entries share a content hash, or if one dataset
`group` spans more than one truth class.

Truth classes are three-way: `real`, `ai_generated`, `manipulated`.

```bash
# labelled evaluation — accuracy / precision / recall / F1 / ROC-AUC / FPR / FNR / abstention
bunx tsx scripts/benchmark.ts public/samples --manifest scripts/samples.manifest.json

# per-perturbation direction-flip audit
bunx tsx scripts/robustness-audit.ts public/samples --manifest scripts/samples.manifest.json

bunx tsx scripts/engine-check.ts      # determinism + per-sample dispersion
bunx tsx scripts/eval-folder.ts <dir> # evaluate a folder
bunx tsx scripts/calibrate.ts <root>  # threshold sweep; expects <root>/real and <root>/fake
bunx tsx scripts/measure-bands.ts     # measure where the decision boundaries actually sit
```

Both manifest-driven harnesses require `--manifest`, run a leakage audit before
measuring anything, and exit non-zero if a sample is misclassified as authentic
beyond the stated tolerance.

- **Metrics.** Accuracy, precision, recall, F1, ROC-AUC (Mann-Whitney), false
  positive rate, **false negative rate**, and abstention rate. Abstentions are
  reported as a first-class outcome — a benchmark that hides them is measuring
  the wrong thing. In `calibrate.ts` and `eval-folder.ts` an abstention on
  synthetic media counts as a miss, which is deliberate: declining to answer is
  not the same as catching it.
- **Confusion cells.** `authenticCorrect`, `falsePositive`, `falseNegative`,
  `syntheticCaught`, `inconclusive`, and the per-class breakdown.
- **Leakage control.** Every bundled sample comes from a *different source*, and
  each source is its own `group`. Splits are separated by dataset, never by a
  random shuffle of near-duplicates.
- **Determinism.** `engine-check.ts` is byte-identical across runs; identical
  input yields identical output.

### Perturbations

`scripts/lib/perturb.ts` builds degraded variants from a source image —
`blurRgba`, `resizeRoundTrip`, `encodeJpeg`, `cropRgba`, `screenshotRgba`,
`stripMetadata` — so robustness is measured against realistic re-sharing damage.

A perturbation that pushes a sample into the inconclusive band is a **good**
result. What the audit looks for is a *confident direction flip*: media that was
decisively one way, then asserted decisively the other way under degradation.
The current run reports **0 confident direction flips** — 11 samples unchanged,
17 honest degradations to lower confidence.

### Current bundled-sample results

Six samples, one per source: accuracy 100%, precision 100%, recall 50%,
F1 66.7%, ROC-AUC 1.000, FPR 0%, **FNR 0%**, abstention 33.3%.

Read this correctly: n = 6 is a **sanity harness**, not a performance claim. Two
samples are the near-threshold ones and correctly abstain, which is why recall
looks like 50% and abstention 33%. It demonstrates that the pipeline refuses to
guess, not that it is 100% accurate. Use it as a regression check, and use
`benchmark.ts` with your own manifest for real numbers.

---

## Calibration

Decision thresholds are meant to be measured, not hand-picked.
`scripts/calibrate.ts` sweeps candidate `(real, fake)` pairs through the exact
production decision core — including the flag-veto floors, which depend on the
thresholds themselves — and reports accuracy, precision, recall, F1, ROC-AUC and
FNR.

Calibration metadata is exported as `CALIBRATION` and surfaced in the developer
dashboard:

- `method`: threshold sweep through the production decision core
- `metric`: ROC-AUC, accuracy, precision, recall, F1, FNR
- `separatedBy`: dataset (never a random split of near-duplicates)
- `minSamplesForAdoption`: **200**
- `adopted`: **false**

The harness currently **measures and reports but refuses to adopt** a swept pair.
Tuning thresholds on a handful of near-duplicate images would fit the sample
rather than the problem. The shipped thresholds are conservative defaults.

---

## Supported media and limits

| | Limit |
|---|---|
| Image | 15 MB; JPEG, PNG, WebP, GIF |
| Video | 200 MB, 180 s; MP4, WebM, MOV, AVI |
| Batch | 10 files |
| Analysis resolution | downscaled to 1400 px on the long edge |
| Video frame width | 640 px |
| Server-stored result cap | 900 KB (`MAX_RESULT_BYTES`) |
| URL ingestion cap | 9 MB (fetched server-side, under Convex payload limits) |

Very heavily recompressed or downscaled media loses the high-frequency evidence
these checks depend on. That is why such runs return INCONCLUSIVE rather than a
confident guess.

---

## Privacy model

- **The original media never leaves the browser.** Detection runs client-side.
- Uploaded to Convex: a downscaled preview plus derived forensic artifacts
  (heatmap overlay, ELA view, suspicious-frame stills).
- **Media artifacts are deleted 24 hours after analysis** (`expiresAt`), unless
  the owner pins them explicitly.
- The result *summary* persists until the owner deletes the result; deleting a
  result removes its stored artifacts immediately.
- Guest scans are tied to a device claim; signed-in scans to the account.
- Quotas are enforced per plan: guest 3/day, free 25/day, pro 500/day, team
  2000/day.

---

## Security model

- **No credentials in the client.** No model API keys, no inference keys, no
  third-party calls during analysis. The face detector is local WASM.
- **API keys are hashed at rest.** Only the SHA-256 of a secret is stored; the
  secret is returned exactly once at creation and cannot be recovered.
- **Bearer auth on every `/api/v1` route** except `GET /api/v1/health`.
- **Rate limiting** at 30 requests per key per minute, enforced server-side with
  a rolling window, reported back via `X-RateLimit-Remaining`.
- **Ownership is re-checked on every read and write.** `loadScanFor()` gates on
  authenticated user identity or a device claim of at least 8 characters; rows
  not owned and not explicitly public return `null` rather than a partial
  result.
- **Cross-account API access returns 403**, not 404-with-detail.
- **Banned accounts** are blocked from scanning.
- **URL ingestion is size-bounded** and validated before fetch.
- **Audit logging** for security-relevant actions.

### Known exposure

`scans.get` returns owner rows and rows explicitly marked public, and it
authorises guest access through a device claim. A device claim is a bearer-like
token: anyone who obtains the same device id and a scan id can read that scan.
This is inherent to supporting a 3/day guest quota without accounts, and it is
accepted deliberately — the alternative is requiring sign-in for every guest
scan. Signed-in scans are not affected.

---

## Known failure cases

Honesty here is a feature, not a liability.

1. **Heavily recompressed media.** Screenshotting, resaving or re-encoding
   destroys the high-frequency evidence. Result: INCONCLUSIVE.
2. **Face-filling portraits.** Face manipulation checks are relative to the
   surrounding frame; when a face fills the image there is no context, so the
   check is **skipped**, not estimated.
3. **Missing provenance is not innocence.** A generator that strips metadata
   leaves nothing to find. Detection must carry the load alone.
4. **Genuinely new generator architectures.** The signal set is built on
   physical and encoding artefacts. A generator that deliberately imitates
   camera noise and resampling fingerprints is out of scope for this engine.
5. **No trained authenticity classifier is bundled.** The score comes from
   measured signals, not from a learned fake/real probability. This is stated in
   the report limitations, not buried.
6. **Voice cloning is not classified.** The audio section is a signal profile
   only.
7. **ELA requires a re-encode.** Where the environment cannot re-encode, ELA is
   reported as *not measured* rather than estimated.
8. **Small sample sizes.** The bundled benchmark is n = 6 and is a regression
   harness, not an accuracy claim.

---

## Repository layout

```
src/
  lib/engine/          runner · forensics · detectors · verdict · report · types
  lib/                 dsp, artifacts, checks helpers
  components/results/  Report.tsx (forensic report), parts.tsx
  components/          VerdictBadge · ConfidenceGauge · Disclaimer · RequireAuth
  pages/               Landing · Analyze · Results · Dashboard · Developer ·
                       About · Learn · Docs · Privacy · Terms · Contact · Auth
  convex/              schema · scans · http · apiKeys · account · proxy · auth
scripts/
  benchmark.ts             benchmark metrics with leakage audit
  robustness-audit.ts      perturbation direction-flip audit
  engine-check.ts          determinism + dispersion
  eval-folder.ts           evaluate an unlabelled folder
  calibrate.ts             threshold sweep through the production core
  measure-bands.ts         decision boundary measurement
  samples.manifest.json    bundled labelled samples
  lib/dataset.ts           manifest loader · leakage audit · metrics · ROC-AUC
  lib/perturb.ts           degradation generators
  lib/pipeline.ts          shared harness runner
```

---

## Commands

```bash
bun run dev                      # Vite dev server (managed by the platform)
bunx convex dev --once           # push Convex functions + regenerate types
bunx tsc -b --noEmit             # typecheck
bunx eslint <paths>              # lint
```

Evaluation harnesses are run directly with `bunx tsx` — see [Evaluation](#evaluation).

Never run `bun convex dev` interactively and never run a production build
unless explicitly asked.

---

## Platform conventions

These project conventions are load-bearing. Follow them.

### Stack

Vite · TypeScript · React 19 · React Router v7 (import from `react-router`) ·
Tailwind v4 · shadcn/ui · Lucide · Convex · Convex Auth · Framer Motion ·
Bun. All relevant app files live in `src`.

### Setup and environment

The project runs in a cloud environment with Convex dev connected. The client
side has project-specific `CONVEX_DEPLOYMENT` and `VITE_CONVEX_URL`. The Convex
server holds its own environment variables (auth-specific: `JWKS`,
`JWT_PRIVATE_KEY`, `SITE_URL`).

### Authentication

Auth is already set up with email OTP and anonymous users. Send every sign-in and
sign-up action to `/auth`.

**Do not modify:** `src/convex/auth/emailOtp.ts`, `src/convex/auth.config.ts`,
`src/convex/auth.ts`.

Backend: use `getCurrentUser` on `src/convex/users.ts`.
Frontend: always use the hook — never fetch user data by hand.

```tsx
import { useAuth } from "@/hooks/use-auth";
const { isLoading, isAuthenticated, user, signIn, signOut } = useAuth();
```

### Protected routes

Protect authenticated routes with `RequireAuth`. Do **not** hand-roll a redirect
to `/auth` — landing on a bare sign-in form with no explanation is confusing.
`RequireAuth` states what is blocked and sends the visitor to
`/auth?returnTo=<current route>`.

```tsx
<Route
  path="/developer"
  element={
    <RequireAuth title="Sign in to view the developer dashboard" description="Engine internals live here.">
      <Developer />
    </RequireAuth>
  }
/>
```

The `/auth` route redirects to `/dashboard` by default; update
`redirectAfterAuth` if the product's main authenticated route changes. A
validated same-origin `returnTo` takes priority.

### Frontend conventions

- Pages in `src/pages`, components in `src/components`, shadcn primitives in
  `src/components/ui`.
- Register new routes in `src/main.tsx`.
- Add `cursor-pointer` to clickable elements.
- Headings: `tracking-tight font-bold`.
- Mobile responsive, always. Verify min/max widths.
- **Avoid nested cards** and **avoid shadows** — use a thin border.
- Avoid skeletons; use the `loader2` spinner.
- Wrap pages in a centered container; avoid stretching on wide screens.
- Animate with Framer Motion `motion` — fades, slides, render animations,
  button feedback.
- Theme via the oklch variables in `src/index.css`; support light and dark.
- Toasts via shadcn Sonner: `import { toast } from "sonner"`.
- Dialogs must scroll internally so content is never cut off.

### Convex conventions

- Schema in `src/convex/schema.ts`. Keep `schemaValidation: false`.
- Never include `_id` or `_creationTime` in queries. Never index
  `_creationTime`.
- Document IDs are `_id`, typed `Id<"TableName">`; documents are `Doc<"TableName">`.
- **Never write return type validators.**
- External network calls go in `"use node"` actions. A `"use node"` file
  cannot also export queries or mutations.
- Use `@/folder/file.ts` imports, including `@/convex/_generated/*`.
- Handle `null`/`undefined` from every Convex query.
- Use `crud` from `convex-helpers/server/crud` inside `"use node"` actions when
  you need to read/write other tables.