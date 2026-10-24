// ─────────────────────────────────────────────────────────────────────────────
// Gamepad math & layouts — PURE (no DOM access, no allocation in the per-frame
// functions). The polling/state machine lives in gamepadInput.ts. (Adapted from Trash Panda.)
//
// Layouts
//  • 'standard'  — W3C "standard" mapping (Chrome/Edge/Safari for DS4, DualSense, Xbox,
//                  Switch Pro; Firefox for most XInput pads). Button indices:
//                  0 ✕/A  1 ○/B  2 □/X  3 △/Y  4 L1  5 R1  6 L2  7 R2  8 Share/Back  9 Options/Start
//                  10 L3  11 R3  12 ↑  13 ↓  14 ←  15 →  16 PS/Home.  Axes: 0 LX 1 LY 2 RX 3 RY.
//                  Buttons are POSITIONAL: index 0 is the bottom face button on every family
//                  (✕ on PlayStation, A on Xbox, B on Nintendo) — the glyph prompts follow the style.
//  • 'ps-evdev'  — Raw DualShock 4 / DualSense via the modern Linux kernel drivers
//                  (Firefox on Linux when it does not remap). 13 buttons, Cross first:
//                  0 ✕  1 ○  2 △  3 □  4 L1  5 R1  6 L2  7 R2  8 Share  9 Options  10 PS  11 L3  12 R3
//                  Axes: 0 LX 1 LY 2 L2(-1..1) 3 RX 4 RY 5 R2(-1..1) 6 hatX 7 hatY.
//  • 'ps-hid'    — Raw DS4 HID / DirectInput order (Firefox on Windows/macOS when it does not
//                  remap). 14+ buttons, Square first:
//                  0 □  1 ✕  2 ○  3 △  4 L1  5 R1  6 L2  7 R2  8 Share  9 Options  10 L3  11 R3  12 PS  13 Pad
//                  Axes: 0 LX 1 LY 2 RX 3 L2(-1..1) 4 R2(-1..1) 5 RY. D-pad: POV hat on axis 9 (10+ axes),
//                  two axes 6/7 (8 axes), or four extra buttons after the 14 (Firefox/Windows: 14 ↑ 15 ↓ 16 ← 17 →).
//  • 'generic'   — anything else without a standard mapping: best effort, assume the standard
//                  button order and axes 0/1 for the left stick. Their axes are only TRUSTED after
//                  they have been seen near centre once (see PadCalib): throttles, pedals and odd HID
//                  devices that rest at ±1 must never drive the athlete or scroll a menu forever.
// ─────────────────────────────────────────────────────────────────────────────
import { clamp, clamp01 } from '../core/math';
import type { PadStyle } from './types';

/** A gamepad button as the Gamepad API reports it. */
export interface GamepadButtonLike {
  readonly pressed: boolean;
  readonly value: number;
}

/** `GamepadHapticActuator` (Chrome/Edge/Safari), or Firefox's pulse() actuators. */
export interface HapticActuatorLike {
  playEffect?: (type: string, params?: Record<string, number>) => unknown;
  pulse?: (value: number, duration: number) => unknown;
}

/** Structural view of `Gamepad` so tests (and odd browsers) can supply plain objects. */
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly mapping: string;
  readonly connected: boolean;
  readonly buttons: ArrayLike<GamepadButtonLike | null | undefined>;
  readonly axes: ArrayLike<number>;
  readonly vibrationActuator?: HapticActuatorLike | null;
  /** Firefox (non-standard): array of actuators with `pulse(value, ms)`. */
  readonly hapticActuators?: ArrayLike<HapticActuatorLike | undefined>;
}

export type PadLayout = 'standard' | 'ps-evdev' | 'ps-hid' | 'generic';

// ── Virtual buttons (a bitmask). Bits 0..16 intentionally equal standard-mapping indices.
export const PB = {
  SOUTH: 1 << 0,
  EAST: 1 << 1,
  WEST: 1 << 2,
  NORTH: 1 << 3,
  L1: 1 << 4,
  R1: 1 << 5,
  L2: 1 << 6,
  R2: 1 << 7,
  SELECT: 1 << 8,
  START: 1 << 9,
  L3: 1 << 10,
  R3: 1 << 11,
  UP: 1 << 12,
  DOWN: 1 << 13,
  LEFT: 1 << 14,
  RIGHT: 1 << 15,
  HOME: 1 << 16,
  /** Left stick pushed past STICK_DIGITAL along its dominant axis (menus, activity). */
  STICK_UP: 1 << 17,
  STICK_DOWN: 1 << 18,
  STICK_LEFT: 1 << 19,
  STICK_RIGHT: 1 << 20,
} as const;

