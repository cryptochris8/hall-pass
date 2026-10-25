// ─────────────────────────────────────────────────────────────────────────────
// Dressing pieces, authored in a Frame (kit.ts):
//   • wall pieces — frame origin on the wall face at the piece's centre line,
//     y = 0 at the floor, local +Z out of the wall;
//   • floor pieces — frame origin on the floor, local +Z = the way it faces
//     (pieces that stand against a wall have their back at local z = 0).
// Chunky inked silhouettes, flat un-inked details. Text goes on TextQuads.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PAL } from '../../render/palette';
import { hash01, mixHex, shadeHex, type V3 } from '../../render/models/builder';
import type { Rng } from '../../core/rng';
import { Frame } from './kit';
import { PP } from './palette';
import type { TextQuad } from './text';

export const DOOR_H = 2.2;
export const WALL_TOP = 3.0;

/** Text quad on a frame's local XY plane at depth z (front = local +Z). */
export function textQuad(f: Frame, slot: number, x0: number, x1: number, y0: number, y1: number, z: number, flip = false): TextQuad {
  const n = f.dir(0, 0, flip ? -1 : 1);
  const bl = flip ? f.at(x1, y0, z) : f.at(x0, y0, z);
  const br = flip ? f.at(x0, y0, z) : f.at(x1, y0, z);
  const tr = flip ? f.at(x0, y1, z) : f.at(x1, y1, z);
  const tl = flip ? f.at(x1, y1, z) : f.at(x0, y1, z);
  return { slot, corners: [bl, br, tr, tl], normal: n as V3 };
}

// ── doors ──

/** Painted metal frame around a door opening (opening centred on x = 0, `half` = half width). */
export function doorFrame(f: Frame, half: number): void {
  const t = 0.1;
  for (const sx of [-1, 1]) f.span(sx * half - (sx > 0 ? 0.03 : t), sx * half + (sx > 0 ? t : 0.03), 0, DOOR_H + 0.1, 0, 0.05, PP.doorFrame);
  f.span(-half - t, half + t, DOOR_H - 0.02, DOOR_H + 0.1, 0, 0.05, PP.doorFrame);
}

/** Lintel over the opening: wall-coloured box filling the passage from the face `depth` m into the wall. */
export function lintel(f: Frame, half: number, depth: number): void {
  f.span(-half, half, DOOR_H, WALL_TOP, -depth, 0, PAL.wall, { ink: false });
  f.span(-half, half, WALL_TOP - 0.002, WALL_TOP, -depth, 0, PP.lintelTop, { ink: false });
}

/** Open door leaf lying back against the wall (hinge at x = 0, leaf toward +x·side). */
export function doorLeaf(f: Frame, side: 1 | -1, w: number): void {
  const x0 = side > 0 ? 0.02 : -w - 0.02;
  const x1 = side > 0 ? w + 0.02 : -0.02;
  f.span(x0, x1, 0.02, DOOR_H - 0.04, 0.03, 0.08, PP.doorWood);
  // narrow window, kick plate, handle
  const wx = side > 0 ? w * 0.72 : -w * 0.72;
  f.span(wx - 0.09, wx + 0.09, 1.2, 1.85, 0.08, 0.085, PP.doorGlass, { ink: false });
  f.span(x0 + 0.05, x1 - 0.05, 0.05, 0.25, 0.08, 0.084, PP.metalLight, { ink: false });
  const hx = side > 0 ? w - 0.1 : -w + 0.1;
  f.box(0.04, 0.04, 0.08, PP.metalLight, hx, 1.0, 0.12, { ink: false });
}

/** Sign plate (navy, inked) for a text quad; returns the text area. */
export function signPlate(f: Frame, w: number, h: number, yc: number, z = 0): { x0: number; x1: number; y0: number; y1: number; z: number } {
  f.span(-w / 2, w / 2, yc - h / 2, yc + h / 2, z, z + 0.04, PP.signNavy);
  return { x0: -w / 2 + 0.03, x1: w / 2 - 0.03, y0: yc - h / 2 + 0.03, y1: yc + h / 2 - 0.03, z: z + 0.042 };
}

/** Flag-mounted double-sided sign sticking out of the wall (plate in the local YZ plane). */
export function flagSignPlate(f: Frame, w: number, h: number, yc: number): void {
  f.box(0.04, 0.04, 0.12, PP.metalDark, 0, yc + h / 2 + 0.02, 0.06, { ink: false });
  f.span(-0.02, 0.02, yc - h / 2, yc + h / 2, 0.08, 0.08 + w, PP.signNavy);
}

// ── boards / posters / clocks ──

