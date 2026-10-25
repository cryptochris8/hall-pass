// ─────────────────────────────────────────────────────────────────────────────
// School dressing (contract part 2, src/world/props/types.ts): everything that
// isn't a plan furniture item. Deterministic per plan (Rng from plan.seed).
//
// Draw calls: ALL inked dressing is one THREE.BatchedMesh (modelMaterial) and
// all sign text is a second BatchedMesh (one canvas atlas texture). Inside the
// model batch, floor dressing is a handful of always-visible spatial chunks and
// every wall group (everything mounted on one wall box) is its own instance;
// each WallItem.object is a lightweight proxy Object3D whose `visible` toggles
// that group's instances (BatchedMesh.setVisibleAt) — so the world's
// `item.object.visible = wallHeight >= item.top` hides a wall's posters, signs,
// windows, door frames and lintels in a couple of draw calls total.
// Everything (both batches + the proxies) lives under `root`: add root to the
// scene and drive wallItems; nothing else needs adding.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Rng, hashInts } from '../../core/rng';
import { PAL } from '../../render/palette';
import { GeoBuilder, mixHex, shadeHex } from '../../render/models/builder';
import { inked } from '../../render/models/common';
import { modelMaterial } from '../../render/models/materials';
import { toonGradient } from '../../render/toon';
import { FINE, F_SOLID, type Furniture, type Room, type RoomKind, type SchoolPlan } from '../../school/types';
import * as dec from './decor';
import { Frame } from './kit';
import { PP, SCHOOL_COLOURS } from './palette';
import { TextAtlas, textGeometry, type TextQuad, type TextStyle } from './text';
import type { Dressing, WallItem } from './types';
import {
  Spans,
  beyond,
  blockFurniture,
  corridorFaces,
  faceAlong,
  facePoint,
  faceYaw,
  fineFlags,
  frontBack,
  interior,
  rectClear,
  rectSolid,
  roomSides,
  wallRectIndex,
  type RoomSide,
  type WallFace,
} from './walls';

const FLOOR: Record<RoomKind, number> = {
  classroom: PAL.floorRoom,
  art: PAL.floorRoom,
  band: PAL.floorRoom,
  lab: PAL.floorBath,
  office: PAL.floorOffice,
  principal: PAL.floorOffice,
  library: PAL.floorLibrary,
  cafeteria: PAL.floorCafeteria,
  gym: PAL.floorGym,
  bathroom: PAL.floorBath,
  courtyard: PAL.floorCourtyard,
};

/** Afternoon sun (matches the game's key light, src/game/app.ts: sun at (−26, 24, +12) from the target). */
const SUN_DIR: [number, number] = [26 / Math.hypot(26, 12), -12 / Math.hypot(26, 12)];
const SUN_TAN = 24 / Math.hypot(26, 12);

const CHUNK = 24;
const SIGN_STYLE: TextStyle = { bg: PP.signNavy, fg: PP.signText, font: 'display', border: PP.signText };

interface Group {
  b: GeoBuilder;
  texts: TextQuad[];
  x: number;
  z: number;
  top: number;
}

class Ctx {
  readonly rng: Rng;
  readonly rect: Int32Array;
  readonly groups = new Map<number, Group>();
  readonly chunks = new Map<string, GeoBuilder>();
  readonly atlas = new TextAtlas();
  readonly colours: readonly [number, number];
  readonly mascot: string;
  readonly initials: string;
  /** World door centres (aprons for floor pieces). */
  readonly doors: { x: number; z: number }[];
  classroomNo = 100;

