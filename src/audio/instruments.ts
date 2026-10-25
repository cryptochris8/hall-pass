// ─────────────────────────────────────────────────────────────────────────────
// The arena band — retro-arcade sports-anthem instruments, all synthesized:
//   lead      two detuned saws + sub square, filter pluck, delayed vibrato (80s synth lead)
//   brass     detuned-saw brass section with a "blat" filter swell
//   organ     tonewheel stadium organ (drawbar PeriodicWave) with key click + leslie wobble
//   power     power chords through an overdriven "amp" bus (chugs or sustained)
//   bass      squelchy saw/square synth bass with a sine sub
//   arp       chiptune pulse arpeggio
//   pad       warm detuned-saw pad
//   epiano    FM electric piano (tine attack)
//   bell      FM bell / glockenspiel
//   drums     kick, snare, clap, hats, crash, toms, timpani
// A Band owns one music track's instrument buses (level + pan per instrument, a
// tempo-synced echo for lead/arp, the drive bus for power chords) and plays notes on
// them. The free note functions are shared with the SFX so stingers sound like the band.
// Structure adapted from TRASH PANDA TROUBLE's instruments.ts (Combo).
// Copied from ATHLETE MAYHEM (src/audio) for HALL PASS.
// ─────────────────────────────────────────────────────────────────────────────
import {
  type Ctx,
  filterNode,
  gainNode,
  holdAt,
  noiseBurst,
  noiseNode,
  organWave,
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


/** Instrument bus levels — the band's mix. Tuned with the offline QA meter. */
export const MIX = {
  lead: 0.2,
  brass: 0.15,
  organ: 0.12,
  power: 0.17,
  bass: 0.3,
  arp: 0.07,
  pad: 0.08,
  epiano: 0.22,
  bell: 0.16,
  kick: 0.5,
  snare: 0.34,
  clap: 0.26,
  hat: 0.1,
  crash: 0.12,
  tom: 0.34,
  timp: 0.45,
} as const;

// ── Melodic note functions (shared with SFX) ───────────────────────────────

export interface LeadOptions {
  /** Portamento from this MIDI note. */
  glideFrom?: number;
  /** 0..1 extra filter brightness. */
  bright?: number;
}

/** 80s synth lead: two detuned saws + a quiet sub square through a plucky lowpass, delayed vibrato. */
export function leadNote(ctx: Ctx, dest: AudioNode, t: number, midi: number, vel: number, dur: number, opts: LeadOptions = {}): number {
  const f = midiToFreq(midi);
  const amp = gainNode(ctx, 0, dest);
  const lp = filterNode(ctx, 'lowpass', 1400, 2.2, amp);
  const hold = Math.max(0.05, dur * 0.92);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vel, t + 0.006);
  amp.gain.setTargetAtTime(vel * 0.72, t + 0.006, 0.12);
  amp.gain.setTargetAtTime(0, t + hold, 0.05);
  const end = t + hold + 0.3;
  const b = opts.bright ?? 0;
  lp.frequency.setValueAtTime(1300, t);
  lp.frequency.linearRampToValueAtTime(4200 + 2500 * b, t + 0.012);
  lp.frequency.setTargetAtTime(2400 + 1500 * b, t + 0.02, 0.15);
  const oscs: OscillatorNode[] = [];
  for (const det of [-8, 8]) {
    const o = oscNode(ctx, 'sawtooth', f, t, end - t, gainNode(ctx, 0.5, lp));
    o.detune.value = det;
    oscs.push(o);
  }
  oscs.push(oscNode(ctx, 'square', f / 2, t, end - t, gainNode(ctx, 0.22, lp)));
  if (opts.glideFrom !== undefined && opts.glideFrom !== midi) {
    const from = midiToFreq(opts.glideFrom);
    for (let i = 0; i < oscs.length; i++) {
      const k = i === 2 ? 0.5 : 1;
      oscs[i]!.frequency.setValueAtTime(from * k, t);
      oscs[i]!.frequency.setTargetAtTime(f * k, t, 0.03);
    }
  }
  if (dur > 0.25) {
    const lfo = oscNode(ctx, 'sine', 5.6, t, end - t);
    const vib = gainNode(ctx, 0);
    vib.gain.setValueAtTime(0, t);
    vib.gain.setTargetAtTime(13, t + 0.16, 0.1);
    lfo.connect(vib);
    for (const o of oscs) vib.connect(o.detune);
  }
  return end;
}