export function whiteboard(f: Frame, w: number, rng: Rng, style: 'class' | 'music' | 'lab' | 'art'): void {
  const y0 = 0.95;
  const y1 = 2.05;
  f.span(-w / 2, w / 2, y0, y1, 0, 0.05, PP.boardFrame);
  f.quad(-w / 2 + 0.05, w / 2 - 0.05, y0 + 0.05, y1 - 0.05, 0.052, PP.whiteboard);
  // marker tray + markers
  f.span(-w / 2 + 0.1, w / 2 - 0.1, y0 - 0.03, y0, 0, 0.1, PP.boardFrame, { ink: false });
  [PP.markerBlue, PP.markerRed, PP.markerGreen].forEach((c, i) => f.box(0.11, 0.022, 0.022, c, -w * 0.3 + i * 0.16, y0 + 0.012, 0.06, { ink: false }));
  f.box(0.13, 0.05, 0.05, PP.paper, w * 0.3, y0 + 0.02, 0.06, { ink: false });
  const z = 0.056;
  const ink = (c: number, x0: number, x1: number, y: number, t = 0.022) => f.quad(x0, x1, y - t / 2, y + t / 2, z, c);
  if (style === 'music') {
    for (let staff = 0; staff < 2; staff++) {
      const sy = y1 - 0.25 - staff * 0.42;
      for (let l = 0; l < 5; l++) ink(PP.markerBlack, -w / 2 + 0.2, w / 2 - 0.2, sy - l * 0.045, 0.01);
      for (let n = 0; n < 9; n++) {
        const nx = -w / 2 + 0.45 + n * ((w - 0.8) / 9);
        const ny = sy - 0.2 + 0.18 * rng.next();
        f.ball(0.025, 0, PP.markerBlack, nx, ny, z, { scale: [1.2, 0.9, 0.2], ink: false });
        f.quad(nx + 0.022, nx + 0.032, ny, ny + 0.14, z, PP.markerBlack);
      }
    }
    return;
  }
  // title line + scribbled "text" rows
  ink(PP.markerRed, -w / 2 + 0.25, -w / 2 + 0.25 + w * 0.35, y1 - 0.18, 0.045);
  const rows = 5;
  for (let r = 0; r < rows; r++) {
    const ry = y1 - 0.34 - r * 0.12;
    let x = -w / 2 + 0.25;
    const end = (style === 'lab' || style === 'art' ? 0.05 : 0.35) * w;
    while (x < end) {
      const lw = 0.08 + 0.22 * rng.next();
      ink(r % 3 === 2 ? PP.markerGreen : PP.markerBlue, x, Math.min(end, x + lw), ry, 0.026);
      x += lw + 0.05;
    }
  }
  if (style === 'lab') {
    // a molecule doodle
    const cx = w * 0.27;
    const cy = (y0 + y1) / 2;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      f.ball(0.05, 0, k % 2 ? PP.markerRed : PP.markerBlue, cx + Math.cos(a) * 0.2, cy + Math.sin(a) * 0.2, z, { scale: [1, 1, 0.2], ink: false });
      f.quad(cx - 0.008, cx + 0.008, cy, cy + 0.2, z - 0.001, PP.markerBlack, { rot: [0, 0, a - Math.PI / 2] });
    }
  } else if (style === 'art') {
    // a sun doodle + wavy hills
    const cx = w * 0.28;
    const cy = y1 - 0.35;
    f.ball(0.09, 1, PP.pencil, cx, cy, z, { scale: [1, 1, 0.15], ink: false });
    for (let k = 0; k < 8; k++) f.quad(cx - 0.008, cx + 0.008, cy + 0.12, cy + 0.2, z, PP.pencil, { rot: [0, 0, (k / 8) * Math.PI * 2] });
    for (let k = 0; k < 4; k++) f.ball(0.16, 0, PP.markerGreen, w * 0.05 + k * 0.22, y0 + 0.12, z - 0.002, { scale: [1, 0.45, 0.1], ink: false });
  } else {
    // a math doodle: boxed answer + a smiley
    const bx = w * 0.18;
    const by = y0 + 0.35;
    f.quad(bx - 0.2, bx + 0.2, by - 0.1, by - 0.085, z, PP.markerRed);
    f.quad(bx - 0.2, bx + 0.2, by + 0.085, by + 0.1, z, PP.markerRed);
    f.quad(bx - 0.2, bx - 0.185, by - 0.1, by + 0.1, z, PP.markerRed);
    f.quad(bx + 0.185, bx + 0.2, by - 0.1, by + 0.1, z, PP.markerRed);
    ink(PP.markerBlue, bx - 0.15, bx + 0.15, by, 0.03);
    const sx = w * 0.36;
    const sy = y1 - 0.4;
    f.torus(0.1, 0.01, 3, 14, PP.markerGreen, sx, sy, z, { ink: false });
    f.box(0.02, 0.02, 0.004, PP.markerGreen, sx - 0.035, sy + 0.03, z, { ink: false });
    f.box(0.02, 0.02, 0.004, PP.markerGreen, sx + 0.035, sy + 0.03, z, { ink: false });
    f.torus(0.05, 0.008, 3, 8, PP.markerGreen, sx, sy - 0.005, z, { ink: false, rot: [0, 0, Math.PI] }, Math.PI);
  }
}

