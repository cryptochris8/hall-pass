// M3 stealth behaviour: notice → chase → catch, losing them, hiding, throwing, hearing, cameras, Preston, PA.
import { describe, expect, it } from 'vitest';
import { fcos, fsin } from '../../src/core/fmath';
import { generateSchool } from '../../src/school/gen';
import { FINE, F_LOW, F_SOLID, type Archetype, type SchoolPlan } from '../../src/school/types';
import { BTN_INTERACT, BTN_SPRINT, BTN_THROW, createSim, hideFront, step, type RunConfig, type SimEvent, type SimState, type TickInput } from '../../src/sim';
import { lineOfSight } from '../../src/sim/detect';

const idle: TickInput = { moveX: 0, moveY: 0, buttons: 0 };

function sim(tier: RunConfig['tier'], seed: number, difficulty: RunConfig['difficulty'] = 'junior', mission: RunConfig['mission'] = 'phone'): SimState {
  const config: RunConfig = { seed, mission, tier, difficulty, daily: null };
  const plan = generateSchool(config);
  plan.zones.length = 0; // lit, ordinary floors: zones are tested elsewhere
  return createSim(plan, config);
}

function open(plan: SchoolPlan, x: number, z: number): boolean {
  const c = Math.floor(x / FINE);
  const r = Math.floor(z / FINE);
  return (plan.fine.flags[r * plan.fine.cols + c]! & (F_SOLID | F_LOW)) === 0;
}

/** Freeze staff `i` where it stands (long dwell, looking where it looks) and put the student `d` m in front of it. */
function inFront(s: SimState, i: number, d0 = 3.5): boolean {
  const st = s.staff[i]!;
  st.dwell = 1 << 20;
  s.plan.staff[i]!.route[st.wp]!.sweep = 0;
  for (let d = d0; d >= 1.5; d -= 0.5) {
    const x = st.x + fsin(st.look) * d;
    const z = st.z + fcos(st.look) * d;
    if (open(s.plan, x, z) && lineOfSight(s.plan.fine, st.x, st.z, x, z, true)) {
      s.student.x = x;
      s.student.z = z;
      return true;
    }
  }
  return false;
}

/** Keep every other staff member out of the way (park them far off with their backs turned and frozen). */
function isolate(s: SimState, keep: number): void {
  s.staff.forEach((st, k) => {
    if (k === keep) return;
    st.x = -500;
    st.z = -500;
    st.dwell = 1 << 20;
  });
}

function find(s: SimState, a: Archetype): number {
  return s.plan.staff.findIndex((p) => p.archetype === a);
}

function run(s: SimState, ticks: number, input: TickInput = idle): SimEvent[] {
  const all: SimEvent[] = [];
  for (let t = 0; t < ticks && s.phase === 'playing'; t++) all.push(...step(s, input));
  return all;
}

describe('notice → chase → catch', () => {
  it('a patroller who sees you stares, then chases and catches you on contact (hall pass spent)', () => {
    const s = sim(2, 3);
    const i = find(s, 'patroller');
    isolate(s, i);
    expect(inFront(s, i)).toBe(true);
    const ev = run(s, 60 * 8);
    const notice = ev.findIndex((e) => e.t === 'suspicion' && e.staff === i && e.level === 'searching');
    const chase = ev.findIndex((e) => e.t === 'chase' && e.staff === i && e.on);
    const caught = ev.findIndex((e) => e.t === 'caught' && e.staff === i);
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(chase).toBeGreaterThan(notice);
    expect(caught).toBeGreaterThan(chase);
    expect(ev[caught]).toMatchObject({ passUsed: true });
    expect(['return', 'route']).toContain(s.staff[i]!.mode);
  });

  it('breaking line of sight sends them searching, then back to their route — and counts as getting away', () => {
    const s = sim(2, 3);
    const i = find(s, 'patroller');
    isolate(s, i);
    expect(inFront(s, i)).toBe(true);
    for (let t = 0; t < 60 * 6 && s.staff[i]!.mode !== 'chase'; t++) step(s, idle);
    expect(s.staff[i]!.mode).toBe('chase');
    // Vanish far away behind walls.
    const start = s.plan.anchors.start!;
    s.student.x = start.x;
    s.student.z = start.z;
    s.staff[i]!.lastX = s.staff[i]!.x;
    s.staff[i]!.lastZ = s.staff[i]!.z;
    const later = run(s, 60 * 20);
    expect(later.some((e) => e.t === 'chase' && e.staff === i && !e.on && e.escaped)).toBe(true);
    expect(['return', 'route']).toContain(s.staff[i]!.mode);
    expect(s.escapes).toBeGreaterThanOrEqual(1);
  });
});

describe('hiding', () => {
  it('climbing into a hide spot makes you invisible beyond arm’s length; interact again to come out', () => {
    for (let seed = 1; seed < 40; seed++) {
      const s = sim(2, seed);
      const k = s.plan.furniture.findIndex((f) => f.tags.includes('hide'));
      if (k < 0) continue;
      const p = hideFront(s.plan.furniture[k]!);
      if (!open(s.plan, p.x, p.z)) continue;
      isolate(s, -1);
      s.student.x = p.x;
      s.student.z = p.z;
      const ev = step(s, { moveX: 0, moveY: 0, buttons: BTN_INTERACT });
      expect(ev).toContainEqual({ t: 'hide', spot: k, enter: true });
      expect(s.student.hidden).toBe(k);
      // A patroller right there looking at you from 3 m: nothing.
      const i = find(s, 'patroller');
      const st = s.staff[i]!;
      st.x = p.x + 3;
      st.z = p.z;
      st.look = -Math.PI / 2;
      st.yaw = st.look;
      st.dwell = 1 << 20;
      run(s, 60);
      expect(st.suspicion).toBe(0);
      step(s, idle);
      const out = step(s, { moveX: 0, moveY: 0, buttons: BTN_INTERACT });
      expect(out).toContainEqual({ t: 'hide', spot: k, enter: false });
      expect(s.student.hidden).toBe(-1);
      return;
    }
    throw new Error('no usable hide spot found');
  });
});

