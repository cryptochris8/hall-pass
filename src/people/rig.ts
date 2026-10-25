// ─────────────────────────────────────────────────────────────────────────────
// PersonRig — implements the Person contract (src/people/types.ts). Ported from
// Bad Hair Day's HumanRig: ONE skinned, inked, vertex-coloured mesh (body +
// clothes + face + hair, one draw call) driven by a bone skeleton; poses come
// from anim.ts and are cross-faded here. Hand props (mug / clipboard / phone)
// ride hand sockets that stay upright in the body frame; the custodian's cart is
// a separate cached mesh in front of her.
//
//   root (world-owned transform: position + yaw)
//    ├─ shadow (blob), cart (wanderer)
//    └─ figure (per-person height scale)
//        └─ body (SkinnedMesh) ─ base ─ hips ─┬─ spine ─ chest ─┬─ head ─ face bones, hair chains
//                                             │                 ├─ upperArm ─ foreArm ─ hand ─ finger / prop
//                                             └─ thigh ─ shin ─ foot
// update() is allocation-free.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { Rng, hashInts } from '../core/rng';
import { PAL } from '../render/palette';
import { cachedGeo } from '../render/models/common';
import { modelMaterial } from '../render/models/materials';
import { markShared } from '../render/models/shared';
import {
  ACTION_DURATION,
  C,
  GESTURE_DURATION,
  actionBlocksLook,
  actionFace,
  actionPose,
  gestureFace,
  gesturePose,
  gestureShowsPhone,
  gesturesFor,
  newDrive,
  phaseAdvance,
  standPose,
  stepLength,
  whistleInHand,
  type ActCtx,
  type Drive,
  type Gesture,
  type Hold,
} from './anim';
import { faceFor, isExpression, type Face } from './expressions';
import { legExtension, solveTwoBone } from './ik';
import { deriveLook, deriveTraits, lookKey, type Traits } from './looks';
import { buildPersonGeometry } from './outfits';
import { Pose, blendPose, clamp01, copyPose, smooth01 } from './pose';
import { CART, cartGeometry, clipboardGeometry, mugGeometry, phoneGeometry } from './props';
import { B, EYE_SCALE, F, MOUTHS, buildBones, faceBone, type Rig } from './skeleton';
import { acquireGeo, releaseGeo } from './skin';
import { SPECS, type BodySpec } from './spec';
import { hairTraits } from './hair';
import type { Gait, Person, PersonAction, PersonExpression, PersonLook, PersonRole, PersonSpec } from './types';

const HIDE = 1e-4;
const LOOK_MAX = 1.3;
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qIK = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

function holdFor(role: PersonRole): Hold {
  return role === 'investigator' ? 'mug' : role === 'snitch' ? 'clipboard' : role === 'wanderer' ? 'cart' : 'none';
}

export class PersonRig implements Person {
  readonly role: PersonRole;
  readonly look: PersonLook;
  readonly root: THREE.Group;
  readonly height: number;
  readonly spec: BodySpec;
  readonly traits: Traits;
  /** The skinned body mesh (diagnostics / tests). */
  readonly body: THREE.SkinnedMesh;
  /** The cart mesh (wanderer only). */
  readonly cart: THREE.Mesh | null = null;

  private readonly rig: Rig;
  private readonly bones: THREE.Bone[];
  private readonly figure: THREE.Group;
  private readonly geo: THREE.BufferGeometry;
  private readonly handSock: [THREE.Object3D, THREE.Object3D];
  private readonly headSock: THREE.Object3D;
  private readonly phone: THREE.Mesh | null = null;
  private readonly shadow: THREE.Mesh;
  private readonly rng: Rng;
  private readonly scale: number;
  private readonly restHipsY: number;
  private readonly restArm: [THREE.Vector3, THREE.Vector3];
  private readonly restFace: THREE.Vector3[] = [];
  private readonly restQ: THREE.Quaternion[] = [];
  private readonly hairSim: 'none' | 'bounce' | 'long' | 'ponytail';
  private readonly gestures: Gesture[] = [];
  private readonly idleGlances: boolean;
  private disposed = false;

