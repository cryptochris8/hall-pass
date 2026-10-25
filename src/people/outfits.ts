// ─────────────────────────────────────────────────────────────────────────────
// Outfit composition (build time): ONE skinned geometry per (role, look, traits)
// — body, clothes, face, hair and small worn props (lanyards, whistle, watch,
// headphones, backpack). Hand-held props (mug, clipboard) and the custodian's
// cart are separate cached meshes (props.ts) so they stay upright.
// Built from the Bad Hair Day body kit (body.ts / head.ts / hair.ts).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { mixHex, shadeHex } from '../render/models/builder';
import {
  arms,
  band,
  buttons,
  collar,
  edgeTrim,
  feet,
  frontPatch,
  hands,
  hipJ,
  hood,
  kneeY,
  legs,
  neckR,
  skirt,
  torsoRings,
  torsoTube,
  vOpen,
  type BodyCtx,
  type ShoeStyle,
} from './body';
import { ringTube, tubePoint, type Ring } from './geo';
import { buildHair, hairTraits } from './hair';
import { buildHead } from './head';
import type { Traits } from './looks';
import { PEOPLE, SKIN_TONES } from './palette';
import { B, type Rig } from './skeleton';
import { SkinBuilder } from './skin';
import type { BodySpec } from './spec';
import type { PersonLook, PersonRole } from './types';

export function skinHex(look: PersonLook): number {
  return SKIN_TONES[look.skin] ?? SKIN_TONES[2]!;
}

function pelvis(ctx: BodyCtx, color: number, toY = ctx.s.spineY + 0.02): void {
  const rings = torsoRings(ctx.s, 1.0).filter((r) => r.y <= toY + 1e-4);
  torsoTube(ctx, rings, color, { closeBottom: true });
}

interface TopOpts {
  color: number;
  loose?: number;
  hemY?: number;
  flare?: number;
  hemBand?: number | null;
  phi0?: number;
  phiLen?: number;
  v?: [number, number, number];
  vWaist?: number;
}

function top(ctx: BodyCtx, o: TopOpts) {
  let rings = torsoRings(ctx.s, o.loose ?? 1.04, o.hemY, o.flare ?? 0.035);
  if (o.v) rings = vOpen(rings, ctx.s.spineY + (o.vWaist ?? 0), o.v[0], o.v[1], o.v[2]);
  const b = torsoTube(ctx, rings, o.color, { phi0: o.phi0, phiLen: o.phiLen });
  if (o.hemBand) band(b, rings, rings[0]!.y, rings[0]!.y + 0.03, o.hemBand, 0.004, 12, true, o.phi0, o.phiLen);
  return { b, rings };
}

const sneaker = (color: number, accent: number): ShoeStyle => ({ kind: 'sneaker', color, accent });

/** Rigid builder on the chest bone (worn accessories). */
const chest = (ctx: BodyCtx, ink = true) => ctx.sb.on(B.chest, ink);
/** Chest-bone-local y of the shoulder line. */
const shY = (s: BodySpec) => s.shoulderY - s.chestY;

