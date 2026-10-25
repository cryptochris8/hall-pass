// ─────────────────────────────────────────────────────────────────────────────
// Body + clothing building blocks (build time). Continuous garments (torsos,
// sleeves, trouser legs, skirts) are blended across joints so they bend softly;
// hands, feet/shoes and trims are rigid on their bones.
// Blended parts are authored in MODEL space on the base bone (identity rest).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PEOPLE as PAL } from './palette';
import { type GeoBuilder, shadeHex } from '../render/models/builder';
import { alignY, alignZ, openEdge, ringTube, sstep, starPoints, tubePoint, type Ring } from './geo';
import { B } from './skeleton';
import type { SkinBuilder, SkinW, WeightFn } from './skin';
import type { BodySpec } from './spec';

export interface BodyCtx {
  sb: SkinBuilder;
  s: BodySpec;
  skin: number;
  low: boolean;
}

export const hipJ = (s: BodySpec): number => s.thighL + s.shinL + s.ankleY;
export const kneeY = (s: BodySpec): number => s.shinL + s.ankleY;
export const elbowY = (s: BodySpec): number => s.shoulderY - s.upperArmL;
export const wristY = (s: BodySpec): number => s.shoulderY - s.upperArmL - s.foreArmL;
export const neckR = (s: BodySpec): number => s.headRx * (s.kid ? 0.3 : 0.32);

// ── weights ──────────────────────────────────────────────────────────────────

export function torsoWeights(s: BodySpec): WeightFn {
  const d = s.kid ? 0.05 : 0.07;
  return (_x, y, _z, o) => {
    const ws = sstep(s.spineY - d, s.spineY + d, y);
    const wc = sstep(s.chestY - d, s.chestY + d, y);
    set3(o, B.hips, 1 - ws, B.spine, ws - wc, B.chest, wc);
  };
}

export function legWeights(s: BodySpec, sd: 1 | -1): WeightFn {
  const th = sd > 0 ? B.thighL : B.thighR;
  const sh = sd > 0 ? B.shinL : B.shinR;
  const kY = kneeY(s);
  const hj = hipJ(s);
  const d = s.legR * 0.95;
  return (_x, y, _z, o) => {
    const tS = sstep(kY + d, kY - d, y);
    const tH = sstep(hj - s.legR * 0.1, hj + s.legR * 0.7, y) * 0.75;
    set3(o, B.hips, tH, th, (1 - tH) * (1 - tS), sh, (1 - tH) * tS);
  };
}

export function armWeights(s: BodySpec, sd: 1 | -1): WeightFn {
  const up = sd > 0 ? B.upperArmL : B.upperArmR;
  const fo = sd > 0 ? B.foreArmL : B.foreArmR;
  const eY = elbowY(s);
  const d = s.armR * 0.9;
  return (_x, y, _z, o) => {
    const t = sstep(eY + d, eY - d, y);
    set3(o, up, 1 - t, fo, t, B.chest, 0);
  };
}

/** Skirts / robes / dresses: attached to the hips at the top, following both thighs toward the hem. */
export function skirtWeights(s: BodySpec, topY: number, hemY: number, follow = 0.85): WeightFn {
  return (x, y, _z, o) => {
    const t = sstep(topY, hemY, y) * follow;
    const kL = sstep(-s.hipX * 0.9, s.hipX * 0.9, x);
    o.i[0] = B.hips;
    o.w[0] = 1 - t;
    o.i[1] = B.thighL;
    o.w[1] = t * kL;
    o.i[2] = B.thighR;
    o.w[2] = t * (1 - kL);
    o.i[3] = 0;
    o.w[3] = 0;
  };
}

function set3(o: SkinW, a: number, wa: number, b: number, wb: number, c: number, wc: number): void {
  o.i[0] = a;
  o.w[0] = wa;
  o.i[1] = b;
  o.w[1] = wb;
  o.i[2] = c;
  o.w[2] = wc;
  o.i[3] = 0;
  o.w[3] = 0;
}

