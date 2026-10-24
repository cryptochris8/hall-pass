// InputManager implementation. `createInput()` (index.ts) calls this with the real browser
// environment; tests inject a fake `InputEnv` (gamepads, clock, trust checks). (Adapted from Trash Panda.)
//
// Frame contract
//  • update(dt) once per animation frame, then read getControls() / getMenuActions().
//  • getControls() returns the SAME GameControls object every frame (allocation-free) — valid
//    until the next update(); copy it to keep it. getMenuActions() likewise reuses one array.
//  • 'menu' mode: controls are neutral (NO_CONTROLS values); keys/pad produce MenuActions.
//    'gameplay' mode: controls live; only 'pause' (Esc / P / Options) and 'mute' (M) arrive as MenuActions.
//  • Action slots (primary / secondary / alt): see slots.ts for the edge semantics — a tap shorter
//    than a frame reports held + pressed + released on the same frame.
//  • setMode() releases everything held: action keys/buttons held across the switch are latched
//    (ignored until released and pressed again), queued edges are dropped, the touch overlay
//    releases, a held pad direction won't scroll the new menu. Held movement keys/sticks keep moving.
//
// Combining devices: the move vector comes from whichever source is deflected the most (keyboard,
// touch stick, pad) — never a sum, so a resting stick's residue can't drift while keys are used.
// Action slots are OR-ed across devices (one continuous hold even when devices overlap).
import { GamepadInput, createPadFrame, type GetGamepads } from './gamepadInput';
import type { GamepadLike, PadLayout, PadSnapshot } from './gamepad';
import { KeyboardState, createKeySample } from './keyboard';
import { allowedWhileTyping, keyId, keyRole } from './keymap';
import { RUMBLE_PROFILES, RumbleGate, playDeviceVibration } from './rumble';
import { ACTION_SLOTS, SRC_KEYBOARD, SRC_PAD, SRC_TOUCH, SlotState, type ActionSlot, type SlotFrame } from './slots';
import { TouchOverlay, type TouchSample } from './touch';
import type {
  ControlScheme,
  GameControls,
  GamepadInfo,
  InputDevice,
  InputManager,
  InputMode,
  InputOptions,
  MenuAction,
  RumbleKind,
} from './types';

/** Everything the manager needs from the outside world (injectable for tests). */
export interface InputEnv {
  win: Window;
  doc: Document;
  nav: Navigator | null;
  getGamepads: GetGamepads;
  /** Only trusted (real user) events count as the audio-unlocking first gesture. Tests pass false. */
  requireTrustedGesture: boolean;
  /** Initial `lastDevice` guess: a phone/tablet starts as 'touch'. */
  prefersTouch: boolean;
  /** Clock in ms (rumble anti-spam). */
  now: () => number;
}

export function browserEnv(win: Window = window): InputEnv {
  const nav = typeof win.navigator !== 'undefined' ? win.navigator : null;
  let prefersTouch = false;
  try {
    prefersTouch =
      typeof win.matchMedia === 'function' &&
      win.matchMedia('(pointer: coarse)').matches &&
      !win.matchMedia('(hover: hover)').matches;
  } catch {
    prefersTouch = false;
  }
  const perf = typeof win.performance !== 'undefined' ? win.performance : null;
  return {
    win,
    doc: win.document,
    nav,
    // DOM's Gamepad is structurally a GamepadLike; the cast only bridges lib.dom's stricter
    // haptics signature (playEffect's enum-typed first parameter).
    getGamepads: () =>
      nav !== null && typeof nav.getGamepads === 'function'
        ? (nav.getGamepads() as unknown as ArrayLike<GamepadLike | null>)
        : null,
    requireTrustedGesture: true,
    prefersTouch,
    now: () => (perf !== null ? perf.now() : Date.now()),
  };
}

/**
 * Gamepad (dis)connection listener. The third argument goes beyond the frozen contract signature
 * (callers typed against InputManager may simply ignore it): on a disconnect, whether that pad
 * was the ACTIVE one — the pad the player was using. Pause only in that case.
 */
export type GamepadConnectionListener = (connected: boolean, info: GamepadInfo, wasActive?: boolean) => void;

/** Extra, non-contract surface used by the dev page and tests. */
export interface InputManagerInternal extends InputManager {
  debugPad(): { layout: PadLayout; snap: Readonly<PadSnapshot>; index: number } | null;
  /** Dev page: rumble the active pad AND vibrate the phone regardless of lastDevice (honours the toggle, not the gate). */
  rumbleTest(kind: RumbleKind): { pad: boolean; vibrate: boolean };
  readonly touchOverlay: TouchOverlay;
  readonly touchVisible: boolean;
  readonly scheme: ControlScheme | null;
}

