// ─────────────────────────────────────────────────────────────────────────────
// Sound effects (docs/GDD.md §14). Each recipe schedules Web Audio nodes into `out`
// at time t and returns roughly when it ends. Everything is synthesized: squeaky
// sneakers, locker clangs, the PA chime, the school bell, the vending machine, the
// hall monitor's whistle, a record scratch for BUSTED, a sad trombone for DETENTION,
// and babble voices (formant blips — words you can't quite make out, with captions
// on screen). Loudness, variation, voice limits, ducking and routing per effect live
// in SFX_META.
// Helpers and playSfx copied from ATHLETE MAYHEM's sfx.ts (structure from TRASH
// PANDA TROUBLE); every recipe here is new.
// ─────────────────────────────────────────────────────────────────────────────
import { bellNote, brassChord, brassNote, chipNote, padChord, timpRoll } from './instruments';
import type { Priority, VoiceRule } from './limits';
import {
  ahr,
  type Ctx,
  filterNode,
  gainNode,
  glide,
  modal,
  noiseBurst,
  noiseNode,
  oscNode,
  pannerNode,
  perc,
  ping,
  pulseWave,
  shaperNode,
  thump,
  waveOsc,
} from './synth';
import { midiToFreq } from './theory';
import type { SfxName } from './types';

export interface SfxParams {
  /** Pitch multiplier (already includes random variation and slow-mo). */
  pitch: number;
  /** 0..1 hit strength / quality (1 for non-quality sounds). */
  intensity: number;
}

export type SfxRecipe = (ctx: Ctx, out: AudioNode, t: number, o: SfxParams) => number;

export interface DuckSpec {
  /** Music duck depth 0..1. */
  music: number;
  /** Duck depth for minor (duckable) SFX. */
  minor: number;
  /** Rough length of the duck (s). */
  seconds: number;
}

export interface SfxMeta extends VoiceRule {
  /** Output gain multiplier. */
  level: number;
  /** ± random pitch variation (fraction). 0 for anything melodic. */
  jitter: number;
  /** Send level into the school PA slap-back echo (0 = dry). */
  echo: number;
  /** volume = hit strength (see header). */
  quality: boolean;
  /** Minor sounds are ducked under big stingers. */
  minor: boolean;
  /** Ducks the music (and minor SFX) when it plays. */
  duck?: DuckSpec;
}

// ── Building blocks (copied from ATHLETE MAYHEM) ─────────────────────────────────────────────────────────

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Enveloped filtered oscillator note (blips, beeps, buzzers). */
function tone(
  ctx: Ctx,
  out: AudioNode,
  t: number,
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; peak?: number; cutoff?: number; q?: number; attack?: number; release?: number; detune?: number } = {},
): { end: number; osc: OscillatorNode; filter: BiquadFilterNode } {
  const g = gainNode(ctx, 0, out);
  const f = filterNode(ctx, 'lowpass', opts.cutoff ?? 4000, opts.q ?? 0.8, g);
  const attack = opts.attack ?? 0.004;
  const end = ahr(g.gain, t, opts.peak ?? 0.4, attack, Math.max(0, dur - attack), opts.release ?? 0.05);
  const osc = oscNode(ctx, opts.type ?? 'square', freq, t, end - t + 0.02, f);
  if (opts.detune) osc.detune.value = opts.detune;
  return { end, osc, filter: f };
}

/** Chiptune pulse blip. */
function blip(ctx: Ctx, out: AudioNode, t: number, freq: number, peak: number, tc: number, duty = 0.25): number {
  const g = gainNode(ctx, 0, filterNode(ctx, 'lowpass', 6000, 0.7, out));
  const end = perc(g.gain, t, peak, 0.002, tc);
  waveOsc(ctx, pulseWave(ctx, duty), freq, t, end - t + 0.02, g);
  return end;
}

/** Band-passed noise sweep (whooshes). Optional stereo pan sweep. */
function whoosh(ctx: Ctx, out: AudioNode, t: number, f0: number, f1: number, f2: number, dur: number, peak: number, q = 1.4, pan?: readonly [number, number]): number {
  let dest: AudioNode = out;
  if (pan) {
    const p = pannerNode(ctx, pan[0], out);
    p.pan.setValueAtTime(pan[0], t);
    p.pan.linearRampToValueAtTime(pan[1], t + dur);
    dest = p;
  }
  const g = gainNode(ctx, 0, dest);
  const f = filterNode(ctx, 'bandpass', f0, q, g);
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.45);
  f.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + dur * 0.4);
  g.gain.linearRampToValueAtTime(0, t + dur);
  noiseNode(ctx, 'pink', t, dur + 0.02, f);
  return t + dur;
}

/** Scattered high pings (sparkle / shards). */
function tinkle(ctx: Ctx, out: AudioNode, t: number, count: number, spread: number, peak: number, lo = 2600, hi = 6200): number {
  let end = t;
  for (let i = 0; i < count; i++) {
    const ti = t + Math.random() * spread;
    const p = pannerNode(ctx, Math.random() * 1.4 - 0.7, out);
    end = Math.max(end, ping(ctx, p, ti, lo + Math.random() * (hi - lo), { peak: peak * (0.5 + Math.random() * 0.5), tc: 0.02 + Math.random() * 0.03 }));
  }
  return end;
}

