// ─────────────────────────────────────────────────────────────────────────────
// Procedural animation (pure pose writers — no THREE objects, no allocation),
// ported from Bad Hair Day's family anim and re-tuned for HALL PASS: a standing
// idle (breathing, weight shifts), the SNEAK crouch (knees bent, torso low, arms
// tucked in — a noticeably shorter silhouette), walk and sprint (arms pumping)
// with distance-driven stride, hold poses (mug / clipboard / cart), the one-shot
// PersonActions and small idle gestures. Arm gestures use IK hand targets in
// metres relative to the shoulder in the chest frame (outward, up, forward).
// ─────────────────────────────────────────────────────────────────────────────
import { CHANNELS, type Pose, clamp01, envelope, mix, resetPose, smooth01, trk, type Track } from './pose';
import type { Face } from './expressions';
import type { BodySpec } from './spec';
import type { PersonAction, PersonRole } from './types';

/** Channel indices (typed-array access: no boxing in hot loops). */
export const C = Object.fromEntries(CHANNELS.map((c, i) => [c, i])) as { readonly [K in (typeof CHANNELS)[number]]: number };

const set = (p: Pose, i: number, v: number): void => {
  p.v[i] = v;
};
const add = (p: Pose, i: number, v: number): void => {
  p.v[i] = p.v[i]! + v;
};
const mt = (p: Pose, i: number, v: number, w: number): void => {
  p.v[i] = p.v[i]! + (v - p.v[i]!) * w;
};
const get = (p: Pose, i: number): number => p.v[i]!;

export type Hold = 'none' | 'mug' | 'clipboard' | 'cart';

export interface Drive {
  t: number;
  /** Gait phase (rad), advanced by distance. */
  phase: number;
  /** Smoothed speed (m/s). */
  speed: number;
  /** Locomotion weight 0..1. */
  move: number;
  /** 0 walk … 1 sprint. */
  run: number;
  /** 0 upright … 1 sneak crouch. */
  crouch: number;
  /** 0 stroll … 1 brisk walk (step length). */
  brisk: number;
  /** Idle weight shift −1..1. */
  shift: number;
  hold: Hold;
  persona: PersonRole;
  spec: BodySpec;
  /** Cart grip (model space, already divided by the body scale). */
  gripX: number;
  gripY: number;
  gripZ: number;
}

export function newDrive(spec: BodySpec, persona: PersonRole, hold: Hold): Drive {
  return { t: 0, phase: 0, speed: 0, move: 0, run: 0, crouch: 0, brisk: 0, shift: 0, hold, persona, spec, gripX: 0.17, gripY: 0.92, gripZ: 0.44 };
}

export const armLen = (s: BodySpec): number => s.upperArmL + s.foreArmL;
export const legLen = (s: BodySpec): number => s.thighL + s.shinL;
export const hipJointY = (s: BodySpec): number => s.thighL + s.shinL + s.ankleY;

// ── gait ──────────────────────────────────────────────────────────────────────

/** Step length (m): strolls ~0.85 leg, brisk walks ~1.15, sprints ~1.45; the crouch shortens it. */
export function stepLength(d: Pick<Drive, 'run' | 'crouch' | 'brisk'>, s: BodySpec): number {
  const walk = mix(0.85, 1.15, d.brisk);
  return legLen(s) * mix(walk, 1.45, d.run) * (1 - 0.32 * clamp01(d.crouch));
}

/** Hip swing amplitude (rad) so the planted foot travels one step per half cycle (no skating). */
export function swingAmplitude(step: number, s: BodySpec): number {
  return Math.asin(Math.min(0.9, step / (2 * legLen(s))));
}

/** Phase advance (rad) for moving `dist` metres (π per step). */
export function phaseAdvance(dist: number, step: number): number {
  return (Math.PI * dist) / Math.max(1e-3, step);
}

// Crouch (sneak) base values.
const CR_HIP = -0.88;
const CR_KNEE = 1.5;
const CR_PELVIS = 0.2;
const CR_SPINE = 0.34;
const CR_CHEST = 0.1;

