/** Band measurement: sharpness (p90 tile gradient) and estimated QF per
 *  sample × perturbation. Used to set EVIDENCE bands with real numbers. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { analyzeFile, decodeImage, type DecodedImage } from "./lib/pipeline";
import { blurRgba, encodeJpeg, resizeRoundTrip } from "./lib/perturb";
import { percentile } from "../src/lib/engine/dsp";

const SAMPLES = [
  "public/samples/photo-camera.jpg",
  "public/samples/photo-scene2.jpg",
  "public/samples/ai-generated.png",
  "public/samples/photo-spliced.jpg",
  "public/samples/face-composited.jpg",
  "public/samples/face-generated.jpg",
];

const VARIANTS: Array<{ name: string; f: (i: DecodedImage) => Uint8Array | Buffer }> = [
  { name: "baseline", f: (i) => encodeJpeg(i, 95) },
  { name: "q60", f: (i) => encodeJpeg(i, 60) },
  { name: "q40", f: (i) => encodeJpeg(i, 40) },
  { name: "blur", f: (i) => encodeJpeg(blurRgba(i, 1, 2), 85) },
  { name: "resize", f: (i) => encodeJpeg(resizeRoundTrip(i, 0.5), 85) },
];

const dir = mkdtempSync(join(tmpdir(), "tl-measure-"));
console.log("sample                         variant   sharpP90  slope  peak   hfRatio gridX   sigma  verdict");
try {
  for (const s of SAMPLES) {
    const base = decodeImage(s);
    for (const v of VARIANTS) {
      const bytes = v.f(base.img);
      const tmp = join(dir, `${s.split("/").pop()}-${v.name}.jpg`);
      writeFileSync(tmp, bytes);
      const r = analyzeFile(tmp);
      const grads = r.sig.tiles.grad;
      const p90 = percentile(grads, 90);
      console.log(
        `${s.split("/").pop()!.padEnd(30)} ${v.name.padEnd(9)} ${p90.toFixed(0).padStart(7)}  ${r.sig.spectrum.slope.toFixed(2).padStart(5)} ${r.sig.spectrum.peak.toFixed(1).padStart(5)}  ${r.sig.spectrum.hfRatio.toFixed(3).padStart(6)} ${(r.sig.grid?.strength ?? 0).toFixed(2).padStart(5)} ${r.sig.noise.sigmaFlat.toFixed(2).padStart(5)}  ${r.decision.verdict} (${r.decision.score.toFixed(2)})`,
      );
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