export function clock(f: Frame, yc: number, r = 0.2): void {
  f.cyl(r, r, 0.06, 14, PP.clockRim, 0, yc, 0.03, { rot: [Math.PI / 2, 0, 0] });
  f.cyl(r * 0.84, r * 0.84, 0.01, 14, PP.clockFace, 0, yc, 0.062, { rot: [Math.PI / 2, 0, 0], ink: false });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2;
    f.box(0.016, 0.04, 0.004, PP.clockRim, Math.sin(a) * r * 0.68, yc + Math.cos(a) * r * 0.68, 0.068, { rot: [0, 0, -a], ink: false });
  }
  // 2:55 — five minutes to the bell
  const hand = (len: number, a: number, t: number) => f.box(t, len, 0.006, PP.clockRim, (Math.sin(a) * len) / 2, yc + (Math.cos(a) * len) / 2, 0.072, { rot: [0, 0, -a], ink: false });
  hand(r * 0.5, (2.9 / 12) * Math.PI * 2, 0.03);
  hand(r * 0.72, (55 / 60) * Math.PI * 2, 0.018);
  f.box(0.01, r * 0.7, 0.004, PP.markerRed, 0, yc + r * 0.25, 0.076, { rot: [0, 0, -0.5], ink: false });
}

export function bulletinBoard(f: Frame, w: number, h: number, y0: number, rng: Rng): void {
  f.span(-w / 2, w / 2, y0, y0 + h, 0, 0.04, PP.woodMid);
  f.quad(-w / 2 + 0.05, w / 2 - 0.05, y0 + 0.05, y0 + h - 0.05, 0.042, PP.cork);
  const papers = [PP.paper, PP.paperYellow, PP.paperPink, PP.paperBlue, PP.paperGreen];
  const n = Math.max(3, Math.round(w / 0.32));
  for (let i = 0; i < n; i++) {
    const pw = 0.18 + 0.1 * rng.next();
    const ph = 0.22 + 0.12 * rng.next();
    const px = -w / 2 + 0.12 + ((w - 0.24) * (i + 0.5)) / n + (rng.next() - 0.5) * 0.06;
    const py = y0 + 0.12 + (h - 0.24 - ph) * rng.next() + ph / 2;
    const col = papers[Math.floor(rng.next() * papers.length)]!;
    f.quad(px - pw / 2, px + pw / 2, py - ph / 2, py + ph / 2, 0.045 + i * 0.0015, col, { rot: [0, 0, (rng.next() - 0.5) * 0.25] });
    // a few lines of "writing"
    for (let l = 0; l < 3; l++) f.quad(px - pw * 0.35, px + pw * (0.1 + 0.25 * hash01(i, l)), py + ph * 0.25 - l * ph * 0.18, py + ph * 0.25 - l * ph * 0.18 + 0.012, 0.046 + i * 0.0015, PP.markerBlue);
    f.box(0.02, 0.02, 0.012, [PP.markerRed, PP.markerBlue, PP.pencil][i % 3]!, px, py + ph / 2 - 0.03, 0.056 + i * 0.0015, { ink: false });
  }
}

export type PosterKind = 'shapes' | 'stripes' | 'periodic' | 'note' | 'paint' | 'fruit' | 'book' | 'mountain' | 'certificate';

