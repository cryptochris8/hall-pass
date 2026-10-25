// ─────────────────────────────────────────────────────────────────────────────
// Static hair (build time), adapted from Bad Hair Day's own-hair styles
// (src/family/hairdo.ts): no brushable rig. Every style is part of the person's
// single skinned geometry: crown pieces ride the hairTop bone (rigid with the
// head), long pieces (ponytail, long, braids) are blended down the hair chains
// so they sway a little with the head (rig.ts → updateHair).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { type GeoBuilder, mixHex, shadeHex } from '../render/models/builder';
import { alignY, eul, lockGeometry, sstep } from './geo';
import { B, dirOf, headSurface, type Rig, restPos } from './skeleton';
import type { SkinBuilder, SkinW, WeightFn } from './skin';
import type { BodySpec } from './spec';
import type { HairStyle } from './types';

/** How a style moves (rig.ts) and whether it hides the ears. */
export function hairTraits(style: HairStyle): { sim: 'none' | 'bounce' | 'long' | 'ponytail'; ears: boolean } {
  switch (style) {
    case 'long':
      return { sim: 'long', ears: false };
    case 'bob':
      return { sim: 'bounce', ears: false };
    case 'ponytail':
    case 'braids':
      return { sim: 'ponytail', ears: true };
    case 'afro':
    case 'curly':
      return { sim: 'bounce', ears: true };
    default:
      return { sim: 'none', ears: true };
  }
}

function headC(s: BodySpec): THREE.Vector3 {
  return new THREE.Vector3(0, s.neckY + s.headCY, s.headCZ);
}

/** Point on (or above) the head ellipsoid in head-centre space. */
function onHead(s: BodySpec, yaw: number, pitch: number, lift: number): THREE.Vector3 {
  const d = dirOf(yaw, pitch);
  const n = new THREE.Vector3(d[0] / s.headRx, d[1] / s.headRy, d[2] / s.headRz).normalize();
  return new THREE.Vector3(d[0] * s.headRx + n.x * lift, d[1] * s.headRy + n.y * lift, d[2] * s.headRz + n.z * lift);
}

export interface HairOpts {
  /** A cap sits on top (patroller): skip crown volume that would poke through. */
  capped: boolean;
  /** Extra clearance behind the back for long hair (hoods, backpacks). */
  backPad: number;
  seed: number;
}

export function buildHair(sb: SkinBuilder, s: BodySpec, rig: Rig, style: HairStyle, color: number, o: HairOpts): void {
  switch (style) {
    case 'short':
      shortHair(sb, s, color, o.seed, o.capped);
      return;
    case 'buzz':
      buzzHair(sb, s, color);
      return;
    case 'curly':
      curlyHair(sb, s, color, o.seed, false);
      return;
    case 'afro':
      curlyHair(sb, s, color, o.seed, true);
      return;
    case 'ponytail':
      ponytailHair(sb, s, rig, color, o.capped);
      return;
    case 'bun':
      bunHair(sb, s, color, o.capped);
      return;
    case 'long':
      longHair(sb, s, rig, color, o.backPad);
      return;
    case 'bob':
      bobHair(sb, s, color);
      return;
    case 'braids':
      braidHair(sb, s, rig, color, o.backPad);
      return;
  }
}

/** Head centre relative to the hairTop bone. */
const topC = (s: BodySpec): [number, number, number] => [0, -s.headRy * 0.35, 0];

function shell(b: GeoBuilder, s: BodySpec, C: readonly [number, number, number], color: number, thetaMax: number, tilt: number, k = 1.06, seg = 14): void {
  b.add(new THREE.SphereGeometry(1, seg, 7, 0, Math.PI * 2, 0, thetaMax), color, { at: [C[0], C[1], C[2]], rot: [tilt, 0, 0], scale: [s.headRx * k, s.headRy * k, s.headRz * (k + 0.01)], smooth: true });
}

