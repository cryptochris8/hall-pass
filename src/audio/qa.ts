// ─────────────────────────────────────────────────────────────────────────────
// Offline render QA. Renders every SFX, every music track (the sneak track at each
// suspicion level and on a live ramp), the ambience bed and a few worst-case
// "stack" scenes through the REAL mixer (compressor + soft clipper) into an
// OfflineAudioContext and measures peak / RMS / length. Driven from dev/audio.html
// (window.__audioQa) — never imported by the game bundle.
//
// Checks: nothing clips (peak ≤ −0.5 dBFS), nothing is silent, no NaNs, SFX not too
// quiet, music loudness in a sane window, and each effect's audible length agrees
// with the end time its recipe declares (the voice limiter relies on it).
// Adapted from ATHLETE MAYHEM's qa.ts (itself from TRASH PANDA TROUBLE).
// ─────────────────────────────────────────────────────────────────────────────
import { SchoolBed } from './ambience';
import { buildMixer, duckParam, type Mixer } from './mixer';
import { MusicPlayer, type PlayableTrack } from './music';
import { audibleSpan, bandLevels, type BandReport, type LevelReport, measureLevels } from './meter';
import { playSfx, SFX_META, SFX_NAMES } from './sfx';
import type { SfxName } from './types';

export const QA_RATE = 44100;

export type QaGroup = 'sfx' | 'bed' | 'music' | 'scene';

export interface QaItem {
  group: QaGroup;
  name: string;
  report: LevelReport;
  bands: BandReport;
  audible: number;
  declared: number;
  verdict: 'ok' | 'warn' | 'fail';
  notes: string[];
}

export const QA_TARGETS = {
  ceiling: -0.5,
  silentPeak: -50,
  sfxPeakMin: -24,
  musicRmsMin: -27,
  musicRmsMax: -15,
  bedRmsMin: -48,
  bedRmsMax: -22,
  tailAllowance: 1.4,
} as const;

function judge(item: Omit<QaItem, 'verdict' | 'notes'>): { verdict: QaItem['verdict']; notes: string[] } {
  const r = item.report;
  const notes: string[] = [];
  let verdict: QaItem['verdict'] = 'ok';
  const fail = (n: string): void => {
    notes.push(n);
    verdict = 'fail';
  };
  const warn = (n: string): void => {
    notes.push(n);
    if (verdict === 'ok') verdict = 'warn';
  };
  if (r.nonFinite > 0) fail(`${r.nonFinite} non-finite samples`);
  if (r.peakDb > QA_TARGETS.ceiling) fail(`peak ${r.peakDb.toFixed(2)} > ${QA_TARGETS.ceiling}`);
  if (!(r.peakDb > QA_TARGETS.silentPeak)) fail('silent');
  switch (item.group) {
    case 'sfx':
      if (r.peakDb < QA_TARGETS.sfxPeakMin) warn(`quiet (${r.peakDb.toFixed(1)})`);
      if (item.declared > 0 && item.audible > item.declared + QA_TARGETS.tailAllowance) warn(`rings ${item.audible.toFixed(2)}s > declared ${item.declared.toFixed(2)}s`);
      break;
    case 'music':
      if (r.gatedRmsDb < QA_TARGETS.musicRmsMin) warn(`quiet (${r.gatedRmsDb.toFixed(1)})`);
      if (r.gatedRmsDb > QA_TARGETS.musicRmsMax) warn(`loud (${r.gatedRmsDb.toFixed(1)})`);
      break;
    case 'bed':
      if (r.gatedRmsDb < QA_TARGETS.bedRmsMin) warn(`quiet (${r.gatedRmsDb.toFixed(1)})`);
      if (r.gatedRmsDb > QA_TARGETS.bedRmsMax) warn(`loud (${r.gatedRmsDb.toFixed(1)})`);
      break;
    case 'scene':
      break;
  }
  return { verdict, notes };
}

function analyse(group: QaGroup, name: string, buf: AudioBuffer, declared = 0, skip = 0): QaItem {
  const chans: Float32Array[] = [];
  const from = Math.floor(skip * buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c).subarray(from));
  const report = measureLevels(chans, buf.sampleRate);
  const span = audibleSpan(chans, buf.sampleRate, 30);
  const base = { group, name, report, bands: bandLevels(chans[0]!, buf.sampleRate), audible: span.end, declared };
  return { ...base, ...judge(base) };
}

