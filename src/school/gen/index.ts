// ─────────────────────────────────────────────────────────────────────────────
// School generator entry point (docs/GDD.md §3, docs/ARCHITECTURE.md §4).
// generateSchool(config) → SchoolPlan. Pure and deterministic: the same
// (seed, tier, mission) always gives the same plan, re-rolls included.
// Steps: spine → branches → rooms (+ mission distance) → fine grid → furnishing →
// staff + PA → checks → step 8, the fairness validator (school/validate.ts): a
// school only ships when an unseen, unheard route fits the bell budget. A failed
// validation re-rolls the staff and PA (up to STAFF_TRIES), a failed layout step
// re-rolls the layout; total validations are capped (VALIDATION_BUDGET), then the
// tier's fallback seed is used.
// ─────────────────────────────────────────────────────────────────────────────
import { Rng, hashInts } from '../../core/rng';
import { BELL_SECONDS, TIERS } from '../tiers';
import type { Difficulty, MissionId, PaEvent, PaEventId, Room, SchoolPlan, StaffSpawn, TierId } from '../types';
import { validatePlan } from '../validate';
import { buildFine, floodOpen } from './fine';
import { furnish } from './furnish';
import { buildSpine, growBranches, newLayout, placeRooms } from './layout';
import { schoolName } from './names';
import { placeStaff } from './staff';

export interface GenConfig {
  seed: number;
  tier: TierId;
  mission: MissionId;
  /** Validate for this difficulty (staff speed and clearance differ). Default 'junior'. */
  difficulty?: Difficulty;
  /** Run the fairness validator (default true). Layout-only tests turn it off. */
  validate?: boolean;
}

const MAX_TRIES = 32;
const STAFF_TRIES = 4;
const VALIDATION_BUDGET = 8;

/** Why attempts failed (diagnostics only: tools/plan.mjs and tests read it; never affects a plan). */
export const GEN_FAILS: Record<string, number> = {};
const fail = (why: string): null => {
  GEN_FAILS[why] = (GEN_FAILS[why] ?? 0) + 1;
  return null;
};
/** Known-good seeds per tier, used when a seed fails MAX_TRIES times (checked by tests/school/gen.test.ts). */
export const FALLBACK_SEEDS: Readonly<Record<TierId, number>> = { 1: 101, 2: 202, 3: 303, 4: 404, 5: 505 };

const SYS_LAYOUT = 0x5c4001;
const SYS_FINE = 0x5c4002;
const SYS_FURNISH = 0x5c4003;
const SYS_STAFF = 0x5c4004;
const SYS_NAME = 0x5c4005;
const SYS_PA = 0x5c4006;

export function generateSchool(config: GenConfig): SchoolPlan {
  const budget = { left: VALIDATION_BUDGET };
  let unvalidated: SchoolPlan | null = null;
  for (let attempt = 0; attempt < MAX_TRIES && budget.left > 0; attempt++) {
    const plan = tryGenerate(config, attempt, budget);
    if (plan && plan.referenceRoute) return plan;
    if (plan && config.validate === false) return plan;
    if (plan && !unvalidated) unvalidated = plan;
  }
  const fb = FALLBACK_SEEDS[config.tier];
  const fbBudget = { left: VALIDATION_BUDGET };
  for (let attempt = 0; attempt < MAX_TRIES && fbBudget.left > 0; attempt++) {
    const plan = tryGenerate({ ...config, seed: fb }, attempt, fbBudget);
    if (plan && (plan.referenceRoute || config.validate === false)) return { ...plan, seed: config.seed, fallback: true };
  }
  // Nothing validated: ship the first playable layout (still reachability-checked), flagged, with no route.
  if (unvalidated) return { ...unvalidated, fallback: true };
  throw new Error(`generateSchool: tier ${config.tier} fallback seed failed`);
}

/**
 * One layout attempt. Returns the validated plan, an unvalidated plan (validation off, or every staff re-roll
 * failed — `referenceRoute` null), or null when a layout step failed.
 */