  constructor(readonly plan: SchoolPlan) {
    this.rng = new Rng(hashInts(plan.seed, 0x9409e5));
    this.rect = wallRectIndex(plan);
    this.colours = SCHOOL_COLOURS[hashInts(plan.seed, 77) % SCHOOL_COLOURS.length]!;
    const m = /home of the\s+([A-Za-z][A-Za-z ]*?)(\s*\(|$)/i.exec(plan.motto);
    this.mascot = (m?.[1] ?? 'Team').trim().toUpperCase();
    this.initials = plan.name
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w))
      .map((w) => w[0]!.toUpperCase())
      .join('')
      .slice(0, 4);
    this.doors = plan.rooms.flatMap((r) => r.doors.map((d) => ({ x: d.x, z: d.z })));
  }

  /** The wall group for a point just inside a wall face. */
  group(face: WallFace, anchorS: number): Group {
    const [x, z] = facePoint(face, anchorS, -0.12);
    const c = Math.floor(x / FINE);
    const r = Math.floor(z / FINE);
    let id = -1;
    if (c >= 0 && r >= 0 && c < this.plan.fine.cols && r < this.plan.fine.rows) id = this.rect[r * this.plan.fine.cols + c]!;
    const key = id >= 0 ? id : 1_000_000 + r * this.plan.fine.cols + c;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { b: inked(), texts: [], x, z, top: 0 }));
    return g;
  }

  /** Frame on a wall face at along-position s (local +Z out of the wall), in the group of that wall. */
  wall(face: WallFace, s: number, top: number, anchorS = s, out = 0): { f: Frame; g: Group } {
    const g = this.group(face, anchorS);
    g.top = Math.max(g.top, top);
    const [x, z] = facePoint(face, s, out);
    return { f: new Frame(g.b, x, 0, z, faceYaw(face)), g };
  }

  /** Frame on the floor (always visible chunk). */
  floor(x: number, z: number, yaw = 0): Frame {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let b = this.chunks.get(key);
    if (!b) this.chunks.set(key, (b = inked()));
    return new Frame(b, x, 0, z, yaw);
  }

  nearDoor(x: number, z: number, r: number): boolean {
    return this.doors.some((d) => Math.abs(d.x - x) < r && Math.abs(d.z - z) < r);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export function buildDressing(plan: SchoolPlan): Dressing {
  const ctx = new Ctx(plan);
  for (const room of plan.rooms) dressRoom(ctx, room, ctx.rng.fork(room.id + 11));
  dressHalls(ctx, ctx.rng.fork(0x4a11));
  return finish(ctx);
}

// ── rooms ────────────────────────────────────────────────────────────────────

function roomLabel(ctx: Ctx, room: Room): string {
  switch (room.kind) {
    case 'classroom':
      return `ROOM ${++ctx.classroomNo}`;
    case 'office':
      return 'MAIN OFFICE';
    case 'principal':
      return 'PRINCIPAL';
    case 'library':
      return 'LIBRARY';
    case 'cafeteria':
      return 'CAFETERIA';
    case 'gym':
      return 'GYM';
    case 'bathroom':
      return 'RESTROOM';
    case 'art':
      return 'ART';
    case 'band':
      return 'BAND';
    case 'lab':
      return 'SCIENCE LAB';
    case 'courtyard':
      return 'COURTYARD';
  }
}

interface RoomCtx {
  room: Room;
  sides: RoomSide[];
  spans: Spans[];
  front: number;
  back: number;
  furn: Furniture[];
  b: { x0: number; z0: number; x1: number; z1: number };
}

function dressRoom(ctx: Ctx, room: Room, rng: Rng): void {
  const b = interior(room);
  const sides = roomSides(room);
  const { front, back } = frontBack(room);
  const furn = ctx.plan.furniture.filter((f) => f.x > b.x0 && f.x < b.x1 && f.z > b.z0 && f.z < b.z1);
  const spans = sides.map((s) => {
    const sp = new Spans(s.face.len);
    for (const d of s.doors) sp.block(d - 1.0, d + 1.0);
    blockFurniture(sp, s.face, furn);
    return sp;
  });
  const rc: RoomCtx = { room, sides, spans, front, back, furn, b };
  const label = roomLabel(ctx, room);
  sides.forEach((side, i) => side.doors.forEach((s) => dressDoor(ctx, rc, i, s, label, rng)));

  const outdoor = room.kind === 'courtyard';
  if (outdoor) {
    dressCourtyard(ctx, rc, rng);
    return;
  }
  // Windows on every wall that faces outside (or the courtyard) — after the sinks in a bathroom.
  if (room.kind !== 'bathroom') for (let i = 0; i < 4; i++) windows(ctx, rc, i);
  switch (room.kind) {
    case 'classroom':
    case 'art':
    case 'band':
    case 'lab':
      dressClassroom(ctx, rc, rng);
      break;
    case 'library':
      dressLibrary(ctx, rc, rng);
      break;
    case 'cafeteria':
      dressCafeteria(ctx, rc, rng);
      break;
    case 'gym':
      dressGym(ctx, rc, rng);
      break;
    case 'bathroom':
      dressBathroom(ctx, rc, rng);
      for (let i = 0; i < 4; i++) windows(ctx, rc, i);
      break;
    case 'office':
    case 'principal':
      dressOffice(ctx, rc, rng);
      break;
  }
}

/** Door frames on both faces, lintel, open leaf (room side) and the room sign (corridor side). */
function dressDoor(ctx: Ctx, rc: RoomCtx, sideIdx: number, s: number, label: string, rng: Rng): void {
  const side = rc.sides[sideIdx]!;
  const face = side.face;
  const half = 0.75;
  const roomWall = 0.5;
  // Leaf side: whichever side has 1.6 m of free wall.
  const sp = rc.spans[sideIdx]!;
  const free = (dir: 1 | -1) => {
    const a = s + dir * (half + 0.05);
    const z = s + dir * (half + 1.55);
    return Math.min(a, z) > 0.15 && Math.max(a, z) < face.len - 0.15 && !side.doors.some((o) => o !== s && Math.abs(o - (a + z) / 2) < 1.7);
  };
  const pref: 1 | -1 = rng.chance(0.5) ? 1 : -1;
  const leafSide: 1 | -1 | 0 = free(pref) ? pref : free(-pref as 1 | -1) ? (-pref as 1 | -1) : 0;
  {
    const { f } = ctx.wall(face, s, dec.WALL_TOP, s + (leafSide === 0 ? 1.2 : -leafSide * 1.2));
    dec.doorFrame(f, half);
    dec.lintel(f, half, roomWall);
    if (leafSide !== 0) {
      dec.doorLeaf(f.sub(leafSide * half, 0, 0), leafSide, 1.45);
      sp.block(Math.min(s + leafSide * half, s + leafSide * (half + 1.55)), Math.max(s + leafSide * half, s + leafSide * (half + 1.55)));
    }
  }
  // Corridor side.
  if (beyond(ctx.plan, side, s) !== 'corridor') return;
  const depth = 1.5;
  const [cx, cz] = facePoint(face, s, -(roomWall + depth));
  const cf: WallFace = { ox: cx, oz: cz, nx: -face.nx, nz: -face.nz, len: 0 };
  // anchor: the strip beside the door
  const anchor = solidBeside(ctx, cf);
  const { f, g } = ctx.wall(cf, 0, dec.WALL_TOP, anchor);
  dec.doorFrame(f, half);
  dec.lintel(f, half, depth);
  const slot = ctx.atlas.slot(label, 256, 64, SIGN_STYLE);
  if (Math.abs(cf.nz) > 0.5) {
    const t = dec.signPlate(f, 1.2, 0.3, 2.62);
    g.texts.push(dec.textQuad(f, slot, t.x0, t.x1, t.y0, t.y1, t.z));
  } else {
    // flag-mounted beside the door so it reads from the camera (which always looks north)
    const ss = anchor > 0 ? half + 0.25 : -half - 0.25;
    const fs = f.sub(ss, 0, 0);
    const w = 0.9;
    dec.flagSignPlate(fs, w, 0.26, 2.5);
    g.texts.push(dec.textQuad(fs.sub(0.022, 0, 0.08 + w / 2, Math.PI / 2), slot, -w / 2 + 0.03, w / 2 - 0.03, 2.5 - 0.1, 2.5 + 0.1, 0));
    g.texts.push(dec.textQuad(fs.sub(-0.022, 0, 0.08 + w / 2, -Math.PI / 2), slot, -w / 2 + 0.03, w / 2 - 0.03, 2.5 - 0.1, 2.5 + 0.1, 0));
  }
}

/** Along-offset (±1.15 m) beside a corridor-side door that is solid strip. */
function solidBeside(ctx: Ctx, cf: WallFace): number {
  for (const s of [1.15, -1.15, 1.6, -1.6]) {
    const [x, z] = facePoint(cf, s, -0.12);
    if (fineFlags(ctx.plan, x, z) & F_SOLID) return s;
  }
  return 1.15;
}

function isWindowWall(ctx: Ctx, side: RoomSide, s: number, kind: RoomKind): boolean {
  const k = beyond(ctx.plan, side, s);
  return k === 'outside' || (k === 'courtyard' && kind !== 'courtyard');
}

function windows(ctx: Ctx, rc: RoomCtx, i: number): void {
  const side = rc.sides[i]!;
  if (i === rc.back && rc.room.kind !== 'gym' && rc.room.kind !== 'bathroom') {
    // the back wall keeps its board, unless it's long enough for both
    if (side.face.len < 12) return;
  }
  const w = 1.5;
  const y0 = 0.95;
  const y1 = 2.35;
  const sp = rc.spans[i]!;
  const step = 2.3;
  const n = Math.floor((side.face.len - 1.0) / step);
  const start = (side.face.len - (n - 1) * step) / 2;
  for (let k = 0; k < n; k++) {
    const s = start + k * step;
    if (!isWindowWall(ctx, side, s, rc.room.kind)) continue;
    if (i === rc.back && Math.abs(s - side.face.len / 2) < 2.2) continue;
    if (!sp.fits(s, w + 0.12, y0 - 0.06)) continue;
    sp.block(s - w / 2 - 0.06, s + w / 2 + 0.06, y1);
    const { f } = ctx.wall(side.face, s, y1);
    dec.windowUnit(f, w, y0, y1, false);
    sunPatch(ctx, rc, side.face, s, w - 0.14, y0 + 0.07, y1 - 0.07);
  }
}

/** Long gold bars of afternoon sun on the floor in front of a window (unlit glow quads). */
function sunPatch(ctx: Ctx, rc: RoomCtx, face: WallFace, s: number, w: number, y0: number, y1: number): void {
  const dot = SUN_DIR[0] * face.nx + SUN_DIR[1] * face.nz;
  if (dot < 0.15) return;
  const base = FLOOR[rc.room.kind];
  const col = mixHex(shadeHex(base, 0.9), PP.sunPatch, 0.4);
  const f = ctx.floor(...facePoint(face, s, 0.5));
  const proj = (sAlong: number, y: number): [number, number] => {
    const [px, pz] = facePoint(face, sAlong, 0.02);
    const k = y / SUN_TAN;
    // clamp inside the room
    const x = Math.min(rc.b.x1 - 0.05, Math.max(rc.b.x0 + 0.05, px + SUN_DIR[0] * k));
    const z = Math.min(rc.b.z1 - 0.05, Math.max(rc.b.z0 + 0.05, pz + SUN_DIR[1] * k));
    return [x, z];
  };
  const ym = y0 + (y1 - y0) * 0.62;
  const panes: [number, number, number, number][] = [
    [s - w / 2, s - 0.03, y0, ym - 0.03],
    [s + 0.03, s + w / 2, y0, ym - 0.03],
    [s - w / 2, s - 0.03, ym + 0.03, y1],
    [s + 0.03, s + w / 2, ym + 0.03, y1],
  ];
  for (const [a, bb, ya, yb] of panes) {
    const pts = [proj(a, ya), proj(bb, ya), proj(bb, yb), proj(a, yb)];
    const fw = new Frame(f.b);
    fw.floor(pts, 0.012, col, col);
  }
}

const POSTERS: Record<string, dec.PosterKind[]> = {
  classroom: ['shapes', 'stripes', 'mountain', 'book'],
  art: ['paint', 'paint', 'shapes', 'mountain'],
  band: ['note', 'note', 'stripes'],
  lab: ['periodic', 'shapes', 'stripes'],
  library: ['book', 'book', 'mountain'],
  cafeteria: ['fruit', 'fruit', 'stripes'],
  office: ['certificate', 'mountain', 'stripes'],
  principal: ['certificate', 'certificate', 'mountain'],
  gym: ['stripes', 'shapes'],
  bathroom: ['shapes'],
};

function posterOn(ctx: Ctx, rc: RoomCtx, i: number, rng: Rng, pref?: number): boolean {
  const kinds = POSTERS[rc.room.kind] ?? POSTERS.classroom!;
  const kind = rng.pick(kinds);
  const cert = kind === 'certificate';
  const w = cert ? 0.5 : kind === 'periodic' ? 1.1 : 0.6;
  const h = cert ? 0.4 : kind === 'periodic' ? 0.7 : 0.85;
  const y0 = cert ? 1.45 : 1.25;
  const side = rc.sides[i]!;
  const s = rc.spans[i]!.take(w, y0, pref ?? side.face.len * (0.25 + 0.5 * rng.next()), y0 + h);
  if (s === null) return false;
  const { f } = ctx.wall(side.face, s, y0 + h);
  dec.poster(f, w, h, y0, kind, rng, rng.chance(0.5) ? ctx.colours : [ctx.colours[1], ctx.colours[0]]);
  return true;
}

function boardOn(ctx: Ctx, rc: RoomCtx, i: number, rng: Rng, w = 1.6): boolean {
  const side = rc.sides[i]!;
  const s = rc.spans[i]!.take(w, 1.05, side.face.len / 2, 2.1);
  if (s === null) return false;
  const { f } = ctx.wall(side.face, s, 2.1);
  dec.bulletinBoard(f, w, 1.0, 1.05, rng);
  return true;
}

function clockOn(ctx: Ctx, rc: RoomCtx, i: number, pref: number, y = 2.45): void {
  const side = rc.sides[i]!;
  const s = rc.spans[i]!.take(0.46, y - 0.24, pref, y + 0.24);
  if (s === null) return;
  const { f } = ctx.wall(side.face, s, y + 0.22);
  dec.clock(f, y);
}

/** Floor piece standing against a side wall at along-position s; checks the floor is free. */
function floorAgainst(ctx: Ctx, rc: RoomCtx, i: number, s: number, w: number, d: number, h: number, build: (f: Frame) => void): boolean {
  const side = rc.sides[i]!;
  const face = side.face;
  const [ax, az] = faceAlong(face);
  const [px, pz] = facePoint(face, s, 0);
  const qx = px + face.nx * d;
  const qz = pz + face.nz * d;
  const x0 = Math.min(px - (ax * w) / 2, px + (ax * w) / 2, qx - (ax * w) / 2, qx + (ax * w) / 2);
  const x1 = Math.max(px - (ax * w) / 2, px + (ax * w) / 2, qx - (ax * w) / 2, qx + (ax * w) / 2);
  const z0 = Math.min(pz - (az * w) / 2, pz + (az * w) / 2, qz - (az * w) / 2, qz + (az * w) / 2);
  const z1 = Math.max(pz - (az * w) / 2, pz + (az * w) / 2, qz - (az * w) / 2, qz + (az * w) / 2);
  if (s - w / 2 < 0.05 || s + w / 2 > face.len - 0.05) return false;
  if (!rectClear(ctx.plan, x0 + 0.01, z0 + 0.01, x1 - 0.01, z1 - 0.01)) return false;
  if (ctx.nearDoor((x0 + x1) / 2, (z0 + z1) / 2, 1.6 + w / 2)) return false;
  if (!rc.spans[i]!.fits(s, w, 0, 0.05)) return false;
  rc.spans[i]!.block(s - w / 2, s + w / 2, h);
  build(ctx.floor(px, pz, faceYaw(face)));
  return true;
}

/** Try several along-positions for a floor piece against wall i. */
function floorAgainstAny(ctx: Ctx, rc: RoomCtx, i: number, w: number, d: number, h: number, rng: Rng, build: (f: Frame) => void, prefs?: number[]): boolean {
  const len = rc.sides[i]!.face.len;
  const tries = prefs ?? [0.12, 0.88, 0.3, 0.7, 0.5].map((t) => t * len + (rng.next() - 0.5) * 0.3);
  for (const s of tries) if (floorAgainst(ctx, rc, i, s, w, d, h, build)) return true;
  return false;
}

function sideWalls(rc: RoomCtx): number[] {
  return [0, 1, 2, 3].filter((i) => i !== rc.front && i !== rc.back);
}

function dressClassroom(ctx: Ctx, rc: RoomCtx, rng: Rng): void {
  const kind = rc.room.kind;
  const back = rc.sides[rc.back]!;
  const style = kind === 'band' ? 'music' : kind === 'lab' ? 'lab' : kind === 'art' ? 'art' : 'class';
  const bw = Math.min(3.0, back.face.len - 2.4);
  const s = rc.spans[rc.back]!.take(bw, 0.92, back.face.len / 2, 2.05);
  if (s !== null) {
    const { f } = ctx.wall(back.face, s, 2.05);
    dec.whiteboard(f, bw, rng, style);
    clockOn(ctx, rc, rc.back, s + (rng.chance(0.5) ? 0 : bw * 0.3), 2.42);
  }
  posterOn(ctx, rc, rc.back, rng, back.face.len * (rng.chance(0.5) ? 0.12 : 0.88));
  for (const i of sideWalls(rc)) {
    if (rng.chance(0.7)) boardOn(ctx, rc, i, rng, kind === 'classroom' ? 1.6 : 1.3);
    posterOn(ctx, rc, i, rng);
    if (rng.chance(0.5)) posterOn(ctx, rc, i, rng);
  }
  // door wall: coat hooks with backpacks, a poster
  {
    const fr = rc.sides[rc.front]!;
    const w = 1.8;
    const s2 = rc.spans[rc.front]!.take(w, 1.0, fr.face.len * (rng.chance(0.5) ? 0.25 : 0.75), 1.75);
    if (s2 !== null) {
      const { f } = ctx.wall(fr.face, s2, 1.75);
      dec.coatHooks(f, w, rng);
    }
    posterOn(ctx, rc, rc.front, rng);
  }
  // floor: wastebasket by the teacher's desk, a cubby / lab counter, a plant, room extras
  const td = rc.furn.find((f) => f.kind === 'teacherDesk');
  if (td) {
    for (const [dx, dz] of [
      [td.w / 2 + 0.3, 0],
      [-td.w / 2 - 0.3, 0],
      [0, td.d / 2 + 0.3],
      [0, -td.d / 2 - 0.3],
    ] as const) {
      const x = td.x + dx;
      const z = td.z + dz;
      if (rectClear(ctx.plan, x - 0.15, z - 0.15, x + 0.15, z + 0.15)) {
        dec.wastebasket(ctx.floor(x, z, 0));
        break;
      }
    }
  }
  const sw = sideWalls(rc);
  const cab = kind === 'lab' ? 'lab' : 'cubby';
  floorAgainstAny(ctx, rc, rng.pick(sw), 1.6, 0.5, 0.95, rng, (f) => dec.lowCabinet(f, 1.6, cab, rng));
  if (rng.chance(0.5)) floorAgainstAny(ctx, rc, rng.pick(sw), 0.5, 0.5, 1.1, rng, (f) => dec.pottedPlant(f.sub(0, 0, 0.25), rng.int(0, 999)));
  if (kind === 'art') {
    for (let k = 0; k < 2; k++) floorAgainstAny(ctx, rc, rng.pick([...sw, rc.front]), 0.9, 0.9, 1.6, rng, (f) => dec.easel(f.sub(0, 0, 0.45), rng));
  } else if (kind === 'band') {
    floorAgainstAny(ctx, rc, rng.pick(sw), 1.4, 0.9, 1.1, rng, (f) => dec.drum(f.sub(0, 0, 0.45)));
    for (let k = 0; k < 3; k++) floorAgainstAny(ctx, rc, rng.pick(sw), 0.6, 0.6, 1.3, rng, (f) => dec.musicStand(f.sub(0, 0, 0.35)));
  }
}

function dressLibrary(ctx: Ctx, rc: RoomCtx, rng: Rng): void {
  const back = rc.sides[rc.back]!;
  const s = rc.spans[rc.back]!.take(1.8, 1.9, back.face.len / 2, 2.5);
  if (s !== null) {
    const { f, g } = ctx.wall(back.face, s, 2.5);
    const t = dec.framedBoard(f, 1.8, 0.5, 1.95, PP.woodDark);
    const slot = ctx.atlas.slot('QUIET PLEASE', 384, 96, { bg: PP.signNavy, fg: PP.signText, font: 'display' });
    g.texts.push(dec.textQuad(f, slot, t.x0, t.x1, t.y0, t.y1, t.z));
  }
  clockOn(ctx, rc, rc.front, rc.sides[rc.front]!.face.len * 0.75, 2.45);
  for (const i of [0, 1, 2, 3]) {
    posterOn(ctx, rc, i, rng);
    if (rng.chance(0.5)) posterOn(ctx, rc, i, rng);
  }
  {
    const fr = rc.sides[rc.front]!;
    const s2 = rc.spans[rc.front]!.take(1.0, 1.4, fr.face.len * 0.25, 1.85);
    if (s2 !== null) {
      const { f, g } = ctx.wall(fr.face, s2, 1.85);
      const t = dec.framedBoard(f, 1.0, 0.45, 1.4, PP.woodMid);
      const slot = ctx.atlas.slot('READ!', 256, 112, { bg: ctx.colours[0], fg: ctx.colours[1], font: 'display' });
      g.texts.push(dec.textQuad(f, slot, t.x0, t.x1, t.y0, t.y1, t.z));
    }
  }
  for (let k = 0; k < 3; k++) {
    const i = rng.pick([0, 1, 2, 3]);
    floorAgainstAny(ctx, rc, i, 0.8, 0.8, 0.5, rng, (f) => dec.beanbag(f.sub(0, 0, 0.42), PP.beanbag[k % PP.beanbag.length]!));
  }
  floorAgainstAny(ctx, rc, rng.pick(sideWalls(rc)), 0.5, 0.5, 1.1, rng, (f) => dec.pottedPlant(f.sub(0, 0, 0.25), rng.int(0, 999)));
}

function menuText(rng: Rng): string {
  const days = ['MON  PIZZA DAY', 'TUE  TACO TUESDAY', 'WED  MYSTERY MEAT', 'THU  MAC & CHEESE', 'FRI  FISH STICKS'];
  if (rng.chance(0.5)) days[2] = 'WED  SLOPPY JOES';
  return `TODAY'S LUNCH\n${days.join('\n')}`;
}

function dressCafeteria(ctx: Ctx, rc: RoomCtx, rng: Rng): void {
  const back = rc.sides[rc.back]!;
  const w = 2.6;
  const s = rc.spans[rc.back]!.take(w, 1.97, back.face.len / 2, 2.95);
  if (s !== null) {
    const { f, g } = ctx.wall(back.face, s, 2.95);
    const t = dec.framedBoard(f, w, 0.96, 1.98, PP.woodDark);
    const slot = ctx.atlas.slot(menuText(rng), 400, 168, { bg: 0x2f3a33, fg: 0xf4f1ea, font: 'board' });
    g.texts.push(dec.textQuad(f, slot, t.x0, t.x1, t.y0, t.y1, t.z));
  }
  clockOn(ctx, rc, rc.front, rc.sides[rc.front]!.face.len * 0.7, 2.45);
  for (const i of sideWalls(rc)) {
    posterOn(ctx, rc, i, rng);
    posterOn(ctx, rc, i, rng);
  }
  posterOn(ctx, rc, rc.front, rng);
  const fr = rc.front;
  floorAgainstAny(ctx, rc, fr, 0.5, 0.5, 0.8, rng, (f) => dec.trashCan(f.sub(0, 0, 0.25)));
  floorAgainstAny(ctx, rc, fr, 0.5, 0.5, 0.8, rng, (f) => dec.recycleBin(f.sub(0, 0, 0.25)));
  floorAgainstAny(ctx, rc, rng.pick(sideWalls(rc)), 0.95, 0.65, 1.0, rng, (f) => dec.milkCooler(f));
  floorAgainstAny(ctx, rc, rng.pick(sideWalls(rc)), 0.5, 0.5, 0.8, rng, (f) => dec.trashCan(f.sub(0, 0, 0.25)));
}

function dressGym(ctx: Ctx, rc: RoomCtx, rng: Rng): void {
  const { b } = rc;
  const w = b.x1 - b.x0;
  const d = b.z1 - b.z0;
  const longX = w >= d;
  // court lines
  const m = 1.0;
  const x0 = b.x0 + m;
  const x1 = b.x1 - m;
  const z0 = b.z0 + m;
  const z1 = b.z1 - m;
  const f = ctx.floor((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 0);
  const fl = new Frame(f.b);
  const L = PP.courtLine;
  const t = 0.07;
  const y = 0.014;
  fl.floorRect(x0, x1, z0, z0 + t, y, L);
  fl.floorRect(x0, x1, z1 - t, z1, y, L);
  fl.floorRect(x0, x0 + t, z0, z1, y, L);
  fl.floorRect(x1 - t, x1, z0, z1, y, L);
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  if (longX) fl.floorRect(cx - t / 2, cx + t / 2, z0, z1, y, L);
  else fl.floorRect(x0, x1, cz - t / 2, cz + t / 2, y, L);
  fl.floorRing(cx, cz, 1.4, 1.4 + t, 28, y, L);
  fl.floorRing(cx, cz, 0, 0.5, 16, y - 0.001, PP.courtPaint);
  // keys at both short ends
  const keyW = Math.min(3.0, (longX ? d : w) * 0.4);
  const keyL = Math.min(4.0, (longX ? w : d) * 0.25);
  for (const end of [-1, 1]) {
    if (longX) {
      const ex = end < 0 ? x0 : x1;
      const kx0 = Math.min(ex, ex - end * keyL);
      const kx1 = Math.max(ex, ex - end * keyL);
      fl.floorRect(kx0, kx1, cz - keyW / 2, cz + keyW / 2, y - 0.002, PP.courtPaint);
      fl.floorRing(ex - end * keyL, cz, keyW / 2 - t, keyW / 2, 16, y, L, end < 0 ? -Math.PI / 2 : Math.PI / 2, Math.PI);
    } else {
      const ez = end < 0 ? z0 : z1;
      const kz0 = Math.min(ez, ez - end * keyL);
      const kz1 = Math.max(ez, ez - end * keyL);
      fl.floorRect(cx - keyW / 2, cx + keyW / 2, kz0, kz1, y - 0.002, PP.courtPaint);
      fl.floorRing(cx, ez - end * keyL, keyW / 2 - t, keyW / 2, 16, y, L, end < 0 ? Math.PI : 0, Math.PI);
    }
  }
  // hoops on the two short walls (floor stands, backboard toward the court)
  const shortSides = longX ? [2, 3] : [0, 1];
  for (const i of shortSides) {
    const side = rc.sides[i]!;
    const mid = side.face.len / 2;
    let ok = false;
    for (const s of [mid, mid + 1.2, mid - 1.2, mid + 2.4, mid - 2.4]) {
      if ((ok = floorAgainst(ctx, rc, i, s, 1.2, 1.4, 2.95, (fr) => dec.hoop(fr)))) break;
    }
    if (!ok) {
      // bleachers (or a door) in the way: hang it on the wall above them
      const s = rc.spans[i]!.take(1.3, 2.1, mid, 2.95);
      if (s !== null) dec.wallHoop(ctx.wall(side.face, s, 2.95).f);
    }
  }
  // scoreboard above the bleachers, a big banner opposite
  const back = rc.sides[rc.back]!;
  const sb = rc.spans[rc.back]!.take(2.4, 2.05, back.face.len / 2, 2.85);
  if (sb !== null) {
    const { f: wf, g } = ctx.wall(back.face, sb, 2.85);
    const tt = dec.scoreboard(wf, 2.4, 0.75, 2.05);
    const slot = ctx.atlas.slot(`HOME 21   GUEST 18`, 384, 96, { bg: PP.scoreboard, fg: PP.scoreDigit, font: 'led' });
    g.texts.push(dec.textQuad(wf, slot, tt.x0, tt.x1, tt.y0, tt.y1, tt.z));
  }
  for (const i of [rc.front, ...sideWalls(rc)]) {
    const side = rc.sides[i]!;
    const bw = Math.min(3.2, side.face.len - 2);
    const s = rc.spans[i]!.take(bw, 2.0, side.face.len / 2, 2.85);
    if (s === null) continue;
    const { f: wf, g } = ctx.wall(side.face, s, 2.85);
    const tt = dec.banner(wf, bw, 0.75, 2.85, ctx.colours);
    const slot = ctx.atlas.slot(`GO ${ctx.mascot}!`, 448, 104, { bg: ctx.colours[0], fg: ctx.colours[1], font: 'display' });
    g.texts.push(dec.textQuad(wf, slot, tt.x0, tt.x1, tt.y0, tt.y1, tt.z));
    break;
  }
  clockOn(ctx, rc, rc.front, rc.sides[rc.front]!.face.len * 0.8, 2.4);
  const sw = sideWalls(rc);
  floorAgainstAny(ctx, rc, rng.pick([...sw, rc.front]), 1.3, 0.5, 0.8, rng, (fr) => dec.ballRack(fr, rng));
  floorAgainstAny(ctx, rc, rng.pick([...sw, rc.front]), 1.9, 1.05, 0.4, rng, (fr) => dec.matStack(fr));
}

function dressBathroom(ctx: Ctx, rc: RoomCtx, rng: Rng): void {
  const sw = sideWalls(rc);
  // sinks + mirrors along the side wall with the most room
  // prefer the wall the fixed camera (looking north) can see: north side first, then east/west, south last
  const score = (k: number) => rc.sides[k]!.face.nz * 2 + rc.sides[k]!.face.len * 0.01;
  const i = sw.slice().sort((a, b) => score(b) - score(a))[0]!;
  const side = rc.sides[i]!;
  let n = 0;
  for (let k = 0; k < 6 && n < 3; k++) {
    const s = 1.0 + k * 0.85;
    if (s > side.face.len - 0.6) break;
    if (floorAgainst(ctx, rc, i, s, 0.55, 0.45, 1.0, (f) => dec.sink(f))) {
      n++;
      const top = 1.9;
      if (rc.spans[i]!.fits(s, 0.5, 1.15, 0.02)) {
        rc.spans[i]!.block(s - 0.25, s + 0.25, top);
        const { f } = ctx.wall(side.face, s, top);
        dec.mirror(f, 0.5, 0.7, 1.2);
      }
    }
  }
  const t = rc.spans[i]!.take(0.32, 1.1, side.face.len - 1.0, 1.5);
  if (t !== null) dec.towelDispenser(ctx.wall(side.face, t, 1.5).f, 1.1);
  floorAgainstAny(ctx, rc, rc.front, 0.45, 0.45, 0.8, rng, (f) => dec.trashCan(f.sub(0, 0, 0.23)));
  for (const j of sw) if (j !== i) posterOn(ctx, rc, j, rng);
}

function dressOffice(ctx: Ctx, rc: RoomCtx, rng: Rng): void {
  const principal = rc.room.kind === 'principal';
  const back = rc.sides[rc.back]!;
  clockOn(ctx, rc, rc.back, back.face.len * 0.5, 2.45);
  for (let k = 0; k < (principal ? 3 : 2); k++) posterOn(ctx, rc, rc.back, rng, back.face.len * (0.2 + 0.3 * k));
  for (const i of sideWalls(rc)) {
    if (!principal && rng.chance(0.6)) boardOn(ctx, rc, i, rng, 1.3);
    posterOn(ctx, rc, i, rng);
  }
  posterOn(ctx, rc, rc.front, rng);
  const sw = sideWalls(rc);
  const desk = rc.furn.find((f) => f.kind === 'officeDesk');
  if (principal && desk) {
    // rug + two visitor chairs in front of the desk
    const fx = Math.sin(desk.face);
    const fz = Math.cos(desk.face);
    const rx = desk.x + fx * 1.3;
    const rz = desk.z + fz * 1.3;
    dec.rug(ctx.floor(rx, rz, desk.face), 2.6, 1.8, PP.rugRed);
    for (const side of [-1, 1]) {
      const px = rx + side * Math.cos(desk.face) * 0.6;
      const pz = rz - side * Math.sin(desk.face) * 0.6;
      if (rectClear(ctx.plan, px - 0.25, pz - 0.25, px + 0.25, pz + 0.25)) dec.visitorChair(ctx.floor(px, pz, desk.face + Math.PI));
    }
  }
  if (!principal) {
    floorAgainstAny(ctx, rc, rng.pick(sw), 0.5, 0.65, 1.35, rng, (f) => dec.filingCabinet(f.sub(0, 0, 0.02)));
    floorAgainstAny(ctx, rc, rng.pick(sw), 0.5, 0.65, 1.35, rng, (f) => dec.filingCabinet(f.sub(0, 0, 0.02)));
    floorAgainstAny(ctx, rc, rng.pick([...sw, rc.front]), 0.4, 0.4, 1.4, rng, (f) => dec.waterCooler(f.sub(0, 0, 0.02)));
  }
  floorAgainstAny(ctx, rc, rng.pick(sw), 0.5, 0.5, 1.1, rng, (f) => dec.pottedPlant(f.sub(0, 0, 0.25), rng.int(0, 999)));
}

function dressCourtyard(ctx: Ctx, rc: RoomCtx, rng: Rng): void {
  const { b } = rc;
  const cx = (b.x0 + b.x1) / 2;
  const cz = (b.z0 + b.z1) / 2;
  dec.tree(ctx.floor(cx, cz, rng.next() * Math.PI * 2), rng.int(0, 999));
  // the classrooms around it look out through windows (seen from outside)
  rc.sides.forEach((side, i) => {
    const step = 2.3;
    const n = Math.floor((side.face.len - 1.0) / step);
    const start = (side.face.len - (n - 1) * step) / 2;
    for (let k = 0; k < n; k++) {
      const s = start + k * step;
      const what = beyond(ctx.plan, side, s);
      if (what === 'corridor' || what === 'outside') continue;
      if (!rc.spans[i]!.fits(s, 1.62, 0.89)) continue;
      rc.spans[i]!.block(s - 0.81, s + 0.81, 2.35);
      dec.windowUnit(ctx.wall(side.face, s, 2.35).f, 1.5, 0.95, 2.35, true);
    }
    for (let k = 0; k < 2; k++) floorAgainstAny(ctx, rc, i, 0.6, 0.6, 0.4, rng, (f) => dec.flowerClump(f.sub(0, 0, 0.35), rng));
  });
}

// ── hallways ─────────────────────────────────────────────────────────────────

function dressHalls(ctx: Ctx, rng: Rng): void {
  const plan = ctx.plan;
  const faces = corridorFaces(plan);
  const embedded = plan.furniture.filter((f) => f.kind === 'locker' || f.kind === 'trophyCase' || (f.kind === 'vending' && Math.min(f.w, f.d) <= 0.5));
  const placed: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, r: number) => !placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r);
  let banners = 0;
  const bannerTexts = [`GO ${ctx.mascot}!`, ctx.plan.name.toUpperCase(), `HOME OF THE ${ctx.mascot}`];
  // Is a span of the strip at along s (width w) a plain solid wall with open floor in front, and — for things
  // that reach below `above` — clear of embedded lockers / cases?
  const spotOk = (face: WallFace, s: number, w: number, above: number): boolean => {
    const [ax, az] = faceAlong(face);
    const [p0x, p0z] = facePoint(face, s - w / 2, -0.25);
    const [p1x, p1z] = facePoint(face, s + w / 2, -0.25);
    if (!rectSolid(plan, Math.min(p0x, p1x) + 0.01 * Math.abs(az), Math.min(p0z, p1z) + 0.01 * Math.abs(ax), Math.max(p0x, p1x) - 0.01 * Math.abs(az), Math.max(p0z, p1z) - 0.01 * Math.abs(ax))) return false;
    const [q0x, q0z] = facePoint(face, s - w / 2, 0.3);
    const [q1x, q1z] = facePoint(face, s + w / 2, 0.3);
    if (!rectClear(plan, Math.min(q0x, q1x) + 0.01, Math.min(q0z, q1z) + 0.01, Math.max(q0x, q1x) - 0.01, Math.max(q0z, q1z) - 0.01, F_SOLID)) return false;
    if (above < 2.0) {
      const [mx, mz] = facePoint(face, s, -0.25);
      for (const f of embedded) {
        if (Math.abs(f.x - mx) < f.w / 2 + Math.abs(ax) * (w / 2) + 0.15 && Math.abs(f.z - mz) < f.d / 2 + Math.abs(az) * (w / 2) + 0.15) return false;
      }
    }
    return !ctx.nearDoor(...facePoint(face, s, 0), 1.0 + w / 2);
  };

  for (const { face } of faces) {
    const visible = face.nz > 0.5; // faces the camera (it always looks north)
    const sideways = Math.abs(face.nx) > 0.5;
    const cands = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0].map((s) => s + (rng.next() - 0.5) * 0.4);
    // shuffle deterministically
    for (let i = cands.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [cands[i], cands[j]] = [cands[j]!, cands[i]!];
    }
    for (const s of cands) {
      const [px, pz] = facePoint(face, s, 0);
      const roll = rng.next();
      if (visible && roll < 0.16 && banners < 2 + Math.floor(faces.length / 10) && spotOk(face, s, 2.6, 2.1) && free(px, pz, 2.2)) {
        const { f, g } = ctx.wall(face, s, 2.85);
        const t = dec.banner(f, 2.6, 0.65, 2.85, ctx.colours);
        const slot = ctx.atlas.slot(bannerTexts[banners % bannerTexts.length]!, 512, 120, { bg: ctx.colours[0], fg: ctx.colours[1], font: 'display' });
        g.texts.push(dec.textQuad(f, slot, t.x0, t.x1, t.y0, t.y1, t.z));
        placed.push({ x: px, z: pz, r: 1.6 });
        banners++;
      } else if (sideways && roll < 0.1 && spotOk(face, s, 0.3, 2.2) && free(px, pz, 2.0)) {
        dec.pennant(ctx.wall(face, s, 2.95).f, 0.55, 1.1, 2.9, ctx.colours);
        placed.push({ x: px, z: pz, r: 1.0 });
      } else if (roll < 0.3 && spotOk(face, s, 1.4, 1.05) && free(px, pz, 1.2)) {
        const { f } = ctx.wall(face, s, 2.05);
        dec.bulletinBoard(f, 1.4, 0.9, 1.15, rng);
        placed.push({ x: px, z: pz, r: 1.0 });
      } else if (roll < 0.42 && spotOk(face, s, 0.6, 1.25) && free(px, pz, 0.8)) {
        const { f } = ctx.wall(face, s, 2.1);
        dec.poster(f, 0.6, 0.85, 1.25, rng.pick(['shapes', 'stripes', 'mountain', 'note'] as const), rng, rng.chance(0.5) ? ctx.colours : [ctx.colours[1], ctx.colours[0]]);
        placed.push({ x: px, z: pz, r: 0.6 });
      } else if (roll < 0.5 && spotOk(face, s, 0.6, 0) && free(px, pz, 2.5)) {
        dec.fountain(ctx.floor(px, pz, faceYaw(face)));
        placed.push({ x: px, z: pz, r: 1.0 });
      } else if (roll < 0.6 && spotOk(face, s, 0.5, 0) && free(px, pz, 2.5)) {
        const [tx, tz] = facePoint(face, s, 0.3);
        dec.trashCan(ctx.floor(tx, tz, 0));
        placed.push({ x: px, z: pz, r: 1.0 });
      } else if (visible && roll < 0.64 && spotOk(face, s, 0.46, 2.15) && free(px, pz, 3)) {
        dec.clock(ctx.wall(face, s, 2.65).f, 2.42);
        placed.push({ x: px, z: pz, r: 0.5 });
      }
    }
  }
}