/** Brass section note: three detuned saws, a pitch scoop and the filter "blat". `stab` = short and punchy. */
export function brassNote(ctx: Ctx, dest: AudioNode, t: number, midi: number, vel: number, dur: number, stab = false): number {
  const f = midiToFreq(midi);
  const amp = gainNode(ctx, 0, dest);
  const lp = filterNode(ctx, 'lowpass', 500, 1.1, filterNode(ctx, 'peaking', 1300, 1.2, amp, 4));
  const attack = stab ? 0.01 : 0.035;
  const hold = Math.max(0.04, stab ? Math.min(0.14, dur * 0.6) : dur * 0.9);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vel, t + attack);
  amp.gain.setTargetAtTime(vel * 0.8, t + attack, 0.1);
  amp.gain.setTargetAtTime(0, t + attack + hold, stab ? 0.04 : 0.07);
  const end = t + attack + hold + 0.45;
  lp.frequency.setValueAtTime(450, t);
  lp.frequency.linearRampToValueAtTime(1200 + 3200 * vel, t + attack + 0.03);
  lp.frequency.setTargetAtTime(1000 + 1500 * vel, t + attack + 0.04, 0.18);
  lp.frequency.setTargetAtTime(500, t + attack + hold, 0.06);
  for (const det of [-9, 0, 10]) {
    const o = oscNode(ctx, 'sawtooth', f, t, end - t, gainNode(ctx, 0.36, lp));
    o.detune.setValueAtTime(det - 45, t);
    o.detune.setTargetAtTime(det, t, 0.025);
  }
  return end;
}

export function brassChord(ctx: Ctx, dest: AudioNode, t: number, midis: readonly number[], vel: number, dur: number, stab = false): number {
  let end = t;
  const v = vel / Math.sqrt(Math.max(1, midis.length));
  for (const m of midis) end = Math.max(end, brassNote(ctx, dest, t, m, v, dur, stab));
  return end;
}

/** Stadium tonewheel organ chord: drawbar wave, percussive key click, leslie tremolo/vibrato. */
export function organChord(ctx: Ctx, dest: AudioNode, t: number, midis: readonly number[], vel: number, dur: number, leslie = true): number {
  const amp = gainNode(ctx, 0, dest);
  const hold = Math.max(0.05, dur * 0.95);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vel, t + 0.006);
  amp.gain.setValueAtTime(vel, t + hold);
  amp.gain.linearRampToValueAtTime(0, t + hold + 0.07);
  const end = t + hold + 0.1;
  // Tremolo stage (the leslie's amplitude wobble) → envelope.
  const am = gainNode(ctx, leslie ? 0.88 : 1, amp);
  const tone = filterNode(ctx, 'lowpass', 5200, 0.6, am);
  const wave = organWave(ctx, 'full');
  const n = Math.max(1, midis.length);
  const oscs: OscillatorNode[] = [];
  for (const m of midis) oscs.push(waveOsc(ctx, wave, midiToFreq(m) / 2, t, end - t, gainNode(ctx, 0.5 / Math.sqrt(n), tone)));
  // Key click.
  noiseBurst(ctx, amp, t, { type: 'bandpass', freq: 2600, q: 0.8, peak: 0.12, attack: 0.0005, tc: 0.004 });
  if (leslie) {
    const lfo = oscNode(ctx, 'sine', 6.3, t, end - t);
    const vib = gainNode(ctx, 7, undefined);
    lfo.connect(vib);
    for (const o of oscs) vib.connect(o.detune);
    const trem = gainNode(ctx, 0.12);
    lfo.connect(trem);
    trem.connect(am.gain);
  }
  return end;
}

/**
 * Power chord into an overdrive bus (the "amp" is shared per band so the chord
 * distorts as a whole, like a real guitar). `mute` = palm-muted chug.
 */
export function powerChord(ctx: Ctx, driveIn: AudioNode, t: number, midis: readonly number[], vel: number, dur: number, mute: boolean): number {
  const amp = gainNode(ctx, 0, driveIn);
  const pre = filterNode(ctx, 'lowpass', mute ? 850 : 5000, 0.7, amp);
  let end: number;
  if (mute) {
    end = perc(amp.gain, t, vel, 0.003, Math.min(0.07, dur * 0.4));
  } else {
    const hold = Math.max(0.06, dur * 0.95);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.004);
    amp.gain.setTargetAtTime(vel * 0.7, t + 0.004, 0.3);
    amp.gain.setTargetAtTime(0, t + hold, 0.05);
    end = t + hold + 0.3;
  }
  for (const m of midis) {
    const f = midiToFreq(m);
    for (const det of [-7, 6]) {
      const o = oscNode(ctx, 'sawtooth', f, t, end - t + 0.02, gainNode(ctx, 0.3, pre));
      o.detune.value = det;
    }
  }
  return end;
}