// ── torso ─────────────────────────────────────────────────────────────────────

export interface TorsoShape {
  /** Bottom (hem) height; defaults to the crotch (full torso). */
  hemY?: number;
  /** Top closes into the neckline (true) or stops at the chest (false = a bib/cropped piece). */
  loose?: number;
  /** Hem flare (relative). */
  flare?: number;
}

/** Torso profile rings from the crotch to the neckline (model space). */
export function torsoRings(s: BodySpec, loose = 1, hemY?: number, flare = 0): Ring[] {
  const hj = hipJ(s);
  const nr = neckR(s);
  const belly = s.kid ? 0.012 : 0;
  const L = loose;
  const all: Ring[] = [
    { y: hj - s.legR * 0.6, w: s.hipW * 0.5 * L, d: s.hipD * 0.5 * L, z: -0.004 },
    { y: hj - s.legR * 0.15, w: s.hipW * 0.94 * L, d: s.hipD * 0.95 * L, z: -0.006 },
    { y: hj + s.legR * 0.6, w: s.hipW * L, d: s.hipD * L, z: -0.002 },
    { y: s.spineY, w: s.waistW * L, d: s.waistD * L, z: belly },
    { y: s.chestY, w: s.torsoW * 0.98 * L, d: s.torsoD * L, z: belly * 0.5 },
    { y: s.shoulderY - s.armR * 0.45, w: s.torsoW * L, d: s.torsoD * 0.95 * L },
    { y: s.shoulderY + s.armR * 0.5, w: s.torsoW * 0.78 * L, d: s.torsoD * 0.8 * L },
    { y: s.shoulderY + s.armR * 0.95, w: nr * 1.55, d: nr * 1.45 },
    { y: s.shoulderY + s.armR * 1.1, w: nr * 1.12, d: nr * 1.06 },
  ];
  if (hemY === undefined) return all;
  // Start at the hem: interpolate a ring there, keep the ones above; flare the hem outward.
  const out: Ring[] = [];
  const above = all.filter((r) => r.y > hemY + 0.005);
  const lower = [...all].reverse().find((r) => r.y <= hemY) ?? all[0]!;
  const upper = above[0] ?? all[all.length - 1]!;
  const t = upper.y === lower.y ? 0 : (hemY - lower.y) / (upper.y - lower.y);
  const hw = (lower.w + (upper.w - lower.w) * t) * (1 + flare);
  const hd = (lower.d + (upper.d - lower.d) * t) * (1 + flare);
  out.push({ y: hemY, w: hw, d: hd, z: (lower.z ?? 0) + ((upper.z ?? 0) - (lower.z ?? 0)) * t });
  out.push(...above);
  return out;
}

export function torsoTube(ctx: BodyCtx, rings: Ring[], color: number, o: { closeBottom?: boolean; phi0?: number; phiLen?: number } = {}): GeoBuilder {
  const b = ctx.sb.blend(B.base, torsoWeights(ctx.s));
  b.add(ringTube(rings, ctx.low ? 9 : 12, { closeBottom: o.closeBottom, closeTop: false, phi0: o.phi0, phiLen: o.phiLen }), color, { smooth: true });
  return b;
}

/** A band (ribbing / hem / stripe) hugging a ring tube between y0 and y1. */
export function band(b: GeoBuilder, rings: Ring[], y0: number, y1: number, color: number, lift: number, seg: number, ink = false, phi0?: number, phiLen?: number): void {
  const rs: Ring[] = [];
  for (const y of [y0, y1]) {
    const p = tubeRing(rings, y);
    rs.push({ y, w: p.w + lift, d: p.d + lift, z: p.z, x: p.x, open: p.open > 0 ? p.open : undefined });
  }
  b.add(ringTube(rs, seg, { phi0, phiLen }), color, { smooth: true, ink });
}

