// ─────────────────────────────────────────────────────────────────────────────
// Furniture models (contract part 1, src/world/props/types.ts). One merged,
// vertex-coloured, inked BufferGeometry per kind/size/variant, built at the
// origin with feet at y = 0, facing local +Z and fitting localW (X) × localD (Z)
// × h exactly (body vertices; the ink hull adds ~1 cm). Chunky inked toon in the
// shelf's house style: big shapes inked, small details flat (no ink) to stay in
// the phone budget (desk ≤ ~350 tris, locker ≤ ~150, others ≤ ~800).
//
// Which way things face (src/school/gen/furnish.ts): classroom desks and tables
// get `face` = the yaw pointing AWAY from the back wall (toward the door side),
// and the generator puts your seat 0.75 m in front of the desk along that yaw —
// so the chair is on the local +Z side and a seated student looks toward local
// −Z, at the whiteboard / teacher on the back wall. Teacher and office desks face
// into the room (local +Z = the class / visitors); whoever works there sits on
// the −Z side. Lockers, stalls, shelves, vending machines and trophy cases show
// their front on +Z.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PAL } from '../../render/palette';
import { hash01, shadeHex } from '../../render/models/builder';
import { inked } from '../../render/models/common';
import type { FurnitureKind } from '../../school/types';
import { Frame } from './kit';
import { PP } from './palette';
import type { PropVariant } from './types';

/** Locker door recess behind the footprint front (room for the 'hide' door to stand ajar). */
export const LOCKER_RECESS = 0.12;

export function buildFurniture(kind: FurnitureKind, W: number, D: number, H: number, variant: PropVariant): THREE.BufferGeometry {
  const b = inked();
  const f = new Frame(b);
  switch (kind) {
    case 'desk':
      desk(f, W, D, H);
      break;
    case 'teacherDesk':
      teacherDesk(f, W, D, H);
      break;
    case 'locker':
      locker(f, W, D, H, variant);
      break;
    case 'stall':
      stall(f, W, D, H);
      break;
    case 'shelf':
      shelf(f, W, D, H);
      break;
    case 'table':
      if (W >= 2.0) cafeteriaTable(f, W, D, H);
      else workTable(f, W, D, H);
      break;
    case 'bleachers':
      bleachers(f, W, D, H);
      break;
    case 'vending':
      if (W >= 2.5) servingCounter(f, W, D, H, variant);
      else vending(f, W, D, H, variant);
      break;
    case 'officeDesk':
      officeDesk(f, W, D, H, variant);
      break;
    case 'trophyCase':
      trophyCase(f, W, D, H, variant);
      break;
    case 'bench':
      bench(f, W, D, H);
      break;
    case 'planter':
      planter(f, W, D, H);
      break;
  }
  if (variant === 'goal' && kind !== 'locker' && kind !== 'vending' && kind !== 'officeDesk' && kind !== 'trophyCase') {
    // Generic mission highlight: a glowing blue tag on top.
    f.box(Math.min(0.24, W * 0.5), 0.02, Math.min(0.18, D * 0.5), PAL.goal, 0, H - 0.01, 0, { ink: false, glow: PAL.goal });
  }
  return b.build();
}

