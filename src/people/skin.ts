// ─────────────────────────────────────────────────────────────────────────────
// SkinBuilder — assembles GeoBuilder parts (inked, vertex-coloured) authored in
// each BONE'S LOCAL rest frame into ONE skinned BufferGeometry (skinIndex /
// skinWeight, up to 4 influences). Rigid parts bind every vertex to one bone;
// blended parts get weights from a function of the model-space rest position
// (continuous sleeves, trouser legs, torsos, skirts and hair locks).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { GeoBuilder } from '../render/models/builder';
import { markShared } from '../render/models/shared';

/** Up to four (bone, weight) pairs; unused slots weight 0. Written by weight functions. */
export interface SkinW {
  i: [number, number, number, number];
  w: [number, number, number, number];
}

export type WeightFn = (x: number, y: number, z: number, out: SkinW) => void;

interface Part {
  bone: number;
  builder: GeoBuilder;
  weights: WeightFn | null;
  /** Optional bone-local deformation applied before the rest transform (e.g. bend onto the head). */
  deform: ((v: THREE.Vector3) => void) | null;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export function newSkinW(): SkinW {
  return { i: [0, 0, 0, 0], w: [1, 0, 0, 0] };
}

/** Write a two-bone blend: `t` = weight of bone b (0 → all a). */
export function blend2(out: SkinW, a: number, b: number, t: number): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  out.i[0] = a;
  out.i[1] = b;
  out.i[2] = 0;
  out.i[3] = 0;
  out.w[0] = 1 - k;
  out.w[1] = k;
  out.w[2] = 0;
  out.w[3] = 0;
}

/** Normalise weights in place (sum 1; all-zero → first slot). */
export function normalizeSkinW(out: SkinW): void {
  let s = 0;
  for (let k = 0; k < 4; k++) {
    if (!(out.w[k]! > 0)) out.w[k] = 0;
    s += out.w[k]!;
  }
  if (s <= 1e-9) {
    out.w[0] = 1;
    out.w[1] = out.w[2] = out.w[3] = 0;
    return;
  }
  for (let k = 0; k < 4; k++) out.w[k] = out.w[k]! / s;
}

export class SkinBuilder {
  private readonly parts: Part[] = [];

  constructor(private readonly rest: readonly THREE.Matrix4[]) {}

  /** Builder for rigid parts of `bone`, authored in that bone's local rest frame. */
  on(bone: number, ink = true, deform: ((v: THREE.Vector3) => void) | null = null): GeoBuilder {
    const builder = new GeoBuilder(ink, true);
    this.parts.push({ bone, builder, weights: null, deform });
    return builder;
  }

  /** Builder authored in `bone`'s local frame whose vertices are weighted by `fn` (model-space rest position). */
  blend(bone: number, fn: WeightFn, ink = true): GeoBuilder {
    const builder = new GeoBuilder(ink, true);
    this.parts.push({ bone, builder, weights: fn, deform: null });
    return builder;
  }

  build(): THREE.BufferGeometry {
    const built = this.parts.map((p) => ({ p, g: p.builder.build() }));
    let count = 0;
    for (const { g } of built) count += g.getAttribute('position').count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const ink = new Float32Array(count * 3);
    const glow = new Float32Array(count * 3);
    const si = new Uint16Array(count * 4);
    const sw = new Float32Array(count * 4);
    const w = newSkinW();
    let o = 0;
    for (const { p, g } of built) {
      const m = this.rest[p.bone]!;
      _nm.getNormalMatrix(m);
      const P = g.getAttribute('position') as THREE.BufferAttribute;
      const N = g.getAttribute('normal') as THREE.BufferAttribute;
      const C = g.getAttribute('color') as THREE.BufferAttribute;
      const I = g.getAttribute('aInk') as THREE.BufferAttribute;
      const G = g.getAttribute('aGlow') as THREE.BufferAttribute;
      for (let k = 0; k < P.count; k++, o++) {
        _v.fromBufferAttribute(P, k);
        if (p.deform) p.deform(_v);
        _v.applyMatrix4(m);
        pos[o * 3] = _v.x;
        pos[o * 3 + 1] = _v.y;
        pos[o * 3 + 2] = _v.z;
        _n.fromBufferAttribute(N, k).applyMatrix3(_nm);
        const nl = _n.length() || 1;
        nor[o * 3] = _n.x / nl;
        nor[o * 3 + 1] = _n.y / nl;
        nor[o * 3 + 2] = _n.z / nl;
        col[o * 3] = C.getX(k);
        col[o * 3 + 1] = C.getY(k);
        col[o * 3 + 2] = C.getZ(k);
        _n.fromBufferAttribute(I, k);
        if (_n.lengthSq() > 0) _n.applyMatrix3(_nm);
        ink[o * 3] = _n.x;
        ink[o * 3 + 1] = _n.y;
        ink[o * 3 + 2] = _n.z;
        glow[o * 3] = G.getX(k);
        glow[o * 3 + 1] = G.getY(k);
        glow[o * 3 + 2] = G.getZ(k);
        if (p.weights) {
          w.i[0] = p.bone;
          w.i[1] = w.i[2] = w.i[3] = 0;
          w.w[0] = 1;
          w.w[1] = w.w[2] = w.w[3] = 0;
          p.weights(_v.x, _v.y, _v.z, w);
          normalizeSkinW(w);
          for (let q = 0; q < 4; q++) {
            si[o * 4 + q] = w.i[q]!;
            sw[o * 4 + q] = w.w[q]!;
          }
        } else {
          si[o * 4] = p.bone;
          sw[o * 4] = 1;
        }
      }
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aInk', new THREE.BufferAttribute(ink, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 3));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    return geo;
  }
}

// ── reference-counted cache (per-look geometry shared by characters with the same look) ──

interface Entry {
  geo: THREE.BufferGeometry;
  refs: number;
}
const entries = new Map<string, Entry>();
const keyOf = new WeakMap<THREE.BufferGeometry, string>();


/** Get (building on first use) a ref-counted geometry. Pair every call with releaseGeo(). */
export function acquireGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let e = entries.get(key);
  if (!e) {
    e = { geo: markShared(make()), refs: 0 };
    entries.set(key, e);
    keyOf.set(e.geo, key);
  }
  e.refs++;
  return e.geo;
}

export function releaseGeo(geo: THREE.BufferGeometry): void {
  const key = keyOf.get(geo);
  if (key === undefined) return;
  const e = entries.get(key);
  if (!e || e.geo !== geo) return;
  e.refs--;
  if (e.refs <= 0) {
    entries.delete(key);
    keyOf.delete(geo);
    geo.dispose();
  }
}

export function refCount(key: string): number {
  return entries.get(key)?.refs ?? 0;
}

export function liveGeometries(): number {
  return entries.size;
}

/** Triangles of a (non-indexed) geometry. */
export function triCount(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}
