// Hints: footprints after 20 s without progress along the route's current leg; never while hiding.
import { describe, expect, it } from 'vitest';
import { HINT_AFTER_SECONDS, HINT_LENGTH, HintTracker, hintsOn } from '../../src/game/hints';
import { generateSchool } from '../../src/school/gen';
import { createSim, step, type RunConfig } from '../../src/sim';
import { createBot } from '../../src/sim/bot';

const config: RunConfig = { seed: 21, mission: 'locker', tier: 1, difficulty: 'freshman', daily: null };
const plan = generateSchool(config);
const idle = { moveX: 0, moveY: 0, buttons: 0 };

describe('hints', () => {
  it('standing still for 20 s brings up footprints along the route, about 14 m of them', () => {
    const s = createSim(plan, config);
    const h = new HintTracker(plan.referenceRoute);
    let shown = -1;
    for (let t = 0; t < (HINT_AFTER_SECONDS + 2) * 60; t++) {
      step(s, idle);
      if (h.tick(s) && shown < 0) shown = t;
    }
    expect(shown).toBeGreaterThanOrEqual(HINT_AFTER_SECONDS * 60 - 2);
    expect(shown).toBeLessThan(HINT_AFTER_SECONDS * 60 + 5);
    const prints = h.footprints(s);
    expect(prints.length).toBeGreaterThan(8);
    expect(prints.length).toBeLessThanOrEqual(Math.ceil(HINT_LENGTH / 0.75) + 1);
    // They start near you and alternate feet.
    expect(Math.hypot(prints[0]!.x - s.student.x, prints[0]!.z - s.student.z)).toBeLessThan(3);
    expect(prints[0]!.side).not.toBe(prints[1]!.side);
  });

  it('following the route never triggers them', () => {
    const s = createSim(plan, config);
    const h = new HintTracker(plan.referenceRoute);
    const bot = createBot(plan, { skill: 1 });
    let ever = false;
    while (s.phase === 'playing') {
      step(s, bot.decide(s));
      ever ||= h.tick(s);
    }
    expect(s.phase).toBe('success');
    expect(ever).toBe(false);
  });

  it('hiding does not count as being stuck', () => {
    const s = createSim(plan, config);
    const h = new HintTracker(plan.referenceRoute);
    s.student.hidden = 0;
    for (let t = 0; t < (HINT_AFTER_SECONDS + 5) * 60; t++) h.tick(s);
    expect(h.stalledSeconds).toBe(0);
  });

  it('no route, no hints; auto means FRESHMAN only', () => {
    const s = createSim(plan, config);
    const h = new HintTracker(null);
    for (let t = 0; t < 30 * 60; t++) expect(h.tick(s)).toBe(false);
    expect(h.footprints(s)).toEqual([]);
    expect(hintsOn('auto', 'freshman')).toBe(true);
    expect(hintsOn('auto', 'junior')).toBe(false);
    expect(hintsOn('on', 'senior')).toBe(true);
    expect(hintsOn('off', 'freshman')).toBe(false);
  });
});
