// Generator step 5b: furniture, locker banks, mission goals, anchors and zones (docs/GDD.md §3). Pure.
// Every piece is stamped into the fine grid (desks/tables LOW, shelves/lockers/stalls SOLID) and must keep a clear
// apron in front of every door, so furniture can never cut a room off.
import type { Rng } from '../../core/rng';
import { PI } from '../../core/fmath';
import type { TierDef } from '../tiers';
import {
  CELL,
  CELL_CORRIDOR,
  CORRIDOR_INSET,
  FINE,
  F_LOW,
  F_SOLID,
  ROOM_WALL,
  type Anchor,
  type AnchorId,
  type Door,
  type FineGrid,
  type Furniture,
  type FurnitureKind,
  type FurnitureTag,
  type MissionId,
  type Room,
  type Zone,
} from '../types';
import { stampRect } from './fine';
import { cellAt, startDistances, type Layout } from './layout';

/** Yaw facing each direction (yaw 0 = +Z). */
export const FACE_S = 0;
export const FACE_N = PI;
export const FACE_E = PI / 2;
export const FACE_W = -PI / 2;

const HEIGHT: Record<FurnitureKind, number> = {
  desk: 0.75,
  teacherDesk: 0.8,
  locker: 1.9,
  stall: 2.0,
  shelf: 2.1,
  table: 0.75,
  bleachers: 1.6,
  vending: 1.9,
  officeDesk: 0.8,
  trophyCase: 1.7,
  bench: 0.5,
  planter: 0.7,
};

const SOLID_KINDS: ReadonlySet<FurnitureKind> = new Set(['locker', 'stall', 'shelf', 'bleachers', 'vending', 'trophyCase']);

export interface Furnished {
  furniture: Furniture[];
  anchors: Partial<Record<AnchorId, Anchor>>;
  zones: Zone[];
}

interface Ctx {
  fine: FineGrid;
  furniture: Furniture[];
  /** Door aprons: no furniture within this radius of a door centre. */
  doors: Door[];
}

function clearOfDoors(ctx: Ctx, x: number, z: number, w: number, d: number, apron: number): boolean {
  for (const door of ctx.doors) {
    const dx = Math.max(Math.abs(door.x - x) - w / 2, 0);
    const dz = Math.max(Math.abs(door.z - z) - d / 2, 0);
    if (dx * dx + dz * dz < apron * apron) return false;
  }
  return true;
}

/** Every fine cell under the footprint has none of `blocked` set. */
function footprintIs(fine: FineGrid, x: number, z: number, w: number, d: number, blocked: number): boolean {
  const fc0 = Math.floor((x - w / 2) / FINE + 1e-6);
  const fr0 = Math.floor((z - d / 2) / FINE + 1e-6);
  const fc1 = Math.ceil((x + w / 2) / FINE - 1e-6);
  const fr1 = Math.ceil((z + d / 2) / FINE - 1e-6);
  if (fc0 < 0 || fr0 < 0 || fc1 > fine.cols || fr1 > fine.rows) return false;
  for (let r = fr0; r < fr1; r++) for (let c = fc0; c < fc1; c++) if (fine.flags[r * fine.cols + c]! & blocked) return false;
  return true;
}

/** Place a piece on open floor (rejects overlaps and door aprons). */
function place(ctx: Ctx, kind: FurnitureKind, x: number, z: number, w: number, d: number, face: number, tags: FurnitureTag[], apron = 1.6): Furniture | null {
  if (!footprintIs(ctx.fine, x, z, w, d, F_SOLID | F_LOW)) return null;
  if (!clearOfDoors(ctx, x, z, w, d, apron)) return null;
  const f: Furniture = { kind, x, z, w, d, h: HEIGHT[kind], face, tags };
  stampRect(ctx.fine, x, z, w, d, SOLID_KINDS.has(kind) ? F_SOLID : F_LOW);
  ctx.furniture.push(f);
  return f;
}

/** A piece built INTO existing solid mass (lockers in the corridor's locker strip): visual + tags, no stamping. */
function embed(ctx: Ctx, kind: FurnitureKind, x: number, z: number, w: number, d: number, face: number, tags: FurnitureTag[]): Furniture {
  const f: Furniture = { kind, x, z, w, d, h: HEIGHT[kind], face, tags };
  ctx.furniture.push(f);
  return f;
}