/** Crinkly net / paper rustle: pink noise through a moving bandpass with a fluttering AM. */
function rustle(ctx: Ctx, out: AudioNode, t: number, dur: number, peak: number, freq: number, flutter = 28): number {
  const env = gainNode(ctx, 0, out);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + Math.min(0.04, dur * 0.2));
  env.gain.setTargetAtTime(0, t + dur * 0.3, dur * 0.25);
  const am = gainNode(ctx, 0.55, env);
  const lfo = oscNode(ctx, 'square', flutter + Math.random() * 20, t, dur + 0.02);
  const la = gainNode(ctx, 0.45);
  lfo.connect(la);
  la.connect(am.gain);
  const bp = filterNode(ctx, 'bandpass', freq, 0.9, am);
  bp.frequency.setValueAtTime(freq * rand(0.85, 1), t);
  bp.frequency.linearRampToValueAtTime(freq * rand(0.6, 0.8), t + dur);
  noiseNode(ctx, 'pink', t, dur + 0.02, bp);
  return t + dur;
}

/** Sneaker squeak: a sine with a fast rubbery FM wobble gliding between two pitches. */
function squeak(ctx: Ctx, out: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number): number {
  const g = gainNode(ctx, 0, filterNode(ctx, 'bandpass', (f0 + f1) / 2, 1.2, out));
  ahr(g.gain, t, peak, 0.008, dur * 0.7, dur * 0.3);
  const o = oscNode(ctx, 'triangle', f0, t, dur + 0.02, g);
  o.frequency.setValueAtTime(f0, t);
  o.frequency.linearRampToValueAtTime(f1, t + dur);
  const lfo = oscNode(ctx, 'square', 32, t, dur);
  const lg = gainNode(ctx, f0 * 0.06);
  lfo.connect(lg);
  lg.connect(o.frequency);
  return t + dur;
}

/** Cartoon slide whistle from f0 to f1. */
function slideWhistle(ctx: Ctx, out: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number): number {
  const g = gainNode(ctx, 0, out);
  ahr(g.gain, t, peak, 0.02, Math.max(0, dur - 0.08), 0.06);
  const o = oscNode(ctx, 'sine', f0, t, dur + 0.02, g);
  glide(o.frequency, t, f0, f1, dur);
  const lfo = oscNode(ctx, 'sine', 6, t, dur);
  const lg = gainNode(ctx, 18);
  lfo.connect(lg);
  lg.connect(o.detune);
  noiseBurst(ctx, out, t, { freq: 2400, q: 1, peak: peak * 0.1, attack: 0.02, tc: dur / 3 });
  return t + dur;
}

/** Referee pea whistle: ~3 kHz tone rattled by the pea (fast FM + AM) plus breath. */
function peaWhistle(ctx: Ctx, out: AudioNode, t: number, dur: number, peak: number, pitch: number): number {
  const f = 2950 * pitch;
  const g = gainNode(ctx, 0, out);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.012);
  g.gain.setValueAtTime(peak * 0.92, t + dur - 0.03);
  g.gain.linearRampToValueAtTime(0, t + dur);
  const am = gainNode(ctx, 0.75, g);
  const o = oscNode(ctx, 'sine', f, t, dur + 0.02, am);
  const o2 = oscNode(ctx, 'sine', f * 2, t, dur + 0.02, gainNode(ctx, 0.12, am));
  const pea = oscNode(ctx, 'triangle', rand(34, 42), t, dur);
  const fm = gainNode(ctx, f * 0.075);
  pea.connect(fm);
  fm.connect(o.frequency);
  fm.connect(o2.frequency);
  const amd = gainNode(ctx, 0.4);
  pea.connect(amd);
  amd.connect(am.gain);
  // A small chirp up at the start.
  o.frequency.setValueAtTime(f * 0.93, t);
  o.frequency.linearRampToValueAtTime(f, t + 0.03);
  noiseNode(ctx, 'white', t, dur, filterNode(ctx, 'bandpass', f, 3, gainNode(ctx, 0.35, g)));
  return t + dur;
}

/** Cartoon spring "boing": sine gliding up with a wide vibrato that settles. */
function spring(ctx: Ctx, out: AudioNode, t: number, f0: number, dur: number, peak: number): number {
  const g = gainNode(ctx, 0, out);
  const end = perc(g.gain, t, peak, 0.004, dur / 4);
  const o = oscNode(ctx, 'sine', f0, t, end - t, g);
  o.frequency.setValueAtTime(f0 * 0.7, t);
  o.frequency.exponentialRampToValueAtTime(f0 * 1.6, t + dur * 0.6);
  const o2 = oscNode(ctx, 'triangle', f0 * 2, t, end - t, gainNode(ctx, 0.25, g));
  o2.frequency.setValueAtTime(f0 * 1.4, t);
  o2.frequency.exponentialRampToValueAtTime(f0 * 3.2, t + dur * 0.6);
  const lfo = oscNode(ctx, 'sine', 13, t, end - t);
  const depth = gainNode(ctx, 0);
  depth.gain.setValueAtTime(320, t);
  depth.gain.setTargetAtTime(0, t, dur / 3);
  lfo.connect(depth);
  depth.connect(o.detune);
  depth.connect(o2.detune);
  return end;
}

