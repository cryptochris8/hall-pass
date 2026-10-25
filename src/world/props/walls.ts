// ─────────────────────────────────────────────────────────────────────────────
// Wall geometry helpers for the dressing: which wall box a mounted item hangs
// on (the same greedy merge of visible solid fine cells the grey-box world uses,
// so items group per wall box and hide with it), room sides as "wall faces",
// corridor strip faces, and a small span allocator for laying items out along a
// face without overlapping doors, door leaves, tall furniture or each other.
// ─────────────────────────────────────────────────────────────────────────────
import { CELL, CELL_CORRIDOR, FINE, F_LOW, F_SOLID, ROOM_WALL, type Furniture, type Room, type SchoolPlan } from '../../school/types';

/** A vertical wall face: points P(s) = origin + a·s, s ∈ [0, len]; n points out of the wall into the open space. */
export interface WallFace {
  ox: number;
  oz: number;
  nx: number;
  nz: number;
  len: number;
}

/** Along-direction of a face (the Frame's local +X for yaw = atan2(nx, nz)). */
export function faceAlong(f: WallFace): [number, number] {
  return [f.nz, -f.nx];
}

export function faceYaw(f: WallFace): number {
  return Math.atan2(f.nx, f.nz);
}

/** World point at along-position s, `out` metres out of the wall (negative = inside the wall). */
export function facePoint(f: WallFace, s: number, out = 0): [number, number] {
  const [ax, az] = faceAlong(f);
  return [f.ox + ax * s + f.nx * out, f.oz + az * s + f.nz * out];
}

// ── wall boxes ──

/** Rect id per fine cell (−1 = no visible wall box), matching src/world/school.ts's merged wall boxes. */
export function wallRectIndex(plan: SchoolPlan, reach = 3): Int32Array {
  const { cols, rows, flags } = plan.fine;
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!(flags[r * cols + c]! & F_SOLID)) continue;
      let near = false;
      for (let dr = -reach; dr <= reach && !near; dr++) {
        for (let dc = -reach; dc <= reach && !near; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          near = !(flags[rr * cols + cc]! & F_SOLID);
        }
      }
      if (near) mask[r * cols + c] = 1;
    }
  }
  // Greedy merge: runs per row, stacked while the next row has the same run.
  const idx = new Int32Array(cols * rows).fill(-1);
  const rects: { c0: number; r0: number; c1: number; r1: number }[] = [];
  let open = new Map<string, number>();
  for (let r = 0; r < rows; r++) {
    const next = new Map<string, number>();
    let c = 0;
    while (c < cols) {
      if (!mask[r * cols + c]) {
        c++;
        continue;
      }
      const s = c;
      while (c < cols && mask[r * cols + c]) c++;
      const key = `${s}:${c}`;
      const prev = open.get(key);
      if (prev !== undefined) {
        rects[prev]!.r1 = r + 1;
        next.set(key, prev);
        open.delete(key);
      } else {
        rects.push({ c0: s, r0: r, c1: c, r1: r + 1 });
        next.set(key, rects.length - 1);
      }
    }
    open = next;
  }
  rects.forEach((rc, i) => {
    for (let r = rc.r0; r < rc.r1; r++) for (let c = rc.c0; c < rc.c1; c++) idx[r * cols + c] = i;
  });
  return idx;
}

export function fineFlags(plan: SchoolPlan, x: number, z: number): number {
  const c = Math.floor(x / FINE);
  const r = Math.floor(z / FINE);
  if (c < 0 || r < 0 || c >= plan.fine.cols || r >= plan.fine.rows) return F_SOLID;
  return plan.fine.flags[r * plan.fine.cols + c]!;
}

/** Layout cell value at a world point (−1 outside / off the grid). */
export function cellAtPoint(plan: SchoolPlan, x: number, z: number): number {
  const c = Math.floor(x / CELL);
  const r = Math.floor(z / CELL);
  if (c < 0 || r < 0 || c >= plan.grid.cols || r >= plan.grid.rows) return -1;
  return plan.cells[r * plan.grid.cols + c]!;
}

// ── rooms ──