/** Squelchy synth bass: saw + square through a resonant lowpass with a snappy envelope, plus a sine sub. */
export function bassNote(ctx: Ctx, dest: AudioNode, t: number, midi: number, vel: number, dur: number): number {
  const f = midiToFreq(midi);
  const amp = gainNode(ctx, 0, dest);
  const lp = filterNode(ctx, 'lowpass', 300, 3.2, amp);
  const hold = Math.max(0.05, dur * 0.85);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vel, t + 0.003);
  amp.gain.setTargetAtTime(vel * 0.8, t + 0.003, 0.08);
  amp.gain.setTargetAtTime(0, t + hold, 0.025);
  const end = t + hold + 0.16;
  lp.frequency.setValueAtTime(220, t);
  lp.frequency.linearRampToValueAtTime(600 + 1300 * vel, t + 0.008);
  lp.frequency.setTargetAtTime(380, t + 0.01, 0.07);
  const saw = oscNode(ctx, 'sawtooth', f, t, end - t, gainNode(ctx, 0.5, lp));
  saw.detune.value = -4;
  const sq = oscNode(ctx, 'square', f, t, end - t, gainNode(ctx, 0.3, lp));
  sq.detune.value = 5;
  oscNode(ctx, 'sine', f, t, end - t, gainNode(ctx, 0.55, amp));
  return end;
}

/** Chiptune pulse note (arpeggios, 8-bit leads). */
export function chipNote(ctx: Ctx, dest: AudioNode, t: number, midi: number, vel: number, dur: number, duty = 0.25, tc = 0.07): number {
  const g = gainNode(ctx, 0, filterNode(ctx, 'lowpass', 5200, 0.7, dest));
  const hold = Math.max(0.02, dur * 0.8);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.002);
  g.gain.setTargetAtTime(vel * 0.5, t + 0.002, tc);
  g.gain.setTargetAtTime(0, t + hold, 0.02);
  const end = t + hold + 0.12;
  waveOsc(ctx, pulseWave(ctx, duty), midiToFreq(midi), t, end - t, g);
  return end;
}

/** Warm sustained chord: detuned saws + a sine per note, slow attack, soft lowpass. */
export function padChord(ctx: Ctx, dest: AudioNode, t: number, midis: readonly number[], vel: number, dur: number, attack = 0.3): number {
  const lp = filterNode(ctx, 'lowpass', 1500, 0.6, dest);
  const g = gainNode(ctx, 0, lp);
  const rel = t + Math.max(attack + 0.05, dur - 0.05);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + attack);
  g.gain.setValueAtTime(vel, rel);
  g.gain.setTargetAtTime(0, rel, 0.22);
  const end = rel + 1.3;
  const k = 1 / Math.sqrt(Math.max(1, midis.length));
  for (const m of midis) {
    const f = midiToFreq(m);
    for (const det of [-7, 7]) {
      const o = oscNode(ctx, 'sawtooth', f, t, end - t, gainNode(ctx, 0.22 * k, g));
      o.detune.value = det;
    }
    oscNode(ctx, 'sine', f / 2, t, end - t, gainNode(ctx, 0.3 * k, g));
  }
  return end;
}

/** FM electric piano: 1:1 modulator for the body, a fast 14:1 "tine" on the attack. */
export function epianoNote(ctx: Ctx, dest: AudioNode, t: number, midi: number, vel: number, dur: number): number {
  const f = midiToFreq(midi);
  const g = gainNode(ctx, 0, dest);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vel, t + 0.003);
  g.gain.setTargetAtTime(vel * 0.3, t + 0.003, 0.5);
  const off = t + Math.max(0.1, dur);
  g.gain.setTargetAtTime(0, off, 0.08);
  const end = off + 0.5;
  const car = oscNode(ctx, 'sine', f, t, end - t, g);
  const mod = oscNode(ctx, 'sine', f, t, end - t);
  const mg = gainNode(ctx, 0);
  mg.gain.setValueAtTime(f * (0.6 + 1.2 * vel), t);
  mg.gain.setTargetAtTime(f * 0.15, t, 0.35);
  mod.connect(mg);
  mg.connect(car.frequency);
  const tine = oscNode(ctx, 'sine', f * 14, t, 0.15);
  const tg = gainNode(ctx, 0);
  perc(tg.gain, t, f * 1.4 * vel, 0.001, 0.012);
  tine.connect(tg);
  tg.connect(car.frequency);
  return end;
}