/** Formant voice blip (the athlete's "hup!"). */
function voiceBlip(ctx: Ctx, out: AudioNode, t: number, dur: number, f0: number, f0End: number, formants: readonly [number, number], formantsEnd: readonly [number, number], peak: number): number {
  const amp = gainNode(ctx, 0, filterNode(ctx, 'lowpass', 3000, 0.7, out));
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.012);
  amp.gain.setTargetAtTime(peak * 0.6, t + 0.02, dur * 0.3);
  amp.gain.linearRampToValueAtTime(0, t + dur);
  const f1 = filterNode(ctx, 'bandpass', formants[0], 5, gainNode(ctx, 1.6, amp));
  const f2 = filterNode(ctx, 'bandpass', formants[1], 7, gainNode(ctx, 1.1, amp));
  f1.frequency.linearRampToValueAtTime(formantsEnd[0], t + dur);
  f2.frequency.linearRampToValueAtTime(formantsEnd[1], t + dur);
  const src = oscNode(ctx, 'sawtooth', f0, t, dur + 0.02);
  src.frequency.setValueAtTime(f0, t);
  src.frequency.exponentialRampToValueAtTime(Math.max(40, f0End), t + dur);
  src.connect(f1);
  src.connect(f2);
  src.connect(gainNode(ctx, 0.08, amp));
  // Breathy onset ("h").
  noiseBurst(ctx, amp, t, { kind: 'pink', type: 'bandpass', freq: formants[1], q: 1.2, peak: 0.5, tc: 0.02 });
  return t + dur;
}

/** Brass "ba-da-BAAA" stinger: pickups into a held chord (shared by touchdown / records). */
function brassSting(ctx: Ctx, out: AudioNode, t: number, pickups: readonly number[], gap: number, chord: readonly number[], hold: number, peak: number): number {
  pickups.forEach((m, i) => brassNote(ctx, out, t + i * gap, m, peak * 0.8, gap * 0.8, true));
  const tc = t + pickups.length * gap;
  return brassChord(ctx, out, tc, chord, peak * 1.3, hold, false);
}

// ── School building blocks ──────────────────────────────────────────────────

/** Sheet-metal locker partials (inharmonic): ratio, amplitude, decay. */
const LOCKER_MODES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0.09],
  [1.58, 0.7, 0.07],
  [2.31, 0.5, 0.05],
  [3.17, 0.35, 0.04],
  [4.4, 0.2, 0.03],
];

/** A locker door: a metal clunk, the latch click and a short rattle. */
function lockerDoor(ctx: Ctx, out: AudioNode, t: number, pitch: number, peak: number): number {
  thump(ctx, out, t, 150 * pitch, 60, 0.18, peak * 0.9);
  const end = modal(ctx, filterNode(ctx, 'lowpass', 4200, 0.7, out), t, 240 * pitch, LOCKER_MODES, peak * 0.35);
  noiseBurst(ctx, out, t + 0.01, { type: 'highpass', freq: 3200, q: 0.8, peak: peak * 0.25, tc: 0.006 });
  noiseBurst(ctx, out, t + 0.03, { type: 'bandpass', freq: 1700 * pitch, q: 5, peak: peak * 0.12, tc: 0.08 });
  return Math.max(end, t + 0.3);
}

/** A hinge creak: a slow, scratchy glide. */
function creak(ctx: Ctx, out: AudioNode, t: number, f0: number, f1: number, dur: number, peak: number): number {
  const g = gainNode(ctx, 0, filterNode(ctx, 'bandpass', (f0 + f1) / 2, 4, out));
  ahr(g.gain, t, peak, 0.03, dur * 0.6, dur * 0.3);
  const o = oscNode(ctx, 'sawtooth', f0, t, dur + 0.05, g);
  glide(o.frequency, t, f0, f1, dur);
  const lfo = oscNode(ctx, 'square', 46, t, dur);
  const lg = gainNode(ctx, f0 * 0.12);
  lfo.connect(lg);
  lg.connect(o.frequency);
  return t + dur;
}

/** Electric school bell: a hammer chattering on a metal gong (~22 strikes / s). */
function schoolBell(ctx: Ctx, out: AudioNode, t: number, dur: number, peak: number, pitch = 1): number {
  const env = gainNode(ctx, 0, filterNode(ctx, 'highpass', 300, 0.7, out));
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(peak, t + 0.01);
  env.gain.setValueAtTime(peak, t + dur);
  env.gain.setTargetAtTime(0, t + dur, 0.25);
  const chatter = gainNode(ctx, 0.5, env);
  const lfo = oscNode(ctx, 'square', 22, t, dur + 1.5);
  const depth = gainNode(ctx, 0.5);
  lfo.connect(depth);
  depth.connect(chatter.gain);
  const base = 1180 * pitch;
  for (const [r, a] of [
    [1, 0.5],
    [2.76, 0.32],
    [5.4, 0.18],
    [8.93, 0.08],
  ] as const) {
    oscNode(ctx, 'sine', base * r, t, dur + 1.5, gainNode(ctx, a, chatter));
  }
  noiseNode(ctx, 'white', t, dur, filterNode(ctx, 'bandpass', 4200, 2, gainNode(ctx, 0.05, chatter)));
  return t + dur + 1.2;
}

/** A small coin / change ping. */
function coin(ctx: Ctx, out: AudioNode, t: number, freq: number, peak: number): number {
  return modal(ctx, out, t, freq, [
    [1, 1, 0.06],
    [2.4, 0.5, 0.04],
    [3.9, 0.3, 0.03],
  ], peak);
}

