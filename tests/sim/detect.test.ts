import { describe, expect, it } from 'vitest';
import { castRay, lineOfSight, sees, visibilityPolygon } from '../../src/sim/detect';
import { F_LOW, F_SOLID, type FineGrid, type StaffSpawn } from '../../src/school/types';

function grid(cols: number, rows: number): FineGrid {
  return { cols, rows, flags: new Uint8Array(cols * rows) };
}
const spawn: StaffSpawn = { archetype: 'patroller', skin: '', name: '', route: [], loop: false, speed: 1, coneRange: 9, coneHalf: Math.PI / 6, eye: 1.6 };

describe('detect', () => {
  it('a wall blocks sight; low cover only blocks a sneaking student', () => {
    const g = grid(40, 40);
    // Solid wall column at x = 5 m (fine col 10), rows 0..19; low row at z = 15 m (fine row 30).
    for (let r = 0; r < 20; r++) g.flags[r * 40 + 10] = F_SOLID;
    for (let c = 0; c < 40; c++) g.flags[30 * 40 + c] = F_LOW;
    expect(lineOfSight(g, 2, 2, 8, 2, false)).toBe(false);
    expect(lineOfSight(g, 2, 12, 8, 12, false)).toBe(true);
    expect(lineOfSight(g, 2, 13, 2, 17, false)).toBe(true);
    expect(lineOfSight(g, 2, 13, 2, 17, true)).toBe(false);
    expect(castRay(g, 2, 2, 1, 0, 20, false)).toBeCloseTo(3, 6);
  });

  it('sees() respects range, cone angle and occlusion', () => {
    const g = grid(40, 40);
    const viewer = { x: 10, z: 10, look: 0 }; // looking +Z
    expect(sees(g, viewer, spawn, Math.cos(spawn.coneHalf), 10, 15, 'walk')).toBeGreaterThan(0);
    expect(sees(g, viewer, spawn, Math.cos(spawn.coneHalf), 10, 5, 'walk')).toBe(0); // behind
    expect(sees(g, viewer, spawn, Math.cos(spawn.coneHalf), 16, 12, 'walk')).toBe(0); // outside the cone
    expect(sees(g, viewer, spawn, Math.cos(spawn.coneHalf), 10, 19.5, 'walk')).toBe(0); // out of range
    // Closer and more central sees more.
    const near = sees(g, viewer, spawn, Math.cos(spawn.coneHalf), 10, 12, 'walk');
    const far = sees(g, viewer, spawn, Math.cos(spawn.coneHalf), 10, 18, 'walk');
    expect(near).toBeGreaterThan(far);
    for (let c = 0; c < 40; c++) g.flags[28 * 40 + c] = F_SOLID; // wall at z = 14
    expect(sees(g, viewer, spawn, Math.cos(spawn.coneHalf), 10, 15, 'walk')).toBe(0);
  });

  it('the drawn cone polygon stops at walls', () => {
    const g = grid(40, 40);
    for (let c = 0; c < 40; c++) g.flags[28 * 40 + c] = F_SOLID; // wall at z = 14
    const out = new Float32Array(2 + 2 * 21);
    const n = visibilityPolygon(g, { x: 10, z: 10, look: 0 }, spawn, 20, out);
    expect(n).toBe(out.length);
    for (let k = 2; k < n; k += 2) expect(out[k + 1]!).toBeLessThanOrEqual(14 + 1e-6);
  });
});