// ── base pose ─────────────────────────────────────────────────────────────────

export function standPose(p: Pose, d: Drive): void {
  resetPose(p);
  const s = d.spec;
  const t = d.t;
  const c = d.crouch;
  const br = Math.sin(t * 2.0);
  const idle = 1 - d.move;
  // Breathing.
  set(p, C.cx, 0.014 * br);
  set(p, C.hx, -0.012 * br);
  set(p, C.shL, 0.003 * (br + 1));
  set(p, C.shR, 0.003 * (br + 1));
  set(p, C.aLx, -0.04);
  set(p, C.aRx, -0.04);
  // Weight shift onto one leg (less in the crouch).
  const sh = d.shift * idle * (1 - 0.6 * c);
  set(p, C.pz, 0.045 * sh);
  set(p, C.btx, 0.012 * sh * s.scale);
  if (sh > 0) set(p, C.lRk, 0.2 * sh);
  else set(p, C.lLk, -0.2 * sh);
  set(p, C.lLa, -get(p, C.lLk) * 0.5);
  set(p, C.lRa, -get(p, C.lRk) * 0.5);
  if (c > 0.001) crouchPose(p, d, c);
  holdPose(p, d, 1);
  if (d.move > 0.001) locomotion(p, d);
}

/** The sneak crouch: knees bent, hips back and low, torso forward, head up, arms tucked in front of the chest. */
function crouchPose(p: Pose, d: Drive, c: number): void {
  const t = d.t;
  const sway = Math.sin(t * 1.7) * (1 - d.move);
  for (let side = 0; side < 2; side++) {
    const b = side === 0 ? C.lLx : C.lRx;
    const k = CR_KNEE + (side === 0 ? 0.06 : -0.06) * sway;
    add(p, b, CR_HIP * c);
    add(p, b + 1, 0.08 * c); // knees a little apart
    add(p, b + 3, k * c);
    set(p, b + 4, mix(get(p, b + 4), -(CR_HIP + k) * 0.92, c)); // feet flat
  }
  add(p, C.px, CR_PELVIS * c);
  add(p, C.sx, CR_SPINE * c);
  add(p, C.cx, CR_CHEST * c);
  add(p, C.hx, -(CR_PELVIS + CR_SPINE + CR_CHEST) * 0.85 * c);
  add(p, C.bz, 0.02 * sway * c);
  // Arms tucked in: elbows bent, hands up in front of the chest (cartoon tiptoe creep).
  mt(p, C.aLx, -0.62, c);
  mt(p, C.aRx, -0.62, c);
  mt(p, C.aLo, 0.1, c);
  mt(p, C.aRo, 0.1, c);
  mt(p, C.aLe, 1.55, c);
  mt(p, C.aRe, 1.55, c);
  mt(p, C.wLx, 0.55, c);
  mt(p, C.wRx, 0.55, c);
  add(p, C.shL, 0.025 * c);
  add(p, C.shR, 0.025 * c);
}

/** Arm IK target helper: metres relative to the shoulder (outward, up, forward) in the chest frame. */
function ik(p: Pose, side: 0 | 1, w: number, o: number, u: number, f: number, po = 0.6, pu = -1, pf = -0.3): void {
  const b = side === 0 ? C.ikL : C.ikR;
  mt(p, b, 1, w);
  mt(p, b + 1, o, w);
  mt(p, b + 2, u, w);
  mt(p, b + 3, f, w);
  mt(p, b + 4, po, w);
  mt(p, b + 5, pu, w);
  mt(p, b + 6, pf, w);
}

/** Model-space rest point → arm target (outward/up/forward from that shoulder). side 0 = L (+X), 1 = R. */
function rel(s: BodySpec, side: 0 | 1, mx: number, my: number, mz: number, out: [number, number, number]): [number, number, number] {
  const sg = side === 0 ? 1 : -1;
  out[0] = sg * mx - s.shoulderX;
  out[1] = my - s.shoulderY;
  out[2] = mz;
  return out;
}
const _r: [number, number, number] = [0, 0, 0];