// ── Babble voices ───────────────────────────────────────────────────────────

/** Vowel formants (F1, F2) for an adult voice. */
const VOWEL: Readonly<Record<string, readonly [number, number]>> = {
  a: [780, 1240],
  e: [520, 1850],
  i: [320, 2250],
  o: [520, 900],
  u: [360, 820],
  m: [280, 1000], // closed mouth (the "hm")
};

/** A syllable: vowel, then the vowel it glides to, relative length, pitch contour (start × end ×). */
type Syll = readonly [string, string, number, number, number];

/**
 * Babble: a sequence of formant blips. `pitch` is the speaker's voice (1 ≈ 130 Hz, a low adult voice; teens and
 * Preston go higher). Formants rise a little with the voice so higher voices sound smaller, not chipmunky.
 */
function babble(ctx: Ctx, out: AudioNode, t: number, pitch: number, sylls: readonly Syll[], peak: number, rate = 0.13): number {
  const f0 = 130 * pitch;
  const fk = Math.pow(pitch, 0.25);
  let ti = t;
  let end = t;
  for (const [v0, v1, len, p0, p1] of sylls) {
    const dur = rate * len;
    const a = VOWEL[v0]!;
    const b = VOWEL[v1]!;
    end = voiceBlip(ctx, out, ti, dur, f0 * p0, f0 * p1, [a[0] * fk, a[1] * fk], [b[0] * fk, b[1] * fk], peak);
    ti += dur * 1.08;
  }
  return end + 0.05;
}

/** Telephone-band filter for the PA voice. */
function paFilter(ctx: Ctx, out: AudioNode): AudioNode {
  return filterNode(ctx, 'highpass', 420, 0.8, filterNode(ctx, 'lowpass', 2800, 1.2, shaperNode(ctx, 1.4, out)));
}

// ── Recipes ────────────────────────────────────────────────────────────────

