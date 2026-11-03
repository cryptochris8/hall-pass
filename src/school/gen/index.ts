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
import { BELL_SECONDS, MISSION_ROOM, TIERS } from '../tiers';
import type { Difficulty, FineGrid, MissionId, PaEvent, PaEventId, Room, SchoolPlan, StaffSpawn, TierId } from '../types';
import { validatePlan } from '../validate';
import { buildFine, floodOpen } from './fine';
import { furnish, type Furnished } from './furnish';
import { buildSpine, growBranches, newLayout, placeRooms, type Layout } from './layout';
import { schoolName } from './names';
import { placeSnacks } from './snacks';
import { placeStaff } from './staff';

export interface GenConfig {
  seed: number;
  tier: TierId;
  mission: MissionId;
  /** Validate for this difficulty (staff speed and clearance differ). Default 'junior'. */
  difficulty?: Difficulty;
  /** Run the fairness validator (default true). Layout-only tests turn it off. */
  validate?: boolean;
  /**
   * SCHOOL WEEK: one building for every mission (GDD §1). The layout then depends on (seed, tier) only — every
   * mission's room is placed, and a layout attempt only counts if it works for all six missions — so each day of
   * the week is the same school with a different job (and different staff).
   */
  week?: readonly WeekDaySpec[];
}

