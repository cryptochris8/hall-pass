// ─────────────────────────────────────────────────────────────────────────────
// MusicPlayer: one playing track. The engine calls pump(until, now) from a ~25 ms
// interval with until = currentTime + ~120 ms (lookahead scheduling); the offline
// QA harness calls pump(seconds) once to schedule a whole render.
//
// Intensity (sneak track: suspicion on screen) is quantised to levels with hysteresis and applied at bar
// lines, together with a gentle tempo push (max 4 BPM per bar). A fresh level also
// re-arranges the REST of the current bar, so the "last 10 seconds" layers kick in
// within a 16th instead of waiting for the downbeat — a chase kicks in at once.
// Copied from ATHLETE MAYHEM's music.ts (adapted from TRASH PANDA TROUBLE); 'sneak' → 'sneak'.
// ─────────────────────────────────────────────────────────────────────────────
import { Band } from './instruments';
import { arrangeBar, eventTempo, intensityLevel, layersFor, type NoteEvent, SONGS, type SongDef, type SongId, stepTempo } from './song';
import { holdAt } from './synth';
import { STEPS_PER_BAR, Transport } from './transport';

export type PlayableTrack = SongId;

/** Per-track fader levels (tuned with the offline QA meter). */
export const TRACK_LEVEL: Readonly<Record<PlayableTrack, number>> = { title: 1.0, menu: 1.1, sneak: 0.95, report: 1.05 };

export class MusicPlayer {
  readonly band: Band;
  private readonly transport: Transport;
  private readonly song: SongDef;
  private readonly buckets: NoteEvent[][] = Array.from({ length: STEPS_PER_BAR }, () => []);
  private readonly scratch: NoteEvent[] = [];
  private arrangedBar = -1;
  private arrangedLevel = -1;
  private level: 0 | 1 | 2 = 0;
  private intensity = 0;
  private stopAt = Infinity;
  finished = false;

  constructor(
    ctx: BaseAudioContext,
    dest: AudioNode,
    readonly track: PlayableTrack,
    t0: number,
    opts: { fadeIn?: number; intensity?: number } = {},
  ) {
    this.song = SONGS[track];
    this.intensity = clamp01(opts.intensity ?? 0);
    this.level = track === 'sneak' ? intensityLevel(this.intensity, 0) : 0;
    const bpm = track === 'sneak' ? eventTempo(this.level) : this.song.bpm;
    this.band = new Band(ctx, dest, bpm);
    const out = this.band.out.gain;
    const fadeIn = Math.max(0.01, opts.fadeIn ?? 0.3);
    out.setValueAtTime(0, t0);
    out.linearRampToValueAtTime(TRACK_LEVEL[track], t0 + fadeIn);
    this.transport = new Transport(t0 + 0.05, bpm, this.song.swing8, this.song.swing16);
  }

  /** Music intensity 0..1 (sneak track layers + tempo push). Cheap; safe to call every frame. */
  setIntensity(v: number): void {
    this.intensity = clamp01(v);
    if (this.track !== 'sneak' || this.stopping) return;
    const lvl = intensityLevel(this.intensity, this.level);
    if (lvl !== this.level) {
      this.level = lvl;
      // Re-arrange the rest of the current bar right away; tempo follows at the bar line.
      this.transport.setTempo(stepTempo(this.transport.bpm, eventTempo(lvl), 4));
    }
  }

  /** Current intensity level (0..2) — exposed for the dev bench and tests. */
  get intensityLevel(): number {
    return this.level;
  }

  get bpm(): number {
    return this.transport.bpm;
  }

  get bar(): number {
    return this.transport.bar;
  }

  /** Schedule every step that starts before `until`. Pass `now` in live mode so a stalled timer skips instead of bursting. */
  pump(until: number, now?: number): void {
    if (this.finished) return;
    const tr = this.transport;
    if (now !== undefined) {
      tr.resync(now);
      if (now >= this.stopAt) {
        this.finish();
        return;
      }
    }
    if (this.arrangedBar === tr.bar && this.arrangedLevel !== this.level) this.arrange(tr.bar);
    while (tr.time < until && tr.time < this.stopAt) {
      if (tr.bar !== this.arrangedBar) this.arrange(tr.bar);
      this.playStep(tr.step, tr.time, tr.sixteenth);
      const bpmBefore = tr.bpm;
      if (tr.advance()) {
        if (tr.bpm !== bpmBefore) this.band.setTempo(tr.bpm, tr.barStart);
        if (this.track === 'sneak') {
          const target = eventTempo(this.level);
          if (target !== tr.bpm) tr.setTempo(stepTempo(tr.bpm, target, 4));
        }
      }
    }
  }

  /** Fade out over `fade` seconds from t. */
  stop(t: number, fade: number): void {
    if (this.stopAt !== Infinity) return;
    this.stopAt = t + fade;
    const g = this.band.out.gain;
    holdAt(g, t);
    g.setTargetAtTime(0, t, Math.max(0.01, fade / 5));
  }

  get stopping(): boolean {
    return this.stopAt !== Infinity;
  }

  private finish(): void {
    this.finished = true;
    const band = this.band;
    setTimeout(() => band.dispose(), 1500);
  }

  private arrange(bar: number): void {
    this.arrangedBar = bar;
    this.arrangedLevel = this.level;
    const ev = this.scratch;
    ev.length = 0;
    arrangeBar(this.song, bar, layersFor(this.song, bar, this.level), ev);
    for (const b of this.buckets) b.length = 0;
    for (const e of ev) this.buckets[e.step]?.push(e);
  }

  private playStep(step: number, t: number, sixteenth: number): void {
    const b = this.band;
    for (const e of this.buckets[step]!) {
      // Humanise: ±7 % velocity (audio isn't gameplay: Math.random is fine here).
      const vel = e.vel * (0.93 + Math.random() * 0.14);
      const dur = e.len * sixteenth;
      const chord = e.chord ?? [e.midi];
      switch (e.inst) {
        case 'lead':
          b.lead(t, e.midi, vel, dur, e.glide);
          break;
        case 'brass':
          b.brass(t, chord, vel, dur, false);
          break;
        case 'stab':
          b.brass(t, chord, vel, dur, true);
          break;
        case 'organ':
          b.organ(t, chord, vel, dur);
          break;
        case 'power':
          b.power(t, chord, vel, dur, !!e.mute);
          break;
        case 'bass':
          b.bass(t, e.midi, vel, dur);
          break;
        case 'arp':
          b.arp(t, e.midi, vel, dur);
          break;
        case 'chip':
          b.chip(t, e.midi, vel, dur);
          break;
        case 'pad':
          b.pad(t, chord, vel, dur);
          break;
        case 'epiano':
          b.epiano(t, chord, vel, dur);
          break;
        case 'bell':
          b.bell(t, e.midi, vel, dur);
          break;
        case 'kick':
          b.kick(t, vel);
          break;
        case 'snare':
          b.snare(t, vel);
          break;
        case 'clap':
          b.clap(t, vel);
          break;
        case 'hat':
          b.hat(t, vel, false);
          break;
        case 'openHat':
          b.hat(t, vel, true);
          break;
        case 'crash':
          b.crash(t, vel);
          break;
        case 'tom':
          b.tom(t, vel, e.midi);
          break;
        case 'timp':
          b.timp(t, e.midi, vel);
          break;
      }
    }
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}