/** Head-relative point (head space offsets) → arm target. */
function headTarget(s: BodySpec, side: 0 | 1, hx: number, hy: number, hz: number): [number, number, number] {
  return rel(s, side, hx, s.neckY + s.headCY + hy, s.headCZ + hz, _r);
}

export function holdPose(p: Pose, d: Drive, w: number): void {
  const s = d.spec;
  const L = armLen(s);
  const c = 1 - d.crouch * 0.6;
  switch (d.hold) {
    case 'none':
      return;
    case 'mug':
      ik(p, 1, w * c, -0.08 * L, -0.58 * L, 0.48 * L, 0.7, -1, -0.2);
      break;
    case 'clipboard':
      ik(p, 0, w * c, -0.16 * L, -0.6 * L, 0.42 * L, 0.8, -1, -0.2);
      mt(p, C.hx, 0.12, w * c * 0.5);
      break;
    case 'cart': {
      for (let side: 0 | 1 = 0; side < 2; side = (side + 1) as 0 | 1) {
        const tg = rel(s, side, d.gripX, d.gripY, d.gripZ, _r);
        ik(p, side, w, tg[0], tg[1], tg[2], 0.8, -0.8, -0.5);
      }
      mt(p, C.sx, 0.06, w);
      break;
    }
  }
}

function locomotion(p: Pose, d: Drive): void {
  const s = d.spec;
  const w = d.move;
  const g = d.run;
  const c = d.crouch;
  const step = stepLength(d, s);
  const A = swingAmplitude(step, s) * (1 - 0.15 * c);
  const bias = mix(-0.04, -0.16, g);
  const K = mix(0.95, 1.85, g) * (1 - 0.5 * c);
  const kflex = mix(0.08, 0.32, g);
  const armA = mix(0.42, 1.0, g) * (1 - 0.8 * c);
  const elb = mix(0.32, 1.6, g);
  const lean = mix(0.04, 0.26, g) * (1 - c) + 0.04 * c;
  const bob = mix(0.016, 0.05, g) * s.scale * (1 - 0.55 * c);
  const yawA = mix(0.09, 0.15, g) * (1 - 0.4 * c);
  const ph = d.phase;
  for (let side = 0; side < 2; side++) {
    const f = side === 0 ? ph : ph + Math.PI;
    const s1 = Math.sin(f);
    const c1 = Math.cos(f);
    const x = CR_HIP * c + bias - A * s1;
    const kneeC = CR_KNEE * c;
    const knee = kneeC + kflex + K * Math.pow(Math.max(0, Math.cos(f + 0.35)), 1.5);
    const ank = -(x + knee) * (0.8 + 0.12 * c) + 0.45 * Math.max(0, -s1) * g - 0.1 * Math.max(0, c1);
    const b = side === 0 ? C.lLx : C.lRx;
    mt(p, b, x, w);
    mt(p, b + 3, knee, w);
    mt(p, b + 4, ank, w);
  }
  const s0 = Math.sin(ph);
  add(p, C.hpy, w * bob * (Math.abs(s0) - 0.45));
  mt(p, C.sq, 1 - 0.025 * (1 - Math.abs(s0)), w);
  mt(p, C.pyaw, -yawA * s0, w);
  mt(p, C.sy, yawA * 1.3 * s0, w);
  add(p, C.sx, lean * w);
  add(p, C.hx, -lean * 0.75 * w);
  mt(p, C.hy, -yawA * 0.3 * s0, w);
  add(p, C.hz, 0.025 * Math.sin(ph * 2) * w);
  // Arms swing opposite the legs (pumping when sprinting, tucked when sneaking) unless busy.
  const freeL = d.hold !== 'clipboard' && d.hold !== 'cart';
  const freeR = d.hold !== 'mug' && d.hold !== 'cart';
  const tuckX = -0.62 + 0.12 * s0;
  if (freeL) {
    mt(p, C.ikL, 0, w);
    mt(p, C.aLx, mix(armA * s0 - 0.12 * g, tuckX, c), w);
    mt(p, C.aLe, mix(elb + 0.3 * Math.max(0, -armA * s0), 1.55, c), w);
    mt(p, C.aLo, mix(0.12 + 0.04 * g, 0.1, c), w);
  }
  if (freeR) {
    mt(p, C.ikR, 0, w);
    mt(p, C.aRx, mix(-armA * s0 - 0.12 * g, -0.62 - 0.12 * s0, c), w);
    mt(p, C.aRe, mix(elb + 0.3 * Math.max(0, armA * s0), 1.55, c), w);
    mt(p, C.aRo, mix(0.12 + 0.04 * g, 0.1, c), w);
  }
}

