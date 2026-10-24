// Shared helpers for procedural models.
import * as THREE from 'three';
import { GeoBuilder } from './builder';
import { modelMaterial } from './materials';
import { isShared, markShared } from './shared';

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Build-once geometry cache (marked shared: never disposed per instance). */
export function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = markShared(make());
    geoCache.set(key, g);
  }
  return g;
}

/** Builder for inked gameplay parts. */
export const inked = (): GeoBuilder => new GeoBuilder(true, true);
/** Builder for un-inked parts that still want glow (props, houses details). */
export const plain = (): GeoBuilder => new GeoBuilder(false, true);

/** Mesh with a (default shared) model material, positioned at a pivot and added to `parent`. */
export function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, material?: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, material ?? modelMaterial());
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function group(parent: THREE.Object3D | null, x = 0, y = 0, z = 0, name = ''): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (name) g.name = name;
  parent?.add(g);
  return g;
}

/** Dispose every non-shared geometry/material under `root` and detach it. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh && !(o as THREE.Points).isPoints) return;
    if (m.geometry && !isShared(m.geometry)) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    for (const mat of mats) if (mat && !isShared(mat)) mat.dispose();
  });
  root.removeFromParent();
}

/** Deterministic small hash → 0..1. */
export function rand01(seed: number, k: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(k | 0, 0x85ebca6b)) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** Frame-rate independent approach. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

/** Cartoon eye (white + pupil + glint) facing +Z, as geometry parts on `b`. */
export function eyeParts(b: GeoBuilder, at: readonly [number, number, number], r: number, pupil = 0x16161c, look = 0): void {
  b.ball(r, 1, 0xffffff, { at: [at[0], at[1], at[2]], scale: [0.9, 1.1, 0.6] });
  b.ball(r * 0.58, 0, pupil, { ink: false, at: [at[0] + look * r * 0.25, at[1] - r * 0.08, at[2] + r * 0.36], scale: [0.9, 1.05, 0.5] });
  b.ball(r * 0.2, 0, 0xffffff, { ink: false, at: [at[0] + look * r * 0.25 - r * 0.18, at[1] + r * 0.22, at[2] + r * 0.6] });
}

/** Small additive ground ring (highlight) — cached geometry. */
export function ringGeometry(inner: number, outer: number, seg = 32): THREE.BufferGeometry {
  return cachedGeo(`ring|${inner}|${outer}|${seg}`, () => {
    const g = new THREE.RingGeometry(inner, outer, seg, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  });
}