export function buildPersonGeometry(role: PersonRole, s: BodySpec, look: PersonLook, t: Traits, rig: Rig): THREE.BufferGeometry {
  const sb = new SkinBuilder(rig.rest);
  const skin = skinHex(look);
  const ctx: BodyCtx = { sb, s, skin, low: true };
  const ht = hairTraits(look.hairStyle);
  buildHead(sb, s, {
    skin,
    eyes: t.eyes,
    hair: look.hair,
    lashes: t.lashes,
    glasses: look.glasses ? t.glassesFrame : null,
    glassesShape: t.glassesShape,
    beard: t.beard,
    brows: t.brows,
    ears: ht.ears,
    low: true,
  });
  hands(ctx);
  const hooded = t.topCut === 'hoodie';
  const backPad = (hooded ? 0.05 : 0) + (look.backpack !== null ? 0.12 : 0);
  buildHair(sb, s, rig, look.hairStyle, look.hair, { capped: role === 'patroller', backPad, seed: look.top & 0xff });

  // Tops.
  switch (t.topCut) {
    case 'hoodie':
      hoodie(ctx, look.top);
      break;
    case 'tee':
      tee(ctx, look.top, t.accent);
      break;
    case 'jacket':
      jacket(ctx, look.top, t.under);
      break;
    case 'sweater':
      sweater(ctx, look.top, t.accent);
      break;
    case 'polo':
      polo(ctx, look.top);
      break;
    case 'shirt':
      shirt(ctx, look.top, true);
      break;
    case 'cardigan':
      cardigan(ctx, look.top, t.under);
      break;
    case 'blazer':
      blazer(ctx, look.top, t.under, t.accent);
      break;
    case 'overalls':
      overalls(ctx, look.top, t.under);
      break;
    case 'vest':
      vest(ctx, look.top, t.under, t.accent);
      break;
  }
  // Bottoms.
  switch (t.bottomCut) {
    case 'jeans':
      pelvis(ctx, look.bottom);
      legs(ctx, { color: look.bottom, width: 1.04, cuff: null, hemBand: null });
      break;
    case 'joggers':
      pelvis(ctx, look.bottom);
      legs(ctx, { color: look.bottom, width: 1.1, cuff: shadeHex(look.bottom, 0.82), stripes: null });
      break;
    case 'slacks':
      pelvis(ctx, look.bottom);
      legs(ctx, { color: look.bottom, width: 1.05 });
      break;
    case 'skirt': {
      pelvis(ctx, look.bottom);
      const hem = kneeY(s) + (role === 'extra' ? 0.06 : -0.03);
      skirt(ctx, s.spineY + 0.02, hem, s.waistW * 1.1, s.waistD * 1.12, s.hipW * 1.42, s.hipD * 1.36, look.bottom, 0.8);
      const tights = role === 'extra' ? skin : mixHex(skin, 0x3a3440, 0.35);
      legs(ctx, { color: tights, width: 0.86 });
      break;
    }
    case 'overalls':
      // Legs come with the overalls (below).
      break;
  }
  // Shoes.
  switch (role) {
    case 'student':
    case 'extra':
      feet(ctx, sneaker(look.shoes, look.shoes === PEOPLE.sneakerWhite ? t.accent : PEOPLE.sneakerWhite));
      break;
    case 'wanderer':
      feet(ctx, { kind: 'boot', color: look.shoes, accent: look.shoes });
      break;
    case 'patroller':
      feet(ctx, look.shoes === PEOPLE.sneakerWhite ? sneaker(look.shoes, look.top) : { kind: 'shoe', color: look.shoes, accent: shadeHex(look.shoes, 1.3) });
      break;
    default:
      feet(ctx, t.femme && t.bottomCut === 'skirt' ? { kind: 'flat', color: look.shoes, accent: look.shoes } : { kind: 'shoe', color: look.shoes, accent: shadeHex(look.shoes, 1.3) });
  }
  // Role accessories.
  switch (role) {
    case 'student':
      if (look.backpack !== null) backpack(ctx, look.backpack);
      if (look.headphones) headphones(ctx);
      break;
    case 'patroller':
      lanyard(ctx, PEOPLE.lanyard, 'whistle');
      watch(ctx);
      cap(ctx);
      break;
    case 'sentry':
      lanyard(ctx, t.accent, 'badge');
      watch(ctx);
      break;
    case 'investigator':
      watch(ctx);
      break;
    case 'listener':
      lanyard(ctx, PEOPLE.goldTrim, 'glasses');
      break;
    case 'snitch':
      lanyard(ctx, PEOPLE.vestTrim, 'badge');
      break;
    default:
      break;
  }
  return sb.build();
}

// ── tops ───────────────────────────────────────────────────────────────────────

function hoodie(ctx: BodyCtx, c: number): void {
  const s = ctx.s;
  const rib = shadeHex(c, 0.82);
  const t = top(ctx, { color: c, loose: 1.08, hemY: hipJ(s) - s.legR * 0.1, flare: 0.02, hemBand: rib });
  frontPatch(t.b, t.rings, s.spineY - 0.03, s.waistW * 0.62, 0.06, mixHex(c, 0xffffff, 0.08), 0.012);
  hood(ctx, c, shadeHex(c, 0.7), 1.05);
  hoodieStrings(ctx, t.rings, PEOPLE.hoodieString);
  arms(ctx, { color: c, width: 1.14, length: 'wrist', cuff: rib });
}

