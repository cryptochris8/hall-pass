// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL CONTRACT — the output of the floor-plan generator (docs/GDD.md §3,
// docs/ARCHITECTURE.md §4). PURE DATA: no three.js, no DOM. The sim, the 3D world,
// the minimap and the validator all read a SchoolPlan; nobody writes it after
// generation (except validate(), which fills `referenceRoute`).
//
// Two grids describe one school:
//   • the CELL grid (8 m cells) is the layout: corridors and rooms;
//   • the FINE grid (0.5 m cells) is the truth for movement and sight: every fine
//     cell is open, low (blocks movement, and sight only against a sneaking
//     student) or solid (blocks both). Walls, locker banks and furniture are all
//     stamped into it, and the world renders walls from its solid runs.
// FROZEN shared contract (owner: school).
// ─────────────────────────────────────────────────────────────────────────────

/** Metres per layout cell. */
export const CELL = 8;
/** Metres per fine (movement / sight) cell. */
export const FINE = 0.5;
/** Fine cells per layout cell along one axis. */
export const FINE_PER_CELL = CELL / FINE;
/** Locker / wall mass inside a corridor cell along each non-corridor edge (fine cells). 3 → halls are 5 m wide. */
export const CORRIDOR_INSET = 3;
/** Room wall thickness on the room's side of an edge (fine cells). */
export const ROOM_WALL = 1;
/** Door width (fine cells). */
export const DOOR_WIDTH = 3;

/** Fine-grid flags. */
export const F_SOLID = 1;
export const F_LOW = 2;
/** Fine cell belongs to a corridor (for the minimap and staff wandering). */
export const F_CORRIDOR = 4;

export type TierId = 1 | 2 | 3 | 4 | 5;
export type MissionId = 'phone' | 'vending' | 'pizza' | 'locker' | 'gym' | 'principal';
export const MISSION_IDS: readonly MissionId[] = ['phone', 'vending', 'pizza', 'locker', 'gym', 'principal'];
export type Difficulty = 'freshman' | 'junior' | 'senior';
export const DIFFICULTIES: readonly Difficulty[] = ['freshman', 'junior', 'senior'];

export type RoomKind =
  | 'classroom'
  | 'office'
  | 'principal'
  | 'library'
  | 'cafeteria'
  | 'gym'
  | 'bathroom'
  | 'art'
  | 'band'
  | 'lab'
  | 'courtyard';

