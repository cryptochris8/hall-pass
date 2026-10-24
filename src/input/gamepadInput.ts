// Gamepad polling: tracks every connected pad, follows the MOST RECENTLY ACTIVE one, turns its
// normalised snapshot into move + action-slot levels (gameplay) or auto-repeating MenuActions
// (menus), and detects (dis)connections by polling as well as by events, because
// `gamepadconnected` is unreliable across browsers. (Adapted from Trash Panda.)
//
// Buttons are POSITIONAL on every pad family (bottom face = primary/confirm, right face = back):
// the standard mapping reports positions, so on a Nintendo pad the bottom button is "B" — the
// glyph prompts (bindingLabels) show the right letter per style.
//
// Latching: on a mode switch or reset(), every button/slot already held is LATCHED — it doesn't
// count until released (so the ✕ that confirmed "PLAY" is never a jump, and a stick held while
// a menu opens never scrolls it). Movement stays level-based.
import {
  PB,
  SLOT_ALT,
  SLOT_ALT_TRIGGER,
  SLOT_PRIMARY,
  SLOT_SECONDARY,
  createCalib,
  createSnapshot,
  detectPadStyle,
  menuDirection,
  padMove,
  padSlots,
  readPad,
  resolveLayout,
  type GamepadLike,
  type PadCalib,
  type PadLayout,
  type PadMove,
  type PadSnapshot,
} from './gamepad';
import { MenuRepeat, type MenuDir } from './menuRepeat';
import { playPadRumble, type RumbleProfile } from './rumble';
import type { GamepadInfo, InputMode, MenuAction } from './types';

interface PadTrack extends PadCalib {
  index: number;
  id: string;
  layout: PadLayout;
  info: GamepadInfo;
  snap: PadSnapshot;
  /** Button mask on the previous poll (edge detection). */
  prev: number;
  /** Raw slot mask (+ SLOT_ALT_TRIGGER hysteresis) on the previous poll. */
  slots: number;
  /** Slots held across a mode switch / reset: ignored until released. */
  latch: number;
  /** Latest Gamepad object from getGamepads() (needed for rumble). */
  pad: GamepadLike | null;
  seen: boolean;
}

export interface PadFrame extends PadMove {
  primary: boolean;
  secondary: boolean;
  alt: boolean;
  /** L1 / R1 went down this poll (gameplay only). */
  prevEdge: boolean;
  nextEdge: boolean;
  /** A pad is connected and driving this frame. */
  active: boolean;
}

export const createPadFrame = (): PadFrame => ({
  moveX: 0,
  moveY: 0,
  primary: false,
  secondary: false,
  alt: false,
  prevEdge: false,
  nextEdge: false,
  active: false,
});

export interface GamepadHooks {
  /** The player pressed something / moved a stick on a pad this frame. */
  onActivity(): void;
  /**
   * A pad appeared / went away. `wasActive`: on a disconnect, whether it was the pad driving the
   * game at that moment (an idle second pad powering off must not pause the active player's run).
   */
  onConnection(connected: boolean, info: GamepadInfo, wasActive: boolean): void;
  /** A press on a different connected pad made it the active one (e.g. DS4 → Xbox pad). */
  onActiveChange?(info: GamepadInfo): void;
}

export type GetGamepads = () => ArrayLike<GamepadLike | null | undefined> | null | undefined;

export const NO_GAMEPAD: GamepadInfo = Object.freeze({ connected: false, id: '', style: 'generic' });

/** The three real slot bits (excludes the R2 hysteresis bit). */
const SLOT_MASK = SLOT_PRIMARY | SLOT_SECONDARY | SLOT_ALT;

export class GamepadInput {
  private readonly tracks: PadTrack[] = [];
  private active: PadTrack | null = null;
  private readonly repeat = new MenuRepeat();
  /** Next poll re-syncs edges without firing (after focus loss). */
  private suppressEdges = false;
  /** Menu direction held across a mode switch: ignored until it changes / is released. */
  private dirLatch: MenuDir | null = null;
  /** Latch everything held on the next poll (set by onModeChange / reset). */
  private latchPending = false;
  private polledOnce = false;

