// Analytic two-bone IK for the arms (no allocations; adapted from Athlete Mayhem).
// The chain hangs along the shoulder's local −Y; the elbow hinges about local X
// and bends toward local +Z (elbow.rotation.x = −bend), like the FK rig.
import * as THREE from 'three';

const _d = new THREE.Vector3();
const _pp = new THREE.Vector3();
const _u = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _yn = new THREE.Vector3();
const _m = new THREE.Matrix4();

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * Solve shoulder orientation + elbow bend so the chain end (upper l1 + lower l2) reaches
 * `target` (both in the shoulder's parent frame). The elbow points toward `pole`.
 * Writes the shoulder quaternion into `outQ` and returns the elbow bend (rad, ≥ 0).
 * Unreachable targets are clamped (arm fully stretched toward the target).
 */
export function solveTwoBone(shoulder: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, outQ: THREE.Quaternion): number {
  _d.subVectors(target, shoulder);
  let dist = _d.length();
  if (dist < 1e-6) {
    _d.set(0, -1, 0);
    dist = 1e-6;
  } else _d.multiplyScalar(1 / dist);
  const D = clamp(dist, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
  const cosA = clamp((l1 * l1 + D * D - l2 * l2) / (2 * l1 * D), -1, 1);
  const A = Math.acos(cosA);
  const cosE = clamp((l1 * l1 + l2 * l2 - D * D) / (2 * l1 * l2), -1, 1);
  const bend = Math.PI - Math.acos(cosE);

  _pp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pp.lengthSq() < 1e-10) {
    _pp.set(0, 0, -1).addScaledVector(_d, _d.z);
    if (_pp.lengthSq() < 1e-10) _pp.set(1, 0, 0).addScaledVector(_d, -_d.x);
  }
  _pp.normalize();

  _u.copy(_d).multiplyScalar(cosA).addScaledVector(_pp, Math.sin(A)).normalize();
  _w.copy(_d).addScaledVector(_u, -_d.dot(_u));
  if (_w.lengthSq() < 1e-10) _w.copy(_pp).negate();
  else _w.normalize();
  _yn.copy(_u).negate();
  _x.crossVectors(_yn, _w);
  _m.makeBasis(_x, _yn, _w);
  outQ.setFromRotationMatrix(_m);
  return bend;
}

/** Forward kinematics of the same chain (tests): end point in the parent frame. */
export function twoBoneEnd(shoulder: THREE.Vector3, q: THREE.Quaternion, bend: number, l1: number, l2: number, out: THREE.Vector3): THREE.Vector3 {
  const qe = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -bend);
  const fore = new THREE.Vector3(0, -l2, 0).applyQuaternion(qe);
  fore.add(new THREE.Vector3(0, -l1, 0));
  return out.copy(fore.applyQuaternion(q)).add(shoulder);
}

/**
 * Vertical extent of a leg from the hip joint to its lowest point (sole or knee cap),
 * given hip pitch x, abduction o, knee k and ankle a (sagittal-plane approximation).
 */
export function legExtension(thighL: number, shinL: number, ankleY: number, footL: number, kneeR: number, x: number, o: number, k: number, a: number): number {
  const co = Math.cos(o);
  const toKnee = thighL * Math.cos(x) * co;
  const toAnkle = toKnee + shinL * Math.cos(x + k) * co;
  const phi = x + k + a;
  const sp = Math.sin(phi);
  // Sole: ankle height below the ankle, rotated; toe/heel dip when the foot tilts.
  const foot = ankleY * Math.cos(phi) + Math.max(footL * 0.72 * sp, -footL * 0.28 * sp);
  return Math.max(toAnkle + foot * co, toKnee + kneeR);
}
