// ─────────────────────────────────────────────────────────────────────────────
// Build-time geometry helpers for the family module (no per-frame use):
// elliptical ring tubes (torsos, sleeves, trouser legs, skirts), surface sampling
// on them (pattern prints), little stars, ribbon hair locks and orientation maths.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { V3 } from './skeleton';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);

export function eul(q: THREE.Quaternion): V3 {
  _e.setFromQuaternion(q, 'XYZ');
  return [_e.x, _e.y, _e.z];
}

/** Euler (XYZ) rotating +Y onto `dir`. */
export function alignY(dir: readonly [number, number, number] | THREE.Vector3): V3 {
  if (dir instanceof THREE.Vector3) _a.copy(dir);
  else _a.set(dir[0], dir[1], dir[2]);
  _q.setFromUnitVectors(AY, _a.normalize());
  return eul(_q);
}

/** Euler (XYZ) rotating +Z onto `dir`, optionally rolled about it. */
export function alignZ(dir: readonly [number, number, number] | THREE.Vector3, roll = 0): V3 {
  if (dir instanceof THREE.Vector3) _a.copy(dir);
  else _a.set(dir[0], dir[1], dir[2]);
  _a.normalize();
  // Keep +Y as "up" as far as possible (no arbitrary twist).
  _b.set(0, 1, 0);
  if (Math.abs(_a.dot(_b)) > 0.98) _b.set(0, 0, -1);
  const x = new THREE.Vector3().crossVectors(_b, _a).normalize();
  const y = new THREE.Vector3().crossVectors(_a, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, _a);
  _q.setFromRotationMatrix(m);
  if (roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(AZ, roll));
  return eul(_q);
}

export interface Ring {
  /** Height (local y). */
  y: number;
  /** Half width (x). */
  w: number;
  /** Half depth (z). */
  d: number;
  /** Centre z offset. */
  z?: number;
  /** Centre x offset. */
  x?: number;
  /** Front opening half-angle (rad) at this ring: the tube spans [open, 2π − open] (V-necks, open jackets). */
  open?: number;
}

export interface RingTubeOpts {
  closeBottom?: boolean;
  closeTop?: boolean;
  /** Arc start (rad; 0 = +Z front, increasing toward +X) and length. Partial arcs are open (no caps). */
  phi0?: number;
  phiLen?: number;
}