  constructor(
    private readonly getPads: GetGamepads,
    private readonly hooks: GamepadHooks,
  ) {}

  /** Poll all pads. Writes the active pad's move + slot levels into `out`; pushes MenuActions into `menu`. */
  poll(dt: number, mode: InputMode, out: PadFrame, menu: MenuAction[]): void {
    let pads: ArrayLike<GamepadLike | null | undefined> | null | undefined = null;
    try {
      pads = this.getPads();
    } catch {
      pads = null; // SecurityError (insecure context / permissions policy) or unsupported
    }

    const tracks = this.tracks;
    for (let i = 0; i < tracks.length; i++) tracks[i]!.seen = false;

    if (pads) {
      for (let i = 0; i < pads.length; i++) {
        const gp = pads[i];
        if (!gp || gp.connected === false) continue;
        let t = this.find(gp.index);
        if (t !== null && t.id !== gp.id) {
          this.drop(t);
          t = null;
        }
        // Pads already present on the very first poll are primed (their held buttons are not
        // presses). Pads appearing later usually appeared *because* of a press (Chrome only
        // exposes a pad after input) — that press counts, so one press can start the game.
        // Exception: non-standard 'generic' devices are always primed (odd HID gear may report
        // buttons stuck down).
        if (t === null) t = this.add(gp, !this.polledOnce);
        t.seen = true;
        t.pad = gp;
        readPad(gp, t.layout, t.snap, t);
      }
      // Pads that vanished from the list are gone (disconnect events are unreliable).
      for (let i = tracks.length - 1; i >= 0; i--) {
        const t = tracks[i]!;
        if (!t.seen) this.drop(t);
      }
    }

    // Raw slot levels (with R2 hysteresis) for every pad.
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i]!;
      if (!t.seen) continue;
      t.slots = padSlots(t.snap, (t.slots & SLOT_ALT_TRIGGER) !== 0);
      if (this.latchPending) t.latch = t.slots & SLOT_MASK;
      else t.latch &= t.slots; // a latched slot unlatches once released
    }

    // Follow the pad that was touched most recently.
    let activity = false;
    let switched = false;
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i]!;
      if (!t.seen) continue;
      const pressed = t.snap.buttons & ~t.prev;
      if (pressed !== 0 && !this.suppressEdges) {
        if (this.active !== t) {
          switched = this.active !== null;
          this.active = t;
          this.repeat.reset();
          this.dirLatch = null;
        }
        activity = true;
      }
    }
    if (this.active === null && tracks.length > 0) this.active = tracks[0]!;

    const a = this.active;
    out.primary = false;
    out.secondary = false;
    out.alt = false;
    out.prevEdge = false;
    out.nextEdge = false;
    if (a === null || !a.seen) {
      out.moveX = 0;
      out.moveY = 0;
      out.active = false;
      if (this.latchPending) this.dirLatch = null;
    } else {
      out.active = true;
      padMove(a.snap, out);
      const now = a.snap.buttons;
      const edge = this.suppressEdges ? 0 : now & ~a.prev;
      if (this.latchPending) this.dirLatch = menuDirection(now);
      if (mode === 'gameplay') {
        const eff = a.slots & ~a.latch;
        out.primary = (eff & SLOT_PRIMARY) !== 0;
        out.secondary = (eff & SLOT_SECONDARY) !== 0;
        out.alt = (eff & SLOT_ALT) !== 0;
        if (edge & PB.L1) out.prevEdge = true;
        if (edge & PB.R1) out.nextEdge = true;
        if (edge & PB.START) menu.push('pause');
      } else {
        let dir = menuDirection(now);
        if (this.dirLatch !== null) {
          if (dir === this.dirLatch) dir = null;
          else this.dirLatch = null;
        }
        const emit = this.repeat.step(dir, dt);
        if (emit !== null) menu.push(emit);
        if (edge & PB.SOUTH) menu.push('confirm');
        if (edge & PB.EAST) menu.push('back');
        if (edge & PB.L1) menu.push('prev');
        if (edge & PB.R1) menu.push('next');
        if (edge & PB.START) menu.push('pause');
      }
    }

    for (let i = 0; i < tracks.length; i++) tracks[i]!.prev = tracks[i]!.snap.buttons;
    this.suppressEdges = false;
    this.latchPending = false;
    this.polledOnce = true;
    if (switched && this.active !== null) {
      const info = this.active.info;
      const cb = this.hooks.onActiveChange;
      if (cb) safeCall(() => cb(info));
    }
    if (activity) this.hooks.onActivity();
  }

  /** `gamepadconnected` event. */
  handleConnected(gp: GamepadLike | null | undefined): void {
    if (!gp) return;
    const t = this.find(gp.index);
    if (t !== null && t.id === gp.id) return;
    if (t !== null) this.drop(t);
    this.add(gp, false);
  }

  /** `gamepaddisconnected` event. */
  handleDisconnected(gp: GamepadLike | null | undefined): void {
    if (!gp) return;
    const t = this.find(gp.index);
    if (t !== null) this.drop(t);
  }

  info(): GamepadInfo {
    return this.active !== null ? this.active.info : NO_GAMEPAD;
  }

  /** Dev/debug view of the active pad. */
  debug(): { layout: PadLayout; snap: Readonly<PadSnapshot>; index: number } | null {
    const a = this.active;
    return a === null ? null : { layout: a.layout, snap: a.snap, index: a.index };
  }

  rumble(p: Readonly<RumbleProfile>): boolean {
    return this.active !== null && playPadRumble(this.active.pad, p);
  }

  /**
   * Mode switched: whatever was held at the last poll (i.e. at switch time) is latched until
   * released. A button pressed AFTER the switch is a real press and is not latched.
   */
  onModeChange(): void {
    this.repeat.reset();
    for (let i = 0; i < this.tracks.length; i++) {
      const t = this.tracks[i]!;
      t.latch = t.slots & SLOT_MASK;
    }
    const a = this.active;
    this.dirLatch = a !== null ? menuDirection(a.snap.buttons) : null;
  }

  /**
   * Focus lost / restart: forget repeat state; on the next poll (after focus returns — the pad may
   * have changed while unfocused) latch whatever is held and don't treat it as new presses.
   */
  reset(): void {
    this.repeat.reset();
    this.suppressEdges = true;
    this.latchPending = true;
  }

  get connectedCount(): number {
    return this.tracks.length;
  }

  private find(index: number): PadTrack | null {
    for (let i = 0; i < this.tracks.length; i++) if (this.tracks[i]!.index === index) return this.tracks[i]!;
    return null;
  }

  private add(gp: GamepadLike, primed: boolean): PadTrack {
    const info: GamepadInfo = Object.freeze({ connected: true, id: gp.id, style: detectPadStyle(gp.id) });
    const layout = resolveLayout(gp);
    const t: PadTrack = {
      index: gp.index,
      id: gp.id,
      layout,
      info,
      snap: createSnapshot(),
      prev: 0,
      slots: 0,
      latch: 0,
      pad: gp,
      seen: true,
      ...createCalib(),
    };
    if (primed || layout === 'generic') {
      readPad(gp, t.layout, t.snap, t);
      t.prev = t.snap.buttons;
      t.slots = padSlots(t.snap, false);
      t.latch = t.slots & SLOT_MASK;
    }
    this.tracks.push(t);
    if (this.active === null) this.active = t;
    safeCall(() => this.hooks.onConnection(true, info, this.active === t));
    return t;
  }

  private drop(t: PadTrack): void {
    const i = this.tracks.indexOf(t);
    if (i < 0) return;
    this.tracks.splice(i, 1);
    // Captured BEFORE another pad is picked: listeners must know whether the player's pad went.
    const wasActive = this.active === t;
    if (wasActive) {
      this.active = this.tracks[0] ?? null;
      this.repeat.reset();
      this.dirLatch = null;
    }
    const info: GamepadInfo = Object.freeze({ connected: false, id: t.id, style: t.info.style });
    safeCall(() => this.hooks.onConnection(false, info, wasActive));
  }
}

function safeCall(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    // A listener bug must not break input polling.
    console.warn('[input] listener threw', e);
  }
}