/** Flattened lobe of hair lying on the scalp (long axis along the sweep direction). */
function lobe(b: GeoBuilder, s: BodySpec, C: readonly [number, number, number], yaw: number, pitch: number, dYaw: number, dPitch: number, len: number, wid: number, thick: number, lift: number, color: number, seed: number, ink = true): void {
  const p0 = onHead(s, yaw, pitch, lift);
  const p1 = onHead(s, yaw + dYaw * 0.3, pitch + dPitch * 0.3, lift);
  const n = new THREE.Vector3((Math.sin(yaw) * Math.cos(pitch)) / s.headRx, Math.sin(pitch) / s.headRy, (Math.cos(yaw) * Math.cos(pitch)) / s.headRz).normalize();
  const t = p1.sub(p0).addScaledVector(n, -p1.dot(n)).normalize();
  const side = new THREE.Vector3().crossVectors(n, t).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, n, t));
  b.sphere(1, 7, 5, color, { at: [p0.x + C[0], p0.y + C[1], p0.z + C[2]], rot: eul(q), scale: [wid, thick, len], smooth: true, jitter: 0.0015, seed, ink });
}

function sideburns(b: GeoBuilder, s: BodySpec, C: readonly [number, number, number], color: number): void {
  for (const sd of [-1, 1] as const) {
    const p = onHead(s, sd * 1.32, 0.02, 0.004);
    b.sphere(s.headRx * 0.2, 6, 3, color, { at: [p.x + C[0], p.y + C[1], p.z + C[2]], rot: eul(headSurface(s, sd * 1.32, 0.02).quat), scale: [0.9, 1.5, 0.3], smooth: true, ink: false });
  }
}

function shortHair(sb: SkinBuilder, s: BodySpec, color: number, seed: number, capped: boolean): void {
  const b = sb.on(B.hairTop);
  const C = topC(s);
  const light = mixHex(color, 0xffffff, 0.08);
  shell(b, s, C, color, 1.4, -0.52, 1.05);
  sideburns(b, s, C, shadeHex(color, 0.88));
  if (capped) return;
  // Tousled cut: soft lobes lying on the scalp, a fringe swept to one side (seeded), crown flicks.
  const flip = seed % 2 === 0 ? 1 : -1;
  const L: [number, number, number, number, number, number, number, number][] = [
    [-0.62, 0.78, 0.6, 0.1, 0.075, 0.05, 0.022, 0.018],
    [-0.3, 0.86, 0.7, -0.05, 0.085, 0.056, 0.026, 0.02],
    [0.05, 0.9, 0.75, -0.12, 0.085, 0.056, 0.026, 0.022],
    [0.42, 0.82, 0.6, -0.25, 0.075, 0.05, 0.024, 0.02],
    [0.78, 0.66, 0.3, -0.35, 0.06, 0.042, 0.02, 0.016],
    [-0.15, 1.14, 0.4, -0.6, 0.08, 0.06, 0.022, 0.016],
    [0.35, 1.16, 0.5, -0.5, 0.075, 0.055, 0.022, 0.016],
  ];
  L.forEach(([yaw, pitch, dy, dp, len, wid, th, lift], i) => lobe(b, s, C, yaw * flip, pitch, dy * flip, dp, len, wid, th, lift, i === 2 || i === 6 ? light : color, 20 + i + seed * 7));
}

function buzzHair(sb: SkinBuilder, s: BodySpec, color: number): void {
  const b = sb.on(B.hairTop);
  const C = topC(s);
  shell(b, s, C, mixHex(color, 0xd8b896, 0.12), 1.42, -0.5, 1.022, 14);
}

function curlyHair(sb: SkinBuilder, s: BodySpec, color: number, seed: number, afro: boolean): void {
  const b = sb.on(B.hairTop);
  const C = topC(s);
  const light = mixHex(color, 0xffffff, 0.1);
  const dark = shadeHex(color, 0.86);
  if (afro) {
    // A big round crown (soft, slightly lumpy), set back so the face stays clear.
    b.sphere(1, 10, 7, color, { at: [C[0], C[1] + s.headRy * 0.32, C[2] - s.headRz * 0.12], scale: [s.headRx * 1.42, s.headRy * 1.22, s.headRz * 1.36], smooth: true, jitter: 0.006, seed: 31 + seed });
    shell(b, s, C, dark, 1.55, -0.62, 1.05, 10);
    for (let i = 0; i < 7; i++) {
      const yaw = -1.1 + (i / 6) * 2.2;
      const p = onHead(s, yaw, 0.98 + 0.05 * Math.sin(i * 2.1), s.headRx * 0.36);
      b.sphere(s.headRx * 0.34, 5, 3, i % 2 ? light : color, { at: [p.x + C[0], p.y + C[1] + 0.012, p.z + C[2] - 0.02], smooth: true, jitter: 0.004, seed: 40 + i });
    }
    return;
  }
  // Curly: close crown + a ring of small curls around the hairline and crown.
  shell(b, s, C, dark, 1.5, -0.5, 1.06, 12);
  const curls: [number, number, number][] = [];
  for (let i = 0; i < 7; i++) curls.push([-1.3 + (i / 6) * 2.6, 0.64 + 0.16 * Math.cos(i * 1.7), 0.026]);
  for (let i = 0; i < 5; i++) curls.push([Math.PI + -1.2 + (i / 4) * 2.4, 0.5, 0.03]);
  for (let i = 0; i < 3; i++) curls.push([-0.7 + i * 0.7, 1.18, 0.03]);
  curls.forEach(([yaw, pitch, lift], i) => {
    const p = onHead(s, yaw, pitch, lift);
    b.sphere(s.headRx * (0.22 + 0.04 * ((i + seed) % 3)), 6, 4, i % 3 === 0 ? light : color, { at: [p.x + C[0], p.y + C[1], p.z + C[2]], smooth: true, jitter: 0.003, seed: 50 + i });
  });
}

