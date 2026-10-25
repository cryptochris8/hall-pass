// Props dev page: every furniture kind (plain / goal / hide) in a row north of a generated school, plus the school
// itself with furniture models instanced at every plan item and the full dressing.
//   ?view=row (default) · ?view=school · ?view=room (zoom on the start classroom) · ?view=hall
//   ?seed=7&tier=2&mission=phone · ?walls=full|low (low: hides wall items taller than the lowered walls)
// The instancing code below is the reference for the integrator (src/world/school.ts).
import * as THREE from 'three';
import { createHarness } from './harness';
import { modelMaterial } from '../src/render/models/materials';
import { generateSchool } from '../src/school/gen';
import { CELL, FINE, F_SOLID, type FurnitureKind, type MissionId, type SchoolPlan, type TierId } from '../src/school/types';
import { buildSchoolView, type WallMode } from '../src/world/school';
import { buildDressing, furnitureFootprint, furnitureGeometry, furnitureMatrix, isEmbeddedFurniture, variantOf, type PropVariant } from '../src/world/props';

const h = createHarness({ camera: { pos: [10, 7, 12], look: [10, 0.8, -8] }, lights: true });
const p = h.params;
const seed = Number(p.get('seed') ?? 7);
const tier = Number(p.get('tier') ?? 2) as TierId;
const mission = (p.get('mission') ?? 'phone') as MissionId;
const view = p.get('view') ?? 'row';
const walls = (p.get('walls') ?? 'full') as WallMode;

// ── furniture lineup (z = −8, north of the school) ──
const ROW: [FurnitureKind, number, number, number][] = [
  ['desk', 0.8, 0.6, 0.75],
  ['teacherDesk', 1.6, 0.8, 0.8],
  ['locker', 0.48, 0.5, 1.9],
  ['stall', 1.2, 1.4, 2.0],
  ['shelf', 2.2, 0.5, 2.1],
  ['table', 1.4, 0.9, 0.75],
  ['table', 2.6, 0.9, 0.75],
  ['bleachers', 3.0, 2.2, 1.6],
  ['vending', 1.8, 0.5, 1.9],
  ['vending', 4.0, 0.8, 1.9],
  ['officeDesk', 2.0, 0.9, 0.8],
  ['trophyCase', 1.8, 0.5, 1.7],
  ['bench', 1.6, 1.0, 0.5],
  ['planter', 1.6, 1.0, 0.7],
];
const row = new THREE.Group();
let x = 0;
for (const [kind, w, d, hh] of ROW) {
  const variants: PropVariant[] = kind === 'locker' ? ['plain', 'hide', 'goal', 'plain'] : ['plain', 'goal'];
  variants.forEach((v, i) => {
    const m = new THREE.Mesh(furnitureGeometry(kind, w, d, hh, v), modelMaterial());
    m.position.set(x + w / 2, 0, -8 + (kind === 'locker' ? 0 : i * -2.6));
    if (kind === 'locker') m.position.x = x + 0.25 + i * 0.5;
    m.castShadow = true;
    row.add(m);
  });
  x += (kind === 'locker' ? 2.0 : w) + 0.7;
}
const pad = new THREE.Mesh(new THREE.PlaneGeometry(x + 2, 9), new THREE.MeshToonMaterial({ color: 0xd9d3c6 }));
pad.rotation.x = -Math.PI / 2;
pad.position.set(x / 2, 0.001, -9.5);
pad.receiveShadow = true;
row.add(pad);
h.scene.add(row);

// ── school ──
const plan: SchoolPlan = generateSchool({ seed, tier, mission });
// The grey-box world draws EVERY solid fine cell as a 3 m wall, including solid furniture stamped into rooms
// (library shelves, stalls, bleachers, the serving counter), which would bury their models. Until the integrator
// changes src/world/school.ts, render the walls from a copy of the fine grid with those footprints cleared.
const viewFlags = plan.fine.flags.slice();
for (const f of plan.furniture) {
  if (isEmbeddedFurniture(f) || !['stall', 'shelf', 'bleachers', 'vending', 'trophyCase', 'locker'].includes(f.kind)) continue;
  const c0 = Math.floor((f.x - f.w / 2) / FINE + 1e-6);
  const r0 = Math.floor((f.z - f.d / 2) / FINE + 1e-6);
  const c1 = Math.ceil((f.x + f.w / 2) / FINE - 1e-6);
  const r1 = Math.ceil((f.z + f.d / 2) / FINE - 1e-6);
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) viewFlags[r * plan.fine.cols + c]! &= ~F_SOLID;
}
const school = buildSchoolView({ ...plan, fine: { ...plan.fine, flags: viewFlags } }, { shadows: false });
// This page draws furniture + dressing itself (the reference path below), so hide whatever furniture models /
// dressing the school view already adds (it may or may not, depending on the integrator's progress).
for (const o of school.root.children) {
  const im = o as THREE.InstancedMesh;
  if (o.name === 'dressing' || (im.isInstancedMesh && im.material === modelMaterial())) o.visible = false;
}
const inst = school.root.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh && (o as THREE.InstancedMesh).material !== modelMaterial());
if (inst.length >= 4) for (const m of inst.slice(2, 4)) m.visible = false; // grey-box furniture boxes + ink (old school.ts)
h.scene.add(school.root);

