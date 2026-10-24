// Student movement + collision against the fine grid (circle vs blocking cells). Pure, deterministic: sqrt and
// + − × ÷ only. Owner: sim.
import { turnToward, yawOf } from '../core/fmath';
import { FINE, F_LOW, F_SOLID, type FineGrid } from '../school/types';
import { STUDENT } from './tuning';
import { BTN_SNEAK, BTN_SPRINT, SIM_DT, type StudentState, type TickInput } from './types';

const BLOCK = F_SOLID | F_LOW;

/** Push a circle out of every blocking fine cell around it (two passes settle corners). */
export function resolveCollision(fine: FineGrid, p: { x: number; z: number }, r: number): void {
  for (let pass = 0; pass < 2; pass++) {
    const c0 = Math.floor((p.x - r) / FINE);
    const c1 = Math.floor((p.x + r) / FINE);
    const r0 = Math.floor((p.z - r) / FINE);
    const r1 = Math.floor((p.z + r) / FINE);
    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        const solid = cc < 0 || rr < 0 || cc >= fine.cols || rr >= fine.rows || (fine.flags[rr * fine.cols + cc]! & BLOCK) !== 0;
        if (!solid) continue;
        const x0 = cc * FINE;
        const z0 = rr * FINE;
        const qx = p.x < x0 ? x0 : p.x > x0 + FINE ? x0 + FINE : p.x;
        const qz = p.z < z0 ? z0 : p.z > z0 + FINE ? z0 + FINE : p.z;
        const dx = p.x - qx;
        const dz = p.z - qz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-12) {
          const d = Math.sqrt(d2);
          p.x = qx + (dx / d) * r;
          p.z = qz + (dz / d) * r;
        } else {
          // Centre inside the cell: push out along the shallowest axis.
          const left = p.x - x0;
          const right = x0 + FINE - p.x;
          const top = p.z - z0;
          const bottom = z0 + FINE - p.z;
          const m = Math.min(left, right, top, bottom);
          if (m === left) p.x = x0 - r;
          else if (m === right) p.x = x0 + FINE + r;
          else if (m === top) p.z = z0 - r;
          else p.z = z0 + FINE + r;
        }
      }
    }
  }
}

/** One tick of student movement from input. */
export function moveStudent(fine: FineGrid, s: StudentState, input: TickInput): void {
  let mx = input.moveX / 127;
  let my = input.moveY / 127;
  let mag = Math.sqrt(mx * mx + my * my);
  if (mag > 1) {
    mx /= mag;
    my /= mag;
    mag = 1;
  }
  const wantsSprint = (input.buttons & BTN_SPRINT) !== 0 && mag > 0.2;
  const sneaking = (input.buttons & BTN_SNEAK) !== 0 || (mag > 0 && mag < STUDENT.sneakTilt);
  if (wantsSprint && (s.posture === 'sprint' ? s.stamina > 0 : s.stamina >= STUDENT.sprintMin)) s.posture = 'sprint';
  else s.posture = sneaking ? 'sneak' : 'walk';
  if (s.posture === 'sprint') s.stamina = Math.max(0, s.stamina - SIM_DT / STUDENT.sprintSeconds);
  else s.stamina = Math.min(1, s.stamina + SIM_DT / STUDENT.refillSeconds);

  // Fixed camera (docs/ARCHITECTURE.md §6): worldX = moveX, worldZ = −moveY. Analog sneak keeps full sneak speed.
  const speed = STUDENT.speed[s.posture] * (s.posture === 'sneak' ? (mag > 0 ? 1 : 0) : mag);
  const tx = mag > 0 ? (mx / mag) * speed : 0;
  const tz = mag > 0 ? (-my / mag) * speed : 0;
  const dvx = tx - s.vx;
  const dvz = tz - s.vz;
  const dv = Math.sqrt(dvx * dvx + dvz * dvz);
  const maxDv = STUDENT.accel * SIM_DT;
  if (dv <= maxDv) {
    s.vx = tx;
    s.vz = tz;
  } else {
    s.vx += (dvx / dv) * maxDv;
    s.vz += (dvz / dv) * maxDv;
  }
  const px = s.x;
  const pz = s.z;
  const p = { x: s.x + s.vx * SIM_DT, z: s.z + s.vz * SIM_DT };
  resolveCollision(fine, p, STUDENT.radius);
  s.x = p.x;
  s.z = p.z;
  // Velocity after collision (sliding along walls).
  s.vx = (s.x - px) / SIM_DT;
  s.vz = (s.z - pz) / SIM_DT;
  if (mag > 0.05) s.yaw = turnToward(s.yaw, yawOf(mx, -my), STUDENT.turn * SIM_DT);
}