// ── actions ───────────────────────────────────────────────────────────────────

export const ACTION_DURATION: Readonly<Record<PersonAction, number>> = {
  grab: 0.7,
  busted: 1.6,
  celebrate: 1.3,
  flinch: 0.75,
  whistle: 1.1,
  point: 1.3,
  checkWatch: 1.9,
  lookAround: 2.4,
  shrug: 1.2,
  wave: 1.8,
};

export const ACTIONS = Object.keys(ACTION_DURATION) as PersonAction[];

/** Face an action shows while it plays (null = keep the current one). */
export function actionFace(a: PersonAction, u: number): Face | null {
  switch (a) {
    case 'grab':
      return u < 0.5 ? null : 'smug';
    case 'busted':
      return u < 0.12 ? 'surprised' : 'sheepish';
    case 'celebrate':
      return 'joy';
    case 'flinch':
      return u < 0.45 ? 'surprised' : 'nervous';
    case 'whistle':
      return u > 0.25 && u < 0.78 ? 'blow' : 'stern';
    case 'point':
      return u < 0.3 ? 'surprised' : 'stern';
    case 'checkWatch':
      return u > 0.35 && u < 0.75 ? 'suspicious' : null;
    case 'lookAround':
      return 'suspicious';
    case 'shrug':
      return 'smug';
    case 'wave':
      return 'happy';
  }
}

/** Head yaw from setLook is ignored while these play (the action drives the head). */
export function actionBlocksLook(a: PersonAction): boolean {
  return a === 'lookAround' || a === 'busted' || a === 'checkWatch';
}

/** Whistle visibility during the 'whistle' action: 1 = in the hand (at the mouth), 0 = on the lanyard. */
export function whistleInHand(u: number): boolean {
  return u > 0.16 && u < 0.86;
}

export interface ActCtx {
  spec: BodySpec;
  /** Seconds since the action started. */
  at: number;
  t: number;
}

const LOOK_AROUND: Track = [0, 0, 0.22, 0.75, 0.45, 0.75, 0.7, -0.7, 0.88, -0.65, 1, 0];
const FLINCH_Z: Track = [0, 0, 0.18, -0.12, 0.55, -0.1, 1, 0];
const FLINCH_Y: Track = [0, 0, 0.1, 0.06, 0.22, 0.0, 1, 0];
const PUMP: Track = [0, 0, 0.2, 0.15, 0.32, 1, 0.42, 0.3, 0.54, 1, 0.66, 0.3, 0.78, 1, 1, 0.6];
const BLOW: Track = [0, 0, 0.35, 0, 0.45, 1, 0.62, 1, 0.72, 0, 1, 0];