// ── desk: student desk with its chair on the +Z side (see header) ──
function desk(f: Frame, W: number, D: number, H: number): void {
  const T = H - 0.015; // writing surface (notebook + pencil sit on it, still inside h)
  const deskD = D * 0.56;
  const z0 = -D / 2;
  const z1 = z0 + deskD;
  const dz = (z0 + z1) / 2;
  const legIn = 0.04;
  // top + book box
  f.span(-W / 2, W / 2, T - 0.05, T, z0, z1, PAL.deskTop);
  f.span(-W / 2 + 0.07, W / 2 - 0.07, T - 0.19, T - 0.05, z0 + 0.03, z1 - 0.06, PP.metalDark, { ink: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(0.035, T - 0.05, 0.035, PP.metalLight, sx * (W / 2 - legIn), (T - 0.05) / 2, dz + sz * (deskD / 2 - legIn), { ink: false });
  // notebook + pencil
  f.box(Math.min(0.22, W * 0.3), 0.012, Math.min(0.16, deskD * 0.5), PP.paper, -W * 0.12, T + 0.006, dz, { rot: [0, 0.18, 0], ink: false });
  f.box(0.13, 0.012, 0.012, PP.pencil, W * 0.18, T + 0.006, dz + deskD * 0.12, { rot: [0, -0.4, 0], ink: false });
  // chair
  const cD = D - deskD - 0.02;
  const c1 = D / 2;
  const c0 = c1 - cD;
  const cw = Math.min(W * 0.62, 0.44);
  const seatY = Math.min(0.45, H * 0.6);
  f.span(-cw / 2, cw / 2, seatY - 0.05, seatY, c0, c1 - 0.03, PP.chairA);
  f.span(-cw / 2, cw / 2, seatY + 0.08, H - 0.01, c1 - 0.045, c1, PP.chairA);
  for (const sx of [-1, 1]) {
    f.box(0.03, seatY - 0.05, 0.03, PP.metalLight, sx * (cw / 2 - 0.03), (seatY - 0.05) / 2, c0 + 0.03, { ink: false });
    f.box(0.03, seatY + 0.1, 0.03, PP.metalLight, sx * (cw / 2 - 0.03), (seatY + 0.1) / 2, c1 - 0.025, { ink: false });
  }
}

// ── teacher desk: wood desk, drawer pedestal on the teacher's (−Z) side, papers, apple, mug ──
function teacherDesk(f: Frame, W: number, D: number, H: number): void {
  const T = H - 0.1; // surface: the apple and mug stay inside h
  const top = T - 0.05;
  f.span(-W / 2, W / 2, top, T, -D / 2, D / 2, PAL.deskTop);
  // pedestal (right) + legs (left) + modesty panel facing the class (+Z)
  const pw = Math.min(0.42, W * 0.3);
  f.span(W / 2 - pw - 0.02, W / 2 - 0.02, 0, top, -D / 2 + 0.03, D / 2 - 0.03, PAL.desk);
  f.span(-W / 2 + 0.03, W / 2 - pw - 0.02, 0.22, top, D / 2 - 0.07, D / 2 - 0.03, PAL.desk);
  for (const sz of [-1, 1]) f.box(0.06, top, 0.06, PAL.desk, -W / 2 + 0.06, top / 2, sz * (D / 2 - 0.06), { ink: false });
  // drawers on the −Z side
  const px = W / 2 - 0.02 - pw / 2;
  for (let k = 0; k < 3; k++) {
    const y0 = 0.06 + k * ((top - 0.08) / 3);
    const y1 = y0 + (top - 0.08) / 3 - 0.03;
    f.span(px - pw / 2 + 0.03, px + pw / 2 - 0.03, y0, y1, -D / 2 + 0.015, -D / 2 + 0.03, shadeHex(PAL.desk, 1.12), { ink: false });
    f.box(0.12, 0.025, 0.02, PP.metalLight, px, (y0 + y1) / 2, -D / 2 + 0.012, { ink: false });
  }
  // desk clutter (on top)
  const y = T;
  f.box(0.3, 0.04, 0.22, PP.paper, -W * 0.18, y + 0.02, -D * 0.05, { rot: [0, 0.12, 0], ink: false });
  f.box(0.28, 0.006, 0.21, PP.paperYellow, -W * 0.18 + 0.05, y + 0.043, -D * 0.05 + 0.02, { rot: [0, -0.25, 0], ink: false });
  f.box(0.12, 0.012, 0.012, PP.markerRed, -W * 0.02, y + 0.006, D * 0.12, { rot: [0, 0.6, 0], ink: false });
  // grade books
  f.box(0.24, 0.05, 0.18, PP.signNavy, W * 0.08, y + 0.025, -D * 0.2, { rot: [0, -0.1, 0] });
  f.box(0.22, 0.04, 0.17, PP.books[0]!, W * 0.08, y + 0.07, -D * 0.2, { rot: [0, 0.15, 0], ink: false });
  // apple
  f.ball(0.045, 1, PP.apple, W * 0.3, y + 0.042, D * 0.18, { scale: [1, 0.92, 1], smooth: true });
  f.box(0.008, 0.02, 0.008, PP.trunk, W * 0.3, y + 0.085, D * 0.18, { ink: false });
  f.box(0.03, 0.006, 0.016, PP.leaf, W * 0.3 + 0.017, y + 0.088, D * 0.18, { rot: [0, 0, 0.4], ink: false });
  // mug
  f.cyl(0.04, 0.036, 0.1, 10, PP.mug, W * 0.36, y + 0.05, -D * 0.22);
  f.cyl(0.033, 0.033, 0.004, 10, PP.coffee, W * 0.36, y + 0.099, -D * 0.22, { ink: false });
  f.torus(0.026, 0.008, 4, 8, PP.mug, W * 0.36 + 0.045, y + 0.05, -D * 0.22, { ink: false });
}

// ── locker: one tall locker; door recessed in a frame, vents, handle, number plate ──
function locker(f: Frame, W: number, D: number, H: number, variant: PropVariant): void {
  const zf = D / 2 - LOCKER_RECESS; // door plane (back of the door)
  // back mass + frame (left stile, top rail, kick)
  f.span(-W / 2, W / 2, 0, H, -D / 2, zf, PAL.locker, { ink: false });
  f.span(-W / 2, -W / 2 + 0.025, 0, H, zf, D / 2, PAL.lockerDark, { ink: false });
  f.span(-W / 2, W / 2, H - 0.07, H, zf, D / 2, variant === 'goal' ? PAL.goal : PAL.locker, variant === 'goal' ? { glow: PAL.goal } : {});
  f.span(-W / 2, W / 2, 0, 0.1, zf, D / 2, PAL.lockerDark, { ink: false });
  const dw = W - 0.045;
  const hx = -W / 2 + 0.03; // hinge line (left)
  const y0 = 0.12;
  const y1 = H - 0.08;
  const hide = variant === 'hide';
  if (hide) f.span(-W / 2 + 0.025, W / 2, y0, y1, zf - 0.01, zf + 0.001, PP.lockerInside, { ink: false });
  // the door, on its own frame so the 'hide' locker can stand ajar (opening outward, free edge toward +Z)
  const ajar = hide ? -Math.asin(Math.min(0.95, (LOCKER_RECESS - 0.03) / dw)) : 0;
  const d = f.sub(hx, 0, zf + 0.001, ajar);
  d.span(0, dw, y0, y1, 0, 0.02, PP.lockerDoor);
  const vents = 3;
  for (let k = 0; k < vents; k++) {
    const vy = y1 - 0.12 - k * 0.05;
    d.span(0.07, dw - 0.07, vy, vy + 0.022, 0.02, 0.026, PP.lockerVent, { ink: false });
  }
  d.span(dw - 0.08, dw - 0.045, 0.85, 1.05, 0.02, 0.04, PP.metalLight, { ink: false });
  if (variant === 'goal') {
    d.span(dw * 0.25, dw * 0.75, 1.32, 1.46, 0.02, 0.03, PAL.goal, { ink: false, glow: PAL.goal });
  } else if (!hide) {
    d.span(dw / 2 - 0.06, dw / 2 + 0.06, 1.35, 1.41, 0.02, 0.026, PP.lockerPlate, { ink: false });
  } else {
    // hide spot: a little lighter handle + no plate (keeps the budget)
  }
}

// ── bathroom stall: partitions on feet, pilasters, door ajar inward, a toilet seen from above ──
function stall(f: Frame, W: number, D: number, H: number): void {
  const t = 0.04;
  const zf = D / 2 - 0.05;
  for (const sx of [-1, 1]) {
    f.span(sx * (W / 2) - (sx > 0 ? t : 0), sx * (W / 2) + (sx < 0 ? t : 0), 0.22, H - 0.12, -D / 2, zf, PP.stallPanel);
    f.box(0.05, 0.22, 0.05, PP.metalLight, sx * (W / 2 - t / 2 - 0.005), 0.11, zf - 0.08, { ink: false });
  }
  // pilasters + head rail
  const pw = 0.11;
  for (const sx of [-1, 1]) f.span(sx > 0 ? W / 2 - pw : -W / 2, sx > 0 ? W / 2 : -W / 2 + pw, 0, H - 0.06, zf, D / 2, PP.stallPost);
  f.span(-W / 2, W / 2, H - 0.06, H, zf, D / 2, PP.metalLight, { ink: false });
  // door, ajar inward (free edge toward −Z) — the hide spot
  const dw = W - 2 * pw - 0.02;
  const d = f.sub(-W / 2 + pw + 0.01, 0, zf + 0.025, 0.38);
  d.span(0, dw, 0.25, H - 0.2, -0.02, 0.0, PP.stallPanel);
  d.span(dw - 0.1, dw - 0.05, 1.0, 1.06, 0.0, 0.02, PP.latch, { ink: false });
  // toilet against the back
  const tz = -D / 2 + 0.25;
  f.span(-0.2, 0.2, 0.4, 0.75, -D / 2 + 0.02, -D / 2 + 0.2, PP.porcelain);
  f.taper(0.22, 0.3, 0.3, 0.42, 0.38, PP.porcelain, 0, 0.19, tz + 0.18, { ink: false });
  f.cyl(0.19, 0.17, 0.06, 12, PP.porcelain, 0, 0.41, tz + 0.2, { scale: [1, 1, 1.25] });
  f.cyl(0.13, 0.13, 0.01, 10, PP.lockerVent, 0, 0.445, tz + 0.21, { scale: [1, 1, 1.25], ink: false });
  f.cyl(0.05, 0.05, 0.1, 8, PP.paper, W / 2 - t - 0.07, 0.75, tz + 0.15, { rot: [0, 0, Math.PI / 2], ink: false });
}

// ── shelf: double-sided bookcase packed with colourful spines ──
function shelf(f: Frame, W: number, D: number, H: number): void {
  const t = 0.05;
  f.span(-W / 2, -W / 2 + t, 0, H, -D / 2, D / 2, PP.woodDark);
  f.span(W / 2 - t, W / 2, 0, H, -D / 2, D / 2, PP.woodDark);
  f.span(-W / 2, W / 2, H - t, H, -D / 2, D / 2, PP.woodDark);
  f.span(-W / 2 + t, W / 2 - t, 0, 0.1, -D / 2 + 0.02, D / 2 - 0.02, shadeHex(PP.woodDark, 0.8), { ink: false });
  f.span(-W / 2 + t, W / 2 - t, 0.1, H - t, -0.012, 0.012, shadeHex(PP.woodDark, 0.7), { ink: false });
  const mid = W > 2.4;
  if (mid) f.span(-0.025, 0.025, 0.1, H - t, -D / 2 + 0.01, D / 2 - 0.01, PP.woodDark, { ink: false });
  const levels = H >= 1.9 ? 4 : 3;
  const step = (H - t - 0.1) / levels;
  const n = Math.max(6, Math.floor((W - 2 * t) / 0.085));
  for (let k = 0; k < levels; k++) {
    const y = 0.1 + k * step;
    if (k > 0) f.span(-W / 2 + t, W / 2 - t, y - 0.025, y, -D / 2 + 0.01, D / 2 - 0.01, PAL.shelf, { ink: false });
    for (const side of [1, -1]) {
      const seed = k * 31 + (side > 0 ? 7 : 3);
      // book mass behind the spines (its top shows from above)
      const zMass = side * (D / 2 - 0.02 - 0.09);
      const minH = step * 0.55;
      f.span(-W / 2 + t, W / 2 - t, y, y + minH, zMass - 0.08, zMass + 0.08, PP.paper, { ink: false });
      // spines as quads on the shelf front
      let x = -W / 2 + t + 0.01;
      const xEnd = W / 2 - t - 0.01;
      for (let i = 0; i < n && x < xEnd - 0.03; i++) {
        const bw = Math.min(xEnd - x, 0.05 + 0.06 * hash01(seed, i, 1));
        if (mid && x < 0.03 && x + bw > -0.03) {
          x = 0.03;
          continue;
        }
        const bh = step * (0.62 + 0.3 * hash01(seed, i, 2));
        const col = PP.books[Math.floor(hash01(seed, i, 3) * PP.books.length)]!;
        if (hash01(seed, i, 4) > 0.93) {
          x += bw + 0.01; // a gap
          continue;
        }
        const zs = side * (D / 2 - 0.02);
        const fr = f.sub(0, 0, zs, side > 0 ? 0 : Math.PI);
        // in the sub-frame local +x runs along the shelf; flip x for the back side so books don't mirror oddly
        const lx = side > 0 ? x + bw / 2 : -(x + bw / 2);
        fr.quad(lx - bw / 2 + 0.003, lx + bw / 2 - 0.003, y, y + bh, 0, col);
        x += bw;
      }
    }
  }
}

// ── cafeteria table: laminate top on a folding frame with attached benches both sides ──
function cafeteriaTable(f: Frame, W: number, D: number, H: number): void {
  const T = H - 0.05; // tabletop surface (trays stay inside h)
  const tD = D * 0.5;
  f.span(-W / 2 + 0.06, W / 2 - 0.06, T - 0.04, T, -tD / 2, tD / 2, PP.cafTop);
  f.span(-W / 2 + 0.08, W / 2 - 0.08, T - 0.07, T - 0.04, -tD / 2 + 0.02, tD / 2 - 0.02, PP.metalDark, { ink: false });
  const bz = D / 2 - 0.12;
  for (const sz of [-1, 1]) {
    f.span(-W / 2 + 0.15, W / 2 - 0.15, 0.41, 0.46, sz * bz - 0.12, sz * bz + 0.12, PP.chairA);
  }
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 - 0.4);
    f.box(0.05, T - 0.07, 0.05, PP.metalLight, x, (T - 0.07) / 2, 0, { ink: false });
    f.span(x - 0.025, x + 0.025, 0.02, 0.06, -bz, bz, PP.metalLight, { ink: false });
    for (const sz of [-1, 1]) f.box(0.04, 0.39, 0.04, PP.metalLight, x, 0.215, sz * bz, { ink: false });
  }
  // a couple of lunch trays
  for (const [tx, tz, rot] of [
    [-W * 0.25, -tD * 0.18, 0.08],
    [W * 0.18, tD * 0.15, -0.12],
  ] as const) {
    f.box(0.36, 0.02, 0.26, PP.tray, tx, T + 0.01, tz, { rot: [0, rot, 0], ink: false });
    f.ball(0.06, 0, PP.mash, tx - 0.07, T + 0.025, tz, { scale: [1, 0.4, 1], ink: false });
    f.box(0.1, 0.012, 0.1, PP.pizza, tx + 0.08, T + 0.026, tz + 0.02, { rot: [0, 0.6, 0], ink: false });
  }
  f.box(0.05, 0.05, 0.05, PP.milk, W * 0.36, T + 0.025, -tD * 0.1, { ink: false });
}

