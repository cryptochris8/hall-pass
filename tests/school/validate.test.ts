// M2: the fairness validator and its agreement with the real sim (docs/ARCHITECTURE.md §13).
import { describe, expect, it } from 'vitest';
import { generateSchool } from '../../src/school/gen';
import { CLEARANCE, validatePlan } from '../../src/school/validate';
import type { TierId } from '../../src/school/types';
import { createSim, step, type SimEvent } from '../../src/sim';
import { createBot } from '../../src/sim/bot';

const TIERS: TierId[] = [1, 2, 3, 4, 5];

describe('fairness validator', () => {
  it('every generated school ships with a route inside the bell budget', { timeout: 120000 }, () => {
    for (const tier of TIERS) {
      for (const seed of [31, 32]) {
        const plan = generateSchool({ seed, tier, mission: 'phone', difficulty: 'junior' });
        expect(plan.referenceRoute, `tier ${tier} seed ${seed}`).not.toBeNull();
        const r = plan.referenceRoute!;
        expect(r[0]!.tick).toBe(0);
        expect(r.at(-1)!.tick).toBeLessThanOrEqual(CLEARANCE.junior.budget * plan.bellTicks);
        expect(r.some((p) => p.interact)).toBe(true);
      }
    }
  });

  it('is deterministic', { timeout: 60000 }, () => {
    const plan = generateSchool({ seed: 5, tier: 3, mission: 'locker', difficulty: 'senior', validate: false });
    const a = validatePlan(plan, 'senior');
    const b = validatePlan(plan, 'senior');
    expect(JSON.stringify(a.route)).toBe(JSON.stringify(b.route));
  });

  it('agrees with the sim: the bot on the route is never seen or heard and makes it back', { timeout: 300000 }, () => {
    for (const tier of TIERS) {
      for (const difficulty of ['freshman', 'senior'] as const) {
        const config = { seed: 40 + tier, mission: 'phone' as const, tier, difficulty, daily: null };
        const plan = generateSchool(config);
        expect(plan.referenceRoute).not.toBeNull();
        const s = createSim(plan, config);
        const bot = createBot(plan, { skill: 1 });
        const ev: SimEvent[] = [];
        while (s.phase === 'playing') ev.push(...step(s, bot.decide(s)));
        const label = `tier ${tier} ${difficulty}`;
        expect(s.phase, label).toBe('success');
        expect(ev.filter((e) => e.t === 'heard'), label).toHaveLength(0);
        expect(ev.filter((e) => e.t === 'suspicion' && e.level !== 'calm'), label).toHaveLength(0);
      }
    }
  });
});
