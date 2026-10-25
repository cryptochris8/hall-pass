// ─────────────────────────────────────────────────────────────────────────────
// Pure sample generators (DOM-free, unit-tested): noise, the stadium reverb IR,
// shaper curves, the applause texture and custom oscillator spectra. Rendered once
// per AudioContext and cached as AudioBuffers / PeriodicWaves by synth.ts.
// Adapted from TRASH PANDA TROUBLE's audio/noise.ts.
// Copied from ATHLETE MAYHEM (src/audio) for HALL PASS.
// ─────────────────────────────────────────────────────────────────────────────

export type NoiseKind = 'white' | 'pink' | 'brown';

/** Tiny deterministic LCG → floats in [-1, 1). */
export function makeLcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2147483648 - 1;
  };
}

/** Remove DC and peak-normalise in place to `peak`. */
function normalise(out: Float32Array, peak: number): void {
  const n = out.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += out[i]!;
  mean /= Math.max(1, n);
  let pk = 0;
  for (let i = 0; i < n; i++) {
    out[i]! -= mean;
    pk = Math.max(pk, Math.abs(out[i]!));
  }
  if (pk > 1e-9) {
    const k = peak / pk;
    for (let i = 0; i < n; i++) out[i]! *= k;
  }
}

/** Deterministic noise, DC-free, peak-normalised to ~0.95. */
export function makeNoise(kind: NoiseKind, length: number, seed = 1234): Float32Array {
  const out = new Float32Array(length);
  const rnd = makeLcg(seed);
  if (kind === 'white') {
    for (let i = 0; i < length; i++) out[i] = rnd();
  } else if (kind === 'pink') {
    // Paul Kellet's economy pink filter (−3 dB/oct).
    let b0 = 0,
      b1 = 0,
      b2 = 0;
    for (let i = 0; i < length; i++) {
      const w = rnd();
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      out[i] = b0 + b1 + b2 + w * 0.1848;
    }
  } else {
    // Brown (red) noise: leaky integrated white (−6 dB/oct) — rumbles.
    let y = 0;
    for (let i = 0; i < length; i++) {
      y = 0.985 * y + 0.15 * rnd();
      out[i] = y;
    }
  }
  normalise(out, 0.95);
  return out;
}

/**
 * Stereo reverb impulse response: sparse early reflections (a stadium bowl has big,
 * late ones) plus an exponentially decaying noise tail that darkens over time (air
 * absorption). `decay` is T60 in seconds. Energy-normalised.
 */
export function makeReverbIR(sampleRate: number, duration: number, decay: number, seed = 77, predelay = 0.012): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.floor(duration * sampleRate));
  const chans: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  const pre = Math.min(len - 1, Math.floor(predelay * sampleRate));
  for (let c = 0; c < 2; c++) {
    const ch = chans[c]!;
    const rnd = makeLcg(seed + c * 7919);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.pow(10, (-3 * t) / decay); // −60 dB at t = decay
      const a = 0.8 - 0.68 * Math.min(1, t / duration); // the tail darkens
      lp += a * (rnd() - lp);
      ch[i] = lp * env;
    }
    // Early reflections: near walls first, then the far stands (different per side for width).
    const taps = [0.019, 0.029, 0.043, 0.061, 0.083, 0.112, 0.151];
    for (let k = 0; k < taps.length; k++) {
      const idx = pre + Math.floor((taps[k]! + (c ? 0.0037 * (k + 1) : 0)) * sampleRate);
      if (idx < len) ch[idx]! += (k % 2 ? -0.45 : 0.55) * Math.pow(0.8, k);
    }
    const fin = Math.min(len - pre, Math.floor(0.002 * sampleRate));
    for (let i = 0; i < fin; i++) ch[pre + i]! *= i / fin;
    const fout = Math.min(len, Math.floor(0.05 * sampleRate));
    for (let i = 0; i < fout; i++) ch[len - 1 - i]! *= i / fout;
  }
  let energy = 0;
  for (const ch of chans) for (let i = 0; i < len; i++) energy += ch[i]! * ch[i]!;
  const k = energy > 0 ? 1 / Math.sqrt(energy / 2) : 0;
  for (const ch of chans) for (let i = 0; i < len; i++) ch[i]! *= k * 0.5;
  return chans;
}

