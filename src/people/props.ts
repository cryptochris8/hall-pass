// ─────────────────────────────────────────────────────────────────────────────
// Separate (non-skinned) prop meshes, cached + shared: the vice principal's
// dramatic coffee mug, the student-council clipboard and the custodian's cart.
// Hand props are authored in the hand-socket frame (origin = mitten centre,
// +Y up, +Z forward in the BODY frame — rig.ts keeps them upright). The cart is
// authored in the person's root frame (feet at the origin, facing +Z).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { shadeHex } from '../render/models/builder';
import { cachedGeo, inked } from '../render/models/common';
import { PEOPLE } from './palette';

/** Custodian cart footprint + handle (root frame, metres). The world can use the footprint as moving cover. */
export const CART = {
  /** Half width (x). */
  halfWidth: 0.3,
  /** Near (handle) end and far end along +z. */
  nearZ: 0.42,
  farZ: 1.42,
  /** Footprint centre z. */
  centerZ: 0.92,
  height: 0.98,
  /** Handle bar: where her hands grip (±gripX). */
  handleY: 0.92,
  handleZ: 0.44,
  gripX: 0.17,
} as const;

export function mugGeometry(): THREE.BufferGeometry {
  return cachedGeo('hp-people-mug', () => {
    const b = inked();
    const z = 0.075;
    // A big mug (more dramatic than practical): body, coloured band, coffee, handle toward the hand.
    b.cyl(0.05, 0.046, 0.12, 12, PEOPLE.mugBody, { at: [0, 0.03, z], smooth: true });
    b.cyl(0.0505, 0.0505, 0.03, 12, PEOPLE.mugBand, { at: [0, 0.035, z], smooth: true, ink: false });
    b.cyl(0.044, 0.044, 0.004, 12, PEOPLE.coffee, { at: [0, 0.089, z], ink: false });
    b.torus(0.03, 0.009, 4, 10, PEOPLE.mugBody, { at: [0, 0.03, z - 0.052], rot: [0, Math.PI / 2, 0] }, Math.PI);
    // A gold star on the front ("#1 VP" energy, no text).
    const star: [number, number][] = [];
    for (let k = 0; k < 10; k++) {
      const r = k % 2 ? 0.009 : 0.02;
      const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
      star.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    b.extrude(star, 0.003, PEOPLE.goldTrim, { at: [0, 0.035, z + 0.05], ink: false });
    return b.build();
  });
}

export function clipboardGeometry(): THREE.BufferGeometry {
  return cachedGeo('hp-people-clipboard', () => {
    const b = inked();
    const th = 1.05; // tilt: top edge forward-up, face up-back toward his face
    const top = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
    const nrm = new THREE.Vector3(0, Math.sin(th), -Math.cos(th));
    const c = new THREE.Vector3(-0.06, 0, 0).addScaledVector(top, 0.13);
    const at = (v: THREE.Vector3, k: number, u = 0, x = 0): [number, number, number] => [v.x + x, v.y + nrm.y * k + top.y * u, v.z + nrm.z * k + top.z * u];
    b.box(0.23, 0.31, 0.012, PEOPLE.clipboard, { at: [c.x, c.y, c.z], rot: [th, 0, 0] });
    b.box(0.2, 0.26, 0.004, PEOPLE.paper, { at: at(c, 0.008, -0.01), rot: [th, 0, 0], ink: false });
    for (let i = 0; i < 5; i++) b.box(0.15, 0.006, 0.002, PEOPLE.paperLine, { at: at(c, 0.0105, 0.07 - i * 0.04, -0.01), rot: [th, 0, 0], ink: false });
    b.box(0.08, 0.03, 0.016, PEOPLE.clip, { at: at(c, 0.01, 0.145), rot: [th, 0, 0] });
    // A gold "student council" pin on the clip.
    b.cyl(0.008, 0.008, 0.004, 8, PEOPLE.vestTrim, { at: at(c, 0.02, 0.145), rot: [th - Math.PI / 2, 0, 0], ink: false });
    return b.build();
  });
}

export function cartGeometry(): THREE.BufferGeometry {
  return cachedGeo('hp-people-cart', () => {
    const b = inked();
    const W = CART.halfWidth;
    const z0 = CART.nearZ;
    const z1 = CART.farZ;
    const zc = (z0 + z1) / 2;
    const L = z1 - z0;
    const body = PEOPLE.cartBody;
    const dark = PEOPLE.cartDark;
    // Casters.
    for (const x of [-W + 0.06, W - 0.06]) for (const z of [z0 + 0.07, z1 - 0.07]) {
      b.cyl(0.05, 0.05, 0.035, 6, dark, { at: [x, 0.05, z], rot: [0, 0, Math.PI / 2], smooth: true });
      b.box(0.03, 0.05, 0.04, shadeHex(body, 0.8), { at: [x, 0.105, z], ink: false });
    }
    // Lower deck + upper deck on four corner posts.
    b.box(W * 2, 0.05, L, body, { at: [0, 0.15, zc] });
    const tz = z0 + L * 0.5;
    b.box(W * 2 - 0.04, 0.03, L * 0.28, shadeHex(body, 1.1), { at: [0, 0.55, tz] });
    for (const x of [-W + 0.025, W - 0.025]) for (const z of [tz - L * 0.13, tz + L * 0.13]) b.box(0.03, 0.4, 0.03, dark, { at: [x, 0.36, z], ink: false });
    // Handle frame at the near end.
    for (const x of [-W + 0.04, W - 0.04]) {
      b.box(0.03, CART.handleY - 0.15, 0.03, dark, { at: [x, (CART.handleY + 0.15) / 2, z0 + 0.02], rot: [0.06, 0, 0] });
    }
    b.cyl(0.022, 0.022, W * 2 - 0.02, 6, dark, { at: [0, CART.handleY, CART.handleZ], rot: [0, 0, Math.PI / 2], smooth: true });
    // Rubber grips.
    for (const sd of [-1, 1]) b.cyl(0.026, 0.026, 0.11, 6, 0x2a2a30, { at: [sd * CART.gripX, CART.handleY, CART.handleZ], rot: [0, 0, Math.PI / 2], smooth: true, ink: false });
    // Tall bin at the far end (with a liner rim).
    const bz = z1 - 0.2;
    b.cyl(0.2, 0.18, 0.66, 8, PEOPLE.cartBin, { at: [0, 0.5, bz], smooth: true });
    b.torus(0.2, 0.018, 3, 8, shadeHex(PEOPLE.cartBin, 0.8), { at: [0, 0.83, bz], rot: [Math.PI / 2, 0, 0], smooth: true });
    b.cyl(0.19, 0.19, 0.01, 8, 0x3a3f46, { at: [0, 0.825, bz], ink: false });
    // Mop bucket on the lower deck (blue, with water + a wringer).
    const kz = z0 + 0.19;
    b.cyl(0.15, 0.13, 0.24, 9, PEOPLE.bucket, { at: [0.0, 0.3, kz], smooth: true });
    b.cyl(0.14, 0.14, 0.006, 9, PEOPLE.water, { at: [0.0, 0.405, kz], ink: false });
    b.box(0.14, 0.08, 0.12, shadeHex(PEOPLE.bucket, 0.75), { at: [0.06, 0.45, kz + 0.04] });
    // Mop: head in the bucket, handle leaning back to the handle bar.
    const top = new THREE.Vector3(0.21, 1.36, z0 + 0.03);
    const bot = new THREE.Vector3(0.04, 0.38, kz);
    const d = new THREE.Vector3().subVectors(top, bot);
    const m = bot.clone().addScaledVector(d, 0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    b.cyl(0.014, 0.014, d.length(), 6, PEOPLE.mopHandle, { at: [m.x, m.y, m.z], rot: [e.x, e.y, e.z] });
    b.sphere(0.09, 5, 3, PEOPLE.mopHead, { at: [bot.x, bot.y + 0.02, bot.z], scale: [1, 0.55, 1], smooth: true, jitter: 0.008, seed: 5 });
    // Spray bottles on the upper deck.
    for (const [x, col] of [
      [-0.16, 0x6fae9f],
      [-0.06, 0xd98aa8],
    ] as const) {
      b.cyl(0.03, 0.032, 0.13, 6, col, { at: [x, 0.635, tz], smooth: true });
      b.box(0.03, 0.04, 0.05, 0xf2f0ea, { at: [x, 0.72, tz + 0.01], ink: false });
    }
    // Folded towels.
    b.box(0.14, 0.05, 0.1, PEOPLE.paper, { at: [0.15, 0.59, tz] });
    return b.build();
  });
}

/** Phone (idle phone glance), held flat-ish in the left hand, screen up toward the face. */
export function phoneGeometry(): THREE.BufferGeometry {
  return cachedGeo('hp-people-phone', () => {
    const b = inked();
    b.box(0.07, 0.012, 0.13, 0x2a2d36, { at: [-0.02, 0.012, 0.05], rot: [-0.25, 0, 0] });
    b.box(0.06, 0.004, 0.11, 0x8fb8cf, { at: [-0.02, 0.0195, 0.049], rot: [-0.25, 0, 0], ink: false, glow: 0x8fb8cf });
    return b.build();
  });
}
