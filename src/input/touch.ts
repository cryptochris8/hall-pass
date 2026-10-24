// On-screen touch controls (docs/ARCHITECTURE.md "DOM layering", layer 3 — `.hp-touch`),
// configured per event by a ControlScheme:
//   left half  — floating joystick ('xy'), or a horizontal-only track ('x'), or nothing ('none').
//                It appears under the thumb; the base is dragged along if the thumb drifts past
//                full travel (joystick.ts). A dim "rest" ghost + the scheme's moveLabel hint where to put it.
//   right side — up to three round buttons: primary BIG (bottom-right), alt to its left,
//                secondary above it. Each shows its ButtonSpec icon + label; `hold` buttons show a
//                dashed ring that fills while held.
// Multi-touch through Pointer Events + pointer capture (each pointer tracked by pointerId): steer
// with one thumb while holding one button and tapping another. Buttons react on pointerdown (zero
// latency); a release anywhere — even off the button — releases. Only the zone and the buttons take
// pointer events; the rest of the overlay is click-through. Per-move work is O(1) and only touches
// the DOM on change. setTouchHand('left') mirrors everything. (Adapted from Trash Panda.)
import { controlIconSvg, isControlIcon } from './icons';
import {
  DEFAULT_STICK,
  clampInside,
  computeStick,
  computeStickX,
  createStickOutput,
  followOrigin,
  stickDims,
  type StickConfig,
  type StickDims,
} from './joystick';
import { ACTION_SLOTS, type ActionSlot } from './slots';
import { acquireTouchStyles } from './touchStyles';
import type { ButtonSpec, ControlIcon, ControlScheme } from './types';

export type TouchHand = 'right' | 'left';
export type MoveAxes = ControlScheme['move'];

export interface TouchSample {
  /** −1..1 right-positive. */
  x: number;
  /** −1..1 UP-positive (0 on the 'x' track). */
  y: number;
}

export interface TouchHooks {
  /** A button's slot went down (first finger) / up (last finger). */
  onButton(slot: ActionSlot, down: boolean): void;
}

interface Btn {
  slot: ActionSlot;
  el: HTMLDivElement;
  iconEl: HTMLSpanElement;
  labelEl: HTMLSpanElement;
  /** Pointers currently on it (it is held while non-empty). */
  pointers: Set<number>;
  on: boolean;
  label: string;
  icon: ControlIcon | null;
  hold: boolean;
}

/** Pointer id used for taps forwarded through the joystick zone (never a real pointer). */
export const TAP_POINTER_ID = 9_999;

/** A zone touch counts as a tap (forwarded to what is underneath) when it is short and nearly still. Pure. */
export function isTap(durationMs: number, movedPx: number): boolean {
  return durationMs >= 0 && durationMs < 280 && movedPx < 14;
}

const RING_SVG =
  '<svg class="hp-touch__ring" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
  '<circle class="hp-touch__ring-track" cx="50" cy="50" r="46"/>' +
  '<circle class="hp-touch__ring-fill" cx="50" cy="50" r="46" pathLength="100"/>' +
  '</svg>';

/** Chevrons + guide ring printed on the 'xy' base (sized to the stick dims). */
function decoXY(d: StickDims): string {
  const s = d.base - 6; // inside the 3px border
  const c = s / 2;
  const a = 7; // edge inset
  const h = 11; // chevron half-width
  const l = 13; // chevron length
  return (
    `<svg class="hp-touch__deco" viewBox="0 0 ${s} ${s}" aria-hidden="true" focusable="false">` +
    `<circle cx="${c}" cy="${c}" r="${(c - 20).toFixed(1)}" fill="none" stroke="#fff4de" stroke-width="2" stroke-dasharray="3 7" opacity=".35"/>` +
    `<path class="hp-chev hp-chev--l" d="M${a} ${c}L${a + l} ${c - h}V${c + h}Z"/>` +
    `<path class="hp-chev hp-chev--r" d="M${s - a} ${c}L${s - a - l} ${c - h}V${c + h}Z"/>` +
    `<path class="hp-chev hp-chev--u" d="M${c} ${a}L${c + h} ${a + l}H${c - h}Z"/>` +
    `<path class="hp-chev hp-chev--d" d="M${c} ${s - a}L${c + h} ${s - a - l}H${c - h}Z"/>` +
    `</svg>`
  );
}