function tubeRing(rings: Ring[], y: number): Required<Ring> {
  let i = 0;
  while (i < rings.length - 2 && y > rings[i + 1]!.y) i++;
  const r0 = rings[i]!;
  const r1 = rings[Math.min(i + 1, rings.length - 1)]!;
  const t = r1.y === r0.y ? 0 : Math.max(0, Math.min(1, (y - r0.y) / (r1.y - r0.y)));
  return { y, w: r0.w + (r1.w - r0.w) * t, d: r0.d + (r1.d - r0.d) * t, z: (r0.z ?? 0) + ((r1.z ?? 0) - (r0.z ?? 0)) * t, x: (r0.x ?? 0) + ((r1.x ?? 0) - (r0.x ?? 0)) * t, open: (r0.open ?? 0) + ((r1.open ?? 0) - (r0.open ?? 0)) * t };
}

// ── prints ────────────────────────────────────────────────────────────────────

/** Polka dots / stars scattered over a ring tube (deterministic lattice with jitter). */
export function print(
  b: GeoBuilder,
  rings: Ring[],
  kind: 'dot' | 'star',
  color: number,
  size: number,
  y0: number,
  y1: number,
  rows: number,
  perRow: number,
  seed = 1,
  phiRange: [number, number] = [0, Math.PI * 2],
): void {
  for (let r = 0; r < rows; r++) {
    const y = y0 + ((r + 0.5) / rows) * (y1 - y0);
    for (let k = 0; k < perRow; k++) {
      const jitter = Math.sin((r + 1) * 12.9898 + (k + 1) * 78.233 + seed) * 0.5;
      const phi = phiRange[0] + ((k + (r % 2) * 0.5 + jitter * 0.3) / perRow) * (phiRange[1] - phiRange[0]);
      const p = tubePoint(rings, phi, y, 0.002);
      const n = new THREE.Vector3(...p.n);
      if (kind === 'dot') {
        b.add(new THREE.CircleGeometry(size, 5), color, { at: p.pos, rot: alignZ(n), ink: false });
      } else {
        b.add(new THREE.ShapeGeometry(new THREE.Shape(starPoints(size, size * 0.45).map(([x, y]) => new THREE.Vector2(x, y))), 1), color, { at: p.pos, rot: alignZ(n, jitter), ink: false });
      }
    }
  }
}

/** Horizontal stripes over a ring tube. */
export function stripes(b: GeoBuilder, rings: Ring[], color: number, y0: number, y1: number, count: number, thick: number, seg: number): void {
  for (let i = 0; i < count; i++) {
    const y = y0 + ((i + 0.5) / count) * (y1 - y0);
    band(b, rings, y - thick / 2, y + thick / 2, color, 0.0025, seg);
  }
}

// ── legs ──────────────────────────────────────────────────────────────────────

export interface LegStyle {
  color: number;
  /** Width multiplier (loose PJs 1.15, jeans 1.02, leggings 0.92). */
  width: number;
  /** Where the garment ends (model y); below it the leg is bare skin (or `below`). */
  hemY?: number;
  /** Colour below the hem (skin / socks / tights). */
  below?: number;
  /** Elastic cuff colour at the ankle (joggers) or null. */
  cuff?: number | null;
  /** Hem band colour at the hem (shorts turn-ups) or null. */
  hemBand?: number | null;
  /** Print on the legs. */
  print?: { kind: 'dot' | 'star'; color: number; size: number; rows: number; perRow: number } | null;
  stripes?: { color: number; count: number } | null;
}

