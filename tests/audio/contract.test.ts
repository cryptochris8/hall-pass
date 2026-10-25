// Contract coverage: every SfxName / MusicTrack has a synth, and every synth schedules cleanly (finite end times)
// on a stubbed context; the songs are well formed and the sneak track layers up with suspicion.
import { describe, expect, it } from 'vitest';
import { SchoolBed } from '../../src/audio/ambience';
import { buildMixer } from '../../src/audio/mixer';
import { MusicPlayer } from '../../src/audio/music';
import { playSfx, SFX, SFX_META, SFX_NAMES } from '../../src/audio/sfx';
import { arrangeBar, EVENT_THRESHOLDS, eventTempo, intensityLevel, introBars, layersFor, loopBars, SONGS, SNEAK_SONG, type NoteEvent } from '../../src/audio/song';
import type { MusicTrack, SfxName } from '../../src/audio/types';
import { bareContext } from './fakeAudio';

const ALL_SFX = [
  'uiMove', 'uiConfirm', 'uiBack', 'uiDenied', 'flyover', 'stamp', 'gradeA', 'gradeLow', 'newBest',
  'step', 'squeak', 'lockerIn', 'lockerOut', 'grab', 'item', 'snack', 'throw', 'eraserLand',
  'curious', 'spotted', 'whistle', 'lostThem', 'busted', 'passFlash', 'cameraAlert', 'found',
  'paChime', 'bell', 'clockTick', 'lunchBell', 'vendWhir', 'vendRattle', 'vendClunk', 'buyCancel',
  'success', 'detention', 'vHey', 'vHm', 'vWhere', 'vCarryOn', 'vTattle', 'vNotYet', 'vAnnounce',
] as const satisfies readonly SfxName[];
type Missing = Exclude<SfxName, (typeof ALL_SFX)[number]>;
const exhaustive: [Missing] extends [never] ? true : false = true;

const ALL_TRACKS = ['title', 'menu', 'sneak', 'report', 'none'] as const satisfies readonly MusicTrack[];
type MissingTrack = Exclude<MusicTrack, (typeof ALL_TRACKS)[number]>;
const exhaustiveTracks: [MissingTrack] extends [never] ? true : false = true;

describe('audio contract', () => {
  it('the lists above cover the whole contract', () => {
    expect(exhaustive && exhaustiveTracks).toBe(true);
  });

  it('every SfxName has a recipe and sane metadata, and nothing extra', () => {
    expect(new Set(SFX_NAMES)).toEqual(new Set(ALL_SFX));
    for (const n of ALL_SFX) {
      expect(typeof SFX[n]).toBe('function');
      const m = SFX_META[n];
      expect(m.level).toBeGreaterThan(0);
      expect(m.level).toBeLessThanOrEqual(1);
      expect(m.maxVoices).toBeGreaterThanOrEqual(1);
      expect(m.jitter).toBeLessThan(0.2);
    }
    // Footsteps are spammy and low priority; the endings always win.
    for (const n of ['step', 'squeak'] as const) {
      expect(SFX_META[n].cooldown).toBeGreaterThanOrEqual(0.05);
      expect(SFX_META[n].priority).toBe(0);
    }
    for (const n of ['success', 'detention', 'busted', 'bell'] as const) expect(SFX_META[n].priority).toBe(3);
    for (const n of ['uiMove', 'uiConfirm', 'item', 'success', 'paChime', 'bell', 'detention'] as const) expect(SFX_META[n].jitter).toBe(0);
  });

  it('every effect schedules on a context and reports a finite end after its start', () => {
    const ctx = bareContext();
    const mix = buildMixer(ctx);
    for (const n of ALL_SFX) {
      for (const pitch of [0.8, 1, 1.7]) {
        const end = playSfx(ctx, mix.sfx, n, 1, { pitch, echo: mix.echo });
        expect(Number.isFinite(end), n).toBe(true);
        expect(end, n).toBeGreaterThan(1);
        expect(end, n).toBeLessThan(1 + 8);
      }
    }
  });

  it('every track and the ambience schedule without throwing', () => {
    const ctx = bareContext();
    const mix = buildMixer(ctx);
    for (const t of ['title', 'menu', 'sneak', 'report'] as const) {
      for (const i of [0, 0.5, 1]) new MusicPlayer(ctx, mix.music, t, 0, { intensity: i }).pump(20);
    }
    const bed = new SchoolBed(ctx, mix.ambBed, 0, 0.6);
    bed.pump(30, 0);
    bed.setLevel(0.2, 1);
    bed.stop(2, 0.5);
  });
});

describe('songs', () => {
  it('four original songs with intros and loops; every bar arranges into in-range notes', () => {
    for (const id of ['title', 'menu', 'sneak', 'report'] as const) {
      const s = SONGS[id];
      expect(s.id).toBe(id);
      expect(introBars(s)).toBeGreaterThan(0);
      expect(loopBars(s)).toBeGreaterThanOrEqual(8);
      const out: NoteEvent[] = [];
      for (let bar = 0; bar < introBars(s) + loopBars(s) * 2; bar++) {
        for (const lvl of [0, 1, 2] as const) {
          out.length = 0;
          arrangeBar(s, bar, layersFor(s, bar, lvl), out);
          for (const e of out) {
            expect(e.step).toBeGreaterThanOrEqual(0);
            expect(e.step).toBeLessThan(16);
            expect(e.vel).toBeGreaterThan(0);
            expect(e.vel).toBeLessThanOrEqual(1.2);
            if (e.inst !== 'kick' && e.inst !== 'snare' && e.inst !== 'clap' && e.inst !== 'hat' && e.inst !== 'openHat' && e.inst !== 'crash' && e.chord === undefined) {
              expect(e.midi).toBeGreaterThanOrEqual(24);
              expect(e.midi).toBeLessThanOrEqual(108);
            }
          }
        }
      }
    }
  });

  it('the sneak track gets busier and faster with suspicion', () => {
    const bar = introBars(SNEAK_SONG) + 1;
    const count = (lvl: 0 | 1 | 2): number => {
      const out: NoteEvent[] = [];
      arrangeBar(SNEAK_SONG, bar, layersFor(SNEAK_SONG, bar, lvl), out);
      return out.length;
    };
    expect(count(1)).toBeGreaterThan(count(0));
    expect(count(2)).toBeGreaterThan(count(1));
    expect(layersFor(SNEAK_SONG, bar, 0).drums).toBe('none');
    expect(layersFor(SNEAK_SONG, bar, 2).drums).toBe('four');
    expect(eventTempo(2)).toBeGreaterThan(eventTempo(1));
    expect(eventTempo(1)).toBeGreaterThanOrEqual(eventTempo(0));
    // Levels with hysteresis.
    expect(intensityLevel(0, 0)).toBe(0);
    expect(intensityLevel(EVENT_THRESHOLDS.mid + 0.01, 0)).toBe(1);
    expect(intensityLevel(EVENT_THRESHOLDS.mid - 0.02, 1)).toBe(1);
    expect(intensityLevel(1, 0)).toBe(2);
  });
});
