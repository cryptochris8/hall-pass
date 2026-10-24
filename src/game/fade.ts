// The black fade overlay between the canvas and the touch layer: attract-run cuts on the title and
// the fade-in at a run start. Kept out of app.ts so its timing rules are unit-testable.
//
// Rule (final review): a cut that is still fading OUT when a run starts must not fade to black
// again afterwards — it used to flash black just after the player pressed Play.

/** The bits of an HTMLElement the fader touches. */
export interface FadeEl {
  style: { transitionDuration: string; opacity: string };
  readonly offsetWidth: number;
}

/** Fade overlay timing (s). */
export const FADE_OUT = 0.35;
export const FADE_IN = 0.45;

export class Fader {
  private pending: { at: number; fn: () => boolean } | null = null;

  constructor(private readonly el: FadeEl) {}

  /** A cut is fading out (its callback hasn't run yet). */
  get cutting(): boolean {
    return this.pending !== null;
  }

  /**
   * Fade to black, run `fn` at `now + FADE_OUT`, then fade back in — unless `fn` returns false
   * (nothing changed behind the black, e.g. a run started meanwhile and did its own fade).
   */
  cut(now: number, fn: () => boolean): void {
    this.el.style.transitionDuration = `${FADE_OUT}s`;
    this.el.style.opacity = '1';
    this.pending = { at: now + FADE_OUT, fn };
  }

  /** Drop a pending cut (its callback never runs, no fade-in follows). */
  cancel(): void {
    this.pending = null;
  }

  /** Snap to black, then transition to clear. */
  fromBlack(): void {
    const el = this.el;
    el.style.transitionDuration = '0s';
    el.style.opacity = '1';
    // Force the 'from' state, then transition to clear.
    void el.offsetWidth;
    el.style.transitionDuration = `${FADE_IN}s`;
    el.style.opacity = '0';
  }

  /** Call every frame with the app clock (s). */
  update(now: number): void {
    const p = this.pending;
    if (!p || now < p.at) return;
    this.pending = null;
    if (p.fn() !== false) this.fromBlack();
  }
}
