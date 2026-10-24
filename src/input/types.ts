// ─────────────────────────────────────────────────────────────────────────────
// INPUT CONTRACT — keyboard, gamepad (Gamepad API, standard mapping incl. PS4
// DualShock) and touch → GameControls (gameplay) + MenuActions (UI).
// Owns the on-screen touch overlay, whose buttons are configured per event by a
// ControlScheme. The SAME three action slots are used by every event:
//   primary   — Space / J        · Cross (A)            · big touch button
//   secondary — E / K            · Circle (B) or Square · small touch button
//   alt       — Shift / L        · R2                   · small touch button (usually hold)
//   prev/next — Q / R            · L1 / R1              · (touch: tap the activity's own portraits)
//   move      — WASD / arrows    · left stick / D-pad   · virtual joystick
//   pause     — Esc / P          · Options / Start      · pause button (UI)
// EVENT AUTHORS: a tap shorter than one frame reports pressed AND released on the SAME frame.
// Handle `*Pressed` before `*Released` and never chain them with `else if`, or quick taps are lost.
// Owner: input module. FROZEN shared contract.
// ─────────────────────────────────────────────────────────────────────────────

export type InputDevice = 'keyboard' | 'touch' | 'gamepad';
export type PadStyle = 'playstation' | 'xbox' | 'nintendo' | 'generic';

/** Edge-triggered UI navigation. Held directions auto-repeat. */
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'next' | 'prev' | 'confirm' | 'back' | 'pause' | 'mute';

export type InputMode = 'menu' | 'gameplay';

export type RumbleKind = 'light' | 'medium' | 'heavy' | 'score';

export interface GamepadInfo {
  connected: boolean;
  id: string;
  style: PadStyle;
}

/** Gameplay input for one frame. */
export interface GameControls {
  /** −1..1, x = right, y = UP on screen / forward. Analog from sticks/joystick, magnitude ≤ 1, dead zone applied. */
  moveX: number;
  moveY: number;
  /** Held this frame. */
  primary: boolean;
  /** Edge: went down since the previous update() (exactly one frame per press). */
  primaryPressed: boolean;
  /** Edge: went up since the previous update(). */
  primaryReleased: boolean;
  secondary: boolean;
  secondaryPressed: boolean;
  secondaryReleased: boolean;
  alt: boolean;
  altPressed: boolean;
  altReleased: boolean;
  /** Edge: switch to the previous / next target (girl to brush, item…). Q / R · L1 / R1. */
  prevPressed: boolean;
  nextPressed: boolean;
}

export const NO_CONTROLS: Readonly<GameControls> = Object.freeze({
  moveX: 0,
  moveY: 0,
  primary: false,
  primaryPressed: false,
  primaryReleased: false,
  secondary: false,
  secondaryPressed: false,
  secondaryReleased: false,
  alt: false,
  altPressed: false,
  altReleased: false,
  prevPressed: false,
  nextPressed: false,
});

/** Icons the touch buttons + prompts can show (drawn as inline SVG by input/ui). */
export type ControlIcon =
  | 'go' // generic "do it" (fallback)
  | 'hand' // interact / pick up / open
  | 'whistle' // call the dog
  | 'treat' // shake the treat bag
  | 'brush' // press the brush into the hair
  | 'pass' // pass the black brush
  | 'done' // "I'm done" / finish
  | 'pour' // pour / brew / fill
  | 'toss' // throw the bag into the bin
  | 'catch' // save the falling item
  | 'drop' // put down
  | 'rinse' // rinse a dish
  | 'music' // wake-up song beat
  | 'run' // hurry / jog
  | 'gas' // drive forward
  | 'brake' // slow down / stop
  | 'honk'; // friendly beep

export interface ButtonSpec {
  /** Short upper-case label, e.g. 'JUMP', 'SHOOT', 'SWING'. */
  label: string;
  icon: ControlIcon;
  /** Button is meant to be HELD (shows a hold hint / fill ring on touch). */
  hold?: boolean;
}

/** Per-event control layout. Drives the touch overlay AND the glyph prompts in the HUD. */
export interface ControlScheme {
  /** Joystick visibility + axes: 'none' hides it, 'x' = horizontal only, 'xy' = full. */
  move: 'none' | 'x' | 'xy';
  /** What the stick does, for prompts: 'MOVE', 'STEER', 'AIM'. */
  moveLabel: string;
  primary: ButtonSpec | null;
  secondary: ButtonSpec | null;
  alt: ButtonSpec | null;
}

