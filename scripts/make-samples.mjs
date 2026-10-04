/**
 * Builds demo sample files for the landing page:
 *  - public/samples/photo-spliced.jpg            (hard splice of two photos)
 *  - public/samples/face-composited.jpg          (denoised AI face pasted onto a photo)
 * Run: bun scripts/make-samples.mjs
 *
 * The geometry of the pasted face is fixed so scripts/engine-check.ts can
 * point the face forensics at the exact region.
 */
import { readFileSync, writeFileSync } from "fs";
import jpeg from "jpeg-js";

/* ---------- photo-spliced.jpg ---------- */
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
console.log(`photo-spliced.jpg written (${encoded.data.length} bytes, seam at x=${split})`);

/* ---------- face-composited.jpg ---------- */
// Fixed geometry (kept in sync with engine-check.ts):
const FACE_BOX = { x: 0.3, y: 0.11, w: 0.4, h: 0.74 };

const face = jpeg.decode(readFileSync("public/samples/face-generated.jpg"), { useTArray: true });
const base = jpeg.decode(readFileSync("public/samples/photo-camera.jpg"), { useTArray: true });
const W = base.width;
const H = base.height;

const bx = Math.round(FACE_BOX.x * W);
const by = Math.round(FACE_BOX.y * H);
const bw = Math.round(FACE_BOX.w * W);
const bh = Math.round(FACE_BOX.h * H);

// centre-crop the generated portrait, scale to the paste box
const crop = { x: Math.round(face.width * 0.24), y: Math.round(face.height * 0.17) };
const cropW = Math.round(face.width * 0.52);
const cropH = Math.round(face.height * 0.66);
const scaled = new Uint8Array(bw * bh * 4);
for (let y = 0; y < bh; y++) {
  const sy = Math.min(cropH - 1, Math.floor((y * cropH) / bh));
  for (let x = 0; x < bw; x++) {
    const sx = Math.min(cropW - 1, Math.floor((x * cropW) / bw));
    const si = ((crop.y + sy) * face.width + (crop.x + sx)) * 4;
    const di = (y * bw + x) * 4;
    scaled[di] = face.data[si];
    scaled[di + 1] = face.data[si + 1];
    scaled[di + 2] = face.data[si + 2];
    scaled[di + 3] = 255;
  }
}

// over-smooth the pasted face (the "synthetic skin" the detector looks for)
const tmp = new Uint8Array(scaled.length);
for (let pass = 0; pass < 4; pass++) {
  const src = pass === 0 ? scaled : tmp;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let r = 0;
      let g = 0;
      let bl = 0;
      let n = 0;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const yy = y + dy;
          const xx = x + dx;
          if (yy < 0 || yy >= bh || xx < 0 || xx >= bw) continue;
          const i = (yy * bw + xx) * 4;
          r += src[i];
          g += src[i + 1];
          bl += src[i + 2];
          n++;
        }
      }
      const i = (y * bw + x) * 4;
      scaled[i] = r / n;
      scaled[i + 1] = g / n;
      scaled[i + 2] = bl / n;
      scaled[i + 3] = 255;
    }
  }
  tmp.set(scaled);
}

// paste with a feathered elliptical mask + mismatched brightness
const cx = bw / 2;
const cy = bh / 2;
const rx = bw / 2;
const ry = bh / 2;
const feather = Math.min(bw, bh) * 0.05;
for (let y = 0; y < bh; y++) {
  for (let x = 0; x < bw; x++) {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry); // 1 at ellipse edge
    let alpha = 0;
    if (d < 1) alpha = Math.min(1, (1 - d) * (Math.min(bw, bh) / 2 / feather));
    if (alpha <= 0) continue;
    const bi = ((by + y) * W + (bx + x)) * 4;
    const si = (y * bw + x) * 4;
    const lift = 9; // lighting mismatch with the host photo
    a.data[bi] = Math.min(255, a.data[bi] * (1 - alpha) + (scaled[si] + lift) * alpha);
    a.data[bi + 1] = Math.min(255, a.data[bi + 1] * (1 - alpha) + (scaled[si + 1] + lift) * alpha);
    a.data[bi + 2] = Math.min(255, a.data[bi + 2] * (1 - alpha) + (scaled[si + 2] + lift) * alpha);
  }
}

const composited = jpeg.encode({ data: a.data, width: W, height: H }, 80);
writeFileSync("public/samples/face-composited.jpg", composited.data);
console.log(
  `face-composited.jpg written (${composited.data.length} bytes, face box ${JSON.stringify(FACE_BOX)})`,
);