function offline(seconds: number): { ctx: OfflineAudioContext; mix: Mixer } {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * QA_RATE), QA_RATE);
  return { ctx, mix: buildMixer(ctx) };
}

const T0 = 0.02;

export async function renderSfx(name: SfxName, seconds: number, opts: { volume?: number; pitch?: number } = {}): Promise<{ buf: AudioBuffer; declared: number }> {
  const { ctx, mix } = offline(seconds);
  const meta = SFX_META[name];
  const end = playSfx(ctx, meta.minor ? mix.sfxMinor : mix.sfx, name, T0, { volume: opts.volume, pitch: opts.pitch, echo: mix.echo });
  return { buf: await ctx.startRendering(), declared: end - T0 };
}

export async function renderBed(level: number, seconds: number): Promise<AudioBuffer> {
  const { ctx, mix } = offline(seconds);
  const bed = new SchoolBed(ctx, mix.ambBed, 0, level);
  bed.pump(seconds, 0);
  return ctx.startRendering();
}

export async function renderMusic(track: PlayableTrack, seconds: number, intensity = 0): Promise<AudioBuffer> {
  const { ctx, mix } = offline(seconds);
  const p = new MusicPlayer(ctx, mix.music, track, 0, { fadeIn: 0.05, intensity });
  p.pump(seconds);
  return ctx.startRendering();
}

/** Live code path for the sneak track: pump every 25 ms of audio time while suspicion goes calm → chase → calm. */
export async function renderSneakRamp(seconds: number): Promise<AudioBuffer> {
  const { ctx, mix } = offline(seconds);
  const p = new MusicPlayer(ctx, mix.music, 'sneak', 0, { fadeIn: 0.05 });
  const step = 0.025;
  const at = (t: number): void => {
    const u = t / seconds;
    p.setIntensity(u < 0.3 ? 0 : u < 0.5 ? 0.5 : u < 0.8 ? 1 : 0.1);
    p.pump(t + 0.12, t);
  };
  at(0);
  for (let t = step; t < seconds; t += step) {
    const tt = t;
    void ctx.suspend(tt).then(() => {
      at(tt);
      void ctx.resume();
    });
  }
  return ctx.startRendering();
}

type SceneCue = { at: number; sfx: SfxName; volume?: number; pitch?: number };

export async function renderScene(seconds: number, track: PlayableTrack, intensity: number, bed: number, cues: readonly SceneCue[]): Promise<AudioBuffer> {
  const { ctx, mix } = offline(seconds);
  new MusicPlayer(ctx, mix.music, track, 0, { fadeIn: 0.05, intensity }).pump(seconds);
  new SchoolBed(ctx, mix.ambBed, 0, bed).pump(seconds, 0);
  for (const c of cues) {
    const meta = SFX_META[c.sfx];
    playSfx(ctx, meta.minor ? mix.sfxMinor : mix.sfx, c.sfx, c.at, { volume: c.volume, pitch: c.pitch, echo: mix.echo });
    if (meta.duck) {
      duckParam(mix.musicDuck.gain, 1, meta.duck.music, meta.duck.seconds, c.at);
      if (meta.duck.minor > 0) duckParam(mix.sfxMinor.gain, 1, meta.duck.minor, meta.duck.seconds, c.at);
    }
  }
  return ctx.startRendering();
}

export interface QaSummary {
  items: QaItem[];
  failures: number;
  warnings: number;
}

export type QaPart = 'all' | QaGroup;

const breathe = (): Promise<void> => new Promise((r) => setTimeout(r, 15));

function sfxSeconds(name: SfxName): number {
  const long: ReadonlySet<SfxName> = new Set(['flyover', 'bell', 'success', 'detention', 'paChime', 'vAnnounce', 'lunchBell']);
  return long.has(name) ? 5 : 2.5;
}