  // animation state
  private readonly drive: Drive;
  private speedTarget = 0;
  private gaitTarget: Gait = 'walk';
  private time = 0;
  private shiftT = 2;
  private shiftTarget = 0;
  private readonly base = new Pose();
  private readonly gest = new Pose();
  private readonly act = new Pose();
  private readonly out = new Pose();
  private readonly snap = new Pose();
  private fadeT = 1;
  private fadeDur = 0;
  private curAction: PersonAction | null = null;
  private actT = 0;
  private actDur = 1;
  private gesture: Gesture | null = null;
  private gestT = 0;
  private gestIn = 3;
  private readonly ctx: ActCtx;

  // face state
  private baseExpr: PersonExpression = 'neutral';
  private timedExpr: PersonExpression | null = null;
  private timedLeft = 0;
  private face: Face = 'neutral';
  private faceT = 10;
  private readonly fs = { lid: 0, lidR: 0, lidTilt: 0, lowLid: 0.08, browY: 0, browTilt: 0, browAsym: 0, pupil: 1, pupilY: 0, mouthScale: 1, blush: 0.5, headX: 0, headZ: 0, dart: 0 };
  private blinkIn = 2;
  private blinkT = -1;
  private lookTarget = 0;
  private lookYaw = 0;
  private idleLookT = 2;
  private idleYaw = 0;

  // own-hair dynamics
  private readonly headPrev = new THREE.Vector3();
  private readonly headVel = new THREE.Vector3();
  private hasHeadPrev = false;
  private readonly sway = { x: 0, vx: 0, z: 0, vz: 0, bob: 0, vbob: 0 };

