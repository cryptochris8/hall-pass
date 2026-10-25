// ─────────────────────────────────────────────────────────────────────────────
// Pose: a flat bag of named joint channels backed by one Float64Array, so copy /
// blend / reset are tight loops with no allocation (named accessors are defined
// on the prototype once). Conventions (character faces +Z, L = its left = +X):
//   bx,by,bz / btx,bty,btz / sq  whole-body rotation (Euler XYZ) + translation of
//                                the base bone (feet pivot) + squash (y scale)
//   gl   ground lock 0..1: hips height from the legs so the lowest foot is on y=0
//   hpx,hpy,hpz  hips offset from rest (m; hpy adds on top of the ground lock)
//   px,pyaw,pz  hips pitch/yaw/roll · sx,sy,sz spine · cx,cy,cz chest
//   hx,hy,hz head (+hx = look down, +hy = turn to its left, +hz = tilt to its right)
//   shL/shR shoulder raise (m) · a?x shoulder pitch (− = forward/up), a?o abduction
//   (+ = away from the body), a?t twist, a?e elbow bend (≥ 0) · w?x/w?z/w?t wrist
//   ik? arm IK weight; t?o/t?u/t?f hand target (m, outward/up/forward from that
//   shoulder in the chest frame); p?o/p?u/p?f elbow pole direction
//   f? pointing finger 0..1 · l?x hip pitch (− = leg forward), l?o abduction,
//   l?t toe-out, l?k knee bend (≥ 0), l?a ankle (+ = toes down)
//   s?x/s?z hand-socket (prop) tilt relative to the body frame.
// ─────────────────────────────────────────────────────────────────────────────

export const CHANNELS = [
  'bx', 'by', 'bz', 'btx', 'bty', 'btz', 'sq',
  'gl', 'hpx', 'hpy', 'hpz', 'px', 'pyaw', 'pz',
  'sx', 'sy', 'sz', 'cx', 'cy', 'cz', 'hx', 'hy', 'hz',
  'shL', 'shR',
  'aLx', 'aLo', 'aLt', 'aLe', 'wLx', 'wLz', 'wLt',
  'aRx', 'aRo', 'aRt', 'aRe', 'wRx', 'wRz', 'wRt',
  'ikL', 'tLo', 'tLu', 'tLf', 'pLo', 'pLu', 'pLf',
  'ikR', 'tRo', 'tRu', 'tRf', 'pRo', 'pRu', 'pRf',
  'fL', 'fR',
  'lLx', 'lLo', 'lLt', 'lLk', 'lLa',
  'lRx', 'lRo', 'lRt', 'lRk', 'lRa',
  'sLx', 'sLz', 'sRx', 'sRz',
] as const;

export type Channel = (typeof CHANNELS)[number];

const N = CHANNELS.length;
const DEFAULTS = new Float64Array(N);
const idx = (c: Channel): number => CHANNELS.indexOf(c);
DEFAULTS[idx('sq')] = 1;
DEFAULTS[idx('gl')] = 1;
DEFAULTS[idx('aLo')] = 0.12;
DEFAULTS[idx('aRo')] = 0.12;
DEFAULTS[idx('aLe')] = 0.28;
DEFAULTS[idx('aRe')] = 0.28;
DEFAULTS[idx('pLo')] = 0.6;
DEFAULTS[idx('pLu')] = -1;
DEFAULTS[idx('pLf')] = -0.4;
DEFAULTS[idx('pRo')] = 0.6;
DEFAULTS[idx('pRu')] = -1;
DEFAULTS[idx('pRf')] = -0.4;
/** Channels blended along the shortest arc (full turns). */
const WRAP = new Uint8Array(N);
WRAP[idx('by')] = 1;

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface Pose extends Record<Channel, number> {}
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class Pose {
  readonly v = new Float64Array(N);
  constructor() {
    this.v.set(DEFAULTS);
  }
}
for (let i = 0; i < N; i++) {
  Object.defineProperty(Pose.prototype, CHANNELS[i]!, {
    get(this: Pose) {
      return this.v[i]!;
    },
    set(this: Pose, x: number) {
      this.v[i] = x;
    },
    enumerable: false,
    configurable: false,
  });
}

export function resetPose(p: Pose): Pose {
  p.v.set(DEFAULTS);
  return p;
}

export function copyPose(out: Pose, a: Pose): Pose {
  out.v.set(a.v);
  return out;
}

/** out = a + (b − a)·t (out may alias a or b). */
export function blendPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  const o = out.v;
  const x = a.v;
  const y = b.v;
  for (let i = 0; i < N; i++) {
    const d = WRAP[i] ? wrapPi(y[i]! - x[i]!) : y[i]! - x[i]!;
    o[i] = x[i]! + d * t;
  }
  return out;
}

export function poseFinite(p: Pose): boolean {
  for (let i = 0; i < N; i++) if (!Number.isFinite(p.v[i]!)) return false;
  return true;
}

// ── keyframe tracks ────────────────────────────────────────────────────────────
// A track is a flat array [u0, v0, u1, v1, …] with ascending u; trk() interpolates
// with a C1 Hermite spline (finite-difference tangents, flat at the ends).

export type Track = readonly number[];

export function trk(u: number, k: Track): number {
  const n = k.length >> 1;
  if (n === 0) return 0;
  if (u <= k[0]!) return k[1]!;
  if (u >= k[(n - 1) * 2]!) return k[(n - 1) * 2 + 1]!;
  let i = 0;
  while (i < n - 2 && u > k[(i + 1) * 2]!) i++;
  const u0 = k[i * 2]!;
  const v0 = k[i * 2 + 1]!;
  const u1 = k[i * 2 + 2]!;
  const v1 = k[i * 2 + 3]!;
  const du = u1 - u0;
  if (du <= 1e-9) return v1;
  const t = (u - u0) / du;
  const m0 = i > 0 ? (v1 - k[i * 2 - 1]!) / (u1 - k[i * 2 - 2]!) : 0;
  const m1 = i + 2 < n ? (k[i * 2 + 5]! - v0) / (k[i * 2 + 4]! - u0) : 0;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * du * m0 + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * du * m1;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth01 = (v: number): number => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};
export const mix = (a: number, b: number, w: number): number => a + (b - a) * w;

/** Wrap an angle to (−π, π]. */
export function wrapPi(a: number): number {
  const t = Math.PI * 2;
  let x = a % t;
  if (x > Math.PI) x -= t;
  else if (x <= -Math.PI) x += t;
  return x;
}

/** Envelope that eases in over [0, a] and out over [1 − b, 1]. */
export function envelope(u: number, a = 0.15, b = 0.18): number {
  if (u <= 0 || u >= 1) return 0;
  return Math.min(smooth01(u / a), smooth01((1 - u) / b));
}
