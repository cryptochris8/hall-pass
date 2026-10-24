// Action-slot edge state — PURE (no DOM). One SlotState per GameControls slot
// (primary / secondary / alt), fed by every device.
//
// Semantics (docs/GDD.md §13, src/input/types.ts):
//  • held      — the slot is down now, OR it went down at any moment since the previous update()
//                (a tap shorter than one frame is still held for exactly that one frame).
//  • pressed   — the slot went from "nobody holds it" to "somebody holds it" since the previous update().
//  • released  — the slot went from held to not held since the previous update().
//  A press AND release inside the same frame reports pressed = released = held = true on that one
//  frame — a quick tap is never lost (hoops / baseball timing). Consumers must therefore handle
//  `pressed` before `released` and must not chain them with `else if`.
//
// Devices are tracked as a bitmask of holders, so the same slot held on the keyboard AND the pad
// is one continuous hold (no phantom release when one of them lets go), and every set() is
// idempotent — a source may report its current level every frame (the pad does) or only on
// change (keyboard / touch do).

export type ActionSlot = 'primary' | 'secondary' | 'alt';
export const ACTION_SLOTS: readonly ActionSlot[] = ['primary', 'secondary', 'alt'];

/** Holder bits. */
export const SRC_KEYBOARD = 1;
export const SRC_TOUCH = 2;
export const SRC_PAD = 4;

export interface SlotFrame {
  held: boolean;
  pressed: boolean;
  released: boolean;
}

export class SlotState {
  private holders = 0;
  private pressedFlag = false;
  private releasedFlag = false;

  /** Source `src` (a SRC_* bit) now holds (`down`) or no longer holds the slot. Idempotent. */
  set(src: number, down: boolean): void {
    const before = this.holders;
    const after = down ? before | src : before & ~src;
    if (after === before) return;
    this.holders = after;
    if (before === 0) this.pressedFlag = true;
    else if (after === 0) this.releasedFlag = true;
  }

  /** Physically held right now (by any source). */
  get isHeld(): boolean {
    return this.holders !== 0;
  }

  /** Write this frame's values and start a new frame (clears the edges). Allocation-free. */
  roll(out: SlotFrame): void {
    out.held = this.holders !== 0 || this.pressedFlag;
    out.pressed = this.pressedFlag;
    out.released = this.releasedFlag;
    this.pressedFlag = false;
    this.releasedFlag = false;
  }

  /** Forget holders and edges (mode switch, reset) — no release edge is reported. */
  clear(): void {
    this.holders = 0;
    this.pressedFlag = false;
    this.releasedFlag = false;
  }
}
