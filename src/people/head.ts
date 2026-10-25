// ─────────────────────────────────────────────────────────────────────────────
// Head + face geometry (build time). Everything is authored in the local rest
// frame of the bone it is bound to (see skeleton.ts): the skull/nose/ears/beard/
// glasses on the head bone, each face feature on its own bone so expressions can
// swap/scale it. Face-bone frames: +Z out of the face, +Y up along the face.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PEOPLE as PAL } from './palette';
import { mixHex, shadeHex } from '../render/models/builder';
import { alignY, eul } from './geo';
import { B, EYE_SCALE, F, MOUTHS, faceBone, headSurface, mouthBone, type MouthKind, type V3 } from './skeleton';
import type { SkinBuilder } from './skin';
import type { BodySpec } from './spec';

export interface HeadStyle {
  skin: number;
  /** Iris colour. */
  eyes: number;
  /** Hair colour (brows derive from it). */
  hair: number;
  lashes: boolean;
  /** Glasses frame colour, or null. */
  glasses: number | null;
  /** Glasses shape: round reading frames or squarer ones. */
  glassesShape?: 'round' | 'square';
  beard: 'none' | 'stubble' | 'beard' | 'mustache';
  brows: 'soft' | 'thick' | 'arched';
  /** Ears hidden under long hair are skipped. */
  ears: boolean;
  /** Fewer segments + fewer mouth shapes (extras). */
  low: boolean;
}

function c(s: BodySpec): V3 {
  return [0, s.headCY, s.headCZ];
}

/** Mouths built for low-detail heads (extras); other kinds fall back to the nearest one. */
export const LOW_MOUTHS: readonly MouthKind[] = ['smile', 'bigSmile', 'grin', 'open', 'o', 'flat'];

export function buildHead(sb: SkinBuilder, s: BodySpec, st: HeadStyle): void {
  const skin = st.skin;
  const C = c(s);
  const low = st.low;
  const hb = sb.on(B.head);
  // Skull: one clean, soft ellipsoid (cleanest cartoon read).
  hb.sphere(1, low ? 12 : 15, low ? 8 : 10, skin, { at: C, scale: [s.headRx, s.headRy, s.headRz], smooth: true });
  // Neck (bottom hidden in the collar).
  const neckR = s.headRx * (s.kid ? 0.3 : 0.32);
  const neckTop = s.headCY * 0.55;
  const neckBot = -(s.neckY - s.shoulderY) - 0.02;
  hb.cyl(neckR, neckR * 1.08, neckTop - neckBot, 8, skin, { at: [0, (neckTop + neckBot) / 2, -0.004], smooth: true, ink: false });

  // Ears.
  if (st.ears) {
    for (const sd of [-1, 1] as const) {
      const p = headSurface(s, sd * 1.52, s.eyePitch - 0.12, -s.headRx * 0.08);
      hb.sphere(s.headRx * 0.2, 6, 4, skin, { at: p.pos, scale: [0.5, 1, 0.78], smooth: true });
      hb.sphere(s.headRx * 0.11, 4, 2, shadeHex(skin, 0.82), { at: [p.pos[0] + sd * s.headRx * 0.07, p.pos[1], p.pos[2] + 0.004], scale: [0.35, 1, 0.7], ink: false, smooth: true });
    }
  }
  // Button nose (a little rosy). Un-inked: small features get heavy halos from the hull; a darker
  // underside gives it shape instead.
  const np = headSurface(s, 0, s.nosePitch, -s.headRz * 0.02);
  const nr = s.headRx * (s.kid ? 0.105 : 0.12);
  const nq = eul(np.quat);
  hb.sphere(nr, 6, 4, mixHex(shadeHex(skin, 0.97), PAL.blush, 0.16), { at: np.pos, rot: nq, scale: [1.15, 0.9, 0.9], smooth: true, ink: false });
  const nd = headSurface(s, 0, s.nosePitch - 0.05, -s.headRz * 0.035);
  hb.sphere(nr * 0.95, 6, 3, mixHex(shadeHex(skin, 0.78), PAL.blush, 0.2), { at: nd.pos, rot: nq, scale: [1.1, 0.7, 0.8], smooth: true, ink: false });

  if (st.beard !== 'none') beard(sb, s, st);
  if (st.glasses !== null) glasses(sb, s, st.glasses, st.glassesShape ?? 'round');

  for (const sd of [1, -1] as const) eyeParts(sb, s, st, sd);
  for (const k of MOUTHS) mouth(sb, s, k);
  void LOW_MOUTHS;
}