/** Indexed tube through elliptical rings (bottom → top) with smooth normals. */
export function ringTube(rings: readonly Ring[], seg: number, o: RingTubeOpts = {}): THREE.BufferGeometry {
  const perRing = rings.some((r) => (r.open ?? 0) > 0);
  const full = !perRing && (o.phiLen === undefined || o.phiLen >= Math.PI * 2 - 1e-6);
  const cols = full ? seg : seg + 1;
  const pos: number[] = [];
  for (const r of rings) {
    const phi0 = perRing ? (r.open ?? 0) : (o.phi0 ?? 0);
    const phiLen = perRing ? Math.PI * 2 - 2 * (r.open ?? 0) : (o.phiLen ?? Math.PI * 2);
    for (let k = 0; k < cols; k++) {
      const a = phi0 + (phiLen * k) / seg;
      pos.push((r.x ?? 0) + Math.sin(a) * r.w, r.y, (r.z ?? 0) + Math.cos(a) * r.d);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let k = 0; k < seg; k++) {
      const k1 = full ? (k + 1) % seg : k + 1;
      const a = i * cols + k;
      const b = i * cols + k1;
      const c = (i + 1) * cols + k;
      const d = (i + 1) * cols + k1;
      idx.push(a, b, c, b, d, c);
    }
  }
  if (full && o.closeBottom) {
    const r = rings[0]!;
    const ci = pos.length / 3;
    pos.push(r.x ?? 0, r.y - Math.min(r.w, r.d) * 0.25, r.z ?? 0);
    for (let k = 0; k < seg; k++) idx.push(k, ci, (k + 1) % seg);
  }
  if (full && o.closeTop) {
    const r = rings[rings.length - 1]!;
    const base = (rings.length - 1) * cols;
    const ci = pos.length / 3;
    pos.push(r.x ?? 0, r.y + Math.min(r.w, r.d) * 0.25, r.z ?? 0);
    for (let k = 0; k < seg; k++) idx.push(base + k, base + ((k + 1) % seg), ci);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Points along the opening edge (side +1 = the +X edge) of a tube with per-ring `open`. */
export function openEdge(rings: readonly Ring[], side: 1 | -1, lift = 0.004): THREE.Vector3[] {
  return rings.map((r) => {
    const a = side * (r.open ?? 0);
    return new THREE.Vector3((r.x ?? 0) + Math.sin(a) * (r.w + lift), r.y, (r.z ?? 0) + Math.cos(a) * (r.d + lift));
  });
}

/** Interpolated ring at height y (clamped to the ring range). Rings must be sorted by y. */
export function ringAt(rings: readonly Ring[], y: number): Required<Ring> {
  let i = 0;
  while (i < rings.length - 2 && y > rings[i + 1]!.y) i++;
  const r0 = rings[i]!;
  const r1 = rings[Math.min(i + 1, rings.length - 1)]!;
  const t = r1.y === r0.y ? 0 : Math.max(0, Math.min(1, (y - r0.y) / (r1.y - r0.y)));
  return {
    y,
    w: r0.w + (r1.w - r0.w) * t,
    d: r0.d + (r1.d - r0.d) * t,
    z: (r0.z ?? 0) + ((r1.z ?? 0) - (r0.z ?? 0)) * t,
    x: (r0.x ?? 0) + ((r1.x ?? 0) - (r0.x ?? 0)) * t,
    open: (r0.open ?? 0) + ((r1.open ?? 0) - (r0.open ?? 0)) * t,
  };
}

/** Point + outward normal on a ring tube at (phi, y), lifted by `lift` along the normal. */
export function tubePoint(rings: readonly Ring[], phi: number, y: number, lift = 0): { pos: V3; n: V3 } {
  const r = ringAt(rings, y);
  const sx = Math.sin(phi);
  const cz = Math.cos(phi);
  const n = new THREE.Vector3(sx / Math.max(1e-4, r.w), 0, cz / Math.max(1e-4, r.d));
  // Tilt the normal with the profile slope so prints lie flat on tapering tubes.
  const r2 = ringAt(rings, y + 0.01);
  const dw = (Math.hypot(sx * r2.w, cz * r2.d) - Math.hypot(sx * r.w, cz * r.d)) / 0.01;
  n.normalize();
  n.y = -dw;
  n.normalize();
  return { pos: [r.x + sx * r.w + n.x * lift, y + n.y * lift, r.z + cz * r.d + n.z * lift], n: [n.x, n.y, n.z] };
}

/** Flat 5-point star outline (XY, CCW). */
export function starPoints(rOuter: number, rInner = rOuter * 0.46, points = 5): [number, number][] {
  const pts: [number, number][] = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 ? rInner : rOuter;
    const a = (k / (points * 2)) * Math.PI * 2 + Math.PI / 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

/** Heart outline (XY, CCW), size ≈ 2r wide. */
export function heartPoints(r: number, n = 18): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([(x / 16) * r, (y / 16) * r]);
  }
  return pts;
}

/**
 * Ribbon hair lock: a flattened tube along `pts` (root → tip) with half-widths `w` and half-thickness `t`
 * (per point), the flat side facing `out` (per point, pointing away from the head). Tip closed.
 */
export function lockGeometry(pts: readonly THREE.Vector3[], w: readonly number[], t: readonly number[], out: readonly THREE.Vector3[], radial = 6): THREE.BufferGeometry {
  const pos: number[] = [];
  const n = pts.length;
  const T = new THREE.Vector3();
  const S = new THREE.Vector3();
  const O = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const p = pts[i]!;
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(n - 1, i + 1)]!;
    T.subVectors(next, prev).normalize();
    O.copy(out[i]!).addScaledVector(T, -out[i]!.dot(T)).normalize();
    S.crossVectors(T, O).normalize();
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const cw = Math.cos(a) * w[i]!;
      const st = Math.sin(a) * t[i]!;
      pos.push(p.x + S.x * cw + O.x * st, p.y + S.y * cw + O.y * st, p.z + S.z * cw + O.z * st);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < radial; k++) {
      const k1 = (k + 1) % radial;
      const a = i * radial + k;
      const b = i * radial + k1;
      const c = (i + 1) * radial + k;
      const d = (i + 1) * radial + k1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Tip.
  const tip = pts[n - 1]!.clone().add(T.clone().multiplyScalar(Math.max(w[n - 1]!, 0.004)));
  const ti = pos.length / 3;
  pos.push(tip.x, tip.y, tip.z);
  const base = (n - 1) * radial;
  for (let k = 0; k < radial; k++) idx.push(base + k, ti, base + ((k + 1) % radial));
  // Root cap.
  const root = pts[0]!.clone().addScaledVector(T.subVectors(pts[1]!, pts[0]!).normalize(), -0.004);
  const ri = pos.length / 3;
  pos.push(root.x, root.y, root.z);
  for (let k = 0; k < radial; k++) idx.push(k, (k + 1) % radial, ri);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Smoothstep helper (build time and runtime). */
export function sstep(e0: number, e1: number, v: number): number {
  const t = e1 === e0 ? (v >= e1 ? 1 : 0) : Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