describe('distractions and noise', () => {
  it('a thrown eraser lands with a noise that sends a nearby patroller to look', () => {
    const s = sim(2, 3);
    const i = find(s, 'patroller');
    isolate(s, i);
    const st = s.staff[i]!;
    st.dwell = 1 << 20;
    // Stand 6 m behind the patroller (out of its cone) facing it, and throw past it.
    const bx = st.x - fsin(st.look) * 6;
    const bz = st.z - fcos(st.look) * 6;
    expect(open(s.plan, bx, bz)).toBe(true);
    s.student.x = bx;
    s.student.z = bz;
    s.student.yaw = st.look;
    s.student.carry = 1;
    const ev = run(s, 1, { moveX: 0, moveY: 0, buttons: BTN_THROW });
    expect(ev.some((e) => e.t === 'throw')).toBe(true);
    expect(s.student.carry).toBe(0);
    const later = run(s, 40);
    expect(later.some((e) => e.t === 'noise' && e.source === 'throw')).toBe(true);
    expect(later.some((e) => e.t === 'heard' && e.staff === i)).toBe(true);
    expect(s.staff[i]!.mode).toBe('investigate');
  });

  it('sprinting near someone with their back turned gets heard; sneaking does not', () => {
    for (const [buttons, heard] of [
      [BTN_SPRINT, true],
      [0, false],
    ] as const) {
      const s = sim(2, 3);
      const i = find(s, 'patroller');
      isolate(s, i);
      const st = s.staff[i]!;
      st.dwell = 1 << 20;
      s.student.x = st.x - fsin(st.look) * 3.5;
      s.student.z = st.z - fcos(st.look) * 3.5;
      // Run on the spot-ish: tiny stick moves toward the patroller's side, then away.
      const mx = Math.round(fsin(st.look + Math.PI / 2) * 127);
      const my = -Math.round(fcos(st.look + Math.PI / 2) * 127);
      const input = buttons === BTN_SPRINT ? { moveX: mx, moveY: my, buttons } : { moveX: Math.round(mx * 0.4), moveY: Math.round(my * 0.4), buttons };
      const ev = run(s, 20, input);
      expect(ev.some((e) => e.t === 'heard' && e.staff === i)).toBe(heard);
    }
  });
});

describe('cameras and Preston', () => {
  it('a camera that spots you calls the nearest investigator or patroller over', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = sim(2, seed);
      const cam = find(s, 'sweeper');
      if (cam < 0) continue;
      const c = s.staff[cam]!;
      s.plan.staff[cam]!.route[0]!.sweep = 0;
      run(s, 2);
      if (!inFront(s, cam, 4)) continue;
      // Keep people far from the student so only the camera sees.
      s.staff.forEach((o, k) => {
        if (k !== cam && s.plan.staff[k]!.archetype !== 'investigator' && s.plan.staff[k]!.archetype !== 'patroller') {
          o.x = -500;
          o.z = -500;
        }
      });
      void c;
      const ev = run(s, 60 * 6);
      const alert = ev.find((e) => e.t === 'cameraAlert');
      if (!alert || alert.t !== 'cameraAlert') continue;
      expect(['investigator', 'patroller']).toContain(s.plan.staff[alert.to]!.archetype);
      return;
    }
    throw new Error('no camera set-up found');
  });

  it('Preston runs to the nearest adult and tells on you', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = sim(2, seed);
      const i = find(s, 'snitch');
      if (i < 0 || !inFront(s, i, 3)) continue;
      const ev = run(s, 60 * 20);
      const rep = ev.find((e) => e.t === 'report');
      if (!rep || rep.t !== 'report') continue;
      expect(rep.staff).toBe(i);
      expect(ev.some((e) => e.t === 'chase' && e.staff === i)).toBe(false); // he never chases
      return;
    }
    throw new Error('no report happened');
  });
});

describe('PA announcements', () => {
  it('are scheduled in every plan and send the right staff member on an errand', () => {
    let errands = 0;
    for (let seed = 0; seed < 30; seed++) {
      const config: RunConfig = { seed, mission: 'phone', tier: 3, difficulty: 'junior', daily: null };
      const plan = generateSchool(config);
      expect(plan.pa.length).toBeGreaterThanOrEqual(1);
      expect(plan.pa.every((p, k) => k === 0 || p.tick > plan.pa[k - 1]!.tick)).toBe(true);
      const s = createSim(plan, config, { absent: true });
      for (const pa of plan.pa) {
        while (s.tick < pa.tick) step(s, idle);
        const who = pa.id === 'vpToOffice' ? 'investigator' : pa.id === 'custodialToGym' ? 'wanderer' : pa.id === 'carLights' ? 'patroller' : null;
        if (!who) continue;
        const k = plan.staff.findIndex((p) => p.archetype === who);
        expect(s.staff[k]!.mode).toBe('errand');
        errands++;
      }
    }
    expect(errands).toBeGreaterThan(10);
  });

  it('with no student, nobody ever notices, chases or investigates anything', () => {
    const config: RunConfig = { seed: 9, mission: 'phone', tier: 4, difficulty: 'senior', daily: null };
    const plan = generateSchool(config);
    const s = createSim(plan, config, { absent: true });
    const ev = run(s, plan.bellTicks - 1);
    expect(ev.some((e) => e.t === 'chase' || e.t === 'heard' || e.t === 'suspicion' || e.t === 'caught')).toBe(false);
  });
});