export const SFX: Record<SfxName, SfxRecipe> = {
  // ── UI / presentation ──
  uiMove: (ctx, out, t, o) => blip(ctx, out, t, 880 * o.pitch, 0.22, 0.025, 0.5),
  uiConfirm: (ctx, out, t, o) => {
    blip(ctx, out, t, 660 * o.pitch, 0.26, 0.03);
    return blip(ctx, out, t + 0.06, 990 * o.pitch, 0.28, 0.05);
  },
  uiBack: (ctx, out, t, o) => {
    blip(ctx, out, t, 660 * o.pitch, 0.24, 0.03);
    return blip(ctx, out, t + 0.06, 440 * o.pitch, 0.24, 0.05);
  },
  uiDenied: (ctx, out, t, o) => {
    tone(ctx, out, t, 140 * o.pitch, 0.09, { type: 'square', peak: 0.2, cutoff: 900 });
    return tone(ctx, out, t + 0.12, 130 * o.pitch, 0.14, { type: 'square', peak: 0.2, cutoff: 900 }).end;
  },
  flyover: (ctx, out, t) => {
    // Two low chords, Dm → B♭(add a tense ♭5), a timpani roll swelling into the second.
    padChord(ctx, out, t, [50, 53, 57, 62], 0.9, 1.1, 0.25);
    timpRoll(ctx, out, t + 0.5, 38, 0.6, 0.6);
    const end = padChord(ctx, out, t + 1.1, [46, 50, 52, 58], 1, 1.6, 0.08);
    brassChord(ctx, out, t + 1.1, [46, 52, 58], 0.5, 0.5, true);
    return end;
  },
  stamp: (ctx, out, t) => {
    thump(ctx, out, t, 140, 45, 0.18, 0.9);
    noiseBurst(ctx, out, t, { kind: 'pink', type: 'lowpass', freq: 1400, peak: 0.6, tc: 0.03 });
    return noiseBurst(ctx, out, t + 0.005, { type: 'highpass', freq: 2500, peak: 0.25, tc: 0.012 }).end + 0.1;
  },
  gradeA: (ctx, out, t) => {
    let end = t;
    [84, 88, 91, 96].forEach((m, i) => (end = bellNote(ctx, out, t + i * 0.07, midiToFreq(m), 0.32, 0.35, 2, 1.4)));
    tinkle(ctx, out, t + 0.25, 6, 0.4, 0.08);
    return end;
  },
  gradeLow: (ctx, out, t) => {
    chipNote(ctx, out, t, 79, 0.5, 0.12, 0.5);
    return chipNote(ctx, out, t + 0.16, 76, 0.45, 0.22, 0.5);
  },
  newBest: (ctx, out, t) => {
    let end = t;
    [72, 76, 79, 84, 88].forEach((m, i) => (end = chipNote(ctx, out, t + i * 0.06, m, 0.5, 0.08, 0.25)));
    return Math.max(end, tinkle(ctx, out, t + 0.2, 10, 0.5, 0.1));
  },

  // ── the student ──
  step: (ctx, out, t, o) => {
    thump(ctx, out, t, 150 * o.pitch, 80, 0.05, 0.35 * (0.5 + 0.5 * o.intensity));
    return noiseBurst(ctx, out, t, { kind: 'pink', type: 'lowpass', freq: 700 + 900 * o.intensity, peak: 0.3, tc: 0.018 }).end;
  },
  squeak: (ctx, out, t, o) => {
    const f = rand(1700, 2300) * o.pitch;
    noiseBurst(ctx, out, t, { kind: 'pink', type: 'lowpass', freq: 1200, peak: 0.25, tc: 0.02 });
    return squeak(ctx, out, t + 0.01, f, f * rand(1.15, 1.35), 0.07 + 0.05 * o.intensity, 0.22 * (0.6 + 0.4 * o.intensity));
  },
  lockerIn: (ctx, out, t, o) => {
    creak(ctx, out, t, 380 * o.pitch, 300 * o.pitch, 0.18, 0.06);
    return lockerDoor(ctx, out, t + 0.16, o.pitch, 0.7);
  },
  lockerOut: (ctx, out, t, o) => {
    lockerDoor(ctx, out, t, o.pitch * 1.06, 0.45);
    return creak(ctx, out, t + 0.02, 300 * o.pitch, 420 * o.pitch, 0.22, 0.06);
  },
  grab: (ctx, out, t, o) => {
    rustle(ctx, out, t, 0.08, 0.25, 2600);
    return blip(ctx, out, t + 0.04, 1180 * o.pitch, 0.18, 0.03, 0.5);
  },
  item: (ctx, out, t) => {
    // "Got it": a quick rising chip arpeggio and a glock ping.
    let end = t;
    [72, 76, 79, 84].forEach((m, i) => (end = chipNote(ctx, out, t + i * 0.055, m, 0.55, 0.07, 0.25)));
    return Math.max(end, bellNote(ctx, out, t + 0.22, midiToFreq(96), 0.3, 0.3, 2, 1.4));
  },
  snack: (ctx, out, t, o) => {
    rustle(ctx, out, t, 0.14, 0.32, 3200, 40);
    blip(ctx, out, t + 0.05, 1320 * o.pitch, 0.2, 0.03, 0.5);
    return blip(ctx, out, t + 0.1, 1760 * o.pitch, 0.22, 0.05, 0.5);
  },
  throw: (ctx, out, t, o) => whoosh(ctx, out, t, 900 * o.pitch, 2600 * o.pitch, 1400 * o.pitch, 0.22, 0.75, 1.3),
  eraserLand: (ctx, out, t, o) => {
    thump(ctx, out, t, 260 * o.pitch, 120, 0.05, 0.5);
    noiseBurst(ctx, out, t, { kind: 'pink', type: 'bandpass', freq: 1500, q: 1.2, peak: 0.3, tc: 0.02 });
    thump(ctx, out, t + 0.12, 240 * o.pitch, 140, 0.04, 0.22);
    return thump(ctx, out, t + 0.2, 230 * o.pitch, 150, 0.03, 0.1);
  },

  // ── staff / detection ──
  curious: (ctx, out, t, o) => {
    const g = gainNode(ctx, 0, filterNode(ctx, 'lowpass', 3000, 0.7, out));
    const end = ahr(g.gain, t, 0.22, 0.01, 0.12, 0.08);
    const osc = waveOsc(ctx, pulseWave(ctx, 0.25), 520 * o.pitch, t, end - t + 0.02, g);
    glide(osc.frequency, t, 520 * o.pitch, 880 * o.pitch, 0.18);
    return end;
  },
  spotted: (ctx, out, t, o) => {
    brassChord(ctx, out, t, [62, 66, 69, 74].map((m) => m + Math.round(12 * Math.log2(o.pitch))), 0.8, 0.22, true);
    ping(ctx, out, t, 1760 * o.pitch, { type: 'square', peak: 0.12, tc: 0.08 });
    return t + 0.45;
  },
  whistle: (ctx, out, t, o) => {
    peaWhistle(ctx, out, t, 0.12, 0.45, o.pitch);
    return peaWhistle(ctx, out, t + 0.18, 0.42, 0.5, o.pitch);
  },
  lostThem: (ctx, out, t, o) => slideWhistle(ctx, out, t, 900 * o.pitch, 480 * o.pitch, 0.5, 0.18),
  busted: (ctx, out, t) => {
    // Record scratch: a fast noise glissando up then down, plus the needle thump.
    const g = gainNode(ctx, 0, out);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.01);
    g.gain.setValueAtTime(0.7, t + 0.22);
    g.gain.linearRampToValueAtTime(0, t + 0.32);
    const f = filterNode(ctx, 'bandpass', 600, 6, g);
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.09);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.3);
    noiseNode(ctx, 'white', t, 0.34, f);
    const o2 = oscNode(ctx, 'sawtooth', 180, t, 0.32, gainNode(ctx, 0.08, f));
    o2.frequency.setValueAtTime(140, t);
    o2.frequency.exponentialRampToValueAtTime(900, t + 0.09);
    o2.frequency.exponentialRampToValueAtTime(110, t + 0.3);
    thump(ctx, out, t + 0.3, 90, 40, 0.2, 0.6);
    return t + 0.55;
  },
  passFlash: (ctx, out, t) => {
    noiseBurst(ctx, out, t, { type: 'highpass', freq: 3000, peak: 0.35, attack: 0.004, tc: 0.03 });
    rustle(ctx, out, t, 0.1, 0.2, 3800, 50);
    return bellNote(ctx, out, t + 0.08, midiToFreq(88), 0.3, 0.35, 2, 1.4);
  },
  cameraAlert: (ctx, out, t, o) => {
    // Servo whine as the camera snaps round, then two beeps.
    const g = gainNode(ctx, 0, filterNode(ctx, 'bandpass', 900, 2, out));
    ahr(g.gain, t, 0.22, 0.02, 0.28, 0.06);
    const s = oscNode(ctx, 'sawtooth', 280 * o.pitch, t, 0.4, g);
    glide(s.frequency, t, 280 * o.pitch, 460 * o.pitch, 0.32);
    tone(ctx, out, t + 0.4, 1480, 0.08, { type: 'square', peak: 0.18, cutoff: 5000 });
    return tone(ctx, out, t + 0.56, 1480, 0.08, { type: 'square', peak: 0.18, cutoff: 5000 }).end;
  },
  found: (ctx, out, t, o) => {
    lockerDoor(ctx, out, t, o.pitch * 1.1, 0.8);
    return spring(ctx, out, t + 0.08, 330, 0.35, 0.22);
  },

  // ── school ──
  paChime: (ctx, out, t) => {
    // The classic two-tone "ding… dong" through the ceiling speakers.
    const pa = paFilter(ctx, out);
    bellNote(ctx, pa, t, midiToFreq(76), 0.55, 0.5, 1, 0.8);
    bellNote(ctx, pa, t + 0.42, midiToFreq(72), 0.55, 0.7, 1, 0.8);
    noiseNode(ctx, 'white', t, 1.4, filterNode(ctx, 'bandpass', 1800, 0.8, gainNode(ctx, 0.012, pa)));
    return t + 2.6; // the second tone rings on through the PA echo
  },
  bell: (ctx, out, t) => schoolBell(ctx, out, t, 1.6, 0.5),
  clockTick: (ctx, out, t) => {
    noiseBurst(ctx, out, t, { type: 'bandpass', freq: 3200, q: 4, peak: 0.45, tc: 0.006 });
    ping(ctx, out, t, 2600, { peak: 0.08, tc: 0.015 });
    noiseBurst(ctx, out, t + 0.5, { type: 'bandpass', freq: 2500, q: 4, peak: 0.38, tc: 0.006 });
    return ping(ctx, out, t + 0.5, 2000, { peak: 0.07, tc: 0.015 });
  },
  lunchBell: (ctx, out, t) => schoolBell(ctx, out, t, 0.7, 0.42, 1.12),
  vendWhir: (ctx, out, t) => {
    const g = gainNode(ctx, 0, filterNode(ctx, 'lowpass', 1400, 0.8, out));
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4, t + 0.15);
    g.gain.setValueAtTime(0.4, t + 0.9);
    g.gain.linearRampToValueAtTime(0, t + 1.2);
    const m = oscNode(ctx, 'sawtooth', 70, t, 1.25, g);
    glide(m.frequency, t, 55, 95, 0.4);
    noiseNode(ctx, 'pink', t, 1.2, filterNode(ctx, 'bandpass', 500, 2, gainNode(ctx, 0.4, g)));
    coin(ctx, out, t, 2400, 0.12);
    coin(ctx, out, t + 0.09, 2650, 0.1);
    return t + 1.25;
  },
  vendRattle: (ctx, out, t) => {
    // The spiral turning: a motor grind with clicks.
    const g = gainNode(ctx, 0, filterNode(ctx, 'lowpass', 1600, 0.8, out));
    ahr(g.gain, t, 0.32, 0.03, 0.35, 0.1);
    oscNode(ctx, 'sawtooth', 82, t, 0.5, g);
    let end = t + 0.5;
    for (let i = 0; i < 5; i++) end = Math.max(end, noiseBurst(ctx, out, t + 0.05 + i * 0.08, { type: 'bandpass', freq: 2200, q: 3, peak: 0.18, tc: 0.008 }).end);
    return end;
  },
  vendClunk: (ctx, out, t) => {
    thump(ctx, out, t, 120, 45, 0.25, 0.9);
    modal(ctx, out, t, 180, LOCKER_MODES, 0.18);
    return rustle(ctx, out, t + 0.12, 0.2, 0.25, 2800, 36);
  },
  buyCancel: (ctx, out, t) => {
    let end = t;
    for (let i = 0; i < 5; i++) end = Math.max(end, coin(ctx, out, t + i * 0.07 + rand(0, 0.02), rand(2100, 3200), 0.16));
    return end;
  },

  // ── endings ──
  success: (ctx, out, t) => {
    brassSting(ctx, out, t, [67, 72], 0.09, [60, 64, 67, 72], 0.9, 0.7);
    return schoolBell(ctx, out, t + 0.3, 1.0, 0.25);
  },
  detention: (ctx, out, t) => {
    // Sad trombone: wah, wah, wah, waaaah (with a wobbly last note).
    let end = t;
    const notes: ReadonlyArray<readonly [number, number]> = [
      [55, 0.32],
      [54, 0.32],
      [53, 0.32],
      [52, 1.1],
    ];
    let ti = t;
    for (const [m, d] of notes) {
      const amp = gainNode(ctx, 0, out);
      amp.gain.setValueAtTime(0, ti);
      amp.gain.linearRampToValueAtTime(0.42, ti + 0.05);
      amp.gain.setValueAtTime(0.38, ti + d - 0.06);
      amp.gain.linearRampToValueAtTime(0, ti + d);
      const wah = filterNode(ctx, 'lowpass', 500, 4, amp);
      wah.frequency.setValueAtTime(400, ti);
      wah.frequency.linearRampToValueAtTime(1500, ti + d * 0.35);
      wah.frequency.linearRampToValueAtTime(700, ti + d);
      const f = midiToFreq(m);
      const o1 = oscNode(ctx, 'sawtooth', f, ti, d + 0.05, gainNode(ctx, 0.5, wah));
      const o2 = oscNode(ctx, 'sawtooth', f, ti, d + 0.05, gainNode(ctx, 0.5, wah));
      o2.detune.value = 9;
      if (d > 0.5) {
        const lfo = oscNode(ctx, 'sine', 5.5, ti, d + 0.05);
        const vg = gainNode(ctx, 0);
        vg.gain.setValueAtTime(0, ti);
        vg.gain.linearRampToValueAtTime(45, ti + 0.4);
        lfo.connect(vg);
        vg.connect(o1.detune);
        vg.connect(o2.detune);
      }
      end = ti + d;
      ti += d + 0.04;
    }
    return end;
  },

  // ── babble voices ──
  vHey: (ctx, out, t, o) =>
    babble(ctx, out, t, o.pitch, [
      ['e', 'i', 1.6, 1.25, 1.5],
      ['i', 'i', 0.6, 1.45, 1.2],
    ], 0.55),
  vHm: (ctx, out, t, o) => babble(ctx, out, t, o.pitch, [['m', 'm', 2.2, 0.95, 1.25]], 0.42),
  vWhere: (ctx, out, t, o) =>
    babble(ctx, out, t, o.pitch, [
      ['u', 'e', 1, 1.15, 1.1],
      ['a', 'a', 0.8, 1.05, 1],
      ['u', 'i', 0.9, 1, 0.95],
      ['o', 'i', 1, 1.05, 1.15],
      ['i', 'i', 1.3, 1.2, 1.4],
    ], 0.5),
  vCarryOn: (ctx, out, t, o) =>
    babble(ctx, out, t, o.pitch, [
      ['o', 'o', 1.4, 1.2, 1.0],
      ['a', 'e', 0.8, 1.1, 1.05],
      ['i', 'i', 0.7, 1.05, 1],
      ['o', 'o', 1.4, 1, 0.85],
    ], 0.45),
  vTattle: (ctx, out, t, o) =>
    babble(
      ctx,
      out,
      t,
      o.pitch,
      [
        ['a', 'u', 0.8, 1.2, 1.25],
        ['o', 'o', 0.7, 1.25, 1.2],
        ['a', 'e', 0.7, 1.2, 1.3],
        ['i', 'i', 0.6, 1.3, 1.35],
        ['u', 'o', 0.7, 1.3, 1.25],
        ['a', 'a', 1.3, 1.4, 1.1],
      ],
      0.5,
      0.1,
    ),
  vNotYet: (ctx, out, t, o) =>
    babble(ctx, out, t, o.pitch, [
      ['o', 'o', 1.1, 1.1, 1.0],
      ['e', 'e', 1.1, 1.05, 1.15],
      ['o', 'o', 1.4, 1.1, 0.9],
    ], 0.45),
  vAnnounce: (ctx, out, t, o) => {
    const pa = paFilter(ctx, out);
    const sylls: Syll[] = [];
    const vowels = ['a', 'e', 'o', 'i', 'u', 'a', 'o', 'e', 'i', 'a', 'o'];
    for (let i = 0; i < vowels.length; i++) sylls.push([vowels[i]!, vowels[(i + 1) % vowels.length]!, i % 3 === 2 ? 1.4 : 0.9, 1.05 - (i % 4) * 0.03, i === vowels.length - 1 ? 0.85 : 1]);
    return babble(ctx, pa, t, o.pitch, sylls, 0.6, 0.12);
  },
};

