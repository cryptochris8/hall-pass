// ─────────────────────────────────────────────────────────────────────────────
// Keyboard mapping (docs/GDD.md §13, docs/ARCHITECTURE.md "Keyboard ownership").
// Pure functions only — the DOM wiring lives in keyboard.ts / manager.ts.
//
// Keys are matched by *physical position* (KeyboardEvent.code) so WASD works on
// AZERTY/Dvorak the way players expect, with a fallback on KeyboardEvent.key for
// virtual keyboards / old browsers that leave `code` empty. (Adapted from Trash Panda.)
//
//   primary   Space / J        secondary  E / K        alt  Shift / L
//   move      WASD / arrows    pause      Esc / P      mute M      prev/next  Q / R
//   menus     arrows/WASD · Enter/Space confirm · Esc/Backspace back · Tab/Shift+Tab next/prev
// ─────────────────────────────────────────────────────────────────────────────
import type { ActionSlot } from './slots';
import type { InputMode, MenuAction } from './types';

/** What a physical key means, independent of the current mode. */
export type KeyRole =
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  /** Space: primary in gameplay, confirm in menus. */
  | 'space'
  /** J: primary (gameplay only). */
  | 'primary'
  | 'secondary'
  | 'alt'
  | 'enter'
  | 'escape'
  | 'backspace'
  | 'tab'
  | 'pause'
  | 'mute'
  /** Q: previous target (gameplay only). */
  | 'prevTab'
  /** R: next target (gameplay only). */
  | 'nextTab';

export type AxisRole = 'left' | 'right' | 'up' | 'down';

const CODE_ROLES: Readonly<Record<string, KeyRole>> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'space',
  KeyJ: 'primary',
  KeyE: 'secondary',
  KeyK: 'secondary',
  ShiftLeft: 'alt',
  ShiftRight: 'alt',
  KeyL: 'alt',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Backspace: 'backspace',
  Tab: 'tab',
  KeyP: 'pause',
  KeyM: 'mute',
  KeyQ: 'prevTab',
  KeyR: 'nextTab',
};

/** Fallback by `KeyboardEvent.key` (lower-cased). Includes legacy Edge/IE names. */
const KEY_ROLES: Readonly<Record<string, KeyRole>> = {
  arrowleft: 'left',
  left: 'left',
  a: 'left',
  arrowright: 'right',
  right: 'right',
  d: 'right',
  arrowup: 'up',
  up: 'up',
  w: 'up',
  arrowdown: 'down',
  down: 'down',
  s: 'down',
  ' ': 'space',
  spacebar: 'space',
  j: 'primary',
  e: 'secondary',
  k: 'secondary',
  shift: 'alt',
  l: 'alt',
  enter: 'enter',
  escape: 'escape',
  esc: 'escape',
  backspace: 'backspace',
  tab: 'tab',
  p: 'pause',
  m: 'mute',
  q: 'prevTab',
  r: 'nextTab',
};

/** Resolve a key event's role (null = not a key the game uses). */
export function keyRole(code: string, key: string): KeyRole | null {
  if (code) {
    const r = CODE_ROLES[code];
    if (r !== undefined) return r;
    // A non-empty, unknown code is authoritative: it is a physical key we don't map.
    // (Exception: 'Unidentified', which some Android keyboards send.)
    if (code !== 'Unidentified') return null;
  }
  return KEY_ROLES[key.toLowerCase()] ?? null;
}

/**
 * Stable identifier used to track a held key (so ArrowLeft and KeyA can be held and
 * released independently). Falls back to the `key` when `code` is missing.
 */
export function keyId(code: string, key: string): string {
  return code && code !== 'Unidentified' ? code : 'key:' + key.toLowerCase();
}

export function isAxisRole(role: KeyRole): role is AxisRole {
  return role === 'left' || role === 'right' || role === 'up' || role === 'down';
}

/** The GameControls slot a key drives in gameplay (null for directions / UI keys). */
export function slotOfRole(role: KeyRole): ActionSlot | null {
  switch (role) {
    case 'space':
    case 'primary':
      return 'primary';
    case 'secondary':
      return 'secondary';
    case 'alt':
      return 'alt';
    default:
      return null;
  }
}

/**
 * Which MenuAction (if any) a key press produces in a given mode.
 *  - menu:     arrows/WASD → directions, Tab / Shift+Tab → next / prev, Enter/Space → confirm,
 *              Esc/Backspace → back, P → pause, M → mute
 *  - gameplay: Esc/P → pause, M → mute (everything else drives GameControls)
 * OS auto-repeat (`repeat === true`) never produces an action: held menu directions are
 * repeated by the input module's own timer (MenuRepeat) so the feel is identical on every OS
 * and on the gamepad, and holding Enter can't machine-gun through menus.
 */
export function menuActionFor(role: KeyRole, mode: InputMode, repeat: boolean, shift = false): MenuAction | null {
  if (repeat) return null;
  if (role === 'mute') return 'mute';
  if (mode === 'menu') {
    switch (role) {
      case 'left':
      case 'right':
      case 'up':
      case 'down':
        return role;
      case 'tab':
        return shift ? 'prev' : 'next';
      case 'space':
      case 'enter':
        return 'confirm';
      case 'escape':
      case 'backspace':
        return 'back';
      case 'pause':
        return 'pause';
      default:
        return null;
    }
  }
  if (role === 'escape' || role === 'pause') return 'pause';
  return null;
}

/**
 * Keys still honoured while focus is inside an editable text field (input/textarea/contenteditable):
 * only Escape, so typing and caret movement belong to the field.
 */
export function allowedWhileTyping(role: KeyRole): boolean {
  return role === 'escape';
}