/** Left/right chevrons + centre tick on the 'x' track. */
function decoX(d: StickDims): string {
  const w = d.trackW - 6;
  const hh = d.trackH - 6;
  const c = hh / 2;
  const a = 9;
  const h = 12;
  const l = 14;
  return (
    `<svg class="hp-touch__deco" viewBox="0 0 ${w} ${hh}" aria-hidden="true" focusable="false">` +
    `<path d="M${w / 2} ${c - 16}V${c + 16}" stroke="#fff4de" stroke-width="2" stroke-dasharray="3 5" opacity=".35"/>` +
    `<path class="hp-chev hp-chev--l" d="M${a} ${c}L${a + l} ${c - h}V${c + h}Z"/>` +
    `<path class="hp-chev hp-chev--r" d="M${w - a} ${c}L${w - a - l} ${c - h}V${c + h}Z"/>` +
    `</svg>`
  );
}

export class TouchOverlay {
  readonly el: HTMLDivElement;
  private readonly zone: HTMLDivElement;
  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly moveLabelEl: HTMLDivElement;
  private readonly btns: Record<ActionSlot, Btn>;
  private readonly releaseStyles: () => void;
  private readonly cfg: StickConfig;
  private readonly dims: StickDims;
  private readonly doc: Document;

  private visible = false;
  private hand: TouchHand = 'right';
  private move: MoveAxes = 'none';
  private moveLabel = '';
  private stickId: number | null = null;
  /** Tap detection on the joystick zone: a quick, still touch is forwarded to whatever is underneath. */
  private tapT = 0;
  private tapX = 0;
  private tapY = 0;
  private tapMoved = 0;
  private readonly origin = { x: 0, y: 0 };
  private zoneLeft = 0;
  private zoneTop = 0;
  private readonly stick = createStickOutput();
  private dirAttr = '';

  constructor(
    root: HTMLElement,
    private readonly hooks: TouchHooks,
    cfg: Readonly<StickConfig> = DEFAULT_STICK,
  ) {
    const doc = root.ownerDocument;
    this.doc = doc;
    this.cfg = { ...cfg };
    this.dims = stickDims(this.cfg.radius);
    this.releaseStyles = acquireTouchStyles(doc);

    this.el = doc.createElement('div');
    this.el.className = 'hp-touch';
    this.el.dataset.visible = 'false';
    this.el.dataset.hand = this.hand;
    this.el.setAttribute('aria-hidden', 'true');
    const st = this.el.style;
    st.setProperty('--hp-base', `${this.dims.base}px`);
    st.setProperty('--hp-knob', `${this.dims.knob}px`);
    st.setProperty('--hp-track-w', `${this.dims.trackW}px`);
    st.setProperty('--hp-track-h', `${this.dims.trackH}px`);

    this.zone = doc.createElement('div');
    this.zone.className = 'hp-touch__zone';
    this.zone.dataset.move = 'none';
    this.base = doc.createElement('div');
    this.base.className = 'hp-touch__base is-idle';
    this.base.dataset.axis = 'xy';
    this.base.innerHTML = decoXY(this.dims);
    this.knob = doc.createElement('div');
    this.knob.className = 'hp-touch__knob';
    this.moveLabelEl = doc.createElement('div');
    this.moveLabelEl.className = 'hp-touch__movelabel';
    this.base.append(this.knob, this.moveLabelEl);
    this.zone.appendChild(this.base);

    const actions = doc.createElement('div');
    actions.className = 'hp-touch__actions';
    this.btns = {
      primary: this.makeButton(doc, 'primary'),
      secondary: this.makeButton(doc, 'secondary'),
      alt: this.makeButton(doc, 'alt'),
    };
    actions.append(this.btns.secondary.el, this.btns.alt.el, this.btns.primary.el);

    this.el.append(this.zone, actions);
    root.appendChild(this.el);

    this.zone.addEventListener('pointerdown', this.onZoneDown);
    this.zone.addEventListener('pointermove', this.onZoneMove);
    this.zone.addEventListener('pointerup', this.onZoneUp);
    this.zone.addEventListener('pointercancel', this.onZoneUp);
    this.zone.addEventListener('lostpointercapture', this.onZoneUp);
    for (const s of ACTION_SLOTS) {
      const el = this.btns[s].el;
      el.addEventListener('pointerdown', this.onBtnDown);
      el.addEventListener('pointerup', this.onBtnUp);
      el.addEventListener('pointercancel', this.onBtnUp);
      el.addEventListener('lostpointercapture', this.onBtnUp);
    }
    this.el.addEventListener('contextmenu', preventDefault);

    // Zoom/scroll guards. Pointer-event preventDefault() does NOT stop browser gestures, and iOS
    // Safari ignores user-scalable=no — steering with one thumb while tapping a button with the
    // other reads as a pinch. Guard the raw touch/gesture events.
    doc.addEventListener('touchstart', this.onDocTouchStart, NON_PASSIVE);
    doc.addEventListener('touchmove', this.onDocTouchMove, NON_PASSIVE);
    for (const g of GESTURE_EVENTS) doc.addEventListener(g, preventDefault, NON_PASSIVE);
    doc.addEventListener('dblclick', preventDefault, NON_PASSIVE);
  }

