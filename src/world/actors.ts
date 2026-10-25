// ─────────────────────────────────────────────────────────────────────────────
// Grey-box people + vision cones (milestone M1). Capsules for the student and
// staff (people/ replaces them in M5), a security-camera box for sweepers, and
// one floor decal per staff member drawn from sim/detect.visibilityPolygon — the
// same rays the sim tests, so what you see is what can see you.
// Reads SimState only; interpolates between the previous and current tick.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { lerp } from '../core/math';
import { PAL } from '../render/palette';
import { toon } from '../render/toon';
import type { Archetype, SchoolPlan } from '../school/types';
import { visibilityPolygon } from '../sim/detect';
import type { SimState, SuspicionLevel } from '../sim/types';
import type { ViewPoints } from './school';

const RAYS = 28;

export interface Snapshot {
  sx: number;
  sz: number;
  syaw: number;
  /** x, z, yaw, look per staff. */
  staff: Float64Array;
}

export function takeSnapshot(state: SimState, out?: Snapshot): Snapshot {
  const snap = out ?? { sx: 0, sz: 0, syaw: 0, staff: new Float64Array(state.staff.length * 4) };
  snap.sx = state.student.x;
  snap.sz = state.student.z;
  snap.syaw = state.student.yaw;
  state.staff.forEach((st, i) => {
    snap.staff[i * 4] = st.x;
    snap.staff[i * 4 + 1] = st.z;
    snap.staff[i * 4 + 2] = st.yaw;
    snap.staff[i * 4 + 3] = st.look;
  });
  return snap;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

const BODY: Record<Archetype, number> = {
  patroller: PAL.patroller,
  sentry: PAL.sentry,
  investigator: PAL.investigator,
  sweeper: PAL.sweeper,
  wanderer: PAL.wanderer,
  snitch: PAL.snitch,
  listener: PAL.listener,
};

const CONE_COLOR: Record<SuspicionLevel, number> = {
  calm: PAL.cone,
  curious: PAL.cone,
  searching: PAL.coneSearch,
  spotted: PAL.coneAlert,
};

export interface ActorsView {
  readonly root: THREE.Group;
  /** Interpolated student position (camera focus). */
  readonly focus: THREE.Vector3;
  /** World point above each staff member's head (for ?/! markers). */
  headOf(i: number, out: THREE.Vector3): THREE.Vector3;
  /** Points the occlusion pass keeps visible: the student, then staff within `radius` m of the student. */
  viewPoints(out: ViewPoints, radius: number): void;
  update(prev: Snapshot, state: SimState, alpha: number, showCones: boolean): void;
  dispose(): void;
}

export function buildActors(plan: SchoolPlan, opts: { shadows: boolean }): ActorsView {
  const root = new THREE.Group();
  root.name = 'actors';
  const disposables: { dispose(): void }[] = [];
  // Stand-in figures: a body capsule, a head, an eye band showing where they look, an ink hull on each (back faces
  // of a slightly bigger copy) and a soft blob shadow. Real characters arrive in M5.
  const bodyGeo = new THREE.CapsuleGeometry(0.28, 0.75, 4, 12);
  bodyGeo.translate(0, 0.66, 0);
  const headGeo = new THREE.SphereGeometry(0.24, 16, 12);
  headGeo.translate(0, 1.48, 0);
  const inkBody = new THREE.CapsuleGeometry(0.31, 0.75, 4, 12);
  inkBody.translate(0, 0.66, 0);
  const inkHead = new THREE.SphereGeometry(0.27, 16, 12);
  inkHead.translate(0, 1.48, 0);
  const eyes = new THREE.BoxGeometry(0.3, 0.07, 0.08);
  eyes.translate(0, 1.52, 0.2);
  const camBox = new THREE.BoxGeometry(0.34, 0.26, 0.5);
  camBox.translate(0, 0, 0.12);
  const inkCam = new THREE.BoxGeometry(0.42, 0.34, 0.58);
  inkCam.translate(0, 0, 0.12);
  const ring = new THREE.RingGeometry(0.42, 0.55, 32);
  ring.rotateX(-Math.PI / 2);
  const blob = new THREE.CircleGeometry(0.5, 20);
  blob.rotateX(-Math.PI / 2);
  disposables.push(bodyGeo, headGeo, inkBody, inkHead, eyes, camBox, inkCam, ring, blob);
  const inkMat = new THREE.MeshBasicMaterial({ color: PAL.outline, side: THREE.BackSide });
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  disposables.push(inkMat, blobMat);
  const SKIN = [0xe8b48a, 0xc68c5e, 0x8d5a3b, 0xf1c8a4, 0xa86f4c];

  const figure = (body: number, skin: number): { g: THREE.Group; body: THREE.Mesh; look: THREE.Group } => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(bodyGeo, toon(body));
    b.castShadow = opts.shadows;
    const look = new THREE.Group();
    const head = new THREE.Mesh(headGeo, toon(skin));
    head.castShadow = opts.shadows;
    look.add(head, new THREE.Mesh(inkHead, inkMat), new THREE.Mesh(eyes, toon(0x15171d)));
    const shadow = new THREE.Mesh(blob, blobMat);
    shadow.position.y = 0.02;
    shadow.renderOrder = 1;
    g.add(shadow, b, new THREE.Mesh(inkBody, inkMat), look);
    return { g, body: b, look };
  };

  // Student.
  const me = figure(PAL.student, SKIN[0]!);
  const student = me.g;
  const sBody = me.body;
  const sVisor = me.look;
  const ringMat = new THREE.MeshBasicMaterial({ color: PAL.studentRing, transparent: true, opacity: 0.85, depthWrite: false });
  disposables.push(ringMat);
  const sRing = new THREE.Mesh(ring, ringMat);
  sRing.position.y = 0.04;
  student.add(sRing);
  root.add(student);

  // Staff + cones.
  const staff: { g: THREE.Group; head: THREE.Object3D; cone: THREE.Mesh | null; coneGeo: THREE.BufferGeometry | null; coneMat: THREE.MeshBasicMaterial | null }[] = [];
  const poly = new Float32Array(2 + 2 * (RAYS + 1));
  plan.staff.forEach((sp, idx) => {
    let g: THREE.Group;
    let head: THREE.Object3D;
    if (sp.archetype === 'sweeper') {
      g = new THREE.Group();
      head = new THREE.Group();
      const cam = new THREE.Mesh(camBox, toon(PAL.sweeper));
      cam.castShadow = opts.shadows;
      head.add(cam, new THREE.Mesh(inkCam, inkMat));
      head.position.y = sp.eye;
      g.add(head);
    } else {
      const f = figure(BODY[sp.archetype], SKIN[(idx + 1) % SKIN.length]!);
      g = f.g;
      head = f.look;
    }
    let cone: THREE.Mesh | null = null;
    let coneGeo: THREE.BufferGeometry | null = null;
    let coneMat: THREE.MeshBasicMaterial | null = null;
    if (sp.coneRange > 0) {
      coneGeo = new THREE.BufferGeometry();
      const n = RAYS + 2;
      coneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const idx3: number[] = [];
      for (let k = 1; k <= RAYS; k++) idx3.push(0, k + 1, k);
      coneGeo.setIndex(idx3);
      coneMat = new THREE.MeshBasicMaterial({ color: PAL.cone, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
      cone = new THREE.Mesh(coneGeo, coneMat);
      cone.frustumCulled = false;
      cone.renderOrder = 1;
      root.add(cone);
      disposables.push(coneGeo, coneMat);
    }
    root.add(g);
    staff.push({ g, head, cone, coneGeo, coneMat });
  });

  const focus = new THREE.Vector3();
  let frame = 0;
  return {
    root,
    focus,
    headOf(i, out) {
      const s = staff[i]!;
      return out.set(s.g.position.x, (plan.staff[i]!.archetype === 'sweeper' ? plan.staff[i]!.eye : 1.9) + 0.45, s.g.position.z);
    },
    viewPoints(out, radius) {
      const max = out.points.length / 3;
      out.points[0] = focus.x;
      out.points[1] = 1.0;
      out.points[2] = focus.z;
      let n = 1;
      for (let i = 0; i < staff.length && n < max; i++) {
        const p = staff[i]!.g.position;
        const dx = p.x - focus.x;
        const dz = p.z - focus.z;
        if (dx * dx + dz * dz > radius * radius) continue;
        out.points[n * 3] = p.x;
        out.points[n * 3 + 1] = plan.staff[i]!.archetype === 'sweeper' ? plan.staff[i]!.eye : 1.3;
        out.points[n * 3 + 2] = p.z;
        n++;
      }
      out.count = n;
    },
    update(prev, state, alpha, showCones) {
      frame++;
      const st = state.student;
      const x = lerp(prev.sx, st.x, alpha);
      const z = lerp(prev.sz, st.z, alpha);
      student.position.set(x, 0, z);
      student.rotation.y = lerpAngle(prev.syaw, st.yaw, alpha);
      sBody.scale.y = st.posture === 'sneak' ? 0.72 : 1;
      sVisor.position.y = st.posture === 'sneak' ? -0.46 : 0;
      student.visible = st.escort === 0 || frame % 8 < 4;
      focus.set(x, 0, z);
      const rebuild = frame % 2 === 0;
      state.staff.forEach((s, i) => {
        const a = staff[i]!;
        const px = lerp(prev.staff[i * 4]!, s.x, alpha);
        const pz = lerp(prev.staff[i * 4 + 1]!, s.z, alpha);
        const look = lerpAngle(prev.staff[i * 4 + 3]!, s.look, alpha);
        a.g.position.set(px, 0, pz);
        if (plan.staff[i]!.archetype === 'sweeper') a.head.rotation.y = look;
        else {
          a.g.rotation.y = lerpAngle(prev.staff[i * 4 + 2]!, s.yaw, alpha);
          a.head.rotation.y = look - a.g.rotation.y;
        }
        if (!a.cone || !a.coneGeo || !a.coneMat) return;
        a.cone.visible = showCones;
        a.coneMat.color.setHex(CONE_COLOR[s.level]);
        a.coneMat.opacity = s.level === 'calm' ? 0.26 : 0.4;
        if (!showCones || !rebuild) return;
        const n = visibilityPolygon(plan.fine, { x: px, z: pz, look }, plan.staff[i]!, RAYS, poly);
        const attr = a.coneGeo.getAttribute('position') as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        for (let k = 0, v = 0; k < n; k += 2, v += 3) {
          arr[v] = poly[k]!;
          arr[v + 1] = 0.05;
          arr[v + 2] = poly[k + 1]!;
        }
        attr.needsUpdate = true;
      });
    },
    dispose() {
      for (const d of disposables) d.dispose();
      root.removeFromParent();
    },
  };
}
