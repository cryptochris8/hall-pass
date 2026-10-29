// Save data: anything read back is untrusted; storage failures never break the game.
import { describe, expect, it } from 'vitest';
import { civilDay } from '../../src/game/modes';
import type { HallReport } from '../../src/sim/score';
import { SAVE_KEY, Store, dailyStreak, defaultSave, recordKey, recordRun, sanitize } from '../../src/storage';

function memory(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const report = (total: number, grade: HallReport['grade'], rank: HallReport['rank']): HallReport => ({
  mission: 'phone',
  difficulty: 'junior',
  success: rank !== 'DETENTION',
  outcome: rank === 'DETENTION' ? 'detention' : 'success',
  rank,
  grade,
  lines: [],
  raw: total,
  multiplier: 1,
  total,
  par: 4000,
  seconds: 90,
  secondsLeft: 60,
  spotted: 0,
  caught: 0,
  remarks: [],
});

describe('save data', () => {
  it('sanitize: garbage in, a valid default out', () => {
    for (const raw of [null, 42, 'x', [], { v: 2 }, { v: 1, unlocked: 99, settings: { camera: 'drone' } }]) {
      const s = sanitize(raw);
      expect(s.v).toBe(1);
      expect(s.unlocked).toBeGreaterThanOrEqual(1);
      expect(s.unlocked).toBeLessThanOrEqual(5);
      expect(['close', 'mid', 'tactical']).toContain(s.settings.camera);
    }
    const bad = sanitize({
      v: 1,
      unlocked: 3,
      week: { tier: 9, seed: -5, day: 17, grades: ['A', 'Z', null], scores: ['lots'] },
      records: { 'phone:1:junior': { score: 1e99, grade: 'A+', rank: 'GHOST', seconds: 12 }, '<script>': { score: 1 } },
      daily: { '20261025': { first: { score: 1, grade: 'B', rank: 'SMOOTH' }, best: { score: 2, grade: 'A', rank: 'GHOST' }, attempts: 2 }, hack: {} },
    });
    expect(bad.unlocked).toBe(3);
    expect(bad.week).toMatchObject({ tier: 3, seed: 0, day: 5, grades: ['A', null, null, null, null], scores: [0, 0, 0, 0, 0] });
    expect(bad.records['phone:1:junior']!.score).toBe(1e7);
    expect(Object.keys(bad.records)).toEqual(['phone:1:junior']);
    expect(Object.keys(bad.daily)).toEqual(['20261025']);
  });

  it('round-trips through storage', () => {
    const mem = memory();
    const a = new Store(mem);
    a.data.unlocked = 2;
    a.data.settings.cones = false;
    a.save();
    expect(mem.data.has(SAVE_KEY)).toBe(true);
    const b = new Store(mem);
    expect(b.data.unlocked).toBe(2);
    expect(b.data.settings.cones).toBe(false);
    b.reset();
    expect(new Store(mem).data).toEqual(defaultSave());
  });

  it('blocked storage: nothing is remembered, nothing throws', () => {
    const boom = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => {
        throw new Error('nope');
      },
    };
    const s = new Store(boom);
    expect(s.data).toEqual(defaultSave());
    expect(() => s.save()).not.toThrow();
    expect(() => s.reset()).not.toThrow();
    expect(new Store(null).data).toEqual(defaultSave());
  });

  it('recordRun keeps bests, the first daily attempt and totals', () => {
    const s = defaultSave();
    expect(recordRun(s, report(3000, 'A', 'GHOST'), 1, 20261025, 2)).toBe(true);
    expect(recordRun(s, report(2000, 'B', 'SMOOTH'), 1, 20261025, 0)).toBe(false);
    expect(recordRun(s, report(4000, 'A+', 'GHOST'), 1, 20261025, 1)).toBe(true);
    expect(s.records[recordKey('phone', 1, 'junior')]!.score).toBe(4000);
    expect(s.daily['20261025']).toMatchObject({ attempts: 3, first: { score: 3000 }, best: { score: 4000 } });
    expect(s.totals).toEqual({ runs: 3, ghosts: 2, detentions: 0, snacks: 3, xp: 3 * 25 + (3000 + 2000 + 4000) / 20 });
  });

  it('daily streak counts consecutive days ending today or yesterday', () => {
    const s = defaultSave();
    for (const d of [20261021, 20261022, 20261023, 20261024]) recordRun(s, report(1, 'D', 'DETENTION'), 1, d, 0);
    expect(dailyStreak(s, 20261025, civilDay)).toBe(4); // today not played yet
    recordRun(s, report(1, 'D', 'DETENTION'), 1, 20261025, 0);
    expect(dailyStreak(s, 20261025, civilDay)).toBe(5);
    expect(dailyStreak(s, 20261027, civilDay)).toBe(0);
  });
});
