// ─────────────────────────────────────────────────────────────────────────────
// People + vision cones in the world (integration). The student, staff and
// security cameras, driven from SimState every frame: position and facing
// (interpolated between ticks), locomotion speed and gait, head look, one-shot
// actions and faces on sim events. Characters come from src/people; cameras are a
// box on a bracket. Each staff member with sight gets a floor decal drawn from
// sim/detect.visibilityPolygon — the same rays the sim tests.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { lerp } from '../core/math';
import { createPerson, type Person, type PersonRole } from '../people';
import { PAL } from '../render/palette';
import { toon } from '../render/toon';
import type { SchoolPlan } from '../school/types';
import { visibilityPolygon } from '../sim/detect';
import type { SimEvent, SimState, SuspicionLevel } from '../sim/types';
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

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function lerpAngle(a: number, b: number, t: number): number {
  return a + wrap(b - a) * t;
}

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
  /** React to sim events (actions and faces). */
  onEvents(events: readonly SimEvent[], state: SimState): void;
  update(prev: Snapshot, state: SimState, alpha: number, showCones: boolean, dt: number): void;
  dispose(): void;
}

interface StaffView {
  g: THREE.Group;
  person: Person | null;
  /** Security-camera head (sweepers). */
  cam: THREE.Object3D | null;
  cone: THREE.Mesh | null;
  coneGeo: THREE.BufferGeometry | null;
  coneMat: THREE.MeshBasicMaterial | null;
  lastX: number;
  lastZ: number;
  wasMoving: boolean;
  level: SuspicionLevel;
}

