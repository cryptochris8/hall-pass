// Generator step 5a: stamp the layout into the FINE grid (0.5 m cells) — room walls, corridor locker mass, doors.
// Pure. The fine grid is the single truth for movement and sight (src/school/types.ts header).
import type { Rng } from '../../core/rng';
import {
  CELL_CORRIDOR,
  CORRIDOR_INSET,
  DOOR_WIDTH,
  FINE,
  FINE_PER_CELL,
  F_CORRIDOR,
  F_LOW,
  F_SOLID,
  ROOM_WALL,
  type Door,
  type FineGrid,
} from '../types';
import { cellAt, type Layout } from './layout';

export function newFine(cols: number, rows: number): FineGrid {
  return { cols: cols * FINE_PER_CELL, rows: rows * FINE_PER_CELL, flags: new Uint8Array(cols * rows * FINE_PER_CELL * FINE_PER_CELL) };
}

/** Set / clear flags on a fine-cell rectangle (inclusive-exclusive, clipped). */
export function stampFine(fine: FineGrid, fc0: number, fr0: number, fc1: number, fr1: number, set: number, clear = 0): void {
  const c0 = Math.max(0, fc0);
  const r0 = Math.max(0, fr0);
  const c1 = Math.min(fine.cols, fc1);
  const r1 = Math.min(fine.rows, fr1);
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * fine.cols + c;
      fine.flags[i] = (fine.flags[i]! & ~clear) | set;
    }
  }
}

/** Stamp a metre rectangle (centre x/z, size w/d) with flags. Rounds outward to whole fine cells. */
export function stampRect(fine: FineGrid, x: number, z: number, w: number, d: number, set: number): void {
  const fc0 = Math.floor((x - w / 2) / FINE + 1e-6);
  const fr0 = Math.floor((z - d / 2) / FINE + 1e-6);
  const fc1 = Math.ceil((x + w / 2) / FINE - 1e-6);
  const fr1 = Math.ceil((z + d / 2) / FINE - 1e-6);
  stampFine(fine, fc0, fr0, fc1, fr1, set);
}

/**
 * Build the fine grid: everything starts solid; room interiors open inside a 1-cell wall on every edge that faces a
 * different space; corridor cells open inside a 3-cell locker mass on every edge that faces a non-corridor; doors are
 * carved through both. Returns the doors of each room in metres.
 */
export function buildFine(l: Layout, rng: Rng): { fine: FineGrid; doors: Door[][] } {
  const fine = newFine(l.cols, l.rows);
  fine.flags.fill(F_SOLID);
  const N = FINE_PER_CELL;
  for (let r = 0; r < l.rows; r++) {
    for (let c = 0; c < l.cols; c++) {
      const v = cellAt(l, c, r);
      if (v === -1) continue;
      const corridor = v === CELL_CORRIDOR;
      const t = corridor ? CORRIDOR_INSET : ROOM_WALL;
      const west = cellAt(l, c - 1, r) !== v;
      const east = cellAt(l, c + 1, r) !== v;
      const north = cellAt(l, c, r - 1) !== v;
      const south = cellAt(l, c, r + 1) !== v;
      const fc0 = c * N + (west ? t : 0);
      const fc1 = (c + 1) * N - (east ? t : 0);
      const fr0 = r * N + (north ? t : 0);
      const fr1 = (r + 1) * N - (south ? t : 0);
      stampFine(fine, fc0, fr0, fc1, fr1, corridor ? F_CORRIDOR : 0, F_SOLID | F_LOW);
    }
  }
  const doors: Door[][] = l.rooms.map(() => []);
  for (const room of l.rooms) {
    for (const e of room.doors) {
      // Offset along the edge, in whole fine cells, kept clear of the corners.
      const offset = rng.int(-4, 4);
      if (e.cc !== e.rc) {
        // Vertical edge (walk through along X).
        const edgeFc = Math.max(e.rc, e.cc) * N;
        const roomWest = e.rc < e.cc;
        const mid = e.rr * N + N / 2 + offset;
        const fr0 = mid - Math.floor(DOOR_WIDTH / 2);
        const fr1 = fr0 + DOOR_WIDTH;
        const fc0 = roomWest ? edgeFc - ROOM_WALL : edgeFc - CORRIDOR_INSET;
        const fc1 = roomWest ? edgeFc + CORRIDOR_INSET : edgeFc + ROOM_WALL;
        stampFine(fine, fc0, fr0, fc1, fr1, 0, F_SOLID | F_LOW);
        doors[room.id]!.push({ x: edgeFc * FINE, z: (fr0 + DOOR_WIDTH / 2) * FINE, axis: 'x' });
      } else {
        const edgeFr = Math.max(e.rr, e.cr) * N;
        const roomNorth = e.rr < e.cr;
        const mid = e.rc * N + N / 2 + offset;
        const fc0 = mid - Math.floor(DOOR_WIDTH / 2);
        const fc1 = fc0 + DOOR_WIDTH;
        const fr0 = roomNorth ? edgeFr - ROOM_WALL : edgeFr - CORRIDOR_INSET;
        const fr1 = roomNorth ? edgeFr + CORRIDOR_INSET : edgeFr + ROOM_WALL;
        stampFine(fine, fc0, fr0, fc1, fr1, 0, F_SOLID | F_LOW);
        doors[room.id]!.push({ x: (fc0 + DOOR_WIDTH / 2) * FINE, z: edgeFr * FINE, axis: 'z' });
      }
    }
  }
  return { fine, doors };
}

/** Open fine cells reachable from a world point (4-connected, through open cells only). */
export function floodOpen(fine: FineGrid, x: number, z: number): Uint8Array {
  const seen = new Uint8Array(fine.flags.length);
  const sc = Math.floor(x / FINE);
  const sr = Math.floor(z / FINE);
  const s = sr * fine.cols + sc;
  if (sc < 0 || sr < 0 || sc >= fine.cols || sr >= fine.rows || fine.flags[s]! & (F_SOLID | F_LOW)) return seen;
  const q = new Int32Array(fine.flags.length);
  let head = 0;
  let tail = 0;
  q[tail++] = s;
  seen[s] = 1;
  while (head < tail) {
    const i = q[head++]!;
    const c = i % fine.cols;
    const r = (i - c) / fine.cols;
    const nb = [c > 0 ? i - 1 : -1, c < fine.cols - 1 ? i + 1 : -1, r > 0 ? i - fine.cols : -1, r < fine.rows - 1 ? i + fine.cols : -1];
    for (const j of nb) {
      if (j < 0 || seen[j] || fine.flags[j]! & (F_SOLID | F_LOW)) continue;
      seen[j] = 1;
      q[tail++] = j;
    }
  }
  return seen;
}

/** Fine-cell centre in metres. */
export function fineCentre(fine: FineGrid, i: number): { x: number; z: number } {
  const c = i % fine.cols;
  return { x: (c + 0.5) * FINE, z: ((i - c) / fine.cols + 0.5) * FINE };
}