/** Room interior in metres (inside the walls). */
function interior(room: Room): { x0: number; z0: number; x1: number; z1: number } {
  const t = ROOM_WALL * FINE;
  return { x0: room.rect.c0 * CELL + t, z0: room.rect.r0 * CELL + t, x1: room.rect.c1 * CELL - t, z1: room.rect.r1 * CELL - t };
}

/** The wall of a room farthest from its first door, as a yaw the furniture against it faces (into the room). */
function backWallFace(room: Room): number {
  const door = room.doors[0]!;
  const b = interior(room);
  if (door.axis === 'x') return door.x <= b.x0 + 0.01 ? FACE_W : FACE_E;
  return door.z <= b.z0 + 0.01 ? FACE_N : FACE_S;
}

function furnishRoom(ctx: Ctx, room: Room, rng: Rng, anchors: Furnished['anchors'], checkpoint: { n: number }): void {
  const b = interior(room);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const back = backWallFace(room);
  // Point just inside the back wall (furniture there faces `back`).
  const backAt = (inset: number): { x: number; z: number } => {
    if (back === FACE_W) return { x: b.x1 - inset, z: cz };
    if (back === FACE_E) return { x: b.x0 + inset, z: cz };
    if (back === FACE_N) return { x: cx, z: b.z1 - inset };
    return { x: cx, z: b.z0 + inset };
  };
  const alongX = back === FACE_N || back === FACE_S;

  switch (room.kind) {
    case 'classroom':
    case 'art':
    case 'band':
    case 'lab': {
      const big = room.kind !== 'classroom';
      const dw = big ? 1.4 : 0.8;
      const dd = big ? 0.9 : 0.6;
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          if (big && j === 0) continue;
          place(ctx, big ? 'table' : 'desk', cx + i * 1.9, cz + j * 1.6, dw, dd, back, rng.chance(0.4) ? ['lowCover', 'throwables'] : ['lowCover']);
        }
      }
      // 0.9 m off the back wall: clear of the front desk row (which ends 1.9 m from the room centre).
      const t = backAt(0.9);
      place(ctx, 'teacherDesk', t.x, t.z, alongX ? 1.6 : 0.8, alongX ? 0.8 : 1.6, back, ['lowCover', 'throwables']);
      if (room.tags.includes('start')) {
        // Your desk: the one nearest the room centre; you sit just behind it (toward the door side).
        anchors.start = { x: cx, z: cz, yaw: back };
        const seat = deskSeat(ctx, room, cx, cz, back);
        if (seat) anchors.start = seat;
      }
      break;
    }
    case 'office':
    case 'principal': {
      const t = backAt(1.6);
      const desk = place(ctx, 'officeDesk', t.x, t.z, alongX ? 2.0 : 0.9, alongX ? 0.9 : 2.0, back, ['lowCover']);
      const s = backAt(0.4);
      place(ctx, 'shelf', s.x + (alongX ? w * 0.3 : 0), s.z + (alongX ? 0 : d * 0.3), alongX ? 2.2 : 0.5, alongX ? 0.5 : 2.2, back, ['cover'], 1.2);
      if (desk && room.tags.includes('mission')) {
        const g = backAt(0.9);
        desk.tags.push('goal');
        anchors.goal = { x: g.x, z: g.z, yaw: back + PI };
      } else if (desk && room.kind === 'office' && !anchors.goal2) {
        const g = backAt(0.9);
        anchors.goal2 = { x: g.x, z: g.z, yaw: back + PI };
      }
      break;
    }
    case 'library': {
      // Rows of tall shelves across the long axis; the gaps are the paths.
      const long = w >= d;
      const n = 4;
      for (let k = 0; k < n; k++) {
        const t = (k + 1) / (n + 1);
        const x = long ? b.x0 + w * t : cx;
        const z = long ? cz : b.z0 + d * t;
        place(ctx, 'shelf', x, z - (long ? 0.9 : 0), long ? 0.6 : 3.2, long ? 3.2 : 0.6, long ? FACE_E : FACE_S, ['cover']);
      }
      break;
    }
    case 'cafeteria': {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 4; j++) {
          const x = b.x0 + w * (0.22 + 0.28 * i);
          const z = b.z0 + d * (0.16 + 0.22 * j);
          place(ctx, 'table', x, z, alongX ? 2.6 : 0.9, alongX ? 0.9 : 2.6, back, ['lowCover']);
        }
      }
      const c = backAt(0.6);
      const counter = place(ctx, 'vending', c.x, c.z, alongX ? 4.0 : 0.8, alongX ? 0.8 : 4.0, back, ['cover'], 1.4);
      if (counter && room.tags.includes('mission')) {
        counter.tags.push('goal');
        const g = backAt(1.6);
        anchors.goal = { x: g.x, z: g.z, yaw: back + PI };
      }
      break;
    }
    case 'gym': {
      const s = backAt(1.2);
      place(ctx, 'bleachers', s.x, s.z, alongX ? w * 0.7 : 2.2, alongX ? 2.2 : d * 0.7, back, ['cover', 'hide'], 1.4);
      break;
    }
    case 'bathroom': {
      for (let k = -1; k <= 1; k++) {
        const s = backAt(0.8);
        place(ctx, 'stall', s.x + (alongX ? k * 1.5 : 0), s.z + (alongX ? 0 : k * 1.5), alongX ? 1.2 : 1.4, alongX ? 1.4 : 1.2, back, ['hide'], 1.2);
      }
      anchors[`checkpoint${checkpoint.n++}`] = { x: cx, z: cz, yaw: back + PI };
      break;
    }
    case 'courtyard': {
      for (let k = 0; k < 4; k++) {
        place(ctx, rng.chance(0.5) ? 'planter' : 'bench', b.x0 + w * (0.25 + 0.5 * (k % 2)), b.z0 + d * (0.25 + 0.5 * Math.floor(k / 2)), 1.6, 1.0, FACE_S, ['lowCover']);
      }
      break;
    }
  }
}

