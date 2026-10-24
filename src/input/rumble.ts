// Controller rumble + phone vibration profiles, and the anti-spam gate. Every browser API
// call is guarded: the Gamepad haptics API differs between Chrome/Edge/Safari
// (vibrationActuator.playEffect), Firefox (hapticActuators[i].pulse) and is missing entirely
// on many platforms. (Adapted from Trash Panda.)
import type { GamepadLike, HapticActuatorLike } from './gamepad';
import type { RumbleKind } from './types';

export interface RumbleProfile {
  /** Gamepad effect duration (ms). */
  duration: number;
  /** Low-frequency (heavy) motor 0..1. */
  strong: number;
  /** High-frequency (buzzy) motor 0..1. */
  weak: number;
  /** navigator.vibrate() pattern for phones — kept short, phone motors are harsh. */
  vibrate: number | readonly number[];
  /** Higher interrupts lower; equal or lower is dropped while a stronger one plays. */
  priority: number;
}

export const RUMBLE_PROFILES: Readonly<Record<RumbleKind, Readonly<RumbleProfile>>> = Object.freeze({
  /** Pickups, bonus stars, a clean hurdle: a tick. */
  light: Object.freeze({ duration: 70, strong: 0.08, weak: 0.45, vibrate: 12, priority: 1 }),
  /** Ball contact, a kick, a stumble. */
  medium: Object.freeze({ duration: 150, strong: 0.45, weak: 0.6, vibrate: 28, priority: 2 }),
  /** A flop into the foam, a big hit. */
  heavy: Object.freeze({ duration: 320, strong: 1, weak: 0.75, vibrate: [60, 40, 90], priority: 3 }),
  /** Touchdown / basket / home run / goal: a celebratory buzz. */
  score: Object.freeze({ duration: 460, strong: 0.55, weak: 1, vibrate: [30, 50, 30, 50, 70], priority: 3 }),
});

/** Minimum gap between two rumbles of equal or lower priority (ms). */
export const RUMBLE_MIN_INTERVAL = 90;

/**
 * Anti-spam gate: an event that fires rumble('light') every frame (e.g. while dribbling) must not
 * re-trigger the motors 60×/s, and a light tick must not cut a heavy hit short.
 *  • Within RUMBLE_MIN_INTERVAL of the last rumble, only a HIGHER priority kind gets through.
 *  • While a rumble is still playing, a LOWER priority kind is dropped.
 */
export class RumbleGate {
  private lastAt = -Infinity;
  private until = -Infinity;
  private lastPriority = 0;

  allow(p: Readonly<RumbleProfile>, now: number): boolean {
    if (now - this.lastAt < RUMBLE_MIN_INTERVAL && p.priority <= this.lastPriority) return false;
    if (now < this.until && p.priority < this.lastPriority) return false;
    this.lastAt = now;
    this.until = now + p.duration;
    this.lastPriority = p.priority;
    return true;
  }

  reset(): void {
    this.lastAt = -Infinity;
    this.until = -Infinity;
    this.lastPriority = 0;
  }
}

const noop = (): void => {};

/** Swallow async rejections (e.g. "NotAllowedError" before a user gesture) so they never surface as page errors. */
function quiet(result: unknown): void {
  if (result !== null && typeof result === 'object' && typeof (result as { catch?: unknown }).catch === 'function') {
    (result as Promise<unknown>).catch(noop);
  }
}

// Reused parameter object for playEffect (avoids an allocation per rumble).
const effectParams: Record<string, number> = { startDelay: 0, duration: 0, weakMagnitude: 0, strongMagnitude: 0 };

function tryActuator(act: HapticActuatorLike | null | undefined, p: Readonly<RumbleProfile>): boolean {
  if (!act) return false;
  try {
    if (typeof act.playEffect === 'function') {
      effectParams.duration = p.duration;
      effectParams.weakMagnitude = p.weak;
      effectParams.strongMagnitude = p.strong;
      quiet(act.playEffect('dual-rumble', effectParams));
      return true;
    }
    if (typeof act.pulse === 'function') {
      quiet(act.pulse(Math.max(p.strong, p.weak), p.duration));
      return true;
    }
  } catch {
    // Unsupported effect type / detached pad: ignore.
  }
  return false;
}

/** Rumble a pad. Returns true if some haptics API accepted the request. */
export function playPadRumble(pad: GamepadLike | null | undefined, p: Readonly<RumbleProfile>): boolean {
  if (!pad) return false;
  try {
    if (tryActuator(pad.vibrationActuator, p)) return true;
    const list = pad.hapticActuators;
    if (list && list.length > 0) return tryActuator(list[0], p);
  } catch {
    // Accessing actuators can throw on some implementations.
  }
  return false;
}

/** Phone vibration via navigator.vibrate (Android Chrome/Firefox; absent on iOS). */
export function playDeviceVibration(nav: Navigator | null, p: Readonly<RumbleProfile>): boolean {
  if (!nav) return false;
  try {
    const vib = (nav as { vibrate?: (pattern: number | number[]) => boolean }).vibrate;
    if (typeof vib !== 'function') return false;
    // The DOM typing wants a mutable array; the pattern is never mutated by the browser.
    return vib.call(nav, p.vibrate as number | number[]);
  } catch {
    return false;
  }
}
