// ─────────────────────────────────────────────────────────────────────────────
// Grey-box HUD + tuning panel (milestone M1). The real UI module (src/ui, M4)
// replaces this. The panel exists for the phone test (docs/GDD.md open question
// 1): change seed / tier / mission / difficulty and the camera (pitch, distance,
// FOV, wall mode, cones) live on the device and read the numbers back.
// All text via textContent; buttons are real <button>s.
// ─────────────────────────────────────────────────────────────────────────────
import type { Difficulty, MissionId, TierId } from '../school/types';
import { DIFFICULTIES, MISSION_IDS } from '../school/types';
import type { SuspicionLevel } from '../sim/types';
import type { WallMode } from '../world/school';

export interface CameraSettings {
  pitch: number;
  distance: number;
  fov: number;
  walls: WallMode;
  cones: boolean;
}

export interface HudActions {
  newRun(change: { seed?: number; tier?: TierId; mission?: MissionId; difficulty?: Difficulty }): void;
  camera(change: Partial<CameraSettings>): void;
  pause(on: boolean): void;
}

export interface HudModel {
  bellTicks: number;
  missionLine: string;
  passes: number;
  catches: number;
  school: string;
  seed: number;
  tier: TierId;
  mission: MissionId;
  difficulty: Difficulty;
  camera: CameraSettings;
  stats: string;
}

const MISSION_NAME: Record<MissionId, string> = {
  phone: 'PHONE JAIL',
  vending: 'VENDING RUN',
  pizza: 'PIZZA DAY',
  locker: 'LOCKER DROP',
  gym: 'GYM BAG',
  principal: "PRINCIPAL'S OFFICE",
};

export function missionName(m: MissionId): string {
  return MISSION_NAME[m];
}

const CSS = `
.hp-ui [hidden] { display: none !important; }
.hp-ui { position: absolute; inset: 0; z-index: 3; pointer-events: none; color: #f4f1ea;
  font: 600 14px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.hp-ui button { pointer-events: auto; font: inherit; color: #1d2433; background: #f4f1ea; border: 0; border-radius: 8px;
  padding: 7px 10px; min-width: 36px; min-height: 36px; cursor: pointer; }
.hp-ui button[aria-pressed="true"] { background: #2e8bff; color: #fff; }
.hp-ui button:focus-visible { outline: 3px solid #ffd34d; outline-offset: 2px; }
.hp-top { position: absolute; left: max(12px, env(safe-area-inset-left)); right: max(12px, env(safe-area-inset-right));
  top: max(10px, env(safe-area-inset-top)); display: flex; gap: 12px; align-items: flex-start; }
.hp-bell { font: 700 30px/1 ui-monospace, 'SFMono-Regular', Menlo, monospace; font-variant-numeric: tabular-nums;
  background: rgba(29,36,51,.78); padding: 6px 10px; border-radius: 10px; }
.hp-bell.hp-red { color: #ff6b5e; }
.hp-mission { background: rgba(29,36,51,.78); padding: 6px 10px; border-radius: 10px; max-width: 46ch; }
.hp-mission small { display: block; opacity: .75; font-weight: 500; }
.hp-spacer { flex: 1; }
.hp-gear { font-size: 20px !important; }
.hp-panel { position: absolute; right: max(12px, env(safe-area-inset-right)); top: calc(max(10px, env(safe-area-inset-top)) + 52px);
  bottom: max(10px, env(safe-area-inset-bottom)); width: min(340px, calc(100vw - 24px)); overflow: auto; pointer-events: auto;
  background: rgba(20,25,38,.94); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.hp-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.hp-row > b { width: 100%; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }
.hp-val { min-width: 64px; text-align: center; font-variant-numeric: tabular-nums; }
.hp-stats { font: 500 12px/1.4 ui-monospace, Menlo, monospace; opacity: .8; white-space: pre-wrap; }
.hp-banner { position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); text-align: center;
  background: rgba(29,36,51,.9); padding: 16px 22px; border-radius: 14px; max-width: min(90vw, 520px); pointer-events: auto; }
.hp-banner strong { display: block; font: 800 34px/1.05 system-ui, sans-serif; letter-spacing: .02em; }
.hp-banner span { display: block; margin-top: 8px; font-weight: 500; opacity: .9; }
.hp-mark { position: absolute; transform: translate(-50%, -100%); font: 900 26px/1 system-ui, sans-serif;
  text-shadow: 0 2px 0 #1d2433, 0 0 6px #1d2433; }
.hp-mark.hp-curious { color: #ffd34d; } .hp-mark.hp-searching { color: #ff9a2e; } .hp-mark.hp-spotted { color: #ff3b3b; }
.hp-hint { position: absolute; left: 50%; bottom: max(10px, env(safe-area-inset-bottom)); transform: translateX(-50%);
  background: rgba(29,36,51,.6); padding: 4px 10px; border-radius: 8px; font-weight: 500; font-size: 12px; white-space: nowrap; }
@media (pointer: coarse) { .hp-hint { display: none; } }
@media (max-height: 500px) {
  .hp-bell { font-size: 20px; padding: 4px 8px; }
  .hp-mission { font-size: 12px; padding: 4px 8px; max-width: 52vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hp-mission small { font-size: 11px; }
  .hp-ui button { min-height: 32px; padding: 5px 8px; }
  .hp-panel { top: calc(max(8px, env(safe-area-inset-top)) + 40px); }
}
`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
}