/** Seat behind the desk nearest the room centre. */
function deskSeat(ctx: Ctx, room: Room, cx: number, cz: number, back: number): Anchor | null {
  let best: Furniture | null = null;
  let bd = Infinity;
  const b = interior(room);
  for (const f of ctx.furniture) {
    if (f.kind !== 'desk' || f.x < b.x0 || f.x > b.x1 || f.z < b.z0 || f.z > b.z1) continue;
    const dd = (f.x - cx) ** 2 + (f.z - cz) ** 2;
    if (dd < bd) {
      bd = dd;
      best = f;
    }
  }
  if (!best) return null;
  // Desks face the back wall (the board); the seat is on the other side.
  const off = 0.75;
  const sx = back === FACE_W ? best.x - off : back === FACE_E ? best.x + off : best.x;
  const sz = back === FACE_N ? best.z + off : back === FACE_S ? best.z - off : best.z;
  return { x: sx, z: sz, yaw: back };
}

interface Face {
  /** Centre of the 2 m slot on the strip face (in the open corridor, right at the face). */
  x: number;
  z: number;
  /** Yaw the lockers face (into the corridor). */
  face: number;
  /** Corridor cell. */
  c: number;
  r: number;
}

/** Locker-strip faces of every corridor cell, split into 2 m slots that have no door behind them. */
function stripSlots(l: Layout, fine: FineGrid): Face[] {
  const out: Face[] = [];
  const depth = CORRIDOR_INSET * FINE;
  for (let r = 0; r < l.rows; r++) {
    for (let c = 0; c < l.cols; c++) {
      if (cellAt(l, c, r) !== CELL_CORRIDOR) continue;
      const x0 = c * CELL;
      const z0 = r * CELL;
      const sides: [boolean, number][] = [
        [cellAt(l, c, r - 1) !== CELL_CORRIDOR, FACE_S],
        [cellAt(l, c, r + 1) !== CELL_CORRIDOR, FACE_N],
        [cellAt(l, c - 1, r) !== CELL_CORRIDOR, FACE_E],
        [cellAt(l, c + 1, r) !== CELL_CORRIDOR, FACE_W],
      ];
      for (const [has, face] of sides) {
        if (!has) continue;
        for (let k = 0; k < 2; k++) {
          // Two 2 m slots per face, centred 2.5 m and 5.5 m along the 8 m edge (clear of the corners).
          const t = k === 0 ? 2.75 : 5.25;
          let x: number;
          let z: number;
          if (face === FACE_S) [x, z] = [x0 + t, z0 + depth];
          else if (face === FACE_N) [x, z] = [x0 + t, z0 + CELL - depth];
          else if (face === FACE_E) [x, z] = [x0 + depth, z0 + t];
          else [x, z] = [x0 + CELL - depth, z0 + t];
          // The strip behind must be solid (no door) and the floor in front open.
          const alongX = face === FACE_S || face === FACE_N;
          const behindX = face === FACE_E ? x - 0.25 : face === FACE_W ? x + 0.25 : x;
          const behindZ = face === FACE_S ? z - 0.25 : face === FACE_N ? z + 0.25 : z;
          if (!footprintIsSolid(fine, behindX, behindZ, alongX ? 2.0 : 0.5, alongX ? 0.5 : 2.0)) continue;
          const frontX = face === FACE_E ? x + 0.5 : face === FACE_W ? x - 0.5 : x;
          const frontZ = face === FACE_S ? z + 0.5 : face === FACE_N ? z - 0.5 : z;
          if (!footprintIs(fine, frontX, frontZ, alongX ? 2.0 : 0.5, alongX ? 0.5 : 2.0, F_SOLID | F_LOW)) continue;
          out.push({ x, z, face, c, r });
        }
      }
    }
  }
  return out;
}

