/**
 * Builds demo sample files for the landing page:
 *  - public/samples/photo-spliced.jpg  (hard splice of two photos, recompressed)
 * Run: bun scripts/make-samples.mjs
 */
import { readFileSync, writeFileSync } from "fs";
import jpeg from "jpeg-js";

const a = jpeg.decode(readFileSync("public/samples/photo-camera.jpg"), { useTArray: true });
const b = jpeg.decode(readFileSync("public/samples/photo-scene2.jpg"), { useTArray: true });

if (a.width !== b.width || a.height !== b.height) {
  console.error("sample sizes differ — regenerate the source photos first");
  process.exit(1);
}

const { width, height } = a;
const out = new Uint8Array(width * height * 4);
const split = Math.floor(width * 0.55);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const src = x < split ? a : b;
    const i = (y * width + x) * 4;
    out[i] = src.data[i];
    out[i + 1] = src.data[i + 1];
    out[i + 2] = src.data[i + 2];
    out[i + 3] = 255;
  }
}

const encoded = jpeg.encode({ data: out, width, height }, 78);
writeFileSync("public/samples/photo-spliced.jpg", encoded.data);
console.log(
  `photo-spliced.jpg written (${encoded.data.length} bytes, ${width}x${height}, hard seam at x=${split}, JPEG q=78)`,
);