export function buildActors(plan: SchoolPlan, opts: { shadows: boolean }): ActorsView {
  const root = new THREE.Group();
  root.name = 'actors';
  const disposables: { dispose(): void }[] = [];
  const castAll = (o: THREE.Object3D): void => {
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) m.castShadow = opts.shadows;
    });
  };

  const ring = new THREE.RingGeometry(0.42, 0.55, 32);
  ring.rotateX(-Math.PI / 2);
  const blob = new THREE.CircleGeometry(0.5, 20);
  blob.rotateX(-Math.PI / 2);
  const camBox = new THREE.BoxGeometry(0.34, 0.26, 0.5);
  camBox.translate(0, 0, 0.12);
  const inkCam = new THREE.BoxGeometry(0.42, 0.34, 0.58);
  inkCam.translate(0, 0, 0.12);
  const bracket = new THREE.BoxGeometry(0.08, 0.3, 0.08);
  bracket.translate(0, 0.15, -0.05);
  disposables.push(ring, blob, camBox, inkCam, bracket);
  const inkMat = new THREE.MeshBasicMaterial({ color: PAL.outline, side: THREE.BackSide });
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false });
  const ringMat = new THREE.MeshBasicMaterial({ color: PAL.studentRing, transparent: true, opacity: 0.85, depthWrite: false });
  disposables.push(inkMat, blobMat, ringMat);
  const shadowBlob = (g: THREE.Group, r = 1): void => {
    const s = new THREE.Mesh(blob, blobMat);
    s.position.y = 0.02;
    s.scale.setScalar(r);
    s.renderOrder = 1;
    g.add(s);
  };

  // Student.
  const student = new THREE.Group();
  const me = createPerson({ role: 'student', seed: plan.seed ^ 0x51ed });
  castAll(me.root);
  shadowBlob(student);
  const sRing = new THREE.Mesh(ring, ringMat);
  sRing.position.y = 0.04;
  student.add(me.root, sRing);
  root.add(student);
  let sLastX = NaN;
  let sLastZ = NaN;

  // Staff + cones.
  const staff: StaffView[] = [];
  const poly = new Float32Array(2 + 2 * (RAYS + 1));
  plan.staff.forEach((sp, idx) => {
    const g = new THREE.Group();
    let person: Person | null = null;
    let cam: THREE.Object3D | null = null;
    if (sp.archetype === 'sweeper') {
      cam = new THREE.Group();
      cam.add(new THREE.Mesh(camBox, toon(PAL.sweeper)), new THREE.Mesh(inkCam, inkMat), new THREE.Mesh(bracket, toon(PAL.metal)));
      cam.position.y = sp.eye;
      castAll(cam);
      g.add(cam);
    } else {
      person = createPerson({ role: sp.archetype as PersonRole, seed: (plan.seed * 31 + idx * 977) >>> 0 });
      castAll(person.root);
      shadowBlob(g, sp.archetype === 'wanderer' ? 1.5 : 1);
      g.add(person.root);
    }
    let cone: THREE.Mesh | null = null;
    let coneGeo: THREE.BufferGeometry | null = null;
    let coneMat: THREE.MeshBasicMaterial | null = null;
    if (sp.coneRange > 0) {
      coneGeo = new THREE.BufferGeometry();
      const n = RAYS + 2;
      coneGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const index: number[] = [];
      for (let k = 1; k <= RAYS; k++) index.push(0, k + 1, k);
      coneGeo.setIndex(index);
      coneMat = new THREE.MeshBasicMaterial({ color: PAL.cone, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
      cone = new THREE.Mesh(coneGeo, coneMat);
      cone.frustumCulled = false;
      cone.renderOrder = 1;
      root.add(cone);
      disposables.push(coneGeo, coneMat);
    }
    root.add(g);
    staff.push({ g, person, cam, cone, coneGeo, coneMat, lastX: NaN, lastZ: NaN, wasMoving: false, level: 'calm' });
  });

  const focus = new THREE.Vector3();
  let frame = 0;
  return {
    root,
    focus,
    headOf(i, out) {
      const s = staff[i]!;
      const top = s.person ? s.person.height : plan.staff[i]!.eye;
      return out.set(s.g.position.x, top + 0.45, s.g.position.z);
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
    onEvents(events, state) {
      for (const e of events) {
        switch (e.t) {
          case 'pickup':
            me.play('grab');
            me.setExpression('smug', 1.5);
            break;
          case 'caught': {
            const s = staff[e.staff];
            if (s?.person) {
              s.person.play(plan.staff[e.staff]!.archetype === 'patroller' ? 'whistle' : 'point');
              s.person.setExpression(e.passUsed ? 'neutral' : 'stern', 2);
            }
            if (!e.passUsed) {
              me.play('busted');
              me.setExpression('panicked', 2);
            } else me.setExpression('relieved', 1.5);
            break;
          }
          case 'suspicion': {
            const s = staff[e.staff];
            if (!s?.person) break;
            if (e.level === 'curious' && s.level === 'calm') s.person.setExpression('suspicious', 2);
            if (e.level === 'searching') s.person.play('lookAround');
            s.level = e.level;
            break;
          }
          case 'chase': {
            const p = staff[e.staff]?.person;
            if (p && e.on) {
              p.play(plan.staff[e.staff]!.archetype === 'patroller' ? 'whistle' : 'point');
              p.setExpression('stern', 3);
            } else if (p && e.escaped) {
              p.play('shrug');
              p.setExpression('neutral');
            }
            break;
          }
          case 'heard': {
            const p = staff[e.staff]?.person;
            if (p) {
              p.setExpression('suspicious', 2.5);
              p.play('lookAround');
            }
            break;
          }
          case 'hide':
            if (e.enter) me.setExpression('nervous', 1.5);
            break;
          case 'throw':
            me.play('wave');
            break;
          case 'closeCall':
            me.play('flinch');
            me.setExpression('nervous', 1.2);
            break;
          case 'end':
            if (e.phase === 'success') {
              me.play('celebrate');
              me.setExpression('happy');
            } else me.setExpression('nervous');
            break;
        }
      }
      void state;
    },
    update(prev, state, alpha, showCones, dt) {
      frame++;
      const st = state.student;
      const x = lerp(prev.sx, st.x, alpha);
      const z = lerp(prev.sz, st.z, alpha);
      student.position.set(x, 0, z);
      student.rotation.y = lerpAngle(prev.syaw, st.yaw, alpha);
      if (dt > 0) {
        const sp = Number.isNaN(sLastX) ? 0 : Math.hypot(x - sLastX, z - sLastZ) / dt;
        me.setMotion(Math.min(sp, 8), st.posture);
      }
      sLastX = x;
      sLastZ = z;
      me.update(dt);
      student.visible = st.hidden < 0 && (st.escort === 0 || frame % 8 < 4);
      focus.set(x, 0, z);
      const rebuild = frame % 2 === 0;
      state.staff.forEach((s, i) => {
        const a = staff[i]!;
        const px = lerp(prev.staff[i * 4]!, s.x, alpha);
        const pz = lerp(prev.staff[i * 4 + 1]!, s.z, alpha);
        const yaw = lerpAngle(prev.staff[i * 4 + 2]!, s.yaw, alpha);
        const look = lerpAngle(prev.staff[i * 4 + 3]!, s.look, alpha);
        a.g.position.set(px, 0, pz);
        if (a.cam) a.cam.rotation.y = look;
        if (a.person) {
          a.g.rotation.y = yaw;
          a.person.setLook(wrap(look - yaw));
          if (dt > 0) {
            const spd = Number.isNaN(a.lastX) ? 0 : Math.hypot(px - a.lastX, pz - a.lastZ) / dt;
            a.person.setMotion(Math.min(spd, 6), s.mode === 'chase' || s.mode === 'report' ? 'sprint' : 'walk');
            // Patrollers check their watch when they stop at the end of a beat.
            if (a.wasMoving && !s.moving && plan.staff[i]!.archetype === 'patroller' && s.level === 'calm') a.person.play('checkWatch');
          }
          a.wasMoving = s.moving;
          a.lastX = px;
          a.lastZ = pz;
          a.person.update(dt);
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
      me.dispose();
      for (const s of staff) s.person?.dispose();
      for (const d of disposables) d.dispose();
      root.removeFromParent();
    },
  };
}
