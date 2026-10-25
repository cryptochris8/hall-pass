// M4 mission twists (docs/GDD.md §7): the 6 s vending purchase, PIZZA DAY's lunch bell and shoo, snack packs,
// Hargrove's ears and temper, the secretary's coffee walk.
import { describe, expect, it } from 'vitest';
import { generateSchool } from '../../src/school/gen';
import { BTN_INTERACT, createSim, step, type RunConfig, type SimEvent, type SimState, type TickInput } from '../../src/sim';
import { MISSION_RULES, NOISE, hargroveIndex, hearingOf, lunchTick } from '../../src/sim/tuning';

const idle: TickInput = { moveX: 0, moveY: 0, buttons: 0 };
const press: TickInput = { moveX: 0, moveY: 0, buttons: BTN_INTERACT };

function sim(mission: RunConfig['mission'], seed = 11, tier: RunConfig['tier'] = 1): SimState {
  const config: RunConfig = { seed, mission, tier, difficulty: 'junior', daily: null };
  const plan = generateSchool({ ...config, validate: false });
  return createSim(plan, config);
}

/** Staff out of the way (far corner, deaf to it all) so a rule can be tested on its own. */
function clearStaff(s: SimState): void {
  for (const st of s.staff) {
    st.x = 1;
    st.z = 1;
    st.dwell = 1 << 20;
    st.ignore = 1 << 20;
  }
}

function run(s: SimState, input: TickInput, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let i = 0; i < ticks && s.phase === 'playing'; i++) all.push(...step(s, input));
  return all;
}

describe('VENDING RUN', () => {
  it('a purchase takes 6 s of standing still, rattling once a second, then counts', () => {
    const s = sim('vending');
    clearStaff(s);
    const g = s.plan.anchors.goal!;
    s.student.x = g.x;
    s.student.z = g.z;
    const ev = run(s, press, 1);
    expect(ev.some((e) => e.t === 'buy' && e.on)).toBe(true);
    expect(s.student.buying).toBeGreaterThan(0);
    expect(s.collected).toEqual([]);
    const during = run(s, idle, MISSION_RULES.buySeconds * 60 - 2);
    expect(during.filter((e) => e.t === 'noise' && e.source === 'vending').length).toBeGreaterThanOrEqual(MISSION_RULES.buySeconds - 1);
    expect(s.collected).toEqual([]);
    const end = run(s, idle, 2);
    expect(end.some((e) => e.t === 'buy' && e.done)).toBe(true);
    expect(s.collected).toEqual(['goal']);
    expect(s.student.buying).toBe(0);
  });

  it('walking off cancels it (and the chips stay in the machine)', () => {
    const s = sim('vending');
    clearStaff(s);
    const g = s.plan.anchors.goal!;
    s.student.x = g.x;
    s.student.z = g.z;
    run(s, press, 1);
    run(s, idle, 60);
    const ev = run(s, { moveX: 127, moveY: 0, buttons: 0 }, 1);
    expect(ev.some((e) => e.t === 'buy' && !e.on && !e.done)).toBe(true);
    expect(s.stats.buysCancelled).toBe(1);
    run(s, idle, 400);
    expect(s.collected).toEqual([]);
  });

  it('the student is frozen while buying', () => {
    const s = sim('vending');
    clearStaff(s);
    const g = s.plan.anchors.goal!;
    s.student.x = g.x;
    s.student.z = g.z;
    run(s, press, 1);
    const x = s.student.x;
    const z = s.student.z;
    run(s, { moveX: 20, moveY: 20, buttons: 0 }, 30); // a nudge below the cancel threshold
    expect([s.student.x, s.student.z]).toEqual([x, z]);
  });
});

