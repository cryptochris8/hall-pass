// ─────────────────────────────────────────────────────────────────────────────
// Deterministic trig for the sim (docs/ARCHITECTURE.md §3 rule 3). Math.sin / cos /
// atan2 may round differently between JS engines; these use only + − × ÷ and
// Math.floor / abs, which are exact everywhere, so a run replays bit for bit on
// every device and in Node. Accuracy ~1e-7, plenty for gameplay angles.
// SHARED CONTRACT (frozen).
// ─────────────────────────────────────────────────────────────────────────────

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  let r = a - TAU * Math.floor((a + PI) / TAU);
  if (r <= -PI) r += TAU;
  return r;
}

/** sin on [−π/2, π/2] (odd Taylor/minimax-style polynomial to x^15). */
function sinCore(x: number): number {
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))))
  );
}

export function fsin(a: number): number {
  let x = wrapAngle(a);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  return sinCore(x);
}

export function fcos(a: number): number {
  return fsin(a + HALF_PI);
}

/** atan on [0, 1] via a range-reduced series (|x| ≤ tan(π/12) after reduction). */
function atanCore(x: number): number {
  // Reduce: atan(x) = π/6 + atan((x − 1/√3) / (1 + x/√3)) for x > tan(π/12).
  const T15 = 0.2679491924311227; // tan(π/12)
  const INV_SQRT3 = 0.5773502691896258;
  let offset = 0;
  if (x > T15) {
    x = (x - INV_SQRT3) / (1 + x * INV_SQRT3);
    offset = PI / 6;
  }
  const x2 = x * x;
  // Series to x^17 converges fast for |x| ≤ 0.268.
  const s =
    x *
    (1 + x2 * (-1 / 3 + x2 * (1 / 5 + x2 * (-1 / 7 + x2 * (1 / 9 + x2 * (-1 / 11 + x2 * (1 / 13 + x2 * (-1 / 15 + x2 * (1 / 17)))))))));
  return offset + s;
}

export function fatan(x: number): number {
  const neg = x < 0;
  const ax = neg ? -x : x;
  const r = ax <= 1 ? atanCore(ax) : HALF_PI - atanCore(1 / ax);
  return neg ? -r : r;
}

/** atan2(y, x) in (−π, π]. fatan2(0, 0) = 0. */
export function fatan2(y: number, x: number): number {
  if (x === 0) {
    if (y > 0) return HALF_PI;
    if (y < 0) return -HALF_PI;
    return 0;
  }
  const a = fatan(y / x);
  if (x > 0) return a;
  return y >= 0 ? a + PI : a - PI;
}

/**
 * Yaw (rad) of a ground direction in this game's convention (docs/ARCHITECTURE.md §6):
 * yaw 0 faces +Z, yaw +π/2 faces +X. Inverse of (fsin(yaw), fcos(yaw)).
 */
export function yawOf(dx: number, dz: number): number {
  return fatan2(dx, dz);
}

/** Move angle `a` toward `b` by at most `maxStep` (rad), shortest way round. */
export function turnToward(a: number, b: number, maxStep: number): number {
  const d = wrapAngle(b - a);
  if (d > maxStep) return wrapAngle(a + maxStep);
  if (d < -maxStep) return wrapAngle(a - maxStep);
  return b;
}