function tee(ctx: BodyCtx, c: number, accent: number): void {
  const s = ctx.s;
  const t = top(ctx, { color: c, loose: 1.04, hemY: hipJ(s) - s.legR * 0.05 });
  // A simple chest stripe print.
  band(t.b, t.rings, s.chestY - 0.02, s.chestY + 0.012, accent, 0.003, 12);
  collar(ctx, shadeHex(c, 0.84), 0.012);
  arms(ctx, { color: c, width: 1.12, length: 'short', below: ctx.skin, cuff: shadeHex(c, 0.86) });
}

function jacket(ctx: BodyCtx, c: number, under: number): void {
  const s = ctx.s;
  top(ctx, { color: under, loose: 1.03, hemY: hipJ(s) - s.legR * 0.05 });
  collar(ctx, shadeHex(under, 0.86), 0.012);
  const j = top(ctx, { color: c, loose: 1.12, hemY: hipJ(s) - s.legR * 0.3, flare: 0.03, hemBand: shadeHex(c, 0.8), phi0: 0.34, phiLen: Math.PI * 2 - 0.68 });
  for (const phi of [0.34, -0.34]) {
    const rs = j.rings.map((r) => ({ y: r.y, w: r.w + 0.004, d: r.d + 0.004, z: r.z }));
    j.b.add(ringTube(rs.slice(0, -1), 1, { phi0: phi - 0.03, phiLen: 0.06 }), shadeHex(c, 0.78), { smooth: true, ink: false });
  }
  collar(ctx, c, 0.022, 0.9);
  arms(ctx, { color: c, width: 1.18, length: 'wrist', cuff: shadeHex(c, 0.8) });
}

function sweater(ctx: BodyCtx, c: number, accent: number): void {
  const s = ctx.s;
  const rib = shadeHex(c, 0.84);
  const t = top(ctx, { color: c, loose: 1.07, hemY: hipJ(s) - s.legR * 0.15, flare: 0.02, hemBand: rib });
  for (const y of [s.chestY - 0.05, s.chestY + 0.0]) band(t.b, t.rings, y, y + 0.022, accent, 0.003, 12);
  collar(ctx, rib, 0.016);
  arms(ctx, { color: c, width: 1.14, length: 'wrist', cuff: rib });
}

function polo(ctx: BodyCtx, c: number): void {
  const s = ctx.s;
  const t = top(ctx, { color: c, loose: 1.06, hemY: hipJ(s) + 0.01, flare: 0.03 });
  // Placket + buttons, flat collar.
  buttons(t.b, t.rings, s.chestY + 0.04, s.shoulderY - 0.005, 2, mixHex(c, 0xffffff, 0.6), 0.008);
  collar(ctx, shadeHex(c, 0.85), 0.02, 0.5);
  arms(ctx, { color: c, width: 1.16, length: 'short', below: ctx.skin, cuff: shadeHex(c, 0.85) });
  belt(ctx, PEOPLE.shoeBlack);
}

function shirt(ctx: BodyCtx, c: number, sleevesRolled: boolean): void {
  const s = ctx.s;
  const t = top(ctx, { color: c, loose: 1.04, hemY: hipJ(s) + 0.01 });
  buttons(t.b, t.rings, s.spineY - 0.02, s.shoulderY - 0.01, 5, shadeHex(c, 0.82), 0.007);
  collar(ctx, shadeHex(c, 0.92), 0.018, 0.55);
  if (sleevesRolled) arms(ctx, { color: c, width: 1.1, length: 'elbow', below: ctx.skin, cuff: shadeHex(c, 0.9) });
  else arms(ctx, { color: c, width: 1.08, length: 'wrist', cuff: shadeHex(c, 0.9) });
  belt(ctx, PEOPLE.shoeBrown);
}

