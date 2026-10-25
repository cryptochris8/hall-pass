// Every gameplay number of the sim (docs/ARCHITECTURE.md §5: nothing else hard-codes one) and the difficulty table
// (docs/GDD.md §9). Owner: sim.
import type { Archetype, Difficulty } from '../school/types';

export const STUDENT = {
  radius: 0.3,
  speed: { sneak: 1.4, walk: 3.0, sprint: 5.2 },
  /** m/s² toward the target velocity. */
  accel: 22,
  /** Analog stick magnitude below this counts as sneaking. */
  sneakTilt: 0.55,
  /** Sprint stamina: seconds of sprint from full, seconds to refill, minimum to start. */
  sprintSeconds: 2.5,
  refillSeconds: 4,
  sprintMin: 0.3,
  /** Turn rate of the body (rad/s). */
  turn: 14,
};

/** Chase speed (m/s) per archetype — the student walks 3.0 and sprints 5.2. */
export const CHASE_SPEED: Readonly<Record<Archetype, number>> = {
  patroller: 3.6,
  sentry: 3.3,
  investigator: 3.9,
  sweeper: 0,
  wanderer: 2.5,
  snitch: 4.2,
  listener: 2.4,
};

export const BRAIN = {
  /** Suspicion that makes a calm staff member stop and stare. */
  notice: 0.5,
  /** Minimum seconds of staring before a chase can start. */
  noticeMin: 0.6,
  /** Staring drops back to investigating below this. */
  loseNotice: 0.3,
  /** Minimum fill rate while seen at all (/s): being seen always registers. */
  minFill: 0.3,
  /** Chase: give up after (s), lose sight after (s), catch radius (m). */
  giveUp: 8,
  lostSight: 2.5,
  catchRadius: 0.85,
  /** Steer straight at you (no path) when this close with line of sight (m). */
  directChase: 6,
  /** Seconds between chase path re-plans. */
  replan: 0.4,
  /** Look around this long at an investigated / searched spot (s). */
  lookAround: 3,
  search: 4,
  /** Walking speed multiplier while investigating / searching / returning. */
  briskMul: 1.3,
  /** Teachers don't chase far from their classroom (m from their route). */
  sentryLeash: 12,
  librarianLeash: 10,
  /** After a camera alert, the camera ignores you for this long (s). */
  cameraCooldown: 6,
  /** Suspicion that a search keeps when it starts (re-acquire quickly). */
  searchKeep: 0.6,
};

export const NOISE = {
  /** Footstep radius (m) by posture. */
  step: { sneak: 0, walk: 2, sprint: 6 },
  /** Multipliers: polished floors (all steps), the gym (sprint), the library (everything). */
  polished: 1.5,
  echoSprint: 2,
  quiet: 2,
  throwLand: 8,
  hideQuiet: 1,
  hideLoud: 5,
  pickup: 1,
  vending: 6,
  /** Hearing range multiplier per archetype (cameras hear nothing). */
  hearing: { patroller: 1, sentry: 1, investigator: 1.5, sweeper: 0, wanderer: 0.8, snitch: 1, listener: 1.5 } as Record<Archetype, number>,
  /** Seconds between visual footstep rings while sprinting. */
  ringEvery: 0.45,
};

export const HIDE = {
  /** Reach (m) from the hide spot's front point. */
  reach: 1.2,
  /** A staff member this close still sees a hidden student (m). */
  seeRadius: 1.0,
  /** Ticks before move input pops you back out. */
  exitDelay: 18,
};

export const THROW = {
  maxCarry: 3,
  reach: 1.3,
  distance: 7,
  flightTicks: 30,
};

export const STAFF_TURN: Readonly<Record<Archetype, number>> = {
  patroller: 4,
  sentry: 2.5,
  investigator: 5,
  sweeper: 3,
  wanderer: 3,
  snitch: 5,
  listener: 2,
};

/** Seconds per full head sweep while dwelling. */
export const SWEEP_PERIOD: Readonly<Record<Archetype, number>> = {
  patroller: 3,
  sentry: 5,
  investigator: 3,
  sweeper: 8,
  wanderer: 4,
  snitch: 3,
  listener: 6,
};

export const DETECT = {
  /** Suspicion per second at the cone centre, mid range, walking, lit, JUNIOR. */
  fill: 0.85,
  /** Proximity multiplier from the eye (×near) to max range (×far). */
  near: 1.8,
  far: 0.55,
  /** Cone centre vs edge multiplier. */
  centre: 1.3,
  edge: 0.75,
  posture: { sneak: 0.5, walk: 1, sprint: 1.6 },
  dim: 0.5,
  /** Standing still in a dim zone halves it again. */
  stillDim: 0.5,
  /** Suspicion lost per second out of sight. */
  decay: 0.3,
  curious: 0.01,
  searching: 0.5,
  /** Bumping into someone (m): instant spotting. */
  contact: 0.7,
  /** Close call: passing within this distance behind staff unseen (m). */
  closeCall: 1.5,
};

export const RULES = {
  /** Interact radius for goals and checkpoints (m). */
  reach: 1.3,
  checkpointRadius: 2.5,
  /** Bell seconds lost when BUSTED (walked back). */
  bustedSeconds: 10,
  /** Seconds a staff member ignores you after you flash the hall pass. */
  passIgnore: 3,
  maxCatches: 3,
};

export interface DifficultyDef {
  fill: number;
  staffSpeed: number;
  passes: number;
  scoreMult: number;
}

export const DIFFICULTY: Readonly<Record<Difficulty, DifficultyDef>> = {
  freshman: { fill: 0.6, staffSpeed: 0.85, passes: 2, scoreMult: 0.8 },
  junior: { fill: 1.0, staffSpeed: 1.0, passes: 1, scoreMult: 1.0 },
  senior: { fill: 1.4, staffSpeed: 1.15, passes: 0, scoreMult: 1.3 },
};
