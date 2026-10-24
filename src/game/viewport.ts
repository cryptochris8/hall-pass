// Keeps the renderer sized to the real visible area on phones.
//
// Things that resize the game on a phone, and what reports them:
//   • URL bar showing/hiding (Android Chrome, iOS Safari landscape) → window 'resize' and
//     visualViewport 'resize'; #app (position: fixed; inset: 0) follows via ResizeObserver.
//   • Orientation change → 'orientationchange' fires BEFORE the new size is known on iOS; the
//     size settles over a few hundred ms, so we re-measure at a few delays afterwards.
//   • Entering/leaving fullscreen → 'fullscreenchange' (+ resize).
//   • Moving to a screen with another devicePixelRatio (desktop) → caught by the re-measure.
// All of these are coalesced into at most one callback per animation frame, and only when the
// measured size or DPR actually changed.

export interface ViewSize {
  /** CSS px */
  w: number;
  h: number;
  dpr: number;
}

export function sameSize(a: Readonly<ViewSize> | null, b: Readonly<ViewSize>): boolean {
  return !!a && a.w === b.w && a.h === b.h && Math.abs(a.dpr - b.dpr) < 1e-3;
}

/** Measure an element (falls back to the window when it has no layout yet). */
export function measure(el: HTMLElement, win: Window): ViewSize {
  const w = el.clientWidth || win.innerWidth || 1;
  const h = el.clientHeight || win.innerHeight || 1;
  return { w, h, dpr: win.devicePixelRatio || 1 };
}

/** Re-measure this long (ms) after an orientation change: iOS reports the new size late. */
export const ORIENTATION_SETTLE_MS: readonly number[] = [60, 250, 600];

export function installViewport(el: HTMLElement, win: Window, onChange: (size: ViewSize) => void): { dispose(): void; refresh(): void } {
  let last: ViewSize | null = null;
  let raf = 0;
  let disposed = false;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const apply = (): void => {
    raf = 0;
    if (disposed) return;
    const s = measure(el, win);
    if (sameSize(last, s)) return;
    last = s;
    onChange(s);
  };
  const schedule = (): void => {
    if (disposed || raf !== 0) return;
    raf = typeof win.requestAnimationFrame === 'function' ? win.requestAnimationFrame(apply) : (setTimeout(apply, 16) as unknown as number);
  };
  const settle = (): void => {
    schedule();
    for (const ms of ORIENTATION_SETTLE_MS) {
      const t = setTimeout(() => {
        timers.delete(t);
        schedule();
      }, ms);
      timers.add(t);
    }
  };

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(schedule);
    ro.observe(el);
  }
  const vv = win.visualViewport ?? null;
  win.addEventListener('resize', schedule);
  win.addEventListener('orientationchange', settle);
  win.addEventListener('pageshow', settle);
  vv?.addEventListener('resize', schedule);
  win.document.addEventListener('fullscreenchange', settle);
  const so = (win.screen as Screen & { orientation?: ScreenOrientation }).orientation;
  so?.addEventListener?.('change', settle);

  // First measurement synchronously so the renderer is right before the first frame.
  const first = measure(el, win);
  last = first;
  onChange(first);

  return {
    refresh(): void {
      last = null;
      schedule();
    },
    dispose(): void {
      disposed = true;
      ro?.disconnect();
      win.removeEventListener('resize', schedule);
      win.removeEventListener('orientationchange', settle);
      win.removeEventListener('pageshow', settle);
      vv?.removeEventListener('resize', schedule);
      win.document.removeEventListener('fullscreenchange', settle);
      so?.removeEventListener?.('change', settle);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (raf !== 0 && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(raf);
    },
  };
}