// ── work table (art / band / lab): wood top over an apron, two stools on the +Z (student) side ──
function workTable(f: Frame, W: number, D: number, H: number): void {
  const T = H - 0.05;
  const z1 = D / 2 - 0.3;
  const z0 = -D / 2;
  const dz = (z0 + z1) / 2;
  const tD = z1 - z0;
  f.span(-W / 2, W / 2, T - 0.05, T, z0, z1, PP.laminate);
  f.span(-W / 2 + 0.05, W / 2 - 0.05, T - 0.13, T - 0.05, z0 + 0.04, z1 - 0.04, PP.woodMid, { ink: false });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(0.05, T - 0.05, 0.05, PP.woodMid, sx * (W / 2 - 0.06), (T - 0.05) / 2, dz + sz * (tD / 2 - 0.06), { ink: false });
  // stools
  const sy = Math.min(0.6, H - 0.12);
  for (const sx of [-1, 1]) {
    const x = sx * W * 0.24;
    const z = D / 2 - 0.16;
    f.cyl(0.15, 0.14, 0.05, 10, PP.stool, x, sy - 0.025, z);
    f.cyl(0.025, 0.025, sy - 0.05, 5, PP.metalLight, x, (sy - 0.05) / 2, z, { ink: false });
    f.cyl(0.13, 0.13, 0.02, 8, PP.metalLight, x, 0.01, z, { ink: false });
  }
  // a sketchbook and a paint pot
  f.box(0.3, 0.015, 0.22, PP.paper, -W * 0.2, T + 0.008, dz, { rot: [0, -0.15, 0], ink: false });
  f.cyl(0.045, 0.04, 0.045, 8, PP.mug, W * 0.3, T + 0.023, dz - tD * 0.15, { ink: false });
  f.box(0.012, 0.012, 0.14, PP.pencil, W * 0.18, T + 0.006, dz + tD * 0.1, { rot: [0, 0.5, 0], ink: false });
}

