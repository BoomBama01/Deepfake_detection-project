/**
 * TruthLens — public engine surface.
 *
 * Import the real image/video analysis entrypoints from here so the app always
 * drives the measured pipeline rather than the legacy stubs.
 */

// Image pipeline — validation, decode, signal forensics, faces, evidence fusion, verdict.
export {
  analyzeImage,
  analyzeVideo,
  validateImage,
  decodeImage,
  type AnalysisResult,
  type DecodedImage,
  type FaceRun,
  type ValidationProblem,
} from "./pipeline";

// Shared result types.
export type {
  Analysis,
  Check,
  EvidenceCategoryReport,
  EvidenceSignal,
  FaceResult,
  MetadataFindings,
  Verdict,
  VerdictBlock,
  VideoAnalysis,
  ImageAnalysis,
  TimelinePoint,
  FrameResult,
  TemporalStats,
  EngineInfo,
  StageProgress,
} from "./types";

// Settings + convenience defaults.
export { DEFAULT_SETTINGS } from "./types";
export type { AnalysisSettings, Sensitivity } from "./types";

// Verdicts + calibration helpers used by the UI/report layer.
export {
  decideVerdict,
  decideCore,
  type VerdictInput,
  type VerdictDecision,
  THRESHOLDS,
  CALIBRATION,
  CONFIDENCE_CAP,
  UNCERTAIN_BAND,
  DISAGREEMENT_LIMIT,
  OK_SCORE_FLOOR,
  STRUCTURAL_FLOOR,
} from "./verdict";

// Forensic report serializer + UI helpers.
export {
  buildReport,
  serializeReport,
  headline,
  shouldFlagLowConfidence,
  resolveOutcomeLabel,
  type ForensicReport,
  type ReportEvidenceCategory,
  type ReportProvenance,
  REPORT_DISCLAIMER,
  REPORT_LIMITATIONS,
} from "./report";
