// Helpers for placing furniture models at SchoolPlan.furniture items (used by the world and dev/props.ts).
// SchoolPlan footprints are WORLD-axis (w along X, d along Z); models are built in the item's LOCAL frame
// (localW across the front, localD front-to-back). An item facing ±X (yaw ±π/2) swaps the two.
import * as THREE from 'three';
import type { Furniture } from '../../school/types';
import type { PropVariant } from './types';

/**
 * Embedded pieces (lockers, corridor vending machines, trophy cases) are stamped INSIDE the corridor's solid locker
 * strip, flush with its face. Push them this far out along their face direction so their fronts stand proud of the
 * wall box (lockers: frame 14 cm proud, door 2 cm; see LOCKER_RECESS in furniture.ts).
 */
export const EMBED_PROUD = 0.14;

/** Local footprint (localW across the front, localD front-to-back) of a plan item. */
export function furnitureFootprint(f: Pick<Furniture, 'w' | 'd' | 'face'>): { localW: number; localD: number } {
  const sideways = Math.abs(Math.sin(f.face)) > 0.5;
  return sideways ? { localW: f.d, localD: f.w } : { localW: f.w, localD: f.d };
}

/** Model variant from the generator's tags. */
export function variantOf(f: Pick<Furniture, 'tags'>): PropVariant {
  if (f.tags.includes('goal')) return 'goal';
  if (f.tags.includes('hide')) return 'hide';
  return 'plain';
}

/** Lockers, vending machines and trophy cases set into the corridor's locker mass (not the cafeteria counter). */
export function isEmbeddedFurniture(f: Pick<Furniture, 'kind' | 'w' | 'd'>): boolean {
  if (f.kind === 'locker' || f.kind === 'trophyCase') return true;
  return f.kind === 'vending' && Math.min(f.w, f.d) <= 0.5 && Math.max(f.w, f.d) <= 1.8;
}

/** Instance matrix for a plan item (yaw = face, embedded pieces pushed EMBED_PROUD out of the wall). */
export function furnitureMatrix(f: Furniture, out: THREE.Matrix4, heightScale = 1): THREE.Matrix4 {
  let x = f.x;
  let z = f.z;
  if (isEmbeddedFurniture(f)) {
    x += Math.sin(f.face) * EMBED_PROUD;
    z += Math.cos(f.face) * EMBED_PROUD;
  }
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.face);
  return out.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(1, heightScale, 1));
}