function bunHair(sb: SkinBuilder, s: BodySpec, color: number, capped: boolean): void {
  const b = sb.on(B.hairTop);
  const C = topC(s);
  shell(b, s, C, color, 1.6, -0.35, 1.06, 14);
  if (!capped) {
    const top = onHead(s, Math.PI, 1.15, 0.05);
    b.sphere(s.headRx * 0.42, 10, 7, color, { at: [top.x, top.y + C[1], top.z], smooth: true, jitter: 0.003, seed: 3 });
    b.torus(s.headRx * 0.3, 0.012, 3, 10, shadeHex(color, 0.7), { at: [top.x, top.y + C[1] - s.headRx * 0.3, top.z + 0.02], rot: [Math.PI / 2 + 0.5, 0, 0], ink: false });
  }
  const f = onHead(s, 0.25, 0.9, 0.02);
  b.sphere(s.headRx * 0.5, 9, 6, color, { at: [f.x, f.y + C[1], f.z], rot: [0.3, 0, -0.5], scale: [1.3, 0.5, 0.8], smooth: true });
}

/** Weights down a hair chain by model height: head → c0 → c1 → c2 (side = use side chains by x sign). */
function chainWeights(yHead: number, y0: number, y1: number, y2: number, side: boolean): WeightFn {
  return (x, y, _z, o: SkinW) => {
    const w0 = sstep(yHead, y0, y);
    const w1 = sstep(y0 - 0.02, y1, y);
    const w2 = sstep(y1 - 0.02, y2, y);
    const c0 = side ? (x >= 0 ? B.hairSideL0 : B.hairSideR0) : B.hairBack0;
    const c1 = side ? (x >= 0 ? B.hairSideL1 : B.hairSideR1) : B.hairBack1;
    const c2 = side ? c1 : B.hairBack2;
    o.i[0] = B.head;
    o.w[0] = 1 - w0;
    o.i[1] = c0;
    o.w[1] = w0 - w1;
    o.i[2] = c1;
    o.w[2] = w1 - (side ? 0 : w2);
    o.i[3] = c2;
    o.w[3] = side ? 0 : w2;
  };
}

function ponytailHair(sb: SkinBuilder, s: BodySpec, rig: Rig, color: number, capped: boolean): void {
  const b = sb.on(B.hairTop);
  const C = topC(s);
  shell(b, s, C, color, 1.58, -0.38, 1.06, 14);
  if (!capped) {
    const f = onHead(s, -0.2, 0.85, 0.018);
    b.sphere(s.headRx * 0.55, 9, 6, color, { at: [f.x, f.y + C[1], f.z], rot: [0.4, 0, 0.35], scale: [1.3, 0.45, 0.8], smooth: true });
  }
  const hc = headC(s);
  const b0 = restPos(rig, B.hairBack0);
  const b1 = restPos(rig, B.hairBack1);
  const p = sb.blend(B.base, chainWeights(hc.y + s.headRy * 0.1, b0.y - 0.02, b1.y, b1.y - 0.2, false));
  const root = onHead(s, Math.PI, 0.3, 0.02).add(hc);
  p.torus(0.028, 0.012, 5, 10, shadeHex(color, 0.65), { at: [root.x, root.y, root.z - 0.01], rot: [0.5, 0, 0], ink: false });
  const v = (x: number, y: number, z: number) => root.clone().add(new THREE.Vector3(x, y, z));
  const pts = [root, v(0, -0.05, -0.06), v(0, -0.15, -0.085), v(0, -0.26, -0.07), v(0, -0.34, -0.05)];
  const outs = pts.map(() => new THREE.Vector3(0, 0.2, -1).normalize());
  p.add(lockGeometry(pts, [0.032, 0.046, 0.044, 0.03, 0.012], [0.03, 0.038, 0.036, 0.026, 0.01], outs, 6), color, { smooth: true });
}

