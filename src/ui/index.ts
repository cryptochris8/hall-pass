// ─────────────────────────────────────────────────────────────────────────────
// Menus (docs/GDD.md §1, docs/ARCHITECTURE.md §7–8). One full-screen layer
// above the HUD shows one screen at a time, described by a ScreenSpec: a title
// block, optional custom content, and a list of items (buttons and left/right
// choices). Keyboard / gamepad drive it through MenuActions (up/down/left/right/
// confirm/back); pointer clicks work directly. No framework; every string is set
// with textContent (user text included).
// ─────────────────────────────────────────────────────────────────────────────
import type { MenuAction } from '../input/types';
import { MENU_CSS } from './styles';

export type Item =
  | { kind: 'button'; label: string; sub?: string; right?: string; primary?: boolean; disabled?: boolean; onPick: () => void }
  | {
      kind: 'choice';
      label: string;
      sub?: string;
      options: readonly { value: string; label: string }[];
      value: string;
      onChange: (value: string) => void;
    };

export interface ScreenSpec {
  id: string;
  /** 'menu' (default): a column; 'title': the logo screen; 'card': the mission card; 'report': the Hall Report. */
  layout?: 'menu' | 'title' | 'card' | 'report';
  kicker?: string;
  title?: string;
  subtitle?: string;
  /** Custom content between the heading and the items (built with el()). */
  body?: (HTMLElement | null)[];
  items: Item[];
  /** Items in a row (buttons under the report). */
  row?: boolean;
  /** Initially focused item. */
  focus?: number;
  onBack?: () => void;
  /** Any confirm / tap anywhere picks this (title "press start", mission card "go"). */
  onAny?: () => void;
  /** Lighter backdrop (the 3D scene shows through). */
  clear?: boolean;
  /** Panel at the side (left; bottom on a portrait phone) so the 3D scene shows (LOCKER). */
  side?: boolean;
  /** A text field (challenge codes). Enter submits; Esc goes back. What's typed is only ever read as text. */
  input?: { label: string; value: string; placeholder: string; maxLength: number; error?: string | null; autofocus?: boolean; onSubmit: (value: string) => void };
}