/** Write action `a` at progress u onto p (p holds the base pose). */
export function actionPose(p: Pose, a: PersonAction, u: number, c: ActCtx): void {
  const s = c.spec;
  const L = armLen(s);
  const at = c.at;
  switch (a) {
    case 'wave': {
      const w = envelope(u, 0.18, 0.2);
      ik(p, 1, w, 0.3 * L + 0.11 * L * Math.sin(at * 10), 0.6 * L, 0.1 * L, 0.5, -1, -0.1);
      mt(p, C.hz, 0.07, w);
      mt(p, C.sz, 0.04, w);
      break;
    }
    case 'grab': {
      const w = envelope(u, 0.28, 0.35);
      ik(p, 1, w, -0.08 * L, -0.85 * L, 0.55 * L, 0.7, -1, -0.2);
      mt(p, C.sx, 0.3, w);
      mt(p, C.hx, 0.18, w);
      for (let li = 0; li < 2; li++) {
        const b = li === 0 ? C.lLx : C.lRx;
        mt(p, b, get(p, b) - 0.3, w);
        mt(p, b + 3, get(p, b + 3) + 0.45, w);
        mt(p, b + 4, get(p, b + 4) - 0.15, w);
      }
      break;
    }
    case 'busted': {
      // Freeze: shoulders up to the ears, elbows in, hands half-raised, head sinking + tilting (sheepish).
      const w = envelope(u, 0.08, 0.2);
      const jit = 0.01 * Math.sin(at * 30) * (1 - smooth01(u / 0.25));
      add(p, C.shL, (0.055 * s.scale + jit) * w);
      add(p, C.shR, (0.055 * s.scale + jit) * w);
      mt(p, C.ikL, 0, w);
      mt(p, C.ikR, 0, w);
      mt(p, C.aLx, -0.35, w);
      mt(p, C.aRx, -0.35, w);
      mt(p, C.aLo, 0.32, w);
      mt(p, C.aRo, 0.32, w);
      mt(p, C.aLe, 1.35, w);
      mt(p, C.aRe, 1.35, w);
      mt(p, C.aLt, -0.6, w);
      mt(p, C.aRt, -0.6, w);
      mt(p, C.hx, 0.1, w);
      mt(p, C.hz, 0.13, w);
      mt(p, C.hy, 0, w);
      mt(p, C.sx, -0.04, w);
      mt(p, C.lLk, get(p, C.lLk) + 0.08, w);
      mt(p, C.lRk, get(p, C.lRk) + 0.08, w);
      break;
    }
    case 'celebrate': {
      // Fist pump: wind up, three pumps, little knee dip on each.
      const w = envelope(u, 0.12, 0.2);
      const k = trk(u, PUMP);
      ik(p, 1, w, 0.06 * L, mix(0.1, 0.78, k) * L, mix(0.35, 0.15, k) * L, 0.6, -0.6, -0.4);
      mt(p, C.hx, -0.12, w);
      mt(p, C.sz, 0.05, w);
      add(p, C.hpy, -0.02 * s.scale * (1 - k) * w);
      for (let li = 0; li < 2; li++) {
        const b = li === 0 ? C.lLx : C.lRx;
        mt(p, b + 3, get(p, b + 3) + 0.2 * (1 - k), w);
        mt(p, b, get(p, b) - 0.1 * (1 - k), w);
      }
      ik(p, 0, w * 0.6, -0.1 * L, -0.55 * L, 0.3 * L);
      break;
    }
    case 'flinch': {
      // Startled hop back: hands up in front, torso back, a tiny hop.
      const w = envelope(u, 0.06, 0.35);
      add(p, C.hpz, trk(u, FLINCH_Z) * s.scale);
      add(p, C.hpy, trk(u, FLINCH_Y) * s.scale);
      ik(p, 0, w, -0.1 * L, -0.1 * L, 0.4 * L, 0.8, -1, -0.2);
      ik(p, 1, w, -0.1 * L, -0.1 * L, 0.4 * L, 0.8, -1, -0.2);
      mt(p, C.sx, -0.16, w);
      mt(p, C.hx, -0.14, w);
      add(p, C.shL, 0.03 * w);
      add(p, C.shR, 0.03 * w);
      break;
    }
    case 'whistle': {
      // Whistle to the mouth, puff up, one sharp blow, back down.
      const w = envelope(u, 0.16, 0.16);
      const blow = trk(u, BLOW);
      const tgt = headTarget(s, 1, -0.012, -s.headRy * 0.52, s.headRz + 0.035);
      ik(p, 1, w, tgt[0], tgt[1], tgt[2], 0.9, -1, -0.1);
      mt(p, C.wRx, -0.3, w);
      add(p, C.cx, -0.07 * blow * w);
      add(p, C.hx, -0.1 * blow * w);
      add(p, C.shL, 0.03 * blow * w);
      add(p, C.shR, 0.03 * blow * w);
      add(p, C.hpy, 0.012 * blow * s.scale * w);
      break;
    }
    case 'point': {
      const w = envelope(u, 0.2, 0.22);
      ik(p, 1, w, 0.04 * L, 0.1 * L, 0.98 * L, 0.3, -1, 0);
      mt(p, C.fR, 1, w);
      mt(p, C.sx, 0.08, w);
      mt(p, C.hx, -0.05, w);
      ik(p, 0, w * 0.5, -0.05 * L, -0.75 * L, 0.2 * L);
      break;
    }
    case 'checkWatch': {
      const w = envelope(u, 0.22, 0.22);
      ik(p, 0, w, -0.22 * L, -0.4 * L, 0.52 * L, 0.8, -1, -0.2);
      mt(p, C.wLt, 1.2, w);
      mt(p, C.hx, 0.38, w);
      mt(p, C.hy, 0.28, w);
      break;
    }
    case 'lookAround': {
      const w = envelope(u, 0.12, 0.2);
      const k = trk(u, LOOK_AROUND);
      add(p, C.hy, k * w);
      add(p, C.cy, 0.25 * k * w);
      add(p, C.hx, -0.06 * w);
      break;
    }
    case 'shrug': {
      const w = envelope(u, 0.25, 0.3);
      add(p, C.shL, 0.05 * s.scale * w);
      add(p, C.shR, 0.05 * s.scale * w);
      mt(p, C.ikL, 0, w);
      mt(p, C.ikR, 0, w);
      mt(p, C.aLo, 0.42, w);
      mt(p, C.aRo, 0.42, w);
      mt(p, C.aLx, -0.25, w);
      mt(p, C.aRx, -0.25, w);
      mt(p, C.aLe, 1.45, w);
      mt(p, C.aRe, 1.45, w);
      mt(p, C.aLt, -0.9, w);
      mt(p, C.aRt, -0.9, w);
      mt(p, C.hz, 0.16, w);
      break;
    }
  }
}