// ── bleachers: stepped wood rows on metal end frames, open (dark) underneath ──
function bleachers(f: Frame, W: number, D: number, H: number): void {
  const rows = 4;
  const rd = D / rows;
  const ex = W / 2 - 0.06;
  // end frames: slanted wedges
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? ex : -W / 2;
    const x1 = sx > 0 ? W / 2 : -ex;
    f.hexa(
      [
        [x0, 0, -D / 2],
        [x1, 0, -D / 2],
        [x1, 0, D / 2],
        [x0, 0, D / 2],
        [x0, H, -D / 2],
        [x1, H, -D / 2],
        [x1, H / rows - 0.06, D / 2],
        [x0, H / rows - 0.06, D / 2],
      ],
      PP.metalDark,
    );
  }
  // shadowy void under the rows
  f.span(-ex, ex, 0, H * 0.72, -D / 2, -D / 2 + D * 0.55, 0x2a2b31, { ink: false });
  for (let k = 0; k < rows; k++) {
    const y = (H * (rows - k)) / rows; // row 0 at the back (−Z) is the highest
    const zb = -D / 2 + k * rd;
    f.span(-ex, ex, y - 0.07, y, zb, zb + rd * 0.62, PAL.bleachers);
    // footboard and a short riser apron (gaps between rows read as the hide spot)
    f.span(-ex, ex, y - 0.07 - H / rows * 0.45, y - 0.07 - H / rows * 0.45 + 0.04, zb + rd * 0.62, zb + rd, shadeHex(PAL.bleachers, 0.85), { ink: false });
    f.span(-ex, ex, y - 0.2, y - 0.07, zb + rd * 0.58, zb + rd * 0.62, PP.metalDark, { ink: false });
  }
}

