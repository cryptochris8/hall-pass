// ─────────────────────────────────────────────────────────────────────────────
// Autopilot (docs/GDD.md §12, docs/ARCHITECTURE.md §13). Plays the sim through
// TickInput like a player. With a validated plan it follows the reference route
// on schedule — walking where the route walks, sneaking where it sneaks, pressing
// interact at the pickups — which the validator guarantees is never seen or
// heard. Skill below 1 adds deterministic timing slips (it falls behind schedule
// and cuts corners), which is how the balance tests get realistic failure rates.
// Off the route (no route, or after being busted) it walks a path to the next
// goal, sneaking when staff are near. Used for tests, balance, the attract mode.
// Pure; deterministic per (plan, skill, seed).
// ─────────────────────────────────────────────────────────────────────────────
import { Rng } from '../core/rng';
import type { RoutePoint, SchoolPlan } from '../school/types';
import { missionGoals } from './index';
import { findPath } from './nav';
import { BTN_INTERACT, BTN_SNEAK, type SimState, type TickInput } from './types';

export interface BotOptions {
  /** 0..1: 1 = follows the reference route exactly. */
  skill?: number;
  seed?: number;
}

export interface Bot {
  decide(state: SimState): TickInput;
  /** What it's doing (debug, tests). */
  readonly mode: 'route' | 'path' | 'idle';
}

export function createBot(plan: SchoolPlan, opts: BotOptions = {}): Bot {
  const skill = Math.max(0, Math.min(1, opts.skill ?? 1));
  const rng = new Rng((opts.seed ?? 1) >>> 0);
  const route: readonly RoutePoint[] = plan.referenceRoute ?? [];
  let mode: Bot['mode'] = route.length > 1 ? 'route' : 'path';
  let seg = 0;
  /** Ticks the bot is running late (skill slips accumulate). */
  let delay = 0;
  let slipCd = 0;
  let path: number[] = [];
  let pathI = 0;
  let pathFor = '';
  let lastCatches = 0;
  const out: TickInput = { moveX: 0, moveY: 0, buttons: 0 };

  const steer = (dx: number, dz: number, mag: number, buttons: number): TickInput => {
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < 1e-6 || mag <= 0) {
      out.moveX = 0;
      out.moveY = 0;
    } else {
      // Fixed camera: worldX = moveX, worldZ = −moveY.
      out.moveX = Math.round((dx / d) * mag * 127);
      out.moveY = Math.round((-dz / d) * mag * 127);
    }
    out.buttons = buttons;
    return out;
  };

  return {
    get mode() {
      return mode;
    },
    decide(state) {
      const s = state.student;
      out.buttons = 0;
      if (state.phase !== 'playing' || s.escort > 0) return steer(0, 0, 0, 0);
      if (state.catches !== lastCatches) {
        // Busted: the schedule is gone. Walk the rest.
        lastCatches = state.catches;
        mode = 'path';
      }
      // Press interact (one tick on, one off) when standing at the next goal.
      const next = missionGoals(plan).find((g) => !state.collected.includes(g));
      const a = next ? plan.anchors[next]! : null;
      const atGoal = !!a && (s.x - a.x) * (s.x - a.x) + (s.z - a.z) * (s.z - a.z) < 1.25 * 1.25; // the sim reaches 1.3 m
      const press = atGoal && (state.prevButtons & BTN_INTERACT) === 0 ? BTN_INTERACT : 0;

      if (mode === 'route') {
        // Skill slips: now and then it hesitates for a moment and falls behind schedule.
        if (skill < 1 && --slipCd <= 0) {
          slipCd = rng.int(60, 240);
          if (rng.chance(1 - skill)) delay += rng.int(10, Math.round(30 + 90 * (1 - skill)));
        }
        const t = state.tick - delay;
        while (seg + 1 < route.length && route[seg + 1]!.tick <= t) seg++;
        const p = route[seg]!;
        const q = route[Math.min(seg + 1, route.length - 1)]!;
        const span = q.tick - p.tick;
        const u = span > 0 ? Math.max(0, Math.min(1, (t - p.tick) / span)) : 1;
        const tx = p.x + (q.x - p.x) * u;
        const tz = p.z + (q.z - p.z) * u;
        const dx = tx - s.x;
        const dz = tz - s.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > 3) {
          mode = 'path';
        } else {
          // Sneak along sneak moves — and catch up silently whenever the route got here by sneaking or is waiting
          // here: footsteps are only safe on the route's own walking moves.
          const waiting = p.x === q.x && p.z === q.z;
          const sneak = (q.sneak && span > 0 && u < 1) || ((p.sneak || waiting) && d > 0.06);
          if (sneak) return steer(dx, dz, d > 0.05 ? 1 : 0, BTN_SNEAK | press);
          if (d > 0.35) return steer(dx, dz, 1, press);
          if (d > 0.06) return steer(dx, dz, 0.5, press); // a light tilt: slow and silent
          return steer(0, 0, 0, press);
        }
      }

      // Path mode: head for the next goal (or back to your desk), sneaking when someone is close.
      mode = 'path';
      const target = a ?? plan.anchors.start!;
      const key = `${next ?? 'start'}`;
      if (key !== pathFor || pathI * 2 >= path.length) {
        path = findPath(plan.fine, s.x, s.z, target.x, target.z) ?? [target.x, target.z];
        pathI = 0;
        pathFor = key;
      }
      while (pathI * 2 < path.length) {
        const wx = path[pathI * 2]!;
        const wz = path[pathI * 2 + 1]!;
        if ((wx - s.x) * (wx - s.x) + (wz - s.z) * (wz - s.z) < 0.3 * 0.3) pathI++;
        else break;
      }
      if (pathI * 2 >= path.length) return steer(target.x - s.x, target.z - s.z, 0.5, press);
      const near = state.staff.some((st, k) => plan.staff[k]!.archetype !== 'sweeper' && (st.x - s.x) * (st.x - s.x) + (st.z - s.z) * (st.z - s.z) < 7 * 7);
      return steer(path[pathI * 2]! - s.x, path[pathI * 2 + 1]! - s.z, 1, (near && skill > 0.5 ? BTN_SNEAK : 0) | press);
    },
  };
}
