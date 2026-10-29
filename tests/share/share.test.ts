// M6 sharing: challenge codes, ghost recordings (exact replay), the ghost store, the share card.
import { describe, expect, it } from 'vitest';
import { CODE_ALPHABET, CODE_SEED_MAX, decodeCode, encodeCode } from '../../src/core/code';
import { generateSchool } from '../../src/school/gen';
import { DIFFICULTIES, MISSION_IDS, type TierId } from '../../src/school/types';
import { drawFloorPlan, planPicture, shareText, type Canvas2D } from '../../src/share/card';
import { decodeInputs, Recorder, validRecording } from '../../src/share/ghost';
import { createSim, hashState, replay, step, type RunConfig } from '../../src/sim';
import { createBot } from '../../src/sim/bot';
import { hallReport } from '../../src/sim/score';
import { GhostStore, ghostKey, MAX_GHOSTS } from '../../src/storage';

describe('challenge codes', () => {
  it('round-trips every mission × tier × difficulty, and seeds at the edges', () => {
    for (const mission of MISSION_IDS) {
      for (const tier of [1, 2, 3, 4, 5] as TierId[]) {
        for (const difficulty of DIFFICULTIES) {
          for (const seed of [0, 1, 4242, 0x155555, CODE_SEED_MAX]) {
            const code = encodeCode({ seed, mission, tier, difficulty });
            expect(code).toMatch(/^[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}$/);
            expect(decodeCode(code)).toEqual({ seed, mission, tier, difficulty, score: null });
          }
        }
      }
    }
  });

  it('carries an optional score; is forgiving about case, spaces and dashes', () => {
    const code = encodeCode({ seed: 777, mission: 'pizza', tier: 3, difficulty: 'senior', score: 4120 });
    expect(code).toMatch(/^...-...-4120$/);
    const plain = code.slice(0, 7);
    expect(decodeCode(code)?.score).toBe(4120);
    expect(decodeCode(plain.toLowerCase())?.seed).toBe(777);
    expect(decodeCode(plain.replace('-', ''))?.mission).toBe('pizza');
    expect(decodeCode(` ${plain.slice(0, 3)} ${plain.slice(4)} `)?.tier).toBe(3);
  });

  it('rejects anything else (no guessing at look-alike letters, nothing out of range)', () => {
    for (const bad of ['', 'H4L', 'H4L-L2', 'H4L-L222', 'H0L-L22', 'HIL-L22', 'HOL-L22', '<script>', 'ZZZ-ZZZ', 'x'.repeat(100)]) expect(decodeCode(bad), bad).toBeNull();
    // Mission index 7 is out of range: build such a value by hand.
    let v = (7 << 5) | 0;
    let s = '';
    for (let i = 0; i < 6; i++) {
      s = CODE_ALPHABET[v & 31]! + s;
      v >>>= 5;
    }
    expect(decodeCode(s)).toBeNull();
  });
});

