// Fullscreen on Android / touch tablets: entered when a run starts from a tap (the tap's user
// activation is still live), never on iOS (element fullscreen doesn't exist on iPhone; "Add to
// Home Screen" is the iOS route to a full-screen game, see index.html + manifest). Leaving
// fullscreen (back gesture, swipe, Esc) is always the player's call: we remember it for the
// session and stop asking, and the app auto-pauses a live run because the layout just jumped.
import { shouldAutoFullscreen, type PlatformInfo } from './device';

export class FullscreenController {
  /** The player backed out of fullscreen this session. */
  private userExited = false;
  /** We asked to leave (settings toggle): not the player's gesture. */
  private exiting = false;
  private readonly listeners = new Set<(active: boolean) => void>();

  constructor(
    private readonly doc: Document,
    private readonly platform: PlatformInfo,
  ) {
    doc.addEventListener('fullscreenchange', this.onChange);
  }

  get active(): boolean {
    return !!this.doc.fullscreenElement;
  }

  /** Try to go fullscreen for a run start (needs a live user activation — call from a tap's handler chain). */
  maybeEnter(enabled: boolean): boolean {
    if (!shouldAutoFullscreen(this.platform, { enabled, active: this.active, userExited: this.userExited })) return false;
    return this.enter();
  }

  /** Enter now (settings toggle switched on — the click is the gesture). Returns whether a request was made. */
  enter(): boolean {
    const el = this.doc.documentElement;
    if (this.active || typeof el?.requestFullscreen !== 'function') return false;
    this.userExited = false;
    try {
      // navigationUI 'hide': Android Chrome hides its system bars too.
      const p = el.requestFullscreen({ navigationUI: 'hide' });
      if (p && typeof p.catch === 'function') p.catch(() => undefined); // no activation / denied: stay windowed
      return true;
    } catch {
      return false;
    }
  }

  /** Leave fullscreen (settings toggle switched off). */
  exit(): void {
    if (!this.active || typeof this.doc.exitFullscreen !== 'function') return;
    this.exiting = true;
    try {
      const p = this.doc.exitFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => (this.exiting = false));
    } catch {
      this.exiting = false;
    }
  }

  /** Fullscreen entered (true) or left (false), whoever caused it. */
  onChangeCb(cb: (active: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Test/debug view of the session flag. */
  get exitedByPlayer(): boolean {
    return this.userExited;
  }

  dispose(): void {
    this.doc.removeEventListener('fullscreenchange', this.onChange);
    this.listeners.clear();
  }

  private readonly onChange = (): void => {
    const active = this.active;
    if (!active) {
      if (!this.exiting) this.userExited = true;
      this.exiting = false;
    }
    for (const cb of this.listeners) {
      try {
        cb(active);
      } catch (e) {
        console.warn('[fullscreen] listener threw', e);
      }
    }
  };
}
