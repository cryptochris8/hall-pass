// ─────────────────────────────────────────────────────────────────────────────
// Staff brains (docs/GDD.md §4–5, docs/ARCHITECTURE.md §5). The state machine
// from Trash Panda's enemies (patrol → investigate → notice → chase → search →
// return), rewritten for this sim: fixed ticks, deterministic math, fine-grid
// pathfinding. Brains decide intent and move bodies along paths; the generated
// route still drives 'route' mode (staff/route.ts). Everything here reacts only
// to the student (sight, noise) and PA announcements, so with no student a run
// is a pure function of the plan — which is what the fairness validator relies on.
// Pure; deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import { TAU, fsin, turnToward, wrapAngle, yawOf } from '../../core/fmath';
import { CELL, CELL_CORRIDOR, type PaEventId, type SchoolPlan, type StaffSpawn } from '../../school/types';
import { resolveCollision } from '../move';
import { findPath } from '../nav';
import { BRAIN, CHASE_SPEED, STAFF_TURN } from '../tuning';
import { SIM_DT, SIM_HZ, type SimEvent, type StaffMode, type StaffState } from '../types';

const BODY_R = 0.28;

export function setMode(st: StaffState, mode: StaffMode): void {
  st.mode = mode;
  st.modeT = 0;
  st.wait = -1;
}

/** Plan a walk to (x, z). Falls back to steering straight when no path is found. */
export function goTo(st: StaffState, plan: SchoolPlan, x: number, z: number): void {
  st.tx = x;
  st.tz = z;
  st.path = findPath(plan.fine, st.x, st.z, x, z) ?? [x, z];
  st.pathI = 0;
}

/** Step along the current path at `speed` (m/s). Returns true on arrival at the final point. */
export function moveAlong(st: StaffState, plan: SchoolPlan, spawn: StaffSpawn, speed: number): boolean {
  const turn = STAFF_TURN[spawn.archetype] * SIM_DT;
  let step = speed * SIM_DT;
  while (step > 0) {
    if (st.pathI * 2 >= st.path.length) {
      st.moving = false;
      return true;
    }
    const wx = st.path[st.pathI * 2]!;
    const wz = st.path[st.pathI * 2 + 1]!;
    const dx = wx - st.x;
    const dz = wz - st.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= step) {
      st.x = wx;
      st.z = wz;
      step -= d;
      st.pathI++;
      continue;
    }
    st.x += (dx / d) * step;
    st.z += (dz / d) * step;
    st.yaw = turnToward(st.yaw, yawOf(dx, dz), turn * 1.5);
    step = 0;
  }
  const p = { x: st.x, z: st.z };
  resolveCollision(plan.fine, p, BODY_R);
  st.x = p.x;
  st.z = p.z;
  st.moving = true;
  st.look = turnToward(st.look, st.yaw, turn * 2);
  return st.pathI * 2 >= st.path.length;
}

/** Head sweep while standing and looking around. */
export function lookAround(st: StaffState, spawn: StaffSpawn): void {
  const turn = STAFF_TURN[spawn.archetype] * SIM_DT;
  const sweep = 0.9 * fsin((TAU * st.modeT) / (2.4 * SIM_HZ));
  st.look = turnToward(st.look, wrapAngle(st.yaw + sweep), turn * 1.5);
  st.moving = false;
}

export function face(st: StaffState, spawn: StaffSpawn, x: number, z: number): void {
  const turn = STAFF_TURN[spawn.archetype] * SIM_DT;
  const want = yawOf(x - st.x, z - st.z);
  st.yaw = turnToward(st.yaw, want, turn * 2);
  st.look = turnToward(st.look, want, turn * 3);
  st.moving = false;
}

export function walkSpeed(spawn: StaffSpawn, mult: number): number {
  return Math.max(0.9, spawn.speed) * mult;
}

