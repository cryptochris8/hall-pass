// Styles for the on-screen touch controls. Injected once as <style id="hp-touch-style"> so the
// input module has no CSS-pipeline dependency. Look (BAD HAIR DAY! house style, matching src/ui):
// chunky cartoon buttons with soft plum ink outlines and a pressed-down shadow — the big primary is a
// coral disc with a cream icon, the two small ones are cream discs with coral icons; the floating
// joystick is a translucent cream ring with a cream knob and a coral centre. Luckiest Guy labels.
// Idle controls are slightly translucent so the field stays readable. Layering: `.hp-touch` is
// z-index 2 (canvas < .hp-fade < .hp-touch < .hp-ui).

export const TOUCH_STYLE_ID = 'hp-touch-style';

/** UI tokens (mirror PAL.uiPlum / uiCream / uiCoral / uiSunshine). */
const PLUM = '#3a2330';
const CREAM = '#fff6e9';
const CORAL = '#ff7a6b';
const SUN = '#ffc94a';

export const TOUCH_CSS = `
.hp-touch {
  --hp-ink: ${PLUM};
  --hp-plum: ${PLUM};
  --hp-cream: ${CREAM};
  --hp-coral: ${CORAL};
  --hp-sun: ${SUN};
  /* Primary (big) and the two small buttons. */
  --hp-btn: clamp(96px, 27vmin, 110px);
  --hp-sec: clamp(64px, 18.5vmin, 78px);
  --hp-gap: clamp(10px, 2.8vmin, 16px);
  /* Stick sizes are set inline from the stick config (TouchOverlay). */
  --hp-base: 118px;
  --hp-knob: 59px;
  --hp-track-w: 171px;
  --hp-track-h: 73px;
  --hp-sl: env(safe-area-inset-left, 0px);
  --hp-sr: env(safe-area-inset-right, 0px);
  --hp-sb: env(safe-area-inset-bottom, 0px);
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  font-family: 'Luckiest Guy', 'Baloo 2', 'Arial Black', 'Arial Rounded MT Bold', system-ui, sans-serif;
  opacity: 0;
  visibility: hidden;
  transition: opacity 160ms ease, visibility 0s linear 160ms;
}
.hp-touch[data-visible="true"] {
  opacity: 1;
  visibility: visible;
  transition: opacity 160ms ease;
}

/* ── Floating joystick zone: left half, below the HUD band (right half when left-handed) ── */
.hp-touch__zone {
  position: absolute;
  left: 0;
  width: 50%;
  top: 50%;
  /* Keep thumbs off the very bottom edge: a swipe starting there is the phone's home gesture. */
  bottom: calc(12px + var(--hp-sb));
  pointer-events: auto;
  touch-action: none;
  --hp-rest-x: 50%;
  --hp-rest-y: 64%;
}
@media (orientation: landscape) {
  .hp-touch__zone {
    top: 24%;
    --hp-rest-x: calc(var(--hp-sl) + 124px);
    --hp-rest-y: 64%;
  }
}
.hp-touch__zone[data-move="none"] { display: none; }

.hp-touch__base {
  --hp-bw: var(--hp-base);
  --hp-bh: var(--hp-base);
  position: absolute;
  left: 0;
  top: 0;
  width: var(--hp-bw);
  height: var(--hp-bh);
  margin: calc(var(--hp-bh) / -2) 0 0 calc(var(--hp-bw) / -2);
  box-sizing: border-box;
  border-radius: 50%;
  border: 4px solid var(--hp-plum);
  background: radial-gradient(circle at 50% 50%, rgba(255, 246, 233, 0.22) 0 46%, rgba(255, 246, 233, 0.5) 47% 100%);
  box-shadow: 0 5px 0 rgba(58, 35, 48, 0.55), inset 0 0 0 4px rgba(255, 246, 233, 0.85), inset 0 0 0 6px rgba(58, 35, 48, 0.35);
  will-change: transform;
}
.hp-touch__base[data-axis="x"] {
  --hp-bw: var(--hp-track-w);
  --hp-bh: var(--hp-track-h);
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(255, 246, 233, 0.55), rgba(255, 246, 233, 0.3));
}
.hp-touch__base.is-idle {
  left: var(--hp-rest-x);
  top: var(--hp-rest-y);
  transform: none !important;
  opacity: 0.55;
  transition: opacity 180ms ease;
}
.hp-touch__deco { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.hp-chev { fill: ${CREAM}; stroke: ${PLUM}; stroke-width: 2.4; stroke-linejoin: round; transition: fill 80ms linear; }
.hp-touch__base[data-dir~="l"] .hp-chev--l,
.hp-touch__base[data-dir~="r"] .hp-chev--r,
.hp-touch__base[data-dir~="u"] .hp-chev--u,
.hp-touch__base[data-dir~="d"] .hp-chev--d { fill: var(--hp-sun); }
.hp-touch__knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--hp-knob);
  height: var(--hp-knob);
  margin: calc(var(--hp-knob) / -2) 0 0 calc(var(--hp-knob) / -2);
  box-sizing: border-box;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, var(--hp-coral) 0 17%, ${PLUM} 18% 23%, transparent 24%), radial-gradient(circle at 36% 30%, #ffffff 0 16%, var(--hp-cream) 55%, #f1dcc0 100%);
  border: 4px solid var(--hp-ink);
  box-shadow: 0 5px 0 rgba(58, 35, 48, 0.8);
  will-change: transform;
}
.hp-touch__knob::after {
  content: '';
  position: absolute;
  inset: 12%;
  border-radius: 50%;
  border: 3px dashed rgba(58, 35, 48, 0.2);
}
.hp-touch__base:not(.is-idle) .hp-touch__knob { box-shadow: 0 2px 0 rgba(58, 35, 48, 0.8), 0 0 0 5px rgba(255, 201, 74, 0.55); }
.hp-touch__movelabel {
  position: absolute;
  left: 50%;
  top: calc(100% + 8px);
  transform: translateX(-50%) rotate(-2deg);
  white-space: nowrap;
  font-size: 15px;
  line-height: 1;
  letter-spacing: 0.08em;
  color: var(--hp-cream);
  -webkit-text-stroke: 0.26em var(--hp-ink);
  paint-order: stroke fill;
  pointer-events: none;
}
.hp-touch__base:not(.is-idle) .hp-touch__movelabel { visibility: hidden; }

/* ── Action buttons (bottom-right; bottom-left when left-handed) ───────────── */
.hp-touch__actions {
  position: absolute;
  right: calc(16px + var(--hp-sr));
  bottom: calc(16px + var(--hp-sb));
  width: calc(var(--hp-btn) + var(--hp-sec) + var(--hp-gap));
  height: calc(var(--hp-btn) + var(--hp-sec) + var(--hp-gap));
  pointer-events: none;
}
@media (orientation: landscape) {
  .hp-touch__actions { right: calc(max(24px, 3.5vw) + var(--hp-sr)); bottom: calc(18px + var(--hp-sb)); }
}
.hp-touch__btn {
  position: absolute;
  box-sizing: border-box;
  border-radius: 50%;
  border: 4px solid var(--hp-plum);
  background: radial-gradient(circle at 38% 28%, #ffffff 0 14%, var(--hp-cream) 55%, #f1dcc0 100%);
  color: var(--hp-coral);
  box-shadow: 0 6px 0 var(--hp-plum), inset 0 -6px 0 rgba(58, 35, 48, 0.12);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1px;
  pointer-events: auto;
  touch-action: none;
  cursor: pointer;
  opacity: 0.94;
  outline: none;
  transition: transform 70ms ease-out, box-shadow 70ms ease-out, opacity 120ms ease, background 90ms linear;
}
.hp-touch__btn[data-on="false"] { display: none; }
/* Larger invisible hit area than the visual disc (thumbs are imprecise). */
.hp-touch__btn::before { content: ''; position: absolute; inset: -10px; border-radius: 50%; }
.hp-touch__icon { display: block; width: 50%; height: 50%; pointer-events: none; }
.hp-touch__icon > svg { display: block; width: 100%; height: 100%; overflow: visible; }
.hp-touch__label {
  display: block;
  max-width: 92%;
  overflow: hidden;
  font-size: calc(var(--hp-sec) * 0.16);
  line-height: 1.05;
  padding-top: 0.08em;
  letter-spacing: 0.03em;
  white-space: nowrap;
  color: var(--hp-plum);
  pointer-events: none;
}
.hp-touch__btn.is-pressed {
  transform: translateY(5px) scale(0.96);
  box-shadow: 0 1px 0 var(--hp-plum), inset 0 5px 0 rgba(58, 35, 48, 0.14);
  opacity: 1;
  background: radial-gradient(circle at 40% 30%, #fff3c9 0 14%, var(--hp-sun) 62%, #f0a92a 100%);
}

.hp-touch__btn--primary {
  right: 0;
  bottom: 0;
  width: var(--hp-btn);
  height: var(--hp-btn);
  border-width: 5px;
  background: radial-gradient(circle at 36% 26%, #ffc1b8 0 14%, var(--hp-coral) 58%, #e85d50 100%);
  color: var(--hp-cream);
  box-shadow: 0 7px 0 var(--hp-plum), inset 0 -8px 0 rgba(120, 30, 20, 0.18), 0 0 20px rgba(255, 122, 107, 0.35);
  opacity: 0.96;
}
.hp-touch__btn--primary .hp-touch__icon { width: 50%; height: 50%; }
.hp-touch__btn--primary .hp-touch__label {
  font-size: calc(var(--hp-btn) * 0.16);
  color: var(--hp-cream);
  -webkit-text-stroke: 0.24em var(--hp-ink);
  paint-order: stroke fill;
}
.hp-touch__btn--primary.is-pressed {
  background: radial-gradient(circle at 40% 30%, #ffb0a6 0 12%, #f56a5b 60%, #d94c40 100%);
  box-shadow: 0 1px 0 var(--hp-plum), inset 0 6px 0 rgba(120, 30, 20, 0.2), 0 0 26px rgba(255, 201, 74, 0.6);
}
/* ALT — left of the primary, SECONDARY — above it: both one thumb-roll away. */
.hp-touch__btn--alt {
  right: calc(var(--hp-btn) + var(--hp-gap));
  bottom: calc((var(--hp-btn) - var(--hp-sec)) * 0.1);
  width: var(--hp-sec);
  height: var(--hp-sec);
}
.hp-touch__btn--secondary {
  right: calc((var(--hp-btn) - var(--hp-sec)) * 0.1);
  bottom: calc(var(--hp-btn) + var(--hp-gap));
  width: var(--hp-sec);
  height: var(--hp-sec);
}

/* HOLD buttons: a dashed hint ring that fills while held. */
.hp-touch__ring {
  position: absolute;
  left: -11px;
  top: -11px;
  width: calc(100% + 22px);
  height: calc(100% + 22px);
  pointer-events: none;
  overflow: visible;
  transform: rotate(-90deg);
  display: none;
}
.hp-touch__btn[data-hold="true"] .hp-touch__ring { display: block; }
.hp-touch__ring-track { fill: none; stroke: var(--hp-cream); stroke-width: 4; stroke-dasharray: 3 6; stroke-linecap: round; opacity: 0.85; filter: drop-shadow(0 0 1.5px ${PLUM}); }
.hp-touch__ring-fill {
  fill: none;
  stroke: var(--hp-sun);
  stroke-width: 8;
  stroke-linecap: round;
  stroke-dasharray: 100 100;
  stroke-dashoffset: 100;
  opacity: 0;
  filter: drop-shadow(0 0 1.5px ${PLUM});
}
.hp-touch__btn.is-pressed .hp-touch__ring-fill { opacity: 1; animation: hp-touch-fill 0.8s linear forwards; }
@keyframes hp-touch-fill {
  from { stroke-dashoffset: 100; }
  to { stroke-dashoffset: 0; }
}

/* ── Left-handed: mirror the overlay ───────────────────────────────────────── */
.hp-touch[data-hand="left"] .hp-touch__zone { left: auto; right: 0; }
.hp-touch[data-hand="left"] .hp-touch__actions { right: auto; left: calc(16px + var(--hp-sl)); }
.hp-touch[data-hand="left"] .hp-touch__btn--primary { right: auto; left: 0; }
.hp-touch[data-hand="left"] .hp-touch__btn--alt { right: auto; left: calc(var(--hp-btn) + var(--hp-gap)); }
.hp-touch[data-hand="left"] .hp-touch__btn--secondary { right: auto; left: calc((var(--hp-btn) - var(--hp-sec)) * 0.1); }
@media (orientation: landscape) {
  .hp-touch[data-hand="left"] .hp-touch__zone { --hp-rest-x: calc(100% - var(--hp-sr) - 124px); }
  .hp-touch[data-hand="left"] .hp-touch__actions { left: calc(max(24px, 3.5vw) + var(--hp-sl)); }
}

@media (prefers-reduced-motion: reduce) {
  .hp-touch__btn.is-pressed .hp-touch__ring-fill { animation: none; stroke-dashoffset: 0; }
}
`;

/** Insert the stylesheet once per document (ref-counted so dispose() can remove it). */
export function acquireTouchStyles(doc: Document): () => void {
  let el = doc.getElementById(TOUCH_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = doc.createElement('style');
    el.id = TOUCH_STYLE_ID;
    el.textContent = TOUCH_CSS;
    el.dataset.refs = '0';
    (doc.head ?? doc.documentElement).appendChild(el);
  }
  el.dataset.refs = String(Number(el.dataset.refs ?? '0') + 1);
  const styleEl = el;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const n = Number(styleEl.dataset.refs ?? '1') - 1;
    styleEl.dataset.refs = String(n);
    if (n <= 0) styleEl.remove();
  };
}