function footprintIsSolid(fine: FineGrid, x: number, z: number, w: number, d: number): boolean {
  const fc0 = Math.floor((x - w / 2) / FINE + 1e-6);
  const fr0 = Math.floor((z - d / 2) / FINE + 1e-6);
  const fc1 = Math.ceil((x + w / 2) / FINE - 1e-6);
  const fr1 = Math.ceil((z + d / 2) / FINE - 1e-6);
  for (let r = fr0; r < fr1; r++) for (let c = fc0; c < fc1; c++) if (!(fine.flags[r * fine.cols + c]! & F_SOLID)) return false;
  return true;
}

/** A bank of 4 lockers (or a vending machine / trophy case) set into a strip slot. Returns the goal anchor point. */
function lockerBank(ctx: Ctx, s: Face, rng: Rng, opts: { goal?: boolean; vending?: boolean; trophy?: boolean }): Anchor {
  const alongX = s.face === FACE_S || s.face === FACE_N;
  const inX = s.face === FACE_E ? -0.25 : s.face === FACE_W ? 0.25 : 0;
  const inZ = s.face === FACE_S ? -0.25 : s.face === FACE_N ? 0.25 : 0;
  if (opts.vending || opts.trophy) {
    embed(ctx, opts.vending ? 'vending' : 'trophyCase', s.x + inX, s.z + inZ, alongX ? 1.8 : 0.5, alongX ? 0.5 : 1.8, s.face, opts.goal ? ['goal', 'noisy'] : ['cover']);
  } else {
    const hideAt = rng.int(0, 3);
    for (let k = 0; k < 4; k++) {
      const o = -0.75 + k * 0.5;
      const tags: FurnitureTag[] = [];
      if (opts.goal && k === 1) tags.push('goal');
      else if (k === hideAt && rng.chance(0.6)) tags.push('hide');
      embed(ctx, 'locker', s.x + inX + (alongX ? o : 0), s.z + inZ + (alongX ? 0 : o), alongX ? 0.48 : 0.5, alongX ? 0.5 : 0.48, s.face, tags);
    }
  }
  const out = 0.6;
  return {
    x: s.x + (s.face === FACE_E ? out : s.face === FACE_W ? -out : 0) + (alongX && opts.goal && !opts.vending ? -0.25 : 0),
    z: s.z + (s.face === FACE_S ? out : s.face === FACE_N ? -out : 0) + (!alongX && opts.goal && !opts.vending ? -0.25 : 0),
    yaw: s.face + PI,
  };
}

