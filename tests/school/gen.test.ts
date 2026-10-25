import { describe, expect, it } from 'vitest';
import { FALLBACK_SEEDS, generateSchool, planHash } from '../../src/school/gen';
import { floodOpen } from '../../src/school/gen/fine';
import { TIERS } from '../../src/school/tiers';
import { CELL_CORRIDOR, FINE, MISSION_IDS, type TierId } from '../../src/school/types';

const TIER_IDS = [1, 2, 3, 4, 5] as const satisfies readonly TierId[];

describe('generateSchool', () => {
  it('is deterministic: same config, same plan', () => {
    for (const tier of TIER_IDS) {
      const a = generateSchool({ seed: 1234, tier, mission: 'phone', validate: false });
      const b = generateSchool({ seed: 1234, tier, mission: 'phone', validate: false });
      expect(planHash(a)).toBe(planHash(b));
      expect(a.name).toBe(b.name);
    }
  });

  it('a seed keeps its school name whatever the mission (one school all SCHOOL WEEK)', () => {
    for (const tier of TIER_IDS) {
      const names = new Set(MISSION_IDS.map((mission) => generateSchool({ seed: 77, tier, mission, validate: false }).name));
      expect(names.size).toBe(1);
    }
  });

  it('different seeds give different schools', () => {
    const hashes = new Set<number>();
    for (let s = 0; s < 20; s++) hashes.add(planHash(generateSchool({ seed: s, tier: 2, mission: 'phone', validate: false })));
    expect(hashes.size).toBe(20);
  });

  it('fallback seeds generate without falling back, for every mission', () => {
    for (const tier of TIER_IDS) {
      for (const mission of MISSION_IDS) {
        const p = generateSchool({ seed: FALLBACK_SEEDS[tier], tier, mission, validate: false });
        expect(p.fallback, `tier ${tier} ${mission}`).toBe(false);
      }
    }
  });

  it('every plan is connected and complete (100 seeds × tier × mission)', () => {
    let fallbacks = 0;
    let rerolls = 0;
    let n = 0;
    for (const tier of TIER_IDS) {
      for (const mission of MISSION_IDS) {
        for (let seed = 0; seed < 100; seed++) {
          const p = generateSchool({ seed, tier, mission, validate: false });
          n++;
          if (p.fallback) fallbacks++;
          rerolls += p.rerolls;
          const start = p.anchors.start!;
          expect(start).toBeDefined();
          expect(p.anchors.goal, `${tier}/${mission}/${seed} goal`).toBeDefined();
          if (mission === 'principal') {
            expect(p.anchors.goal2).toBeDefined();
            expect(p.anchors.goal3).toBeDefined();
          }
          expect(p.rooms.filter((r) => r.tags.includes('safe')).length).toBeGreaterThanOrEqual(2);
          const reach = floodOpen(p.fine, start.x, start.z);
          const ok = (x: number, z: number): boolean => reach[Math.floor(z / FINE) * p.fine.cols + Math.floor(x / FINE)] === 1;
          for (const a of Object.values(p.anchors)) expect(ok(a!.x, a!.z)).toBe(true);
          // People always place (the listener needs a library); cameras only where there's a junction away from your
          // classroom and the goal, so a school may have fewer.
          const st = TIERS[tier].staff;
          const wantPeople = Object.entries(st).reduce((s, [k, v]) => s + (k === 'sweeper' || k === 'listener' ? 0 : (v ?? 0)), 0);
          expect(p.staff.filter((s) => s.archetype !== 'sweeper' && s.archetype !== 'listener').length).toBeGreaterThanOrEqual(wantPeople);
          // GYM BAG adds the camera over your locker.
          expect(p.staff.filter((s) => s.archetype === 'sweeper').length).toBeLessThanOrEqual((st.sweeper ?? 0) + (mission === 'gym' ? 1 : 0));
          // Mission twists (GDD §7): the secretary by the drawer, the camera on the gym hall, Hargrove for the finale.
          if (mission === 'phone') expect(p.staff.some((s) => s.skin === 'secretary0')).toBe(true);
          if (mission === 'gym') {
            const g = p.anchors.goal!;
            expect(p.staff.some((s) => s.archetype === 'sweeper' && Math.hypot(s.route[0]!.x - g.x, s.route[0]!.z - g.z) < 4)).toBe(true);
          }
          if (mission === 'principal') expect(p.staff.some((s) => s.archetype === 'investigator')).toBe(true);
          expect(p.snacks.length, `${tier}/${mission}/${seed} snacks`).toBeGreaterThanOrEqual(2);
          expect(Array.from(p.cells).some((v) => v === CELL_CORRIDOR)).toBe(true);
        }
      }
    }
    // Health of the generator: falling back should be rare, re-rolls cheap.
    expect(fallbacks / n).toBeLessThan(0.01);
    expect(rerolls / n).toBeLessThan(6);
  });
});
