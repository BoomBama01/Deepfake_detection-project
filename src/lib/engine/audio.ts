/**
 * TruthLens — audio signal profile (optional check for video runs).
 *
 * Real measurements only: clipping, DC offset, silence ratio, loudness
 * uniformity and spectral centroid of the decoded track. Voice-clone
 * classification is NOT part of v1 — say so plainly rather than guessing.
 */

import { clamp, mean, stdDev } from "./dsp";
import { fft1d } from "./dsp";
import type { AudioProfile, Check } from "./types";

export function makeAudioCheck(profile: AudioProfile): Check {
  const uniformity = profile.uniformity;
  // a perfectly flat loudness envelope is unnatural for human speech/room tone
  const sFlat = clamp((uniformity - 0.93) / 0.06, 0, 1);
  const sClip = clamp(profile.clippingRatio / 0.01, 0, 1);
  const score = clamp(0.6 * sFlat + 0.4 * sClip, 0, 1);
  const status: Check["status"] = score >= 0.65 ? "flag" : score >= 0.4 ? "warn" : "ok";
  return {
    id: "audio",
    label: "Audio continuity",
    group: "audio",
    raw: uniformity,
    display: `uniformity ${(uniformity * 100).toFixed(1)}% · clip ${(profile.clippingRatio * 100).toFixed(3)}%`,
    score,
    weight: 0.06,
    status,
    finding:
      `Loudness uniformity across the track = ${(uniformity * 100).toFixed(1)}%, clipping = ${(profile.clippingRatio * 100).toFixed(3)}%, ` +
      `DC offset = ${profile.dcOffset.toFixed(4)}, silence = ${(profile.silenceRatio * 100).toFixed(1)}%, spectral centroid = ${profile.spectralCentroid.toFixed(3)}. ` +
      (status === "flag"
        ? "Near-perfect loudness uniformity is typical of synthesised or heavily processed audio."
        : "Variation matches natural recordings. Note: v1 does not classify cloned voices — treat this as supporting evidence only."),
  };
}

export async function analyzeAudio(
  ctx: AudioContext,
  buffer: AudioBuffer,
): Promise<AudioProfile> {
  const ch = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  const dur = buffer.duration;

  let clipped = 0;
  let dc = 0;
  const win = Math.max(1, Math.floor(sr * 0.05)); // 50 ms windows
  const rms: number[] = [];
  for (let i = 0; i < ch.length; i += win) {
    let s = 0;
    let n = 0;
    for (let j = i; j < Math.min(ch.length, i + win); j++) {
      const v = ch[j];
      s += v * v;
      dc += v;
      if (Math.abs(v) >= 0.99) clipped++;
      n++;
    }
    if (n) rms.push(Math.sqrt(s / n));
  }
  dc /= ch.length || 1;
  const overall = mean(rms) || 1e-6;
  const silenceRatio = rms.filter((r) => r < overall * 0.05).length / (rms.length || 1);

  // loudness uniformity over the loudest 70% of windows (ignore silence)
  const sorted = [...rms].sort((a, b) => a - b);
  const active = sorted.slice(Math.floor(sorted.length * 0.15));
  const am = mean(active) || 1e-6;
  const uniformity = clamp(1 - stdDev(active) / am, 0, 1);

  // spectral centroid of the loudest window
  let loudestIdx = 0;
  let loudest = -1;
  for (let i = 0; i < rms.length; i++)
    if (rms[i] > loudest) {
      loudest = rms[i];
      loudestIdx = i;
    }
  const start = Math.min(ch.length - 2048, loudestIdx * win);
  const N = 1024;
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    re[i] = (ch[start + i] ?? 0) * hann;
  }
  fft1d(re, im);
  let num = 0;
  let den = 0;
  for (let k = 1; k < N / 2; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
    num += (k / (N / 2)) * mag;
    den += mag;
  }
  const spectralCentroid = den > 0 ? num / den : 0;

  return {
    present: ch.length > 0,
    durationSec: dur,
    sampleRate: sr,
    clippingRatio: clipped / (ch.length || 1),
    dcOffset: dc,
    silenceRatio,
    spectralCentroid,
    uniformity,
    note: "Signal-level profile only. Voice-clone classification is not included in TruthLens v1.",
  };
}

/** Decode the audio track of a media file. Returns null when no audio exists. */
export async function decodeAudio(file: File, maxSeconds = 180): Promise<AudioBuffer | null> {
  const Ctor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  try {
    const buf = await file.arrayBuffer();
    const decoded = await ctx.decodeAudioData(buf.slice(0));
    if (decoded.duration > maxSeconds) {
      // trim analysis window to the allowed duration
      const trimmed = ctx.createBuffer(
        1,
        Math.floor(decoded.sampleRate * maxSeconds),
        decoded.sampleRate,
      );
      trimmed.copyToChannel(
        decoded.getChannelData(0).slice(0, Math.floor(decoded.sampleRate * maxSeconds)),
        0,
      );
      return trimmed;
    }
    return decoded;
  } catch {
    return null;
  } finally {
    void ctx.close();
  }
}
