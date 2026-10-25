// Generator step 6: staff and their routes (docs/GDD.md §4). Routes run along corridor-cell centres, which are
// always open (halls are 5 m wide, centred), so staff move in straight lines between waypoints with no pathfinding.
// Pure. The sim follows these routes exactly; brains added later only react on top of them.
import type { Rng } from '../../core/rng';
import { PI, fcos, fsin, wrapAngle, yawOf } from '../../core/fmath';
import { findPath } from '../../sim/nav';
import type { TierDef } from '../tiers';
import { CELL, CELL_CORRIDOR, FINE, F_LOW, F_SOLID, type Anchor, type AnchorId, type Archetype, type FineGrid, type MissionId, type Room, type StaffSpawn, type Waypoint } from '../types';
import { cellAt, cellCentre, corridorDistances, type Layout } from './layout';

const DEG = PI / 180;
const S = 60; // ticks per second

const NAMES: Readonly<Record<Archetype, readonly string[]>> = {
  patroller: ['Mr. Dunlap', 'Ms. Reyes', 'Coach Petrov'],
  sentry: ['Mr. Kim', 'Ms. Adeyemi', 'Mrs. Novak', 'Mr. Silva', 'Ms. Laurent'],
  investigator: ['Vice Principal Hargrove', 'Dean Whitlock'],
  sweeper: ['Camera'],
  wanderer: ['Ms. Okafor', 'Mr. Bell'],
  snitch: ['Preston'],
  listener: ['Mrs. Thistle'],
};

/** PHONE JAIL's front-office secretary (a sentry with a coffee walk). */
const SECRETARY = ['Ms. Pruitt', 'Mrs. Delgado'] as const;

/** Cone and speed per archetype (GDD §4; difficulty scales these in the sim). */
export const STAFF_DEFAULTS: Readonly<Record<Archetype, { speed: number; range: number; half: number; eye: number }>> = {
  patroller: { speed: 1.2, range: 9, half: 30 * DEG, eye: 1.6 },
  sentry: { speed: 1.0, range: 9, half: 35 * DEG, eye: 1.6 },
  investigator: { speed: 1.6, range: 10, half: 35 * DEG, eye: 1.6 },
  // Cameras watch a junction, not a whole hall: short, narrow, with a wide slow sweep that leaves real gaps.
  sweeper: { speed: 0, range: 7.5, half: 20 * DEG, eye: 2.7 },
  wanderer: { speed: 0.9, range: 7, half: 40 * DEG, eye: 1.6 },
  snitch: { speed: 1.3, range: 7, half: 40 * DEG, eye: 1.5 },
  listener: { speed: 0, range: 0, half: 0, eye: 1.6 },
};

function corridorCells(l: Layout): number[] {
  const out: number[] = [];
  for (let i = 0; i < l.cells.length; i++) if (l.cells[i] === CELL_CORRIDOR) out.push(i);
  return out;
}

function neighbours(l: Layout, i: number): number[] {
  const c = i % l.cols;
  const r = Math.floor(i / l.cols);
  const out: number[] = [];
  if (cellAt(l, c + 1, r) === CELL_CORRIDOR) out.push(i + 1);
  if (cellAt(l, c - 1, r) === CELL_CORRIDOR) out.push(i - 1);
  if (cellAt(l, c, r + 1) === CELL_CORRIDOR) out.push(i + l.cols);
  if (cellAt(l, c, r - 1) === CELL_CORRIDOR) out.push(i - l.cols);
  return out;
}

/** Shortest corridor path between two cells (BFS), as cell indices. */
function corridorPath(l: Layout, from: number, to: number): number[] {
  const prev = new Int32Array(l.cells.length).fill(-1);
  const q = [from];
  prev[from] = from;
  for (let h = 0; h < q.length; h++) {
    const i = q[h]!;
    if (i === to) break;
    for (const j of neighbours(l, i)) {
      if (prev[j] !== -1) continue;
      prev[j] = i;
      q.push(j);
    }
  }
  if (prev[to] === -1) return [from];
  const path = [to];
  while (path[path.length - 1] !== from) path.push(prev[path[path.length - 1]!]!);
  return path.reverse();
}

