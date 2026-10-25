// ─────────────────────────────────────────────────────────────────────────────
// Grey-box 3D school (milestones M1 + look pass, docs/ARCHITECTURE.md §6/§12).
// Builds floors (tiled), walls and furniture (with baked-on ink outlines) and
// markers from a SchoolPlan, and keeps the student and nearby staff visible:
//   'occlude' (default) — only walls that actually stand between the camera and
//             the student or a nearby staff member drop (Trash Panda's approach:
//             fade what blocks, keep everything else full height);
//   'cutaway' — every wall south of the student drops (Bad Hair Day's dollhouse);
//   'low' / 'full' — every wall low / full height.
// Lowering is visual only — the sim still treats every wall as full height.
// Final art (GeoBuilder models, windows, signage) replaces this in M5.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { damp } from '../core/math';
import { PAL } from '../render/palette';
import { toon, toonGradient } from '../render/toon';
import {
  CELL,
  CELL_CORRIDOR,
  FINE,
  F_SOLID,
  type Furniture,
  type RoomKind,
  type SchoolPlan,
} from '../school/types';

export type WallMode = 'occlude' | 'cutaway' | 'low' | 'full';

/** What the occlusion pass needs each frame: the camera and the points that must stay visible. */
export interface ViewPoints {
  camX: number;
  camY: number;
  camZ: number;
  /** x, y, z triples: the student first, then nearby staff. */
  points: Float32Array;
  count: number;
}

export const WALL_H = 3.0;
const CUT_H = 0.45;
const LOW_H = 1.1;
const SLAB_H = 0.4;
/** Ink outline thickness (m) of the inverted-hull boxes. */
const INK = 0.05;
/** Occlusion: a wall blocks a point if the camera ray passes within this margin of it (m). */
const OCC_MARGIN = 0.45;
/** Cut-away box around the focus: walls south of the focus within this depth and half-width drop. */
const CUT_DEPTH = 18;
const CUT_HALF_W = 13;

interface CutBox {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  full: number;
  /** Current animated height. */
  h: number;
}

export interface SchoolView {
  readonly root: THREE.Group;
  /** Animate the cut-away / occlusion for this frame. */
  update(dt: number, focusX: number, focusZ: number, mode: WallMode, view: ViewPoints): void;
  /** Hide a goal marker once collected. */
  setGoalDone(anchor: string, done: boolean): void;
  readonly stats: { wallBoxes: number; furniture: number };
  /** Debug: how many wall boxes are currently below full height. */
  cutCount(): number;
  dispose(): void;
}

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

const FURN_COLOR: Record<Furniture['kind'], number> = {
  desk: PAL.desk,
  teacherDesk: PAL.desk,
  locker: PAL.locker,
  stall: PAL.metal,
  shelf: PAL.shelf,
  table: PAL.deskTop,
  bleachers: PAL.bleachers,
  vending: PAL.vending,
  officeDesk: PAL.desk,
  trophyCase: PAL.trophy,
  bench: PAL.shelf,
  planter: PAL.plant,
};

/** Greedy merge of a fine-cell mask into rectangles (runs per row, then stacked rows with the same span). */
export function mergeRects(mask: Uint8Array, cols: number, rows: number): { c0: number; r0: number; c1: number; r1: number }[] {
  const out: { c0: number; r0: number; c1: number; r1: number }[] = [];
  const open = new Map<string, { c0: number; r0: number; c1: number; r1: number }>();
  for (let r = 0; r < rows; r++) {
    const runs: [number, number][] = [];
    let c = 0;
    while (c < cols) {
      if (!mask[r * cols + c]) {
        c++;
        continue;
      }
      const s = c;
      while (c < cols && mask[r * cols + c]) c++;
      runs.push([s, c]);
    }
    const next = new Map<string, { c0: number; r0: number; c1: number; r1: number }>();
    for (const [s, e] of runs) {
      const key = `${s}:${e}`;
      const prev = open.get(key);
      if (prev) {
        prev.r1 = r + 1;
        next.set(key, prev);
        open.delete(key);
      } else next.set(key, { c0: s, r0: r, c1: e, r1: r + 1 });
    }
    for (const v of open.values()) out.push(v);
    open.clear();
    for (const [k, v] of next) open.set(k, v);
  }
  for (const v of open.values()) out.push(v);
  return out;
}

/** Solid fine cells that face open floor within `reach` cells (walls + locker mass, not the solid outside). */
export function visibleSolidMask(plan: SchoolPlan, reach = 3): Uint8Array {
  const { cols, rows, flags } = plan.fine;
  const mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!(flags[r * cols + c]! & F_SOLID)) continue;
      let near = false;
      for (let dr = -reach; dr <= reach && !near; dr++) {
        for (let dc = -reach; dc <= reach && !near; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          near = !(flags[rr * cols + cc]! & F_SOLID);
        }
      }
      if (near) mask[r * cols + c] = 1;
    }
  }
  return mask;
}