export function legRings(s: BodySpec, sd: 1 | -1, wmul: number, fromY: number, toY: number, gather = 1): Ring[] {
  const hj = hipJ(s);
  const kY = kneeY(s);
  const r = s.legR;
  const x = sd * s.hipX;
  const prof: [number, number][] = [
    [hj + r * 0.75, 1.02],
    [hj, 1.05],
    [hj - s.thighL * 0.45, 0.97],
    [kY + r * 0.8, 0.86],
    [kY, 0.82],
    [kY - r * 0.8, 0.8],
    [kY - s.shinL * 0.35, 0.83],
    [s.ankleY + 0.035, 0.66 * gather],
    [s.ankleY - 0.012, 0.6 * gather],
  ];
  const rings: Ring[] = [];
  for (const [y, k] of prof) {
    if (y > fromY + 1e-4 || y < toY - 1e-4) continue;
    rings.push({ y, w: r * k * wmul, d: r * k * wmul * 0.98, x, z: 0 });
  }
  const at = (y: number): Ring => {
    // Interpolate the multiplier at y.
    for (let i = 0; i < prof.length - 1; i++) {
      const [y0, k0] = prof[i]!;
      const [y1, k1] = prof[i + 1]!;
      if (y <= y0 && y >= y1) {
        const t = (y0 - y) / (y0 - y1);
        const k = k0 + (k1 - k0) * t;
        return { y, w: r * k * wmul, d: r * k * wmul * 0.98, x, z: 0 };
      }
    }
    return { y, w: r * wmul, d: r * wmul, x, z: 0 };
  };
  if (!rings.length || rings[0]!.y < fromY - 1e-4) rings.unshift(at(fromY));
  if (rings[rings.length - 1]!.y > toY + 1e-4) rings.push(at(toY));
  return rings.reverse(); // bottom → top
}

export function legs(ctx: BodyCtx, st: LegStyle): void {
  const s = ctx.s;
  const hj = hipJ(s);
  const seg = ctx.low ? 7 : 8;
  for (const sd of [1, -1] as const) {
    const b = ctx.sb.blend(B.base, legWeights(s, sd));
    const top = hj + s.legR * 0.75;
    const bottom = s.ankleY - 0.012;
    const hem = st.hemY ?? bottom;
    const gather = st.cuff ? 0.82 : 1;
    const garment = legRings(s, sd, st.width, top, Math.max(hem, bottom), gather);
    b.add(ringTube(garment, seg), st.color, { smooth: true });
    if (st.hemY !== undefined && st.hemY > bottom + 0.01) {
      const bare = legRings(s, sd, 0.84, st.hemY + 0.02, bottom);
      b.add(ringTube(bare, seg), st.below ?? ctx.skin, { smooth: true });
      if (st.hemBand) band(b, garment, st.hemY, st.hemY + 0.03, st.hemBand, 0.004, seg, true);
    }
    if (st.cuff) band(b, garment, bottom + 0.005, s.ankleY + 0.04, st.cuff, 0.006, seg, true);
    if (st.print) print(b, garment, st.print.kind, st.print.color, st.print.size, Math.max(hem, bottom) + 0.05, top - s.legR * 0.8, st.print.rows, st.print.perRow, sd > 0 ? 3 : 7);
    if (st.stripes) stripes(b, garment, st.stripes.color, Math.max(hem, bottom) + 0.04, hj - 0.02, st.stripes.count, s.legR * 0.22, seg);
  }
}

// ── arms + hands ─────────────────────────────────────────────────────────────

export interface ArmStyle {
  color: number;
  width: number;
  /** Sleeve end: 'wrist' (long), 'elbow' (3/4), 'short' (tee), 'none' (sleeveless). */
  length: 'wrist' | 'elbow' | 'short' | 'none';
  /** Bare-arm colour below the sleeve. */
  below?: number;
  cuff?: number | null;
  /** Sleeve flare at the end (robes). */
  flare?: number;
  shoulderBall?: boolean;
  print?: { kind: 'dot' | 'star'; color: number; size: number; rows: number; perRow: number } | null;
  stripes?: { color: number; count: number } | null;
}

