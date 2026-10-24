import { describe, expect, it } from 'vitest';
import { fcos, fsin } from '../../src/core/fmath';
import { generateSchool } from '../../src/school/gen';
import { BTN_INTERACT, createSim, missionGoals, step, type RunConfig, type SimEvent, type SimState } from '../../src/sim';
import { lineOfSight } from '../../src/sim/detect';

const idle = { moveX: 0, moveY: 0, buttons: 0 };

function setup(difficulty: RunConfig['difficulty']): SimState {
  const config: RunConfig = { seed: 3, mission: 'phone', tier: 2, difficulty, daily: null };
  const plan = generateSchool(config);
  plan.zones.length = 0; // fully lit halls: dim zones (correctly) slow spotting a lot, which isn't under test here
  return createSim(plan, config);
}

/** Park the student 3 m in front of the first patroller, in plain sight, and freeze the patrol there. */
function inFront(s: SimState): number {
  const i = s.plan.staff.findIndex((p) => p.archetype === 'patroller');
  const st = s.staff[i]!;
  st.dwell = 1 << 20;
  for (let d = 3; d >= 1; d -= 0.5) {
    const x = st.x + fsin(st.look) * d;
    const z = st.z + fcos(st.look) * d;
    if (lineOfSight(s.plan.fine, st.x, st.z, x, z, false)) {
      s.student.x = x;
      s.student.z = z;
      return i;
    }
  }
  throw new Error('no clear spot in front of the patroller');
}

function run(s: SimState, ticks: number): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < ticks; t++) all.push(...step(s, idle));
  return all;
}

describe('run rules', () => {
  it('standing in a cone fills suspicion; the hall pass forgives the first catch', () => {
    const s = setup('junior');
    expect(s.passes).toBe(1);
    const i = inFront(s);
    const ev = run(s, 60 * 5);
    expect(ev.some((e) => e.t === 'suspicion' && e.staff === i && e.level === 'curious')).toBe(true);
    // Whoever filled up first (another teacher may be watching the same spot) — the pass is spent on them.
    expect(ev.find((e) => e.t === 'caught')).toMatchObject({ t: 'caught', passUsed: true });
    expect(s.passes).toBe(0);
  });

  it('without a pass you are BUSTED: walked back to the checkpoint, bell time lost; 3 catches = DETENTION', () => {
    const s = setup('senior');
    expect(s.passes).toBe(0);
    for (let k = 1; k <= 3; k++) {
      inFront(s);
      const bellBefore = s.bell;
      const ev = run(s, 60 * 7);
      expect(ev.some((e) => e.t === 'caught' && !e.passUsed)).toBe(true);
      expect(s.catches).toBe(k);
      if (k < 3) {
        expect(ev.some((e) => e.t === 'escortDone')).toBe(true);
        const start = s.plan.anchors.start!;
        expect(Math.hypot(s.student.x - start.x, s.student.z - start.z)).toBeLessThan(0.01);
        expect(bellBefore - s.bell).toBeGreaterThanOrEqual(10 * 60);
      }
    }
    expect(s.phase).toBe('detention');
  });

  it('grab the goal, get back to your seat: success', () => {
    const s = setup('freshman');
    const [goal] = missionGoals(s.plan);
    const g = s.plan.anchors[goal!]!;
    s.student.x = g.x;
    s.student.z = g.z;
    const ev = step(s, { moveX: 0, moveY: 0, buttons: BTN_INTERACT });
    expect(ev).toContainEqual({ t: 'pickup', anchor: 'goal' });
    const a = s.plan.anchors.start!;
    s.student.x = a.x;
    s.student.z = a.z;
    const end = step(s, idle);
    expect(end).toContainEqual({ t: 'end', phase: 'success' });
  });

  it('the bell ends the run', () => {
    const s = setup('freshman');
    s.bell = 3;
    const ev = run(s, 5);
    expect(ev).toContainEqual({ t: 'end', phase: 'timeout' });
  });
});