export function poster(f: Frame, w: number, h: number, y0: number, kind: PosterKind, rng: Rng, colours: readonly [number, number]): void {
  const z = 0.012;
  const framed = kind === 'certificate';
  if (framed) f.span(-w / 2, w / 2, y0, y0 + h, 0, 0.035, PP.woodDark);
  else f.span(-w / 2, w / 2, y0, y0 + h, 0, 0.01, PP.paper);
  const cx = 0;
  const cy = y0 + h / 2;
  const zz = framed ? 0.037 : z;
  const b = 0.04;
  const bg = kind === 'periodic' ? PP.paper : kind === 'certificate' ? PP.paper : mixHex(colours[0], 0xffffff, 0.15 + 0.3 * rng.next());
  f.quad(-w / 2 + b, w / 2 - b, y0 + b, y0 + h - b, zz, bg);
  const zf = zz + 0.002;
  switch (kind) {
    case 'periodic':
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 9; c++) {
          if (r === 0 && c > 0 && c < 8) continue;
          if (r === 1 && c > 1 && c < 6) continue;
          const cw = (w - 2 * b - 0.04) / 9;
          const ch = (h - 2 * b - 0.12) / 5;
          const col = [PP.paperPink, PP.paperYellow, PP.paperBlue, PP.paperGreen][(c + r) % 4]!;
          const x = -w / 2 + b + 0.02 + cw * c;
          const y = y0 + h - b - 0.1 - ch * (r + 1);
          f.quad(x + 0.004, x + cw - 0.004, y + 0.004, y + ch - 0.004, zf, col);
        }
      }
      f.quad(-w * 0.3, w * 0.3, y0 + h - b - 0.07, y0 + h - b - 0.03, zf, PP.markerBlack);
      break;
    case 'note':
      f.ball(h * 0.11, 1, colours[1], cx - w * 0.1, cy - h * 0.15, zf, { scale: [1.25, 0.9, 0.15], ink: false });
      f.quad(cx - w * 0.1 + h * 0.1, cx - w * 0.1 + h * 0.13, cy - h * 0.15, cy + h * 0.25, zf, colours[1]);
      f.quad(cx - w * 0.1 + h * 0.1, cx + w * 0.25, cy + h * 0.2, cy + h * 0.25, zf, colours[1], { rot: [0, 0, -0.15] });
      break;
    case 'paint':
      for (let k = 0; k < 5; k++) {
        const col = PP.snacks[(k + Math.floor(rng.next() * 7)) % PP.snacks.length]!;
        f.ball(0.06 + 0.05 * rng.next(), 0, col, cx + (rng.next() - 0.5) * w * 0.6, cy + (rng.next() - 0.5) * h * 0.6, zf + k * 0.001, { scale: [1, 1, 0.1], ink: false });
      }
      break;
    case 'fruit':
      f.ball(h * 0.14, 1, PP.apple, cx - w * 0.14, cy, zf, { scale: [1, 1, 0.12], ink: false });
      f.ball(h * 0.12, 1, PP.corn, cx + w * 0.16, cy + h * 0.06, zf, { scale: [0.8, 1.2, 0.12], ink: false });
      f.ball(h * 0.1, 1, PP.peas, cx + w * 0.02, cy - h * 0.22, zf, { scale: [1, 1, 0.12], ink: false });
      f.quad(-w * 0.32, w * 0.32, y0 + h - 0.16, y0 + h - 0.1, zf, colours[0]);
      break;
    case 'book':
      f.quad(cx - w * 0.28, cx - 0.01, cy - h * 0.12, cy + h * 0.14, zf, PP.paper, { rot: [0, 0, 0.12] });
      f.quad(cx + 0.01, cx + w * 0.28, cy - h * 0.12, cy + h * 0.14, zf, PP.paper, { rot: [0, 0, -0.12] });
      f.quad(-w * 0.3, w * 0.3, y0 + h - 0.17, y0 + h - 0.1, zf, colours[1]);
      break;
    case 'mountain':
      f.cone(w * 0.28, h * 0.45, 3, colours[0], cx - w * 0.08, y0 + b + h * 0.225, zf, { scale: [1, 1, 0.02], ink: false });
      f.cone(w * 0.2, h * 0.32, 3, shadeHex(colours[0], 0.8), cx + w * 0.2, y0 + b + h * 0.16, zf + 0.001, { scale: [1, 1, 0.02], ink: false });
      f.ball(w * 0.08, 0, PP.pencil, cx + w * 0.22, y0 + h * 0.72, zf, { scale: [1, 1, 0.1], ink: false });
      f.quad(-w * 0.32, w * 0.32, y0 + b + 0.03, y0 + b + 0.07, zf + 0.002, PP.paper);
      break;
    case 'stripes':
      for (let k = 0; k < 3; k++) f.quad(-w / 2 + b, w / 2 - b, y0 + h * (0.2 + k * 0.22), y0 + h * (0.2 + k * 0.22) + h * 0.1, zf, k % 2 ? colours[1] : colours[0]);
      break;
    case 'certificate':
      f.quad(-w * 0.32, w * 0.32, y0 + h * 0.66, y0 + h * 0.72, zf, PP.markerBlack);
      for (let k = 0; k < 3; k++) f.quad(-w * 0.28, w * 0.28, y0 + h * (0.44 - k * 0.1), y0 + h * (0.44 - k * 0.1) + 0.01, zf, PP.lockerVent);
      f.ball(0.05, 0, PP.gold, w * 0.25, y0 + h * 0.18, zf, { scale: [1, 1, 0.2], ink: false });
      break;
    default:
      // bold shapes
      f.ball(h * 0.16, 1, colours[1], cx - w * 0.12, cy + h * 0.1, zf, { scale: [1, 1, 0.12], ink: false });
      f.cone(h * 0.2, h * 0.3, 3, shadeHex(colours[0], 0.75), cx + w * 0.12, cy - h * 0.12, zf + 0.001, { scale: [1, 1, 0.02], ink: false });
      f.quad(-w * 0.32, w * 0.32, y0 + b + 0.04, y0 + b + 0.08, zf, colours[1]);
  }
}

/** Window with frame, mullions and sill. `exterior` = seen from outside (cool glass, no glow). */
export function windowUnit(f: Frame, w: number, y0: number, y1: number, exterior: boolean): void {
  const t = 0.07;
  f.span(-w / 2, w / 2, y0, y1, 0, 0.05, PP.windowFrame);
  const glass = exterior ? 0x8fb6c8 : PP.windowGlow;
  f.span(-w / 2 + t, w / 2 - t, y0 + t, y1 - t, 0.05, 0.056, glass, exterior ? { ink: false } : { ink: false, glow: glass });
  f.span(-0.025, 0.025, y0 + t, y1 - t, 0.056, 0.07, PP.windowFrame, { ink: false });
  f.span(-w / 2 + t, w / 2 - t, y0 + (y1 - y0) * 0.62 - 0.02, y0 + (y1 - y0) * 0.62 + 0.02, 0.056, 0.07, PP.windowFrame, { ink: false });
  f.span(-w / 2 - 0.06, w / 2 + 0.06, y0 - 0.06, y0, 0, 0.14, PP.windowFrame);
  if (!exterior) {
    // a hint of the view: sky band + far trees across the bottom of the panes
    f.quad(-w / 2 + t, w / 2 - t, y0 + t, y0 + t + (y1 - y0) * 0.18, 0.058, 0x9cc48a, { glow: 0xc6dfa0 });
  } else {
    f.quad(-w / 2 + t + 0.05, -w / 2 + t + 0.12, y0 + t + 0.1, y1 - t - 0.2, 0.058, 0xd8ecf4, { rot: [0, 0, 0.3] });
  }
}