/** Tiny DOM helper: text always via textContent. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string, children: (Node | null)[] = []): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  for (const c of children) if (c) e.appendChild(c);
  return e;
}

export class Ui {
  readonly root: HTMLDivElement;
  private spec: ScreenSpec | null = null;
  private nodes: HTMLElement[] = [];
  private focus = 0;
  private choiceVals: string[] = [];
  private readonly mouse = { moved: false };

  /** UI blips (wired to the audio engine by the app). */
  sound: ((kind: 'move' | 'confirm' | 'back') => void) | null = null;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = MENU_CSS;
    document.head.appendChild(style);
    this.root = el('div', 'hp-menu');
    this.root.hidden = true;
    this.root.addEventListener('pointermove', () => (this.mouse.moved = true));
    this.root.addEventListener('click', (e) => {
      if (this.spec?.onAny && (e.target === this.root || !(e.target as HTMLElement).closest('button'))) this.spec.onAny();
    });
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  private field: HTMLInputElement | null = null;

  /** Show (or clear) the input field's error line without rebuilding the screen. */
  setInputError(msg: string | null): void {
    const wrap = this.field?.parentElement;
    if (!wrap) return;
    let e = wrap.querySelector('.hp-error');
    if (!msg) {
      e?.remove();
      return;
    }
    if (!e) {
      e = el('small', 'hp-error');
      wrap.append(e);
    }
    e.textContent = msg;
    this.field?.focus({ preventScroll: true });
  }

  /** Current text of the screen's input field ('' if none). */
  get inputValue(): string {
    return this.field?.value ?? '';
  }

  get screenId(): string | null {
    return this.visible ? (this.spec?.id ?? null) : null;
  }

  hide(): void {
    this.root.hidden = true;
    this.root.textContent = '';
    this.spec = null;
    this.nodes = [];
  }

  show(spec: ScreenSpec): void {
    this.spec = spec;
    this.root.textContent = '';
    this.root.hidden = false;
    this.root.classList.toggle('hp-clear', spec.clear === true);
    this.root.classList.toggle('hp-side', spec.side === true);
    this.mouse.moved = false;
    const layout = spec.layout ?? 'menu';
    const screen = el('div', `hp-screen hp-layout-${layout}`);
    if (layout === 'title') {
      const logo = el('h1', 'hp-logo', 'HALL PASS');
      logo.appendChild(el('small', '', 'A STEALTH COMEDY'));
      screen.append(logo);
      if (spec.subtitle) screen.append(el('p', 'hp-tag', spec.subtitle));
    } else if (layout !== 'report') {
      if (spec.kicker) screen.append(el('div', 'hp-kicker', spec.kicker));
      if (spec.title) screen.append(el('h2', 'hp-h1', spec.title));
      if (spec.subtitle) screen.append(el('p', 'hp-sub', spec.subtitle));
    }
    for (const b of spec.body ?? []) if (b) screen.append(b);
    this.field = null;
    if (spec.input) {
      const inp = spec.input;
      const wrap = el('label', 'hp-field', undefined, [el('span', '', inp.label)]);
      const f = document.createElement('input');
      f.type = 'text';
      f.value = inp.value;
      f.placeholder = inp.placeholder;
      f.maxLength = inp.maxLength;
      f.autocomplete = 'off';
      f.spellcheck = false;
      f.setAttribute('autocapitalize', 'characters');
      f.setAttribute('enterkeyhint', 'go');
      f.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.sound?.('confirm');
          inp.onSubmit(f.value);
        }
      });
      wrap.append(f);
      if (inp.error) wrap.append(el('small', 'hp-error', inp.error));
      screen.append(wrap);
      this.field = f;
    }
    const list = el('div', `hp-items${spec.row ? ' hp-row' : ''}`);
    this.nodes = [];
    this.choiceVals = [];
    spec.items.forEach((it, i) => {
      const b = el('button', `hp-item${it.kind === 'choice' ? ' hp-choice' : ''}${it.kind === 'button' && it.primary ? ' hp-primary' : ''}`);
      b.type = 'button';
      b.tabIndex = -1;
      const l = el('span', 'hp-l', undefined, [el('b', '', it.label), it.sub ? el('small', '', it.sub) : null]);
      b.append(l);
      if (it.kind === 'button') {
        if (it.right) b.append(el('span', 'hp-r', it.right));
        if (it.disabled) b.setAttribute('aria-disabled', 'true');
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setFocus(i);
          this.activate();
        });
      } else {
        this.choiceVals[i] = it.value;
        const r = el('span', 'hp-r');
        const prev = el('span', 'hp-arrow', '‹');
        const val = el('span', '', '');
        const next = el('span', 'hp-arrow', '›');
        r.append(prev, val, next);
        b.append(r);
        prev.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setFocus(i);
          this.cycle(-1);
        });
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          this.setFocus(i);
          this.cycle(1);
        });
      }
      b.addEventListener('pointerenter', () => {
        if (this.mouse.moved) this.setFocus(i);
      });
      list.append(b);
      this.nodes.push(b);
    });
    if (spec.items.length > 0) screen.append(list);
    this.root.append(screen);
    if (this.field && spec.input?.autofocus !== false) {
      const f = this.field;
      setTimeout(() => {
        try {
          f.focus({ preventScroll: true });
          f.setSelectionRange(f.value.length, f.value.length);
        } catch {
          /* not focusable (hidden) */
        }
      }, 30);
    }
    this.refreshChoices();
    this.setFocus(Math.min(spec.focus ?? 0, Math.max(0, spec.items.length - 1)));
  }

  /** Feed this frame's menu actions. Returns true if the UI used them. */
  handle(actions: readonly MenuAction[]): boolean {
    const spec = this.spec;
    if (!spec || this.root.hidden) return false;
    let used = false;
    for (const a of actions) {
      used = true;
      if (spec.onAny && (a === 'confirm' || a === 'pause')) {
        this.sound?.('confirm');
        spec.onAny();
        return true;
      }
      const it = spec.items[this.focus];
      if (a === 'up' || a === 'prev') this.move(-1);
      else if (a === 'down' || a === 'next') this.move(1);
      else if (a === 'left' || a === 'right') {
        if (it?.kind === 'choice') this.cycle(a === 'left' ? -1 : 1);
        else if (spec.row) this.move(a === 'left' ? -1 : 1);
      } else if (a === 'confirm') this.activate();
      else if ((a === 'back' || a === 'pause') && spec.onBack) {
        this.sound?.('back');
        spec.onBack();
      }
      if (this.spec !== spec) return true; // the action changed screens
    }
    return used;
  }

  private move(d: number): void {
    const n = this.nodes.length;
    if (n === 0) return;
    let i = this.focus;
    for (let k = 0; k < n; k++) {
      i = (i + d + n) % n;
      const it = this.spec!.items[i]!;
      if (!(it.kind === 'button' && it.disabled)) break;
    }
    if (i !== this.focus) this.sound?.('move');
    this.setFocus(i);
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.nodes.forEach((n, k) => n.classList.toggle('hp-focus', k === i));
    this.nodes[i]?.scrollIntoView?.({ block: 'nearest' });
  }

  private activate(): void {
    const it = this.spec?.items[this.focus];
    if (!it) return;
    if (it.kind === 'button') {
      if (it.disabled) return;
      this.sound?.('confirm');
      it.onPick();
    } else this.cycle(1);
  }

  private cycle(d: number): void {
    const it = this.spec?.items[this.focus];
    if (!it || it.kind !== 'choice') return;
    const opts = it.options;
    const cur = Math.max(0, opts.findIndex((o) => o.value === this.choiceVals[this.focus]));
    const next = opts[(cur + d + opts.length) % opts.length]!;
    this.choiceVals[this.focus] = next.value;
    this.sound?.('move');
    this.refreshChoices();
    it.onChange(next.value);
  }

  private refreshChoices(): void {
    this.spec?.items.forEach((it, i) => {
      if (it.kind !== 'choice') return;
      const label = it.options.find((o) => o.value === this.choiceVals[i])?.label ?? '';
      const span = this.nodes[i]?.querySelector('.hp-r span:nth-child(2)');
      if (span) span.textContent = label;
    });
  }
}
