// ─────────────────────────────────────────────────────────────────────────────
// SIM CONTRACT — the pure, fixed-timestep run simulation (docs/ARCHITECTURE.md
// §2–3). No three.js, no DOM, no Math.random / Date / transcendental Math.*.
// Same SchoolPlan + RunConfig + TickInput sequence → identical states, on every
// device and in Node. Everything else (world, people, audio, UI) only READS
// SimState and reacts to SimEvents.
// FROZEN shared contract (owner: sim).
// ─────────────────────────────────────────────────────────────────────────────
import type { AnchorId, Archetype, Difficulty, MissionId, SchoolPlan, TierId } from '../school/types';

/** Bump whenever a change alters run outcomes (recordings and challenge codes carry it). */
export const SIM_VERSION = 1;
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export interface RunConfig {
  seed: number;
  mission: MissionId;
  tier: TierId;
  difficulty: Difficulty;
  /** yyyymmdd for a DAILY PERIOD, else null. */
  daily: number | null;
}

/** TickInput.buttons bits. */
export const BTN_SNEAK = 1;
export const BTN_SPRINT = 2;
export const BTN_INTERACT = 4;
export const BTN_THROW = 8;

/** One tick of input, quantized so recordings are tiny and replays exact. */
export interface TickInput {
  /** Integer −127..127; +X = screen right. */
  moveX: number;
  /** Integer −127..127; + = up on screen (toward −Z, north). */
  moveY: number;
  buttons: number;
}

export const NO_INPUT: Readonly<TickInput> = Object.freeze({ moveX: 0, moveY: 0, buttons: 0 });

export type Posture = 'sneak' | 'walk' | 'sprint';
export type SuspicionLevel = 'calm' | 'curious' | 'searching' | 'spotted';

export interface StudentState {
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (rad, yaw 0 = +Z). */
  yaw: number;
  posture: Posture;
  /** Sprint stamina 0..1. */
  stamina: number;
  /** Ticks left being walked back to the checkpoint (BUSTED); input ignored meanwhile. */
  escort: number;
}

export interface StaffState {
  archetype: Archetype;
  x: number;
  z: number;
  /** Body yaw. */
  yaw: number;
  /** Where the eyes point (cone direction). */
  look: number;
  /** Route progress. */
  wp: number;
  dir: 1 | -1;
  dwell: number;
  /** Ticks into the current dwell (drives the head sweep). */
  dwellT: number;
  moving: boolean;
  suspicion: number;
  level: SuspicionLevel;
  /** Ticks the staff ignores the student after a hall pass was shown. */
  ignore: number;
  /** Student is inside this staff's cone and visible this tick. */
  seesStudent: boolean;
}

export type RunPhase = 'playing' | 'success' | 'detention' | 'timeout';

export interface SimState {
  readonly plan: SchoolPlan;
  readonly config: RunConfig;
  tick: number;
  /** Ticks left on the bell timer. */
  bell: number;
  phase: RunPhase;
  student: StudentState;
  staff: StaffState[];
  /** Mission items collected, in order (goal, goal2, goal3). */
  collected: AnchorId[];
  checkpoint: AnchorId;
  passes: number;
  catches: number;
  /** Ticks with any staff at 'spotted' (for GHOST) — counted once per spotting. */
  spottings: number;
  closeCalls: number;
}

export type SimEvent =
  | { t: 'suspicion'; staff: number; level: SuspicionLevel }
  | { t: 'caught'; staff: number; passUsed: boolean }
  | { t: 'escortDone'; checkpoint: AnchorId }
  | { t: 'checkpoint'; at: AnchorId }
  | { t: 'pickup'; anchor: AnchorId }
  | { t: 'closeCall'; staff: number }
  | { t: 'bell'; secondsLeft: 30 | 10 | 0 }
  | { t: 'end'; phase: Exclude<RunPhase, 'playing'> };