export function buildSchoolView(plan: SchoolPlan, opts: { shadows: boolean }): SchoolView {
  const root = new THREE.Group();
  root.name = 'school';
  const disposables: { dispose(): void }[] = [];
  const W = plan.grid.cols * CELL;
  const D = plan.grid.rows * CELL;

  // ── ground + floors ──
  const groundGeo = new THREE.PlaneGeometry(W + 120, D + 120);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, toon(PAL.ground));
  ground.position.set(W / 2, -0.02, D / 2);
  ground.receiveShadow = true;
  root.add(ground);
  disposables.push(groundGeo);

  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const c3 = new THREE.Color();
  const quad = (x0: number, z0: number, x1: number, z1: number, hex: number, tile: number): void => {
    c3.setHex(hex).convertSRGBToLinear();
    pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
    for (let k = 0; k < 6; k++) col.push(c3.r, c3.g, c3.b);
    const u0 = x0 / tile, u1 = x1 / tile, v0 = z0 / tile, v1 = z1 / tile;
    uv.push(u0, v0, u0, v1, u1, v1, u0, v0, u1, v1, u1, v0);
  };
  const dim = plan.zones.filter((z) => z.kind === 'dim');
  for (let r = 0; r < plan.grid.rows; r++) {
    for (let c = 0; c < plan.grid.cols; c++) {
      const v = plan.cells[r * plan.grid.cols + c]!;
      if (v === -1) continue;
      let hex = v === CELL_CORRIDOR ? PAL.terrazzo : FLOOR[plan.rooms[v]!.kind];
      const cx = (c + 0.5) * CELL;
      const cz = (r + 0.5) * CELL;
      if (dim.some((z) => cx >= z.x0 && cx < z.x1 && cz >= z.z0 && cz < z.z1)) hex = PAL.floorDim;
      // Halls: 1 m terrazzo tiles. Rooms: 0.5 m tiles (gym and courtyard read as big boards / grass patches).
      const kind = v === CELL_CORRIDOR ? null : plan.rooms[v]!.kind;
      const tile = kind === null ? 1 : kind === 'gym' || kind === 'courtyard' ? 2 : 0.5;
      quad(c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL, hex, tile);
    }
  }
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  floorGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  floorGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  floorGeo.computeVertexNormals();
  const tileTex = tileTexture();
  const floorMat = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, map: tileTex, gradientMap: toonGradient() });
  disposables.push(tileTex, floorMat);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  root.add(floor);
  disposables.push(floorGeo);

  // ── walls (merged solid runs) + tall furniture share the cut-away ──
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  disposables.push(boxGeo);
  const rects = mergeRects(visibleSolidMask(plan), plan.fine.cols, plan.fine.rows);
  // Enclosed no-go cells (layout cells with no room, away from the grid edge) get a low slab, so they read as
  // building mass instead of a dark pit.
  const slabs: { c: number; r: number }[] = [];
  for (let r = 1; r < plan.grid.rows - 1; r++) {
    for (let c = 1; c < plan.grid.cols - 1; c++) if (plan.cells[r * plan.grid.cols + c] === -1) slabs.push({ c, r });
  }
  // Wall boxes carry a per-vertex shade: top faces darker than the sides, so a 1.5 m locker mass reads as the top of
  // a wall instead of a beige floor.
  const wallGeo = boxGeo.clone();
  const nrm = wallGeo.getAttribute('normal');
  const shade = new Float32Array(nrm.count * 3);
  for (let i = 0; i < nrm.count; i++) {
    const k = nrm.getY(i) > 0.5 ? 0.62 : 1;
    shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = k;
  }
  wallGeo.setAttribute('color', new THREE.BufferAttribute(shade, 3));
  disposables.push(wallGeo);
  const cut: CutBox[] = [];
  const walls = new THREE.InstancedMesh(wallGeo, toon(0xffffff, { vertexColors: true }), rects.length + slabs.length);
  walls.castShadow = opts.shadows;
  walls.receiveShadow = true;
  rects.forEach((r, i) => {
    cut.push({ x0: r.c0 * FINE, z0: r.r0 * FINE, x1: r.c1 * FINE, z1: r.r1 * FINE, full: WALL_H, h: WALL_H });
    walls.setColorAt(i, c3.setHex(PAL.wall));
  });
  slabs.forEach((s, k) => {
    cut.push({ x0: s.c * CELL, z0: s.r * CELL, x1: (s.c + 1) * CELL, z1: (s.r + 1) * CELL, full: SLAB_H, h: SLAB_H });
    walls.setColorAt(rects.length + k, c3.setHex(PAL.wallTop));
  });
  root.add(walls);
  const inkMat = new THREE.MeshBasicMaterial({ color: PAL.outline, side: THREE.BackSide });
  disposables.push(inkMat);
  const wallInk = new THREE.InstancedMesh(boxGeo, inkMat, cut.length);
  root.add(wallInk);

  // Furniture: one instanced box per piece. Embedded pieces (lockers, vending machines, trophy cases set into the
  // corridor's locker mass) are drawn as panels standing proud of the wall face.
  const furn = plan.furniture;
  const furnMesh = new THREE.InstancedMesh(boxGeo, toon(0xffffff), Math.max(1, furn.length));
  furnMesh.castShadow = opts.shadows;
  furnMesh.receiveShadow = true;
  const furnBoxes: CutBox[] = [];
  furn.forEach((f, i) => {
    let { x, z, w, d } = f;
    if (isEmbedded(f)) {
      const nx = Math.round(Math.sin(f.face));
      const nz = Math.round(Math.cos(f.face));
      x += nx * 0.3;
      z += nz * 0.3;
      if (nx !== 0) w = 0.12;
      else d = 0.12;
    }
    furnBoxes.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, full: f.h, h: f.h });
    let hex = FURN_COLOR[f.kind];
    if (f.tags.includes('goal')) hex = PAL.goal;
    else if (f.kind === 'locker' && f.tags.includes('hide')) hex = PAL.lockerDark;
    furnMesh.setColorAt(i, c3.setHex(hex));
  });
  if (furn.length === 0) furnMesh.count = 0;
  root.add(furnMesh);
  const furnInk = new THREE.InstancedMesh(boxGeo, inkMat, Math.max(1, furn.length));
  if (furn.length === 0) furnInk.count = 0;
  root.add(furnInk);

  const m4 = new THREE.Matrix4();
  /** Box + its ink hull (same box grown by INK on every side, drawn back faces only). */
  const writeBox = (mesh: THREE.InstancedMesh, ink: THREE.InstancedMesh, i: number, b: CutBox): void => {
    const h = Math.max(0.01, b.h);
    m4.makeScale(b.x1 - b.x0, h, b.z1 - b.z0);
    m4.setPosition((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    mesh.setMatrixAt(i, m4);
    m4.makeScale(b.x1 - b.x0 + 2 * INK, h + INK, b.z1 - b.z0 + 2 * INK);
    m4.setPosition((b.x0 + b.x1) / 2, -0.01, (b.z0 + b.z1) / 2);
    ink.setMatrixAt(i, m4);
  };
  cut.forEach((b, i) => writeBox(walls, wallInk, i, b));
  furnBoxes.forEach((b, i) => writeBox(furnMesh, furnInk, i, b));
  walls.instanceMatrix.needsUpdate = true;
  wallInk.instanceMatrix.needsUpdate = true;
  furnMesh.instanceMatrix.needsUpdate = true;
  furnInk.instanceMatrix.needsUpdate = true;
  walls.computeBoundingSphere();
  wallInk.computeBoundingSphere();
  furnMesh.computeBoundingSphere();
  furnInk.computeBoundingSphere();

  // ── markers: goals (blue beam + ring), checkpoints (mint ring), your desk (white ring) ──
  const markers = new Map<string, THREE.Object3D>();
  const ringGeo = new THREE.RingGeometry(0.75, 0.95, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const beamGeo = new THREE.CylinderGeometry(0.35, 0.35, 6, 16, 1, true);
  beamGeo.translate(0, 3, 0);
  disposables.push(ringGeo, beamGeo);
  const ringMat = (hex: number, opacity = 0.9): THREE.MeshBasicMaterial => {
    const m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
    disposables.push(m);
    return m;
  };
  for (const [id, a] of Object.entries(plan.anchors)) {
    if (!a) continue;
    const g = new THREE.Group();
    g.position.set(a.x, 0.03, a.z);
    if (id.startsWith('goal')) {
      g.add(new THREE.Mesh(ringGeo, ringMat(PAL.goal)));
      const beam = new THREE.Mesh(beamGeo, ringMat(PAL.goal, 0.22));
      beam.renderOrder = 2;
      g.add(beam);
    } else if (id.startsWith('checkpoint')) g.add(new THREE.Mesh(ringGeo, ringMat(PAL.safe, 0.7)));
    else g.add(new THREE.Mesh(ringGeo, ringMat(PAL.interact, 0.6)));
    root.add(g);
    markers.set(id, g);
  }

  let cutTimer = 0;
  return {
    root,
    stats: { wallBoxes: rects.length + slabs.length, furniture: furn.length },
    update(dt, fx, fz, mode, view) {
      cutTimer += dt;
      const target = (b: CutBox): number => {
        if (mode === 'full') return b.full;
        if (mode === 'low') return Math.min(b.full, LOW_H);
        if (mode === 'occlude') return blocksAny(b, view) ? Math.min(b.full, CUT_H) : b.full;
        const south = b.z1 > fz - 0.6 && b.z0 < fz + CUT_DEPTH;
        const across = b.x1 > fx - CUT_HALF_W && b.x0 < fx + CUT_HALF_W;
        return south && across ? Math.min(b.full, CUT_H) : b.full;
      };
      let dirty = false;
      for (let i = 0; i < cut.length; i++) {
        const b = cut[i]!;
        const t = target(b);
        if (Math.abs(b.h - t) < 0.004) continue;
        b.h = Math.abs(b.h - t) < 0.01 ? t : damp(b.h, t, 10, dt);
        writeBox(walls, wallInk, i, b);
        if (b.full === WALL_H) walls.setColorAt(i, c3.setHex(b.h < WALL_H - 0.2 ? PAL.wallCut : PAL.wall));
        dirty = true;
      }
      if (dirty) {
        walls.instanceMatrix.needsUpdate = true;
        wallInk.instanceMatrix.needsUpdate = true;
        if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
      }
      let fdirty = false;
      for (let i = 0; i < furnBoxes.length; i++) {
        const b = furnBoxes[i]!;
        if (b.full < 1.2) continue;
        const t = target(b);
        if (Math.abs(b.h - t) < 0.004) continue;
        b.h = Math.abs(b.h - t) < 0.01 ? t : damp(b.h, t, 10, dt);
        writeBox(furnMesh, furnInk, i, b);
        fdirty = true;
      }
      if (fdirty) {
        furnMesh.instanceMatrix.needsUpdate = true;
        furnInk.instanceMatrix.needsUpdate = true;
      }
      // Goal beams pulse gently.
      const pulse = 0.9 + 0.1 * Math.sin(cutTimer * 3);
      for (const [id, g] of markers) if (id.startsWith('goal')) g.scale.set(pulse, 1, pulse);
    },
    cutCount() {
      return cut.filter((b) => b.h < b.full - 0.05).length;
    },
    setGoalDone(anchor, done) {
      const g = markers.get(anchor);
      if (g) g.visible = !done;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      walls.dispose();
      wallInk.dispose();
      furnMesh.dispose();
      furnInk.dispose();
      root.removeFromParent();
    },
  };
}

/** Lockers, vending machines and trophy cases set into the corridor's locker mass (not the cafeteria counter). */
function isEmbedded(f: Furniture): boolean {
  if (f.kind === 'locker' || f.kind === 'trophyCase') return true;
  return f.kind === 'vending' && Math.min(f.w, f.d) <= 0.5 && Math.max(f.w, f.d) <= 1.8;
}

/**
 * Does box `b` (at full height) stand between the camera and any of the view points? Slab-clips the segment
 * point → camera against the box footprint grown by OCC_MARGIN; the ray height rises along the segment, so the
 * box blocks when the ray is still below the box top where it enters the footprint.
 */
export function blocksAny(b: { x0: number; z0: number; x1: number; z1: number; full: number }, v: ViewPoints): boolean {
  const x0 = b.x0 - OCC_MARGIN;
  const z0 = b.z0 - OCC_MARGIN;
  const x1 = b.x1 + OCC_MARGIN;
  const z1 = b.z1 + OCC_MARGIN;
  for (let k = 0; k < v.count; k++) {
    const px = v.points[k * 3]!;
    const py = v.points[k * 3 + 1]!;
    const pz = v.points[k * 3 + 2]!;
    // The point's own spot doesn't count (a person standing next to a wall isn't hidden by it).
    if (px > x0 && px < x1 && pz > z0 && pz < z1) continue;
    const dx = v.camX - px;
    const dz = v.camZ - pz;
    let t0 = 0;
    let t1 = 1;
    if (Math.abs(dx) < 1e-9) {
      if (px < x0 || px > x1) continue;
    } else {
      let a = (x0 - px) / dx;
      let c = (x1 - px) / dx;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (Math.abs(dz) < 1e-9) {
      if (pz < z0 || pz > z1) continue;
    } else {
      let a = (z0 - pz) / dz;
      let c = (z1 - pz) / dz;
      if (a > c) [a, c] = [c, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, c);
    }
    if (t0 > t1) continue;
    if (py + t0 * (v.camY - py) < b.full) return true;
  }
  return false;
}

/** 1-tile repeat: soft grout lines + a little terrazzo speckle, multiplied over each floor's colour. */
function tileTexture(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement('canvas');
  canvas.width = n;
  canvas.height = n;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, n, n);
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const v = 225 + Math.floor(rnd() * 25);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.floor(rnd() * n), Math.floor(rnd() * n), 2, 2);
  }
  g.fillStyle = 'rgba(70,64,56,0.28)';
  g.fillRect(0, 0, n, 2);
  g.fillRect(0, 0, 2, n);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
