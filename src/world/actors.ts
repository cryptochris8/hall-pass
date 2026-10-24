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
  update(prev: Snapshot, state: SimState, alpha: number, showCones: boolean): void;
  dispose(): void;
}

export function buildActors(plan: SchoolPlan, opts: { shadows: boolean }): ActorsView {
  const root = new THREE.Group();
  root.name = 'actors';
  const disposables: { dispose(): void }[] = [];
  const capsule = new THREE.CapsuleGeometry(0.3, 1.0, 4, 10);
  capsule.translate(0, 0.8, 0);
  const visor = new THREE.BoxGeometry(0.32, 0.12, 0.22);
  visor.translate(0, 1.45, 0.2);
  const camBox = new THREE.BoxGeometry(0.34, 0.26, 0.5);
  camBox.translate(0, 0, 0.12);
  const ring = new THREE.RingGeometry(0.42, 0.55, 32);
  ring.rotateX(-Math.PI / 2);
  disposables.push(capsule, visor, camBox, ring);

  // Student.
  const student = new THREE.Group();
  const sBody = new THREE.Mesh(capsule, toon(PAL.student));
  sBody.castShadow = opts.shadows;
  const sVisor = new THREE.Mesh(visor, toon(PAL.studentRing));
  const ringMat = new THREE.MeshBasicMaterial({ color: PAL.studentRing, transparent: true, opacity: 0.85, depthWrite: false });
  disposables.push(ringMat);
  const sRing = new THREE.Mesh(ring, ringMat);
  sRing.position.y = 0.04;
  student.add(sBody, sVisor, sRing);
  root.add(student);

  // Staff + cones.
  const staff: { g: THREE.Group; head: THREE.Object3D; cone: THREE.Mesh | null; coneGeo: THREE.BufferGeometry | null; coneMat: THREE.MeshBasicMaterial | null }[] = [];
  const poly = new Float32Array(2 + 2 * (RAYS + 1));
  plan.staff.forEach((sp) => {
    const g = new THREE.Group();
    let head: THREE.Object3D;
    if (sp.archetype === 'sweeper') {
      head = new THREE.Mesh(camBox, toon(PAL.sweeper));
      head.position.y = sp.eye;
      head.castShadow = opts.shadows;
      g.add(head);
    } else {
      const body = new THREE.Mesh(capsule, toon(BODY[sp.archetype]));
      body.castShadow = opts.shadows;
      head = new THREE.Group();
      head.add(new THREE.Mesh(visor, toon(0x111318)));
      g.add(body, head);
    }
    let cone: THREE.Mesh | null = null;
    let coneGeo: THREE.BufferGeometry | null = null;
    let coneMat: THREE.MeshBasicMaterial | null = null;
    if (sp.coneRange > 0) {
      coneGeo = new THREE.BufferGeometry();
      const n = RAYS + 2;
      coneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const idx: number[] = [];
      for (let k = 1; k <= RAYS; k++) idx.push(0, k + 1, k);
      coneGeo.setIndex(idx);
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
    update(prev, state, alpha, showCones) {
      frame++;
      const st = state.student;
      const x = lerp(prev.sx, st.x, alpha);
      const z = lerp(prev.sz, st.z, alpha);
      student.position.set(x, 0, z);
      student.rotation.y = lerpAngle(prev.syaw, st.yaw, alpha);
      sBody.scale.y = st.posture === 'sneak' ? 0.72 : 1;
      sVisor.position.y = st.posture === 'sneak' ? -0.42 : 0;
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