export function armRings(s: BodySpec, sd: 1 | -1, wmul: number, fromY: number, toY: number, flare = 0): Ring[] {
  const eY = elbowY(s);
  const wY = wristY(s);
  const r = s.armR;
  const x = sd * s.shoulderX;
  const prof: [number, number][] = [
    [s.shoulderY + r * 0.3, 0.95],
    [s.shoulderY - r * 0.6, 1.02],
    [eY + r * 1.1, 0.94],
    [eY, 0.9],
    [eY - r * 1.1, 0.87],
    [wY + 0.03, 0.8],
    [wY - 0.005, 0.78],
  ];
  const kAt = (y: number): number => {
    for (let i = 0; i < prof.length - 1; i++) {
      const [y0, k0] = prof[i]!;
      const [y1, k1] = prof[i + 1]!;
      if (y <= y0 && y >= y1) return k0 + (k1 - k0) * ((y0 - y) / (y0 - y1));
    }
    return prof[prof.length - 1]![1];
  };
  const ys = [fromY, ...prof.map((p) => p[0]).filter((y) => y < fromY - 1e-4 && y > toY + 1e-4), toY];
  const rings = ys.map((y) => {
    const fl = flare > 0 ? 1 + flare * sstep(eY, toY, y) : 1;
    const k = kAt(y) * wmul * fl;
    return { y, w: r * k, d: r * k, x, z: 0 } as Ring;
  });
  return rings.reverse();
}

export function arms(ctx: BodyCtx, st: ArmStyle): void {
  const s = ctx.s;
  const seg = ctx.low ? 6 : 7;
  const top = s.shoulderY + s.armR * 0.3;
  const wY = wristY(s);
  const end = st.length === 'wrist' ? wY - 0.005 : st.length === 'elbow' ? elbowY(s) - s.armR * 1.4 : st.length === 'short' ? s.shoulderY - s.upperArmL * 0.5 : s.shoulderY - s.armR * 0.2;
  for (const sd of [1, -1] as const) {
    const b = ctx.sb.blend(B.base, armWeights(s, sd));
    if (st.length !== 'none') {
      const sleeve = armRings(s, sd, st.width, top, end, st.flare ?? 0);
      b.add(ringTube(sleeve, seg), st.color, { smooth: true });
      if (st.cuff) band(b, sleeve, end, end + 0.028, st.cuff, 0.004, seg, true);
      if (st.print) print(b, sleeve, st.print.kind, st.print.color, st.print.size, end + 0.03, top - 0.03, st.print.rows, st.print.perRow, sd > 0 ? 5 : 9);
      if (st.stripes) stripes(b, sleeve, st.stripes.color, end + 0.03, top - 0.02, st.stripes.count, s.armR * 0.3, seg);
    }
    if (st.length !== 'wrist') {
      const bare = armRings(s, sd, 0.86, end + 0.02, wY - 0.005);
      b.add(ringTube(bare, seg), st.below ?? ctx.skin, { smooth: true });
    }
    // Shoulder ball (rigid on the upper arm) hides the sleeve/torso seam.
    if (st.shoulderBall !== false) {
      const up = ctx.sb.on(sd > 0 ? B.upperArmL : B.upperArmR);
      const col = st.length === 'none' ? (st.below ?? ctx.skin) : st.color;
      up.sphere(s.armR * 1.12 * (st.length === 'none' ? 0.9 : st.width), ctx.low ? 7 : 8, 5, col, { at: [0, -s.armR * 0.15, 0], smooth: true });
    }
  }
}

export function hands(ctx: BodyCtx, color = ctx.skin): void {
  const s = ctx.s;
  const r = s.handR;
  for (const sd of [1, -1] as const) {
    const h = ctx.sb.on(sd > 0 ? B.handL : B.handR);
    h.sphere(r, 6, 4, color, { at: [0, -r * 0.82, 0], scale: [0.8, 1.05, 0.96], smooth: true });
    h.sphere(r * 0.42, 4, 3, color, { at: [0, -r * 0.42, r * 0.76], rot: [-0.55, 0, 0], scale: [0.85, 1.45, 0.85], smooth: true });
    // Pointing finger (bone-scaled; hidden unless pointing / shh).
    const f = ctx.sb.on(sd > 0 ? B.fingerL : B.fingerR);
    f.sphere(r * 0.24, 4, 3, color, { at: [0, -r * 0.42, 0], scale: [1, 2.1, 1], smooth: true, ink: false });
  }
}

// ── feet ──────────────────────────────────────────────────────────────────────