/** Waypoints at the path's ends and corners only. */
function compress(l: Layout, path: number[]): Waypoint[] {
  const pts: Waypoint[] = [];
  for (let k = 0; k < path.length; k++) {
    const i = path[k]!;
    const prev = path[k - 1];
    const next = path[k + 1];
    const corner = prev === undefined || next === undefined || i - prev !== next - i;
    if (!corner) continue;
    const p = cellCentre(i % l.cols, Math.floor(i / l.cols));
    pts.push({ x: p.x, z: p.z, dwell: 0, look: null, sweep: 0 });
  }
  return pts;
}

function cellOf(l: Layout, x: number, z: number): number {
  return Math.floor(z / CELL) * l.cols + Math.floor(x / CELL);
}

/** Corridor cell a room door opens onto. */
function doorCell(l: Layout, room: Room): number {
  const d = room.doors[0]!;
  const ox = d.axis === 'x' ? (cellAt(l, Math.floor((d.x + 0.5) / CELL), Math.floor(d.z / CELL)) === CELL_CORRIDOR ? 0.5 : -0.5) : 0;
  const oz = d.axis === 'z' ? (cellAt(l, Math.floor(d.x / CELL), Math.floor((d.z + 0.5) / CELL)) === CELL_CORRIDOR ? 0.5 : -0.5) : 0;
  return cellOf(l, d.x + ox, d.z + oz);
}

function spawn(archetype: Archetype, idx: number, route: Waypoint[], loop: boolean, rng: Rng): StaffSpawn {
  const def = STAFF_DEFAULTS[archetype];
  const names = NAMES[archetype];
  // One name offset per plan and archetype (drawn from a fork so it never shifts other draws), then in order.
  const offset = rng.fork(archetype.length * 31 + names.length).int(0, names.length - 1);
  return {
    archetype,
    skin: `${archetype}${idx}`,
    name: names[(idx + offset) % names.length]!,
    route,
    loop,
    speed: def.speed,
    coneRange: def.range,
    coneHalf: def.half,
    eye: def.eye,
  };
}

/** Out-and-back patrol between two far-apart corridor cells, pausing at each end. */
function patrolRoute(l: Layout, rng: Rng, avoid: ReadonlySet<number>, dwell: number): Waypoint[] {
  const all = corridorCells(l);
  const free = all.filter((i) => !avoid.has(i));
  const cells = free.length > 0 ? free : all;
  const a = rng.pick(cells);
  const dist = corridorDistances(l, a % l.cols, Math.floor(a / l.cols));
  let b = a;
  let best = -1;
  for (const i of cells) {
    const d = dist[i]! + rng.next() * 1.5; // slight jitter so patrols vary
    if (d > best) {
      best = d;
      b = i;
    }
  }
  const pts = compress(l, corridorPath(l, a, b));
  (avoid as Set<number>).add(a);
  pts[0]!.dwell = dwell;
  pts[0]!.sweep = 0.6;
  pts[pts.length - 1]!.dwell = dwell;
  pts[pts.length - 1]!.sweep = 0.6;
  return pts;
}

/** Long seeded random walk on the corridor graph (custodian, snitch); covers the whole bell and then some. */
function wanderRoute(l: Layout, rng: Rng, speed: number, bellTicks: number): Waypoint[] {
  const cells = corridorCells(l);
  let cur = rng.pick(cells);
  let prev = -1;
  const path = [cur];
  let metres = 0;
  const need = (speed * bellTicks) / S + 40;
  for (let guard = 0; guard < 2000 && metres < need; guard++) {
    const nb = neighbours(l, cur).filter((j) => j !== prev);
    const next = nb.length > 0 ? rng.pick(nb) : prev;
    if (next < 0) break;
    prev = cur;
    cur = next;
    path.push(cur);
    metres += CELL;
  }
  const pts = compress(l, path);
  for (const p of pts) if (rng.chance(0.25)) p.dwell = rng.int(2, 5) * S;
  return pts;
}

