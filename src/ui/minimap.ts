// ─────────────────────────────────────────────────────────────────────────────
// Mini-map (docs/ARCHITECTURE.md §8): a small 2D canvas in the top-right corner,
// drawn from the SchoolPlan like a fire-evacuation map — corridors, walls, YOU
// ARE HERE. The static plan is drawn once per school to an offscreen canvas;
// each frame only blits it and draws a few marks: the goal(s) still to get, your
// desk once you have everything, staff (only while near you or alerted, so the
// map never gives away a whole patrol), and you as an arrow. North-up.
// Structure after TRASH PANDA TROUBLE's minimap.ts.
// ─────────────────────────────────────────────────────────────────────────────
import { CELL, CELL_CORRIDOR, FINE, F_SOLID, type SchoolPlan } from '../school/types';
import type { SimState, SuspicionLevel } from '../sim/types';

/** Staff further than this (m) only show when alerted. */
export const MAP_NEAR = 14;

const LEVEL_DOT: Readonly<Record<SuspicionLevel, string>> = {
  calm: '#5a6378',
  curious: '#f2c230',
  searching: '#ff9a2e',
  spotted: '#e0453a',
};

/** Dot colour for a staff member (chases and searches count as spotted / searching). */
export function staffDot(level: SuspicionLevel, mode: string): string {
  if (mode === 'chase') return LEVEL_DOT.spotted;
  if (mode === 'search' || mode === 'investigate') return level === 'calm' ? LEVEL_DOT.curious : LEVEL_DOT[level];
  return LEVEL_DOT[level];
}

/** Whether a staff member shows on the map: near the student, or not calm. */
export function staffVisible(dist: number, level: SuspicionLevel, mode: string): boolean {
  return dist <= MAP_NEAR || level !== 'calm' || mode === 'chase' || mode === 'search';
}