  private makeButton(doc: Document, slot: ActionSlot): Btn {
    const el = doc.createElement('div');
    el.className = `hp-touch__btn hp-touch__btn--${slot}`;
    el.dataset.slot = slot;
    el.dataset.on = 'false';
    el.dataset.hold = 'false';
    el.setAttribute('role', 'button');
    el.innerHTML = RING_SVG; // trusted constant
    const iconEl = doc.createElement('span');
    iconEl.className = 'hp-touch__icon';
    const labelEl = doc.createElement('span');
    labelEl.className = 'hp-touch__label';
    el.append(iconEl, labelEl);
    return { slot, el, iconEl, labelEl, pointers: new Set<number>(), on: false, label: '', icon: null, hold: false };
  }

  private readonly onDocTouchStart = (e: TouchEvent): void => {
    const t = e.target as Node | null;
    const inOverlay = t !== null && typeof t.nodeType === 'number' && this.el.contains(t);
    if (this.visible && (inOverlay || !isInteractive(t))) e.preventDefault();
    else if (e.touches.length > 1 && !isInteractive(t)) e.preventDefault();
  };

  private readonly onDocTouchMove = (e: TouchEvent): void => {
    // Menus may scroll with one finger (settings list); gameplay and multi-touch never move the page.
    if (this.visible || e.touches.length > 1) e.preventDefault();
  };

  // ── Public API (used by the manager) ──────────────────────────────────────