function cardigan(ctx: BodyCtx, c: number, under: number): void {
  const s = ctx.s;
  top(ctx, { color: under, loose: 1.02, hemY: hipJ(s) + 0.015 });
  collar(ctx, shadeHex(under, 0.9), 0.012, 1.2);
  const k = top(ctx, { color: c, loose: 1.09, hemY: hipJ(s) - 0.03, hemBand: shadeHex(c, 0.85), v: [0.66, 0.32, 0.36] });
  edgeTrim(k.b, k.rings, hipJ(s) - 0.03, 0.01, shadeHex(c, 0.85), 0.006);
  buttons(k.b, k.rings, s.spineY - 0.01, s.chestY + 0.02, 3, mixHex(c, 0xffffff, 0.55), 0.01, 0.62);
  arms(ctx, { color: c, width: 1.13, length: 'wrist', cuff: shadeHex(c, 0.85) });
}

function blazer(ctx: BodyCtx, c: number, under: number, tie: number): void {
  const s = ctx.s;
  top(ctx, { color: under, loose: 1.02, hemY: hipJ(s) + 0.02 });
  collar(ctx, shadeHex(under, 0.92), 0.016, 0.7);
  // Tie: knot + blade down the shirt front (chest/spine blended → bends with the torso).
  const tb = ctx.sb.blend(B.base, (x, y, z, o) => {
    const k = Math.max(0, Math.min(1, (y - s.spineY) / (s.chestY - s.spineY)));
    o.i[0] = B.spine;
    o.w[0] = 1 - k;
    o.i[1] = B.chest;
    o.w[1] = k;
    o.i[2] = o.i[3] = 0;
    o.w[2] = o.w[3] = 0;
    void x;
    void z;
  });
  const front = (y: number) => {
    const r = torsoRings(s, 1.02).find((q) => q.y >= y) ?? torsoRings(s, 1.02)[4]!;
    return (r.z ?? 0) + r.d + 0.006;
  };
  const yTop = s.shoulderY + s.armR * 0.55;
  tb.sphere(0.022, 6, 4, tie, { at: [0, yTop - 0.01, front(yTop - 0.02) - 0.004], scale: [1, 0.8, 0.6], smooth: true });
  const yBot = s.spineY - 0.04;
  tb.add(
    new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(-0.016, 0), new THREE.Vector2(0.016, 0), new THREE.Vector2(0.03, -(yTop - yBot) + 0.04), new THREE.Vector2(0, -(yTop - yBot)), new THREE.Vector2(-0.03, -(yTop - yBot) + 0.04)]), 1),
    tie,
    { at: [0, yTop - 0.025, front(s.chestY) + 0.002], rot: [-0.12, 0, 0], ink: true },
  );
  const j = top(ctx, { color: c, loose: 1.1, hemY: hipJ(s) - s.legR * 0.3, flare: 0.04, v: [0.6, 0.12, 0.34], vWaist: -0.02 });
  edgeTrim(j.b, j.rings, s.spineY - 0.01, 0.017, shadeHex(c, 0.8), 0.007);
  collar(ctx, shadeHex(c, 0.8), 0.022, 1.3);
  buttons(j.b, j.rings, s.spineY - 0.035, s.spineY + 0.01, 2, PEOPLE.goldTrim, 0.011, 0.18);
  // Pocket square.
  const ps = chest(ctx, false);
  ps.box(0.034, 0.016, 0.008, tie, { at: [s.torsoW * 0.5, shY(s) - 0.095, s.torsoD * 1.04], rot: [-0.15, 0.35, 0] });
  arms(ctx, { color: c, width: 1.14, length: 'wrist', cuff: under });
}

