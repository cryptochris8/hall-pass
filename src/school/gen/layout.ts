// Generator steps 1–4 (docs/GDD.md §3): corridor spine, branches, rooms, mission distance. Works on the 8 m
// CELL grid only. Pure and deterministic: every random choice comes from the Rng passed in.
import type { Rng } from '../../core/rng';
import { MISSION_ROOM, ROOM_SIZE, type SpineShape, type TierDef } from '../tiers';
import { CELL, CELL_CORRIDOR, CELL_OUTSIDE, type CellRect, type MissionId, type RoomKind, type RoomTag } from '../types';

export interface LayoutRoom {
  id: number;
  kind: RoomKind;
  rect: CellRect;
  /** Door edges: the room cell and the corridor cell it opens onto. */
  doors: { rc: number; rr: number; cc: number; cr: number }[];
  tags: RoomTag[];
}

export interface Layout {
  cols: number;
  rows: number;
  cells: Int16Array;
  rooms: LayoutRoom[];
}

const DIRS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function cellAt(l: Pick<Layout, 'cols' | 'rows' | 'cells'>, c: number, r: number): number {
  if (c < 0 || r < 0 || c >= l.cols || r >= l.rows) return CELL_OUTSIDE;
  return l.cells[r * l.cols + c]!;
}

function setCell(l: Layout, c: number, r: number, v: number): void {
  l.cells[r * l.cols + c] = v;
}

function isCorridor(l: Layout, c: number, r: number): boolean {
  return cellAt(l, c, r) === CELL_CORRIDOR;
}

// ── Step 1: spine ────────────────────────────────────────────────────────────

export function buildSpine(l: Layout, shape: SpineShape, rng: Rng): void {
  const { cols, rows } = l;
  const row = rng.int(2, rows - 3);
  if (shape === 'straight') {
    for (let c = 1; c < cols - 1; c++) setCell(l, c, row, CELL_CORRIDOR);
    return;
  }
  if (shape === 'L') {
    const col = rng.chance(0.5) ? rng.int(1, 3) : rng.int(cols - 4, cols - 2);
    const left = col < cols / 2;
    const c0 = left ? col : 1;
    const c1 = left ? cols - 2 : col;
    for (let c = c0; c <= c1; c++) setCell(l, c, row, CELL_CORRIDOR);
    const down = rng.chance(0.5);
    const r0 = down ? row : 1;
    const r1 = down ? rows - 2 : row;
    for (let r = r0; r <= r1; r++) setCell(l, col, r, CELL_CORRIDOR);
    return;
  }
  // T: a full-width bar plus a stem from its middle third.
  for (let c = 1; c < cols - 1; c++) setCell(l, c, row, CELL_CORRIDOR);
  const col = rng.int(Math.floor(cols / 3), Math.ceil((2 * cols) / 3) - 1);
  const down = row < rows / 2;
  const r0 = down ? row : 1;
  const r1 = down ? rows - 2 : row;
  for (let r = r0; r <= r1; r++) setCell(l, col, r, CELL_CORRIDOR);
}

// ── Step 2: branches ─────────────────────────────────────────────────────────

export function corridorCount(l: Layout): number {
  let n = 0;
  for (let i = 0; i < l.cells.length; i++) if (l.cells[i] === CELL_CORRIDOR) n++;
  return n;
}

/**
 * Grow side corridors off existing ones until `target` corridor cells. A new corridor cell may only touch the cell it
 * grows from (no side-by-side halls, which would read as one huge room).
 */
export function growBranches(l: Layout, target: number, rng: Rng): void {
  for (let tries = 0; tries < 300 && corridorCount(l) < target; tries++) {
    const cand: number[] = [];
    for (let i = 0; i < l.cells.length; i++) if (l.cells[i] === CELL_CORRIDOR) cand.push(i);
    const start = rng.pick(cand);
    const sc = start % l.cols;
    const sr = Math.floor(start / l.cols);
    const [dc, dr] = rng.pick(DIRS);
    const len = rng.int(2, 4);
    let c = sc;
    let r = sr;
    for (let k = 0; k < len && corridorCount(l) < target; k++) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 1 || nr < 1 || nc > l.cols - 2 || nr > l.rows - 2) break;
      if (cellAt(l, nc, nr) !== CELL_OUTSIDE) break;
      // Only the cell we came from may be a corridor neighbour.
      let touching = 0;
      for (const [ec, er] of DIRS) {
        const x = nc + ec;
        const y = nr + er;
        if (x === c && y === r) continue;
        if (isCorridor(l, x, y)) touching++;
      }
      if (touching > 0) break;
      setCell(l, nc, nr, CELL_CORRIDOR);
      c = nc;
      r = nr;
    }
  }
}