  get isVisible(): boolean {
    return this.visible;
  }

  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    this.el.dataset.visible = v ? 'true' : 'false';
    if (!v) this.reset();
  }

  /** Left-handed layout mirrors the overlay: joystick on the right half, buttons bottom-left. */
  setHand(hand: TouchHand): void {
    const h: TouchHand = hand === 'left' ? 'left' : 'right';
    if (h === this.hand) return;
    this.hand = h;
    this.el.dataset.hand = h;
    this.reset(); // a thumb on the old zone must not keep acting from the other side
  }

  get handedness(): TouchHand {
    return this.hand;
  }

  get moveAxes(): MoveAxes {
    return this.move;
  }

  /** Configure joystick + buttons for an event (null = nothing). DOM touched only on change. */
  setScheme(scheme: ControlScheme | null): void {
    const m = scheme?.move;
    const move: MoveAxes = m === 'x' || m === 'xy' ? m : 'none';
    if (move !== this.move) {
      this.releaseStick();
      const axisChanged = (move === 'x') !== (this.move === 'x');
      this.move = move;
      this.zone.dataset.move = move;
      if (axisChanged) {
        this.base.dataset.axis = move === 'x' ? 'x' : 'xy';
        // Replace only the decoration (the knob and label stay).
        this.base.querySelector('.hp-touch__deco')?.remove();
        this.base.insertAdjacentHTML('afterbegin', move === 'x' ? decoX(this.dims) : decoXY(this.dims));
      }
    }
    const label = move === 'none' ? '' : String(scheme?.moveLabel ?? '');
    if (label !== this.moveLabel) {
      this.moveLabel = label;
      this.moveLabelEl.textContent = label;
    }
    for (const s of ACTION_SLOTS) this.applyButton(this.btns[s], scheme ? scheme[s] : null);
  }

  private applyButton(b: Btn, spec: ButtonSpec | null | undefined): void {
    if (!spec) {
      if (b.on) {
        this.releaseButton(b);
        b.on = false;
        b.el.dataset.on = 'false';
      }
      return;
    }
    if (!b.on) {
      b.on = true;
      b.el.dataset.on = 'true';
    }
    const label = String(spec.label ?? '');
    if (label !== b.label) {
      b.label = label;
      b.labelEl.textContent = label; // never innerHTML: labels are data
      b.el.setAttribute('aria-label', label);
    }
    const icon: ControlIcon = isControlIcon(spec.icon) ? spec.icon : 'go';
    if (icon !== b.icon) {
      b.icon = icon;
      b.iconEl.innerHTML = controlIconSvg(icon); // trusted constant
    }
    const hold = spec.hold === true;
    if (hold !== b.hold) {
      b.hold = hold;
      b.el.dataset.hold = hold ? 'true' : 'false';
    }
  }

  sample(out: TouchSample): void {
    if (this.stickId === null) {
      out.x = 0;
      out.y = 0;
    } else {
      out.x = this.stick.x;
      out.y = this.stick.y;
    }
  }

  get stickActive(): boolean {
    return this.stickId !== null;
  }

  /** The button element for a slot (tests / dev page). */
  buttonEl(slot: ActionSlot): HTMLDivElement {
    return this.btns[slot].el;
  }

  get zoneEl(): HTMLDivElement {
    return this.zone;
  }

  /** Release the stick and all buttons (focus loss, hide, hand switch). Reports button releases. */
  reset(): void {
    this.releaseStick();
    for (const s of ACTION_SLOTS) this.releaseButton(this.btns[s]);
  }

  dispose(): void {
    this.reset();
    this.zone.removeEventListener('pointerdown', this.onZoneDown);
    this.zone.removeEventListener('pointermove', this.onZoneMove);
    this.zone.removeEventListener('pointerup', this.onZoneUp);
    this.zone.removeEventListener('pointercancel', this.onZoneUp);
    this.zone.removeEventListener('lostpointercapture', this.onZoneUp);
    for (const s of ACTION_SLOTS) {
      const el = this.btns[s].el;
      el.removeEventListener('pointerdown', this.onBtnDown);
      el.removeEventListener('pointerup', this.onBtnUp);
      el.removeEventListener('pointercancel', this.onBtnUp);
      el.removeEventListener('lostpointercapture', this.onBtnUp);
    }
    this.el.removeEventListener('contextmenu', preventDefault);
    this.doc.removeEventListener('touchstart', this.onDocTouchStart, NON_PASSIVE);
    this.doc.removeEventListener('touchmove', this.onDocTouchMove, NON_PASSIVE);
    for (const g of GESTURE_EVENTS) this.doc.removeEventListener(g, preventDefault, NON_PASSIVE);
    this.doc.removeEventListener('dblclick', preventDefault, NON_PASSIVE);
    this.el.remove();
    this.releaseStyles();
  }

  // ── Joystick ─────────────────────────────────────────────────────────────

  private readonly onZoneDown = (e: PointerEvent): void => {
    if (!this.visible || this.stickId !== null || this.move === 'none') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.stickId = e.pointerId;
    capture(this.zone, e.pointerId);
    this.tapT = e.timeStamp;
    this.tapX = e.clientX;
    this.tapY = e.clientY;
    this.tapMoved = 0;

    const rect = this.zone.getBoundingClientRect();
    this.zoneLeft = rect.left;
    this.zoneTop = rect.top;
    // Spawn the base where the thumb landed, nudged so enough of it stays inside the zone.
    const mx = this.cfg.radius * 0.6;
    const my = (this.move === 'x' ? this.dims.trackH / 2 : this.cfg.radius) * 0.6;
    this.origin.x = clampInside(e.clientX - rect.left, rect.width, mx);
    this.origin.y = clampInside(e.clientY - rect.top, rect.height, my);
    this.base.classList.remove('is-idle');
    this.applyStick(e.clientX - rect.left, e.clientY - rect.top);
  };

  private readonly onZoneMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickId) return;
    e.preventDefault();
    this.tapMoved = Math.max(this.tapMoved, Math.hypot(e.clientX - this.tapX, e.clientY - this.tapY));
    this.applyStick(e.clientX - this.zoneLeft, e.clientY - this.zoneTop);
  };

  private readonly onZoneUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.stickId) return;
    const tap = e.type === 'pointerup' && isTap(e.timeStamp - this.tapT, this.tapMoved);
    this.releaseStick();
    if (tap) this.forwardTap(e.clientX, e.clientY, e.pointerType);
  };

  /**
   * The joystick zone covers the lower-left of the screen; a quick tap there (not a drag) is meant for what is
   * underneath (a hotspot on the canvas, an activity chip): re-dispatch it as pointerdown/up + click on that element.
   */
  private forwardTap(x: number, y: number, pointerType: string): void {
    const zone = this.zone;
    const prev = zone.style.pointerEvents;
    zone.style.pointerEvents = 'none';
    let target: Element | null = null;
    try {
      target = typeof this.doc.elementFromPoint === 'function' ? this.doc.elementFromPoint(x, y) : null;
    } finally {
      zone.style.pointerEvents = prev;
    }
    if (!target || this.el.contains(target)) return;
    const win = this.doc.defaultView;
    const base = { clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0 };
    const PE = win && typeof win.PointerEvent === 'function' ? win.PointerEvent : null;
    const ME = win ? win.MouseEvent : MouseEvent;
    const ptr = (type: string, buttons: number): Event =>
      PE ? new PE(type, { ...base, buttons, pointerId: TAP_POINTER_ID, pointerType, isPrimary: true }) : new ME(type, { ...base, buttons });
    target.dispatchEvent(ptr('pointerdown', 1));
    target.dispatchEvent(ptr('pointerup', 0));
    target.dispatchEvent(new ME('click', base));
  }

  private applyStick(px: number, py: number): void {
    const xOnly = this.move === 'x';
    followOrigin(this.origin, px, py, this.cfg.radius, xOnly);
    if (xOnly) computeStickX(px - this.origin.x, this.cfg, this.stick);
    else computeStick(px - this.origin.x, py - this.origin.y, this.cfg, this.stick);
    this.base.style.transform = `translate3d(${this.origin.x.toFixed(1)}px, ${this.origin.y.toFixed(1)}px, 0)`;
    this.knob.style.transform = `translate3d(${this.stick.knobX.toFixed(1)}px, ${this.stick.knobY.toFixed(1)}px, 0)`;
    const s = this.stick;
    const dir = (s.x < -0.35 ? 'l ' : s.x > 0.35 ? 'r ' : '') + (s.y > 0.35 ? 'u' : s.y < -0.35 ? 'd' : '');
    if (dir !== this.dirAttr) {
      this.dirAttr = dir;
      this.base.dataset.dir = dir.trim();
    }
  }

  private releaseStick(): void {
    const id = this.stickId;
    this.stickId = null; // clear first: releasing capture may synchronously fire lostpointercapture
    if (id !== null) release(this.zone, id);
    this.stick.x = 0;
    this.stick.y = 0;
    this.stick.knobX = 0;
    this.stick.knobY = 0;
    this.base.classList.add('is-idle');
    this.base.style.transform = '';
    this.knob.style.transform = '';
    if (this.dirAttr !== '') {
      this.dirAttr = '';
      this.base.dataset.dir = '';
    }
  }

  // ── Buttons ──────────────────────────────────────────────────────────────

  private btnFor(el: EventTarget | null): Btn | null {
    for (const s of ACTION_SLOTS) if (this.btns[s].el === el) return this.btns[s];
    return null;
  }

  private readonly onBtnDown = (e: PointerEvent): void => {
    if (!this.visible) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const b = this.btnFor(e.currentTarget);
    if (b === null || !b.on) return;
    e.preventDefault();
    const first = b.pointers.size === 0;
    b.pointers.add(e.pointerId);
    capture(b.el, e.pointerId);
    if (first) {
      b.el.classList.add('is-pressed');
      this.hooks.onButton(b.slot, true);
    }
  };

  private readonly onBtnUp = (e: PointerEvent): void => {
    const b = this.btnFor(e.currentTarget);
    if (b === null || !b.pointers.has(e.pointerId)) return;
    b.pointers.delete(e.pointerId); // before release(): it may fire lostpointercapture synchronously
    release(b.el, e.pointerId);
    if (b.pointers.size === 0) {
      b.el.classList.remove('is-pressed');
      this.hooks.onButton(b.slot, false);
    }
  };

  private releaseButton(b: Btn): void {
    if (b.pointers.size === 0) return;
    const ids = Array.from(b.pointers);
    b.pointers.clear();
    for (const id of ids) release(b.el, id);
    b.el.classList.remove('is-pressed');
    this.hooks.onButton(b.slot, false);
  }
}

function preventDefault(e: Event): void {
  if (e.cancelable) e.preventDefault();
}

const NON_PASSIVE: AddEventListenerOptions = { passive: false };
/** iOS Safari's proprietary pinch events. */
const GESTURE_EVENTS = ['gesturestart', 'gesturechange', 'gestureend'] as const;

/** Real interactive elements (menu buttons, sliders, the UI's pause button) that need their native tap → click. */
function isInteractive(target: EventTarget | null): boolean {
  const el = target as Element | null;
  return (
    !!el &&
    typeof el.closest === 'function' &&
    !!el.closest('button, a, input, select, textarea, label, [role="button"], [data-hp-tap]')
  );
}

/** setPointerCapture is missing in jsdom and throws for stale ids in some browsers. */
function capture(el: HTMLElement, id: number): void {
  try {
    if (typeof el.setPointerCapture === 'function') el.setPointerCapture(id);
  } catch {
    /* ignore */
  }
}

function release(el: HTMLElement, id: number): void {
  try {
    if (typeof el.hasPointerCapture === 'function' && el.hasPointerCapture(id)) el.releasePointerCapture(id);
  } catch {
    /* ignore */
  }
}