// ── eyes ──────────────────────────────────────────────────────────────────────

function eyeParts(sb: SkinBuilder, s: BodySpec, st: HeadStyle, sd: 1 | -1): void {
  const er = s.eyeR;
  const ex = er * EYE_SCALE[0];
  const ey = er * EYE_SCALE[1];
  const low = st.low;
  const ink = PAL.eyeInk;
  // Open eye: white lens (front half-ellipsoid) + crisp ink rim.
  const eo = sb.on(faceBone(sd, F.open), false);
  eo.add(new THREE.SphereGeometry(er, low ? 8 : 10, 3, 0, Math.PI * 2, 0, Math.PI / 2), PAL.eyeWhite, {
    rot: [Math.PI / 2, 0, 0],
    scale: [EYE_SCALE[0], EYE_SCALE[2], EYE_SCALE[1]],
    smooth: true,
  });
  eo.torus(er, er * 0.07, 3, low ? 8 : 10, ink, { scale: [EYE_SCALE[0] * 1.03, EYE_SCALE[1] * 1.03, 1] });
  // Thicker upper-rim lash line (friendly, less "googly").
  eo.torus(er, er * 0.105, 3, low ? 5 : 9, ink, { at: [0, 0, -er * 0.01], rot: [0, 0, 0.16], scale: [EYE_SCALE[0] * 1.05, EYE_SCALE[1] * 1.04, 1] }, Math.PI - 0.32);
  // Iris + pupil + glints (moves for look direction, scales for pupil size).
  const ir = sb.on(faceBone(sd, F.iris), false);
  const irR = er * s.iris;
  const dome = (r: number, w: number, h: number, col: number, at: V3, sx: number, sy: number, sz: number, glow = 0) =>
    ir.add(new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2), col, { at, rot: [Math.PI / 2, 0, 0], scale: [sx, sz, sy], smooth: true, glow });
  const z0 = er * 0.4;
  const dz = irR * 0.24;
  dome(irR, low ? 8 : 10, 2, st.eyes, [0, -er * 0.04, z0], 0.8, 0.94, 0.24);
  if (!low) dome(irR * 0.78, 8, 2, mixHex(st.eyes, 0xffffff, 0.22), [0, -er * 0.04 - irR * 0.3, z0 + dz * 0.55], 0.62, 0.42, 0.24);
  dome(irR * 0.56, 8, 2, mixHex(ink, st.eyes, 0.12), [0, -er * 0.03, z0 + dz * 0.72], 0.8, 0.94, 0.24);
  dome(er * 0.2, 6, 2, 0xffffff, [-er * 0.17, er * 0.17, z0 + dz * 1.15], 1, 1.1, 0.3, 0xffffff);
  dome(er * 0.09, 5, 2, 0xffffff, [er * 0.19, -er * 0.22, z0 + dz * 1.05], 1, 1, 0.3, 0xffffff);

  // Upper lid: quarter shell hanging from the pivot at the eye top; bone scale.y 0 → 1 closes it.
  const H = ey * 2.04;
  const lidRx = ex * 1.16;
  const lidRz = er * 0.74;
  const lidCol = mixHex(shadeHex(st.skin, 0.88), PAL.blush, 0.06);
  const lu = sb.on(faceBone(sd, F.lidU), false);
  lu.add(new THREE.SphereGeometry(1, 8, 3, 0, Math.PI, 0, Math.PI / 2), lidCol, { at: [0, -H, 0], scale: [lidRx, H, lidRz], smooth: true });
  // Lower lid (smiling / squinting eyes): rises from the eye bottom.
  {
    const ld = sb.on(faceBone(sd, F.lidD), false);
    ld.add(new THREE.SphereGeometry(1, low ? 6 : 8, 2, 0, Math.PI, Math.PI / 2, Math.PI / 2), lidCol, { at: [0, H, 0], scale: [lidRx, H, lidRz], smooth: true });
  }
  // Lid-edge lash line (rides the upper lid edge: the rig moves this bone down and narrows it with the
  // lid) + two lash flicks at the outer corner for the girls and Ashley.
  const la = sb.on(faceBone(sd, F.lash), false);
  la.torus(1, 0.075, 3, low ? 6 : 10, ink, { rot: [Math.PI / 2, 0, 0], scale: [lidRx * 1.02, lidRz * 1.02, er * 1.35] }, Math.PI);
  for (const e of [-1, 1]) la.sphere(er * 0.1, 4, 2, ink, { at: [e * lidRx * 1.02, 0, 0], scale: [1, 0.75, 1] });
  if (st.lashes) {
    const outer = sd; // outer corner is +x for the left eye (sd = +1)
    for (const [t0, len] of [
      [0.28, 0.46],
      [0.62, 0.38],
    ] as const) {
      const t = outer > 0 ? t0 : Math.PI - t0;
      const base: V3 = [Math.cos(t) * ex * 1.06, Math.sin(t) * ey * 1.05, er * 0.02];
      const d = new THREE.Vector3(Math.cos(t) + outer * 0.9, Math.sin(t) + 0.5, 0.25).normalize();
      const L = er * len;
      eo.cone(er * 0.07, L, 3, ink, { at: [base[0] + (d.x * L) / 2, base[1] + (d.y * L) / 2, base[2] + (d.z * L) / 2], rot: alignY(d), ink: false });
    }
  }
  // Joy eyes ^^ (upward arcs).
  const tube = er * 0.17;
  const jy = sb.on(faceBone(sd, F.joy), false);
  jy.torus(er * 0.56, tube, 3, low ? 6 : 10, ink, { at: [0, -er * 0.18, er * 0.26], scale: [1.05, 1, 0.6] }, Math.PI);
  for (const x of [-1, 1]) jy.sphere(tube, 4, 2, ink, { at: [x * er * 0.56 * 1.05, -er * 0.18, er * 0.26], scale: [1, 1, 0.6] });
  // Closed, peaceful (asleep) — gentle downward arcs (+ lash flicks).
  const cl = sb.on(faceBone(sd, F.closed), false);
  cl.torus(er * 0.56, tube * 0.9, 3, low ? 6 : 10, ink, { at: [0, er * 0.12, er * 0.26], rot: [0, 0, Math.PI], scale: [1.05, 0.7, 0.6] }, Math.PI);
  for (const x of [-1, 1]) cl.sphere(tube * 0.9, 4, 2, ink, { at: [x * er * 0.56 * 1.05, er * 0.12, er * 0.26], scale: [1, 1, 0.6] });
  if (st.lashes) {
    const ox = sd * er * 0.56 * 1.05;
    for (const k of [0, 1]) {
      const d = new THREE.Vector3(sd * (0.9 - k * 0.35), -0.55 - k * 0.3, 0.2).normalize();
      const L = er * 0.32;
      cl.cone(er * 0.06, L, 3, ink, { at: [ox - sd * k * er * 0.18 + (d.x * L) / 2, er * 0.1 - k * er * 0.12 + (d.y * L) / 2, er * 0.28], rot: alignY(d), ink: false });
    }
  }
  // (Bad Hair Day's squeeze > < eyes are not used by any HALL PASS face: no geometry.)

  // Brow.
  const br = sb.on(faceBone(sd, F.brow), false);
  const browCol = shadeHex(st.hair, st.hair < 0x303030 ? 1.25 : st.brows === 'soft' ? 0.92 : 0.82);
  const R = er * (st.brows === 'arched' ? 1.2 : 1.35);
  const bt = er * (st.brows === 'thick' ? 0.22 : st.brows === 'soft' ? 0.15 : 0.14);
  const arc = st.brows === 'arched' ? 1.15 : 0.95;
  br.torus(R, bt, 3, low ? 6 : 8, browCol, { at: [0, -R, 0], rot: [0, 0, Math.PI / 2 - arc / 2], scale: [1, 1, 0.6], smooth: true }, arc);
  for (const e of [-1, 1]) {
    const a = Math.PI / 2 + (e * arc) / 2;
    br.sphere(bt, 4, 2, browCol, { at: [Math.cos(a) * R, Math.sin(a) * R - R, 0], scale: [1, 1, 0.6], smooth: true });
  }
  // Blush: a surface-conforming oval patch (no grazing slivers), authored in head space then moved into
  // the blush bone's frame (the rig scales it for more / less blush).
  const bl = sb.on(faceBone(sd, F.blush), false);
  const byaw = sd * (s.eyeYaw + 0.16);
  const bp = s.eyePitch - 0.3;
  const patch = headPatch(s, 1.0035, byaw - 0.2, byaw + 0.2, 6, 2, (y) => bp - 0.1 * Math.sqrt(Math.max(0, 1 - ((y - byaw) / 0.2) ** 2)), (y) => bp + 0.1 * Math.sqrt(Math.max(0, 1 - ((y - byaw) / 0.2) ** 2)));
  const bsp = headSurface(s, byaw, bp, -0.0045);
  patch.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...bsp.pos), bsp.quat, new THREE.Vector3(1, 1, 1)).invert());
  bl.add(patch, mixHex(st.skin, PAL.blush, 0.5), { smooth: true });
}