describe('ghost recordings', () => {
  const config: RunConfig = { seed: 31, mission: 'locker', tier: 2, difficulty: 'junior', daily: null };
  const plan = generateSchool(config);

  it('a recorded run replays to the identical state', () => {
    const s = createSim(plan, config);
    const bot = createBot(plan, { skill: 0.7, seed: 5 });
    const rec = new Recorder();
    while (s.phase === 'playing') {
      const input = bot.decide(s);
      rec.push(input);
      step(s, input);
    }
    const r = rec.finish(config, 1234);
    expect(r.ticks).toBe(s.tick);
    // The bot steers with a fresh analog value most ticks (the worst case for RLE: ≤ 5 bytes a tick); a player on
    // keys holds inputs for many ticks at a time.
    expect(r.data.length).toBeLessThanOrEqual(Math.ceil((s.tick * 5 * 4) / 3) + 4);
    const keys = new Recorder();
    for (let i = 0; i < 6000; i++) keys.push({ moveX: i % 600 < 300 ? 127 : 0, moveY: 0, buttons: i % 1200 < 40 ? 4 : 0 });
    expect(keys.finish(config, 0).data.length).toBeLessThan(200);
    const again = replay(plan, config, decodeInputs(r));
    expect(again.phase).toBe(s.phase);
    expect(hashState(again)).toBe(hashState(s));
    // And through JSON (storage) too.
    const back = validRecording(JSON.parse(JSON.stringify(r)));
    expect(back).not.toBeNull();
    expect(hashState(replay(plan, config, decodeInputs(back!)))).toBe(hashState(s));
  });

  it('validRecording rejects other versions and junk', () => {
    expect(validRecording(null)).toBeNull();
    expect(validRecording({ v: 1, config: {}, ticks: 1, data: '' })).toBeNull();
    expect(validRecording({ v: 999, config: { seed: 1, tier: 1, mission: 'phone', difficulty: 'junior' }, ticks: 1, data: 'AAAA' })).toBeNull();
    const good = new Recorder();
    good.push({ moveX: 0, moveY: 0, buttons: 0 });
    const r = good.finish({ seed: 1, tier: 1, mission: 'phone', difficulty: 'junior' }, 0);
    expect(validRecording({ ...r, data: '<b>' })).toBeNull();
    expect(validRecording(r)).not.toBeNull();
  });

  it('the store keeps the best per school, a dozen at most, and survives blocked storage', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const store = new GhostStore(storage);
    const mk = (seed: number, score: number) => {
      const r = new Recorder();
      r.push({ moveX: 10, moveY: 0, buttons: 0 });
      return r.finish({ seed, tier: 1, mission: 'phone', difficulty: 'junior' }, score);
    };
    expect(store.offer(mk(1, 100))).toBe(true);
    expect(store.offer(mk(1, 50))).toBe(false);
    expect(store.offer(mk(1, 150))).toBe(true);
    expect(new GhostStore(storage).get(ghostKey({ seed: 1, tier: 1, mission: 'phone', difficulty: 'junior' }))?.score).toBe(150);
    for (let s = 2; s < 30; s++) store.offer(mk(s, 10));
    expect(new GhostStore(storage).size).toBe(MAX_GHOSTS);
    const blocked = new GhostStore({
      getItem: () => {
        throw new Error('no');
      },
      setItem: () => {
        throw new Error('no');
      },
      removeItem: () => {},
    });
    expect(blocked.size).toBe(0);
    expect(() => blocked.offer(mk(1, 1))).not.toThrow();
  });
});

describe('share card', () => {
  const config: RunConfig = { seed: 12, mission: 'phone', tier: 1, difficulty: 'junior', daily: null };
  const plan = generateSchool(config);
  const s = createSim(plan, config);
  const bot = createBot(plan, { skill: 1 });
  const path: number[] = [];
  while (s.phase === 'playing') {
    step(s, bot.decide(s));
    if (s.tick % 15 === 0) path.push(s.student.x, s.student.z);
  }
  const r = hallReport(s, 4000);

  it('three lines: header, the run, the code', () => {
    const t = shareText(r, plan.name, 'H4L-L22-4120', 55);
    const lines = t.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(`HALL PASS #55  ·  ${plan.name}  ·  JUNIOR`);
    expect(lines[1]).toMatch(/^PHONE JAIL {2}· {2}\d+:\d\d {2}· {2}spotted \d+× {2}· {2}(GHOST|SMOOTH|CLOSE CALL) {2}· {2}(A\+|A|B|C|D)$/);
    expect(lines[2]).toBe('H4L-L22-4120');
    expect(shareText(r, plan.name, 'X', null).startsWith('HALL PASS  ·')).toBe(true);
  });

  it('draws the plan, the route and the markers onto a canvas without touching the DOM', () => {
    const calls: string[] = [];
    const g = new Proxy({} as Record<string, unknown>, {
      get: (_t, k: string) => (['fillStyle', 'strokeStyle', 'lineWidth', 'lineJoin', 'lineCap', 'font', 'textAlign', 'textBaseline'].includes(k) ? '' : (...a: unknown[]) => void calls.push(`${k}:${a.length}`)),
      set: () => true,
    }) as unknown as Canvas2D;
    const pic = planPicture(plan, 640);
    expect(pic.width).toBe(640);
    expect(pic.height).toBeGreaterThan(200);
    drawFloorPlan(g, plan, path, [path[0]!, path[1]!], 'HALL PASS · PHONE JAIL', 'GHOST · A+ · 4720 pts · H4L-L22', pic);
    expect(calls.filter((c) => c.startsWith('lineTo')).length).toBeGreaterThan(path.length / 2 - 2);
    expect(calls.filter((c) => c.startsWith('fillText')).length).toBe(3);
    expect(calls.filter((c) => c.startsWith('fillRect')).length).toBeGreaterThan(50);
  });
});