export interface RoomSide {
  face: WallFace;
  /** 'N' | 'S' | 'W' | 'E' (which side of the room). */
  dir: 'N' | 'S' | 'W' | 'E';
  /** Along-positions of door centres on this side. */
  doors: number[];
}

export function interior(room: Room): { x0: number; z0: number; x1: number; z1: number } {
  const t = ROOM_WALL * FINE;
  return { x0: room.rect.c0 * CELL + t, z0: room.rect.r0 * CELL + t, x1: room.rect.c1 * CELL - t, z1: room.rect.r1 * CELL - t };
}

export function roomSides(room: Room): RoomSide[] {
  const b = interior(room);
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const sides: RoomSide[] = [
    { dir: 'N', face: { ox: b.x0, oz: b.z0, nx: 0, nz: 1, len: w }, doors: [] },
    { dir: 'S', face: { ox: b.x1, oz: b.z1, nx: 0, nz: -1, len: w }, doors: [] },
    { dir: 'W', face: { ox: b.x0, oz: b.z1, nx: 1, nz: 0, len: d }, doors: [] },
    { dir: 'E', face: { ox: b.x1, oz: b.z0, nx: -1, nz: 0, len: d }, doors: [] },
  ];
  for (const door of room.doors) sides[doorSideIndex(room, door)]!.doors.push(doorAlong(room, door));
  return sides;
}

function doorSideIndex(room: Room, door: Room['doors'][number]): number {
  if (door.axis === 'z') return Math.abs(door.z - room.rect.r0 * CELL) < 0.01 ? 0 : 1;
  return Math.abs(door.x - room.rect.c0 * CELL) < 0.01 ? 2 : 3;
}

function doorAlong(room: Room, door: Room['doors'][number]): number {
  const b = interior(room);
  switch (doorSideIndex(room, door)) {
    case 0:
      return door.x - b.x0;
    case 1:
      return b.x1 - door.x;
    case 2:
      return b.z1 - door.z;
    default:
      return door.z - b.z0;
  }
}

/** Index into roomSides() of the side holding the room's first door (the front), and of the back wall. */
export function frontBack(room: Room): { front: number; back: number } {
  const front = room.doors.length ? doorSideIndex(room, room.doors[0]!) : 1;
  return { front, back: [1, 0, 3, 2][front]! };
}

/** What lies behind a room side at along-position s: 'outside', 'corridor', or a room kind. */
export function beyond(plan: SchoolPlan, side: RoomSide, s: number): string {
  const [x, z] = facePoint(side.face, s, -(ROOM_WALL * FINE + 0.3));
  const v = cellAtPoint(plan, x, z);
  if (v === -1) return 'outside';
  if (v === CELL_CORRIDOR) return 'corridor';
  return plan.rooms[v]?.kind ?? 'outside';
}

// ── span allocator ──

interface Blocker {
  s0: number;
  s1: number;
  /** Items whose bottom is above this height may overlap (tall furniture in front of the wall). */
  h: number;
}

export class Spans {
  private readonly used: Blocker[] = [];
  constructor(
    readonly len: number,
    readonly margin = 0.25,
  ) {}

  block(s0: number, s1: number, h = Infinity): void {
    this.used.push({ s0, s1, h });
  }

  fits(s: number, w: number, bottom: number, gap = 0.12): boolean {
    const a = s - w / 2;
    const b = s + w / 2;
    if (a < this.margin || b > this.len - this.margin) return false;
    for (const u of this.used) if (a < u.s1 + gap && b > u.s0 - gap && bottom < u.h + 0.05) return false;
    return true;
  }

  /** Find a free spot for an item w wide whose bottom edge is at `bottom` m, nearest to `pref`; null if none. */
  take(w: number, bottom: number, pref: number, top = Infinity): number | null {
    for (let k = 0; k <= 80; k++) {
      const off = Math.ceil(k / 2) * 0.1 * (k % 2 ? 1 : -1);
      const s = pref + off;
      if (this.fits(s, w, bottom)) {
        this.used.push({ s0: s - w / 2, s1: s + w / 2, h: top });
        return s;
      }
    }
    return null;
  }
}