/** One day of a SCHOOL WEEK schedule (src/game/modes.ts weekPlan). */
export interface WeekDaySpec {
  mission: MissionId;
  difficulty: Difficulty;
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
const SYS_SNACK = 0x5c4007;

export function generateSchool(config: GenConfig): SchoolPlan {
  if (config.week) {
    const plans = generateWeek(config.seed, config.tier, config.week, config.validate);
    const i = config.week.findIndex((d) => d.mission === config.mission && d.difficulty === (config.difficulty ?? 'junior'));
    return plans[Math.max(0, i)]!;
  }
  const budget = { left: VALIDATION_BUDGET };
  let unvalidated: SchoolPlan | null = null;
  let triedTighter = false;
  for (let attempt = 0; attempt < MAX_TRIES && budget.left > 0; attempt++) {
    const plan = tryGenerate(config, attempt, budget);
    if (plan && plan.referenceRoute) return plan;
    if (plan && config.validate === false) return plan;
    if (plan && !unvalidated) unvalidated = plan;
    // After a few failed checks, try the first school at the next tighter clearance before re-rolling further: one
    // check instead of up to a dozen more (FRESHMAN's wide margins fail most; its staff stay slower anyway).
    if (!triedTighter && unvalidated && VALIDATION_BUDGET - budget.left >= EARLY_TIGHTER) {
      triedTighter = true;
      const ok = acceptTighter(unvalidated, config);
      if (ok) return ok;
    }
  }
  const fb = FALLBACK_SEEDS[config.tier];
  const fbBudget = { left: VALIDATION_BUDGET };
  for (let attempt = 0; attempt < MAX_TRIES && fbBudget.left > 0; attempt++) {
    const plan = tryGenerate({ ...config, seed: fb }, attempt, fbBudget);
    if (plan && (plan.referenceRoute || config.validate === false)) return { ...plan, ...namesFor(config), seed: config.seed, fallback: true };
  }
  // Nothing validated: ship the first layout (reachability-checked), flagged, with no route.
  if (unvalidated) return (!triedTighter && acceptTighter(unvalidated, config)) || { ...unvalidated, fallback: true };
  throw new Error(`generateSchool: tier ${config.tier} fallback seed failed`);
}

/** Failed checks before trying the first school at the next tighter clearance. */
const EARLY_TIGHTER = 3;

/**
 * Accept a plan that failed at its difficulty's clearance if it validates at the next tighter one (FRESHMAN demands
 * the widest margins, so its hardest schools can fail where JUNIOR's pass). Returns the plan with its route, or null.
 */
function acceptTighter(plan: SchoolPlan, config: GenConfig): SchoolPlan | null {
  const d = config.difficulty ?? 'junior';
  const tighter = d === 'freshman' ? 'junior' : d === 'junior' ? 'senior' : null;
  if (!tighter) return null;
  const v = validatePlan(plan, d, { clearance: tighter });
  if (!v.ok) return null;
  plan.referenceRoute = v.route;
  plan.snacks = placeSnacks(plan, floodOpen(plan.fine, plan.anchors.start!.x, plan.anchors.start!.z), new Rng(hashInts(config.seed, 0, SYS_SNACK)));
  return plan;
}

/** The school's name depends on the seed alone (not the attempt), so a SCHOOL WEEK keeps one name all week. */
function namesFor(config: GenConfig): { name: string; motto: string } {
  return schoolName(config.tier, new Rng(hashInts(config.seed, 0, SYS_NAME)));
}

interface LayoutStep {
  l: Layout;
  fine: FineGrid;
  rooms: Room[];
  f: Furnished;
  reach: Uint8Array;
  reachable: (x: number, z: number) => boolean;
}

/** Steps 1–5 of one attempt: layout, fine grid, furnishing, reachability. Null when a step failed. */
function layoutStep(config: GenConfig, attempt: number): LayoutStep | null {
  const tier = TIERS[config.tier];
  const sub = (sys: number): Rng => new Rng(hashInts(config.seed, attempt, sys));
  const rngL = sub(SYS_LAYOUT);

  const l = newLayout(tier.cols, tier.rows);
  buildSpine(l, rngL.pick(tier.spines), rngL);
  growBranches(l, rngL.int(tier.corridorCells[0], tier.corridorCells[1]), rngL);
  if (!placeRooms(l, tier, config.week ? 'week' : config.mission, rngL)) return fail('rooms');
  // Week layouts place every mission room untagged; today's mission room gets its tag here.
  if (config.week) {
    const kind = MISSION_ROOM[config.mission];
    const room = kind ? l.rooms.find((r) => r.kind === kind) : undefined;
    if (room) room.tags = [...room.tags, 'mission'];
  }

  const { fine, doors } = buildFine(l, sub(SYS_FINE));
  const rooms: Room[] = l.rooms.map((r) => ({ id: r.id, kind: r.kind, rect: r.rect, doors: doors[r.id]!, tags: r.tags }));
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
  return { l, fine, rooms, f, reach, reachable };
}

/**
 * One layout attempt. Returns the validated plan, an unvalidated plan (validation off, or every staff re-roll
 * failed — `referenceRoute` null), or null when a layout step failed.
 */
function tryGenerate(config: GenConfig, attempt: number, budget: { left: number }, staffTries = STAFF_TRIES): SchoolPlan | null {
  const step = layoutStep(config, attempt);
  if (!step) return null;
  const { l, fine, rooms, f, reach, reachable } = step;
  const tier = TIERS[config.tier];
  const sub = (sys: number): Rng => new Rng(hashInts(config.seed, attempt, sys));
  const bellTicks = BELL_SECONDS[config.mission] * 60;
  const names = namesFor(config);
  let first: SchoolPlan | null = null;
  for (let s = 0; s < staffTries; s++) {
    const salt = s * 7919;
    const staff = placeStaff(l, fine, rooms, tier, config.mission, f.anchors, bellTicks, sub(SYS_STAFF + salt));
    if (!staff) {
      // A week can't re-roll its building for one day's staff: try the next staff roll instead.
      if (config.week) continue;
      return fail('staff:mission');
    }
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
      rerolls: attempt * staffTries + s,
      fallback: false,
      referenceRoute: null,
    };
    plan.snacks = placeSnacks(plan, reach, sub(SYS_SNACK));
    if (config.validate === false) return plan;
    first ??= plan;
    if (budget.left <= 0) break;
    budget.left--;
    const v = validatePlan(plan, config.difficulty ?? 'junior');
    if (v.ok) {
      plan.referenceRoute = v.route;
      plan.snacks = placeSnacks(plan, reach, sub(SYS_SNACK));
      return plan;
    }
    fail(`validate:${v.reason}`);
  }
  return first;
}

