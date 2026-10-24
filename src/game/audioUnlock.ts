// Audio unlock backstop for phones (GDD §13 "Audio unlocks on the first user gesture").
//
// Browsers only let an AudioContext start inside an event that carries user activation.
// For touch that is the END of the tap: pointerup / touchend / click. touchstart and a
// touch pointerdown do NOT grant activation (a context created or resumed there stays
// 'suspended'). The input manager's onFirstGesture already waits for an activating event,
// and the audio engine re-arms itself after a failed start — this listener is the third,
// independent line: while audio is still locked, EVERY activating event (on any element,
// in any menu or during gameplay) calls audio.unlock() synchronously inside the handler,
// which resumes the context and plays the 1-sample silent buffer iOS/WebKit needs.
// Once audio runs, each event costs one property read.

/** The slice of the audio engine this needs (AudioEngine satisfies it). */
export interface Unlockable {
  readonly unlocked: boolean;
  unlock(): void;
}

/**
 * Events that grant transient user activation (HTML spec "activation triggering input events"),
 * i.e. the only moments iOS Safari / Android Chrome will let audio start. Deliberately NOT
 * touchstart / pointerdown: those don't grant it for touch.
 */
export const UNLOCK_EVENTS = ['pointerup', 'touchend', 'click', 'keydown', 'mousedown'] as const;

/** Keys that don't grant user activation in Chromium (Escape, bare modifiers). */
const NON_ACTIVATING_KEYS = new Set(['Escape', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'OS', 'CapsLock', 'Fn', 'FnLock']);

/** Whether this event can carry user activation (pure; exported for tests). */
export function isActivatingEvent(e: Pick<Event, 'type' | 'isTrusted'> & { key?: string }, requireTrusted = true): boolean {
  if (requireTrusted && !e.isTrusted) return false;
  if (e.type === 'keydown') return !(typeof e.key === 'string' && NON_ACTIVATING_KEYS.has(e.key));
  return (UNLOCK_EVENTS as readonly string[]).includes(e.type);
}

/**
 * Listen (capture, passive) on `target` for activating events and unlock audio while it is
 * locked. Returns a disposer. Never throws into the event dispatch.
 */
export function installAudioUnlock(target: EventTarget, audio: Unlockable, opts: { requireTrusted?: boolean } = {}): () => void {
  const requireTrusted = opts.requireTrusted ?? true;
  const onEvent = (e: Event): void => {
    try {
      if (audio.unlocked) return;
      if (!isActivatingEvent(e as Event & { key?: string }, requireTrusted)) return;
      audio.unlock();
    } catch {
      /* audio is optional */
    }
  };
  const options: AddEventListenerOptions = { capture: true, passive: true };
  for (const t of UNLOCK_EVENTS) target.addEventListener(t, onEvent, options);
  return () => {
    for (const t of UNLOCK_EVENTS) target.removeEventListener(t, onEvent, options);
  };
}