export function mirror(f: Frame, w: number, h: number, y0: number): void {
  f.span(-w / 2, w / 2, y0, y0 + h, 0, 0.03, PP.metalLight);
  f.quad(-w / 2 + 0.03, w / 2 - 0.03, y0 + 0.03, y0 + h - 0.03, 0.032, PP.mirror);
  f.quad(-w * 0.25, -w * 0.15, y0 + 0.1, y0 + h - 0.15, 0.034, PP.mirrorGlint, { rot: [0, 0, 0.4] });
  f.quad(-w * 0.1, -w * 0.05, y0 + 0.18, y0 + h - 0.25, 0.034, PP.mirrorGlint, { rot: [0, 0, 0.4] });
}

export function towelDispenser(f: Frame, y0: number): void {
  f.span(-0.15, 0.15, y0, y0 + 0.38, 0, 0.12, PP.metalLight);
  f.span(-0.1, 0.1, y0 - 0.06, y0, 0.06, 0.08, PP.paper, { ink: false });
}

/** Coat hooks rail with a few backpacks hanging. */
export function coatHooks(f: Frame, w: number, rng: Rng): void {
  const y = 1.55;
  f.span(-w / 2, w / 2, y - 0.05, y + 0.05, 0, 0.03, PP.woodMid);
  const n = Math.max(2, Math.floor(w / 0.45));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / n;
    f.box(0.025, 0.025, 0.1, PP.metalLight, x, y, 0.07, { ink: false });
    if (rng.chance(0.6)) {
      const col = PP.backpack[Math.floor(rng.next() * PP.backpack.length)]!;
      f.rbox(0.3, 0.38, 0.16, 0.06, col, x, y - 0.24, 0.1);
      f.span(x - 0.1, x + 0.1, y - 0.36, y - 0.22, 0.18, 0.2, shadeHex(col, 0.82), { ink: false });
    }
  }
}

export function scoreboard(f: Frame, w: number, h: number, y0: number): { x0: number; x1: number; y0: number; y1: number; z: number } {
  f.span(-w / 2, w / 2, y0, y0 + h, 0, 0.12, PP.scoreboard);
  f.span(-w / 2 - 0.05, w / 2 + 0.05, y0 + h, y0 + h + 0.08, 0, 0.14, PP.pad, { ink: false });
  return { x0: -w / 2 + 0.08, x1: w / 2 - 0.08, y0: y0 + 0.08, y1: y0 + h - 0.08, z: 0.122 };
}

export function framedBoard(f: Frame, w: number, h: number, y0: number, frame: number): { x0: number; x1: number; y0: number; y1: number; z: number } {
  f.span(-w / 2, w / 2, y0, y0 + h, 0, 0.05, frame);
  return { x0: -w / 2 + 0.06, x1: w / 2 - 0.06, y0: y0 + 0.06, y1: y0 + h - 0.06, z: 0.052 };
}

/** Hanging school banner (cloth rectangle with a pointed hem) — returns the text area. */
export function banner(f: Frame, w: number, h: number, top: number, colours: readonly [number, number]): { x0: number; x1: number; y0: number; y1: number; z: number } {
  f.box(w + 0.1, 0.04, 0.04, PP.woodDark, 0, top - 0.02, 0.03, { ink: false });
  f.span(-w / 2, w / 2, top - h, top - 0.03, 0.02, 0.035, colours[0]);
  f.span(-w / 2, w / 2, top - h - 0.04, top - h, 0.02, 0.035, colours[1], { ink: false });
  return { x0: -w / 2 + 0.06, x1: w / 2 - 0.06, y0: top - h + 0.05, y1: top - 0.08, z: 0.037 };
}

/** Vertical pennant hanging flag-style from the wall top (cloth in the local YZ plane). */
export function pennant(f: Frame, len: number, h: number, top: number, colours: readonly [number, number]): void {
  f.box(0.04, 0.04, len + 0.1, PP.woodDark, 0, top, 0.05 + len / 2, { ink: false });
  f.span(-0.012, 0.012, top - h, top - 0.02, 0.1, 0.1 + len, colours[0]);
  f.span(-0.014, 0.014, top - h * 0.55, top - h * 0.45, 0.1, 0.1 + len, colours[1], { ink: false });
  f.hexa(
    [
      [-0.012, top - h - 0.25, 0.1 + len / 2],
      [0.012, top - h - 0.25, 0.1 + len / 2],
      [0.012, top - h, 0.1 + len],
      [-0.012, top - h, 0.1 + len],
      [-0.012, top - h, 0.1],
      [0.012, top - h, 0.1],
      [0.012, top - h + 0.001, 0.1 + len],
      [-0.012, top - h + 0.001, 0.1 + len],
    ],
    colours[0],
    { ink: false },
  );
}

// ── floor pieces ──