describe('PIZZA DAY', () => {
  it('the counter shoos you off until the lunch bell; then the first pick-up inside the window is first in line', () => {
    const s = sim('pizza');
    clearStaff(s);
    const lunch = lunchTick('pizza', s.plan.bellTicks);
    expect(lunch).toBeGreaterThan(0);
    const g = s.plan.anchors.goal!;
    s.student.x = g.x;
    s.student.z = g.z;
    const ev = run(s, idle, 1);
    expect(ev.some((e) => e.t === 'shoo')).toBe(true);
    expect(Math.hypot(s.student.x - g.x, s.student.z - g.z)).toBeGreaterThan(MISSION_RULES.shooRadius);
    expect(s.student.frozen).toBeGreaterThan(0);
    // Wait for the bell, then walk up and grab it.
    const bell = run(s, idle, lunch - s.tick);
    expect(bell.some((e) => e.t === 'lunchBell')).toBe(true);
    s.student.x = g.x;
    s.student.z = g.z;
    run(s, idle, 1);
    run(s, press, 1);
    expect(s.collected).toEqual(['goal']);
    expect(s.stats.firstInLine).toBe(true);
  });

  it('too late is not first in line (but still counts)', () => {
    const s = sim('pizza');
    clearStaff(s);
    const lunch = lunchTick('pizza', s.plan.bellTicks);
    run(s, idle, lunch + MISSION_RULES.firstWindow * 60 + 30);
    const g = s.plan.anchors.goal!;
    s.student.x = g.x;
    s.student.z = g.z;
    run(s, press, 1);
    expect(s.collected).toEqual(['goal']);
    expect(s.stats.firstInLine).toBe(false);
  });
});

describe('snacks', () => {
  it('every school has snack packs, off the reference route; walking over one picks it up', () => {
    const config: RunConfig = { seed: 21, mission: 'locker', tier: 2, difficulty: 'junior', daily: null };
    const plan = generateSchool(config);
    expect(plan.snacks.length).toBe(3);
    for (const sn of plan.snacks) for (const p of plan.referenceRoute ?? []) expect(Math.hypot(sn.x - p.x, sn.z - p.z)).toBeGreaterThanOrEqual(5);
    const s = createSim(plan, config);
    clearStaff(s);
    s.student.x = plan.snacks[1]!.x;
    s.student.z = plan.snacks[1]!.z;
    const ev = run(s, idle, 1);
    expect(ev).toContainEqual({ t: 'snack', index: 1 });
    expect(s.stats.snacks).toBe(1);
    expect(run(s, idle, 5).some((e) => e.t === 'snack')).toBe(false);
  });
});

describe("PRINCIPAL'S OFFICE", () => {
  it('Hargrove is on the roster at every school, hears double, and speeds up each time he spots you', () => {
    for (const tier of [1, 2, 3, 4, 5] as const) {
      const s = sim('principal', 3, tier);
      const h = hargroveIndex(s.plan);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(hearingOf(s.plan, h)).toBe(NOISE.hearing.investigator * MISSION_RULES.hargroveHearing);
    }
    // Speed: run him along his route with and without heat.
    const a = sim('principal', 3, 2);
    const b = sim('principal', 3, 2);
    const h = hargroveIndex(a.plan);
    a.staff[h]!.mode = 'return';
    b.staff[h]!.mode = 'return';
    for (const s of [a, b]) {
      const st = s.staff[h]!;
      st.path = [st.x + 30, st.z];
      st.pathI = 0;
      st.ignore = 1 << 20;
    }
    b.staff[h]!.heat = 3;
    a.staff[h]!.dwell = b.staff[h]!.dwell = 0;
    const x0 = a.staff[h]!.x;
    run(a, idle, 30);
    run(b, idle, 30);
    expect(Math.abs(b.staff[h]!.x - x0)).toBeGreaterThan(Math.abs(a.staff[h]!.x - x0) * 1.2);
  });
});

describe('PHONE JAIL', () => {
  it('the secretary starts beside the drawer and later walks out of the office', () => {
    const s = sim('phone', 5, 2);
    const i = s.plan.staff.findIndex((sp) => sp.skin === 'secretary0');
    expect(i).toBeGreaterThanOrEqual(0);
    const g = s.plan.anchors.goal!;
    const st = s.staff[i]!;
    expect(Math.hypot(st.x - g.x, st.z - g.z)).toBeLessThan(2.3);
    let far = 0;
    for (let t = 0; t < s.plan.bellTicks && s.phase === 'playing'; t++) {
      step(s, idle);
      far = Math.max(far, Math.hypot(st.x - g.x, st.z - g.z));
    }
    expect(far).toBeGreaterThan(8);
  });
});
