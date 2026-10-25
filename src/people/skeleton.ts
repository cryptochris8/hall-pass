// ─────────────────────────────────────────────────────────────────────────────
// Human skeleton (ported from Bad Hair Day): one THREE.Skeleton per person drives ONE skinned, inked,
// vertex-coloured mesh (a single draw call for body + clothes + face + own hair).
// Face features are rigid parts bound to their own bones: expressions swap parts
// by scaling bones to ~0 (eye/mouth variants), lids scale along the eye's up axis,
// brows slide/tilt, irises translate (look) and scale (pupil size).
//
// Rest pose = standing, arms hanging, facing +Z, feet at y = 0. Side L = the
// character's LEFT = +X (its right hand is at −X).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { BodySpec } from './spec';

export const MOUTHS = ['smile', 'bigSmile', 'grin', 'open', 'o', 'wavy', 'smirk', 'flat'] as const;
export type MouthKind = (typeof MOUTHS)[number];
export const EYE_SHAPES = ['open', 'joy', 'closed', 'squeeze'] as const;
export type EyeShape = (typeof EYE_SHAPES)[number];

/** Bone indices (identical for every human so pose code and geometry share them). */
export const B = {
  base: 0,
  hips: 1,
  spine: 2,
  chest: 3,
  head: 4,
  upperArmL: 5,
  foreArmL: 6,
  handL: 7,
  fingerL: 8,
  upperArmR: 9,
  foreArmR: 10,
  handR: 11,
  fingerR: 12,
  thighL: 13,
  shinL: 14,
  footL: 15,
  thighR: 16,
  shinR: 17,
  footR: 18,
  /** Per-eye blocks start here: +0 open eye, +1 iris, +2 upper lid, +3 lower lid, +4 lashes, +5 joy, +6 closed, +7 squeeze, +8 brow, +9 blush. */
  faceL: 19,
  faceR: 29,
  mouth0: 39,
  hairTop: 49,
  hairBack0: 50,
  hairBack1: 51,
  hairBack2: 52,
  hairSideL0: 53,
  hairSideL1: 54,
  hairSideR0: 55,
  hairSideR1: 56,
  /** Prop toggles (scaled to ~0 when hidden): the whistle in the right hand / hanging on the lanyard. */
  propHand: 57,
  propChest: 58,
  count: 59,
} as const;

export const F = { open: 0, iris: 1, lidU: 2, lidD: 3, lash: 4, joy: 5, closed: 6, squeeze: 7, brow: 8, blush: 9 } as const;

export function faceBone(side: 1 | -1, part: number): number {
  return (side > 0 ? B.faceL : B.faceR) + part;
}

export function mouthBone(kind: MouthKind): number {
  return B.mouth0 + MOUTHS.indexOf(kind);
}

// ── face layout on the head ellipsoid (head-bone space: origin at the neck pivot) ──

export type V3 = [number, number, number];

const _up = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();

export interface SurfacePoint {
  pos: V3;
  /** Orientation whose +Z is the outward surface normal and +Y points up along the face. */
  quat: THREE.Quaternion;
}

