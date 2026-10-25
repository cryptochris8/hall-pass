// ─────────────────────────────────────────────────────────────────────────────
// PROPS CONTRACT — furniture models and school dressing (docs/GDD.md §3/§10,
// docs/ARCHITECTURE.md §9). Procedural, inked toon models built in code with
// GeoBuilder (src/render/models/*), never downloaded models.
//
// Two parts:
//  1. furnitureGeometry(): one merged, vertex-coloured, inked BufferGeometry per
//     furniture kind/size/variant (cached). The world instances it (one
//     InstancedMesh per geometry) at every SchoolPlan.furniture item, so 250
//     desks cost one draw call. Built at the origin, feet at y = 0, facing local
//     +Z (the item's `face` yaw is applied by the world), fitting the footprint
//     localW (X) × localD (Z) × h. Material: modelMaterial().
//  2. buildDressing(plan): everything that isn't a plan furniture item — door
//     frames + doors, windows, whiteboards, clocks, posters, bulletin boards,
//     room signs, banners, water fountains, trash cans, gym hoops and court
//     lines, sinks and mirrors, book spines, the cafeteria serving line… Merged
//     into as few meshes as possible. Purely visual: no collision, the fine grid
//     is the truth. Items mounted on walls report their wall anchor so the world
//     can hide them while that wall is lowered by the cut-away / occlusion.
// FROZEN shared contract (owner: props; changes go through the integrator).
// ─────────────────────────────────────────────────────────────────────────────
import type * as THREE from 'three';
import type { FurnitureKind, SchoolPlan } from '../../school/types';

/** Model variant: the generator's tags pick it ('goal' = the mission item glows/highlights, 'hide' = usable hide spot). */
export type PropVariant = 'plain' | 'goal' | 'hide';

export interface WallItem {
  /** Merged geometry of everything mounted on one wall box (posters, whiteboard, clock, window, sign…). */
  object: THREE.Object3D;
  /** A point inside the wall it hangs on (metres): the world looks up that wall's current height. */
  wallX: number;
  wallZ: number;
  /** Height (m) of the item's top edge: hide it when the wall is lower than this. */
  top: number;
}

export interface Dressing {
  /** Floor-standing dressing (gym hoops, fountains, trash cans, serving line, court lines…): always visible. */
  readonly root: THREE.Group;
  /** Wall-mounted dressing, grouped per wall. */
  readonly wallItems: readonly WallItem[];
  readonly stats: { meshes: number; triangles: number };
  dispose(): void;
}

/*
 * src/world/props/index.ts exports:
 *   export function furnitureGeometry(kind: FurnitureKind, localW: number, localD: number, h: number, variant: PropVariant): THREE.BufferGeometry;
 *   export function buildDressing(plan: SchoolPlan): Dressing;   // deterministic per plan (plan.seed)
 */
export type { FurnitureKind, SchoolPlan };
