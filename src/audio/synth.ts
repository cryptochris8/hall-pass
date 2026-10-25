// ─────────────────────────────────────────────────────────────────────────────
// Web Audio synth toolkit: node helpers, envelopes and per-context caches of noise
// buffers / shaper curves / reverb IR / applause texture / custom waves. Works with
// any BaseAudioContext so the offline QA harness renders exactly what the game plays.
// Adapted from TRASH PANDA TROUBLE's audio/synth.ts (via ATHLETE MAYHEM; the reverb is a hallway here).
// ─────────────────────────────────────────────────────────────────────────────
import { makeApplause, makeDriveCurve, makeNoise, makeReverbIR, makeSoftClipCurve, organCoefficients, pulseCoefficients, type NoiseKind } from './noise';

export type Ctx = BaseAudioContext;

/** Smallest value we ramp to instead of 0 (exponential ramps can't reach 0). */
export const SILENT = 0.0001;

interface CtxCache {
  noise: Partial<Record<NoiseKind, AudioBuffer>>;
  drive: Map<number, Float32Array<ArrayBuffer>>;
  waves: Map<string, PeriodicWave>;
  clip?: Float32Array<ArrayBuffer>;
  ir?: AudioBuffer;
  silent?: AudioBuffer;
  applause?: AudioBuffer;
}
const caches = new WeakMap<Ctx, CtxCache>();

function cache(ctx: Ctx): CtxCache {
  let c = caches.get(ctx);
  if (!c) {
    c = { noise: {}, drive: new Map(), waves: new Map() };
    caches.set(ctx, c);
  }
  return c;
}

/** Copy pure Float32 data into a fresh ArrayBuffer-backed array (WaveShaper/AudioBuffer typing). */
function own(data: Float32Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(new ArrayBuffer(data.length * 4));
  out.set(data);
  return out;
}

export function monoBuffer(ctx: Ctx, data: Float32Array): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.max(1, data.length), ctx.sampleRate);
  buf.copyToChannel(own(data), 0);
  return buf;
}

/** 2 s of looping noise (cached per context). */
export function noiseBuffer(ctx: Ctx, kind: NoiseKind): AudioBuffer {
  const c = cache(ctx);
  let b = c.noise[kind];
  if (!b) {
    b = monoBuffer(ctx, makeNoise(kind, Math.floor(ctx.sampleRate * 2), kind === 'white' ? 11 : kind === 'pink' ? 22 : 33));
    c.noise[kind] = b;
  }
  return b;
}

/** 4 s looping applause texture (cached per context). */
export function applauseBuffer(ctx: Ctx): AudioBuffer {
  const c = cache(ctx);
  if (!c.applause) c.applause = monoBuffer(ctx, makeApplause(ctx.sampleRate, 4, 260));
  return c.applause;
}

export function driveCurve(ctx: Ctx, drive: number): Float32Array<ArrayBuffer> {
  const c = cache(ctx);
  const key = Math.round(drive * 10);
  let curve = c.drive.get(key);
  if (!curve) {
    curve = own(makeDriveCurve(key / 10));
    c.drive.set(key, curve);
  }
  return curve;
}

export function softClipCurve(ctx: Ctx): Float32Array<ArrayBuffer> {
  const c = cache(ctx);
  if (!c.clip) c.clip = own(makeSoftClipCurve());
  return c.clip;
}

/** School hallway reverb: tiled corridor, ~1.3 s T60, early reflections off lockers and terrazzo. */
export function reverbBuffer(ctx: Ctx): AudioBuffer {
  const c = cache(ctx);
  if (!c.ir) {
    const [l, r] = makeReverbIR(ctx.sampleRate, 1.5, 1.3, 77, 0.012);
    const buf = ctx.createBuffer(2, l.length, ctx.sampleRate);
    buf.copyToChannel(own(l), 0);
    buf.copyToChannel(own(r), 1);
    c.ir = buf;
  }
  return c.ir;
}

