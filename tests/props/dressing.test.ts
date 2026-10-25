// School dressing: deterministic per plan, within the draw-call / triangle budget for every tier, wall items carry
// a wall anchor inside solid wall, and hiding a wall item hides its batched instances.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateSchool } from '../../src/school/gen';
import { FINE, F_SOLID, type TierId } from '../../src/school/types';
import { buildDressing } from '../../src/world/props';

const TIERS: TierId[] = [1, 2, 3, 4, 5];

function signature(d: ReturnType<typeof buildDressing>): string {
  const parts: string[] = [`${d.stats.meshes}|${d.stats.triangles}|${d.wallItems.length}`];
  for (const w of d.wallItems) parts.push(`${w.wallX.toFixed(3)},${w.wallZ.toFixed(3)},${w.top}`);
  d.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const p = m.geometry.getAttribute('position');
    let h = 0;
    for (let i = 0; i < p.array.length; i += 97) h = (h * 31 + Math.round((p.array[i] as number) * 1000)) | 0;
    parts.push(`${m.name}:${p.count}:${h}`);
  });
  return parts.join(';');
}

describe('buildDressing', () => {
  it('is deterministic per plan', () => {
    for (const tier of [1, 3, 5] as TierId[]) {
      const plan = generateSchool({ seed: 4242, tier, mission: 'phone' });
      const a = buildDressing(plan);
      const b = buildDressing(plan);
      expect(signature(a)).toBe(signature(b));
      a.dispose();
      b.dispose();
    }
  });

  it('differs between seeds', () => {
    const a = buildDressing(generateSchool({ seed: 1, tier: 2, mission: 'phone' }));
    const b = buildDressing(generateSchool({ seed: 2, tier: 2, mission: 'phone' }));
    expect(signature(a)).not.toBe(signature(b));
  });

  for (const tier of TIERS) {
    it(`tier ${tier}: within budget, wall anchors inside walls`, () => {
      for (const [seed, mission] of [
        [7, 'phone'],
        [99, 'gym'],
        [123, 'pizza'],
      ] as const) {
        const plan = generateSchool({ seed, tier, mission });
        const d = buildDressing(plan);
        let meshes = 0;
        d.root.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) meshes++;
        });
        expect(meshes).toBe(d.stats.meshes);
        expect(d.stats.meshes, 'draw calls').toBeLessThanOrEqual(60);
        expect(d.stats.triangles, 'triangles').toBeLessThanOrEqual(150_000);
        expect(d.stats.triangles).toBeGreaterThan(5_000);
        expect(d.wallItems.length).toBeGreaterThan(plan.rooms.length);
        for (const w of d.wallItems) {
          const c = Math.floor(w.wallX / FINE);
          const r = Math.floor(w.wallZ / FINE);
          expect(plan.fine.flags[r * plan.fine.cols + c]! & F_SOLID, `anchor ${w.wallX},${w.wallZ}`).toBe(F_SOLID);
          expect(w.top).toBeGreaterThan(0.5);
          expect(w.top).toBeLessThanOrEqual(3.0001);
        }
        d.dispose();
      }
    });
  }

  it('hiding a wall item hides its batched instances', () => {
    const d = buildDressing(generateSchool({ seed: 7, tier: 2, mission: 'phone' }));
    const batches: THREE.BatchedMesh[] = [];
    d.root.traverse((o) => {
      if ((o as THREE.BatchedMesh).isBatchedMesh) batches.push(o as THREE.BatchedMesh);
    });
    expect(batches.length).toBeGreaterThan(0);
    const hiddenCount = () => {
      let n = 0;
      for (const b of batches) for (let i = 0; i < b.instanceCount; i++) if (!b.getVisibleAt(i)) n++;
      return n;
    };
    expect(hiddenCount()).toBe(0);
    for (const w of d.wallItems) w.object.visible = false;
    expect(hiddenCount()).toBeGreaterThanOrEqual(d.wallItems.length);
    for (const w of d.wallItems) w.object.visible = true;
    expect(hiddenCount()).toBe(0);
    expect(d.wallItems[0]!.object.visible).toBe(true);
  });

  it('prints a tier-4 report', () => {
    const plan = generateSchool({ seed: 404, tier: 4, mission: 'phone' });
    const d = buildDressing(plan);
    // eslint-disable-next-line no-console
    console.log(`tier 4 dressing: ${d.stats.meshes} meshes, ${d.stats.triangles} tris, ${d.wallItems.length} wall groups, ${plan.rooms.length} rooms`);
  });
});