// ── Metadata: loudness, variation, limits, routing, ducks ─────────────────

const rule = (cooldown: number, maxVoices: number, priority: Priority): VoiceRule => ({ cooldown, maxVoices, priority });
const M = (level: number, jitter: number, r: VoiceRule, extra: Partial<Pick<SfxMeta, 'echo' | 'quality' | 'minor' | 'duck'>> = {}): SfxMeta => ({
  level,
  jitter,
  echo: 0,
  quality: false,
  minor: false,
  ...r,
  ...extra,
});
const STING = rule(0.25, 1, 3);
const VOICE = rule(0.35, 2, 2);
const duck = (music: number, minor: number, seconds: number): DuckSpec => ({ music, minor, seconds });

/** Loudness & behaviour per effect. `echo` = send into the PA slap-back. */
export const SFX_META: Record<SfxName, SfxMeta> = {
  uiMove: M(0.6, 0, rule(0.03, 2, 1)),
  uiConfirm: M(0.7, 0, rule(0.04, 2, 2)),
  uiBack: M(0.7, 0, rule(0.04, 2, 2)),
  uiDenied: M(0.5, 0, rule(0.08, 1, 2)),
  flyover: M(0.8, 0, STING, { duck: duck(0.6, 0, 2.4) }),
  stamp: M(0.85, 0.03, rule(0.2, 1, 3)),
  gradeA: M(0.75, 0, STING),
  gradeLow: M(0.7, 0, STING),
  newBest: M(0.7, 0, STING, { duck: duck(0.3, 0, 1) }),
  step: M(0.5, 0.12, rule(0.08, 2, 0), { minor: true, quality: true }),
  squeak: M(0.55, 0.08, rule(0.09, 2, 0), { minor: true, quality: true }),
  lockerIn: M(0.85, 0.05, rule(0.2, 1, 2)),
  lockerOut: M(0.75, 0.05, rule(0.2, 1, 2)),
  grab: M(0.65, 0.05, rule(0.08, 2, 1)),
  item: M(0.8, 0, STING, { duck: duck(0.3, 0.2, 0.7) }),
  snack: M(0.75, 0, rule(0.1, 2, 2)),
  throw: M(0.65, 0.06, rule(0.1, 2, 1)),
  eraserLand: M(0.8, 0.08, rule(0.06, 3, 1), { quality: true }),
  curious: M(0.5, 0.03, rule(0.25, 2, 1)),
  spotted: M(0.75, 0, rule(0.5, 1, 3), { duck: duck(0.35, 0.2, 0.6) }),
  whistle: M(0.6, 0.02, rule(0.8, 1, 3), { echo: 0.25 }),
  lostThem: M(0.65, 0, rule(1, 1, 2)),
  busted: M(0.85, 0, STING, { duck: duck(0.7, 0.4, 1.4) }),
  passFlash: M(0.75, 0, STING),
  cameraAlert: M(0.7, 0, rule(1, 1, 2), { echo: 0.15 }),
  found: M(0.85, 0, STING),
  paChime: M(0.7, 0, STING, { echo: 0.6, duck: duck(0.45, 0.2, 3.2) }),
  bell: M(0.75, 0, STING, { echo: 0.3, duck: duck(0.4, 0, 2.2) }),
  clockTick: M(0.6, 0, rule(0.8, 1, 2)),
  lunchBell: M(0.7, 0, STING, { echo: 0.3, duck: duck(0.35, 0, 1.2) }),
  vendWhir: M(0.75, 0, rule(0.3, 1, 2)),
  vendRattle: M(0.7, 0.04, rule(0.4, 1, 2)),
  vendClunk: M(0.85, 0, STING),
  buyCancel: M(0.7, 0, STING),
  success: M(0.8, 0, STING, { echo: 0.15, duck: duck(0.6, 0.3, 2) }),
  detention: M(0.8, 0, STING, { duck: duck(0.75, 0.3, 2.5) }),
  vHey: M(0.8, 0.03, VOICE),
  vHm: M(0.7, 0.03, VOICE),
  vWhere: M(0.75, 0.02, VOICE),
  vCarryOn: M(0.75, 0.02, VOICE),
  vTattle: M(0.75, 0.02, VOICE),
  vNotYet: M(0.75, 0.02, VOICE),
  vAnnounce: M(0.75, 0, rule(1.5, 1, 2), { echo: 0.6 }),
};