export interface InputManager {
  /** Poll gamepads and roll edge state. Call exactly once per animation frame, before reading. */
  update(dt: number): void;
  /** Gameplay controls for this frame (NO_CONTROLS-equivalent in 'menu' mode). */
  getControls(): GameControls;
  /** Menu actions since the previous update() (includes 'pause' / 'mute' in gameplay mode too). */
  getMenuActions(): readonly MenuAction[];
  /**
   * 'menu': arrows/WASD/D-pad/stick → MenuActions, Space/Enter/Cross → 'confirm', Esc/Backspace/Circle → 'back';
   *         touch overlay hidden.
   * 'gameplay': produce GameControls; Esc/P/Options → 'pause', M → 'mute'; touch overlay shown (touch devices).
   */
  setMode(mode: InputMode): void;
  readonly mode: InputMode;
  /** Configure the touch overlay (joystick + up to 3 buttons) for the current event. */
  setScheme(scheme: ControlScheme | null): void;
  /** Device the player used most recently (drives glyph prompts). */
  readonly lastDevice: InputDevice;
  onDeviceChange(cb: (device: InputDevice) => void): () => void;
  gamepad(): GamepadInfo;
  onGamepadConnection(cb: (connected: boolean, info: GamepadInfo) => void): () => void;
  rumble(kind: RumbleKind): void;
  setVibrationEnabled(on: boolean): void;
  /** 'auto' shows the touch overlay only when the last device was touch. */
  setTouchControls(pref: 'auto' | 'on' | 'off'): void;
  /** Mirror the overlay for left-handed play. */
  setTouchHand(hand: 'right' | 'left'): void;
  /** Called on the first trusted user gesture (audio unlock). */
  onFirstGesture(cb: () => void): () => void;
  /** Release everything (blur, pause, restart) so keys don't stick; clears edges. */
  reset(): void;
  dispose(): void;
}

export interface InputOptions {
  /** Element the touch overlay is appended to (full-screen, above the canvas, below menus). */
  touchRoot: HTMLElement;
  /** Element that receives keyboard events (default: window). */
  keyTarget?: Window | HTMLElement;
}

// ── Pointer (mouse / touch / pen / virtual cursor) — for brushing, pouring, picking ──

export type PointerSource = 'mouse' | 'touch' | 'pen' | 'virtual';

/**
 * Direct pointer input on the game canvas (src/input/pointer.ts, created by the game).
 * Mouse / touch / pen drive it directly. With `virtual` enabled, the gamepad stick / arrow keys move an on-screen
 * cursor and PRIMARY (Space / ✕ / A) is the "button" — so every pointer activity also works on a pad or keyboard.
 * Only while enabled: when disabled, all fields are neutral and nothing is drawn.
 */
export interface PointerInput {
  /** CSS px relative to the canvas. */
  readonly x: number;
  readonly y: number;
  /** Normalised device coords −1..1 (y up) — feed to Raycaster.setFromCamera. */
  readonly ndcX: number;
  readonly ndcY: number;
  /** Button / finger down now. */
  readonly down: boolean;
  /** Edges since the previous update(). A sub-frame tap reports pressed AND released. */
  readonly pressed: boolean;
  readonly released: boolean;
  /** Velocity (CSS px / s) this frame (smoothed a little). */
  readonly vx: number;
  readonly vy: number;
  /** The pointer has a meaningful position (mouse over the canvas, finger down, or virtual). */
  readonly active: boolean;
  readonly source: PointerSource;
  /**
   * Enable pointer mode. `virtual`: 'auto' (default) = the virtual cursor takes over whenever the last device is a
   * gamepad or keyboard; 'off' = mouse/touch only. `cursor`: what the pointer layer draws for the virtual cursor
   * ('ring' default; 'none' when the activity renders its own tool, e.g. the brush). `speed` = virtual cursor speed
   * in screen-heights per second (default 0.9). `hideMouse` hides the OS cursor over the canvas.
   */
  enable(opts?: { virtual?: 'auto' | 'off'; cursor?: 'ring' | 'none'; speed?: number; hideMouse?: boolean }): void;
  disable(): void;
  readonly enabled: boolean;
  /** Move the (virtual) cursor to NDC coords (e.g. the hair ends). */
  warp(ndcX: number, ndcY: number): void;
  /** Call once per frame after input.update(); `controls` feeds the virtual cursor. */
  update(dt: number, controls: GameControls, device: InputDevice): void;
  dispose(): void;
}