export function placeStaff(
  l: Layout,
  fine: FineGrid,
  rooms: Room[],
  tier: TierDef,
  mission: MissionId,
  anchors: Partial<Record<AnchorId, Anchor>>,
  bellTicks: number,
  rng: Rng,
): StaffSpawn[] | null {
  const out: StaffSpawn[] = [];
  const startRoom = rooms.find((r) => r.tags.includes('start'))!;
  const startCell = doorCell(l, startRoom);
  // Patrol starts are spread out: never your door's hall cell, never another patrol's start.
  const used = new Set<number>([startCell]);
  // The finale needs Hargrove even at schools that have no vice principal on the roster.
  const want = (a: Archetype): number => (mission === 'principal' && a === 'investigator' ? Math.max(1, tier.staff[a] ?? 0) : (tier.staff[a] ?? 0));

  for (let k = 0; k < want('patroller'); k++) out.push(spawn('patroller', k, patrolRoute(l, rng, used, 2 * S), false, rng));

  // Teachers stand just inside their classroom door and alternate: look out into the hall, look back at the class.
  const classes = rooms.filter((r) => r.kind === 'classroom' && !r.tags.includes('start'));
  const picked: Room[] = [];
  for (let k = 0; k < want('sentry') && classes.length > 0; k++) picked.push(classes.splice(rng.int(0, classes.length - 1), 1)[0]!);
  picked.forEach((room, k) => {
    const d = room.doors[0]!;
    const rcx = ((room.rect.c0 + room.rect.c1) / 2) * CELL;
    const rcz = ((room.rect.r0 + room.rect.r1) / 2) * CELL;
    // Unit step from the door into the room.
    const ix = d.axis === 'x' ? Math.sign(rcx - d.x) : 0;
    const iz = d.axis === 'z' ? Math.sign(rcz - d.z) : 0;
    const x = d.x + ix * 1.4;
    const z = d.z + iz * 1.4;
    const out_ = yawOf(-ix, -iz);
    const look = rng.int(3, 5) * S;
    const away = rng.int(4, 7) * S;
    const route: Waypoint[] = [
      { x, z, dwell: look, look: out_, sweep: 0.35 },
      { x, z, dwell: away, look: out_ + PI, sweep: 0 },
    ];
    out.push(spawn('sentry', k, route, true, rng));
  });

  for (let k = 0; k < want('investigator'); k++) {
    const office = rooms.find((r) => r.kind === 'office') ?? rooms[0]!;
    const oc = doorCell(l, office);
    const route = patrolRoute(l, rng, used, 4 * S);
    const head = compress(l, corridorPath(l, oc, cellOf(l, route[0]!.x, route[0]!.z)));
    const full = head.concat(route.slice(1));
    full[0]!.dwell = 6 * S;
    full[0]!.sweep = 0.8;
    out.push(spawn('investigator', k, full, false, rng));
  }

  // Cameras: at corridor dead ends and corners, looking down the hall.
  // Never on the halls right outside your classroom or next to the goal (2 corridor cells either way).
  const nearStart = corridorDistances(l, startCell % l.cols, Math.floor(startCell / l.cols));
  const goals = (['goal', 'goal2', 'goal3'] as const).map((g) => anchors[g]).filter((a): a is Anchor => !!a);
  const goalCells = goals.map((a) => nearestCorridor(l, a.x, a.z)).filter((i) => i >= 0);
  const nearGoal = goalCells.map((g) => corridorDistances(l, g % l.cols, Math.floor(g / l.cols)));
  const spots = corridorCells(l).filter(
    (i) => (neighbours(l, i).length !== 2 || isCorner(l, i)) && !(nearStart[i]! >= 0 && nearStart[i]! <= 2) && !nearGoal.some((d) => d[i]! >= 0 && d[i]! <= 2),
  );
  for (let k = 0; k < want('sweeper') && spots.length > 0; k++) {
    const i = spots.splice(rng.int(0, spots.length - 1), 1)[0]!;
    // Watch along a hall whose opposite side is a wall, so the camera can hang on it.
    const nb = neighbours(l, i).filter((j) => l.cells[2 * i - j] !== CELL_CORRIDOR || !inGrid(l, i, j));
    if (nb.length === 0) {
      k--;
      continue;
    }
    const p = cellCentre(i % l.cols, Math.floor(i / l.cols));
    const toward = rng.pick(nb);
    const q = cellCentre(toward % l.cols, Math.floor(toward / l.cols));
    // Mount on the back wall of the cell, opposite the direction it watches.
    const dx = Math.sign(q.x - p.x);
    const dz = Math.sign(q.z - p.z);
    const x = p.x - dx * 2.2;
    const z = p.z - dz * 2.2;
    out.push(spawn('sweeper', k, [{ x, z, dwell: 1 << 30, look: yawOf(dx, dz), sweep: 1.0 }], true, rng));
  }

  for (let k = 0; k < want('wanderer'); k++) out.push(spawn('wanderer', k, wanderRoute(l, rng, STAFF_DEFAULTS.wanderer.speed, bellTicks), false, rng));
  for (let k = 0; k < want('snitch'); k++) out.push(spawn('snitch', k, wanderRoute(l, rng, STAFF_DEFAULTS.snitch.speed, bellTicks), false, rng));

  if (mission === 'phone') {
    const sec = secretary(l, fine, rooms, anchors, rng);
    if (!sec) return null;
    out.push(sec);
  }
  if (mission === 'gym') {
    const cam = goalCamera(fine, anchors.goal!, rng);
    if (!cam) return null;
    out.push(cam);
  }

  for (let k = 0; k < want('listener'); k++) {
    const lib = rooms.find((r) => r.kind === 'library');
    if (!lib) continue;
    const x = ((lib.rect.c0 + lib.rect.c1) / 2) * CELL;
    const z = ((lib.rect.r0 + lib.rect.r1) / 2) * CELL + 2.5;
    out.push(spawn('listener', k, [{ x, z, dwell: 1 << 30, look: 0, sweep: 0 }], true, rng));
  }
  return out;
}