// ── idle gestures (internal, cosmetic) ────────────────────────────────────────

export type Gesture = 'phoneGlance' | 'backpackHitch' | 'lookAround' | 'rockHeels' | 'stretchNeck' | 'adjustGlasses' | 'sip' | 'wipeBrow' | 'clipboardTap';

export const GESTURE_DURATION: Readonly<Record<Gesture, number>> = {
  phoneGlance: 2.6,
  backpackHitch: 1.2,
  lookAround: 2.6,
  rockHeels: 2.4,
  stretchNeck: 1.8,
  adjustGlasses: 1.3,
  sip: 2.0,
  wipeBrow: 1.6,
  clipboardTap: 2.2,
};

/** Gestures that keep the head straight (staff heads are gameplay tells — never turn them idly). */
export function gesturesFor(role: PersonRole, glasses: boolean, backpack: boolean, out: Gesture[]): Gesture[] {
  out.length = 0;
  switch (role) {
    case 'student':
      out.push('phoneGlance', 'lookAround', 'rockHeels');
      if (backpack) out.push('backpackHitch', 'backpackHitch');
      break;
    case 'extra':
      out.push('phoneGlance', 'lookAround', 'rockHeels');
      break;
    case 'patroller':
      out.push('stretchNeck', 'rockHeels');
      break;
    case 'sentry':
    case 'listener':
      out.push('rockHeels');
      break;
    case 'investigator':
      out.push('sip', 'sip', 'stretchNeck');
      break;
    case 'wanderer':
      out.push('wipeBrow');
      break;
    case 'snitch':
      out.push('clipboardTap', 'clipboardTap', 'rockHeels');
      break;
  }
  if (glasses) out.push('adjustGlasses');
  return out;
}

export function gestureFace(g: Gesture): Face | null {
  switch (g) {
    case 'phoneGlance':
      return 'smug';
    case 'sip':
      return 'happy';
    case 'clipboardTap':
      return 'smug';
    case 'wipeBrow':
      return 'relieved';
    default:
      return null;
  }
}

/** The phone prop shows during this gesture (student / extras). */
export function gestureShowsPhone(g: Gesture | null, u: number): boolean {
  return g === 'phoneGlance' && u > 0.12 && u < 0.88;
}

