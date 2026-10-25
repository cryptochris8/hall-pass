// Props module entry (contract: src/world/props/types.ts). STUB by the integrator until the props owner lands the
// real models: plain inked boxes for furniture and no dressing.
import * as THREE from 'three';
import { inked } from '../../render/models/common';
import type { FurnitureKind, SchoolPlan } from '../../school/types';
import type { Dressing, PropVariant } from './types';

export * from './types';

const COLOR: Partial<Record<FurnitureKind, number>> = { locker: 0x7fa58c, vending: 0xc0392b, shelf: 0x7a5a3e, stall: 0x9aa3ad };
const cache = new Map<string, THREE.BufferGeometry>();

export function furnitureGeometry(kind: FurnitureKind, localW: number, localD: number, h: number, variant: PropVariant): THREE.BufferGeometry {
  const key = `${kind}|${localW.toFixed(2)}|${localD.toFixed(2)}|${h.toFixed(2)}|${variant}`;
  let g = cache.get(key);
  if (!g) {
    const b = inked();
    b.box(localW, h, localD, variant === 'goal' ? 0x2e8bff : (COLOR[kind] ?? 0xb98a5a), { at: [0, h / 2, 0] });
    g = b.build();
    cache.set(key, g);
  }
  return g;
}

export function buildDressing(plan: SchoolPlan): Dressing {
  void plan;
  return { root: new THREE.Group(), wallItems: [], stats: { meshes: 0, triangles: 0 }, dispose() {} };
}