// ── vending machines set into the corridor strip (two side by side when wide) ──
function vending(f: Frame, W: number, D: number, H: number, variant: PropVariant): void {
  const m = W >= 1.5 ? 2 : 1;
  const mw = W / m;
  for (let i = 0; i < m; i++) {
    const cx = -W / 2 + mw * (i + 0.5);
    const w = mw - 0.04;
    const body = i === 0 ? PAL.vending : PP.vendTeal;
    f.span(cx - w / 2, cx + w / 2, 0, H, -D / 2, D / 2 - 0.02, body);
    const z = D / 2 - 0.02; // front face; panels stand ≤ 1.5 cm proud of it
    const gx0 = cx - w / 2 + 0.06;
    const gx1 = cx + w / 2 - 0.26;
    // glowing window with snack rows
    f.span(gx0, gx1, 0.62, H - 0.24, z - 0.02, z, PP.vendGlass, { ink: false, glow: PP.vendGlass });
    const rowsN = 4;
    const cols = 3;
    for (let r = 0; r < rowsN; r++) {
      const ry = 0.7 + r * ((H - 0.24 - 0.7) / rowsN);
      f.quad(gx0 + 0.01, gx1 - 0.01, ry - 0.012, ry, z + 0.002, PP.vendDark, { glow: shadeHex(PP.vendDark, 1.6) });
      for (let c = 0; c < cols; c++) {
        const sw = (gx1 - gx0 - 0.04) / cols;
        const sx = gx0 + 0.02 + sw * (c + 0.5);
        const col = PP.snacks[(r * cols + c + i * 2) % PP.snacks.length]!;
        f.quad(sx - sw * 0.32, sx + sw * 0.32, ry + 0.01, ry + 0.17, z + 0.003, col, { glow: col });
      }
    }
    // keypad, coin slot, pickup flap, brand stripe
    const kx = cx + w / 2 - 0.14;
    f.span(kx - 0.08, kx + 0.08, 1.0, 1.3, z - 0.01, z + 0.012, PP.vendDark, { ink: false });
    f.quad(kx - 0.06, kx + 0.06, 1.22, 1.27, z + 0.014, PP.scoreDigit, { glow: PP.scoreDigit });
    f.span(kx - 0.03, kx + 0.03, 0.9, 0.96, z - 0.01, z + 0.012, PP.chrome, { ink: false });
    f.span(gx0, gx1, 0.18, 0.4, z - 0.01, z + 0.012, PP.vendDark, { ink: false });
    f.span(cx - w / 2, cx + w / 2, H - 0.2, H - 0.06, z - 0.01, z + 0.01, i === 0 ? PP.paper : PP.paperYellow, { ink: false });
    if (variant === 'goal') {
      f.span(gx0 - 0.03, gx1 + 0.03, 0.58, 0.62, z - 0.01, z + 0.015, PAL.goal, { ink: false, glow: PAL.goal });
      f.span(gx0 - 0.03, gx1 + 0.03, H - 0.24, H - 0.21, z - 0.01, z + 0.015, PAL.goal, { ink: false, glow: PAL.goal });
    }
  }
}

