// ─────────────────────────────────────────────────────────────────────────────
// School ambience (GDD §14): what an empty hallway sounds like during class.
//   hum      the fluorescent tubes: a quiet 120 Hz buzz with a few harmonics and a
//            slow flicker
//   murmur   classes behind closed doors: pink noise in the vocal band with slow
//            random swells, low-passed (through walls)
//   air      HVAC: brown noise, very low
//   distant  now and then: a far locker slam, a door, a teacher's voice through a wall,
//            a chair scrape, a cough
// Schedules ahead like the music (pump(until, now)) so the offline QA harness renders
// what the game plays. Level 0..1 scales everything (the bed's character stays).
// Structure after ATHLETE MAYHEM's CrowdBed; the sounds are new.
// ─────────────────────────────────────────────────────────────────────────────
import { type Ctx, filterNode, gainNode, noiseBurst, noiseNode, oscNode, pannerNode, thump } from './synth';

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Seconds between distant one-shots (min, max). */
export const DISTANT_GAP: readonly [number, number] = [3.5, 9];

export class SchoolBed {
  private readonly out: GainNode;
  private readonly murmurSwell: GainNode;
  private readonly flicker: GainNode;
  private readonly distant: GainNode;
  private level: number;
  private nextSwell: number;
  private nextDistant: number;
  private stopped = false;
  /** Endless sources (stopped with the bed). */
  private readonly sources: AudioScheduledSourceNode[] = [];

  constructor(
    private readonly ctx: Ctx,
    dest: AudioNode,
    t0: number,
    level = 0.6,
  ) {
    this.level = clamp01(level);
    this.out = gainNode(ctx, 0, dest);
    this.out.gain.setValueAtTime(0, t0);
    this.out.gain.linearRampToValueAtTime(this.level, t0 + 1.2);

    // Fluorescent hum.
    this.flicker = gainNode(ctx, 1, this.out);
    const hum = gainNode(ctx, 0.022, filterNode(ctx, 'lowpass', 900, 0.7, this.flicker));
    for (const [f, a] of [
      [120, 1],
      [240, 0.45],
      [360, 0.25],
      [480, 0.12],
    ] as const) {
      this.sources.push(oscNode(ctx, 'sine', f, t0, Infinity, gainNode(ctx, a, hum)));
    }
    this.sources.push(noiseNode(ctx, 'white', t0, Infinity, filterNode(ctx, 'bandpass', 5200, 3, gainNode(ctx, 0.004, this.flicker))));

    // Classes through the walls.
    this.murmurSwell = gainNode(ctx, 1, this.out);
    const murmurL = filterNode(ctx, 'lowpass', 1100, 0.6, gainNode(ctx, 0.08, pannerNode(ctx, -0.4, this.murmurSwell)));
    const murmurR = filterNode(ctx, 'lowpass', 1100, 0.6, gainNode(ctx, 0.07, pannerNode(ctx, 0.45, this.murmurSwell)));
    this.sources.push(noiseNode(ctx, 'pink', t0, Infinity, filterNode(ctx, 'bandpass', 520, 1.1, murmurL)));
    this.sources.push(noiseNode(ctx, 'pink', t0 + 0.37, Infinity, filterNode(ctx, 'bandpass', 760, 1.3, murmurR)));

    // HVAC air.
    this.sources.push(noiseNode(ctx, 'brown', t0, Infinity, filterNode(ctx, 'lowpass', 220, 0.6, gainNode(ctx, 0.05, this.out))));

    this.distant = gainNode(ctx, 1, filterNode(ctx, 'lowpass', 1800, 0.6, this.out));
    this.nextSwell = t0;
    this.nextDistant = t0 + rand(1.5, 4);
  }

  get currentLevel(): number {
    return this.level;
  }

  setLevel(level: number, now: number): void {
    this.level = clamp01(level);
    if (this.stopped) return;
    const g = this.out.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this.level, now, 0.3);
  }

  stop(t: number, fade: number): void {
    if (this.stopped) return;
    this.stopped = true;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(0, t, Math.max(0.01, fade / 4));
    for (const src of this.sources) {
      try {
        src.stop(t + fade + 0.2);
      } catch {
        /* already stopped */
      }
    }
    const out = this.out;
    setTimeout(() => {
      try {
        out.disconnect();
      } catch {
        /* gone */
      }
    }, (fade + 1) * 1000);
  }

  /** Schedule swells and distant one-shots up to `until`. */
  pump(until: number, now: number): void {
    if (this.stopped) return;
    const ctx = this.ctx;
    while (this.nextSwell < until) {
      const t = Math.max(this.nextSwell, now);
      const dur = rand(2, 5);
      this.murmurSwell.gain.setTargetAtTime(rand(0.55, 1.25), t, dur / 3);
      this.flicker.gain.setTargetAtTime(rand(0.8, 1.15), t, 0.4);
      this.nextSwell = t + dur;
    }
    while (this.nextDistant < until) {
      const t = Math.max(this.nextDistant, now);
      distantEvent(ctx, this.distant, t);
      this.nextDistant = t + rand(DISTANT_GAP[0], DISTANT_GAP[1]);
    }
  }
}

/** One far-off school noise (returns its end time). */
export function distantEvent(ctx: Ctx, dest: AudioNode, t: number, kind = Math.floor(Math.random() * 5)): number {
  const pan = pannerNode(ctx, rand(-0.8, 0.8), dest);
  const g = gainNode(ctx, rand(0.5, 0.9), pan);
  switch (kind) {
    case 0: {
      // Locker slam down the hall: a metal thunk and a short rattle.
      thump(ctx, g, t, 180, 70, 0.25, 0.18);
      noiseBurst(ctx, g, t, { type: 'bandpass', freq: 900, q: 2.5, peak: 0.07, tc: 0.09 });
      return noiseBurst(ctx, g, t + 0.05, { type: 'bandpass', freq: 1900, q: 6, peak: 0.03, tc: 0.18 }).end;
    }
    case 1: {
      // A door closing.
      thump(ctx, g, t, 120, 60, 0.3, 0.16);
      return noiseBurst(ctx, g, t, { kind: 'brown', type: 'lowpass', freq: 500, peak: 0.1, tc: 0.12 }).end;
    }
    case 2: {
      // A teacher's voice through a wall: a few muffled vowel blips.
      let end = t;
      const f0 = rand(110, 210);
      for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
        const ti = t + i * rand(0.13, 0.22);
        const vg = gainNode(ctx, 0, filterNode(ctx, 'bandpass', rand(450, 800), 3, g));
        vg.gain.setValueAtTime(0, ti);
        vg.gain.linearRampToValueAtTime(0.06, ti + 0.02);
        vg.gain.setTargetAtTime(0, ti + 0.06, 0.04);
        oscNode(ctx, 'sawtooth', f0 * rand(0.9, 1.15), ti, 0.25, vg);
        end = ti + 0.25;
      }
      return end;
    }
    case 3: {
      // A chair scraping.
      const n = noiseBurst(ctx, g, t, { type: 'bandpass', freq: 1300, q: 8, peak: 0.035, attack: 0.05, tc: 0.12 });
      n.filter.frequency.linearRampToValueAtTime(900, t + 0.35);
      return n.end;
    }
    default: {
      // A cough, two classrooms away.
      noiseBurst(ctx, g, t, { kind: 'pink', type: 'bandpass', freq: 700, q: 1.5, peak: 0.07, tc: 0.05 });
      return noiseBurst(ctx, g, t + 0.18, { kind: 'pink', type: 'bandpass', freq: 650, q: 1.5, peak: 0.05, tc: 0.05 }).end;
    }
  }
}