/** Normalised, layout-independent state of one pad. */
export interface PadSnapshot {
  /** Bitmask of PB.* currently held. */
  buttons: number;
  /** Raw left stick (-1..1, +x right, +y DOWN). */
  lx: number;
  ly: number;
  /** Analog R2 trigger 0..1. */
  r2: number;
}

export const createSnapshot = (): PadSnapshot => ({ buttons: 0, lx: 0, ly: 0, r2: 0 });

/**
 * Per-pad calibration flags, updated in place by readPad().
 *  • Raw trigger axes rest at -1 but many browsers report 0 until first touched → only trusted once non-zero.
 *  • Generic pads' stick axes are only trusted once seen near centre.
 */
export interface PadCalib {
  r2Seen: boolean;
  lxOk: boolean;
  lyOk: boolean;
}

export const createCalib = (): PadCalib => ({ r2Seen: false, lxOk: false, lyOk: false });

// ── Tunables ────────────────────────────────────────────────────────────────
/** Radial dead zone of the left stick (fraction of full deflection), rescaled so output starts at 0. */
export const STICK_DEADZONE = 0.18;
/** Stick deflection that counts as a digital direction (menus, device activity). */
export const STICK_DIGITAL = 0.5;
/** R2 travel that starts an alt hold … */
export const TRIGGER_PRESS = 0.35;
/** … and the (lower) travel that ends it — hysteresis, so a trigger resting near the threshold can't chatter. */
export const TRIGGER_RELEASE = 0.25;
/** A generic pad's axis must read within this of centre once before it is trusted. */
export const AXIS_CENTRE_TRUST = 0.3;

// ── Identification ──────────────────────────────────────────────────────────

/**
 * Controller family from `Gamepad.id`. Vendor id first, then names. Order matters: Xbox pads are
 * called "Xbox Wireless Controller", so the generic "Wireless Controller" (the DS4's USB product
 * name) is only a last-resort PlayStation hint.
 */
export function detectPadStyle(id: string): PadStyle {
  const vp = parseVendorProduct(id);
  if (vp !== null) {
    if (vp.vendor === '054c') return 'playstation';
    if (vp.vendor === '045e') return 'xbox';
    if (vp.vendor === '057e') return 'nintendo';
  }
  if (/054c|playstation|dualshock|dualsense|\bsony\b/i.test(id)) return 'playstation';
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  if (/057e|nintendo|pro controller|joy-?con/i.test(id)) return 'nintendo';
  if (/wireless controller/i.test(id)) return 'playstation';
  return 'generic';
}

/**
 * USB vendor/product from the id string. Chrome: "… (STANDARD GAMEPAD Vendor: 054c Product: 09cc)",
 * Firefox: "54c-9cc-Wireless Controller" (hex, sometimes without leading zeros).
 */
export function parseVendorProduct(id: string): { vendor: string; product: string } | null {
  const chrome = /vendor:\s*([0-9a-f]{1,4})\s*product:\s*([0-9a-f]{1,4})/i.exec(id);
  const m = chrome ?? /^\s*([0-9a-f]{1,4})-([0-9a-f]{1,4})-/i.exec(id);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { vendor: m[1].toLowerCase().padStart(4, '0'), product: m[2].toLowerCase().padStart(4, '0') };
}

/** Pick the button/axis layout for a pad (see the table at the top of this file). */
export function resolveLayout(pad: Pick<GamepadLike, 'id' | 'mapping' | 'buttons'>): PadLayout {
  if (pad.mapping === 'standard') return 'standard';
  if (detectPadStyle(pad.id) === 'playstation') {
    // Modern Linux drivers expose exactly 13 buttons (Cross first); HID/DirectInput orders
    // expose 14+ (Square first, with the touchpad click as a button).
    return pad.buttons.length === 13 ? 'ps-evdev' : 'ps-hid';
  }
  return 'generic';
}

// ── Reading ─────────────────────────────────────────────────────────────────

const EVDEV_BUTTONS: readonly number[] = [
  PB.SOUTH, PB.EAST, PB.NORTH, PB.WEST, PB.L1, PB.R1, PB.L2, PB.R2, PB.SELECT, PB.START, PB.HOME, PB.L3, PB.R3,
];
const HID_BUTTONS: readonly number[] = [
  PB.WEST, PB.SOUTH, PB.EAST, PB.NORTH, PB.L1, PB.R1, PB.L2, PB.R2, PB.SELECT, PB.START, PB.L3, PB.R3, PB.HOME,
  PB.SELECT, // 13 = touchpad click; treated like Share (unused in game)
];

function btnDown(pad: GamepadLike, i: number): boolean {
  const b = pad.buttons[i];
  if (b === undefined || b === null) return false;
  return b.pressed === true || (typeof b.value === 'number' && b.value > 0.5);
}