/**
 * Soft-clip transfer curve for a WaveShaperNode fed through a ½ pre-gain: curve
 * index maps input u ∈ [−2, 2]. Linear below `knee`, tanh saturation above it,
 * never exceeding `ceiling` — the hard safety net after the compressor.
 */
export function makeSoftClipCurve(points = 4096, ceiling = 0.93, knee = 0.62): Float32Array {
  const curve = new Float32Array(points);
  const room = ceiling - knee;
  for (let i = 0; i < points; i++) {
    const u = (i / (points - 1)) * 4 - 2;
    const a = Math.abs(u);
    const y = a <= knee ? a : knee + room * Math.tanh((a - knee) / room);
    curve[i] = Math.sign(u) * y;
  }
  return curve;
}

/** Symmetric saturating curve for grit/crunch (drive ≥ 1). */
export function makeDriveCurve(drive: number, points = 1024): Float32Array {
  const curve = new Float32Array(points);
  const d = Math.max(0.1, drive);
  const norm = Math.tanh(d);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(d * x) / norm;
  }
  return curve;
}

/**
 * Applause texture (mono): many people clapping = dense random claps. Each clap is a
 * 4–14 ms burst of noise through a two-pole resonator (hand cupping sets its colour,
 * 700 Hz–2.6 kHz), Poisson-distributed at `density` claps per second. Loops cleanly
 * (claps near the end wrap around). Peak-normalised to 0.95.
 */
export function makeApplause(sampleRate: number, seconds: number, density: number, seed = 4242): Float32Array {
  const len = Math.max(1, Math.floor(seconds * sampleRate));
  const out = new Float32Array(len);
  const rnd = makeLcg(seed);
  const u = (): number => (rnd() + 1) / 2; // 0..1
  const total = Math.max(1, Math.round(seconds * density));
  for (let c = 0; c < total; c++) {
    const start = Math.floor(u() * len);
    const dur = Math.floor((0.004 + u() * 0.01) * sampleRate);
    const f = 700 + u() * 1900;
    const q = 2 + u() * 5;
    // Two-pole resonator (RBJ bandpass, constant skirt gain).
    const w0 = (2 * Math.PI * f) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const a1 = (-2 * Math.cos(w0)) / a0;
    const a2 = (1 - alpha) / a0;
    const amp = 0.4 + u() * 0.6;
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0;
    const ring = dur + Math.floor(0.012 * sampleRate);
    for (let i = 0; i < ring; i++) {
      const env = i < dur ? Math.exp((-5 * i) / dur) : 0;
      const x = rnd() * env;
      const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      const idx = (start + i) % len;
      out[idx]! += y * amp;
    }
  }
  normalise(out, 0.95);
  return out;
}

/**
 * Fourier coefficients (imag = sine terms) for a pulse wave of the given duty
 * cycle — the classic chiptune timbre (0.5 = square, 0.125 = thin & nasal).
 */
export function pulseCoefficients(duty: number, harmonics = 48): { real: Float32Array; imag: Float32Array } {
  const d = Math.min(0.95, Math.max(0.05, duty));
  const real = new Float32Array(harmonics + 1);
  const imag = new Float32Array(harmonics + 1);
  for (let n = 1; n <= harmonics; n++) {
    // Pulse of width d: a_n = (2/(nπ)) sin(nπd) (cos terms, shifted); a sine/cos mix is fine.
    real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * d);
  }
  return { real, imag };
}

/**
 * Tonewheel-organ spectrum played at HALF the note frequency so the 16' drawbar is
 * harmonic 1: 16' · 8' · 5⅓' · 4' · 2⅔' · 2' → harmonics 1 · 2 · 3 · 4 · 6 · 8.
 * `drawbars` are 0..8 like the real thing.
 */
export function organCoefficients(drawbars: readonly number[] = [6, 8, 4, 6, 3, 4]): { real: Float32Array; imag: Float32Array } {
  const map = [1, 2, 3, 4, 6, 8];
  const real = new Float32Array(9);
  const imag = new Float32Array(9);
  for (let i = 0; i < map.length; i++) imag[map[i]!] = (drawbars[i] ?? 0) / 8;
  return { real, imag };
}
