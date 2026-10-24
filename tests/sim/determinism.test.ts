import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { generateSchool } from '../../src/school/gen';
import { BTN_SNEAK, BTN_SPRINT, createSim, hashState, replay, step, type RunConfig, type TickInput } from '../../src/sim';

function randomInputs(seed: number, n: number): TickInput[] {
  const rng = new Rng(seed);
  const out: TickInput[] = [];
  let cur: TickInput = { moveX: 0, moveY: 0, buttons: 0 };
  for (let i = 0; i < n; i++) {
    if (i % 30 === 0) {
      cur = {
        moveX: rng.int(-127, 127),
        moveY: rng.int(-127, 127),
        buttons: (rng.chance(0.3) ? BTN_SNEAK : 0) | (rng.chance(0.2) ? BTN_SPRINT : 0),
      };
    }
    out.push(cur);
  }
  return out;
}

describe('sim determinism', () => {
  it('same plan + config + inputs → same state hash at every second', () => {
    for (const tier of [1, 2, 4] as const) {
      const config: RunConfig = { seed: 99, mission: 'phone', tier, difficulty: 'junior', daily: null };
      const plan = generateSchool(config);
      const inputs = randomInputs(tier * 7, 60 * 90);
      const a = createSim(plan, config);
      const b = createSim(generateSchool(config), config);
      for (let i = 0; i < inputs.length; i++) {
        step(a, inputs[i]!);
        step(b, inputs[i]!);
        if (i % 60 === 0) expect(hashState(a)).toBe(hashState(b));
      }
      expect(hashState(replay(plan, config, inputs))).toBe(hashState(a));
    }
  });

  it('the student never ends up inside a wall', () => {
    const config: RunConfig = { seed: 5, mission: 'phone', tier: 3, difficulty: 'freshman', daily: null };
    const plan = generateSchool(config);
    const s = createSim(plan, config);
    const inputs = randomInputs(3, 60 * 120);
    for (const input of inputs) {
      step(s, input);
      const c = Math.floor(s.student.x / 0.5);
      const r = Math.floor(s.student.z / 0.5);
      expect(plan.fine.flags[r * plan.fine.cols + c]! & 3).toBe(0);
    }
  });

  it('staff stay on open floor while following their routes', () => {
    const config: RunConfig = { seed: 21, mission: 'vending', tier: 4, difficulty: 'senior', daily: null };
    const plan = generateSchool(config);
    const s = createSim(plan, config);
    for (let i = 0; i < 60 * 60; i++) {
      step(s, { moveX: 0, moveY: 0, buttons: 0 });
      for (const st of s.staff) {
        if (st.archetype === 'sweeper') continue;
        const c = Math.floor(st.x / 0.5);
        const r = Math.floor(st.z / 0.5);
        expect(plan.fine.flags[r * plan.fine.cols + c]! & 3).toBe(0);
      }
    }
  });
});