// ── cafeteria serving counter (kind 'vending' at 4.0 × 0.8): wells, tray slide, sneeze guard, register ──
function servingCounter(f: Frame, W: number, D: number, H: number, variant: PropVariant): void {
  const slide = 0.24;
  const zb = D / 2 - slide; // body front
  const ch = 0.9;
  f.span(-W / 2, W / 2, 0, ch, -D / 2, zb, PP.stainless);
  f.span(-W / 2 + 0.05, W / 2 - 0.05, 0.12, ch - 0.12, zb, zb + 0.012, PP.counterFront, { ink: false });
  f.span(-W / 2, W / 2, 0, 0.1, zb - 0.02, zb + 0.015, PP.metalDark, { ink: false });
  // tray slide: two rails on brackets
  for (const z of [zb + 0.06, D / 2 - 0.04]) f.span(-W / 2 + 0.05, W / 2 - 0.05, ch - 0.1, ch - 0.07, z - 0.015, z + 0.015, PP.chrome, { ink: false });
  for (const x of [-W / 2 + 0.3, 0, W / 2 - 0.3]) f.span(x - 0.02, x + 0.02, ch - 0.12, ch - 0.08, zb, D / 2 - 0.02, PP.chrome, { ink: false });
  // food wells
  const foods = [PP.pizza, PP.corn, PP.peas, PP.mash, PP.sauce];
  const nW = Math.max(3, Math.min(5, Math.floor((W - 1.2) / 0.55)));
  const wellW = 0.46;
  const x0 = -((nW - 1) * 0.55) / 2 - 0.25;
  for (let i = 0; i < nW; i++) {
    const x = x0 + i * 0.55;
    f.span(x - wellW / 2, x + wellW / 2, ch - 0.005, ch + 0.01, -D / 2 + 0.06, zb - 0.06, PP.metalDark, { ink: false });
    f.span(x - wellW / 2 + 0.03, x + wellW / 2 - 0.03, ch + 0.01, ch + 0.03, -D / 2 + 0.09, zb - 0.09, foods[i % foods.length]!, { ink: false });
  }
  // sneeze guard
  const gy = ch + 0.5;
  for (const x of [x0 - 0.3, x0 + (nW - 1) * 0.55 + 0.3]) f.box(0.03, 0.5, 0.03, PP.chrome, x, ch + 0.25, zb - 0.04, { ink: false });
  const gw = (nW - 1) * 0.55 + 0.66;
  f.box(gw, 0.36, 0.015, PP.glass, x0 + ((nW - 1) * 0.55) / 2, gy - 0.12, zb - 0.12, { rot: [0.55, 0, 0] });
  f.box(gw, 0.02, 0.2, PP.chrome, x0 + ((nW - 1) * 0.55) / 2, gy + 0.05, zb - 0.16, { ink: false });
  // heat-lamp bar over the wells
  const hy = Math.min(H - 0.08, ch + 0.85);
  for (const x of [x0 - 0.3, x0 + (nW - 1) * 0.55 + 0.3]) f.box(0.03, hy - gy, 0.03, PP.chrome, x, (hy + gy) / 2, -D / 2 + 0.12, { ink: false });
  f.box(gw, 0.07, 0.12, PP.metalDark, x0 + ((nW - 1) * 0.55) / 2, hy + 0.035, -D / 2 + 0.12);
  f.box(gw - 0.1, 0.012, 0.08, PP.scoreDigit, x0 + ((nW - 1) * 0.55) / 2, hy - 0.006, -D / 2 + 0.12, { ink: false, glow: PP.scoreDigit });
  // stacked trays at the start of the line, register at the end
  const tx = -W / 2 + 0.28;
  for (let k = 0; k < 4; k++) f.box(0.36, 0.018, 0.26, shadeHex(PP.tray, 1 - k * 0.04), tx, ch + 0.01 + k * 0.022, -D * 0.12, { ink: false });
  const rx = W / 2 - 0.3;
  f.span(rx - 0.18, rx + 0.18, ch, ch + 0.14, -D / 2 + 0.08, zb - 0.06, PP.monitor);
  f.box(0.2, 0.12, 0.02, PP.screen, rx, ch + 0.24, -D / 2 + 0.2, { rot: [-0.3, 0, 0], ink: false, glow: PP.screen });
  f.box(0.04, 0.12, 0.04, PP.monitor, rx, ch + 0.17, -D / 2 + 0.2, { ink: false });
  if (variant === 'goal') {
    // the mission pizza box, glowing on the counter
    const px = x0 + 0.55;
    f.box(0.4, 0.06, 0.36, PP.cardboard, px, Math.min(H, gy + 0.12) - 0.03, zb - 0.2);
    f.box(0.42, 0.02, 0.38, PAL.goal, px, Math.min(H, gy + 0.12) - 0.075, zb - 0.2, { ink: false, glow: PAL.goal });
  }
}

