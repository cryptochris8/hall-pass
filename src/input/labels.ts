// Display names of the bindings, for the UI's control prompts / intro cards / how-to-play.
// PURE. Mirrors the real mappings in keymap.ts / gamepad.ts — tests keep them in sync.
//
// Gamepad buttons are POSITIONAL (bottom face = primary on every pad), so the letter printed on
// that button differs per family: ✕ (PlayStation), A (Xbox / generic), B (Nintendo).
import type { ControlScheme, InputDevice, PadStyle } from './types';

export type BindingSlot = 'primary' | 'secondary' | 'alt' | 'move' | 'pause' | 'switch';

type Table = Readonly<Record<BindingSlot, readonly string[]>>;

const KEYBOARD: Table = {
  primary: ['SPACE', 'J'],
  secondary: ['E', 'K'],
  alt: ['SHIFT', 'L'],
  move: ['WASD', 'ARROWS'],
  pause: ['ESC', 'P'],
  switch: ['Q', 'R'],
};

const PAD: Readonly<Record<PadStyle, Table>> = {
  playstation: {
    primary: ['✕'],
    secondary: ['○', '□'],
    alt: ['R2'],
    move: ['L-STICK', 'D-PAD'],
    pause: ['OPTIONS'],
    switch: ['L1', 'R1'],
  },
  xbox: {
    primary: ['A'],
    secondary: ['B', 'X'],
    alt: ['RT'],
    move: ['L-STICK', 'D-PAD'],
    pause: ['MENU'],
    switch: ['LB', 'RB'],
  },
  nintendo: {
    // Positional: bottom = B, right = A, left = Y (Switch Pro / Joy-Con layout).
    primary: ['B'],
    secondary: ['A', 'Y'],
    alt: ['ZR'],
    move: ['L-STICK', 'D-PAD'],
    pause: ['+'],
    switch: ['L', 'R'],
  },
  generic: {
    primary: ['A'],
    secondary: ['B', 'X'],
    alt: ['RT'],
    move: ['L-STICK', 'D-PAD'],
    pause: ['START'],
    switch: ['LB', 'RB'],
  },
};

/** Touch without a scheme: the buttons exist but we don't know their labels. */
const TOUCH_FALLBACK = 'TAP';

/**
 * Display names for a control slot on a device, most important first (show `[0]`, or join a
 * few with " / " for a how-to-play table).
 *
 *   bindingLabels('primary', 'keyboard', s)          → ['SPACE', 'J']
 *   bindingLabels('primary', 'gamepad', 'playstation') → ['✕']      ('xbox' → ['A'], 'nintendo' → ['B'])
 *   bindingLabels('alt', 'gamepad', 'playstation')   → ['R2'] ('xbox' → ['RT'])
 *   bindingLabels('switch', 'gamepad', 'playstation') → ['L1', 'R1'] (prev / next)
 *   bindingLabels('move', 'keyboard', s)             → ['WASD', 'ARROWS']
 *   bindingLabels('primary', 'touch', s, scheme)     → [scheme.primary.label]  e.g. ['JUMP']
 *   bindingLabels('move', 'touch', s, scheme)        → ['JOYSTICK']  ([] when scheme.move is 'none')
 *   bindingLabels('pause', 'touch', s)               → ['❚❚']  (the UI's pause button)
 *
 * `style` is only used for 'gamepad'. `scheme` is only used for 'touch': a slot the scheme leaves
 * null has no touch binding → []; without a scheme the button slots return ['TAP'].
 * Returns a fresh array (safe to mutate).
 */
export function bindingLabels(
  slot: BindingSlot,
  device: InputDevice,
  style: PadStyle = 'generic',
  scheme?: ControlScheme | null,
): string[] {
  if (device === 'keyboard') return [...(KEYBOARD[slot] ?? [])];
  if (device === 'gamepad') {
    const table = PAD[style] ?? PAD.generic;
    return [...(table[slot] ?? [])];
  }
  // touch
  switch (slot) {
    case 'pause':
      return ['❚❚'];
    case 'move':
      return scheme && scheme.move === 'none' ? [] : ['JOYSTICK'];
    case 'switch':
      return ['TAP'];
    case 'primary':
    case 'secondary':
    case 'alt': {
      if (!scheme) return [TOUCH_FALLBACK];
      const spec = scheme[slot];
      return spec ? [spec.label] : [];
    }
    default:
      return [];
  }
}