  constructor(spec: PersonSpec) {
    this.role = spec.role;
    this.look = deriveLook(spec);
    this.traits = deriveTraits(spec, this.look);
    const s = SPECS[this.traits.body];
    this.spec = s;
    this.scale = this.traits.scale;
    this.height = s.height * this.scale;
    this.rng = new Rng(hashInts(spec.seed | 0, 0x7e09, this.role.length * 131 + this.role.charCodeAt(0)));
    this.blinkIn = 0.6 + this.rng.next() * 2.5;
    this.gestIn = 2 + this.rng.next() * 4;
    this.shiftT = 0.5 + this.rng.next() * 2.5;
    this.hairSim = hairTraits(this.look.hairStyle).sim;
    this.idleGlances = this.role === 'student' || this.role === 'extra';
    gesturesFor(this.role, this.look.glasses, this.look.backpack !== null, this.gestures);
    const hold = holdFor(this.role);
    this.drive = newDrive(s, this.role, hold);
    this.drive.gripX = CART.gripX / this.scale;
    this.drive.gripY = CART.handleY / this.scale;
    this.drive.gripZ = CART.handleZ / this.scale;
    this.ctx = { spec: s, at: 0, t: 0 };

    this.rig = buildBones(s, this.traits.beard === 'beard');
    this.bones = this.rig.bones;
    this.restHipsY = s.hipsY;
    this.restArm = [this.bones[B.upperArmL]!.position.clone(), this.bones[B.upperArmR]!.position.clone()];
    for (let i = 0; i < B.count; i++) {
      this.restFace.push(this.bones[i]!.position.clone());
      this.restQ.push(this.bones[i]!.quaternion.clone());
    }

    this.root = new THREE.Group();
    this.root.name = 'person:' + this.role;
    this.figure = new THREE.Group();
    this.figure.name = 'figure';
    this.figure.scale.setScalar(this.scale);
    this.root.add(this.figure);
    const look = this.look;
    const traits = this.traits;
    const rig = this.rig;
    const role = this.role;
    this.geo = acquireGeo(lookKey(role, look, traits), () => buildPersonGeometry(role, s, look, traits, rig));
    this.body = new THREE.SkinnedMesh(this.geo, modelMaterial());
    this.body.name = 'body';
    this.body.castShadow = true;
    this.body.add(this.bones[B.base]!);
    this.figure.add(this.body);
    this.root.updateMatrixWorld(true);
    this.body.bind(new THREE.Skeleton(this.bones));
    // Generous fixed bounds (poses never leave them; no per-frame skinned bounds).
    this.body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, s.height * 0.5, 0), s.height * 0.85 + 0.25);
    this.body.boundingBox = new THREE.Box3(new THREE.Vector3(-s.height * 0.75, -0.05, -s.height * 0.75), new THREE.Vector3(s.height * 0.75, s.height * 1.35, s.height * 0.75));

    const mk = (name: string, parent: THREE.Object3D, x: number, y: number, z: number) => {
      const ob = new THREE.Object3D();
      ob.name = 'socket:' + name;
      ob.position.set(x, y, z);
      parent.add(ob);
      return ob;
    };
    this.headSock = mk('head', this.bones[B.head]!, 0, s.headCY, s.headCZ);
    this.handSock = [mk('handL', this.bones[B.handL]!, 0, -s.handR * 0.82, 0), mk('handR', this.bones[B.handR]!, 0, -s.handR * 0.82, 0)];
    const prop = (geo: THREE.BufferGeometry, parent: THREE.Object3D, name: string): THREE.Mesh => {
      const m = new THREE.Mesh(geo, modelMaterial());
      m.name = name;
      m.castShadow = true;
      parent.add(m);
      return m;
    };
    if (hold === 'mug') prop(mugGeometry(), this.handSock[1], 'prop:mug');
    if (hold === 'clipboard') prop(clipboardGeometry(), this.handSock[0], 'prop:clipboard');
    if (role === 'student' || role === 'extra') {
      this.phone = prop(phoneGeometry(), this.handSock[0], 'prop:phone');
      this.phone.visible = false;
      this.phone.castShadow = false;
    }
    if (hold === 'cart') {
      this.cart = prop(cartGeometry(), this.root, 'prop:cart');
      this.cart.receiveShadow = true;
    }

    this.shadow = new THREE.Mesh(shadowGeo(), shadowMaterial());
    this.shadow.name = 'shadow';
    this.shadow.renderOrder = -1;
    const sr = (Math.max(s.torsoW, s.hipW) * 1.9 + 0.08) * this.scale;
    this.shadow.scale.set(sr, 1, sr * 0.85);
    this.shadow.position.y = 0.012;
    this.root.add(this.shadow);

    this.update(0);
  }

  // ── contract ───────────────────────────────────────────────────────────────

  /** Current action (diagnostics / tests). */
  get action(): PersonAction | null {
    return this.curAction;
  }

  /** Current resolved face (diagnostics / tests). */
  get expression(): Face {
    return this.face;
  }

  /** Smoothed sneak crouch 0..1 (diagnostics / tests). */
  get crouch(): number {
    return this.drive.crouch;
  }

  setMotion(speed: number, gait: Gait): void {
    this.speedTarget = Number.isFinite(speed) ? Math.max(0, Math.min(12, speed)) : 0;
    this.gaitTarget = gait === 'sneak' || gait === 'sprint' ? gait : 'walk';
  }

  setLook(yaw: number): void {
    this.lookTarget = Number.isFinite(yaw) ? Math.max(-LOOK_MAX, Math.min(LOOK_MAX, yaw)) : 0;
  }

  play(action: PersonAction): number {
    const dur = ACTION_DURATION[action];
    if (dur === undefined) return 0;
    this.startFade(this.curAction ? 0.1 : 0.12);
    this.curAction = action;
    this.actT = 0;
    this.actDur = dur;
    this.gesture = null;
    return dur;
  }

  setExpression(e: PersonExpression, seconds?: number): void {
    if (!isExpression(e)) return;
    if (seconds === undefined || !Number.isFinite(seconds)) {
      this.baseExpr = e;
      this.timedExpr = null;
      this.timedLeft = 0;
    } else {
      this.timedExpr = e;
      this.timedLeft = Math.max(0, seconds);
    }
  }

  update(dtIn: number): void {
    if (this.disposed) return;
    const dt = Math.min(0.1, Math.max(0, Number.isFinite(dtIn) ? dtIn : 0));
    this.time += dt;
    const d = this.drive;
    const s = this.spec;
    d.t = this.time;

    // Motion: smoothed speed + gait blends; stride advances with (model-space) distance → no foot skating.
    const k = this.time < 1e-6 ? 1 : 1 - Math.exp(-9 * dt);
    d.speed += (this.speedTarget - d.speed) * k;
    if (d.speed < 1e-3 && this.speedTarget === 0) d.speed = 0;
    const kg = this.time < 1e-6 ? 1 : 1 - Math.exp(-7 * dt);
    const runT = this.gaitTarget === 'sprint' ? smooth01((d.speed - 1.6) / 2.2) : 0;
    d.run += (runT - d.run) * kg;
    d.crouch += ((this.gaitTarget === 'sneak' ? 1 : 0) - d.crouch) * kg;
    d.brisk = smooth01((d.speed - 1.0) / 2.0);
    d.move = smooth01((d.speed - 0.05) / 0.45);
    d.phase += phaseAdvance((d.speed * dt) / this.scale, stepLength(d, s));
    if (d.phase > 1000) d.phase -= Math.PI * 2 * 150;
    // Idle weight shifts.
    this.shiftT -= dt;
    if (this.shiftT <= 0) {
      this.shiftT = 2.4 + this.rng.next() * 3.2;
      this.shiftTarget = this.shiftTarget > 0 ? -0.35 - this.rng.next() * 0.65 : 0.35 + this.rng.next() * 0.65;
    }
    d.shift += (this.shiftTarget - d.shift) * (1 - Math.exp(-2.5 * dt));

    // Base pose + idle gesture layer + action layer, cross-faded.
    standPose(this.base, d);
    this.updateGesture(dt);
    let target = this.base;
    if (this.gesture) {
      copyPose(this.gest, this.base);
      this.ctx.at = this.gestT;
      this.ctx.t = this.time;
      gesturePose(this.gest, this.gesture, Math.min(1, this.gestT / GESTURE_DURATION[this.gesture]), this.ctx);
      target = this.gest;
    }
    let finished = false;
    let actU = 0;
    if (this.curAction) {
      this.actT += dt;
      actU = Math.min(1, this.actT / this.actDur);
      copyPose(this.act, target);
      this.ctx.at = this.actT;
      this.ctx.t = this.time;
      actionPose(this.act, this.curAction, actU, this.ctx);
      target = this.act;
      if (this.actT >= this.actDur) finished = true;
    }
    if (this.fadeT < this.fadeDur) {
      this.fadeT += dt;
      blendPose(this.out, this.snap, target, smooth01(this.fadeT / this.fadeDur));
    } else copyPose(this.out, target);

    // Prop toggles.
    const inHand = this.curAction === 'whistle' && whistleInHand(actU);
    this.bones[B.propHand]!.scale.setScalar(inHand ? 1 : HIDE);
    this.bones[B.propChest]!.scale.setScalar(inHand ? HIDE : 1);
    if (this.phone) this.phone.visible = gestureShowsPhone(this.gesture, this.gesture ? this.gestT / GESTURE_DURATION[this.gesture] : 0);

    this.updateFace(dt, actU);
    if (finished) {
      this.startFade(0.2);
      this.curAction = null;
    }
    this.applyPose(this.out);
    this.applyFace();
    this.root.updateMatrixWorld(true);
    this.updateSockets();
    this.updateHair(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    releaseGeo(this.geo);
    this.body.skeleton.dispose();
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private startFade(dur: number): void {
    copyPose(this.snap, this.out);
    this.fadeT = 0;
    this.fadeDur = dur;
  }

  private updateGesture(dt: number): void {
    const d = this.drive;
    const idle = d.move < 0.05 && d.crouch < 0.3 && !this.curAction && this.gestures.length > 0;
    if (this.gesture) {
      this.gestT += dt;
      if (this.gestT >= GESTURE_DURATION[this.gesture] || !idle) {
        if (!idle) this.startFade(0.2);
        this.gesture = null;
      }
      return;
    }
    if (!idle || dt <= 0) return;
    this.gestIn -= dt;
    if (this.gestIn > 0) return;
    this.gestIn = 4 + this.rng.next() * 5;
    this.gesture = this.gestures[Math.floor(this.rng.next() * this.gestures.length) % this.gestures.length]!;
    this.gestT = 0;
  }

  private resolveFace(actU: number): Face {
    if (this.curAction) {
      const e = actionFace(this.curAction, actU);
      if (e) return e;
    }
    if (this.timedExpr) return this.timedExpr;
    if (this.gesture && this.baseExpr === 'neutral') {
      const e = gestureFace(this.gesture);
      if (e) return e;
    }
    return this.baseExpr;
  }

  private updateFace(dt: number, actU: number): void {
    if (this.timedExpr) {
      this.timedLeft -= dt;
      if (this.timedLeft <= 0) {
        this.timedExpr = null;
        this.timedLeft = 0;
      }
    }
    const next = this.resolveFace(actU);
    if (next !== this.face) this.faceT = 0;
    else this.faceT += dt;
    this.face = next;
    const f = faceFor(this.face);
    const fs = this.fs;
    const k = this.time < 0.05 ? 1 : dt > 0 ? 1 - Math.exp(-14 * dt) : 0;
    fs.lid += (f.lid - fs.lid) * k;
    fs.lidR += (f.lidR - fs.lidR) * k;
    fs.lidTilt += (f.lidTilt - fs.lidTilt) * k;
    fs.lowLid += (f.lowLid - fs.lowLid) * k;
    fs.browY += (f.browY - fs.browY) * k;
    fs.browTilt += (f.browTilt - fs.browTilt) * k;
    fs.browAsym += (f.browAsym - fs.browAsym) * k;
    fs.pupil += (f.pupil - fs.pupil) * k;
    fs.pupilY += (f.pupilY - fs.pupilY) * k;
    fs.mouthScale += (f.mouthScale - fs.mouthScale) * k;
    fs.blush += (f.blush - fs.blush) * k;
    fs.headX += (f.headX - fs.headX) * k;
    fs.headZ += (f.headZ - fs.headZ) * k;
    fs.dart += (f.dart - fs.dart) * k;

    // Blinks.
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      if (this.blinkT > 0.16) this.blinkT = -1;
    } else if (dt > 0) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) {
        this.blinkT = 0;
        this.blinkIn = 1.8 + this.rng.next() * 3.4;
        if (this.rng.next() < 0.14) this.blinkIn = 0.25;
      }
    }

    // Look: the world's yaw (authoritative). Students / extras add small idle glances when nothing is set.
    let yaw = this.lookTarget;
    const blocked = this.curAction !== null && actionBlocksLook(this.curAction);
    if (this.idleGlances && Math.abs(yaw) < 0.02 && !this.curAction && !this.gesture && this.drive.move < 0.3) {
      this.idleLookT -= dt;
      if (this.idleLookT <= 0) {
        this.idleLookT = 1.8 + this.rng.next() * 3.4;
        this.idleYaw = this.rng.next() < 0.45 ? 0 : (this.rng.next() - 0.5) * 0.8;
      }
      yaw = this.idleYaw;
    }
    if (blocked) yaw = 0;
    const lk = this.time < 0.05 ? 1 : dt > 0 ? 1 - Math.exp(-10 * dt) : 0;
    this.lookYaw += (yaw - this.lookYaw) * lk;
  }

  private applyPose(p: Pose): void {
    const s = this.spec;
    const bn = this.bones;
    const v = p.v;
    const base = bn[B.base]!;
    base.position.set(v[C.btx]!, v[C.bty]!, v[C.btz]!);
    base.rotation.set(v[C.bx]!, v[C.by]!, v[C.bz]!, 'XYZ');
    const sq = Math.max(0.6, Math.min(1.4, v[C.sq]!));
    const sxz = 1 / Math.sqrt(sq);
    base.scale.set(sxz, sq, sxz);

    // Legs + ground lock (the lowest foot stays on y = 0).
    bn[B.thighL]!.rotation.set(v[C.lLx]!, v[C.lLt]!, v[C.lLo]!, 'XZY');
    bn[B.thighR]!.rotation.set(v[C.lRx]!, -v[C.lRt]!, -v[C.lRo]!, 'XZY');
    bn[B.shinL]!.rotation.x = v[C.lLk]!;
    bn[B.shinR]!.rotation.x = v[C.lRk]!;
    bn[B.footL]!.rotation.x = v[C.lLa]!;
    bn[B.footR]!.rotation.x = v[C.lRa]!;
    const hipDrop = s.hipsY - (s.thighL + s.shinL + s.ankleY);
    const kr = s.legR * 0.85;
    const ext = Math.max(
      legExtension(s.thighL, s.shinL, s.ankleY, s.footL, kr, v[C.lLx]!, v[C.lLo]!, v[C.lLk]!, v[C.lLa]!),
      legExtension(s.thighL, s.shinL, s.ankleY, s.footL, kr, v[C.lRx]!, v[C.lRo]!, v[C.lRk]!, v[C.lRa]!),
    );
    const locked = hipDrop + ext;
    const gl = clamp01(v[C.gl]!);
    const hips = bn[B.hips]!;
    hips.position.set(v[C.hpx]!, this.restHipsY + (locked - this.restHipsY) * gl + v[C.hpy]!, v[C.hpz]!);
    hips.rotation.set(v[C.px]!, v[C.pyaw]!, v[C.pz]!, 'YXZ');
    bn[B.spine]!.rotation.set(v[C.sx]!, v[C.sy]!, v[C.sz]!, 'YXZ');
    // Look: the chest takes a little of the turn, the head the rest (total = the requested yaw).
    bn[B.chest]!.rotation.set(v[C.cx]!, v[C.cy]! + this.lookYaw * 0.22, v[C.cz]!, 'YXZ');
    const pop = this.face === 'surprised' || this.face === 'panicked' ? -0.07 * Math.sin(this.faceT * 22) * Math.exp(-this.faceT * 7) : 0;
    bn[B.head]!.rotation.set(v[C.hx]! + this.fs.headX + pop, v[C.hy]! + this.lookYaw * 0.78, v[C.hz]! + this.fs.headZ, 'YXZ');

    // Arms (FK, then IK blended on top).
    const uL = bn[B.upperArmL]!;
    const uR = bn[B.upperArmR]!;
    uL.position.copy(this.restArm[0]);
    uL.position.y += v[C.shL]!;
    uR.position.copy(this.restArm[1]);
    uR.position.y += v[C.shR]!;
    uL.rotation.set(v[C.aLx]!, v[C.aLt]!, v[C.aLo]!, 'XZY');
    uR.rotation.set(v[C.aRx]!, -v[C.aRt]!, -v[C.aRo]!, 'XZY');
    bn[B.foreArmL]!.rotation.x = -v[C.aLe]!;
    bn[B.foreArmR]!.rotation.x = -v[C.aRe]!;
    bn[B.handL]!.rotation.set(v[C.wLx]!, v[C.wLt]!, v[C.wLz]!, 'XYZ');
    bn[B.handR]!.rotation.set(v[C.wRx]!, -v[C.wRt]!, -v[C.wRz]!, 'XYZ');
    const fL = v[C.fL]!;
    const fR = v[C.fR]!;
    bn[B.fingerL]!.scale.setScalar(fL > 0.03 ? fL : HIDE);
    bn[B.fingerR]!.scale.setScalar(fR > 0.03 ? fR : HIDE);
    const ikL = clamp01(v[C.ikL]!);
    const ikR = clamp01(v[C.ikR]!);
    if (ikL > 0.001) this.solveArm(0, p, ikL);
    if (ikR > 0.001) this.solveArm(1, p, ikR);
  }

  private solveArm(i: 0 | 1, p: Pose, w: number): void {
    const s = this.spec;
    const v = p.v;
    const side = i === 0 ? 1 : -1;
    const up = this.bones[i === 0 ? B.upperArmL : B.upperArmR]!;
    const fo = this.bones[i === 0 ? B.foreArmL : B.foreArmR]!;
    const b = i === 0 ? C.ikL : C.ikR;
    _sh.copy(up.position);
    _tgt.set(_sh.x + side * v[b + 1]!, _sh.y + v[b + 2]!, _sh.z + v[b + 3]!);
    _pole.set(side * v[b + 4]!, v[b + 5]!, v[b + 6]!);
    const bend = solveTwoBone(_sh, _tgt, s.upperArmL, s.foreArmL + s.handR * 0.8, _pole, _qIK);
    up.quaternion.slerp(_qIK, w);
    const fk = i === 0 ? v[C.aLe]! : v[C.aRe]!;
    fo.rotation.x = -(fk + (bend - fk) * w);
  }

  private applyFace(): void {
    const bn = this.bones;
    const s = this.spec;
    const fs = this.fs;
    const f = faceFor(this.face);
    const er = s.eyeR;
    const ey = er * EYE_SCALE[1];
    const blink = this.blinkT >= 0 ? Math.sin(Math.min(1, this.blinkT / 0.16) * Math.PI) : 0;
    const dart = fs.dart > 0.02 ? fs.dart * er * 0.13 * Math.sign(Math.sin(this.time * 4.3)) * (0.6 + 0.4 * Math.sin(this.time * 11)) : 0;
    for (let side = 1; side >= -1; side -= 2) {
      const sd = side as 1 | -1;
      const shape = sd > 0 ? f.eyeL : f.eyeR;
      const o = faceBone(sd, 0);
      scaleOr(bn[o + F.open]!, shape === 'open');
      scaleOr(bn[o + F.joy]!, shape === 'joy');
      scaleOr(bn[o + F.closed]!, shape === 'closed');
      scaleOr(bn[o + F.squeeze]!, shape === 'squeeze');
      if (shape === 'open') {
        let c = Math.max(0, fs.lid + (sd < 0 ? fs.lidR : 0));
        c = Math.min(1, Math.max(c, blink));
        const lu = bn[o + F.lidU]!;
        if (c < 0.02) lu.scale.setScalar(HIDE);
        else lu.scale.set(1, c, Math.min(1, 0.5 + c * 0.9));
        lu.rotation.z = sd * fs.lidTilt * (1 - blink);
        const la = bn[o + F.lash]!;
        const top = ey * 1.02;
        const yEdge = top - 2.04 * ey * c;
        const kk = Math.sqrt(Math.max(0.03, 1 - (yEdge / (ey * 1.06)) * (yEdge / (ey * 1.06))));
        if (c < 0.03) la.scale.setScalar(HIDE);
        else la.scale.set(kk, 1, kk * Math.min(1, 0.5 + c * 0.9));
        la.position.set(0, yEdge, 0);
        la.rotation.z = lu.rotation.z;
        const ld = bn[o + F.lidD]!;
        const low = Math.min(0.55, fs.lowLid) * (1 - blink);
        if (low < 0.14) ld.scale.setScalar(HIDE);
        else ld.scale.set(1, low, Math.min(1, 0.35 + low));
        const ir = bn[o + F.iris]!;
        const px = Math.max(-er * 0.24, Math.min(er * 0.24, this.lookYaw * er * 0.2 + dart));
        const py = Math.max(-er * 0.16, Math.min(er * 0.24, fs.pupilY * er * 0.22));
        ir.position.set(px, py, 0);
        const ps = Math.max(0.5, fs.pupil);
        ir.scale.set(ps, ps, 1);
      }
      const br = bn[o + F.brow]!;
      const rq = this.restQ[o + F.brow]!;
      _v.set(0, (fs.browY + (sd > 0 ? fs.browAsym : 0) - (blink > 0.5 ? 0.02 : 0)) * er, 0).applyQuaternion(rq);
      br.position.copy(this.restFace[o + F.brow]!).add(_v);
      _e.set(0, 0, sd * fs.browTilt, 'XYZ');
      br.quaternion.copy(rq).multiply(_q2.setFromEuler(_e));
      const bl = bn[o + F.blush]!;
      const b = fs.blush < 0.05 ? HIDE : 0.6 + Math.min(0.6, fs.blush * 0.4);
      bl.scale.set(b, b, 1);
    }
    const ms = fs.mouthScale * (this.face === 'panicked' ? 1 + 0.06 * Math.sin(this.time * 9) : 1);
    for (let i = 0; i < MOUTHS.length; i++) {
      const bone = bn[B.mouth0 + i]!;
      if (MOUTHS[i] === f.mouth) bone.scale.set(ms, ms, 1);
      else bone.scale.setScalar(HIDE);
    }
  }

  private updateSockets(): void {
    const bn = this.bones;
    // Hand sockets keep props upright in the body frame (+Y up, +Z forward), tilted by s?x/s?z.
    const v = this.out.v;
    this.figure.getWorldQuaternion(_q);
    _q.multiply(bn[B.base]!.quaternion);
    for (let i = 0; i < 2; i++) {
      const hand = bn[i === 0 ? B.handL : B.handR]!;
      const sock = this.handSock[i]!;
      _e.set(i === 0 ? v[C.sLx]! : v[C.sRx]!, 0, i === 0 ? v[C.sLz]! : v[C.sRz]!, 'XYZ');
      _q2.setFromEuler(_e).premultiply(_q);
      hand.matrixWorld.decompose(_v2, sock.quaternion, _s);
      sock.quaternion.invert().multiply(_q2);
      sock.updateMatrixWorld(true);
    }
    // Blob shadow under the hips.
    bn[B.hips]!.getWorldPosition(_v);
    this.root.worldToLocal(_v);
    this.shadow.position.set(_v.x, 0.012, _v.z);
  }

  private updateHair(dt: number): void {
    const sim = this.hairSim;
    if (sim === 'none' || dt <= 0) return;
    const bn = this.bones;
    const head = bn[B.head]!;
    this.headSock.getWorldPosition(_v);
    if (!this.hasHeadPrev) {
      this.headPrev.copy(_v);
      this.hasHeadPrev = true;
    }
    _v2.subVectors(_v, this.headPrev).divideScalar(dt);
    this.headPrev.copy(_v);
    const ax = (_v2.x - this.headVel.x) / dt;
    const ay = (_v2.y - this.headVel.y) / dt;
    const az = (_v2.z - this.headVel.z) / dt;
    this.headVel.copy(_v2);
    head.getWorldQuaternion(_q).invert();
    _v.set(ax, ay, az).applyQuaternion(_q);
    const sw = this.sway;
    const K = 55;
    const D = 7;
    const tx = Math.max(-0.5, Math.min(0.5, _v.z * 0.012)) + 0.02 * Math.sin(this.time * 1.3);
    const tz = Math.max(-0.4, Math.min(0.4, -_v.x * 0.012));
    sw.vx += (-K * (sw.x - tx) - D * sw.vx) * dt;
    sw.x += sw.vx * dt;
    sw.vz += (-K * (sw.z - tz) - D * sw.vz) * dt;
    sw.z += sw.vz * dt;
    sw.vbob += (-120 * (sw.bob - Math.max(-0.4, Math.min(0.4, -_v.y * 0.004))) - 9 * sw.vbob) * dt;
    sw.bob += sw.vbob * dt;
    if (!Number.isFinite(sw.x + sw.z + sw.bob)) sw.x = sw.vx = sw.z = sw.vz = sw.bob = sw.vbob = 0;
    if (sim === 'bounce') {
      const top = bn[B.hairTop]!;
      top.scale.set(1, 1 + sw.bob * 0.1, 1);
      top.rotation.set(sw.x * 0.08, 0, sw.z * 0.08);
      return;
    }
    const hx = head.rotation.x;
    const hz = head.rotation.z;
    bn[B.hairBack0]!.rotation.set(Math.max(-0.08, sw.x * 0.55 - hx * 0.45), 0, sw.z * 0.5 - hz * 0.4);
    bn[B.hairBack1]!.rotation.set(Math.max(-0.1, sw.x * 0.35), 0, sw.z * 0.35);
    bn[B.hairBack2]!.rotation.set(Math.max(-0.1, sw.x * 0.25), 0, sw.z * 0.25);
    if (sim === 'long') {
      for (let i = 0; i < 2; i++) {
        const a = bn[i === 0 ? B.hairSideL0 : B.hairSideR0]!;
        const b2 = bn[i === 0 ? B.hairSideL1 : B.hairSideR1]!;
        a.rotation.set(Math.max(-0.05, sw.x * 0.25 - hx * 0.25), 0, sw.z * 0.3 - hz * 0.3);
        b2.rotation.set(Math.max(-0.05, sw.x * 0.2), 0, sw.z * 0.2);
      }
    }
  }
}