// ── office desk: L of pedestals, monitor facing the worker (−Z), keyboard, in-tray; goal = glowing drawer ──
function officeDesk(f: Frame, W: number, D: number, H: number, variant: PropVariant): void {
  const T = H - 0.2; // surface: the laptop lid, phone and in-tray stay inside h
  const top = T - 0.05;
  f.span(-W / 2, W / 2, top, T, -D / 2, D / 2, PP.laminate);
  const pw = Math.min(0.45, W * 0.25);
  for (const sx of [-1, 1]) f.span(sx > 0 ? W / 2 - pw - 0.02 : -W / 2 + 0.02, sx > 0 ? W / 2 - 0.02 : -W / 2 + pw + 0.02, 0, top, -D / 2 + 0.03, D / 2 - 0.03, PP.trayGrey);
  f.span(-W / 2 + pw + 0.02, W / 2 - pw - 0.02, 0.16, top, D / 2 - 0.06, D / 2 - 0.03, PP.trayGrey, { ink: false });
  // drawers (worker side, right pedestal)
  const px = W / 2 - 0.02 - pw / 2;
  for (let k = 0; k < 3; k++) {
    const y0 = 0.05 + k * ((top - 0.06) / 3);
    const y1 = y0 + (top - 0.06) / 3 - 0.03;
    const goal = variant === 'goal' && k === 1;
    const out = goal ? 0.1 : 0;
    // the goal drawer is pulled out (but stays inside the footprint) and glows
    f.span(px - pw / 2 + 0.03, px + pw / 2 - 0.03, y0, y1, -D / 2 + 0.015 + (goal ? 0 : 0), -D / 2 + 0.03 + out, goal ? PAL.goal : shadeHex(PP.trayGrey, 1.2), goal ? { glow: PAL.goal } : { ink: false });
    f.box(0.12, 0.025, 0.02, PP.metalLight, px, (y0 + y1) / 2, -D / 2 + 0.01, { ink: false });
  }
  // laptop, screen facing the worker (−Z)
  const lx = -W * 0.05;
  const lz = D * 0.05;
  f.box(0.36, 0.02, 0.24, PP.monitor, lx, T + 0.01, lz, { ink: false });
  f.box(0.3, 0.012, 0.12, PP.keyboard, lx, T + 0.021, lz - 0.03, { ink: false });
  const lid = f.sub(lx, T + 0.02, lz + 0.12, 0);
  lid.box(0.36, 0.17, 0.016, PP.monitor, 0, 0.08, 0, { rot: [0.22, 0, 0] });
  lid.box(0.31, 0.13, 0.004, PP.screen, 0, 0.08, -0.01, { rot: [0.22, 0, 0], ink: false, glow: PP.screen });
  // in-tray with papers
  f.span(-W / 2 + 0.08, -W / 2 + 0.42, T, T + 0.07, -D * 0.1, D * 0.22, PP.trayGrey);
  f.box(0.3, 0.04, 0.24, PP.paper, -W / 2 + 0.25, T + 0.04, D * 0.06, { ink: false });
  // desk phone, mug, little cactus, nameplate
  f.box(0.16, 0.05, 0.2, PP.monitor, W * 0.28, T + 0.025, D * 0.1, { ink: false });
  f.box(0.05, 0.04, 0.2, PP.monitor, W * 0.28 - 0.06, T + 0.07, D * 0.1, { ink: false });
  f.cyl(0.04, 0.036, 0.1, 8, PP.mug, W * 0.38, T + 0.05, -D * 0.25, { ink: false });
  f.cyl(0.05, 0.04, 0.08, 8, PP.plantPot, W * 0.4, T + 0.04, D * 0.3, { ink: false });
  f.cyl(0.025, 0.03, 0.1, 6, PAL.plant, W * 0.4, T + 0.13, D * 0.3, { ink: false });
  f.box(0.3, 0.06, 0.04, PP.woodDark, 0, T + 0.03, D / 2 - 0.05, { rot: [-0.4, 0, 0], ink: false });
  if (variant === 'goal') f.box(0.08, 0.004, 0.08, PAL.goal, W * 0.15, T + 0.002, -D * 0.3, { ink: false, glow: PAL.goal });
}