/** Block the spans of furniture standing against a face (within `reach` m of it). */
export function blockFurniture(spans: Spans, face: WallFace, furniture: readonly Furniture[], reach = 0.9): void {
  const [ax, az] = faceAlong(face);
  for (const f of furniture) {
    // distance of the footprint's near edge from the face, measured along n
    const dc = (f.x - face.ox) * face.nx + (f.z - face.oz) * face.nz;
    const halfN = Math.abs(face.nx) * (f.w / 2) + Math.abs(face.nz) * (f.d / 2);
    if (dc - halfN > reach || dc + halfN < 0) continue;
    const sc = (f.x - face.ox) * ax + (f.z - face.oz) * az;
    const halfA = Math.abs(ax) * (f.w / 2) + Math.abs(az) * (f.d / 2);
    if (sc + halfA < 0 || sc - halfA > face.len) continue;
    spans.block(sc - halfA, sc + halfA, f.h);
  }
}

/** Every fine cell under a world rectangle is free of `blocked` flags. */
export function rectClear(plan: SchoolPlan, x0: number, z0: number, x1: number, z1: number, blocked = F_SOLID | F_LOW): boolean {
  const fc0 = Math.floor(Math.min(x0, x1) / FINE + 1e-6);
  const fr0 = Math.floor(Math.min(z0, z1) / FINE + 1e-6);
  const fc1 = Math.ceil(Math.max(x0, x1) / FINE - 1e-6);
  const fr1 = Math.ceil(Math.max(z0, z1) / FINE - 1e-6);
  const { cols, rows, flags } = plan.fine;
  if (fc0 < 0 || fr0 < 0 || fc1 > cols || fr1 > rows) return false;
  for (let r = fr0; r < fr1; r++) for (let c = fc0; c < fc1; c++) if (flags[r * cols + c]! & blocked) return false;
  return true;
}

/** Every fine cell under a world rectangle is solid. */
export function rectSolid(plan: SchoolPlan, x0: number, z0: number, x1: number, z1: number): boolean {
  const fc0 = Math.floor(Math.min(x0, x1) / FINE + 1e-6);
  const fr0 = Math.floor(Math.min(z0, z1) / FINE + 1e-6);
  const fc1 = Math.ceil(Math.max(x0, x1) / FINE - 1e-6);
  const fr1 = Math.ceil(Math.max(z0, z1) / FINE - 1e-6);
  const { cols, rows, flags } = plan.fine;
  for (let r = fr0; r < fr1; r++) {
    for (let c = fc0; c < fc1; c++) {
      if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
      if (!(flags[r * cols + c]! & F_SOLID)) return false;
    }
  }
  return true;
}

/** Corridor strip faces: one per corridor cell edge that borders a non-corridor cell. */
export function corridorFaces(plan: SchoolPlan): { face: WallFace; c: number; r: number }[] {
  const out: { face: WallFace; c: number; r: number }[] = [];
  const inset = 1.5;
  const at = (c: number, r: number): number => (c < 0 || r < 0 || c >= plan.grid.cols || r >= plan.grid.rows ? -1 : plan.cells[r * plan.grid.cols + c]!);
  for (let r = 0; r < plan.grid.rows; r++) {
    for (let c = 0; c < plan.grid.cols; c++) {
      if (at(c, r) !== CELL_CORRIDOR) continue;
      const x0 = c * CELL;
      const z0 = r * CELL;
      if (at(c, r - 1) !== CELL_CORRIDOR) out.push({ c, r, face: { ox: x0, oz: z0 + inset, nx: 0, nz: 1, len: CELL } });
      if (at(c, r + 1) !== CELL_CORRIDOR) out.push({ c, r, face: { ox: x0 + CELL, oz: z0 + CELL - inset, nx: 0, nz: -1, len: CELL } });
      if (at(c - 1, r) !== CELL_CORRIDOR) out.push({ c, r, face: { ox: x0 + inset, oz: z0 + CELL, nx: 1, nz: 0, len: CELL } });
      if (at(c + 1, r) !== CELL_CORRIDOR) out.push({ c, r, face: { ox: x0 + CELL - inset, oz: z0, nx: -1, nz: 0, len: CELL } });
    }
  }
  return out;
}
