// Furniture models: every kind/variant builds, fits its footprint (body vertices), stays in the triangle budget,
// carries the attributes modelMaterial needs, and is cached.
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { furnitureFootprint, furnitureGeometry, type PropVariant } from '../../src/world/props';
import type { FurnitureKind } from '../../src/school/types';

/** Sizes the generator uses (local W × D × h; src/school/gen/furnish.ts). */
const CASES: [FurnitureKind, number, number, number][] = [
  ['desk', 0.8, 0.6, 0.75],
  ['desk', 0.6, 0.8, 0.75],
  ['teacherDesk', 1.6, 0.8, 0.8],
  ['locker', 0.48, 0.5, 1.9],
  ['stall', 1.2, 1.4, 2.0],
  ['shelf', 3.2, 0.6, 2.1],
  ['shelf', 2.2, 0.5, 2.1],
  ['table', 2.6, 0.9, 0.75],
  ['table', 1.4, 0.9, 0.75],
  ['bleachers', 10.5, 2.2, 1.6],
  ['bleachers', 4.9, 2.2, 1.6],
  ['vending', 1.8, 0.5, 1.9],
  ['vending', 4.0, 0.8, 1.9],
  ['officeDesk', 2.0, 0.9, 0.8],
  ['trophyCase', 1.8, 0.5, 1.7],
  ['bench', 1.6, 1.0, 0.5],
  ['planter', 1.6, 1.0, 0.7],
];
const BUDGET: Partial<Record<FurnitureKind, number>> = { desk: 350, locker: 150 };
const VARIANTS: PropVariant[] = ['plain', 'goal', 'hide'];

function bodyBounds(g: THREE.BufferGeometry): { min: number[]; max: number[] } {
  const p = g.getAttribute('position');
  const ink = g.getAttribute('aInk');
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.count; i++) {
    if (ink.getX(i) !== 0 || ink.getY(i) !== 0 || ink.getZ(i) !== 0) continue;
    const v = [p.getX(i), p.getY(i), p.getZ(i)];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, v[k]!);
      max[k] = Math.max(max[k]!, v[k]!);
    }
  }
  return { min, max };
}

export const TRI_REPORT: Record<string, number> = {};

describe('furnitureGeometry', () => {
  for (const [kind, w, d, h] of CASES) {
    for (const v of VARIANTS) {
      it(`${kind} ${w}×${d}×${h} ${v}: fits, in budget`, () => {
        const g = furnitureGeometry(kind, w, d, h, v);
        const tris = g.getAttribute('position').count / 3;
        TRI_REPORT[`${kind} ${w}x${d} ${v}`] = tris;
        expect(tris).toBeGreaterThan(10);
        expect(tris, `${kind} ${v} triangles`).toBeLessThanOrEqual(BUDGET[kind] ?? 800);
        for (const a of ['position', 'normal', 'color', 'aInk', 'aGlow']) expect(g.getAttribute(a), a).toBeDefined();
        const b = bodyBounds(g);
        const eps = 1e-3;
        expect(b.min[0]).toBeGreaterThanOrEqual(-w / 2 - eps);
        expect(b.max[0]).toBeLessThanOrEqual(w / 2 + eps);
        expect(b.min[1]).toBeGreaterThanOrEqual(-eps);
        expect(b.max[1]).toBeLessThanOrEqual(h + eps);
        expect(b.min[2]).toBeGreaterThanOrEqual(-d / 2 - eps);
        expect(b.max[2]).toBeLessThanOrEqual(d / 2 + eps);
        // fills its footprint reasonably (not a tiny model in a big box)
        expect(b.max[0]! - b.min[0]!).toBeGreaterThan(w * 0.7);
        expect(b.max[1]).toBeGreaterThan(h * 0.8);
        // the whole thing incl. ink hull stays within ~2 cm of the footprint
        g.computeBoundingBox();
        const bb = g.boundingBox!;
        expect(bb.min.x).toBeGreaterThan(-w / 2 - 0.02);
        expect(bb.max.z).toBeLessThan(d / 2 + 0.02);
      });
    }
  }

  it('is cached per key', () => {
    expect(furnitureGeometry('desk', 0.8, 0.6, 0.75, 'plain')).toBe(furnitureGeometry('desk', 0.8, 0.6, 0.75, 'plain'));
    expect(furnitureGeometry('desk', 0.8, 0.6, 0.75, 'plain')).not.toBe(furnitureGeometry('desk', 0.6, 0.8, 0.75, 'plain'));
  });

  it('goal variants glow (aGlow set somewhere)', () => {
    for (const kind of ['locker', 'vending', 'officeDesk'] as const) {
      const c = CASES.find((x) => x[0] === kind)!;
      const g = furnitureGeometry(kind, c[1], c[2], c[3], 'goal');
      const glow = g.getAttribute('aGlow');
      let lit = 0;
      for (let i = 0; i < glow.count; i++) if (glow.getZ(i) > 0.3) lit++;
      expect(lit, kind).toBeGreaterThan(0);
    }
  });

  it('maps world footprints to local ones by face', () => {
    expect(furnitureFootprint({ w: 0.8, d: 0.6, face: 0 })).toEqual({ localW: 0.8, localD: 0.6 });
    expect(furnitureFootprint({ w: 0.8, d: 0.6, face: Math.PI / 2 })).toEqual({ localW: 0.6, localD: 0.8 });
    expect(furnitureFootprint({ w: 0.8, d: 0.6, face: Math.PI })).toEqual({ localW: 0.8, localD: 0.6 });
  });

  it('prints the triangle table', () => {
    // eslint-disable-next-line no-console
    console.log(Object.entries(TRI_REPORT).map(([k, v]) => `${k}: ${v}`).join('\n'));
  });
});