/** Unit direction for (yaw, pitch): yaw 0 = +Z (face forward), + = toward +X (the character's left). */
export function dirOf(yaw: number, pitch: number): V3 {
  return [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
}

/** Point on the head ellipsoid (+ lift along the normal) with a face-aligned frame. Pure-ish (fresh quat). */
export function headSurface(s: BodySpec, yaw: number, pitch: number, lift = 0, roll = 0): SurfacePoint {
  const d = dirOf(yaw, pitch);
  const n = new THREE.Vector3(d[0] / s.headRx, d[1] / s.headRy, d[2] / s.headRz).normalize();
  const pos: V3 = [d[0] * s.headRx + n.x * lift, s.headCY + d[1] * s.headRy + n.y * lift, s.headCZ + d[2] * s.headRz + n.z * lift];
  _z.copy(n);
  _x.crossVectors(_up, _z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0);
  _x.normalize();
  _y.crossVectors(_z, _x).normalize();
  _m.makeBasis(_x, _y, _z);
  const quat = new THREE.Quaternion().setFromRotationMatrix(_m);
  if (roll) quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  return { pos, quat };
}

export interface FaceLayout {
  eye: Record<1 | -1, SurfacePoint>;
  brow: Record<1 | -1, SurfacePoint>;
  blush: Record<1 | -1, SurfacePoint>;
  mouth: SurfacePoint;
  nose: SurfacePoint;
  /** Eye-white lens radii (x, y, z). */
  eyeScale: V3;
}

export const EYE_SCALE: V3 = [0.78, 1.04, 0.5];

export function faceLayout(s: BodySpec): FaceLayout {
  const er = s.eyeR;
  const eye = {
    1: headSurface(s, s.eyeYaw, s.eyePitch, -er * 0.12),
    [-1]: headSurface(s, -s.eyeYaw, s.eyePitch, -er * 0.12),
  } as Record<1 | -1, SurfacePoint>;
  const browYaw = s.eyeYaw + 0.02;
  const brow = {
    1: headSurface(s, browYaw, s.eyePitch + s.browPitch, er * 0.02),
    [-1]: headSurface(s, -browYaw, s.eyePitch + s.browPitch, er * 0.02),
  } as Record<1 | -1, SurfacePoint>;
  const bp = s.eyePitch - 0.3;
  const byaw = s.eyeYaw + 0.16;
  const blush = {
    1: headSurface(s, byaw, bp, -0.0045),
    [-1]: headSurface(s, -byaw, bp, -0.0045),
  } as Record<1 | -1, SurfacePoint>;
  return {
    eye,
    brow,
    blush,
    mouth: headSurface(s, 0, s.mouthPitch, 0.004),
    nose: headSurface(s, 0, s.nosePitch, -0.004),
    eyeScale: [EYE_SCALE[0], EYE_SCALE[1], EYE_SCALE[2]],
  };
}

// ── bones ──────────────────────────────────────────────────────────────────────

export interface Rig {
  readonly bones: THREE.Bone[];
  /** Rest (bind) world matrices, captured once (model space). */
  readonly rest: THREE.Matrix4[];
}

/** Local rest offsets / orientations for every bone. */
export function buildBones(s: BodySpec, beard = false): Rig {
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < B.count; i++) {
    const b = new THREE.Bone();
    bones.push(b);
  }
  const names: Record<number, string> = {};
  for (const [k, v] of Object.entries(B)) if (k !== 'count') names[v] = k;
  bones.forEach((b, i) => (b.name = names[i] ?? `bone${i}`));

  const at = (i: number, parent: number, x: number, y: number, z: number, q?: THREE.Quaternion) => {
    const b = bones[i]!;
    b.position.set(x, y, z);
    if (q) b.quaternion.copy(q);
    if (parent >= 0) bones[parent]!.add(b);
  };
  const hipJ = s.thighL + s.shinL + s.ankleY;
  at(B.base, -1, 0, 0, 0);
  at(B.hips, B.base, 0, s.hipsY, 0);
  at(B.spine, B.hips, 0, s.spineY - s.hipsY, 0);
  at(B.chest, B.spine, 0, s.chestY - s.spineY, 0);
  at(B.head, B.chest, 0, s.neckY - s.chestY, 0);
  for (const sd of [1, -1] as const) {
    const up = sd > 0 ? B.upperArmL : B.upperArmR;
    const fo = sd > 0 ? B.foreArmL : B.foreArmR;
    const ha = sd > 0 ? B.handL : B.handR;
    const fi = sd > 0 ? B.fingerL : B.fingerR;
    at(up, B.chest, sd * s.shoulderX, s.shoulderY - s.chestY, 0);
    at(fo, up, 0, -s.upperArmL, 0);
    at(ha, fo, 0, -s.foreArmL, 0);
    at(fi, ha, 0, -s.handR * 0.9, s.handR * 0.35);
    const th = sd > 0 ? B.thighL : B.thighR;
    const sh = sd > 0 ? B.shinL : B.shinR;
    const ft = sd > 0 ? B.footL : B.footR;
    at(th, B.hips, sd * s.hipX, hipJ - s.hipsY, 0);
    at(sh, th, 0, -s.thighL, 0);
    at(ft, sh, 0, -s.shinL, 0);
  }
  // Face.
  const L = faceLayout(s);
  const er = s.eyeR;
  const ey = er * L.eyeScale[1];
  for (const sd of [1, -1] as const) {
    const e = L.eye[sd];
    const o = faceBone(sd, 0);
    at(o + F.open, B.head, e.pos[0], e.pos[1], e.pos[2], e.quat);
    at(o + F.iris, o + F.open, 0, 0, 0);
    at(o + F.lidU, o + F.open, 0, ey * 1.02, 0);
    at(o + F.lidD, o + F.open, 0, -ey * 1.02, 0);
    at(o + F.lash, o + F.open, 0, 0, 0);
    at(o + F.joy, B.head, e.pos[0], e.pos[1], e.pos[2], e.quat);
    at(o + F.closed, B.head, e.pos[0], e.pos[1], e.pos[2], e.quat);
    at(o + F.squeeze, B.head, e.pos[0], e.pos[1], e.pos[2], e.quat);
    const bw = L.brow[sd];
    at(o + F.brow, B.head, bw.pos[0], bw.pos[1], bw.pos[2], bw.quat);
    const bl = L.blush[sd];
    at(o + F.blush, B.head, bl.pos[0], bl.pos[1], bl.pos[2], bl.quat);
  }
  const mouthLift = beard ? s.headRz * 0.07 : 0;
  const mp = headSurface(s, 0, s.mouthPitch, 0.004 + mouthLift);
  for (let i = 0; i < MOUTHS.length; i++) at(B.mouth0 + i, B.head, mp.pos[0], mp.pos[1], mp.pos[2], mp.quat);
  // Hair (adults' own hair + extras): crown bone + three chains.
  const cy = s.headCY;
  const cz = s.headCZ;
  at(B.hairTop, B.head, 0, cy + s.headRy * 0.35, cz);
  at(B.hairBack0, B.head, 0, cy + s.headRy * 0.1, cz - s.headRz * 0.72);
  at(B.hairBack1, B.hairBack0, 0, -s.headRy * 1.05, -0.02);
  at(B.hairBack2, B.hairBack1, 0, -s.headRy * 1.0, 0);
  for (const sd of [1, -1] as const) {
    const a = sd > 0 ? B.hairSideL0 : B.hairSideR0;
    const b2 = sd > 0 ? B.hairSideL1 : B.hairSideR1;
    at(a, B.head, sd * s.headRx * 0.82, cy - s.headRy * 0.05, cz - s.headRz * 0.12);
    at(b2, a, sd * 0.01, -s.headRy * 1.1, -0.01);
  }
  // Props.
  at(B.propHand, B.handR, 0, -s.handR * 0.82, 0);
  at(B.propChest, B.chest, 0, s.shoulderY - s.chestY - 0.13, s.torsoD * 1.02);
  bones[B.base]!.updateMatrixWorld(true);
  const rest = bones.map((b) => b.matrixWorld.clone());
  return { bones, rest };
}

/** Model-space rest position of a bone. */
export function restPos(rig: Rig, i: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.setFromMatrixPosition(rig.rest[i]!);
}