function overalls(ctx: BodyCtx, c: number, shirtC: number): void {
  const s = ctx.s;
  const dark = PEOPLE.overallsDark;
  pelvis(ctx, c);
  top(ctx, { color: shirtC, loose: 1.04, hemY: hipJ(s) + 0.01 });
  collar(ctx, shadeHex(shirtC, 0.88), 0.016, 0.6);
  // Bib + waist (spine/chest blend), straps, pocket.
  const waist = ctx.sb.blend(B.base, (x, y, z, o) => {
    const k = Math.max(0, Math.min(1, (y - s.spineY) / (s.chestY - s.spineY)));
    o.i[0] = B.spine;
    o.w[0] = 1 - k;
    o.i[1] = B.chest;
    o.w[1] = k;
    o.i[2] = o.i[3] = 0;
    o.w[2] = o.w[3] = 0;
    void x;
    void z;
  });
  const lowRings = torsoRings(s, 1.07).filter((r) => r.y <= s.spineY + 0.04);
  waist.add(ringTube([...lowRings.slice(1), { y: s.spineY + 0.04, w: s.waistW * 1.08, d: s.waistD * 1.09 }], 14), c, { smooth: true });
  const bibRings = torsoRings(s, 1.07);
  frontPatch(waist, bibRings, s.chestY - 0.02, s.torsoW * 0.62, 0.09, c, 0.012, true);
  frontPatch(waist, bibRings, s.chestY - 0.03, s.torsoW * 0.3, 0.035, dark, 0.016, false);
  const ch = chest(ctx);
  for (const sd of [-1, 1]) {
    const x = sd * s.torsoW * 0.45;
    const yT = shY(s) + s.armR * 0.62;
    ch.box(0.032, 0.014, s.torsoD * 1.9, c, { at: [x, yT, -0.004], ink: false });
    ch.box(0.032, shY(s), 0.012, c, { at: [x, yT / 2, s.torsoD * 0.95], rot: [-0.12, 0, 0], ink: false });
    ch.box(0.032, shY(s) + 0.05, 0.012, c, { at: [x, yT / 2 - 0.02, -s.torsoD * 0.97], rot: [0.1, 0, 0], ink: false });
    ch.sphere(0.013, 6, 4, PEOPLE.whistle, { at: [x, 0.004, s.torsoD * 1.0], scale: [1, 1, 0.5], ink: false });
  }
  legs(ctx, { color: c, width: 1.12, cuff: null, hemBand: dark });
  arms(ctx, { color: shirtC, width: 1.1, length: 'elbow', below: ctx.skin, cuff: shadeHex(shirtC, 0.86) });
  // Work gloves tucked in the back pocket (a little character detail).
  const hp = ctx.sb.on(B.hips);
  hp.box(0.06, 0.07, 0.02, 0xd8c08a, { at: [s.hipX * 0.9, s.spineY - s.hipsY - 0.06, -s.hipD - 0.012], rot: [0.15, 0, 0.2] });
}

function vest(ctx: BodyCtx, c: number, shirtC: number, trim: number): void {
  const s = ctx.s;
  top(ctx, { color: shirtC, loose: 1.03, hemY: hipJ(s) + 0.015 });
  collar(ctx, shadeHex(shirtC, 0.92), 0.018, 0.55);
  const v = top(ctx, { color: c, loose: 1.08, hemY: hipJ(s) - 0.005, flare: 0.02, hemBand: trim, v: [0.58, 0.18, 0.2] });
  edgeTrim(v.b, v.rings, hipJ(s), 0.009, trim, 0.006);
  // Argyle-ish diamonds on the front (comic prep).
  for (const [x, y] of [
    [-0.05, s.spineY + 0.02],
    [0.05, s.spineY + 0.02],
    [0, s.spineY - 0.04],
  ] as const) {
    const r = torsoRings(s, 1.08).find((q) => q.y >= y)!;
    v.b.box(0.034, 0.034, 0.004, shadeHex(c, 1.35), { at: [x, y, (r.z ?? 0) + r.d * Math.cos(x / r.w) + 0.004], rot: [0, x * 4, Math.PI / 4], ink: false });
  }
  arms(ctx, { color: shirtC, width: 1.08, length: 'wrist', cuff: shadeHex(shirtC, 0.9) });
  belt(ctx, PEOPLE.shoeBrown);
}

// ── accessories ────────────────────────────────────────────────────────────────