/** Open floor with room for a body (the 3×3 fine block around the point has no solid or low cell). */
function roomy(fine: FineGrid, x: number, z: number): boolean {
  const c0 = Math.floor(x / FINE);
  const r0 = Math.floor(z / FINE);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || r < 0 || c >= fine.cols || r >= fine.rows || fine.flags[r * fine.cols + c]! & (F_SOLID | F_LOW)) return false;
    }
  }
  return true;
}

/**
 * PHONE JAIL (GDD §7.1): the secretary sits right beside the drawer, then takes a coffee walk out to the hall and
 * back — the window you wait for. Ping-pong route: her seat → (a walkable path out of the office) → the coffee
 * spot two corridor cells along.
 */
function secretary(l: Layout, fine: FineGrid, rooms: Room[], anchors: Partial<Record<AnchorId, Anchor>>, rng: Rng): StaffSpawn | null {
  const office = rooms.find((r) => r.kind === 'office' && r.tags.includes('mission'));
  const goal = anchors.goal;
  if (!office || !goal) return null;
  // Her seat: the roomiest open spot 1.2–2.2 m from the drawer, closest to 1.5 m.
  let seat: { x: number; z: number } | null = null;
  let bestErr = Infinity;
  const c0 = Math.floor(goal.x / FINE);
  const r0 = Math.floor(goal.z / FINE);
  for (let r = r0 - 5; r <= r0 + 5; r++) {
    for (let c = c0 - 5; c <= c0 + 5; c++) {
      const x = (c + 0.5) * FINE;
      const z = (r + 0.5) * FINE;
      const d = Math.sqrt((x - goal.x) * (x - goal.x) + (z - goal.z) * (z - goal.z));
      if (d < 1.2 || d > 2.2 || !roomy(fine, x, z)) continue;
      const err = Math.abs(d - 1.5);
      if (err < bestErr) {
        bestErr = err;
        seat = { x, z };
      }
    }
  }
  if (!seat) return null;
  const dc = doorCell(l, office);
  const far = corridorDistances(l, dc % l.cols, Math.floor(dc / l.cols));
  const spots = corridorCells(l).filter((i) => far[i] === 2);
  const coffeeCell = spots.length > 0 ? rng.pick(spots) : dc;
  const door = cellCentre(dc % l.cols, Math.floor(dc / l.cols));
  const walk = findPath(fine, seat.x, seat.z, door.x, door.z);
  if (!walk) return null;
  // Facing the drawer, turned 60° toward the room: it sits at the edge of her cone, and her glances sweep over it.
  const toGoal = yawOf(goal.x - seat.x, goal.z - seat.z);
  const rcx = ((office.rect.c0 + office.rect.c1) / 2) * CELL;
  const rcz = ((office.rect.r0 + office.rect.r1) / 2) * CELL;
  const toRoom = yawOf(rcx - seat.x, rcz - seat.z);
  const turn = wrapAngle(toRoom - toGoal) > 0 ? 1 : -1;
  const look = toGoal + turn * 1.05;
  const route: Waypoint[] = [{ x: seat.x, z: seat.z, dwell: rng.int(18, 26) * S, look, sweep: 0.45 }];
  for (let k = 0; k + 1 < walk.length; k += 2) route.push({ x: walk[k]!, z: walk[k + 1]!, dwell: 0, look: null, sweep: 0 });
  route.push(...compress(l, corridorPath(l, dc, coffeeCell)).slice(1));
  const end = route[route.length - 1]!;
  end.dwell = rng.int(14, 20) * S;
  end.sweep = 0.5;
  const sp = spawn('sentry', 9, route, false, rng);
  sp.name = SECRETARY[rng.int(0, SECRETARY.length - 1)]!;
  sp.skin = 'secretary0';
  return sp;
}