export function silentBuffer(ctx: Ctx): AudioBuffer {
  const c = cache(ctx);
  if (!c.silent) c.silent = ctx.createBuffer(1, 1, ctx.sampleRate);
  return c.silent;
}

/** Chiptune pulse wave of the given duty (cached). */
export function pulseWave(ctx: Ctx, duty: number): PeriodicWave {
  const c = cache(ctx);
  const key = 'p' + Math.round(duty * 100);
  let w = c.waves.get(key);
  if (!w) {
    const { real, imag } = pulseCoefficients(Math.round(duty * 100) / 100);
    w = ctx.createPeriodicWave(own(real), own(imag));
    c.waves.set(key, w);
  }
  return w;
}

/** Tonewheel organ wave (play at HALF the note frequency — see organCoefficients). */
export function organWave(ctx: Ctx, variant: 'full' | 'mellow' = 'full'): PeriodicWave {
  const c = cache(ctx);
  const key = 'o' + variant;
  let w = c.waves.get(key);
  if (!w) {
    const { real, imag } = organCoefficients(variant === 'full' ? [6, 8, 5, 7, 4, 5] : [4, 8, 2, 4, 0, 1]);
    w = ctx.createPeriodicWave(own(real), own(imag));
    c.waves.set(key, w);
  }
  return w;
}

// ── Node helpers ────────────────────────────────────────────────────────────

export function gainNode(ctx: Ctx, value: number, dest?: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  if (dest) g.connect(dest);
  return g;
}

export function filterNode(ctx: Ctx, type: BiquadFilterType, freq: number, q = 0.707, dest?: AudioNode, gainDb = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.min(ctx.sampleRate * 0.49, Math.max(10, freq));
  f.Q.value = q;
  f.gain.value = gainDb;
  if (dest) f.connect(dest);
  return f;
}

export function pannerNode(ctx: Ctx, pan: number, dest?: AudioNode): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
  if (dest) p.connect(dest);
  return p;
}

export function shaperNode(ctx: Ctx, drive: number, dest?: AudioNode): WaveShaperNode {
  const s = ctx.createWaveShaper();
  s.curve = driveCurve(ctx, drive);
  if (dest) s.connect(dest);
  return s;
}

/** Oscillator started at t and stopped at t + dur (an infinite dur runs until its graph is dropped). */
export function oscNode(ctx: Ctx, type: OscillatorType, freq: number, t: number, dur: number, dest?: AudioNode): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (dest) o.connect(dest);
  o.start(t);
  if (Number.isFinite(dur)) o.stop(t + Math.max(0.005, dur));
  return o;
}

/** Oscillator with a custom PeriodicWave. */
export function waveOsc(ctx: Ctx, wave: PeriodicWave, freq: number, t: number, dur: number, dest?: AudioNode): OscillatorNode {
  const o = ctx.createOscillator();
  o.setPeriodicWave(wave);
  o.frequency.value = freq;
  if (dest) o.connect(dest);
  o.start(t);
  o.stop(t + Math.max(0.005, dur));
  return o;
}

/**
 * Noise source started at a random offset of the cached loop. Always looping, so a
 * late random offset can never run off the end of the buffer and cut a sound short
 * (the wrap point of white/pink/brown noise is inaudible).
 */
export function noiseNode(ctx: Ctx, kind: NoiseKind, t: number, dur: number, dest?: AudioNode): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx, kind);
  s.loop = true;
  if (dest) s.connect(dest);
  s.start(t, Math.random() * 1.5);
  if (Number.isFinite(dur)) s.stop(t + Math.max(0.005, dur));
  return s;
}

// ── Envelopes ───────────────────────────────────────────────────────────────

/**
 * Percussive envelope: 0 → peak over `attack`, then exponential decay with time
 * constant `tc` (≈ −60 dB after 6.9·tc). Returns the time the sound is inaudible.
 */