/** Wall-hung water fountain unit on a short pedestal (back at z = 0). */
export function fountain(f: Frame): void {
  f.span(-0.12, 0.12, 0, 0.7, 0.02, 0.22, PP.metalDark);
  f.rbox(0.5, 0.2, 0.4, 0.05, PP.fountain, 0, 0.8, 0.22);
  f.span(-0.17, 0.17, 0.9, 0.905, 0.1, 0.36, PP.metalDark, { ink: false });
  f.box(0.04, 0.06, 0.05, PP.chrome, -0.1, 0.94, 0.2, { ink: false });
  f.box(0.05, 0.04, 0.04, PP.chrome, 0.18, 0.84, 0.43, { ink: false });
  // a little "bottle filler" panel above
  f.span(-0.22, 0.22, 1.05, 1.5, 0, 0.08, PP.fountain);
  f.span(-0.1, 0.1, 1.15, 1.4, 0.08, 0.12, PP.lockerVent, { ink: false });
}

export function trashCan(f: Frame, body: number = PP.trashCan, lid: number = PP.trashLid): void {
  f.cyl(0.2, 0.17, 0.62, 10, body, 0, 0.31, 0);
  f.cyl(0.215, 0.215, 0.05, 10, lid, 0, 0.635, 0, { ink: false });
  f.cyl(0.15, 0.15, 0.02, 10, PP.lockerInside, 0, 0.665, 0, { ink: false });
}

export function wastebasket(f: Frame): void {
  f.cyl(0.14, 0.11, 0.32, 8, PP.trayGrey, 0, 0.16, 0);
  f.ball(0.05, 0, PP.paper, 0.03, 0.33, 0.02, { ink: false, jitter: 0.01, seed: 2 });
}

/** Basketball hoop on a padded floor stand, backboard toward +Z. */
export function hoop(f: Frame): void {
  f.rbox(0.7, 0.35, 0.9, 0.08, PP.pad, 0, 0.175, 0.45);
  f.cyl(0.06, 0.07, 2.6, 8, PP.metalDark, 0, 1.6, 0.3);
  f.span(-0.05, 0.05, 2.45, 2.55, 0.3, 1.0, PP.metalDark, { ink: false });
  f.span(-0.6, 0.6, 2.15, 2.9, 1.0, 1.05, PP.backboard);
  for (const [x0, x1, y0, y1] of [
    [-0.22, 0.22, 2.3, 2.33],
    [-0.22, 0.22, 2.6, 2.63],
    [-0.22, -0.19, 2.3, 2.63],
    [0.19, 0.22, 2.3, 2.63],
  ] as const)
    f.quad(x0, x1, y0, y1, 1.052, PP.hoopOrange);
  f.torus(0.22, 0.02, 4, 12, PP.hoopOrange, 0, 2.3, 1.3, { rot: [Math.PI / 2, 0, 0] });
  f.add(netGeometry(), PP.net, 0, 2.3, 1.3, { ink: false });
}

function netGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.2, 0.13, 0.36, 8, 1, true);
  g.translate(0, -0.18, 0);
  // double-sided: add the inside faces
  const back = g.clone();
  const idx = back.getIndex()!;
  const a = idx.array as Uint16Array | Uint32Array;
  for (let i = 0; i < a.length; i += 3) {
    const t = a[i + 1]!;
    a[i + 1] = a[i + 2]!;
    a[i + 2] = t;
  }
  const merged = new THREE.BufferGeometry();
  const p0 = g.toNonIndexed().getAttribute('position').array as Float32Array;
  const p1 = back.toNonIndexed().getAttribute('position').array as Float32Array;
  const p = new Float32Array(p0.length + p1.length);
  p.set(p0, 0);
  p.set(p1, p0.length);
  merged.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.dispose();
  back.dispose();
  return merged;
}

/** Pedestal sink against the wall (back at z = 0). */
export function sink(f: Frame): void {
  f.taper(0.14, 0.12, 0.2, 0.16, 0.72, PP.porcelain, 0, 0.36, 0.14, { ink: false });
  f.rbox(0.5, 0.14, 0.4, 0.05, PP.porcelain, 0, 0.8, 0.2);
  f.span(-0.16, 0.16, 0.87, 0.875, 0.1, 0.32, PP.mirror, { ink: false });
  f.box(0.04, 0.12, 0.04, PP.chrome, 0, 0.93, 0.05, { ink: false });
  f.box(0.04, 0.03, 0.12, PP.chrome, 0, 0.99, 0.1, { ink: false });
}

export function tree(f: Frame, seed: number): void {
  f.cyl(0.62, 0.62, 0.08, 12, PP.soil, 0, 0.04, 0, { ink: false });
  f.cyl(0.13, 0.2, 2.2, 8, PP.trunk, 0, 1.1, 0);
  f.box(0.08, 0.6, 0.08, PP.trunk, 0.22, 1.9, 0.05, { rot: [0, 0, -0.6], ink: false });
  const blobs: [number, number, number, number][] = [
    [0, 2.7, 0, 1.0],
    [0.65, 2.45, 0.2, 0.7],
    [-0.6, 2.5, -0.15, 0.72],
    [0.1, 2.5, 0.65, 0.66],
    [-0.15, 3.25, -0.1, 0.6],
  ];
  blobs.forEach(([x, y, z, r], i) =>
    f.ball(r, 1, i % 2 ? PP.canopyA : PP.canopyB, x, y, z, { smooth: true, jitter: r * 0.08, seed: seed + i, scale: [1, 0.85, 1] }),
  );
}

