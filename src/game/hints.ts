// ─────────────────────────────────────────────────────────────────────────────
// Hints (docs/GDD.md §11): after 20 s without progress, footprints from the
// reference route fade in for the next stretch. "Progress" is moving further
// along the route's current leg (the stretch toward the next goal, or back to
// your desk) or collecting something. Hiding and being walked back don't count
// as stalling. Pure; the footprints are drawn by src/world/hints.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { RoutePoint } from '../school/types';
import type { SimState } from '../sim/types';

export const HINT_AFTER_SECONDS = 20;
/** Length of route the footprints cover (m) and the spacing between prints (m). */
export const HINT_LENGTH = 14;
export const HINT_SPACING = 0.75;
/** A route point counts as reached within this distance (m). */
const REACH = 1.8;

export interface Footprint {
  x: number;
  z: number;
  /** Heading (rad, yaw 0 = +Z). */
  yaw: number;
  /** Alternating feet: −1 left, +1 right. */
  side: -1 | 1;
}

export class HintTracker {
  /** Route split into legs at each pickup: leg k leads to the k-th item (the last leg goes back to your desk). */
  private readonly legs: number[][] = [];
  private best = -1;
  private leg = -1;
  private stalled = 0;

  constructor(private readonly route: readonly RoutePoint[] | null) {
    if (!route || route.length < 2) return;
    let cur: number[] = [];
    route.forEach((p, i) => {
      cur.push(i);
      if (p.interact) {
        this.legs.push(cur);
        cur = [i];
      }
    });
    this.legs.push(cur);
  }

  /** Seconds without progress (for tests and the debug panel). */
  get stalledSeconds(): number {
    return this.stalled / 60;
  }

  /** Advance one sim tick. Returns whether hints should show now. */
  tick(s: SimState): boolean {
    if (this.legs.length === 0 || s.phase !== 'playing') return false;
    const leg = Math.min(s.collected.length, this.legs.length - 1);
    if (leg !== this.leg) {
      // A new leg (picked something up): that is progress.
      this.leg = leg;
      this.best = -1;
      this.stalled = 0;
    }
    const st = s.student;
    if (st.hidden >= 0 || st.escort > 0 || st.buying > 0) return this.stalled >= HINT_AFTER_SECONDS * 60;
    const pts = this.legs[leg]!;
    let furthest = this.best;
    for (let k = Math.max(0, this.best); k < pts.length; k++) {
      const p = this.route![pts[k]!]!;
      if ((p.x - st.x) * (p.x - st.x) + (p.z - st.z) * (p.z - st.z) < REACH * REACH) furthest = k;
    }
    if (furthest > this.best) {
      this.best = furthest;
      this.stalled = 0;
    } else this.stalled++;
    return this.stalled >= HINT_AFTER_SECONDS * 60;
  }

  /**
   * Footprints for the next stretch: from the route point of this leg nearest you (not behind your progress),
   * HINT_LENGTH metres along the route, one print every HINT_SPACING m.
   */
  footprints(s: SimState): Footprint[] {
    if (this.legs.length === 0) return [];
    const pts = this.legs[Math.min(s.collected.length, this.legs.length - 1)]!;
    const st = s.student;
    let start = Math.max(0, this.best);
    let bd = Infinity;
    for (let k = Math.max(0, this.best); k < pts.length; k++) {
      const p = this.route![pts[k]!]!;
      const d = (p.x - st.x) * (p.x - st.x) + (p.z - st.z) * (p.z - st.z);
      if (d < bd) {
        bd = d;
        start = k;
      }
    }
    const out: Footprint[] = [];
    let walked = 0;
    let carry = 0;
    let side: -1 | 1 = 1;
    for (let k = start; k + 1 < pts.length && walked < HINT_LENGTH; k++) {
      const a = this.route![pts[k]!]!;
      const b = this.route![pts[k + 1]!]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-6) continue; // a wait on the route
      const yaw = Math.atan2(dx, dz);
      let t = carry;
      while (t < len && walked + (t - carry) < HINT_LENGTH) {
        out.push({ x: a.x + (dx / len) * t, z: a.z + (dz / len) * t, yaw, side });
        side = side === 1 ? -1 : 1;
        t += HINT_SPACING;
      }
      walked += len;
      carry = t - len;
    }
    return out;
  }
}

/** Whether hints are on for this run: 'auto' means FRESHMAN only (GDD §11). */
export function hintsOn(setting: 'auto' | 'on' | 'off', difficulty: string): boolean {
  return setting === 'on' || (setting === 'auto' && difficulty === 'freshman');
}