export function chaseSpeed(spawn: StaffSpawn, mult: number): number {
  return CHASE_SPEED[spawn.archetype] * mult;
}

/** Send a staff member to look at a spot (noise, report, camera alert). */
export function investigate(st: StaffState, plan: SchoolPlan, spawn: StaffSpawn, x: number, z: number): void {
  if (spawn.archetype === 'sweeper') return;
  if (spawn.speed <= 0 && spawn.archetype !== 'listener') return;
  // Teachers and the librarian only check spots near their post.
  const home = spawn.route[0]!;
  const leash = spawn.archetype === 'sentry' ? BRAIN.sentryLeash : spawn.archetype === 'listener' ? BRAIN.librarianLeash : Infinity;
  const hx = x - home.x;
  const hz = z - home.z;
  if (hx * hx + hz * hz > leash * leash) return;
  if (st.mode === 'investigate' && st.wait < 0) {
    const ox = st.tx - x;
    const oz = st.tz - z;
    if (ox * ox + oz * oz < 4) return; // already heading there
  }
  setMode(st, 'investigate');
  st.lastX = x;
  st.lastZ = z;
  goTo(st, plan, x, z);
}

/** Walk back to the current route waypoint. */
export function returnToRoute(st: StaffState, plan: SchoolPlan, spawn: StaffSpawn): void {
  setMode(st, 'return');
  const w = spawn.route[st.wp]!;
  goTo(st, plan, w.x, w.z);
}

export function startChase(st: StaffState, plan: SchoolPlan, x: number, z: number, ev: SimEvent[], i: number): void {
  setMode(st, 'chase');
  st.chaseT = 0;
  st.lostT = 0;
  st.lastX = x;
  st.lastZ = z;
  st.suspicion = 1;
  st.replan = 0;
  goTo(st, plan, x, z);
  ev.push({ t: 'chase', staff: i, on: true, escaped: false });
}

/** Where a PA announcement sends who (null: nobody moves). Pure function of the plan. */
export function paOrder(plan: SchoolPlan, id: PaEventId): { archetype: StaffSpawn['archetype']; x: number; z: number; seconds: number } | null {
  const doorOutside = (kind: string): { x: number; z: number } | null => {
    const room = plan.rooms.find((r) => r.kind === kind);
    const d = room?.doors[0];
    if (!d) return null;
    // Two metres out into the corridor side of the door.
    for (const s of [1, -1]) {
      const x = d.axis === 'x' ? d.x + s * 2 : d.x;
      const z = d.axis === 'z' ? d.z + s * 2 : d.z;
      const c = Math.floor(x / CELL);
      const r = Math.floor(z / CELL);
      if (plan.cells[r * plan.grid.cols + c] === CELL_CORRIDOR) return { x, z };
    }
    return null;
  };
  if (id === 'vpToOffice') {
    const p = doorOutside('office');
    return p ? { archetype: 'investigator', ...p, seconds: 20 } : null;
  }
  if (id === 'custodialToGym') {
    const p = doorOutside('gym') ?? doorOutside('cafeteria');
    return p ? { archetype: 'wanderer', ...p, seconds: 25 } : null;
  }
  if (id === 'carLights') {
    // The corridor cell farthest from your desk: the patrol leaves your part of the school for a while.
    const start = plan.anchors.start!;
    let best: { x: number; z: number } | null = null;
    let bd = -1;
    for (let i = 0; i < plan.cells.length; i++) {
      if (plan.cells[i] !== CELL_CORRIDOR) continue;
      const x = ((i % plan.grid.cols) + 0.5) * CELL;
      const z = (Math.floor(i / plan.grid.cols) + 0.5) * CELL;
      const d = (x - start.x) * (x - start.x) + (z - start.z) * (z - start.z);
      if (d > bd) {
        bd = d;
        best = { x, z };
      }
    }
    return best ? { archetype: 'patroller', ...best, seconds: 30 } : null;
  }
  return null;
}