/** Cell rectangle, c0/r0 inclusive, c1/r1 exclusive. Column = +X, row = +Z. */
export interface CellRect {
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/** A door: centre in metres; `axis` is the direction you walk through it. */
export interface Door {
  x: number;
  z: number;
  axis: 'x' | 'z';
}

export type RoomTag = 'quiet' | 'echo' | 'safe' | 'outdoor' | 'start' | 'mission';

export interface Room {
  id: number;
  kind: RoomKind;
  rect: CellRect;
  doors: Door[];
  tags: RoomTag[];
}

export type FurnitureKind =
  | 'desk'
  | 'teacherDesk'
  | 'locker'
  | 'stall'
  | 'shelf'
  | 'table'
  | 'bleachers'
  | 'vending'
  | 'officeDesk'
  | 'trophyCase'
  | 'bench'
  | 'planter';

export type FurnitureTag = 'cover' | 'lowCover' | 'hide' | 'noisy' | 'throwables' | 'goal';

/** Axis-aligned footprint, centre (x, z) in metres, size w (X) × d (Z), height h. `face` = yaw it faces (rad). */
export interface Furniture {
  kind: FurnitureKind;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  face: number;
  tags: FurnitureTag[];
}

export interface Anchor {
  x: number;
  z: number;
  yaw: number;
}

export type AnchorId = 'start' | 'goal' | 'goal2' | 'goal3' | `checkpoint${number}`;

export type ZoneKind = 'dim' | 'quiet' | 'echo' | 'polished';
/** Rectangle in metres. */
export interface Zone {
  kind: ZoneKind;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type Archetype = 'patroller' | 'sentry' | 'investigator' | 'sweeper' | 'wanderer' | 'snitch' | 'listener';
export const ARCHETYPES: readonly Archetype[] = ['patroller', 'sentry', 'investigator', 'sweeper', 'wanderer', 'snitch', 'listener'];

/**
 * One stop on a staff route. The staff walks to (x, z) then waits `dwell` ticks. While waiting it looks at `look`
 * (yaw, rad) or keeps its walking direction when null; `sweep` > 0 swings the head ±sweep rad around it.
 */
export interface Waypoint {
  x: number;
  z: number;
  dwell: number;
  look: number | null;
  sweep: number;
}

export interface StaffSpawn {
  archetype: Archetype;
  /** Cosmetic id for people/ (the sim stores it and never reads it). */
  skin: string;
  /** Display name for captions ("Mr. Dunlap"). */
  name: string;
  route: Waypoint[];
  /** true: loop back to waypoint 0; false: ping-pong. */
  loop: boolean;
  /** Walking speed, m/s. */
  speed: number;
  /** Vision cone: range (m), half angle (rad). range 0 = no sight (listener). */
  coneRange: number;
  coneHalf: number;
  /** Eye height (m) — cameras sit high, people at 1.6. */
  eye: number;
}

export interface ExtraSpawn {
  route: Waypoint[];
  speed: number;
}

export type PaEventId = 'vpToOffice' | 'custodialToGym' | 'carLights' | 'hatsOff';
export interface PaEvent {
  tick: number;
  id: PaEventId;
}

/** A point on the validator's reference route (metres, tick). */
export interface RoutePoint {
  x: number;
  z: number;
  tick: number;
  sneak: boolean;
}

export interface FineGrid {
  cols: number;
  rows: number;
  /** F_* flags per fine cell, row-major (index = row * cols + col). */
  flags: Uint8Array;
}

export interface SchoolPlan {
  seed: number;
  tier: TierId;
  mission: MissionId;
  /** "Pine Hollow High". Generated, never a real school. */
  name: string;
  /** "Home of the Owls". */
  motto: string;
  grid: { cols: number; rows: number };
  /** Per layout cell: −1 outside, −2 corridor, ≥ 0 room id. Row-major. */
  cells: Int16Array;
  fine: FineGrid;
  rooms: Room[];
  furniture: Furniture[];
  zones: Zone[];
  anchors: Partial<Record<AnchorId, Anchor>>;
  staff: StaffSpawn[];
  extras: ExtraSpawn[];
  snacks: { x: number; z: number }[];
  throwables: { x: number; z: number }[];
  pa: PaEvent[];
  bellTicks: number;
  /** Layout and staff re-rolls the generator needed (part of the plan, so a seed always ends the same way). */
  rerolls: number;
  /** true when the generator gave up and used the tier's fallback layout. */
  fallback: boolean;
  referenceRoute: RoutePoint[] | null;
}

export const CELL_OUTSIDE = -1;
export const CELL_CORRIDOR = -2;

/** Size of a plan in metres. */
export function planSize(plan: Pick<SchoolPlan, 'grid'>): { w: number; d: number } {
  return { w: plan.grid.cols * CELL, d: plan.grid.rows * CELL };
}

/** Fine-cell index for a world point, or −1 outside the grid. */
export function fineIndex(fine: FineGrid, x: number, z: number): number {
  const c = Math.floor(x / FINE);
  const r = Math.floor(z / FINE);
  if (c < 0 || r < 0 || c >= fine.cols || r >= fine.rows) return -1;
  return r * fine.cols + c;
}

/** Flags at a world point (outside the grid counts as solid). */
export function fineAt(fine: FineGrid, x: number, z: number): number {
  const i = fineIndex(fine, x, z);
  return i < 0 ? F_SOLID : fine.flags[i]!;
}