/** Every mission a week layout has to support (the five everyday ones and the finale). */
const WEEK_MISSIONS: readonly MissionId[] = ['phone', 'vending', 'pizza', 'locker', 'gym', 'principal'];
/** Staff rolls per day for a week school (it can't re-roll its building, so it tries harder on the staff). */
const WEEK_STAFF_TRIES = 10;

/** Layout attempts that work for every mission (pure function of seed + tier), in order. */
function weekAttempts(seed: number, tier: TierId, limit: number): number[] {
  const out: number[] = [];
  for (let attempt = 0; attempt < MAX_TRIES && out.length < limit; attempt++) {
    if (WEEK_MISSIONS.every((mission) => layoutStep({ seed, tier, mission, week: [] }, attempt) !== null)) out.push(attempt);
  }
  return out;
}

/** Week buildings tried before settling for the best one. */
const WEEK_CANDIDATES = 6;

/**
 * SCHOOL WEEK: all five days at once, in one building (GDD §1). Candidate buildings (layout attempts that work for
 * every mission) are tried in order; the first where every day validates — at that day's difficulty — wins. If none
 * does within WEEK_CANDIDATES, the one with the most validated days is used, and its other days accept the next
 * tighter clearance or ship flagged without a route. Pure and deterministic: (seed, tier, days) → the same week.
 */
export function generateWeek(seed: number, tier: TierId, days: readonly WeekDaySpec[], validate = true): SchoolPlan[] {
  let s0 = seed;
  let cands = weekAttempts(seed, tier, WEEK_CANDIDATES);
  let fellBack = false;
  if (cands.length === 0) {
    // No layout of this seed fits all six missions: the tier's fallback seed (the same every day, too).
    s0 = FALLBACK_SEEDS[tier];
    cands = weekAttempts(s0, tier, WEEK_CANDIDATES);
    fellBack = true;
    if (cands.length === 0) throw new Error(`generateWeek: tier ${tier} has no week layout`);
  }
  const names = namesFor({ seed, tier, mission: 'phone' });
  const build = (attempt: number, d: WeekDaySpec): SchoolPlan | null =>
    tryGenerate({ seed: s0, tier, mission: d.mission, difficulty: d.difficulty, week: days, validate }, attempt, { left: WEEK_STAFF_TRIES }, WEEK_STAFF_TRIES);
  const finish = (p: SchoolPlan): SchoolPlan => ({ ...p, ...names, seed, fallback: fellBack || p.fallback });
  let best: { attempt: number; plans: SchoolPlan[] } | null = null;
  for (const attempt of cands) {
    const plans: SchoolPlan[] = [];
    for (const d of days) {
      const p = build(attempt, d);
      if (!p) break;
      plans.push(p);
      if (validate && !p.referenceRoute) break; // this building fails a day: try the next one
    }
    const done = plans.length === days.length && (!validate || plans.every((p) => p.referenceRoute));
    if (done) return plans.map(finish);
    if (!best || plans.filter((p) => p.referenceRoute).length > best.plans.filter((p) => p.referenceRoute).length) best = { attempt, plans };
  }
  // Settle: the best building, every day built; days without a route try the tighter clearance.
  const attempt = best ? best.attempt : cands[0]!;
  return days.map((d) => {
    const p = build(attempt, d);
    if (!p) throw new Error('generateWeek: week layout failed on a later step');
    const out = finish(p);
    if (out.referenceRoute) return out;
    const tighter = d.difficulty === 'freshman' ? 'junior' : d.difficulty === 'junior' ? 'senior' : null;
    if (tighter) {
      const v = validatePlan(out, d.difficulty, { clearance: tighter });
      if (v.ok) {
        out.referenceRoute = v.route;
        out.snacks = placeSnacks(out, floodOpen(out.fine, out.anchors.start!.x, out.anchors.start!.z), new Rng(hashInts(s0, attempt, SYS_SNACK)));
        return out;
      }
    }
    return { ...out, fallback: true };
  });
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
