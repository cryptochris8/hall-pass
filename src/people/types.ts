// ─────────────────────────────────────────────────────────────────────────────
// PEOPLE CONTRACT — the student, the staff and extra students (docs/GDD.md §2/§4,
// docs/ARCHITECTURE.md §9). Procedural, inked toon characters built in code
// (ported from Bad Hair Day's src/family rig), never downloaded models.
//
// Conventions: metres, Y up. A person's root sits at its feet (y = 0) and faces
// its local +Z; the world sets root.position / root.rotation.y (yaw 0 = +Z).
// Everything is vertex-coloured GeoBuilder geometry with baked ink outlines
// (src/render/models/*) on modelMaterial(). Budget: ≤ 8k triangles per person.
// People are COSMETIC: the sim never reads them. The world drives them from
// SimState every frame (motion, look direction, actions, expressions).
// FROZEN shared contract (owner: people; changes go through the integrator).
// ─────────────────────────────────────────────────────────────────────────────
import type * as THREE from 'three';
import type { Archetype } from '../school/types';

/** Who to build. Staff use their archetype (sweeper = a security camera, not a person: never requested). */
export type PersonRole = 'student' | 'extra' | Exclude<Archetype, 'sweeper'>;

export type HairStyle = 'short' | 'buzz' | 'curly' | 'afro' | 'ponytail' | 'bun' | 'long' | 'bob' | 'braids';

/** Cosmetic look (the student's comes from LOCKER later; staff and extras derive theirs from a seed). */
export interface PersonLook {
  /** Index into SKIN_TONES (0–7). */
  skin: number;
  hairStyle: HairStyle;
  /** Hair colour (hex). */
  hair: number;
  /** Main top colour (hoodie / jacket / polo / blazer…) (hex). */
  top: number;
  /** Trousers / skirt colour (hex). */
  bottom: number;
  /** Shoe colour (hex). */
  shoes: number;
  glasses: boolean;
  /** Student only: backpack colour, or null for none. */
  backpack: number | null;
  /** Student only: headphones around the neck. */
  headphones: boolean;
}

export interface PersonSpec {
  role: PersonRole;
  /** Seeds every look choice not given in `look`, and idle variation. Same seed → same person. */
  seed: number;
  /** Optional overrides (the student's LOCKER choices). */
  look?: Partial<PersonLook>;
}

/** How the person moves this frame (drives the locomotion blend). */
export type Gait = 'sneak' | 'walk' | 'sprint';

/** One-shot gestures; play() returns the duration (s). */
export type PersonAction =
  | 'grab' // quick reach forward-down and back (picking up the phone / chips)
  | 'busted' // freeze, shoulders up, sheepish (the moment you're caught)
  | 'celebrate' // fist pump (success)
  | 'flinch' // startled hop-back (a near miss)
  | 'whistle' // staff: whistle to the mouth, one sharp blow (patroller spotting you)
  | 'point' // staff: point forward ("HEY!")
  | 'checkWatch' // staff: glance at the wrist (patroller dwell)
  | 'lookAround' // turn head left-right (searching)
  | 'shrug'
  | 'wave';

export type PersonExpression = 'neutral' | 'smug' | 'nervous' | 'panicked' | 'relieved' | 'surprised' | 'stern' | 'suspicious' | 'happy';

export interface Person {
  readonly role: PersonRole;
  readonly look: PersonLook;
  /** Place/rotate this. Faces local +Z; feet at y = 0. */
  readonly root: THREE.Group;
  /** Standing height to the top of the head (m). */
  readonly height: number;
  /**
   * Horizontal speed (m/s) and gait → idle / sneak (crouched creep) / walk / run blend. Stride advances with
   * distance travelled so feet don't skate. Speed 0 = idle (breathing, weight shifts).
   */
  setMotion(speed: number, gait: Gait): void;
  /** Head yaw relative to the body (rad, + = toward the person's left/+X when facing +Z), clamped to ±1.3. */
  setLook(yaw: number): void;
  play(action: PersonAction): number;
  setExpression(e: PersonExpression, seconds?: number): void;
  /** Advance animation (dt = 0 while paused). */
  update(dt: number): void;
  dispose(): void;
}

/*
 * src/people/index.ts exports:
 *   export function createPerson(spec: PersonSpec): Person;
 *   export function lookFor(spec: PersonSpec): PersonLook;   // pure: the look createPerson would use
 */