// ── trophy case: wood base cabinet, glass case with shelves and trophies ──
function trophyCase(f: Frame, W: number, D: number, H: number, variant: PropVariant): void {
  const bh = 0.7;
  f.span(-W / 2, W / 2, 0, bh, -D / 2, D / 2 - 0.012, PP.woodDark);
  for (const sx of [-1, 1]) f.quad(sx > 0 ? 0.02 : -W / 2 + 0.06, sx > 0 ? W / 2 - 0.06 : -0.02, 0.1, bh - 0.08, D / 2 - 0.008, shadeHex(PP.woodDark, 1.18));
  // glass case frame
  const t = 0.05;
  f.span(-W / 2, -W / 2 + t, bh, H, -D / 2, D / 2, PP.woodDark);
  f.span(W / 2 - t, W / 2, bh, H, -D / 2, D / 2, PP.woodDark);
  f.span(-W / 2, W / 2, H - 0.08, H, -D / 2, D / 2, PP.woodDark);
  f.span(-W / 2 + t, W / 2 - t, bh, H - 0.08, -D / 2, -D / 2 + 0.03, PP.felt, { ink: false });
  // glass glints (the pane itself is clear)
  f.quad(-W * 0.34, -W * 0.32, bh + 0.3, H - 0.3, D / 2 - 0.01, PP.glass, { rot: [0, 0, 0.5] });
  f.quad(-W * 0.29, -W * 0.28, bh + 0.35, H - 0.4, D / 2 - 0.01, PP.glass, { rot: [0, 0, 0.5] });
  f.span(-W / 2 + t, W / 2 - t, H - 0.1, H - 0.08, D / 2 - 0.02, D / 2 - 0.005, PP.chrome, { ink: false });
  const shelfY = [bh + 0.02, bh + (H - bh) * 0.5];
  f.span(-W / 2 + t, W / 2 - t, shelfY[1]! - 0.015, shelfY[1]!, -D / 2 + 0.03, D / 2 - 0.03, PP.glass, { ink: false });
  const metals = [PP.gold, PP.silver, PP.gold, PP.bronze, PP.gold, PP.silver];
  let i = 0;
  for (const y of shelfY) {
    const n = 3;
    for (let k = 0; k < n; k++) {
      const x = -W / 2 + t + ((W - 2 * t) * (k + 0.5)) / n;
      const col = metals[i++ % metals.length]!;
      const s = 0.8 + 0.4 * hash01(i, 5);
      f.box(0.12 * s, 0.05, 0.1 * s, PP.woodDark, x, y + 0.025, -0.02, { ink: false });
      f.cyl(0.015, 0.03, 0.1 * s, 6, col, x, y + 0.05 + 0.05 * s, -0.02, { ink: false });
      f.lathe(
        [
          [0.0, 0],
          [0.03, 0.01],
          [0.07, 0.12],
          [0.075, 0.13],
          [0.0, 0.12],
        ],
        8,
        col,
        x,
        y + 0.05 + 0.1 * s,
        -0.02,
        { scale: [s, s, s], ink: false },
      );
    }
  }
  // a pennant on the back felt
  f.taper(0.4, 0.005, 0.0, 0.005, 0.16, PP.books[0]!, W * 0.32, H - 0.25, -D / 2 + 0.035, { rot: [0, 0, -Math.PI / 2], ink: false });
  if (variant === 'goal') f.quad(-0.2, 0.2, bh - 0.2, bh - 0.08, D / 2 - 0.004, PAL.goal, { glow: PAL.goal });
}

// ── courtyard bench: slats on concrete ends, on a little paver pad ──
function bench(f: Frame, W: number, D: number, H: number): void {
  f.span(-W / 2, W / 2, 0, 0.03, -D / 2, D / 2, PP.concrete, { ink: false });
  const sw = W - 0.1;
  const sd = Math.min(0.5, D * 0.55);
  for (let k = 0; k < 3; k++) {
    const z = -sd / 2 + (sd * (k + 0.5)) / 3;
    f.span(-sw / 2, sw / 2, H - 0.05, H, z - sd / 6 + 0.012, z + sd / 6 - 0.012, PP.woodMid);
  }
  for (const sx of [-1, 1]) f.span(sx * (sw / 2 - 0.18) - 0.07, sx * (sw / 2 - 0.18) + 0.07, 0.03, H - 0.05, -sd / 2 + 0.03, sd / 2 - 0.03, shadeHex(PP.concrete, 0.9));
}

// ── planter: brick box with a concrete cap, soil and round shrubs ──
function planter(f: Frame, W: number, D: number, H: number): void {
  const bh = Math.min(0.38, H * 0.55);
  f.span(-W / 2 + 0.03, W / 2 - 0.03, 0, bh, -D / 2 + 0.03, D / 2 - 0.03, PAL.brick);
  f.span(-W / 2, W / 2, bh, bh + 0.05, -D / 2, D / 2, PP.concrete);
  f.span(-W / 2 + 0.07, W / 2 - 0.07, bh + 0.05, bh + 0.06, -D / 2 + 0.07, D / 2 - 0.07, PP.soil, { ink: false });
  const room = H - bh - 0.06;
  const r = Math.min(D * 0.32, W * 0.2);
  const xs = [-W * 0.27, 0.02, W * 0.28];
  xs.forEach((x, i) => {
    const rr = r * (i === 1 ? 1 : 0.85);
    const ry = Math.min(rr * 0.85, (room * (i === 1 ? 1 : 0.85)) / 1.6);
    f.ball(rr, 1, i === 1 ? PP.shrub : PP.shrubDark, x, bh + 0.06 + ry * 0.6, (i - 1) * 0.04, { scale: [1, ry / rr, 1], smooth: true });
  });
  for (let k = 0; k < 5; k++) {
    const x = -W / 2 + 0.16 + (W - 0.32) * (k / 4);
    f.ball(0.035, 0, [PP.flowerA, PP.flowerB, PP.flowerC][k % 3]!, x, bh + 0.09, D / 2 - 0.13, { ink: false });
  }
}
