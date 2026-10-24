// Floating touch-joystick math — PURE and allocation-free (writes into `out` objects).
// Screen coordinates: +x right, +y DOWN (pointer events). Output y is UP-positive
// (the GameControls convention), so a thumb pushed up gives y > 0. (Adapted from Trash Panda,
// plus the horizontal-only track used by ControlScheme.move === 'x'.)
import { clamp } from '../core/math';

export interface StickConfig {
  /** Knob travel for full deflection (CSS px). */
  radius: number;
  /** Radial dead zone as a fraction of radius. */
  deadzone: number;
  /** Fraction of the radius past which the output is full (1 = only at the rim). A thumb rarely sits exactly on the rim. */
  fullAt: number;
}

export const DEFAULT_STICK: Readonly<StickConfig> = Object.freeze({
  radius: 52,
  deadzone: 0.12,
  fullAt: 0.9,
});

export interface StickOutput {
  /** −1..1 right-positive. */
  x: number;
  /** −1..1 UP-positive (always 0 on the 'x' track). */
  y: number;
  /** Knob offset from the base centre, clamped to the travel radius (px, screen axes). */
  knobX: number;
  knobY: number;
}

export const createStickOutput = (): StickOutput => ({ x: 0, y: 0, knobX: 0, knobY: 0 });

/** Map a normalised travel n (0..1) through the dead zone and the "full at" point → 0..1. */
function shape(n: number, cfg: Readonly<StickConfig>): number {
  const dz = clamp(cfg.deadzone, 0, 0.95);
  const full = clamp(cfg.fullAt, dz + 0.01, 1);
  if (!(n > dz)) return 0;
  return Math.min(1, (n - dz) / (full - dz));
}

/**
 * Finger offset (dx, dy) from the stick origin → analog move + knob position ('xy' stick).
 * Radial dead zone with rescale so direction is preserved (diagonals stay diagonal) and there is
 * no jump at the dead-zone edge; magnitude ≤ 1.
 */
export function computeStick(dx: number, dy: number, cfg: Readonly<StickConfig>, out: StickOutput): StickOutput {
  const r = cfg.radius > 0 ? cfg.radius : 1;
  const len = Math.hypot(dx, dy);
  const k = len > r ? r / len : 1;
  out.knobX = dx * k;
  out.knobY = dy * k;
  const mag = len === 0 ? 0 : shape(Math.min(1, len / r), cfg);
  if (mag === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  out.x = (dx / len) * mag;
  out.y = (-dy / len) * mag;
  return out;
}

/** Horizontal-only track ('x' scheme): only dx matters, the knob slides along the track, y = 0. */
export function computeStickX(dx: number, cfg: Readonly<StickConfig>, out: StickOutput): StickOutput {
  const r = cfg.radius > 0 ? cfg.radius : 1;
  out.knobX = clamp(dx, -r, r);
  out.knobY = 0;
  out.y = 0;
  const mag = shape(Math.min(1, Math.abs(dx) / r), cfg);
  out.x = mag === 0 ? 0 : Math.sign(dx) * mag;
  return out;
}

/**
 * "Dynamic" floating stick: when the finger drifts further than `maxDist` from the origin, drag
 * the origin along behind it. Reversing direction then only needs one stick-radius of travel
 * instead of the whole drift. Mutates `origin`. With `xOnly`, only the horizontal distance counts.
 */
export function followOrigin(origin: { x: number; y: number }, px: number, py: number, maxDist: number, xOnly = false): void {
  if (xOnly) {
    const dx = px - origin.x;
    if (Math.abs(dx) > maxDist) origin.x = px - Math.sign(dx) * maxDist;
    return;
  }
  const dx = px - origin.x;
  const dy = py - origin.y;
  const len = Math.hypot(dx, dy);
  if (len <= maxDist || len === 0) return;
  const pull = (len - maxDist) / len;
  origin.x += dx * pull;
  origin.y += dy * pull;
}

/** Keep a circle of radius `margin` centred at v inside [0, size] (1-D helper per axis). */
export function clampInside(v: number, size: number, margin: number): number {
  if (size <= margin * 2) return size / 2;
  return clamp(v, margin, size - margin);
}

/** Drawn sizes (CSS px) of the stick for a knob travel radius. */
export interface StickDims {
  /** 'xy' base diameter: the knob's full deflection sits on the rim. */
  base: number;
  knob: number;
  /** 'x' track (pill) width and height. */
  trackW: number;
  trackH: number;
}

export function stickDims(radius: number): StickDims {
  const base = Math.round(radius * 2 + 14);
  const knob = Math.round(base * 0.5);
  return { base, knob, trackW: Math.round(radius * 2 + knob + 8), trackH: knob + 14 };
}