export function flowerClump(f: Frame, rng: Rng): void {
  f.ball(0.22, 0, PP.shrubDark, 0, 0.1, 0, { scale: [1.3, 0.55, 1], ink: false, shade: 0.1, seed: rng.int(0, 99) });
  for (let k = 0; k < 4; k++) f.ball(0.04, 0, [PP.flowerA, PP.flowerB, PP.flowerC][k % 3]!, (rng.next() - 0.5) * 0.4, 0.2, (rng.next() - 0.5) * 0.3, { ink: false });
}

export function beanbag(f: Frame, col: number): void {
  f.ball(0.36, 1, col, 0, 0.22, 0, { scale: [1, 0.62, 1], smooth: true, jitter: 0.03, seed: col & 255 });
}

export function easel(f: Frame, rng: Rng): void {
  for (const sx of [-1, 1]) f.box(0.04, 1.6, 0.04, PP.woodMid, sx * 0.28, 0.78, 0, { rot: [0.12, 0, sx * -0.12], ink: false });
  f.box(0.04, 1.5, 0.04, PP.woodMid, 0, 0.72, -0.25, { rot: [-0.3, 0, 0], ink: false });
  f.span(-0.4, 0.4, 0.82, 0.86, 0.02, 0.1, PP.woodMid, { ink: false });
  f.span(-0.34, 0.34, 0.86, 1.48, 0.06, 0.09, PP.paper, { rot: [0.12, 0, 0] });
  for (let k = 0; k < 4; k++) f.ball(0.06, 0, PP.snacks[(k + rng.int(0, 6)) % PP.snacks.length]!, (rng.next() - 0.5) * 0.4, 1.0 + rng.next() * 0.4, 0.1, { scale: [1, 1, 0.15], ink: false });
}

export function musicStand(f: Frame): void {
  f.cyl(0.015, 0.015, 1.05, 5, PP.metalDark, 0, 0.53, 0, { ink: false });
  for (let k = 0; k < 3; k++) f.box(0.02, 0.02, 0.3, PP.metalDark, 0, 0.03, 0, { rot: [0, (k / 3) * Math.PI * 2, 0], ink: false });
  f.span(-0.25, 0.25, 0.95, 1.3, -0.02, 0.0, PP.metalDark, { rot: [-0.35, 0, 0] });
  f.span(-0.2, 0.2, 1.0, 1.26, 0.01, 0.012, PP.paper, { rot: [-0.35, 0, 0], ink: false });
}

export function drum(f: Frame): void {
  f.cyl(0.3, 0.3, 0.4, 12, PP.books[0]!, 0, 0.32, 0, { rot: [Math.PI / 2, 0, 0] });
  f.cyl(0.26, 0.26, 0.01, 12, PP.paper, 0, 0.32, 0.205, { rot: [Math.PI / 2, 0, 0], ink: false });
  f.cyl(0.18, 0.18, 0.14, 10, PP.chrome, 0.45, 0.62, 0.1);
  f.cyl(0.015, 0.015, 0.55, 5, PP.metalDark, 0.45, 0.28, 0.1, { ink: false });
  f.cyl(0.22, 0.2, 0.012, 12, PP.gold, -0.4, 1.0, 0.0, { ink: false });
  f.cyl(0.015, 0.015, 1.0, 5, PP.metalDark, -0.4, 0.5, 0.0, { ink: false });
}

export function filingCabinet(f: Frame): void {
  f.span(-0.24, 0.24, 0, 1.3, 0, 0.6, PP.trayGrey);
  for (let k = 0; k < 4; k++) {
    const y = 0.08 + k * 0.31;
    f.span(-0.21, 0.21, y, y + 0.27, 0.6, 0.615, shadeHex(PP.trayGrey, 1.18), { ink: false });
    f.box(0.12, 0.025, 0.02, PP.metalLight, 0, y + 0.2, 0.62, { ink: false });
  }
}

export function waterCooler(f: Frame): void {
  f.span(-0.17, 0.17, 0, 0.95, 0, 0.34, PP.porcelain);
  f.cyl(0.14, 0.14, 0.4, 10, PP.glass, 0, 1.17, 0.17, { ink: false });
  f.cyl(0.07, 0.14, 0.06, 10, PP.glass, 0, 0.98, 0.17, { ink: false });
  f.box(0.04, 0.04, 0.05, PP.markerBlue, -0.06, 0.75, 0.36, { ink: false });
  f.box(0.04, 0.04, 0.05, PP.markerRed, 0.06, 0.75, 0.36, { ink: false });
}

export function pottedPlant(f: Frame, seed: number): void {
  f.cyl(0.2, 0.15, 0.35, 10, PP.plantPot, 0, 0.175, 0);
  f.cyl(0.18, 0.18, 0.02, 10, PP.soil, 0, 0.35, 0, { ink: false });
  f.ball(0.28, 1, PAL.plant, 0, 0.62, 0, { smooth: true, jitter: 0.03, seed, scale: [1, 1.15, 1] });
  f.ball(0.18, 1, PP.shrubDark, 0.12, 0.88, 0.05, { smooth: true, jitter: 0.02, seed: seed + 1 });
}

