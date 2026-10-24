// ─────────────────────────────────────────────────────────────────────────────
// Sight (docs/GDD.md §5, docs/ARCHITECTURE.md §5). ONE function decides whether a
// staff member can see a point — sees() — and the cone decal on the floor is drawn
// from visibilityPolygon(), which casts the same rays through the same fine grid,
// so what's drawn is what's tested. Pure; deterministic math only (core/fmath).
// ─────────────────────────────────────────────────────────────────────────────
import { fcos, fsin } from '../core/fmath';
import { FINE, F_LOW, F_SOLID, type FineGrid, type StaffSpawn, type Zone } from '../school/types';
import { DETECT } from './tuning';
import type { Posture } from './types';

/**
 * Walk the fine grid from (ax, az) toward (dx, dz) (unit vector) and return the distance to the first blocking cell,
 * capped at maxDist. `lowBlocks`: low furniture (desks, tables) blocks too (against a sneaking student; never for
 * cameras, which look down over it). Amanatides–Woo grid traversal: + − × ÷ and floor only.
 */
export function castRay(fine: FineGrid, ax: number, az: number, dx: number, dz: number, maxDist: number, lowBlocks: boolean): number {
  const mask = lowBlocks ? F_SOLID | F_LOW : F_SOLID;
  let c = Math.floor(ax / FINE);
  let r = Math.floor(az / FINE);
  const stepC = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepR = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaC = stepC !== 0 ? FINE / Math.abs(dx) : Infinity;
  const tDeltaR = stepR !== 0 ? FINE / Math.abs(dz) : Infinity;
  let tMaxC = stepC > 0 ? ((c + 1) * FINE - ax) / dx : stepC < 0 ? (c * FINE - ax) / dx : Infinity;
  let tMaxR = stepR > 0 ? ((r + 1) * FINE - az) / dz : stepR < 0 ? (r * FINE - az) / dz : Infinity;
  let t = 0;
  // The starting cell never blocks (the eye can be next to a wall, a camera inside its mount).
  for (let guard = 0; guard < 4096; guard++) {
    if (tMaxC < tMaxR) {
      t = tMaxC;
      tMaxC += tDeltaC;
      c += stepC;
    } else {
      t = tMaxR;
      tMaxR += tDeltaR;
      r += stepR;
    }
    if (t >= maxDist) return maxDist;
    if (c < 0 || r < 0 || c >= fine.cols || r >= fine.rows) return t;
    if (fine.flags[r * fine.cols + c]! & mask) return t;
  }
  return maxDist;
}

/** Clear line of sight from a to b. */
export function lineOfSight(fine: FineGrid, ax: number, az: number, bx: number, bz: number, lowBlocks: boolean): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return true;
  return castRay(fine, ax, az, dx / len, dz / len, len, lowBlocks) >= len;
}

export function inZone(zones: readonly Zone[], kind: Zone['kind'], x: number, z: number): boolean {
  for (const zn of zones) if (zn.kind === kind && x >= zn.x0 && x < zn.x1 && z >= zn.z0 && z < zn.z1) return true;
  return false;
}

export interface Viewer {
  x: number;
  z: number;
  look: number;
}

/**
 * How strongly `viewer` sees a student at (px, pz): 0 = not at all, else the fill multiplier for distance and how
 * central the student is in the cone (DETECT.near…far × DETECT.centre…edge). Posture and light are applied by the
 * caller: they change the fill rate, not visibility — except that a sneaking student hides behind low cover.
 */
export function sees(fine: FineGrid, viewer: Viewer, spawn: StaffSpawn, cosHalf: number, px: number, pz: number, posture: Posture): number {
  if (spawn.coneRange <= 0) return 0;
  const dx = px - viewer.x;
  const dz = pz - viewer.z;
  const d2 = dx * dx + dz * dz;
  const range = spawn.coneRange;
  if (d2 > range * range) return 0;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return 1;
  const fx = fsin(viewer.look);
  const fz = fcos(viewer.look);
  const cos = (dx * fx + dz * fz) / d;
  if (cos < cosHalf) return 0;
  const lowBlocks = posture === 'sneak' && spawn.archetype !== 'sweeper';
  if (castRay(fine, viewer.x, viewer.z, dx / d, dz / d, d, lowBlocks) < d) return 0;
  // 1 at the cone centre → 0 at its edge; 1 at the eye → 0 at max range.
  const central = cosHalf < 1 ? (cos - cosHalf) / (1 - cosHalf) : 1;
  const prox = 1 - d / range;
  return (DETECT.far + (DETECT.near - DETECT.far) * prox) * (DETECT.edge + (DETECT.centre - DETECT.edge) * central);
}

/**
 * The visible floor area of a cone as a fan: out = [ox, oz, x0, z0, x1, z1, …] with `rays` + 1 edge points.
 * Uses the walking-student occlusion (solid only), exactly what sees() uses for a walking student.
 * Returns the number of floats written.
 */
export function visibilityPolygon(fine: FineGrid, viewer: Viewer, spawn: StaffSpawn, rays: number, out: Float32Array): number {
  out[0] = viewer.x;
  out[1] = viewer.z;
  let k = 2;
  const half = spawn.coneHalf;
  for (let i = 0; i <= rays; i++) {
    const a = viewer.look - half + (2 * half * i) / rays;
    const dx = fsin(a);
    const dz = fcos(a);
    const t = castRay(fine, viewer.x, viewer.z, dx, dz, spawn.coneRange, false);
    out[k++] = viewer.x + dx * t;
    out[k++] = viewer.z + dz * t;
  }
  return k;
}