export class Minimap {
  readonly el: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private base: HTMLCanvasElement | null = null;
  private plan: SchoolPlan | null = null;
  private key = '';
  private scale = 1;
  private pad = 0;
  private dpr = 1;
  private frames = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hp-minimap';
    this.el.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    parent.appendChild(this.el);
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      // jsdom has no canvas (it would log "not implemented" on every call).
      const jsdom = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
      ctx = jsdom ? null : this.canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    this.ctx = ctx;
  }

  setVisible(on: boolean): void {
    if (this.el.hidden === !on) return;
    this.el.hidden = !on;
  }

  update(plan: SchoolPlan, s: SimState): void {
    if (this.el.hidden || !this.ctx) return;
    // Size follows CSS (phones get a smaller map); the height keeps the school's aspect.
    if (this.frames++ % 30 === 0 || this.plan !== plan) {
      const w = Math.round(this.el.clientWidth || 160);
      const dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
      const aspect = plan.grid.rows / plan.grid.cols;
      const h = Math.round(w * aspect);
      const key = `${plan.seed}:${plan.tier}:${plan.mission}:${w}:${dpr}`;
      if (key !== this.key || this.plan !== plan) {
        this.key = key;
        this.plan = plan;
        this.dpr = dpr;
        this.el.style.height = `${h}px`;
        this.canvas.width = Math.round(w * dpr);
        this.canvas.height = Math.round(h * dpr);
        this.drawBase(plan);
      }
    }
    this.drawDynamic(plan, s);
  }

  private drawBase(plan: SchoolPlan): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const base = document.createElement('canvas');
    base.width = W;
    base.height = H;
    this.base = base;
    const g = base.getContext('2d');
    if (!g) return;
    this.pad = 3 * this.dpr;
    this.scale = Math.min((W - 2 * this.pad) / (plan.grid.cols * CELL), (H - 2 * this.pad) / (plan.grid.rows * CELL));
    const X = (x: number): number => this.pad + x * this.scale;
    const Y = (z: number): number => this.pad + z * this.scale;
    g.fillStyle = '#f4f1ea';
    g.fillRect(0, 0, W, H);
    // Corridors.
    g.fillStyle = '#e2d6bb';
    for (let i = 0; i < plan.cells.length; i++) {
      if (plan.cells[i] !== CELL_CORRIDOR) continue;
      const c = i % plan.grid.cols;
      const r = Math.floor(i / plan.grid.cols);
      g.fillRect(X(c * CELL), Y(r * CELL), CELL * this.scale + 0.5, CELL * this.scale + 0.5);
    }
    // Walls: solid cells touching open floor (desks left out: too busy at this size).
    const { cols, rows, flags } = plan.fine;
    const fs = FINE * this.scale;
    const solid = (c: number, r: number): boolean => c < 0 || r < 0 || c >= cols || r >= rows || (flags[r * cols + c]! & F_SOLID) !== 0;
    const wall = (c: number, r: number): boolean => {
      if (!solid(c, r)) return false;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && !solid(c + dc, r + dr)) return true;
      return false;
    };
    for (const [test, colour] of [[wall, '#1d2433']] as const) {
      g.fillStyle = colour;
      for (let r = 0; r < rows; r++) {
        let c0 = -1;
        for (let c = 0; c <= cols; c++) {
          const on = c < cols && test(c, r);
          if (on && c0 < 0) c0 = c;
          if (!on && c0 >= 0) {
            g.fillRect(X(c0 * FINE), Y(r * FINE), (c - c0) * fs + 0.3, fs + 0.3);
            c0 = -1;
          }
        }
      }
    }
  }

  private drawDynamic(plan: SchoolPlan, s: SimState): void {
    const g = this.ctx!;
    if (!this.base) return;
    const r = this.dpr;
    const X = (x: number): number => this.pad + x * this.scale;
    const Y = (z: number): number => this.pad + z * this.scale;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.base, 0, 0);
    // The next goal (blue, pulsing); your desk (green) once everything is collected.
    const goals = (['goal', 'goal2', 'goal3'] as const).filter((id) => plan.anchors[id] && (id === 'goal' || plan.mission === 'principal'));
    const left = goals.filter((id) => !s.collected.includes(id));
    const pulse = 1 + 0.25 * Math.sin(s.tick / 9);
    if (left.length > 0) {
      for (const id of left) {
        const a = plan.anchors[id]!;
        g.fillStyle = '#2e8bff';
        g.beginPath();
        g.arc(X(a.x), Y(a.z), 3.2 * r * pulse, 0, Math.PI * 2);
        g.fill();
      }
    } else {
      const d = plan.anchors.start!;
      g.strokeStyle = '#2b8a6e';
      g.lineWidth = 2 * r;
      g.beginPath();
      g.arc(X(d.x), Y(d.z), 4 * r * pulse, 0, Math.PI * 2);
      g.stroke();
    }
    // Staff: near you or alerted only. Cameras are small squares.
    const st = s.student;
    g.lineWidth = 1 * r;
    g.strokeStyle = '#1d2433';
    s.staff.forEach((o, i) => {
      const dist = Math.sqrt((o.x - st.x) * (o.x - st.x) + (o.z - st.z) * (o.z - st.z));
      if (!staffVisible(dist, o.level, o.mode)) return;
      g.fillStyle = staffDot(o.level, o.mode);
      if (plan.staff[i]!.archetype === 'sweeper') {
        const q = 2.6 * r;
        g.fillRect(X(o.x) - q / 2, Y(o.z) - q / 2, q, q);
      } else {
        g.beginPath();
        g.arc(X(o.x), Y(o.z), 2.6 * r, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      }
    });
    // You: an arrow in the facing direction (a ring while hidden).
    const px = X(st.x);
    const pz = Y(st.z);
    if (st.hidden >= 0) {
      g.strokeStyle = '#2b8a6e';
      g.lineWidth = 2 * r;
      g.beginPath();
      g.arc(px, pz, 3.4 * r, 0, Math.PI * 2);
      g.stroke();
      return;
    }
    const fx = Math.sin(st.yaw);
    const fz = Math.cos(st.yaw);
    const k = 7 * r;
    g.fillStyle = '#21b27f';
    g.strokeStyle = '#1d2433';
    g.lineWidth = 1.6 * r;
    g.beginPath();
    g.moveTo(px + fx * k, pz + fz * k);
    g.lineTo(px - fx * k * 0.6 + fz * k * 0.65, pz - fz * k * 0.6 - fx * k * 0.65);
    g.lineTo(px - fx * k * 0.25, pz - fz * k * 0.25);
    g.lineTo(px - fx * k * 0.6 - fz * k * 0.65, pz - fz * k * 0.6 + fx * k * 0.65);
    g.closePath();
    g.fill();
    g.stroke();
  }
}
