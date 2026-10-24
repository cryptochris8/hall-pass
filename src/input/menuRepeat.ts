// Auto-repeat for held menu directions (keyboard arrows/WASD, gamepad D-pad / stick).
// Classic console feel: fire on press, wait `delay`, then fire every `interval` while held.
// Changing direction fires immediately and restarts the delay. (Adapted from Trash Panda.)

export type MenuDir = 'up' | 'down' | 'left' | 'right';

export const MENU_REPEAT_DELAY = 0.35;
export const MENU_REPEAT_INTERVAL = 0.1;

/** Tiny tolerance so accumulated float dt (e.g. 35 × 0.01) still fires on the exact boundary. */
const EPS = 1e-6;

export class MenuRepeat {
  private dir: MenuDir | null = null;
  private held = 0;
  private nextAt = 0;

  constructor(
    private readonly delay: number = MENU_REPEAT_DELAY,
    private readonly interval: number = MENU_REPEAT_INTERVAL,
  ) {}

  /**
   * Advance by `dt` seconds with the currently held direction (null = none).
   * Returns the direction to emit this frame, or null. Emits at most once per call.
   */
  step(dir: MenuDir | null, dt: number): MenuDir | null {
    if (dir === null) {
      this.dir = null;
      return null;
    }
    if (dir !== this.dir) {
      this.dir = dir;
      this.held = 0;
      this.nextAt = this.delay;
      return dir;
    }
    this.held += Math.max(0, dt);
    if (this.held + EPS >= this.nextAt) {
      // A long frame that skipped several ticks must not burst: schedule from now.
      this.nextAt = Math.max(this.nextAt + this.interval, this.held + this.interval * 0.5);
      return dir;
    }
    return null;
  }

  reset(): void {
    this.dir = null;
    this.held = 0;
    this.nextAt = 0;
  }
}