export function furnish(l: Layout, rooms: Room[], fine: FineGrid, tier: TierDef, mission: MissionId, rng: Rng): Furnished | null {
  const ctx: Ctx = { fine, furniture: [], doors: rooms.flatMap((r) => r.doors) };
  const anchors: Furnished['anchors'] = {};
  const checkpoint = { n: 0 };
  for (const room of rooms) furnishRoom(ctx, room, rng.fork(room.id + 1), anchors, checkpoint);
  if (!anchors.start) return null;

  // Corridor goals.
  let slots = stripSlots(l, fine);
  const takeSlot = (pred: (s: Face) => boolean): Face | null => {
    const cand = slots.filter(pred);
    if (cand.length === 0) return null;
    const s = rng.pick(cand);
    slots = slots.filter((o) => !(Math.abs(o.x - s.x) < 2.1 && Math.abs(o.z - s.z) < 2.1));
    return s;
  };
  if (mission === 'vending' || mission === 'gym') {
    const gym = rooms.find((r) => r.kind === 'gym');
    if (!gym) return null;
    const door = gym.doors[0]!;
    const near = (s: Face): number => Math.abs(s.x - door.x) + Math.abs(s.z - door.z);
    const s = takeSlot((x) => near(x) < 14);
    if (!s) return null;
    anchors.goal = lockerBank(ctx, s, rng, { goal: true, vending: mission === 'vending' });
  } else if (mission === 'locker') {
    const dist = startDistances(l);
    let max = 0;
    for (let i = 0; i < dist.length; i++) if (dist[i]! > max) max = dist[i]!;
    const lo = Math.floor(max * 0.55);
    const hi = Math.ceil(max * 0.8);
    const s = takeSlot((x) => {
      const d = dist[x.r * l.cols + x.c]!;
      return d >= lo && d <= hi;
    });
    if (!s) return null;
    anchors.goal = lockerBank(ctx, s, rng, { goal: true });
  } else if (mission === 'principal') {
    // Third phone: in the far classroom's teacher desk.
    const far = farthestRoom(rooms, anchors.start, 'classroom');
    if (!far || !anchors.goal || !anchors.goal2) return null;
    const b = interior(far);
    anchors.goal3 = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, yaw: 0 };
  }
  if (!anchors.goal) return null;
  // Anchors must stand on open floor: nudge each to the nearest open fine cell (within 2.5 m).
  for (const id of Object.keys(anchors) as AnchorId[]) {
    const a = anchors[id]!;
    const p = nearestOpen(fine, a.x, a.z, 2.5);
    if (!p) return null;
    a.x = p.x;
    a.z = p.z;
  }

  // Locker banks along the halls: about one per 3 corridor cells of strip, a few trophy cases.
  const banks = Math.round(slots.length * 0.45);
  for (let k = 0; k < banks; k++) {
    const s = takeSlot(() => true);
    if (!s) break;
    lockerBank(ctx, s, rng, { trophy: rng.chance(0.08) });
  }

  const zones: Zone[] = [];
  for (const room of rooms) {
    const b = interior(room);
    if (room.tags.includes('quiet')) zones.push({ kind: 'quiet', ...b });
    if (room.tags.includes('echo')) zones.push({ kind: 'echo', ...b });
  }
  if (tier.polished) zones.push({ kind: 'polished', x0: 0, z0: 0, x1: l.cols * CELL, z1: l.rows * CELL });
  if (tier.dim > 0) {
    for (let i = 0; i < l.cells.length; i++) {
      if (l.cells[i] !== CELL_CORRIDOR || !rng.chance(tier.dim)) continue;
      const c = i % l.cols;
      const r = Math.floor(i / l.cols);
      zones.push({ kind: 'dim', x0: c * CELL, z0: r * CELL, x1: (c + 1) * CELL, z1: (r + 1) * CELL });
    }
  }
  return { furniture: ctx.furniture, anchors, zones };
}

function farthestRoom(rooms: Room[], from: Anchor, kind: Room['kind']): Room | null {
  let best: Room | null = null;
  let bd = -1;
  for (const r of rooms) {
    if (r.kind !== kind || r.tags.includes('start')) continue;
    const x = ((r.rect.c0 + r.rect.c1) / 2) * CELL;
    const z = ((r.rect.r0 + r.rect.r1) / 2) * CELL;
    const d = Math.abs(x - from.x) + Math.abs(z - from.z);
    if (d > bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

/** Centre of the open fine cell nearest (x, z), searching rings out to `maxR` metres. */
function nearestOpen(fine: FineGrid, x: number, z: number, maxR: number): { x: number; z: number } | null {
  const c0 = Math.floor(x / FINE);
  const r0 = Math.floor(z / FINE);
  const open = (c: number, r: number): boolean =>
    c > 0 && r > 0 && c < fine.cols - 1 && r < fine.rows - 1 && !(fine.flags[r * fine.cols + c]! & (F_SOLID | F_LOW));
  const R = Math.ceil(maxR / FINE);
  for (let k = 0; k <= R; k++) {
    let best: { x: number; z: number } | null = null;
    let bd = Infinity;
    for (let dr = -k; dr <= k; dr++) {
      for (let dc = -k; dc <= k; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== k || !open(c0 + dc, r0 + dr)) continue;
        // Need a little room: the 3×3 block around the cell must be open too (a person fits).
        let roomy = true;
        for (let er = -1; er <= 1 && roomy; er++) for (let ec = -1; ec <= 1 && roomy; ec++) roomy = open(c0 + dc + ec, r0 + dr + er);
        if (!roomy) continue;
        const d = dr * dr + dc * dc;
        if (d < bd) {
          bd = d;
          best = { x: (c0 + dc + 0.5) * FINE, z: (r0 + dr + 0.5) * FINE };
        }
      }
    }
    if (best) return best;
  }
  return null;
}
