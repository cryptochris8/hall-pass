// People module entry (contract: src/people/types.ts). Procedural inked toon people — the student, the staff and
// extra students — ported from Bad Hair Day's family rig (src/people/rig.ts and friends).
import { deriveLook } from './looks';
import { PersonRig } from './rig';
import type { Person, PersonLook, PersonSpec } from './types';

export * from './types';
export { CART } from './props';
export { SKIN_TONES } from './palette';

/** The look createPerson(spec) would use (pure: same spec → same look; `spec.look` overrides win). */
export function lookFor(spec: PersonSpec): PersonLook {
  return deriveLook(spec);
}

/** Build a person (same seed + role → same person). Call update(dt) every frame; dispose() when done. */
export function createPerson(spec: PersonSpec): Person {
  return new PersonRig(spec);
}