const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn', 'FnLock']);
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file', 'image']);
/**
 * Events that grant user activation (HTML "activation-triggering input events"), i.e. the only
 * moments a browser lets audio start. Deliberately NOT pointerdown/touchstart: a touch pointerdown
 * does not grant activation (see src/game/audioUnlock.ts).
 */
export const GESTURE_EVENTS = ['keydown', 'pointerup', 'touchend', 'click'] as const;
/** Upper bound on queued MenuActions between frames (e.g. while rAF is throttled). */
const MAX_MENU_QUEUE = 32;

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
}

function safeCall(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.warn('[input] listener threw', e);
  }
}

export function createInputManager(opts: InputOptions, env: InputEnv): InputManagerInternal {
  const { win, doc } = env;
  const keyTarget: Window | HTMLElement = opts.keyTarget ?? win;

  const controls: GameControls = {
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
  };
  /** Q / R pressed (gameplay) since the previous update(). */
  let kbPrev = false;
  let kbNext = false;
  const menuPending: MenuAction[] = [];
  const menuOut: MenuAction[] = [];
  const slots: Record<ActionSlot, SlotState> = {
    primary: new SlotState(),
    secondary: new SlotState(),
    alt: new SlotState(),
  };
  const slotF: SlotFrame = { held: false, pressed: false, released: false };
  const kb = new KeyboardState((slot, down) => slots[slot].set(SRC_KEYBOARD, down));
  const kbS = createKeySample();
  const touchS: TouchSample = { x: 0, y: 0 };
  const padF = createPadFrame();
  const gate = new RumbleGate();

  let mode: InputMode = 'menu';
  let scheme: ControlScheme | null = null;
  let lastDevice: InputDevice = env.prefersTouch ? 'touch' : 'keyboard';
  let touchPref: 'auto' | 'on' | 'off' = 'auto';
  let vibrationEnabled = true;
  let gestured = false;
  let disposed = false;

  const deviceListeners = new Set<(d: InputDevice) => void>();
  const connectionListeners = new Set<GamepadConnectionListener>();
  const gestureListeners = new Set<() => void>();

  const touch = new TouchOverlay(opts.touchRoot, {
    // Buttons only respond while the overlay is visible (gameplay); a release is always honoured.
    onButton: (slot, down) => slots[slot].set(SRC_TOUCH, down && mode === 'gameplay'),
  });
  const pads = new GamepadInput(env.getGamepads, {
    onActivity: () => setDevice('gamepad'),
    // Same device kind, different pad (DS4 → Xbox): the glyph style changed, so tell listeners.
    onActiveChange: () => {
      if (lastDevice === 'gamepad') deviceListeners.forEach((cb) => safeCall(() => cb('gamepad')));
    },
    onConnection: (connected, info, wasActive) => {
      connectionListeners.forEach((cb) => safeCall(() => cb(connected, info, wasActive)));
      // The last pad is gone: prompts fall back to the keyboard (or touch) instead of showing
      // buttons of a controller that isn't there. The next pad press switches straight back.
      if (!connected && pads.connectedCount === 0 && lastDevice === 'gamepad') {
        setDevice(env.prefersTouch ? 'touch' : 'keyboard');
      }
    },
  });

  function setDevice(d: InputDevice): void {
    if (d === lastDevice) return;
    lastDevice = d;
    refreshTouchVisibility();
    deviceListeners.forEach((cb) => safeCall(() => cb(d)));
  }

  function refreshTouchVisibility(): void {
    const allowed = touchPref === 'on' || (touchPref === 'auto' && lastDevice === 'touch');
    touch.setVisible(!disposed && mode === 'gameplay' && scheme !== null && allowed);
  }

  function pushMenu(a: MenuAction): void {
    if (menuPending.length < MAX_MENU_QUEUE) menuPending.push(a);
  }

  function clearSlots(): void {
    for (const s of ACTION_SLOTS) slots[s].clear();
  }

  function neutral(): void {
    controls.moveX = 0;
    controls.moveY = 0;
    controls.primary = false;
    controls.primaryPressed = false;
    controls.primaryReleased = false;
    controls.secondary = false;
    controls.secondaryPressed = false;
    controls.secondaryReleased = false;
    controls.alt = false;
    controls.altPressed = false;
    controls.altReleased = false;
    controls.prevPressed = false;
    controls.nextPressed = false;
    kbPrev = false;
    kbNext = false;
  }

  // ── DOM listeners ────────────────────────────────────────────────────────

  const onKeyDown = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    if (e.isComposing) return;
    const code = e.code ?? '';
    const key = e.key ?? '';
    const role = keyRole(code, key);
    if (!MODIFIER_KEYS.has(key) || role !== null) setDevice('keyboard');
    if (role === null) return;
    // Leave browser/OS shortcuts (Ctrl+R, Cmd+W, Alt+←, Ctrl+Tab…) alone. Shift is a game key (alt).
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (isEditable(e.target) && !allowedWhileTyping(role)) return;
    e.preventDefault();
    if (role === 'prevTab' || role === 'nextTab') {
      if (!e.repeat) {
        if (mode === 'gameplay') {
          if (role === 'prevTab') kbPrev = true;
          else kbNext = true;
        } else pushMenu(role === 'prevTab' ? 'prev' : 'next'); // menus: Q / R switch tabs (like L1 / R1)
      }
      return;
    }
    const action = kb.down(keyId(code, key), role, e.repeat, mode, e.shiftKey);
    if (action !== null) pushMenu(action);
  };

  const onKeyUp = (ev: Event): void => {
    const e = ev as KeyboardEvent;
    const code = e.code ?? '';
    const key = e.key ?? '';
    const role = keyRole(code, key);
    if (role === null) return;
    // Always release (even with modifiers held) so nothing sticks.
    kb.up(keyId(code, key));
    if (!(e.ctrlKey || e.altKey || e.metaKey) && !isEditable(e.target)) e.preventDefault();
  };

  const onPointerDown = (ev: Event): void => {
    const t = (ev as PointerEvent).pointerType;
    if (t === 'touch' || t === 'pen') setDevice('touch');
    else if (t === 'mouse') setDevice('keyboard');
  };

  const onGesture = (ev: Event): void => {
    if (env.requireTrustedGesture && !ev.isTrusted) return;
    if (ev.type === 'keydown') {
      const k = (ev as KeyboardEvent).key;
      // Escape and bare modifiers do not grant user activation in Chromium.
      if (k === 'Escape' || k === 'Esc' || MODIFIER_KEYS.has(k)) return;
    }
    // Where the browser tells us, wait for an event that actually carries activation — otherwise an
    // AudioContext.resume() inside the callback would silently fail.
    const ua = (env.nav as { userActivation?: { isActive: boolean } } | null)?.userActivation;
    if (ua && ua.isActive === false) return;
    gestured = true;
    if (gestureListeners.size === 0) return;
    const cbs = Array.from(gestureListeners);
    gestureListeners.clear();
    for (const cb of cbs) safeCall(cb);
  };

  const onBlur = (): void => api.reset();
  const onVisibility = (): void => {
    if (doc.hidden) api.reset();
  };
  const onPadConnected = (ev: Event): void => pads.handleConnected((ev as GamepadEvent).gamepad as unknown as GamepadLike);
  const onPadDisconnected = (ev: Event): void =>
    pads.handleDisconnected((ev as GamepadEvent).gamepad as unknown as GamepadLike);

  keyTarget.addEventListener('keydown', onKeyDown);
  keyTarget.addEventListener('keyup', onKeyUp);
  win.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  for (const t of GESTURE_EVENTS) win.addEventListener(t, onGesture, { capture: true, passive: true });
  win.addEventListener('blur', onBlur);
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('gamepadconnected', onPadConnected);
  win.addEventListener('gamepaddisconnected', onPadDisconnected);

  function rollSlot(s: ActionSlot): void {
    slots[s].roll(slotF);
    if (s === 'primary') {
      controls.primary = slotF.held;
      controls.primaryPressed = slotF.pressed;
      controls.primaryReleased = slotF.released;
    } else if (s === 'secondary') {
      controls.secondary = slotF.held;
      controls.secondaryPressed = slotF.pressed;
      controls.secondaryReleased = slotF.released;
    } else {
      controls.alt = slotF.held;
      controls.altPressed = slotF.pressed;
      controls.altReleased = slotF.released;
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  const api: InputManagerInternal = {
    update(dt: number): void {
      if (disposed) return;
      const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;

      menuOut.length = 0;
      for (let i = 0; i < menuPending.length; i++) menuOut.push(menuPending[i]!);
      menuPending.length = 0;

      pads.poll(d, mode, padF, menuOut);
      if (mode === 'menu') {
        const rep = kb.menuRepeatStep(d);
        if (rep !== null) menuOut.push(rep);
      }
      kb.sample(kbS);
      touch.sample(touchS);

      if (mode === 'gameplay') {
        // Move: the most-deflected source wins (keys are digital, normalised on diagonals).
        let mx = kbS.x;
        let my = kbS.y;
        if (mx !== 0 && my !== 0) {
          mx *= Math.SQRT1_2;
          my *= Math.SQRT1_2;
        }
        let best = mx * mx + my * my;
        const t2 = touchS.x * touchS.x + touchS.y * touchS.y;
        if (t2 > best) {
          mx = touchS.x;
          my = touchS.y;
          best = t2;
        }
        const p2 = padF.moveX * padF.moveX + padF.moveY * padF.moveY;
        if (p2 > best) {
          mx = padF.moveX;
          my = padF.moveY;
        }
        controls.moveX = mx;
        controls.moveY = my;

        slots.primary.set(SRC_PAD, padF.primary);
        slots.secondary.set(SRC_PAD, padF.secondary);
        slots.alt.set(SRC_PAD, padF.alt);
        rollSlot('primary');
        rollSlot('secondary');
        rollSlot('alt');
        controls.prevPressed = kbPrev || padF.prevEdge;
        controls.nextPressed = kbNext || padF.nextEdge;
        kbPrev = false;
        kbNext = false;
      } else {
        clearSlots();
        neutral();
      }
      kb.endFrame();
    },

    getControls(): GameControls {
      return controls;
    },

    getMenuActions(): readonly MenuAction[] {
      return menuOut;
    },

    setMode(m: InputMode): void {
      if (m !== 'menu' && m !== 'gameplay') return;
      if (m === mode) return;
      mode = m;
      kb.latchAll();
      pads.onModeChange();
      touch.reset();
      refreshTouchVisibility();
      clearSlots();
      // Actions queued in the old mode must not act in the new one ('mute' is mode-agnostic).
      let w = 0;
      for (let i = 0; i < menuPending.length; i++) if (menuPending[i] === 'mute') menuPending[w++] = 'mute';
      menuPending.length = w;
      neutral();
    },

    get mode(): InputMode {
      return mode;
    },

    setScheme(s: ControlScheme | null): void {
      scheme = s ?? null;
      touch.setScheme(scheme);
      refreshTouchVisibility();
    },

    get lastDevice(): InputDevice {
      return lastDevice;
    },

    onDeviceChange(cb: (device: InputDevice) => void): () => void {
      deviceListeners.add(cb);
      return () => {
        deviceListeners.delete(cb);
      };
    },

    gamepad(): GamepadInfo {
      return pads.info();
    },

    onGamepadConnection(cb: GamepadConnectionListener): () => void {
      connectionListeners.add(cb);
      return () => {
        connectionListeners.delete(cb);
      };
    },

    rumble(kind: RumbleKind): void {
      if (!vibrationEnabled || disposed) return;
      const p = RUMBLE_PROFILES[kind];
      if (p === undefined) return;
      const canPad = lastDevice === 'gamepad';
      // Chrome blocks navigator.vibrate before a user gesture (and logs about it).
      const canPhone = lastDevice === 'touch' && gestured;
      if (!canPad && !canPhone) return;
      if (!gate.allow(p, env.now())) return;
      if (canPad) pads.rumble(p);
      else playDeviceVibration(env.nav, p);
    },

    setVibrationEnabled(on: boolean): void {
      vibrationEnabled = on;
    },

    setTouchControls(pref: 'auto' | 'on' | 'off'): void {
      touchPref = pref === 'on' || pref === 'off' ? pref : 'auto';
      refreshTouchVisibility();
    },

    setTouchHand(hand: 'right' | 'left'): void {
      touch.setHand(hand);
    },

    onFirstGesture(cb: () => void): () => void {
      gestureListeners.add(cb);
      return () => {
        gestureListeners.delete(cb);
      };
    },

    reset(): void {
      kb.reset();
      touch.reset();
      pads.reset();
      clearSlots();
      gate.reset();
      menuPending.length = 0;
      neutral();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      keyTarget.removeEventListener('keydown', onKeyDown);
      keyTarget.removeEventListener('keyup', onKeyUp);
      win.removeEventListener('pointerdown', onPointerDown, { capture: true });
      for (const t of GESTURE_EVENTS) win.removeEventListener(t, onGesture, { capture: true });
      win.removeEventListener('blur', onBlur);
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('gamepadconnected', onPadConnected);
      win.removeEventListener('gamepaddisconnected', onPadDisconnected);
      touch.dispose();
      deviceListeners.clear();
      connectionListeners.clear();
      gestureListeners.clear();
      menuPending.length = 0;
      menuOut.length = 0;
      clearSlots();
      neutral();
    },

    debugPad() {
      return pads.debug();
    },

    rumbleTest(kind: RumbleKind) {
      if (!vibrationEnabled || disposed) return { pad: false, vibrate: false };
      const p = RUMBLE_PROFILES[kind];
      return { pad: pads.rumble(p), vibrate: gestured && playDeviceVibration(env.nav, p) };
    },

    get touchOverlay(): TouchOverlay {
      return touch;
    },

    get touchVisible(): boolean {
      return touch.isVisible;
    },

    get scheme(): ControlScheme | null {
      return scheme;
    },
  };

  return api;
}