// ── mouths ───────────────────────────────────────────────────────────────────

function mouth(sb: SkinBuilder, s: BodySpec, kind: MouthKind): void {
  const Rh = (s.headRx + s.headRz) / 2;
  const bend = (v: THREE.Vector3) => {
    v.z -= (v.x * v.x) / (2 * Rh);
  };
  const b = sb.on(mouthBone(kind), false, bend);
  const w = s.headRx * (s.kid ? 0.2 : 0.19);
  const lt = w * 0.13;
  const lip = PAL.lipLine;
  const cap = (x: number, y: number, r = lt) => b.sphere(r, 4, 2, lip, { at: [x, y, 0], ink: false });
  const arcLine = (R: number, arcLen: number, centre: number, at: V3, t = lt) => {
    b.torus(R, t, 3, 7, lip, { at, rot: [0, 0, centre - arcLen / 2], ink: false }, arcLen);
    const a0 = centre - arcLen / 2;
    const a1 = centre + arcLen / 2;
    cap(at[0] + Math.cos(a0) * R, at[1] + Math.sin(a0) * R, t);
    cap(at[0] + Math.cos(a1) * R, at[1] + Math.sin(a1) * R, t);
  };
  switch (kind) {
    case 'smile':
      arcLine(w * 0.9, 2.0, -Math.PI / 2, [0, w * 0.46, 0]);
      break;
    case 'bigSmile':
      arcLine(w * 1.05, 2.4, -Math.PI / 2, [0, w * 0.52, 0], lt * 1.1);
      break;
    case 'smirk':
      arcLine(w * 0.82, 1.5, -Math.PI / 2 + 0.45, [w * 0.12, w * 0.36, 0]);
      break;
    case 'wavy': {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        pts.push(new THREE.Vector3((t - 0.5) * w * 1.7, Math.sin(t * Math.PI * 3) * w * 0.16, 0));
      }
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, lt, 3, false), lip, { ink: false });
      cap(-w * 0.85, 0);
      cap(w * 0.85, 0);
      break;
    }
    case 'grin': {
      const top = w * 0.2;
      const h = w * 0.95;
      const n = 7;
      const pts: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const x = -w + (2 * w * i) / n;
        pts.push([x, top + 0.2 * w * (x / w) * (x / w)]);
      }
      for (let i = 1; i < n; i++) {
        const t = Math.PI - (Math.PI * i) / n;
        pts.push([Math.cos(t) * w * 0.98, top - Math.sin(t) * h]);
      }
      pts.reverse();
      b.extrude(pts, Rh * 0.03, PAL.mouthDark, {});
      const tp: [number, number][] = [];
      for (let i = 0; i <= n; i++) {
        const x = (-w + (2 * w * i) / n) * 0.84;
        tp.push([x, top + 0.2 * w * (x / w) * (x / w) - w * 0.03]);
      }
      for (let i = n; i >= 0; i--) {
        const x = (-w + (2 * w * i) / n) * 0.72;
        tp.push([x, top + 0.16 * w * (x / w) * (x / w) - w * 0.3]);
      }
      tp.reverse();
      b.extrude(tp, Rh * 0.012, PAL.teeth, { at: [0, 0, Rh * 0.012], ink: false });
      b.sphere(w * 0.46, 6, 3, PAL.tongue, { at: [0, top - h * 0.7, Rh * 0.008], scale: [1.15, 0.6, 0.2], ink: false });
      break;
    }
    case 'open':
    case 'o': {
      const rx = kind === 'open' ? w * 0.52 : w * 0.3;
      const ry = kind === 'open' ? w * 0.6 : w * 0.36;
      const cy = kind === 'open' ? -w * 0.12 : -w * 0.05;
      const pts: [number, number][] = [];
      const n = kind === 'o' ? 8 : 10;
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push([Math.cos(t) * rx, cy + Math.sin(t) * ry]);
      }
      b.extrude(pts, Rh * 0.03, PAL.mouthDark, {});
      b.sphere(rx * (kind === 'o' ? 0.5 : 0.62), 6, 3, PAL.tongue, { at: [0, cy - ry * 0.53, Rh * 0.01], scale: [1.1, 0.52, 0.2], ink: false });
      if (kind === 'open') b.sphere(rx * 0.55, 6, 3, PAL.teeth, { at: [0, cy + ry * 0.84, Rh * 0.012], scale: [1.25, 0.22, 0.2], ink: false });
      break;
    }
    case 'flat': {
      // Straight, very slightly down-turned line (stern / unimpressed — comic, never angry).
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6 - 0.5;
        pts.push(new THREE.Vector3(t * w * 1.25, -Math.abs(t) * w * 0.12 - w * 0.02, 0));
      }
      b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 6, lt * 1.05, 3, false), lip, { ink: false });
      cap(-w * 0.625, -w * 0.08, lt * 1.05);
      cap(w * 0.625, -w * 0.08, lt * 1.05);
      break;
    }
  }
}

