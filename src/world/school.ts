// ─────────────────────────────────────────────────────────────────────────────
// Grey-box 3D school (milestone M1, docs/ARCHITECTURE.md §6/§12). Builds floors,
// walls, furniture and markers from a SchoolPlan, and runs the cut-away: walls
// between the fixed camera (looking from +Z toward −Z) and the student drop to a
// low height so the student and nearby rooms stay visible. The cut is visual
// only — the sim still treats every wall as full height.
// Final art (inked GeoBuilder models, windows, signage) replaces this in M5.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { damp } from '../core/math';
import { PAL } from '../render/palette';
import { toon } from '../render/toon';
import {
  CELL,
  CELL_CORRIDOR,
  FINE,
  F_SOLID,
  type Furniture,
  type RoomKind,
  type SchoolPlan,
} from '../school/types';

export type WallMode = 'cutaway' | 'low' | 'full';

export const WALL_H = 3.0;
const CUT_H = 0.45;
const LOW_H = 1.1;
const SLAB_H = 0.4;
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
  /** Animate the cut-away toward the focus point. */
  update(dt: number, focusX: number, focusZ: number, mode: WallMode): void;
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
  const c3 = new THREE.Color();
  const quad = (x0: number, z0: number, x1: number, z1: number, hex: number): void => {
    c3.setHex(hex).convertSRGBToLinear();
    pos.push(x0, 0, z0, x0, 0, z1, x1, 0, z1, x0, 0, z0, x1, 0, z1, x1, 0, z0);
    for (let k = 0; k < 6; k++) col.push(c3.r, c3.g, c3.b);
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
      quad(c * CELL, r * CELL, (c + 1) * CELL, (r + 1) * CELL, hex);
    }
  }
  const floorGeo = new THREE.BufferGeometry();
  floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  floorGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  floorGeo.computeVertexNormals();
  const floor = new THREE.Mesh(floorGeo, toon(0xffffff, { vertexColors: true }));
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
  const cut: CutBox[] = [];
  const walls = new THREE.InstancedMesh(boxGeo, toon(0xffffff), rects.length + slabs.length);
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

  // Furniture: one instanced box per piece. Embedded pieces (lockers, vending machines, trophy cases set into the
  // corridor's locker mass) are drawn as panels standing proud of the wall face.
  const furn = plan.furniture;
  const furnMesh = new THREE.InstancedMesh(boxGeo, toon(0xffffff), Math.max(1, furn.length));
  furnMesh.castShadow = opts.shadows;
  furnMesh.receiveShadow = true;
  const furnBoxes: CutBox[] = [];
  const furnY: number[] = [];
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
    furnY.push(0);
    let hex = FURN_COLOR[f.kind];
    if (f.tags.includes('goal')) hex = PAL.goal;
    else if (f.kind === 'locker' && f.tags.includes('hide')) hex = PAL.lockerDark;
    furnMesh.setColorAt(i, c3.setHex(hex));
  });
  if (furn.length === 0) furnMesh.count = 0;
  root.add(furnMesh);

  const m4 = new THREE.Matrix4();
  const writeBox = (mesh: THREE.InstancedMesh, i: number, b: CutBox): void => {
    m4.makeScale(b.x1 - b.x0, Math.max(0.01, b.h), b.z1 - b.z0);
    m4.setPosition((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    mesh.setMatrixAt(i, m4);
  };
  cut.forEach((b, i) => writeBox(walls, i, b));
  furnBoxes.forEach((b, i) => writeBox(furnMesh, i, b));
  walls.instanceMatrix.needsUpdate = true;
  furnMesh.instanceMatrix.needsUpdate = true;

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
    update(dt, fx, fz, mode) {
      cutTimer += dt;
      const target = (b: CutBox, tall: number): number => {
        if (mode === 'full') return b.full;
        if (mode === 'low') return Math.min(b.full, LOW_H);
        const south = b.z1 > fz - 0.6 && b.z0 < fz + CUT_DEPTH;
        const across = b.x1 > fx - CUT_HALF_W && b.x0 < fx + CUT_HALF_W;
        return south && across ? Math.min(b.full, CUT_H) : tall;
      };
      let dirty = false;
      for (let i = 0; i < cut.length; i++) {
        const b = cut[i]!;
        const t = target(b, b.full);
        if (Math.abs(b.h - t) < 0.004) continue;
        b.h = Math.abs(b.h - t) < 0.01 ? t : damp(b.h, t, 9, dt);
        writeBox(walls, i, b);
        if (b.full === WALL_H) walls.setColorAt(i, c3.setHex(b.h < WALL_H - 0.2 ? PAL.wallCut : PAL.wall));
        dirty = true;
      }
      if (dirty) {
        walls.instanceMatrix.needsUpdate = true;
        if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
      }
      let fdirty = false;
      for (let i = 0; i < furnBoxes.length; i++) {
        const b = furnBoxes[i]!;
        if (b.full < 1.2) continue;
        const t = target(b, b.full);
        if (Math.abs(b.h - t) < 0.004) continue;
        b.h = Math.abs(b.h - t) < 0.01 ? t : damp(b.h, t, 9, dt);
        writeBox(furnMesh, i, b);
        fdirty = true;
      }
      if (fdirty) furnMesh.instanceMatrix.needsUpdate = true;
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
      furnMesh.dispose();
      root.removeFromParent();
    },
  };
}

/** Lockers, vending machines and trophy cases set into the corridor's locker mass (not the cafeteria counter). */
function isEmbedded(f: Furniture): boolean {
  if (f.kind === 'locker' || f.kind === 'trophyCase') return true;
  return f.kind === 'vending' && Math.min(f.w, f.d) <= 0.5 && Math.max(f.w, f.d) <= 1.8;
}