// ── Corridor distances (BFS on corridor cells) ───────────────────────────────

export function corridorDistances(l: Layout, fromC: number, fromR: number): Int32Array {
  const dist = new Int32Array(l.cells.length).fill(-1);
  const q: number[] = [fromR * l.cols + fromC];
  dist[q[0]!] = 0;
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    const c = i % l.cols;
    const r = Math.floor(i / l.cols);
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isCorridor(l, nc, nr)) continue;
      const j = nr * l.cols + nc;
      if (dist[j] !== -1) continue;
      dist[j] = dist[i]! + 1;
      q.push(j);
    }
  }
  return dist;
}

// ── Step 3: rooms ────────────────────────────────────────────────────────────

interface Placement {
  rect: CellRect;
  /** Candidate door edges (room cell → corridor cell). */
  edges: { rc: number; rr: number; cc: number; cr: number }[];
}

function placements(l: Layout, w: number, h: number): Placement[] {
  const out: Placement[] = [];
  const sizes: (readonly [number, number])[] = w === h ? [[w, h]] : [[w, h], [h, w]];
  for (const [sw, sh] of sizes) {
    for (let r0 = 0; r0 + sh <= l.rows; r0++) {
      for (let c0 = 0; c0 + sw <= l.cols; c0++) {
        let free = true;
        for (let r = r0; r < r0 + sh && free; r++) for (let c = c0; c < c0 + sw && free; c++) free = cellAt(l, c, r) === CELL_OUTSIDE;
        if (!free) continue;
        const edges: Placement['edges'] = [];
        for (let r = r0; r < r0 + sh; r++) {
          for (let c = c0; c < c0 + sw; c++) {
            for (const [dc, dr] of DIRS) {
              const nc = c + dc;
              const nr = r + dr;
              const inside = nc >= c0 && nc < c0 + sw && nr >= r0 && nr < r0 + sh;
              if (!inside && isCorridor(l, nc, nr)) edges.push({ rc: c, rr: r, cc: nc, cr: nr });
            }
          }
        }
        if (edges.length > 0) out.push({ rect: { c0, r0, c1: c0 + sw, r1: r0 + sh }, edges });
      }
    }
  }
  return out;
}

function addRoom(l: Layout, kind: RoomKind, p: Placement, tags: RoomTag[], rng: Rng): LayoutRoom {
  const id = l.rooms.length;
  for (let r = p.rect.r0; r < p.rect.r1; r++) for (let c = p.rect.c0; c < p.rect.c1; c++) setCell(l, c, r, id);
  const doorCount = (kind === 'cafeteria' || kind === 'gym') && p.edges.length > 1 ? 2 : 1;
  const edges = p.edges.slice();
  const doors: LayoutRoom['doors'] = [];
  for (let k = 0; k < doorCount && edges.length > 0; k++) {
    const e = rng.pick(edges);
    doors.push(e);
    // A second door should open onto a different corridor cell.
    for (let i = edges.length - 1; i >= 0; i--) if (edges[i]!.cc === e.cc && edges[i]!.cr === e.cr) edges.splice(i, 1);
  }
  const room: LayoutRoom = { id, kind, rect: p.rect, doors, tags };
  l.rooms.push(room);
  return room;
}

const ROOM_TAGS: Partial<Record<RoomKind, RoomTag[]>> = {
  library: ['quiet'],
  gym: ['echo'],
  bathroom: ['safe'],
  courtyard: ['outdoor'],
};