/** FM bell: bright metallic attack that mellows (ratio ≈ 3.5 bell, 1.4 glassy, 2 glock-ish). */
export function bellNote(ctx: Ctx, dest: AudioNode, t: number, freq: number, peak: number, tc: number, ratio = 3.5, index = 2.2): number {
  const g = gainNode(ctx, 0, dest);
  const end = perc(g.gain, t, peak, 0.002, tc);
  const car = oscNode(ctx, 'sine', freq, t, end - t + 0.02, g);
  const mod = oscNode(ctx, 'sine', freq * ratio, t, end - t + 0.02);
  const mg = gainNode(ctx, 0);
  perc(mg.gain, t, freq * index, 0.001, tc * 0.35);
  mod.connect(mg);
  mg.connect(car.frequency);
  return end;
}

// ── Percussion ─────────────────────────────────────────────────────────────

export function kickHit(ctx: Ctx, dest: AudioNode, t: number, vel: number): number {
  const end = thump(ctx, dest, t, 160, 44, 0.16, vel);
  thump(ctx, dest, t, 60, 40, 0.3, vel * 0.5);
  noiseBurst(ctx, dest, t, { type: 'highpass', freq: 2500, q: 0.7, peak: 0.16 * vel, tc: 0.003 });
  return end;
}

/** Big 80s snare: tone + noise with a gated tail. */
export function snareHit(ctx: Ctx, dest: AudioNode, t: number, vel: number): number {
  const body = gainNode(ctx, 0, dest);
  perc(body.gain, t, 0.55 * vel, 0.001, 0.045);
  const o = oscNode(ctx, 'triangle', 205, t, 0.3, body);
  o.frequency.setValueAtTime(240, t);
  o.frequency.exponentialRampToValueAtTime(175, t + 0.08);
  noiseBurst(ctx, dest, t, { type: 'bandpass', freq: 2200, q: 0.55, peak: vel, attack: 0.001, tc: 0.06 });
  // Gated tail: holds, then cuts.
  const tail = gainNode(ctx, 0, dest);
  tail.gain.setValueAtTime(0, t);
  tail.gain.linearRampToValueAtTime(0.28 * vel, t + 0.01);
  tail.gain.setValueAtTime(0.22 * vel, t + 0.13);
  tail.gain.linearRampToValueAtTime(0, t + 0.17);
  noiseNode(ctx, 'pink', t, 0.2, filterNode(ctx, 'highpass', 900, 0.6, tail));
  return t + 0.35;
}

export function clapHit(ctx: Ctx, dest: AudioNode, t: number, vel: number): number {
  for (let i = 0; i < 3; i++) noiseBurst(ctx, dest, t + i * 0.011, { type: 'bandpass', freq: 1300, q: 1.4, peak: vel * (0.7 + i * 0.15), attack: 0.0008, tc: 0.006 });
  return noiseBurst(ctx, dest, t + 0.033, { type: 'bandpass', freq: 1200, q: 1, peak: vel * 0.8, tc: 0.05 }).end;
}

export function hatHit(ctx: Ctx, dest: AudioNode, t: number, vel: number, open = false): number {
  noiseBurst(ctx, dest, t, { type: 'highpass', freq: 7500, q: 0.7, peak: vel, tc: open ? 0.12 : 0.018 });
  return noiseBurst(ctx, dest, t, { type: 'bandpass', freq: 10500, q: 1.2, peak: 0.4 * vel, tc: open ? 0.08 : 0.01 }).end;
}

