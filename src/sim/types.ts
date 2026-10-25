// ─────────────────────────────────────────────────────────────────────────────
// SIM CONTRACT — the pure, fixed-timestep run simulation (docs/ARCHITECTURE.md
// §2–3). No three.js, no DOM, no Math.random / Date / transcendental Math.*.
// Same SchoolPlan + RunConfig + TickInput sequence → identical states, on every
// device and in Node. Everything else (world, people, audio, UI) only READS
// SimState and reacts to SimEvents.
// FROZEN shared contract (owner: sim).
// ─────────────────────────────────────────────────────────────────────────────
import type { AnchorId, Archetype, Difficulty, MissionId, PaEventId, SchoolPlan, TierId } from '../school/types';

/** Bump whenever a change alters run outcomes (recordings and challenge codes carry it). */
export const SIM_VERSION = 3;
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

/**
 * What a staff member is doing (docs/GDD.md §4–5; Trash Panda's enemy state machine, rewritten for this sim):
 *   route       — following the generated route (patrol, doorway, sweep, wander)
 *   errand      — sent somewhere by a PA announcement; waits there, then returns
 *   investigate — walks to a noise / report / camera alert, looks around, returns
 *   notice      — saw something: stops and stares (the warning beat before a chase)
 *   chase       — after you; catches you on contact; gives up or loses you → search
 *   search      — looks around the last place it saw you, then returns
 *   report      — Preston running to the nearest adult to tell on you
 *   return      — walking back to its route
 */
export type StaffMode = 'route' | 'errand' | 'investigate' | 'notice' | 'chase' | 'search' | 'report' | 'return';

export type NoiseSource = 'step' | 'sprint' | 'throw' | 'hide' | 'pickup' | 'vending';

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
  /** Index into plan.furniture of the hide spot you're in, or −1. */
  hidden: number;
  /** Ticks since entering the current hide spot. */
  hideT: number;
  /** Throwables carried (0–3). */
  carry: number;
  /** VENDING RUN: ticks left of the (loud) purchase; 0 = not buying. Input other than a cancel is ignored. */
  buying: number;
  /** Ticks the student can't move (shooed away from the PIZZA DAY counter). */
  frozen: number;
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
  mode: StaffMode;
  /** Ticks in the current mode. */
  modeT: number;
  /** Goal of the current move (investigate / errand / search / report / return). */
  tx: number;
  tz: number;
  /** Current path [x0, z0, x1, z1, …] and the next waypoint index (in pairs); empty = steer straight. */
  path: number[];
  pathI: number;
  /** Ticks until the chase path is re-planned. */
  replan: number;
  /** Last place it saw (or was told) the student was. */
  lastX: number;
  lastZ: number;
  /** Chase: ticks chasing, ticks since last sight. */
  chaseT: number;
  lostT: number;
  /** Errand / look-around: ticks left waiting at the target (−1 = still walking there). */
  wait: number;
  /** Saw you climb into this hide spot (furniture index), or −1: it will check there. */
  sawHide: number;
  /** Report target (staff index) for the snitch, or −1. */
  reportTo: number;
  /** Errand: ticks to wait once there. */
  errandTicks: number;
  /** Times this staff member has spotted you (PRINCIPAL'S OFFICE: Hargrove walks faster each time). */
  heat: number;
}

export interface Thrown {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** Ticks until it lands. */
  t: number;
}

/** Counters the Hall Report reads (score lines and remarks). Never read by the sim's own rules. */
export interface RunStats {
  /** Ticks spent hidden, and the longest single stay (with the hide-spot kind). */
  hiddenTicks: number;
  longestHide: number;
  longestHideKind: string;
  cameraAlerts: number;
  throws: number;
  /** Throws whose landing pulled someone who was onto you (or near you) off to investigate. */
  distractions: number;
  sprintTicks: number;
  shoos: number;
  buysCancelled: number;
  /** PIZZA DAY: true = first in line, false = got there too late, null = not a pizza run / not yet. */
  firstInLine: boolean | null;
  /** Snacks picked up. */
  snacks: number;
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
  /** Validator mode: no student at all (staff only follow routes and PA errands). */
  readonly absent: boolean;
  /** Buttons held last tick (edge detection for throw / interact). */
  prevButtons: number;
  /** Throwable sources already emptied (1 per plan.furniture index). */
  usedThrowables: Uint8Array;
  thrown: Thrown[];
  /** Next plan.pa index. */
  paNext: number;
  /** Times a chase ended with you getting away. */
  escapes: number;
  /** Snack packs collected (1 per plan.snacks index). */
  snacksTaken: Uint8Array;
  stats: RunStats;
}

export type SimEvent =
  | { t: 'suspicion'; staff: number; level: SuspicionLevel }
  | { t: 'caught'; staff: number; passUsed: boolean }
  | { t: 'escortDone'; checkpoint: AnchorId }
  | { t: 'checkpoint'; at: AnchorId }
  | { t: 'pickup'; anchor: AnchorId }
  | { t: 'closeCall'; staff: number }
  | { t: 'bell'; secondsLeft: 30 | 10 | 0 }
  | { t: 'noise'; x: number; z: number; radius: number; source: NoiseSource }
  | { t: 'heard'; staff: number }
  | { t: 'chase'; staff: number; on: boolean; escaped: boolean }
  | { t: 'hide'; spot: number; enter: boolean }
  | { t: 'throw'; fromX: number; fromZ: number; toX: number; toZ: number; ticks: number }
  | { t: 'grabThrowable'; carry: number }
  | { t: 'report'; staff: number; to: number }
  | { t: 'cameraAlert'; camera: number; to: number }
  | { t: 'pa'; id: PaEventId }
  | { t: 'found'; staff: number }
  | { t: 'snack'; index: number }
  | { t: 'buy'; on: boolean; done: boolean }
  | { t: 'lunchBell' }
  | { t: 'shoo' }
  | { t: 'end'; phase: Exclude<RunPhase, 'playing'> };