export const SFX_NAMES = Object.keys(SFX) as SfxName[];

export interface PlaySfxOptions {
  pitch?: number;
  volume?: number;
  pan?: number;
  /** PA slap-back echo input (from the mixer). */
  echo?: AudioNode;
  /** Low-pass cutoff (Hz) to darken the sound (slow-motion). */
  darken?: number;
}

/** Sanitised gain / intensity for an effect from SfxOptions.volume. */
export function sfxGain(meta: Pick<SfxMeta, 'level' | 'quality'>, volume: number | undefined): { gain: number; intensity: number } {
  const v = Number.isFinite(volume) ? Math.max(0, Math.min(1.5, volume!)) : 1;
  // Quality sounds: a weak hit is still clearly audible, just thinner (the recipe reads intensity).
  if (meta.quality) return { gain: meta.level * (v <= 0 ? 0 : 0.45 + 0.55 * Math.min(1, v)), intensity: clamp01(v) };
  return { gain: meta.level * v, intensity: 1 };
}

/** Sanitised pitch multiplier (0.25..4). */
export function sfxPitch(pitch: number | undefined): number {
  return Number.isFinite(pitch) && pitch! > 0 ? Math.min(4, Math.max(0.25, pitch!)) : 1;
}

/**
 * Play an effect into `dest` at time t with volume/pan/pitch applied.
 * Returns the effect's approximate end time.
 */
export function playSfx(ctx: Ctx, dest: AudioNode, name: SfxName, t: number, opts: PlaySfxOptions = {}): number {
  const meta = SFX_META[name];
  const recipe = SFX[name];
  if (!meta || !recipe) return t;
  const { gain, intensity } = sfxGain(meta, opts.volume);
  if (gain <= 0.0005) return t;
  let node: AudioNode = dest;
  const pan = Number.isFinite(opts.pan) ? Math.max(-1, Math.min(1, opts.pan!)) : 0;
  if (Math.abs(pan) > 0.01) node = pannerNode(ctx, pan, node);
  if (opts.darken && opts.darken < 18000) node = filterNode(ctx, 'lowpass', opts.darken, 0.7, node);
  const g = gainNode(ctx, gain, node);
  if (opts.echo && meta.echo > 0) g.connect(gainNode(ctx, meta.echo * (meta.quality ? 0.4 + 0.6 * intensity : 1), opts.echo));
  const pitch = sfxPitch(opts.pitch) * (1 + (Math.random() * 2 - 1) * meta.jitter);
  return recipe(ctx, g, t, { pitch, intensity });
}