export function gesturePose(p: Pose, g: Gesture, u: number, c: ActCtx): void {
  const s = c.spec;
  const L = armLen(s);
  const at = c.at;
  switch (g) {
    case 'phoneGlance': {
      const w = envelope(u, 0.2, 0.2);
      ik(p, 0, w, -0.2 * L, -0.5 * L, 0.42 * L, 0.8, -1, -0.2);
      mt(p, C.sLx, -0.9, w);
      mt(p, C.hx, 0.42, w);
      mt(p, C.hy, 0.12, w);
      break;
    }
    case 'backpackHitch': {
      const w = envelope(u, 0.2, 0.25);
      const k = Math.max(0, Math.sin(u * Math.PI * 2.2));
      for (let side: 0 | 1 = 0; side < 2; side = (side + 1) as 0 | 1) {
        const tg = rel(s, side, s.torsoW * 0.5, s.chestY + 0.06, s.torsoD + s.handR * 0.6, _r);
        ik(p, side, w, tg[0], tg[1], tg[2], 0.9, -1, -0.2);
      }
      add(p, C.shL, 0.04 * k * w);
      add(p, C.shR, 0.04 * k * w);
      add(p, C.hpy, 0.012 * k * s.scale * w);
      break;
    }
    case 'lookAround': {
      const w = envelope(u, 0.15, 0.2);
      add(p, C.hy, trk(u, LOOK_AROUND) * 0.8 * w);
      add(p, C.hx, -0.05 * w);
      break;
    }
    case 'rockHeels': {
      const w = envelope(u, 0.1, 0.15);
      const k = Math.sin(at * 5);
      add(p, C.lLa, 0.3 * Math.max(0, k) * w);
      add(p, C.lRa, 0.3 * Math.max(0, k) * w);
      add(p, C.lLa, -0.14 * Math.max(0, -k) * w);
      add(p, C.lRa, -0.14 * Math.max(0, -k) * w);
      add(p, C.px, 0.04 * k * w);
      break;
    }
    case 'stretchNeck': {
      const w = envelope(u, 0.2, 0.2);
      add(p, C.hz, 0.3 * Math.sin(u * Math.PI * 2) * w);
      add(p, C.hx, 0.08 * w);
      break;
    }
    case 'adjustGlasses': {
      const w = envelope(u, 0.3, 0.3);
      const tgt = headTarget(s, 1, 0, -s.headRy * 0.02, s.headRz + 0.045);
      ik(p, 1, w, tgt[0], tgt[1], tgt[2], 0.9, -1, 0);
      mt(p, C.fR, 1, w);
      mt(p, C.hx, -0.06, w);
      break;
    }
    case 'sip': {
      const w = envelope(u, 0.22, 0.25);
      const tgt = headTarget(s, 1, -0.01, -s.headRy * 0.62, s.headRz + 0.04);
      ik(p, 1, w, tgt[0], tgt[1], tgt[2], 0.8, -1, -0.1);
      const tip = smooth01((u - 0.3) / 0.12) * (1 - smooth01((u - 0.62) / 0.12));
      mt(p, C.sRx, -0.9 * tip, w);
      mt(p, C.hx, -0.16 * tip, w);
      break;
    }
    case 'wipeBrow': {
      const w = envelope(u, 0.22, 0.25);
      const sw = Math.sin(at * 6) * 0.04;
      const tgt = headTarget(s, 0, s.headRx * 0.2 + sw, s.headRy * 0.45, s.headRz * 0.8);
      ik(p, 0, w, tgt[0], tgt[1], tgt[2], 1, -0.6, -0.3);
      mt(p, C.hx, -0.12, w);
      break;
    }
    case 'clipboardTap': {
      const w = envelope(u, 0.2, 0.2);
      const tap = 0.02 * Math.max(0, Math.sin(at * 9));
      ik(p, 1, w, -0.24 * L, -0.5 * L + tap, 0.5 * L, 0.8, -1, -0.2);
      mt(p, C.hx, 0.35, w);
      break;
    }
  }
}