/** Two drawstrings lying on the hoodie front (rigid on the chest bone, following the torso surface). */
function hoodieStrings(ctx: BodyCtx, rings: Ring[], color: number): void {
  const s = ctx.s;
  const b = chest(ctx, false);
  const y0 = s.shoulderY + s.armR * 0.35;
  const y1 = y0 - 0.13;
  for (const sd of [-1, 1]) {
    const phi = sd * 0.2;
    const a = tubePoint(rings, phi, y0, 0.006).pos;
    const c = tubePoint(rings, phi * 1.1, y1, 0.008).pos;
    const d = new THREE.Vector3(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
    b.cyl(0.005, 0.005, d.length(), 4, color, { at: [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2 - s.chestY, (a[2] + c[2]) / 2], rot: [e.x, e.y, e.z] });
    b.cyl(0.008, 0.008, 0.022, 5, shadeHex(color, 0.82), { at: [c[0], c[1] - s.chestY - 0.01, c[2] + 0.002], rot: [e.x, e.y, e.z] });
  }
}

function belt(ctx: BodyCtx, color: number): void {
  const s = ctx.s;
  const b = ctx.sb.on(B.hips);
  const y = s.spineY - s.hipsY - 0.035;
  const r = torsoRings(s, 1.0).find((q) => q.y >= s.spineY - 0.035)!;
  b.add(ringTube([{ y: y - 0.016, w: r.w * 1.06, d: r.d * 1.07 }, { y: y + 0.016, w: r.w * 1.05, d: r.d * 1.06 }], 14), color, { smooth: true, ink: false });
  b.box(0.04, 0.03, 0.01, PEOPLE.goldTrim, { at: [0, y, r.d * 1.07 + 0.003], ink: false });
}

function lanyard(ctx: BodyCtx, color: number, end: 'whistle' | 'badge' | 'glasses'): void {
  const s = ctx.s;
  const ch = chest(ctx, false);
  const nr = neckR(s);
  const yT = shY(s) + s.armR * 0.7;
  const z = s.torsoD * 0.92;
  const len = end === 'glasses' ? 0.12 : 0.15;
  for (const sd of [-1, 1]) ch.box(0.011, len, 0.006, color, { at: [sd * nr * 0.85, yT - len / 2, z], rot: [-0.18, 0, sd * 0.28] });
  if (end === 'badge') {
    ch.box(0.052, 0.068, 0.008, PEOPLE.badge, { at: [0, yT - len - 0.03, s.torsoD * 1.02], rot: [-0.1, 0, 0] });
    ch.box(0.038, 0.012, 0.004, color, { at: [0, yT - len - 0.01, s.torsoD * 1.03], rot: [-0.1, 0, 0] });
  } else if (end === 'glasses') {
    // Reading-glasses chain hanging on the chest (librarian).
    for (const sd of [-1, 1]) ch.torus(0.018, 0.0035, 3, 10, PEOPLE.glassesFrameWarm, { at: [sd * 0.021, yT - len - 0.012, s.torsoD * 1.02], rot: [0.2, 0, 0] });
  } else {
    // The whistle hangs on its own bone (hidden while it's in his mouth).
    const w = ctx.sb.on(B.propChest, false);
    whistleGeo(w, 0, 0, 0);
  }
  // The hand whistle (only shown during the 'whistle' action).
  if (end === 'whistle') {
    const h = ctx.sb.on(B.propHand, false);
    whistleGeo(h, 0, 0.0, ctx.s.handR * 0.9);
  }
}

function whistleGeo(b: ReturnType<SkinBuilder['on']>, x: number, y: number, z: number): void {
  b.cyl(0.014, 0.014, 0.034, 8, PEOPLE.whistle, { at: [x, y, z], rot: [0, 0, Math.PI / 2], smooth: true, ink: true });
  b.box(0.026, 0.012, 0.012, PEOPLE.whistle, { at: [x + 0.024, y + 0.006, z], ink: true });
  b.torus(0.007, 0.002, 3, 6, shadeHex(PEOPLE.whistle, 0.7), { at: [x - 0.018, y + 0.012, z], ink: false });
}

function watch(ctx: BodyCtx): void {
  const s = ctx.s;
  const hw = ctx.sb.on(B.handL);
  hw.torus(s.armR * 0.72, 0.008, 3, 10, PEOPLE.watchStrap, { at: [0, -0.004, 0], rot: [Math.PI / 2, 0, 0], ink: false });
  hw.cyl(0.017, 0.017, 0.008, 8, PEOPLE.goldTrim, { at: [s.armR * 0.72, -0.004, 0], rot: [0, 0, Math.PI / 2], ink: false });
  hw.cyl(0.013, 0.013, 0.009, 8, PEOPLE.mugBody, { at: [s.armR * 0.74, -0.004, 0], rot: [0, 0, Math.PI / 2], ink: false });
}

function cap(ctx: BodyCtx): void {
  const s = ctx.s;
  const b = ctx.sb.on(B.hairTop);
  const C: [number, number, number] = [0, -s.headRy * 0.35, 0];
  const c = PEOPLE.capNavy;
  b.add(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, 1.32), c, { at: C, rot: [-0.22, 0, 0], scale: [s.headRx * 1.13, s.headRy * 1.1, s.headRz * 1.13], smooth: true });
  b.add(new THREE.CylinderGeometry(s.headRx * 0.74, s.headRx * 0.74, 0.012, 12, 1, false, -Math.PI / 2, Math.PI), shadeHex(c, 0.85), {
    at: [0, C[1] + s.headRy * 0.36, s.headRz * 0.9],
    rot: [0.28, 0, 0],
    scale: [1.05, 1, 0.9],
  });
  b.sphere(0.012, 5, 3, PEOPLE.poloMaroon, { at: [0, C[1] + s.headRy * 1.12, -0.01], ink: false });
  // Cap badge (school maroon).
  b.box(0.05, 0.03, 0.006, PEOPLE.poloMaroon, { at: [0, C[1] + s.headRy * 0.72, s.headRz * 1.0], rot: [-0.42, 0, 0], ink: false });
}