export function perc(param: AudioParam, t: number, peak: number, attack: number, tc: number): number {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, tc);
  return t + attack + tc * 7;
}

/** Attack / hold / release envelope (linear). Returns the end time. */
export function ahr(param: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): number {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setValueAtTime(peak, t + attack + hold);
  param.linearRampToValueAtTime(0, t + attack + hold + release);
  return t + attack + hold + release;
}

/** Exponential glide of a frequency param from a → b over dur (values must be > 0). */
export function glide(param: AudioParam, t: number, from: number, to: number, dur: number): void {
  param.setValueAtTime(Math.max(1, from), t);
  param.exponentialRampToValueAtTime(Math.max(1, to), t + Math.max(0.001, dur));
}

/** Smoothly move a param toward a value (safe to call every frame). */
export function smoothSet(param: AudioParam, value: number, now: number, tc = 0.05): void {
  param.cancelScheduledValues(now);
  param.setTargetAtTime(value, now, tc);
}

/** Hold an AudioParam's current trajectory at time t (cancelAndHoldAtTime where supported). */
export function holdAt(param: AudioParam, t: number): void {
  const p = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
  if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(t);
  else {
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
  }
}

/** Simple enveloped oscillator "ping" — the workhorse of chimes and blips. */
export function ping(
  ctx: Ctx,
  dest: AudioNode,
  t: number,
  freq: number,
  opts: { type?: OscillatorType; peak?: number; attack?: number; tc?: number; detune?: number } = {},
): number {
  const g = gainNode(ctx, 0, dest);
  const tc = opts.tc ?? 0.12;
  const end = perc(g.gain, t, opts.peak ?? 0.5, opts.attack ?? 0.003, tc);
  const o = oscNode(ctx, opts.type ?? 'sine', freq, t, end - t + 0.02, g);
  if (opts.detune) o.detune.value = opts.detune;
  return end;
}

/** Filtered noise burst — scrapes, whooshes, clicks, crunches. */
export function noiseBurst(
  ctx: Ctx,
  dest: AudioNode,
  t: number,
  opts: {
    kind?: NoiseKind;
    type?: BiquadFilterType;
    freq?: number;
    q?: number;
    peak?: number;
    attack?: number;
    tc?: number;
  } = {},
): { end: number; filter: BiquadFilterNode; gain: GainNode } {
  const g = gainNode(ctx, 0, dest);
  const f = filterNode(ctx, opts.type ?? 'bandpass', opts.freq ?? 2000, opts.q ?? 1, g);
  const end = perc(g.gain, t, opts.peak ?? 0.5, opts.attack ?? 0.002, opts.tc ?? 0.04);
  noiseNode(ctx, opts.kind ?? 'white', t, end - t + 0.02, f);
  return { end, filter: f, gain: g };
}

/** Low "thump": a sine that drops in pitch — kicks, thuds, impacts. */
export function thump(ctx: Ctx, dest: AudioNode, t: number, from: number, to: number, dur: number, peak: number): number {
  const g = gainNode(ctx, 0, dest);
  const end = perc(g.gain, t, peak, 0.002, dur / 3);
  const o = oscNode(ctx, 'sine', from, t, end - t + 0.02, g);
  glide(o.frequency, t, from, to, dur);
  return end;
}

/**
 * Modal resonator bank: a set of decaying sine partials (freq ratio, amplitude,
 * decay time constant) — rims, posts, glass, wood. Inharmonic ratios = metal.
 */
export function modal(ctx: Ctx, dest: AudioNode, t: number, base: number, modes: ReadonlyArray<readonly [number, number, number]>, peak: number): number {
  let end = t;
  for (const [ratio, amp, tc] of modes) {
    const f = base * ratio;
    if (f > ctx.sampleRate * 0.45) continue;
    end = Math.max(end, ping(ctx, dest, t, f, { peak: peak * amp, attack: 0.0008, tc }));
  }
  return end;
}