function scaleOr(b: THREE.Object3D, on: boolean): void {
  if (on) b.scale.setScalar(1);
  else b.scale.setScalar(HIDE);
}

// ── shared blob shadow ────────────────────────────────────────────────────────

let shadowMat: THREE.MeshBasicMaterial | null = null;
function shadowMaterial(): THREE.MeshBasicMaterial {
  if (!shadowMat) {
    shadowMat = markShared(
      new THREE.MeshBasicMaterial({ color: PAL.outline, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    );
    shadowMat.name = 'hp-people-blob-shadow';
  }
  return shadowMat;
}

function shadowGeo(): THREE.BufferGeometry {
  return cachedGeo('hp-people-shadow', () => {
    const seg = 20;
    const rings = [0, 0.5, 0.82, 1];
    const alpha = [0.3, 0.24, 0.1, 0];
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    for (let ri = 0; ri < rings.length; ri++) {
      const rr = rings[ri]!;
      const n = ri === 0 ? 1 : seg;
      for (let i = 0; i < n; i++) {
        const a = (i / seg) * Math.PI * 2;
        pos.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
        col.push(1, 1, 1, alpha[ri]!);
      }
    }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + ((i + 1) % seg), 1 + i);
    for (let ri = 1; ri < rings.length - 1; ri++) {
      const b0 = 1 + (ri - 1) * seg;
      const b1 = 1 + ri * seg;
      for (let i = 0; i < seg; i++) {
        const i1 = (i + 1) % seg;
        idx.push(b0 + i, b0 + i1, b1 + i, b0 + i1, b1 + i1, b1 + i);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  });
}