// Furniture: one InstancedMesh per (kind, local size, variant).
const groups = new Map<string, { geo: THREE.BufferGeometry; items: SchoolPlan['furniture'] }>();
for (const f of plan.furniture) {
  const { localW, localD } = furnitureFootprint(f);
  const v = variantOf(f);
  const key = `${f.kind}|${localW}|${localD}|${f.h}|${v}`;
  let g = groups.get(key);
  if (!g) groups.set(key, (g = { geo: furnitureGeometry(f.kind, localW, localD, f.h, v), items: [] }));
  g.items.push(f);
}
const m4 = new THREE.Matrix4();
let furnTris = 0;
for (const g of groups.values()) {
  const im = new THREE.InstancedMesh(g.geo, modelMaterial(), g.items.length);
  g.items.forEach((f, i) => im.setMatrixAt(i, furnitureMatrix(f, m4)));
  im.instanceMatrix.needsUpdate = true;
  im.computeBoundingSphere();
  h.scene.add(im);
  furnTris += (g.geo.getAttribute('position').count / 3) * g.items.length;
}

const dressing = buildDressing(plan);
h.scene.add(dressing.root);
const LOW_H = 1.1;
if (walls === 'low') for (const w of dressing.wallItems) w.object.visible = w.top <= LOW_H;
if (p.get('hide') === 'all') for (const w of dressing.wallItems) w.object.visible = false; // ?hide=all: wall items off

// Framing.
const W = plan.grid.cols * CELL;
const D = plan.grid.rows * CELL;
const start = plan.anchors.start!;
if (!p.get('cam')) {
  if (view === 'school') h.frame([W / 2, Math.max(W, D) * 0.95, D * 1.05 + 10], [W / 2, 0, D / 2 - 2], 40);
  else if (view === 'room') {
    // ?kind=gym|cafeteria|library|bathroom|office|principal|art|band|lab|courtyard frames the first room of that kind
    const kind = p.get('kind');
    const room = kind ? plan.rooms.find((r) => r.kind === kind) : undefined;
    const rx = room ? ((room.rect.c0 + room.rect.c1) / 2) * CELL : start.x;
    const rz = room ? ((room.rect.r0 + room.rect.r1) / 2) * CELL : start.z;
    const size = room ? Math.max(room.rect.c1 - room.rect.c0, room.rect.r1 - room.rect.r0) * CELL : 8;
    h.frame([rx, 6 + size * 0.9, rz + 4 + size * 0.75], [rx, 0.5, rz - 0.5], 45);
  }
  else if (view === 'hall') h.frame([start.x + 4, 16, start.z + 18], [start.x + 4, 0.5, start.z + 3], 45);
}
const pts = new Float32Array([start.x, 1, start.z]);
window.__DEV__ = { ...(window.__DEV__ ?? {}), rooms: plan.rooms.map((r) => r.kind).join(',') };
h.onUpdate((dt) => {
  // the harness's first dt can be negative (rAF timestamp < performance.now() at start), which school.update's
  // exponential damping blows up — clamp it here
  school.update(Math.max(0, dt), start.x, start.z, walls, { camX: h.camera.position.x, camY: h.camera.position.y, camZ: h.camera.position.z, points: pts, count: 1 });
});
h.setInfo(
  `${plan.name} · seed ${seed} tier ${tier} · furniture ${plan.furniture.length} in ${groups.size} meshes, ${(furnTris / 1000).toFixed(1)}k tris · dressing ${dressing.stats.meshes} meshes, ${(dressing.stats.triangles / 1000).toFixed(1)}k tris, ${dressing.wallItems.length} wall groups`,
);
window.__DEV__ = { ...(window.__DEV__ ?? {}), plan: plan.name, dressing: dressing.stats, wallItems: dressing.wallItems.length, root: dressing.root };
h.start();
