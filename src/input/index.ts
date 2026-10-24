// Input module entry point (docs/ARCHITECTURE.md). Keyboard, gamepad (PS4 DualShock 4 /
// DualSense, Xbox, Nintendo, generic — Gamepad API standard mapping + raw DS4 fallbacks) and the
// scheme-driven touch overlay (`.hp-touch`). Contract: src/input/types.ts.
//
// Usage (integration):
//   const input = createInput({ touchRoot: appEl });          // appends .hp-touch (z-index 2) to #app
//   input.onFirstGesture(() => audio.unlock());               // pointerup/touchend/click/keydown (not Esc)
//   input.onDeviceChange((d) => ui.setInputDevice(d, input.gamepad().style));
//   input.onGamepadConnection((connected, info) => ui.setGamepadStatus(connected, info.id, info.style));
//     // a 3rd arg `wasActive?: boolean` tells whether the pad that vanished was the one in use (→ pause)
//   // settings:
//   input.setTouchControls(settings.touchControls); input.setTouchHand(settings.touchHand);
//   input.setVibrationEnabled(settings.vibration);
//   // every rAF, BEFORE anything reads input:
//   input.update(dt);
//   ui.handleMenuActions(input.getMenuActions());             // reused array — valid until next update()
//   event.update(dt, playing ? input.getControls() : NO_CONTROLS);  // reused object
//   input.setScheme(event.controls());                        // on change (null when no event is live)
//   // screen changes: input.setMode(playing && !paused ? 'gameplay' : 'menu')  (releases everything held)
//   // window blur / tab hidden → handled internally (reset()); call input.reset() on restart too.
//
// Edge semantics: *Pressed / *Released are true for exactly one update() after the change. A tap
// shorter than one frame reports primary = primaryPressed = primaryReleased = true on the SAME
// frame — handle the press before the release and never chain them with `else if`.
import { browserEnv, createInputManager } from './manager';
import type { InputManager, InputOptions } from './types';

/**
 * Create the input manager: installs keyboard/pointer/gamepad listeners on the window (or
 * `opts.keyTarget` for keys) and appends the hidden `.hp-touch` overlay to `opts.touchRoot`
 * (a positioned, full-screen element). Starts in 'menu' mode with no scheme.
 */
export function createInput(opts: InputOptions): InputManager {
  return createInputManager(opts, browserEnv());
}

export { bindingLabels, type BindingSlot } from './labels';
export { CONTROL_ICONS, controlIconSvg } from './icons';
export { detectPadStyle } from './gamepad';
export { RUMBLE_PROFILES } from './rumble';
export { NO_CONTROLS } from './types';
export type {
  ButtonSpec,
  ControlIcon,
  ControlScheme,
  GameControls,
  GamepadInfo,
  InputDevice,
  InputManager,
  InputMode,
  InputOptions,
  MenuAction,
  PadStyle,
  RumbleKind,
} from './types';