export type ShoeKind = 'sneaker' | 'slipper' | 'fuzzy' | 'flat' | 'sock' | 'boot' | 'shoe';

export interface ShoeStyle {
  kind: ShoeKind;
  color: number;
  accent: number;
}

export function feet(ctx: BodyCtx, st: ShoeStyle): void {
  const s = ctx.s;
  const A = s.ankleY;
  const L = s.footL;
  const W = s.footW;
  const zc = L * 0.24;
  for (const sd of [1, -1] as const) {
    const f = ctx.sb.on(sd > 0 ? B.footL : B.footR);
    switch (st.kind) {
      case 'sneaker': {
        f.sphere(1, 7, 3, PAL.sneakerSole, { at: [0, -A + A * 0.28, zc], scale: [W * 0.98, A * 0.36, L * 0.56], smooth: true });
        f.sphere(1, 7, 4, st.color, { at: [0, -A + A * 0.85, zc - L * 0.02], scale: [W * 0.9, A * 0.78, L * 0.5], smooth: true });
        f.sphere(1, 6, 3, PAL.sneakerSole, { at: [0, -A + A * 0.62, zc + L * 0.34], scale: [W * 0.84, A * 0.5, L * 0.22], smooth: true, ink: false });
        for (const e of [-1, 1]) f.sphere(1, 4, 2, st.accent, { at: [e * W * 0.86, -A + A * 0.95, zc - L * 0.04], rot: [0.3, 0, 0], scale: [W * 0.12, A * 0.26, L * 0.22], smooth: true, ink: false });
        f.box(W * 0.8, A * 0.16, A * 0.22, st.accent, { at: [0, -A + A * 1.4, zc + L * 0.12], rot: [-0.6, 0, 0], ink: false });
        f.cyl(W * 0.72, W * 0.82, A * 0.6, 6, st.color, { at: [0, -A + A * 1.5, zc - L * 0.22], smooth: true, ink: false });
        break;
      }
      case 'slipper': {
        f.sphere(1, 8, 4, shadeHex(st.color, 0.75), { at: [0, -A + A * 0.22, zc], scale: [W * 1.0, A * 0.28, L * 0.56], smooth: true });
        f.sphere(1, 9, 5, st.color, { at: [0, -A + A * 0.72, zc], scale: [W * 0.96, A * 0.72, L * 0.54], smooth: true });
        f.torus(W * 0.62, W * 0.2, 4, 10, st.accent, { at: [0, -A + A * 1.35, zc - L * 0.12], rot: [Math.PI / 2 - 0.25, 0, 0], scale: [1, 1.2, 1], smooth: true, jitter: 0.002, seed: 4 });
        break;
      }
      case 'fuzzy': {
        f.sphere(1, 9, 5, st.color, { at: [0, -A + A * 0.75, zc], scale: [W * 1.12, A * 0.85, L * 0.58], smooth: true, jitter: 0.003, seed: 6 });
        f.sphere(W * 0.42, 6, 4, st.accent, { at: [0, -A + A * 1.4, zc + L * 0.18], smooth: true, jitter: 0.003, seed: 8 });
        break;
      }
      case 'flat': {
        f.sphere(1, 7, 4, st.color, { at: [0, -A + A * 0.45, zc], scale: [W * 0.9, A * 0.5, L * 0.54], smooth: true });
        f.sphere(1, 6, 3, ctx.skin, { at: [0, -A + A * 0.85, zc - L * 0.05], scale: [W * 0.72, A * 0.55, L * 0.4], smooth: true, ink: false });
        f.sphere(W * 0.24, 5, 3, st.accent, { at: [0, -A + A * 0.95, zc + L * 0.3], scale: [1.6, 0.8, 0.8], ink: false });
        break;
      }
      case 'sock': {
        f.sphere(1, 9, 5, st.color, { at: [0, -A + A * 0.6, zc], scale: [W * 0.92, A * 0.62, L * 0.54], smooth: true });
        f.cyl(W * 0.7, W * 0.74, A * 0.9, 7, st.accent, { at: [0, -A + A * 1.3, zc - L * 0.2], smooth: true, ink: false });
        break;
      }
      case 'shoe': {
        // Dress shoe / loafer: dark sole, rounded upper, a little heel.
        f.sphere(1, 7, 3, shadeHex(st.color, 0.6), { at: [0, -A + A * 0.22, zc], scale: [W * 0.95, A * 0.26, L * 0.55], smooth: true });
        f.sphere(1, 7, 4, st.color, { at: [0, -A + A * 0.7, zc + L * 0.02], scale: [W * 0.88, A * 0.66, L * 0.5], smooth: true });
        f.cyl(W * 0.7, W * 0.78, A * 0.7, 7, st.color, { at: [0, -A + A * 1.25, zc - L * 0.22], smooth: true, ink: false });
        f.box(W * 0.5, A * 0.1, A * 0.3, st.accent, { at: [0, -A + A * 1.18, zc + L * 0.2], rot: [-0.45, 0, 0], ink: false });
        break;
      }
      case 'boot': {
        f.sphere(1, 7, 3, shadeHex(st.color, 0.6), { at: [0, -A + A * 0.25, zc], scale: [W, A * 0.3, L * 0.56], smooth: true });
        f.sphere(1, 7, 4, st.color, { at: [0, -A + A * 0.85, zc], scale: [W * 0.94, A * 0.8, L * 0.52], smooth: true });
        f.cyl(W * 0.75, W * 0.85, A * 1.4, 7, st.color, { at: [0, -A + A * 1.7, zc - L * 0.2], smooth: true });
        break;
      }
    }
  }
}