function backpack(ctx: BodyCtx, color: number): void {
  const s = ctx.s;
  const bp = chest(ctx);
  const by = shY(s) * 0.1;
  const h = shY(s) * 1.25;
  bp.sphere(1, 8, 5, color, { at: [0, by, -s.torsoD - 0.07], scale: [s.torsoW * 0.86, h, 0.085], smooth: true });
  bp.sphere(1, 6, 4, shadeHex(color, 0.85), { at: [0, by - h * 0.42, -s.torsoD - 0.14], scale: [s.torsoW * 0.58, h * 0.32, 0.04], smooth: true });
  bp.box(s.torsoW * 0.9, 0.012, 0.012, shadeHex(color, 0.7), { at: [0, by + h * 0.25, -s.torsoD - 0.15], rot: [0.2, 0, 0], ink: false });
  bp.torus(0.022, 0.006, 3, 8, shadeHex(color, 0.7), { at: [0, by + h * 0.98, -s.torsoD - 0.06], rot: [0, 0, 0], ink: false });
  for (const sd of [-1, 1]) {
    bp.box(0.026, h * 1.25, 0.014, shadeHex(color, 0.7), { at: [sd * s.torsoW * 0.5, by + 0.01, s.torsoD * 0.92], rot: [-0.08, 0, 0], ink: false });
    bp.box(0.026, 0.014, s.torsoD * 1.9, shadeHex(color, 0.7), { at: [sd * s.torsoW * 0.5, shY(s) + s.armR * 0.55, -0.01], ink: false });
  }
}

function headphones(ctx: BodyCtx): void {
  const s = ctx.s;
  const b = chest(ctx);
  const nr = neckR(s);
  const y = shY(s) + s.armR * 1.25;
  // Band resting around the neck + two cups at the collarbones.
  b.torus(nr * 1.75, 0.011, 3, 10, PEOPLE.headphones, { at: [0, y, -0.005], rot: [Math.PI / 2 - 0.2, 0, 0], ink: false }, Math.PI * 1.4);
  for (const sd of [-1, 1]) {
    b.cyl(0.04, 0.04, 0.028, 8, PEOPLE.headphones, { at: [sd * nr * 1.55, y - 0.012, s.torsoD * 0.55], rot: [0.6, 0, sd * 0.9], smooth: true });
    b.cyl(0.03, 0.03, 0.012, 8, PEOPLE.headphonePad, { at: [sd * nr * 1.4, y + 0.0, s.torsoD * 0.62], rot: [0.6, 0, sd * 0.9], smooth: true, ink: false });
  }
}