/** Crash cymbal: FM metallic partials + a long bright noise wash. */
export function crashHit(ctx: Ctx, dest: AudioNode, t: number, vel: number, tc = 0.55): number {
  const end = noiseBurst(ctx, dest, t, { type: 'highpass', freq: 4200, q: 0.5, peak: vel, attack: 0.002, tc }).end;
  noiseBurst(ctx, dest, t, { type: 'bandpass', freq: 7000, q: 0.8, peak: 0.5 * vel, attack: 0.001, tc: tc * 0.5 });
  const g = gainNode(ctx, 0, filterNode(ctx, 'highpass', 2500, 0.7, dest));
  perc(g.gain, t, 0.25 * vel, 0.001, tc * 0.6);
  const car = oscNode(ctx, 'square', 540, t, end - t, g);
  const mod = oscNode(ctx, 'square', 540 * 1.4837, t, end - t);
  const mg = gainNode(ctx, 1900);
  mod.connect(mg);
  mg.connect(car.frequency);
  return end;
}

export function tomHit(ctx: Ctx, dest: AudioNode, t: number, vel: number, freq: number): number {
  noiseBurst(ctx, dest, t, { type: 'bandpass', freq: freq * 4, q: 1, peak: 0.25 * vel, tc: 0.02 });
  return thump(ctx, dest, t, freq * 1.5, freq, 0.28, vel);
}

/** Timpani: tuned drum with a pitch settle and a soft felt mallet. */
export function timpHit(ctx: Ctx, dest: AudioNode, t: number, midi: number, vel: number): number {
  const f = midiToFreq(midi);
  const g = gainNode(ctx, 0, dest);
  const end = perc(g.gain, t, vel, 0.004, 0.4);
  const o = oscNode(ctx, 'sine', f * 1.05, t, end - t, g);
  o.frequency.setTargetAtTime(f, t, 0.03);
  const o2 = oscNode(ctx, 'sine', f * 1.5, t, end - t, gainNode(ctx, 0.35, g));
  o2.frequency.setTargetAtTime(f * 1.5, t, 0.03);
  noiseBurst(ctx, dest, t, { type: 'lowpass', freq: 600, q: 0.7, peak: 0.4 * vel, tc: 0.03 });
  return end;
}

/** Timpani roll (crescendo) into a hit. */
export function timpRoll(ctx: Ctx, dest: AudioNode, t: number, midi: number, len: number, vel: number): number {
  const hits = Math.max(2, Math.floor(len / 0.055));
  for (let i = 0; i < hits; i++) timpHit(ctx, dest, t + i * 0.055, midi, vel * (0.2 + 0.5 * (i / hits)));
  return timpHit(ctx, dest, t + len, midi, vel);
}

// ── The band ───────────────────────────────────────────────────────────────

export type BandInstrument = keyof typeof MIX;

/** One music track's instruments. Connects to `dest` through `out` (track fader) and `tone`. */
export class Band {
  readonly out: GainNode;
  readonly tone: BiquadFilterNode;
  private readonly buses: Record<BandInstrument, AudioNode>;
  private readonly driveIn: GainNode;
  private readonly echoDelay: DelayNode;
  private readonly echoFb: GainNode;

  constructor(
    private readonly ctx: Ctx,
    dest: AudioNode,
    bpm: number,
  ) {
    this.out = gainNode(ctx, 0, dest);
    this.tone = filterNode(ctx, 'lowpass', 20000, 0.5, this.out);
    const bus = (level: number, pan: number): GainNode => gainNode(ctx, level, pannerNode(ctx, pan, this.tone));
    // Tempo-synced dotted-8th echo for the lead & arp.
    const echoIn = gainNode(ctx, 1);
    this.echoDelay = ctx.createDelay(2);
    this.echoDelay.delayTime.value = (60 / bpm) * 0.75;
    const fb = gainNode(ctx, 0.3);
    this.echoFb = fb;
    const echoTone = filterNode(ctx, 'lowpass', 2800, 0.5);
    echoIn.connect(this.echoDelay);
    this.echoDelay.connect(echoTone);
    echoTone.connect(fb);
    fb.connect(this.echoDelay);
    echoTone.connect(pannerNode(ctx, 0.45, gainNode(ctx, 0.28, this.tone)));
    const lead = bus(MIX.lead, -0.08);
    lead.connect(echoIn);
    const arp = bus(MIX.arp, 0.35);
    arp.connect(echoIn);
    // Overdrive "amp" for the power chords: drive → cab EQ.
    const powerOut = bus(MIX.power, -0.3);
    const cab = filterNode(ctx, 'lowpass', 3300, 0.8, filterNode(ctx, 'peaking', 900, 1, filterNode(ctx, 'highpass', 110, 0.7, powerOut), -3));
    this.driveIn = gainNode(ctx, 1.4, shaperNode(ctx, 5, cab));
    this.buses = {
      lead,
      brass: bus(MIX.brass, 0.18),
      organ: bus(MIX.organ, 0.25),
      power: powerOut,
      bass: filterNode(ctx, 'highpass', 32, 0.7, bus(MIX.bass, 0)),
      arp,
      pad: bus(MIX.pad, 0),
      epiano: bus(MIX.epiano, -0.22),
      bell: bus(MIX.bell, 0.3),
      kick: bus(MIX.kick, 0),
      snare: bus(MIX.snare, 0.04),
      clap: bus(MIX.clap, -0.06),
      hat: bus(MIX.hat, 0.32),
      crash: bus(MIX.crash, -0.35),
      tom: bus(MIX.tom, 0.1),
      timp: bus(MIX.timp, -0.1),
    };
  }