function longHair(sb: SkinBuilder, s: BodySpec, rig: Rig, color: number, backPad: number): void {
  const hc = headC(s);
  const root = shadeHex(color, 0.9);
  const light = mixHex(color, 0xffe2c0, 0.14);
  // Scalp cap (rigid on the head) with a centre-ish part + volume at the back.
  const cap = sb.on(B.head);
  const C: [number, number, number] = [0, s.headCY, s.headCZ];
  cap.add(new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, 1.8), color, { at: C, rot: [-0.66, 0, 0], scale: [s.headRx * 1.075, s.headRy * 1.07, s.headRz * 1.1], smooth: true });
  cap.sphere(1, 8, 5, root, { at: [0, C[1] - s.headRy * 0.2, C[2] - s.headRz * 0.35], scale: [s.headRx * 1.02, s.headRy * 0.95, s.headRz * 0.78], smooth: true, ink: false });

  const b1 = restPos(rig, B.hairBack1);
  const b2 = restPos(rig, B.hairBack2);
  const back = sb.blend(B.base, chainWeights(hc.y + s.headRy * 0.35, hc.y - s.headRy * 0.35, b1.y - 0.05, b2.y - 0.06, false));
  const side = sb.blend(B.base, chainWeights(hc.y + s.headRy * 0.2, hc.y - s.headRy * 0.4, hc.y - s.headRy * 1.1, hc.y - s.headRy * 1.2, true));
  const tipY = s.shoulderY - 0.2 - hc.y;
  const torsoBack = (x: number): number => {
    const w = s.torsoW * 1.04;
    const k = Math.max(0, 1 - (x / w) * (x / w));
    return -(s.torsoD * Math.sqrt(k)) - hc.z - 0.03 - backPad;
  };
  const shoulderTop = s.shoulderY + s.armR * 0.9 - hc.y;
  const backYaws = [-0.95, -0.48, 0, 0.48, 0.95, -1.32, 1.32];
  backYaws.forEach((a, i) => {
    const yaw = Math.PI + a;
    const lift = 0.02 + (Math.abs(a) > 1.1 ? 0.012 : 0);
    const pts = [onHead(s, yaw, 0.75, lift * 0.6), onHead(s, yaw, 0.25, lift), onHead(s, yaw, -0.25, lift * 1.25), onHead(s, yaw, -0.62, lift * 1.2)];
    const p3 = pts[3]!;
    const len = p3.y - tipY;
    const n = 5;
    const outward = Math.sign(p3.x || 1) * Math.min(0.02, Math.abs(p3.x) * 0.12);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const y = p3.y - len * t;
      const wave = Math.sin(t * Math.PI * 2 + i * 1.3) * 0.01;
      const x = p3.x + outward * t + wave * (Math.abs(a) > 0.5 ? Math.sign(a) : 1);
      let z = Math.min(p3.z, torsoBack(x) - 0.005);
      if (y > shoulderTop) z = Math.min(z, p3.z);
      pts.push(new THREE.Vector3(x, y, z));
    }
    const wv: number[] = [];
    const tv: number[] = [];
    const outs: THREE.Vector3[] = [];
    for (let k = 0; k < pts.length; k++) {
      const t = k / (pts.length - 1);
      wv.push((Math.abs(a) > 1.1 ? 0.04 : 0.05) * (1 - t * 0.5) + (k === 0 ? -0.012 : 0));
      tv.push(0.017 * (1 - t * 0.5));
      const p = pts[k]!;
      outs.push(new THREE.Vector3(p.x * 0.6, k < 4 ? p.y * 0.3 : 0, Math.min(-0.3, p.z)).normalize());
    }
    back.add(lockGeometry(pts.map((p) => p.clone().add(hc)), wv, tv, outs, 5), i % 3 === 1 ? light : i % 3 === 2 ? root : color, { smooth: true });
  });
  // Framing locks on both sides of the face, from the part down past the temples to the jaw.
  for (const sd of [-1, 1] as const) {
    const path: [number, number, number][] = [
      [sd * 0.18, 1.2, 0.012],
      [sd * 0.62, 0.95, 0.024],
      [sd * 1.08, 0.5, 0.03],
      [sd * 1.28, -0.05, 0.032],
      [sd * 1.3, -0.55, 0.03],
      [sd * 1.36, -0.95, 0.026],
    ];
    const pts = path.map(([y, p, l]) => onHead(s, y, p, l));
    const outs = path.map(([y, p]) => new THREE.Vector3(...dirOf(y, p)));
    side.add(lockGeometry(pts.map((p) => p.clone().add(hc)), [0.03, 0.044, 0.044, 0.04, 0.034, 0.016], [0.012, 0.016, 0.016, 0.015, 0.013, 0.008], outs, 5), sd > 0 ? color : light, { smooth: true });
  }
}