export class Hud {
  readonly root: HTMLDivElement;
  private readonly bell: HTMLDivElement;
  private readonly mission: HTMLDivElement;
  private readonly missionSub: HTMLElement;
  private readonly panel: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly marks: HTMLDivElement[] = [];
  private readonly vals = new Map<string, HTMLSpanElement>();
  private readonly toggles: { key: string; value: string; btn: HTMLButtonElement }[] = [];
  private bannerTap: (() => void) | null = null;
  private model: HudModel | null = null;

  constructor(app: HTMLElement, private readonly actions: HudActions) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = el('div', 'hp-ui', app);
    const top = el('div', 'hp-top', this.root);
    this.bell = el('div', 'hp-bell', top, '3:00');
    this.mission = el('div', 'hp-mission', top);
    this.missionSub = document.createElement('small');
    el('div', 'hp-spacer', top);
    const gear = el('button', 'hp-gear', top, '⚙');
    gear.setAttribute('aria-label', 'Tuning panel');
    this.panel = el('div', 'hp-panel', this.root);
    this.panel.hidden = true;
    gear.addEventListener('click', () => this.togglePanel());
    this.buildPanel();
    this.stats = el('div', 'hp-stats', this.panel);
    this.banner = el('div', 'hp-banner', this.root);
    this.banner.hidden = true;
    this.banner.addEventListener('click', () => this.bannerTap?.());
    el('div', 'hp-hint', this.root, 'WASD / arrows move · hold E sneak · hold Shift sprint · Space grab · Esc tuning');
  }

  get panelOpen(): boolean {
    return !this.panel.hidden;
  }

  togglePanel(force?: boolean): void {
    this.panel.hidden = force !== undefined ? !force : !this.panel.hidden;
    this.actions.pause(!this.panel.hidden);
  }

  private row(label: string): HTMLDivElement {
    const r = el('div', 'hp-row', this.panel);
    el('b', '', r, label);
    return r;
  }

  private stepper(label: string, key: string, onStep: (dir: -1 | 1) => void, extra?: (r: HTMLDivElement) => void): void {
    const r = this.row(label);
    el('button', '', r, '−').addEventListener('click', () => onStep(-1));
    this.vals.set(key, el('span', 'hp-val', r, ''));
    el('button', '', r, '+').addEventListener('click', () => onStep(1));
    extra?.(r);
  }

  private choice(label: string, key: string, values: readonly string[], names: (v: string) => string, pick: (v: string) => void): void {
    const r = this.row(label);
    for (const v of values) {
      const b = el('button', '', r, names(v));
      b.addEventListener('click', () => pick(v));
      this.toggles.push({ key, value: v, btn: b });
    }
  }

  private buildPanel(): void {
    const m = (): HudModel => this.model!;
    this.stepper('Seed', 'seed', (d) => this.actions.newRun({ seed: (m().seed + d) >>> 0 }), (r) => {
      el('button', '', r, 'Random').addEventListener('click', () => this.actions.newRun({ seed: (Math.random() * 1e6) >>> 0 }));
      el('button', '', r, 'Restart').addEventListener('click', () => this.actions.newRun({}));
    });
    this.choice('School tier', 'tier', ['1', '2', '3', '4', '5'], (v) => v, (v) => this.actions.newRun({ tier: Number(v) as TierId }));
    this.choice('Mission', 'mission', MISSION_IDS, (v) => MISSION_NAME[v as MissionId], (v) => this.actions.newRun({ mission: v as MissionId }));
    this.choice('Difficulty', 'difficulty', DIFFICULTIES, (v) => v.toUpperCase(), (v) => this.actions.newRun({ difficulty: v as Difficulty }));
    const presets: Record<string, Partial<CameraSettings>> = {
      'Close (Trash Panda)': { pitch: 46, distance: 12, fov: 48 },
      Mid: { pitch: 52, distance: 18, fov: 45 },
      Tactical: { pitch: 60, distance: 28, fov: 40 },
    };
    const pr = this.row('Camera preset');
    for (const [name, c] of Object.entries(presets)) el('button', '', pr, name).addEventListener('click', () => this.actions.camera(c));
    this.stepper('Camera pitch (°)', 'pitch', (d) => this.actions.camera({ pitch: Math.min(85, Math.max(30, m().camera.pitch + d * 5)) }));
    this.stepper('Camera distance (m)', 'distance', (d) => this.actions.camera({ distance: Math.min(40, Math.max(8, m().camera.distance + d * 2)) }));
    this.stepper('Field of view (°)', 'fov', (d) => this.actions.camera({ fov: Math.min(70, Math.max(20, m().camera.fov + d * 5)) }));
    this.choice('Walls', 'walls', ['occlude', 'cutaway', 'low', 'full'], (v) => v, (v) => this.actions.camera({ walls: v as WallMode }));
    this.choice('Vision cones', 'cones', ['on', 'off'], (v) => v, (v) => this.actions.camera({ cones: v === 'on' }));
  }

  update(model: HudModel): void {
    this.model = model;
    const secs = Math.ceil(model.bellTicks / 60);
    this.bell.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    this.bell.classList.toggle('hp-red', secs <= 30);
    const passes = '●'.repeat(model.passes) || '—';
    this.mission.textContent = `${MISSION_NAME[model.mission]} · ${model.missionLine}`;
    this.missionSub.textContent = `${model.school} · hall passes ${passes} · busted ${model.catches}/3`;
    this.mission.appendChild(this.missionSub);
    if (!this.panel.hidden) {
      this.vals.get('seed')!.textContent = String(model.seed);
      this.vals.get('pitch')!.textContent = String(model.camera.pitch);
      this.vals.get('distance')!.textContent = String(model.camera.distance);
      this.vals.get('fov')!.textContent = String(model.camera.fov);
      const cur: Record<string, string> = {
        tier: String(model.tier),
        mission: model.mission,
        difficulty: model.difficulty,
        walls: model.camera.walls,
        cones: model.camera.cones ? 'on' : 'off',
      };
      for (const t of this.toggles) t.btn.setAttribute('aria-pressed', String(cur[t.key] === t.value));
      this.stats.textContent = model.stats;
    }
  }

  /** Place ?/! markers (screen px) for every staff member; null hides one. */
  markers(points: ({ x: number; y: number; level: SuspicionLevel } | null)[]): void {
    while (this.marks.length < points.length) this.marks.push(el('div', 'hp-mark', this.root));
    this.marks.forEach((m, i) => {
      const p = points[i];
      if (!p || p.level === 'calm') {
        m.hidden = true;
        return;
      }
      m.hidden = false;
      m.className = `hp-mark hp-${p.level}`;
      m.textContent = p.level === 'spotted' ? '!' : '?';
      m.style.left = `${p.x}px`;
      m.style.top = `${p.y}px`;
    });
  }

  showBanner(title: string, sub: string, onTap: (() => void) | null): void {
    this.banner.hidden = false;
    this.banner.textContent = '';
    el('strong', '', this.banner, title);
    el('span', '', this.banner, sub);
    this.bannerTap = onTap;
  }

  hideBanner(): void {
    this.banner.hidden = true;
    this.bannerTap = null;
  }

  get bannerVisible(): boolean {
    return !this.banner.hidden;
  }
}
