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
  contact: 0.85,
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