function tryGenerate(config: GenConfig, attempt: number, budget: { left: number }): SchoolPlan | null {
  const tier = TIERS[config.tier];
  const sub = (sys: number): Rng => new Rng(hashInts(config.seed, attempt, sys));
  const rngL = sub(SYS_LAYOUT);

  const l = newLayout(tier.cols, tier.rows);
  buildSpine(l, rngL.pick(tier.spines), rngL);
  growBranches(l, rngL.int(tier.corridorCells[0], tier.corridorCells[1]), rngL);
  if (!placeRooms(l, tier, config.mission, rngL)) return fail('rooms');

  const { fine, doors } = buildFine(l, sub(SYS_FINE));
  const rooms: Room[] = l.rooms.map((r) => ({ id: r.id, kind: r.kind, rect: r.rect, doors: doors[r.id]!, tags: r.tags }));
  const bellTicks = BELL_SECONDS[config.mission] * 60;
  const f = furnish(l, rooms, fine, tier, config.mission, sub(SYS_FURNISH));
  if (!f) return fail('furnish');
  const start = f.anchors.start!;

  // Every door and goal must be reachable from your desk.
  const reach = floodOpen(fine, start.x, start.z);
  const reachable = (x: number, z: number): boolean => {
    const c = Math.floor(x / 0.5);
    const r = Math.floor(z / 0.5);
    return c >= 0 && r >= 0 && c < fine.cols && r < fine.rows && reach[r * fine.cols + c] === 1;
  };
  for (const room of rooms) {
    for (const d of room.doors) {
      // Sample just either side of the door line.
      const ox = d.axis === 'x' ? 0.75 : 0;
      const oz = d.axis === 'z' ? 0.75 : 0;
      if (!reachable(d.x - ox, d.z - oz) || !reachable(d.x + ox, d.z + oz)) return fail(`door:${room.kind}`);
    }
  }
  for (const [id, a] of Object.entries(f.anchors)) if (a && !reachable(a.x, a.z)) return fail(`anchor:${id}`);

  const names = schoolName(config.tier, sub(SYS_NAME));
  let first: SchoolPlan | null = null;
  for (let s = 0; s < STAFF_TRIES; s++) {
    const salt = s * 7919;
    const staff = placeStaff(l, rooms, tier, f.anchors, bellTicks, sub(SYS_STAFF + salt));
    if (staff.some((sp) => sp.archetype !== 'sweeper' && sp.route.some((w) => !reachable(w.x, w.z)))) {
      fail('staff:unreachable');
      continue;
    }
    const plan: SchoolPlan = {
      seed: config.seed,
      tier: config.tier,
      mission: config.mission,
      name: names.name,
      motto: names.motto,
      grid: { cols: l.cols, rows: l.rows },
      cells: l.cells,
      fine,
      rooms,
      furniture: f.furniture,
      zones: f.zones,
      anchors: f.anchors,
      staff,
      extras: [],
      snacks: [],
      throwables: [],
      pa: schedulePa(config.tier, staff, rooms, bellTicks, sub(SYS_PA + salt)),
      bellTicks,
      rerolls: attempt * STAFF_TRIES + s,
      fallback: false,
      referenceRoute: null,
    };
    if (config.validate === false) return plan;
    first ??= plan;
    if (budget.left <= 0) break;
    budget.left--;
    const v = validatePlan(plan, config.difficulty ?? 'junior');
    if (v.ok) {
      plan.referenceRoute = v.route;
      return plan;
    }
    fail(`validate:${v.reason}`);
  }
  return first;
}

/** FNV-1a over the plan's gameplay-relevant content (determinism tests, challenge-code checks). */
export function planHash(plan: SchoolPlan): number {
  let h = 0x811c9dc5;
  const mix = (n: number): void => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
  };
  for (let i = 0; i < plan.fine.flags.length; i++) mix(plan.fine.flags[i]!);
  for (const s of plan.staff) for (const w of s.route) {
    mix(Math.round(w.x * 100));
    mix(Math.round(w.z * 100));
    mix(w.dwell);
  }
  for (const a of Object.values(plan.anchors)) if (a) {
    mix(Math.round(a.x * 100));
    mix(Math.round(a.z * 100));
  }
  return h >>> 0;
}


/**
 * Step 7 (GDD §6.6): 1–3 PA announcements between 20 % and 70 % of the bell, at least 25 s apart, only ones that
 * have someone to send (the VP needs an office, the custodian a gym or cafeteria). "Hats off" can always play.
 */
export function schedulePa(tier: TierId, staff: readonly StaffSpawn[], rooms: readonly Room[], bellTicks: number, rng: Rng): PaEvent[] {
  const has = (a: StaffSpawn['archetype']): boolean => staff.some((s) => s.archetype === a);
  const room = (k: Room['kind']): boolean => rooms.some((r) => r.kind === k);
  const pool: PaEventId[] = ['hatsOff'];
  if (has('investigator') && room('office')) pool.push('vpToOffice');
  if (has('wanderer') && (room('gym') || room('cafeteria'))) pool.push('custodialToGym');
  if (has('patroller')) pool.push('carLights');
  const count = Math.min(pool.length, tier === 1 ? 1 : rng.int(1, 3));
  const ids = pool.slice();
  const out: PaEvent[] = [];
  for (let k = 0; k < count; k++) {
    const id = ids.splice(rng.int(0, ids.length - 1), 1)[0]!;
    let tick = 0;
    for (let tries = 0; tries < 20; tries++) {
      tick = rng.int(Math.floor(bellTicks * 0.2), Math.floor(bellTicks * 0.7));
      if (out.every((e) => Math.abs(e.tick - tick) >= 25 * 60)) break;
    }
    out.push({ tick, id });
  }
  return out.sort((a, b) => a.tick - b.tick);
}