/** GYM BAG (GDD §7.5): a camera on the locker strip a few metres from your locker, sweeping past it. */
function goalCamera(fine: FineGrid, goal: Anchor, rng: Rng): StaffSpawn | null {
  // The goal stands 0.6 m out from the locker face, facing it (yaw); the strip runs across that.
  const fx = fsin(goal.yaw);
  const fz = fcos(goal.yaw);
  const alX = fcos(goal.yaw);
  const alZ = -fsin(goal.yaw);
  const offs = rng.chance(0.5) ? [3.5, -3.5, 2.75, -2.75] : [-3.5, 3.5, -2.75, 2.75];
  for (const off of offs) {
    // On the strip face (0.35 m from the goal toward the lockers), `off` along it.
    const x = goal.x + fx * 0.35 + alX * off;
    const z = goal.z + fz * 0.35 + alZ * off;
    const c = Math.floor(x / FINE);
    const r = Math.floor(z / FINE);
    if (c < 0 || r < 0 || c >= fine.cols || r >= fine.rows || fine.flags[r * fine.cols + c]! & F_SOLID) continue;
    const look = yawOf(goal.x - x, goal.z - z);
    const sp = spawn('sweeper', 9, [{ x, z, dwell: 1 << 30, look, sweep: 0.75 }], true, rng);
    return sp;
  }
  return null;
}

function isCorner(l: Layout, i: number): boolean {
  const nb = neighbours(l, i);
  return nb.length === 2 && Math.abs(nb[0]! - nb[1]!) !== 2 && Math.abs(nb[0]! - nb[1]!) !== 2 * l.cols;
}

/** The cell opposite `j` across `i` is inside the grid (same row for horizontal steps). */
function inGrid(l: Layout, i: number, j: number): boolean {
  const o = 2 * i - j;
  if (o < 0 || o >= l.cells.length) return false;
  return Math.abs(i - j) === 1 ? Math.floor(o / l.cols) === Math.floor(i / l.cols) : true;
}

/** Corridor cell nearest a point (straight-line, by cell centre), or −1. */
function nearestCorridor(l: Layout, x: number, z: number): number {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < l.cells.length; i++) {
    if (l.cells[i] !== CELL_CORRIDOR) continue;
    const p = cellCentre(i % l.cols, Math.floor(i / l.cols));
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