// ── skirts / robe skirts / dresses ────────────────────────────────────────────

export function skirt(ctx: BodyCtx, topY: number, hemY: number, topW: number, topD: number, hemW: number, hemD: number, color: number, follow = 0.85): GeoBuilder {
  const b = ctx.sb.blend(B.base, skirtWeights(ctx.s, topY, hemY, follow));
  const midY = (topY + hemY) / 2;
  const rings: Ring[] = [
    { y: hemY, w: hemW, d: hemD, z: 0.004 },
    { y: midY, w: (topW + hemW) / 2 * 1.02, d: (topD + hemD) / 2 * 1.02, z: 0.003 },
    { y: topY, w: topW, d: topD, z: 0 },
  ];
  b.add(ringTube(rings, ctx.low ? 10 : 13), color, { smooth: true });
  return b;
}

/** Soft hood bunched behind the neck (chest bone). */
export function hood(ctx: BodyCtx, color: number, lining: number, loose = 1): void {
  const s = ctx.s;
  const b = ctx.sb.on(B.chest);
  const y = s.shoulderY - s.chestY + s.armR * 0.75;
  const nr = neckR(s);
  b.torus(nr * 1.75 * loose, nr * 0.62, 4, 8, color, { at: [0, y, -s.torsoD * 0.12 * loose], rot: [Math.PI / 2 - 0.25, 0, 0], scale: [1.05, 1.05, 0.9], smooth: true }, Math.PI * 1.35);
  b.sphere(1, 6, 4, color, { at: [0, y + 0.01, -s.torsoD * 0.72 * loose - 0.01 * (loose - 1) * 10], scale: [s.torsoW * 0.62, s.armR * 1.35, s.torsoD * 0.42], smooth: true });
  b.sphere(1, 6, 3, lining, { at: [0, y + s.armR * 0.35, -s.torsoD * 0.6 * loose], scale: [s.torsoW * 0.4, s.armR * 0.55, s.torsoD * 0.3], smooth: true, ink: false });
}

/** Rounded front patch (kangaroo pocket, bib) on a torso tube (base-bone blended builder). */
export function frontPatch(b: GeoBuilder, rings: Ring[], y: number, w: number, h: number, color: number, depth = 0.012, ink = false): void {
  const p = tubePoint(rings, 0, y, -depth * 0.35);
  // A soft rounded-rectangle patch (superellipse via a squashed, flattened box-ish sphere).
  b.add(new THREE.CylinderGeometry(1, 1, 1, 12, 1), color, { at: p.pos, rot: alignY(new THREE.Vector3(...p.n)), scale: [w, depth, h], smooth: false, ink });
}

