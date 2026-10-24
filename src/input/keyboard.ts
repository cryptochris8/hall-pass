// Keyboard state machine — DOM-free (the manager feeds it key events), so it is
// unit-testable without a browser. (Adapted from Trash Panda.)
//
// Semantics
//  • Movement: opposite keys held → LAST-PRESSED WINS (tap → while holding ← to correct
//    instantly; releasing → falls back to ←). Diagonals are normalised by the manager.
//    A direction tapped between two update() calls still moves for exactly that one frame.
//  • Action slots (primary/secondary/alt): a key only counts if it went down (non-repeat) in
//    GAMEPLAY mode. Keys already held when the mode switches are "latched": they stop counting
//    until released and pressed again (the Space that confirmed a menu never becomes a jump).
//    Slot changes are reported through `onSlot` at event time, so sub-frame taps survive
//    (see slots.ts).
//  • Menu directions: a non-repeat keydown fires once (returned as the MenuAction); while that
//    key stays held, `menuRepeatStep()` repeats it on the MenuRepeat timer (0.35 s, then 0.1 s).
//    OS key-repeat events are ignored entirely.
import { isAxisRole, menuActionFor, slotOfRole, type AxisRole, type KeyRole } from './keymap';
import { MenuRepeat, type MenuDir } from './menuRepeat';
import type { ActionSlot } from './slots';
import type { InputMode, MenuAction } from './types';

const AXES: readonly AxisRole[] = ['left', 'right', 'up', 'down'];

export interface KeySample {
  /** −1..1 digital (right +). */
  x: number;
  /** −1..1 digital (UP +). */
  y: number;
}

export const createKeySample = (): KeySample => ({ x: 0, y: 0 });

interface HeldKey {
  role: KeyRole;
  seq: number;
  /** Counts toward its action slot (pressed in gameplay mode, not latched). */
  counted: boolean;
}

const noop = (): void => {};

export class KeyboardState {
  private readonly held = new Map<string, HeldKey>();
  private readonly count: Record<AxisRole, number> = { left: 0, right: 0, up: 0, down: 0 };
  private readonly lastSeq: Record<AxisRole, number> = { left: 0, right: 0, up: 0, down: 0 };
  private seq = 0;
  private readonly pressedThisFrame = new Set<string>();
  private readonly deferredUp = new Set<string>();
  private readonly slotKeys: Record<ActionSlot, number> = { primary: 0, secondary: 0, alt: 0 };
  private readonly repeat = new MenuRepeat();
  private repeatKey: string | null = null;
  private repeatDir: MenuDir | null = null;

  constructor(private readonly onSlot: (slot: ActionSlot, down: boolean) => void = noop) {}

  /**
   * A mapped key went down. Returns the MenuAction it produces in `mode` (or null).
   * `repeat` = OS auto-repeat; `shift` = Shift held (Shift+Tab → 'prev').
   */
  down(id: string, role: KeyRole, repeat: boolean, mode: InputMode, shift = false): MenuAction | null {
    let h = this.held.get(id);
    if (h === undefined) {
      h = { role, seq: ++this.seq, counted: false };
      this.held.set(id, h);
      if (isAxisRole(role)) {
        this.count[role]++;
        this.lastSeq[role] = h.seq;
      }
      this.pressedThisFrame.add(id);
    } else {
      // Pressed again before a deferred release was applied: it's held after all.
      this.deferredUp.delete(id);
    }

    const slot = slotOfRole(role);
    if (slot !== null && mode === 'gameplay' && !repeat && !h.counted) {
      h.counted = true;
      if (this.slotKeys[slot]++ === 0) this.onSlot(slot, true);
    }
    if (repeat) return null;
    if (mode === 'menu' && isAxisRole(role)) {
      this.repeatKey = id;
      this.repeatDir = role;
      this.repeat.reset();
      this.repeat.step(role, 0); // adopt: the press itself is returned below
    }
    return menuActionFor(role, mode, false, shift);
  }

  /** A key went up. */
  up(id: string): void {
    const h = this.held.get(id);
    if (h === undefined) return;
    if (h.counted) {
      h.counted = false;
      const slot = slotOfRole(h.role);
      if (slot !== null && --this.slotKeys[slot] <= 0) {
        this.slotKeys[slot] = 0;
        this.onSlot(slot, false);
      }
    }
    if (id === this.repeatKey) this.stopRepeat();
    if (isAxisRole(h.role) && this.pressedThisFrame.has(id)) {
      this.deferredUp.add(id);
      return;
    }
    this.release(id);
  }

  private release(id: string): void {
    const h = this.held.get(id);
    if (h === undefined) return;
    this.held.delete(id);
    const role = h.role;
    if (!isAxisRole(role)) return;
    this.count[role] = Math.max(0, this.count[role] - 1);
    let best = 0;
    if (this.count[role] > 0) {
      this.held.forEach((k) => {
        if (k.role === role) best = Math.max(best, k.seq);
      });
    }
    this.lastSeq[role] = best;
  }

  private axis(neg: AxisRole, pos: AxisRole): number {
    const n = this.count[neg] > 0;
    const p = this.count[pos] > 0;
    if (n && p) return this.lastSeq[neg] > this.lastSeq[pos] ? -1 : 1;
    return n ? -1 : p ? 1 : 0;
  }

  /** Digital view of the held direction keys. Allocation-free. */
  sample(out: KeySample): void {
    out.x = this.axis('left', 'right');
    out.y = this.axis('down', 'up');
  }

  /** Menu mode, once per update(): the auto-repeat of the most recently pressed, still-held direction. */
  menuRepeatStep(dt: number): MenuAction | null {
    const id = this.repeatKey;
    if (id === null) return null;
    if (!this.held.has(id) || this.deferredUp.has(id)) {
      this.stopRepeat();
      return null;
    }
    return this.repeat.step(this.repeatDir, dt);
  }

  private stopRepeat(): void {
    this.repeatKey = null;
    this.repeatDir = null;
    this.repeat.reset();
  }

  /** Number of held keys currently counting toward `slot` (tests / debug). */
  slotCount(slot: ActionSlot): number {
    return this.slotKeys[slot];
  }

  /** Call once per update() after sampling: applies deferred releases. */
  endFrame(): void {
    if (this.deferredUp.size > 0) {
      this.deferredUp.forEach(this.releaseBound);
      this.deferredUp.clear();
    }
    if (this.pressedThisFrame.size > 0) this.pressedThisFrame.clear();
  }

  private readonly releaseBound = (id: string): void => this.release(id);

  /**
   * Mode switch: every held action key stops counting until it is released and pressed again,
   * and the menu repeat stops. Held directions stay held (movement is level-based).
   * Does NOT call onSlot — the manager clears its slots itself.
   */
  latchAll(): void {
    this.held.forEach((h) => {
      h.counted = false;
    });
    this.slotKeys.primary = 0;
    this.slotKeys.secondary = 0;
    this.slotKeys.alt = 0;
    this.stopRepeat();
  }

  /** Forget everything (window blur / tab hidden / restart) so no key can stick. No callbacks. */
  reset(): void {
    this.held.clear();
    for (const r of AXES) {
      this.count[r] = 0;
      this.lastSeq[r] = 0;
    }
    this.pressedThisFrame.clear();
    this.deferredUp.clear();
    this.slotKeys.primary = 0;
    this.slotKeys.secondary = 0;
    this.slotKeys.alt = 0;
    this.stopRepeat();
  }
}