  /** Detach the band (breaks the echo feedback loop so the whole graph can be collected). */
  dispose(): void {
    try {
      this.out.disconnect();
      this.echoFb.disconnect();
    } catch {
      /* already gone */
    }
  }

  /** Re-sync the echo when the tempo changes. */
  setTempo(bpm: number, at: number): void {
    const d = this.echoDelay.delayTime;
    holdAt(d, at);
    d.setTargetAtTime((60 / bpm) * 0.75, at, 0.05);
  }

  lead(t: number, midi: number, vel: number, dur: number, glideFrom?: number): void {
    leadNote(this.ctx, this.buses.lead, t, midi, vel, dur, { glideFrom });
  }

  brass(t: number, midis: readonly number[], vel: number, dur: number, stab: boolean): void {
    brassChord(this.ctx, this.buses.brass, t, midis, vel, dur, stab);
  }

  organ(t: number, midis: readonly number[], vel: number, dur: number): void {
    organChord(this.ctx, this.buses.organ, t, midis, vel, dur);
  }

  power(t: number, midis: readonly number[], vel: number, dur: number, mute: boolean): void {
    powerChord(this.ctx, this.driveIn, t, midis, vel, dur, mute);
  }

  bass(t: number, midi: number, vel: number, dur: number): void {
    bassNote(this.ctx, this.buses.bass, t, midi, vel, dur);
  }

  arp(t: number, midi: number, vel: number, dur: number): void {
    chipNote(this.ctx, this.buses.arp, t, midi, vel, dur, 0.25);
  }

  chip(t: number, midi: number, vel: number, dur: number): void {
    chipNote(this.ctx, this.buses.lead, t, midi, vel * 0.8, dur, 0.5, 0.25);
  }

  pad(t: number, midis: readonly number[], vel: number, dur: number): void {
    padChord(this.ctx, this.buses.pad, t, midis, vel, dur);
  }

  epiano(t: number, midis: readonly number[], vel: number, dur: number): void {
    const k = 1 / Math.sqrt(Math.max(1, midis.length));
    for (let i = 0; i < midis.length; i++) epianoNote(this.ctx, this.buses.epiano, t + i * 0.006, midis[i]!, vel * k, dur);
  }

  bell(t: number, midi: number, vel: number, dur: number): void {
    bellNote(this.ctx, this.buses.bell, t, midiToFreq(midi), vel, Math.min(0.5, 0.18 + dur * 0.3), 2.0, 1.4);
    ping(this.ctx, this.buses.bell, t, midiToFreq(midi) * 2, { peak: vel * 0.25, tc: 0.05 });
  }

  kick(t: number, vel: number): void {
    kickHit(this.ctx, this.buses.kick, t, vel);
  }

  snare(t: number, vel: number): void {
    snareHit(this.ctx, this.buses.snare, t, vel);
  }

  clap(t: number, vel: number): void {
    clapHit(this.ctx, this.buses.clap, t, vel);
  }

  hat(t: number, vel: number, open: boolean): void {
    hatHit(this.ctx, this.buses.hat, t, vel, open);
  }

  crash(t: number, vel: number): void {
    crashHit(this.ctx, this.buses.crash, t, vel);
  }

  tom(t: number, vel: number, midi: number): void {
    tomHit(this.ctx, this.buses.tom, t, vel, midiToFreq(midi));
  }

  timp(t: number, midi: number, vel: number): void {
    timpHit(this.ctx, this.buses.timp, t, midi, vel);
  }
}
