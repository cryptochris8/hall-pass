// Staff navigation on the fine grid (docs/ARCHITECTURE.md §5): A* over open 0.5 m cells (8-connected, no corner
// cutting) and string-pulling with grid line-of-sight. Pure and deterministic: + − × ÷, sqrt; ties break by cell
// index. Bodies still collide (sim/move.resolveCollision), so paths only need to be close, not exact.
import { FINE, F_LOW, F_SOLID, type FineGrid } from '../school/types';
import { castRay } from './detect';

const BLOCK = F_SOLID | F_LOW;
const SQRT2 = 1.4142135623730951;

/** Reused search buffers per grid size (no per-call allocation of the big arrays). */
interface Scratch {
  g: Float64Array;
  came: Int32Array;
  stamp: Uint32Array;
  closed: Uint32Array;
  heapI: Int32Array;
  heapF: Float64Array;
  gen: number;
}
const scratch = new WeakMap<FineGrid, Scratch>();
function buffers(fine: FineGrid): Scratch {
  let s = scratch.get(fine);
  if (!s) {
    const n = fine.cols * fine.rows;
    s = { g: new Float64Array(n), came: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), heapI: new Int32Array(n * 2), heapF: new Float64Array(n * 2), gen: 0 };
    scratch.set(fine, s);
  }
  return s;
}

export function openAt(fine: FineGrid, c: number, r: number): boolean {
  return c >= 0 && r >= 0 && c < fine.cols && r < fine.rows && (fine.flags[r * fine.cols + c]! & BLOCK) === 0;
}

/** Nearest open cell to (x, z) within `maxR` cells (ring search), or −1. */
export function nearestOpenCell(fine: FineGrid, x: number, z: number, maxR = 6): number {
  const c0 = Math.floor(x / FINE);
  const r0 = Math.floor(z / FINE);
  for (let k = 0; k <= maxR; k++) {
    for (let dr = -k; dr <= k; dr++) {
      for (let dc = -k; dc <= k; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== k) continue;
        if (openAt(fine, c0 + dc, r0 + dr)) return (r0 + dr) * fine.cols + c0 + dc;
      }
    }
  }
  return -1;
}

/** Straight walkable line between two points (solid and low furniture block). */
export function walkLine(fine: FineGrid, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-6) return true;
  // Test the centre line and two lines offset by a body half-width, so paths don't hug corners.
  const nx = (-dz / len) * 0.25;
  const nz = (dx / len) * 0.25;
  return (
    castRay(fine, ax, az, dx / len, dz / len, len, true) >= len &&
    castRay(fine, ax + nx, az + nz, dx / len, dz / len, len, true) >= len &&
    castRay(fine, ax - nx, az - nz, dx / len, dz / len, len, true) >= len
  );
}

/**
 * Path from (sx, sz) to (gx, gz) as smoothed waypoints [x0, z0, x1, z1, …] (excluding the start), or null when the
 * goal is unreachable within `maxExpand` expansions.
 */
export function findPath(fine: FineGrid, sx: number, sz: number, gx: number, gz: number, maxExpand = 30000): number[] | null {
  const start = nearestOpenCell(fine, sx, sz);
  const goal = nearestOpenCell(fine, gx, gz);
  if (start < 0 || goal < 0) return null;
  const cols = fine.cols;
  if (start === goal) return [gx, gz];
  const b = buffers(fine);
  b.gen = (b.gen + 1) >>> 0;
  if (b.gen === 0) {
    b.stamp.fill(0);
    b.closed.fill(0);
    b.gen = 1;
  }
  const gen = b.gen;
  const gc = goal % cols;
  const gr = (goal - gc) / cols;
  const h = (i: number): number => {
    const c = i % cols;
    const r = (i - c) / cols;
    const dx = Math.abs(c - gc);
    const dr = Math.abs(r - gr);
    return dx > dr ? dx + (SQRT2 - 1) * dr : dr + (SQRT2 - 1) * dx;
  };
  // Binary heap ordered by f, then by cell index (deterministic ties).
  let size = 0;
  const push = (i: number, f: number): void => {
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      const pf = b.heapF[p]!;
      if (pf < f || (pf === f && b.heapI[p]! < i)) break;
      b.heapI[k] = b.heapI[p]!;
      b.heapF[k] = pf;
      k = p;
    }
    b.heapI[k] = i;
    b.heapF[k] = f;
  };
  const pop = (): number => {
    const top = b.heapI[0]!;
    const li = b.heapI[--size]!;
    const lf = b.heapF[size]!;
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && (b.heapF[c + 1]! < b.heapF[c]! || (b.heapF[c + 1] === b.heapF[c] && b.heapI[c + 1]! < b.heapI[c]!))) c++;
      if (lf < b.heapF[c]! || (lf === b.heapF[c] && li < b.heapI[c]!)) break;
      b.heapI[k] = b.heapI[c]!;
      b.heapF[k] = b.heapF[c]!;
      k = c;
    }
    b.heapI[k] = li;
    b.heapF[k] = lf;
    return top;
  };
  b.stamp[start] = gen;
  b.g[start] = 0;
  b.came[start] = -1;
  push(start, h(start));
  let found = false;
  for (let it = 0; it < maxExpand && size > 0; it++) {
    const cur = pop();
    if (b.closed[cur] === gen) continue;
    b.closed[cur] = gen;
    if (cur === goal) {
      found = true;
      break;
    }
    const cc = cur % cols;
    const cr = (cur - cc) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nc = cc + dc;
        const nr = cr + dr;
        if (!openAt(fine, nc, nr)) continue;
        if (dr !== 0 && dc !== 0 && (!openAt(fine, cc + dc, cr) || !openAt(fine, cc, cr + dr))) continue;
        const n = nr * cols + nc;
        if (b.closed[n] === gen) continue;
        const g = b.g[cur]! + (dr !== 0 && dc !== 0 ? SQRT2 : 1);
        if (b.stamp[n] === gen && g >= b.g[n]!) continue;
        b.stamp[n] = gen;
        b.g[n] = g;
        b.came[n] = cur;
        push(n, g + h(n));
      }
    }
  }
  if (!found) return null;
  // Walk back to a cell list, then string-pull.
  const cells: number[] = [];
  for (let i = goal; i !== -1; i = b.came[i]!) cells.push(i);
  cells.reverse();
  const out: number[] = [];
  let ax = sx;
  let az = sz;
  let k = 1;
  while (k < cells.length) {
    // Furthest cell visible from the anchor (looking at most 40 cells ahead keeps this cheap).
    let far = k;
    for (let j = Math.min(cells.length - 1, k + 40); j > k; j--) {
      const c = cells[j]!;
      const x = ((c % cols) + 0.5) * FINE;
      const z = (Math.floor(c / cols) + 0.5) * FINE;
      if (walkLine(fine, ax, az, x, z)) {
        far = j;
        break;
      }
    }
    const c = cells[far]!;
    ax = ((c % cols) + 0.5) * FINE;
    az = (Math.floor(c / cols) + 0.5) * FINE;
    out.push(ax, az);
    k = far + 1;
  }
  // End exactly at the requested goal when it's open; else at the goal cell centre.
  if (openAt(fine, Math.floor(gx / FINE), Math.floor(gz / FINE))) {
    out[out.length - 2] = gx;
    out[out.length - 1] = gz;
  }
  return out;
}
