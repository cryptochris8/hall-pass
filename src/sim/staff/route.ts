// Route following for every archetype (docs/ARCHITECTURE.md §5): walk to each waypoint at the route speed, wait its
// dwell while looking at its `look` yaw with an optional head sweep, then move on (loop or ping-pong). Brains that
// react to noise and sightings (milestone M3) set intent on top of this; they never move bodies directly.
// Pure, deterministic.
import { TAU, fsin, turnToward, wrapAngle, yawOf } from '../../core/fmath';
import type { StaffSpawn } from '../../school/types';
import { SWEEP_PERIOD, STAFF_TURN } from '../tuning';
import { SIM_DT, SIM_HZ, type StaffState } from '../types';

export function initStaff(spawn: StaffSpawn): StaffState {
  const w = spawn.route[0]!;
  const yaw = w.look ?? 0;
  return {
    archetype: spawn.archetype,
    x: w.x,
    z: w.z,
    yaw,
    look: yaw,
    wp: 0,
    dir: 1,
    dwell: w.dwell,
    dwellT: 0,
    moving: false,
    suspicion: 0,
    level: 'calm',
    ignore: 0,
    seesStudent: false,
  };
}

function advance(st: StaffState, spawn: StaffSpawn): void {
  const n = spawn.route.length;
  if (n <= 1) return;
  if (spawn.loop) st.wp = (st.wp + 1) % n;
  else {
    if (st.wp + st.dir < 0 || st.wp + st.dir >= n) st.dir = st.dir === 1 ? -1 : 1;
    st.wp += st.dir;
  }
}

/** One tick of route following. `speedMult` comes from difficulty. */
export function stepRoute(st: StaffState, spawn: StaffSpawn, speedMult: number): void {
  const turn = STAFF_TURN[spawn.archetype] * SIM_DT;
  const target = spawn.route[st.wp]!;
  if (st.dwell > 0) {
    st.moving = false;
    st.dwell--;
    st.dwellT++;
    const base = target.look ?? st.yaw;
    st.yaw = turnToward(st.yaw, base, turn);
    const sweep = target.sweep > 0 ? target.sweep * fsin((TAU * st.dwellT) / (SWEEP_PERIOD[spawn.archetype] * SIM_HZ)) : 0;
    st.look = turnToward(st.look, wrapAngle(st.yaw + sweep), turn * 1.5);
    if (st.dwell === 0) advance(st, spawn);
    return;
  }
  const dx = target.x - st.x;
  const dz = target.z - st.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const step = spawn.speed * speedMult * SIM_DT;
  if (d <= step || step <= 0) {
    st.x = target.x;
    st.z = target.z;
    st.moving = false;
    st.dwellT = 0;
    st.dwell = target.dwell;
    if (st.dwell === 0) advance(st, spawn);
    else if (target.look !== null) st.yaw = turnToward(st.yaw, target.look, turn);
    st.look = turnToward(st.look, st.yaw, turn * 1.5);
    return;
  }
  st.moving = true;
  st.x += (dx / d) * step;
  st.z += (dz / d) * step;
  st.yaw = turnToward(st.yaw, yawOf(dx, dz), turn);
  st.look = turnToward(st.look, st.yaw, turn * 1.5);
}