export async function runQa(quick = false, part: QaPart = 'all'): Promise<QaSummary> {
  const items: QaItem[] = [];
  const want = (g: QaGroup): boolean => part === 'all' || part === g;
  if (want('sfx')) {
    for (const name of SFX_NAMES) {
      const { buf, declared } = await renderSfx(name, sfxSeconds(name));
      items.push(analyse('sfx', name, buf, declared));
      await breathe();
    }
    // Quiet footsteps (sneaking past) must still read; high voices (Preston) must stay clean.
    for (const name of ['step', 'squeak'] as const) {
      const { buf, declared } = await renderSfx(name, 2, { volume: 0.3 });
      items.push(analyse('sfx', `${name} @vol 0.3`, buf, declared));
    }
    for (const pitch of [0.8, 1.6]) {
      const { buf, declared } = await renderSfx('vHey', 2.5, { pitch });
      items.push(analyse('sfx', `vHey @pitch ${pitch}`, buf, declared));
    }
  }
  if (want('bed')) {
    for (const level of [0.3, 0.6, 1]) {
      items.push(analyse('bed', `ambience @${level}`, await renderBed(level, quick ? 8 : 14), 0, 1.5));
      await breathe();
    }
  }
  if (want('music')) {
    const mlen = quick ? 14 : 24;
    const music: Array<[string, PlayableTrack, number]> = [
      ['title', 'title', 0],
      ['menu', 'menu', 0],
      ['sneak · calm', 'sneak', 0],
      ['sneak · curious', 'sneak', 0.5],
      ['sneak · chase', 'sneak', 1],
      ['report', 'report', 0],
    ];
    for (const [name, track, intensity] of music) {
      items.push(analyse('music', name, await renderMusic(track, mlen, intensity), 0, 0.5));
      await breathe();
    }
    items.push(analyse('music', 'sneak · live ramp', await renderSneakRamp(quick ? 18 : 30), 0, 0.5));
  }
  if (want('scene')) {
    items.push(
      analyse(
        'scene',
        'BUSTED: spotted+vHey+whistle+busted+vWhere · chase',
        await renderScene(6, 'sneak', 1, 0.6, [
          { at: 0.2, sfx: 'spotted' },
          { at: 0.25, sfx: 'vHey', pitch: 0.9 },
          { at: 0.6, sfx: 'whistle' },
          { at: 1.4, sfx: 'squeak', volume: 1 },
          { at: 1.6, sfx: 'busted' },
          { at: 1.9, sfx: 'vWhere', pitch: 0.9 },
        ]),
      ),
    );
    items.push(
      analyse(
        'scene',
        'PA + camera + vending, all at once · curious',
        await renderScene(6, 'sneak', 0.5, 0.6, [
          { at: 0.1, sfx: 'paChime' },
          { at: 1.0, sfx: 'vAnnounce' },
          { at: 1.2, sfx: 'cameraAlert' },
          { at: 1.3, sfx: 'vendWhir' },
          { at: 2.0, sfx: 'vendRattle' },
          { at: 2.4, sfx: 'curious' },
        ]),
      ),
    );
    items.push(
      analyse(
        'scene',
        'SUCCESS: item+lockerOut+success+bell · report',
        await renderScene(6, 'report', 0, 0.3, [
          { at: 0.1, sfx: 'item' },
          { at: 0.4, sfx: 'lockerOut' },
          { at: 0.8, sfx: 'success' },
          { at: 1.6, sfx: 'stamp' },
          { at: 1.8, sfx: 'gradeA' },
          { at: 2.1, sfx: 'newBest' },
        ]),
      ),
    );
  }
  return { items, failures: items.filter((i) => i.verdict === 'fail').length, warnings: items.filter((i) => i.verdict === 'warn').length };
}

export function formatQa(s: QaSummary): string[] {
  const f = (v: number, w = 6): string => (Number.isFinite(v) ? v.toFixed(1) : '-inf').padStart(w);
  const lines = s.items.map(
    (i) =>
      `${i.verdict.toUpperCase().padEnd(4)} ${i.group.padEnd(5)} ${i.name.padEnd(44).slice(0, 44)} peak ${f(i.report.peakDb)}  rms ${f(i.report.gatedRmsDb)}  len ${i.audible.toFixed(2).padStart(5)}s` +
      `${i.declared > 0 ? ` (decl ${i.declared.toFixed(2)})` : ''}${i.notes.length ? '  <- ' + i.notes.join('; ') : ''}`,
  );
  lines.push(`${s.items.length} items · ${s.failures} fail · ${s.warnings} warn`);
  return lines;
}