function btnValue(pad: GamepadLike, i: number): number {
  const b = pad.buttons[i];
  if (b === undefined || b === null) return 0;
  const v = typeof b.value === 'number' && Number.isFinite(b.value) ? b.value : 0;
  return v > 0 ? clamp01(v) : b.pressed === true ? 1 : 0;
}

/** Raw axis value (NaN/missing → 0). Not clamped: POV-hat axes report > 1 when neutral. */
function axis(pad: GamepadLike, i: number): number {
  const v = pad.axes[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Raw trigger axis (-1 rest .. +1 full) → 0..1. */
export function triggerFromAxis(v: number): number {
  return clamp01((v + 1) / 2);
}

/** How far (in axis units) a hat reading may sit from one of its 8 detents; steps are 2/7 ≈ 0.286 apart. */
const HAT_TOLERANCE = 0.08;

/**
 * Decode a POV-hat axis (DirectInput style) into PB.UP/DOWN/LEFT/RIGHT bits.
 * The 8 directions are spread over -1..1 in steps of 2/7, clockwise from "up"; neutral is > 1.
 * Readings between detents are rejected — notably 0, which browsers report for an axis that has
 * not sent a value yet and which would otherwise round to "↓" (a phantom held D-pad down).
 */
export function decodeHat(v: number): number {
  if (!Number.isFinite(v) || v < -1.05 || v > 1.05) return 0;
  const step = 2 / 7;
  const idx = Math.round((v + 1) / step);
  if (Math.abs(v - (-1 + idx * step)) > HAT_TOLERANCE) return 0;
  switch (idx) {
    case 0: return PB.UP;
    case 1: return PB.UP | PB.RIGHT;
    case 2: return PB.RIGHT;
    case 3: return PB.DOWN | PB.RIGHT;
    case 4: return PB.DOWN;
    case 5: return PB.DOWN | PB.LEFT;
    case 6: return PB.LEFT;
    case 7: return PB.UP | PB.LEFT;
    default: return 0;
  }
}

/** D-pad bits from two hat axes (x: -1 left..+1 right, y: -1 up..+1 down). */
export function dpadFromAxes(x: number, y: number): number {
  let m = 0;
  if (x < -0.5) m |= PB.LEFT;
  else if (x > 0.5) m |= PB.RIGHT;
  if (y < -0.5) m |= PB.UP;
  else if (y > 0.5) m |= PB.DOWN;
  return m;
}

/** Stick → PB.STICK_* bit along the dominant axis (0 inside STICK_DIGITAL). */
export function stickDirectionBits(x: number, y: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax < STICK_DIGITAL && ay < STICK_DIGITAL) return 0;
  if (ax >= ay) return x < 0 ? PB.STICK_LEFT : PB.STICK_RIGHT;
  return y < 0 ? PB.STICK_UP : PB.STICK_DOWN;
}

/** Normalise one pad into `out` (allocation-free). `calib` is updated in place. */
export function readPad(pad: GamepadLike, layout: PadLayout, out: PadSnapshot, calib: PadCalib): void {
  let mask = 0;
  let r2 = 0;
  let lx = clamp(axis(pad, 0), -1, 1);
  let ly = clamp(axis(pad, 1), -1, 1);

  if (layout === 'generic') {
    if (Math.abs(lx) < AXIS_CENTRE_TRUST) calib.lxOk = true;
    if (Math.abs(ly) < AXIS_CENTRE_TRUST) calib.lyOk = true;
    if (!calib.lxOk) lx = 0;
    if (!calib.lyOk) ly = 0;
  }

  if (layout === 'standard' || layout === 'generic') {
    const n = Math.min(pad.buttons.length, 17);
    for (let i = 0; i < n; i++) if (btnDown(pad, i)) mask |= 1 << i;
    r2 = btnValue(pad, 7);
  } else {
    const table = layout === 'ps-evdev' ? EVDEV_BUTTONS : HID_BUTTONS;
    const n = Math.min(pad.buttons.length, table.length);
    for (let i = 0; i < n; i++) if (btnDown(pad, i)) mask |= table[i] ?? 0;

    const ra = axis(pad, layout === 'ps-evdev' ? 5 : 4);
    if (ra !== 0) calib.r2Seen = true;
    // Prefer the analog axis; fall back to the digital R2 button until the axis wakes up.
    r2 = calib.r2Seen ? triggerFromAxis(ra) : (mask & PB.R2) !== 0 ? 1 : 0;

    if (layout === 'ps-evdev') mask |= dpadFromAxes(axis(pad, 6), axis(pad, 7));
    else {
      if (pad.axes.length >= 10) mask |= decodeHat(axis(pad, 9));
      else if (pad.axes.length >= 8) mask |= dpadFromAxes(axis(pad, 6), axis(pad, 7));
      // Firefox/Windows appends the hat as four buttons after the pad's own 14.
      if (pad.buttons.length >= HID_BUTTONS.length + 4) {
        const d = pad.buttons.length - 4;
        if (btnDown(pad, d)) mask |= PB.UP;
        if (btnDown(pad, d + 1)) mask |= PB.DOWN;
        if (btnDown(pad, d + 2)) mask |= PB.LEFT;
        if (btnDown(pad, d + 3)) mask |= PB.RIGHT;
      }
    }
  }

  mask |= stickDirectionBits(lx, ly);
  out.buttons = mask;
  out.lx = lx;
  out.ly = ly;
  out.r2 = r2;
}

// ── Shaping ─────────────────────────────────────────────────────────────────

/**
 * Radial dead zone with rescale: inside `dz` → 0; outside, the magnitude is remapped
 * from [dz, 1] to [0, 1] keeping the direction, so there is no jump at the edge and
 * full deflection still reaches 1 (and never exceeds it). Writes into `out`.
 */
export function radialDeadzone(x: number, y: number, dz: number, out: { x: number; y: number }): void {
  const mag = Math.hypot(x, y);
  if (!(mag > dz)) {
    out.x = 0;
    out.y = 0;
    return;
  }
  const scaled = Math.min(1, (mag - dz) / (1 - dz));
  out.x = (x / mag) * scaled;
  out.y = (y / mag) * scaled;
}

/** Move derived from a pad: −1..1, x right, y UP (screen-relative), magnitude ≤ 1. */
export interface PadMove {
  moveX: number;
  moveY: number;
}

const tmpStick = { x: 0, y: 0 };

/**
 * Snapshot → move. Left stick with a radial dead zone + linear rescale (direction preserved, so
 * diagonals stay true — same response as the touch joystick); the D-pad overrides with full-speed
 * digital directions (normalised on diagonals).
 */
export function padMove(snap: PadSnapshot, out: PadMove): void {
  const b = snap.buttons;
  const dx = ((b & PB.RIGHT) !== 0 ? 1 : 0) - ((b & PB.LEFT) !== 0 ? 1 : 0);
  const dy = ((b & PB.UP) !== 0 ? 1 : 0) - ((b & PB.DOWN) !== 0 ? 1 : 0);
  if (dx !== 0 || dy !== 0) {
    const inv = dx !== 0 && dy !== 0 ? Math.SQRT1_2 : 1;
    out.moveX = dx * inv;
    out.moveY = dy * inv;
    return;
  }
  radialDeadzone(snap.lx, snap.ly, STICK_DEADZONE, tmpStick);
  out.moveX = tmpStick.x;
  out.moveY = tmpStick.y === 0 ? 0 : -tmpStick.y; // pads report +y down
}

/** Slot bits used for latching (see gamepadInput.ts). */
export const SLOT_PRIMARY = 1;
export const SLOT_SECONDARY = 2;
export const SLOT_ALT = 4;
/** Not a slot: carries R2's hysteresis state from one poll to the next. */
export const SLOT_ALT_TRIGGER = 8;

/**
 * Raw slot mask from a snapshot: primary = bottom face (✕/A), secondary = right or left face
 * (○/B, □/X), alt = R2 past the trigger threshold (L1/R1 are prev/next, see gamepadInput.ts). `altTriggerHeld` is the hysteresis state
 * of R2 from the previous poll; the new state is returned in bit SLOT_ALT_TRIGGER.
 */
export function padSlots(snap: PadSnapshot, altTriggerHeld: boolean): number {
  const b = snap.buttons;
  const trig = altTriggerHeld ? snap.r2 >= TRIGGER_RELEASE : snap.r2 >= TRIGGER_PRESS;
  let m = 0;
  if (b & PB.SOUTH) m |= SLOT_PRIMARY;
  if (b & (PB.EAST | PB.WEST)) m |= SLOT_SECONDARY;
  if (trig) m |= SLOT_ALT;
  if (trig) m |= SLOT_ALT_TRIGGER;
  return m;
}

/** Menu direction from a snapshot: D-pad wins over the stick; null when centred. */
export function menuDirection(buttons: number): 'up' | 'down' | 'left' | 'right' | null {
  if (buttons & PB.UP) return 'up';
  if (buttons & PB.DOWN) return 'down';
  if (buttons & PB.LEFT) return 'left';
  if (buttons & PB.RIGHT) return 'right';
  if (buttons & PB.STICK_UP) return 'up';
  if (buttons & PB.STICK_DOWN) return 'down';
  if (buttons & PB.STICK_LEFT) return 'left';
  if (buttons & PB.STICK_RIGHT) return 'right';
  return null;
}