// ── batching ─────────────────────────────────────────────────────────────────

const IDENTITY = new THREE.Matrix4();

function finish(ctx: Ctx): Dressing {
  const root = new THREE.Group();
  root.name = 'dressing';
  const modelGeos: { geo: THREE.BufferGeometry; group: number | null }[] = [];
  const groupList = [...ctx.groups.values()];
  for (const b of ctx.chunks.values()) if (b.triangles > 0) modelGeos.push({ geo: b.build(), group: null });
  groupList.forEach((g, i) => {
    if (g.b.triangles > 0) modelGeos.push({ geo: g.b.build(), group: i });
  });
  const textGeos: { geo: THREE.BufferGeometry; group: number }[] = [];
  if (ctx.atlas.count > 0) ctx.atlas.layout();
  groupList.forEach((g, i) => {
    if (g.texts.length) textGeos.push({ geo: textGeometry(ctx.atlas, g.texts), group: i });
  });

  let triangles = 0;
  let meshes = 0;
  const disposables: { dispose(): void }[] = [];
  const modelIds = new Map<number, number>();
  const textIds = new Map<number, number>();

  const makeBatch = (items: { geo: THREE.BufferGeometry; group: number | null }[], material: THREE.Material, ids: Map<number, number>, name: string): THREE.BatchedMesh | null => {
    if (items.length === 0) return null;
    let verts = 0;
    for (const it of items) verts += it.geo.getAttribute('position').count;
    const bm = new THREE.BatchedMesh(items.length, verts, 0, material);
    bm.name = name;
    for (const it of items) {
      const gid = bm.addGeometry(it.geo);
      const iid = bm.addInstance(gid);
      bm.setMatrixAt(iid, IDENTITY);
      if (it.group !== null) ids.set(it.group, iid);
      triangles += it.geo.getAttribute('position').count / 3;
      it.geo.dispose();
    }
    bm.computeBoundingBox();
    bm.computeBoundingSphere();
    root.add(bm);
    disposables.push(bm);
    meshes++;
    return bm;
  };

  const model = makeBatch(modelGeos, modelMaterial(), modelIds, 'dressing-model');
  let textMat: THREE.Material | null = null;
  let text: THREE.BatchedMesh | null = null;
  if (textGeos.length) {
    const tex = ctx.atlas.texture();
    textMat = tex
      ? new THREE.MeshToonMaterial({ map: tex, gradientMap: toonGradient() })
      : new THREE.MeshToonMaterial({ color: PP.signNavy, gradientMap: toonGradient() });
    textMat.name = 'hp-dressing-text';
    if (tex) disposables.push(tex);
    disposables.push(textMat);
    text = makeBatch(textGeos, textMat, textIds, 'dressing-text');
  }

  const proxies = new THREE.Group();
  proxies.name = 'dressing-wall-items';
  root.add(proxies);
  const wallItems: WallItem[] = [];
  groupList.forEach((g, i) => {
    const mId = modelIds.get(i);
    const tId = textIds.get(i);
    if (mId === undefined && tId === undefined) return;
    const o = new THREE.Object3D();
    o.name = 'wall-item';
    let vis = true;
    Object.defineProperty(o, 'visible', {
      configurable: true,
      enumerable: true,
      get: () => vis,
      set: (v: boolean) => {
        if (v === vis) return;
        vis = v;
        if (model && mId !== undefined) model.setVisibleAt(mId, v);
        if (text && tId !== undefined) text.setVisibleAt(tId, v);
      },
    });
    proxies.add(o);
    wallItems.push({ object: o, wallX: g.x, wallZ: g.z, top: Math.round(g.top * 1000) / 1000 });
  });

  return {
    root,
    wallItems,
    stats: { meshes, triangles },
    dispose() {
      for (const d of disposables) d.dispose();
      root.removeFromParent();
    },
  };
}