/** Low cabinet / cubby against a wall (back at z = 0): 'cubby' (classroom bins) or 'lab' (beakers on top). */
export function lowCabinet(f: Frame, w: number, style: 'cubby' | 'lab', rng: Rng): void {
  const d = 0.45;
  const h = 0.9;
  f.span(-w / 2, w / 2, 0, h, 0, d, style === 'lab' ? PP.metalLight : PP.woodMid);
  f.span(-w / 2 - 0.02, w / 2 + 0.02, h, h + 0.04, -0.0, d + 0.02, style === 'lab' ? PP.monitor : PP.laminate);
  if (style === 'cubby') {
    const n = Math.max(2, Math.floor(w / 0.4));
    for (let i = 0; i < n; i++) {
      for (let r = 0; r < 2; r++) {
        const x = -w / 2 + ((i + 0.5) * w) / n;
        const y = 0.12 + r * 0.4;
        f.span(x - w / n / 2 + 0.03, x + w / n / 2 - 0.03, y, y + 0.32, d - 0.01, d + 0.005, PP.lockerInside, { ink: false });
        f.span(x - w / n / 2 + 0.05, x + w / n / 2 - 0.05, y, y + 0.22, d - 0.05, d + 0.01, PP.backpack[(i + r + rng.int(0, 4)) % PP.backpack.length]!, { ink: false });
      }
    }
  } else {
    for (let i = 0; i < 2; i++) f.span(-w / 2 + 0.05 + (i * w) / 2, -0.03 + (i * w) / 2, 0.08, h - 0.08, d, d + 0.012, shadeHex(PP.metalLight, 0.9), { ink: false });
    for (let k = 0; k < 4; k++) {
      const x = -w / 2 + 0.2 + k * ((w - 0.4) / 3);
      const col = [PP.peas, PP.markerBlue, PP.apple, PP.pencil][k]!;
      f.lathe(
        [
          [0, 0],
          [0.07, 0],
          [0.07, 0.03],
          [0.025, 0.12],
          [0.025, 0.2],
          [0, 0.2],
        ],
        8,
        PP.glass,
        x,
        h + 0.04,
        d * 0.5,
        { ink: false },
      );
      f.cyl(0.06, 0.068, 0.04, 8, col, x, h + 0.065, d * 0.5, { ink: false, glow: shadeHex(col, 1.1) });
    }
  }
}

export function visitorChair(f: Frame): void {
  f.span(-0.22, 0.22, 0.42, 0.48, -0.2, 0.2, PP.signNavy);
  f.span(-0.22, 0.22, 0.48, 0.9, -0.22, -0.16, PP.signNavy);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(0.03, 0.42, 0.03, PP.metalLight, sx * 0.19, 0.21, sz * 0.17, { ink: false });
}

export function ballRack(f: Frame, rng: Rng): void {
  f.span(-0.6, 0.6, 0, 0.06, 0, 0.45, PP.metalDark, { ink: false });
  for (const sx of [-1, 1]) f.span(sx * 0.6 - 0.03, sx * 0.6 + 0.03, 0, 0.75, 0, 0.45, PP.metalDark);
  f.span(-0.6, 0.6, 0.38, 0.41, 0, 0.45, PP.metalDark, { ink: false });
  for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) f.ball(0.12, 1, rng.chance(0.25) ? 0xd9d3c0 : PP.hoopOrange, -0.42 + k * 0.28, 0.18 + r * 0.38, 0.22, { smooth: true, ink: r === 1 });
}

export function matStack(f: Frame): void {
  for (let k = 0; k < 3; k++) f.rbox(1.8, 0.1, 1.0, 0.04, k % 2 ? PP.pad : shadeHex(PP.pad, 1.25), 0, 0.05 + k * 0.1, 0.5, { ink: k === 2 });
}

export function rug(f: Frame, w: number, d: number, col: number): void {
  f.floorRect(-w / 2, w / 2, -d / 2, d / 2, 0.006, col);
  f.floorRect(-w / 2 + 0.12, w / 2 - 0.12, -d / 2 + 0.12, d / 2 - 0.12, 0.008, mixHex(col, 0xf1e6c8, 0.25));
  f.floorRect(-w / 2 + 0.2, w / 2 - 0.2, -d / 2 + 0.2, d / 2 - 0.2, 0.01, col);
}

export function recycleBin(f: Frame): void {
  f.span(-0.22, 0.22, 0, 0.75, -0.2, 0.2, PP.recycle);
  f.span(-0.24, 0.24, 0.75, 0.8, -0.22, 0.22, shadeHex(PP.recycle, 0.8), { ink: false });
  f.span(-0.12, 0.12, 0.799, 0.802, -0.03, 0.03, PP.lockerInside, { ink: false });
  f.span(-0.1, 0.1, 0.35, 0.55, 0.2, 0.205, PP.paper, { ink: false });
}

export function milkCooler(f: Frame): void {
  f.span(-0.45, 0.45, 0, 0.9, 0, 0.6, PP.stainless);
  f.span(-0.4, 0.4, 0.9, 0.92, 0.05, 0.55, PP.glass, { ink: false });
  for (let k = 0; k < 6; k++) f.box(0.08, 0.1, 0.08, k % 2 ? PP.milk : PP.paperPink, -0.3 + k * 0.12, 0.95, 0.3, { ink: false });
}