// ── beard, glasses, clip ───────────────────────────────────────────────────────

/** Parametric patch on the head ellipsoid: yaw columns × pitch rows from `bottom` up to `top(yaw)`. */
function headPatch(s: BodySpec, k: number, yaw0: number, yaw1: number, cols: number, rows: number, bottom: (yaw: number) => number, top: (yaw: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const C = c(s);
  for (let i = 0; i <= cols; i++) {
    const yaw = yaw0 + ((yaw1 - yaw0) * i) / cols;
    const p0 = bottom(yaw);
    const p1 = top(yaw);
    for (let j = 0; j <= rows; j++) {
      const pitch = p0 + ((p1 - p0) * j) / rows;
      pos.push(C[0] + Math.sin(yaw) * Math.cos(pitch) * s.headRx * k, C[1] + Math.sin(pitch) * s.headRy * k, C[2] + Math.cos(yaw) * Math.cos(pitch) * s.headRz * k);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = (i + 1) * (rows + 1) + j;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function beard(sb: SkinBuilder, s: BodySpec, st: HeadStyle): void {
  const b = sb.on(B.head);
  const col = st.hair;
  const mp = s.mouthPitch;
  // Top boundary: just under the lower lip at the front, rising along the cheeks to the sideburns.
  const topFull = (yaw: number) => {
    const a = Math.abs(yaw);
    return mp - 0.1 + 0.44 * smoothstepF(0.3, 1.45, a);
  };
  const bottom = () => -1.32;
  if (st.beard === 'mustache') {
    // A proud, bushy moustache (comic vice-principal energy).
    b.add(
      headPatch(s, 1.05, -0.5, 0.5, 8, 2, (y) => mp + 0.05 - 0.14 * smoothstepF(0.15, 0.5, Math.abs(y)), (y) => mp + 0.19 - 0.08 * smoothstepF(0.2, 0.5, Math.abs(y))),
      col,
      { smooth: true, jitter: 0.001, seed: 13 },
    );
    return;
  }
  if (st.beard === 'stubble') {
    b.add(headPatch(s, 1.006, -1.5, 1.5, 12, 3, bottom, (y) => topFull(y) + 0.06), mixHex(st.skin, col, 0.32), { smooth: true, ink: false });
    return;
  }
  // Short full beard (friendly, rounded) + a soft moustache that joins it around the mouth.
  b.add(headPatch(s, 1.05, -1.52, 1.52, 14, 4, bottom, topFull), col, { smooth: true, jitter: 0.0012, seed: 11 });
  b.add(
    headPatch(s, 1.045, -0.55, 0.55, 8, 1, (y) => mp + 0.06 - 0.12 * smoothstepF(0.2, 0.55, Math.abs(y)), (y) => mp + 0.17 - 0.1 * smoothstepF(0.25, 0.55, Math.abs(y))),
    shadeHex(col, 1.06),
    { smooth: true, ink: false },
  );
}

function smoothstepF(e0: number, e1: number, v: number): number {
  const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function glasses(sb: SkinBuilder, s: BodySpec, frame: number, shape: 'round' | 'square'): void {
  const b = sb.on(B.head);
  const er = s.eyeR;
  const rimR = er * 1.18;
  const tube = er * 0.1;
  for (const sd of [-1, 1] as const) {
    const p = headSurface(s, sd * s.eyeYaw, s.eyePitch, er * 0.62);
    if (shape === 'square') {
      // Squarer frames: four bars in the lens plane.
      const R = new THREE.Matrix4().makeRotationFromQuaternion(p.quat);
      const hw = rimR * 1.08;
      const hh = rimR * 0.82;
      const bars: [number, number, number, number][] = [
        [0, hh, hw * 2 + tube * 2, tube * 2.2],
        [0, -hh, hw * 2 + tube * 2, tube * 2.2],
        [hw, 0, tube * 2.2, hh * 2],
        [-hw, 0, tube * 2.2, hh * 2],
      ];
      for (const [x, y, w, h] of bars) {
        const o = new THREE.Vector3(x, y, 0).applyMatrix4(R);
        b.box(w, h, tube * 1.6, frame, { at: [p.pos[0] + o.x, p.pos[1] + o.y, p.pos[2] + o.z], rot: eul(p.quat), ink: false });
      }
    } else {
      b.torus(rimR, tube * 1.25, 3, 14, frame, { at: p.pos, rot: eul(p.quat), scale: [0.95, 0.9, 1], smooth: true, ink: false });
    }
    // Temple arm to the ear.
    const a0 = headSurface(s, sd * (s.eyeYaw + 0.42), s.eyePitch + 0.03, er * 0.3);
    const a1 = headSurface(s, sd * 1.45, s.eyePitch + 0.04, s.headRx * 0.02);
    const d = new THREE.Vector3(a1.pos[0] - a0.pos[0], a1.pos[1] - a0.pos[1], a1.pos[2] - a0.pos[2]);
    b.box(tube * 1.2, d.length(), tube * 1.2, frame, { at: [(a0.pos[0] + a1.pos[0]) / 2, (a0.pos[1] + a1.pos[1]) / 2, (a0.pos[2] + a1.pos[2]) / 2], rot: alignY(d), ink: false });
  }
  const br = headSurface(s, 0, s.eyePitch + 0.05, er * 0.55);
  b.box(er * 0.62, tube * 1.5, tube * 1.4, frame, { at: br.pos, rot: eul(br.quat), ink: false });
}
