import { describe, expect, it } from 'vitest';
import { FALLBACK_SEEDS, generateSchool, planHash } from '../../src/school/gen';
import { floodOpen } from '../../src/school/gen/fine';
import { TIERS } from '../../src/school/tiers';
import { CELL_CORRIDOR, FINE, MISSION_IDS, type TierId } from '../../src/school/types';

const TIER_IDS = [1, 2, 3, 4, 5] as const satisfies readonly TierId[];

describe('generateSchool', () => {
  it('is deterministic: same config, same plan', () => {
    for (const tier of TIER_IDS) {
      const a = generateSchool({ seed: 1234, tier, mission: 'phone' });
      const b = generateSchool({ seed: 1234, tier, mission: 'phone' });
      expect(planHash(a)).toBe(planHash(b));
      expect(a.name).toBe(b.name);
    }
  });

  it('different seeds give different schools', () => {
    const hashes = new Set<number>();
    for (let s = 0; s < 20; s++) hashes.add(planHash(generateSchool({ seed: s, tier: 2, mission: 'phone' })));
    expect(hashes.size).toBe(20);
  });

  it('fallback seeds generate without falling back, for every mission', () => {
    for (const tier of TIER_IDS) {
      for (const mission of MISSION_IDS) {
        const p = generateSchool({ seed: FALLBACK_SEEDS[tier], tier, mission });
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
          const p = generateSchool({ seed, tier, mission });
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
          const want = Object.values(TIERS[tier].staff).reduce((s, v) => s + (v ?? 0), 0);
          // Listener needs a library; every other archetype always places.
          expect(p.staff.length).toBeGreaterThanOrEqual(want - (TIERS[tier].staff.listener ?? 0));
          expect(Array.from(p.cells).some((v) => v === CELL_CORRIDOR)).toBe(true);
        }
      }
    }
    // Health of the generator: falling back should be rare, re-rolls cheap.
    expect(fallbacks / n).toBeLessThan(0.01);
    expect(rerolls / n).toBeLessThan(6);
  });
});