/**
 * Place every room. Order: big rooms, the start classroom, the mission room (55–80 % of the max corridor distance
 * from the start door), bathrooms, extras, then classrooms on every remaining corridor-facing cell.
 * Returns false when the mission distance rule can't be met (the caller re-rolls).
 */
export function placeRooms(l: Layout, tier: TierDef, mission: MissionId, rng: Rng): boolean {
  const missionRoom = MISSION_ROOM[mission];
  const extras = shuffled(tier.extras, rng).slice(0, rng.int(tier.extraCount[0], tier.extraCount[1]));
  const big: RoomKind[] = [];
  for (const k of ['gym', 'cafeteria'] as const) if (missionRoom === k || extras.includes(k) || k === 'cafeteria') big.push(k);
  if (missionRoom === 'gym' && !big.includes('gym')) big.push('gym');
  for (const k of extras) if (ROOM_SIZE[k][0] * ROOM_SIZE[k][1] >= 4 && !big.includes(k)) big.push(k);

  const placeOne = (kind: RoomKind, tags: RoomTag[], filter?: (p: Placement) => boolean): LayoutRoom | null => {
    const [w, h] = ROOM_SIZE[kind];
    let cands = placements(l, w, h);
    if (filter) cands = cands.filter(filter);
    if (cands.length === 0) return null;
    return addRoom(l, kind, rng.pick(cands), tags, rng);
  };

  for (const kind of big) if (kind !== missionRoom) placeOne(kind, [...(ROOM_TAGS[kind] ?? [])]);

  const start = placeOne('classroom', ['start']);
  if (!start) return false;
  const sd = start.doors[0]!;
  const dist = corridorDistances(l, sd.cc, sd.cr);
  let max = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i]! > max) max = dist[i]!;
  const lo = Math.floor(max * 0.55);
  const hi = Math.ceil(max * 0.8);
  const farEnough = (p: Placement): boolean => p.edges.some((e) => {
    const d = dist[e.cr * l.cols + e.cc]!;
    return d >= lo && d <= hi;
  });

  if (missionRoom) {
    const room = placeOne(missionRoom, [...(ROOM_TAGS[missionRoom] ?? []), 'mission'], farEnough);
    if (!room) return false;
    // Keep only the door(s) that satisfy the distance rule, so the route really is that long.
    room.doors = room.doors.filter((e) => {
      const d = dist[e.cr * l.cols + e.cc]!;
      return d >= lo && d <= hi;
    });
    if (room.doors.length === 0) return false;
    if (mission === 'principal' && !placeOne('office', [])) return false;
  } else if (mission === 'locker') {
    // The friend's locker sits on a corridor cell in the distance band: checked by the furnisher via `lockerCell`.
    let ok = false;
    for (let i = 0; i < dist.length && !ok; i++) ok = dist[i]! >= lo && dist[i]! <= hi;
    if (!ok) return false;
  }
  if (mission !== 'phone' && mission !== 'principal' && !l.rooms.some((r) => r.kind === 'office')) placeOne('office', []);

  for (let k = 0; k < 2; k++) if (!placeOne('bathroom', ['safe'])) return false;
  for (const kind of extras) if (!l.rooms.some((r) => r.kind === kind)) placeOne(kind, [...(ROOM_TAGS[kind] ?? [])]);
  // Fill: classrooms everywhere a corridor still has an empty neighbour.
  for (let guard = 0; guard < 200; guard++) if (!placeOne('classroom', [])) break;
  return true;
}

/** Corridor distance (cells) from the start door for every cell; the furnisher uses it for corridor goals. */
export function startDistances(l: Layout): Int32Array {
  const start = l.rooms.find((r) => r.tags.includes('start'))!;
  const d = start.doors[0]!;
  return corridorDistances(l, d.cc, d.cr);
}

export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/** Centre of a cell in metres. */
export function cellCentre(c: number, r: number): { x: number; z: number } {
  return { x: (c + 0.5) * CELL, z: (r + 0.5) * CELL };
}

export function newLayout(cols: number, rows: number): Layout {
  return { cols, rows, cells: new Int16Array(cols * rows).fill(CELL_OUTSIDE), rooms: [] };
}