/** Two drawstrings hanging from the neckline (chest bone). */
export function drawstrings(ctx: BodyCtx, color: number, len: number): void {
  const s = ctx.s;
  const b = ctx.sb.on(B.chest, false);
  const nr = neckR(s);
  const y0 = s.shoulderY - s.chestY + s.armR * 0.6;
  for (const sd of [-1, 1]) {
    const x = sd * nr * 0.75;
    const z = s.torsoD * 0.78;
    b.cyl(0.0045, 0.0045, len, 4, color, { at: [x, y0 - len / 2, z], rot: [0.12, 0, 0] });
    b.sphere(0.009, 4, 2, shadeHex(color, 0.85), { at: [x, y0 - len, z + len * 0.12], scale: [1, 1.6, 1] });
  }
}

/** Buttons down the front of a torso tube. */
export function buttons(b: GeoBuilder, rings: Ring[], y0: number, y1: number, n: number, color: number, r: number, phi = 0): void {
  for (let i = 0; i < n; i++) {
    const y = y0 + ((i + 0.5) / n) * (y1 - y0);
    const p = tubePoint(rings, phi, y, 0.003);
    b.sphere(r, 5, 2, color, { at: p.pos, rot: alignZ(new THREE.Vector3(...p.n)), scale: [1, 1, 0.45], ink: false });
  }
}

/** Collar ring around the neckline (chest bone). */
export function collar(ctx: BodyCtx, color: number, tube = 0.016, open = 0): void {
  const s = ctx.s;
  const b = ctx.sb.on(B.chest);
  const nr = neckR(s);
  const y = s.shoulderY - s.chestY + s.armR * 1.0;
  const arc = Math.PI * 2 - open;
  b.torus(nr * 1.25, tube, 3, 14, color, { at: [0, y, -0.004], rot: [Math.PI / 2, 0, Math.PI / 2 + open / 2], scale: [1, 0.95, 1], smooth: true, ink: false }, arc);
}

/** Scrunchie on a forearm near the wrist (Addy: right wrist). */
export function scrunchie(ctx: BodyCtx, sd: 1 | -1, color: number): void {
  const s = ctx.s;
  const b = ctx.sb.on(sd > 0 ? B.foreArmL : B.foreArmR);
  b.torus(s.armR * 0.95, s.armR * 0.36, 4, 10, color, { at: [0, -s.foreArmL + 0.035, 0], rot: [Math.PI / 2, 0, 0], smooth: true, jitter: 0.0025, seed: 12, ink: false });
}

/** Give torso rings a V opening: `top` rad at the neckline narrowing to `waist` at yWaist, then `hem` below it. */
export function vOpen(rings: Ring[], yWaist: number, top: number, waist: number, hem = waist): Ring[] {
  const yTop = rings[rings.length - 1]!.y;
  const yBot = rings[0]!.y;
  return rings.map((r) => {
    let a: number;
    if (r.y >= yWaist) a = waist + (top - waist) * sstep(yWaist, yTop, r.y);
    else a = waist + (hem - waist) * sstep(yWaist, yBot, r.y);
    return { ...r, open: Math.max(0.01, a) };
  });
}

/** Rolled trim along both opening edges of a V-opened tube (shawl collar / lapels), from yMin up. */
export function edgeTrim(b: GeoBuilder, rings: Ring[], yMin: number, radius: number, color: number, lift = 0.006): void {
  for (const side of [1, -1] as const) {
    const pts = openEdge(rings.filter((r) => r.y >= yMin - 1e-4), side, lift);
    if (pts.length < 2) continue;
    const curve = new THREE.CatmullRomCurve3(pts);
    b.add(new THREE.TubeGeometry(curve, Math.max(4, Math.round(pts.length * 1.5)), radius, 4, false), color, { smooth: true, ink: false });
  }
}