function bobHair(sb: SkinBuilder, s: BodySpec, color: number): void {
  const b = sb.on(B.hairTop);
  const C = topC(s);
  const light = mixHex(color, 0xffffff, 0.08);
  // Chin-length rounded shell, open at the face; a soft fringe across the forehead.
  const open = 0.95;
  b.add(new THREE.SphereGeometry(1, 16, 8, Math.PI / 2 + open, Math.PI * 2 - open * 2, 0, 2.2), color, {
    at: [C[0], C[1] + 0.004, C[2] - 0.006],
    scale: [s.headRx * 1.13, s.headRy * 1.1, s.headRz * 1.12],
    smooth: true,
  });
  shell(b, s, C, shadeHex(color, 0.92), 1.35, -0.45, 1.06, 14);
  for (let i = 0; i < 4; i++) {
    const yaw = -0.6 + i * 0.4;
    lobe(b, s, C, yaw, 0.72, 0.05, -0.6, 0.07, 0.07, 0.02, 0.022, i % 2 ? light : color, 70 + i);
  }
  // Rolled-under hem.
  for (const sd of [-1, 1] as const) {
    const p = onHead(s, sd * 1.25, -0.82, s.headRx * 0.14);
    b.sphere(s.headRx * 0.2, 7, 4, color, { at: [p.x + C[0], p.y + C[1], p.z + C[2]], scale: [1, 0.7, 1.5], smooth: true, ink: false });
  }
}

function braidHair(sb: SkinBuilder, s: BodySpec, rig: Rig, color: number, backPad: number): void {
  const b = sb.on(B.hairTop);
  const C = topC(s);
  const light = mixHex(color, 0xffffff, 0.08);
  shell(b, s, C, color, 1.6, -0.36, 1.055, 14);
  // Centre part line.
  const pa = onHead(s, 0, 1.25, s.headRx * 0.06);
  const pb = onHead(s, 0, 0.8, s.headRx * 0.06);
  const d = new THREE.Vector3().subVectors(pb, pa);
  b.box(0.006, d.length(), 0.004, shadeHex(color, 0.55), { at: [(pa.x + pb.x) / 2 + C[0], (pa.y + pb.y) / 2 + C[1], (pa.z + pb.z) / 2 + C[2]], rot: alignY(d), ink: false });
  // Two plaits behind the ears, falling behind the shoulders (beads of hair → reads as a braid).
  const hc = headC(s);
  const b0 = restPos(rig, B.hairBack0);
  const b1 = restPos(rig, B.hairBack1);
  const p = sb.blend(B.base, chainWeights(hc.y - s.headRy * 0.2, b0.y - 0.1, b1.y - 0.05, b1.y - 0.25, false));
  for (const sd of [-1, 1] as const) {
    const start = onHead(s, sd * 2.3, -0.2, 0.02).add(hc);
    const n = 7;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const x = start.x + sd * 0.01 * t;
      const y = start.y - 0.03 - t * 0.3;
      const z = Math.min(start.z - 0.01, -s.torsoD - 0.035 - backPad) - 0.01 * Math.sin(t * 3);
      const r = 0.03 * (1 - t * 0.35);
      p.sphere(r, 6, 4, k % 2 ? light : color, { at: [x, y, z], scale: [1, 0.85, 0.9], rot: [0, 0, sd * (k % 2 ? 0.4 : -0.4)], smooth: true });
    }
    p.torus(0.016, 0.007, 3, 8, shadeHex(color, 0.55), { at: [start.x + sd * 0.01, start.y - 0.36, Math.min(start.z - 0.01, -s.torsoD - 0.035 - backPad)], rot: [Math.PI / 2, 0, 0], ink: false });
  }
}
