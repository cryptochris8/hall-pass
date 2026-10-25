// Props module entry (contract: src/world/props/types.ts).
//  • furnitureGeometry(): procedural inked furniture per kind/size/variant (furniture.ts), cached.
//  • buildDressing(plan): door frames, signs, windows, boards, hallway and room dressing (dressing.ts).
import type * as THREE from 'three';
import { cachedGeo } from '../../render/models/common';
import type { FurnitureKind } from '../../school/types';
import { buildFurniture } from './furniture';
import type { PropVariant } from './types';

export * from './types';
export { buildDressing } from './dressing';
export { EMBED_PROUD, furnitureFootprint, furnitureMatrix, isEmbeddedFurniture, variantOf } from './placement';
export { LOCKER_RECESS } from './furniture';

/**
 * Furniture model for one kind/size/variant: merged, vertex-coloured, inked, built at the origin with feet at y = 0,
 * facing local +Z, fitting localW (X) × localD (Z) × h. Cached (shared: never dispose it). Material: modelMaterial().
 */
export function furnitureGeometry(kind: FurnitureKind, localW: number, localD: number, h: number, variant: PropVariant): THREE.BufferGeometry {
  const key = `props|${kind}|${localW.toFixed(2)}|${localD.toFixed(2)}|${h.toFixed(2)}|${variant}`;
  return cachedGeo(key, () => buildFurniture(kind, localW, localD, h, variant));
}
