// ─────────────────────────────────────────────────────────────────────────────
// The share card (docs/GDD.md §8.1): a few lines of plain text and a small picture
// of the floor plan in the style of a fire-evacuation map, with the route you took
// drawn on it. shareText() is pure; drawFloorPlan() paints onto any 2D canvas
// context (the DOM canvas in the game, a stub in tests). No personal data: the
// card says what happened, never who you are.
// ─────────────────────────────────────────────────────────────────────────────
import { CELL, CELL_CORRIDOR, FINE, F_LOW, F_SOLID, type AnchorId, type SchoolPlan } from '../school/types';
import type { HallReport } from '../sim/score';

const MISSION_TITLE: Record<HallReport['mission'], string> = {
  phone: 'PHONE JAIL',
  vending: 'VENDING RUN',
  pizza: 'PIZZA DAY',
  locker: 'LOCKER DROP',
  gym: 'GYM BAG',
  principal: "PRINCIPAL'S OFFICE",
};

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * HALL PASS #61  ·  Westbrook High  ·  JUNIOR
 * PHONE JAIL  ·  2:41  ·  spotted 0×  ·  GHOST  ·  A+
 * H4L-L22-4120
 */
export function shareText(r: HallReport, school: string, code: string, daily: number | null): string {
  const head = daily !== null ? `HALL PASS #${daily}` : 'HALL PASS';
  const time = r.success ? clock(r.seconds) : r.outcome === 'timeout' ? 'late' : 'detention';
  return [
    `${head}  ·  ${school}  ·  ${r.difficulty.toUpperCase()}`,
    `${MISSION_TITLE[r.mission]}  ·  ${time}  ·  spotted ${r.spotted}×  ·  ${r.rank}  ·  ${r.grade}`,
    code,
  ].join('\n');
}

/** The slice of CanvasRenderingContext2D the drawing uses (so tests can pass a stub). */
export type Canvas2D = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
  | 'lineCap'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'strokeRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'stroke'
  | 'fill'
  | 'fillText'
  | 'setLineDash'
>;

export interface PlanPicture {
  /** Canvas size (px) for a plan at this width. */
  width: number;
  height: number;
  /** Metres → px. */
  scale: number;
  /** Header band height (px). */
  header: number;
}

/** Picture layout for a plan drawn `width` px wide (header + map + footer). */
export function planPicture(plan: Pick<SchoolPlan, 'grid'>, width = 640): PlanPicture {
  const header = 64;
  const footer = 40;
  const pad = 16;
  const scale = (width - 2 * pad) / (plan.grid.cols * CELL);
  const height = Math.round(header + footer + plan.grid.rows * CELL * scale + 2 * pad);
  return { width, height, scale, header };
}

const INK = '#1d2433';
const PAPER = '#f4f1ea';

/**
 * Paint the evacuation-map card: corridors tinted, walls in ink, furniture faint, YOU ARE HERE at your desk, the
 * goals in blue, the route in red (with an X where you got busted).
 * @param path flat [x0, z0, x1, z1, …] metres, in order
 */
export function drawFloorPlan(
  g: Canvas2D,
  plan: SchoolPlan,
  path: readonly number[],
  busts: readonly number[],
  title: string,
  footer: string,
  pic = planPicture(plan),
): void {
  const pad = 16;
  const ox = pad;
  const oy = pic.header + pad;
  const s = pic.scale;
  const X = (x: number): number => ox + x * s;
  const Y = (z: number): number => oy + z * s;
  g.fillStyle = PAPER;
  g.fillRect(0, 0, pic.width, pic.height);
  // Header.
  g.fillStyle = '#b5523b';
  g.fillRect(0, 0, pic.width, pic.header - 8);
  g.fillStyle = PAPER;
  g.font = '900 26px "Archivo Black", "Arial Black", system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(title, pad, (pic.header - 8) / 2);
  // Corridors.
  g.fillStyle = '#e6dcc6';
  for (let i = 0; i < plan.cells.length; i++) {
    if (plan.cells[i] !== CELL_CORRIDOR) continue;
    const c = i % plan.grid.cols;
    const r = Math.floor(i / plan.grid.cols);
    g.fillRect(X(c * CELL), Y(r * CELL), CELL * s + 0.5, CELL * s + 0.5);
  }
  // Walls: solid fine cells that touch open floor (the mass outside the building stays paper); furniture faint.
  const { cols, rows, flags } = plan.fine;
  const fs = FINE * s;
  const solid = (c: number, r: number): boolean => c < 0 || r < 0 || c >= cols || r >= rows || (flags[r * cols + c]! & F_SOLID) !== 0;
  const wall = (c: number, r: number): boolean => {
    if (!solid(c, r)) return false;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && !solid(c + dc, r + dr)) return true;
    return false;
  };
  for (const [test, colour] of [
    [(c: number, r: number): boolean => (flags[r * cols + c]! & (F_SOLID | F_LOW)) === F_LOW, 'rgba(29,36,51,.18)'],
    [wall, INK],
  ] as const) {
    g.fillStyle = colour;
    for (let r = 0; r < rows; r++) {
      let c0 = -1;
      for (let c = 0; c <= cols; c++) {
        const on = c < cols && test(c, r);
        if (on && c0 < 0) c0 = c;
        if (!on && c0 >= 0) {
          g.fillRect(X(c0 * FINE), Y(r * FINE), (c - c0) * fs + 0.4, fs + 0.4);
          c0 = -1;
        }
      }
    }
  }
  // Goals.
  g.fillStyle = '#2e8bff';
  for (const id of ['goal', 'goal2', 'goal3'] as AnchorId[]) {
    const a = plan.anchors[id];
    // Only this mission's goals (the office's drawer anchor exists on every plan; only the finale uses it).
    if (!a || (id !== 'goal' && plan.mission !== 'principal')) continue;
    g.beginPath();
    g.arc(X(a.x), Y(a.z), 6, 0, Math.PI * 2);
    g.fill();
  }
  // Route.
  if (path.length >= 4) {
    g.strokeStyle = '#e0453a';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(X(path[0]!), Y(path[1]!));
    for (let i = 2; i + 1 < path.length; i += 2) g.lineTo(X(path[i]!), Y(path[i + 1]!));
    g.stroke();
  }
  g.strokeStyle = '#e0453a';
  g.lineWidth = 3;
  for (let i = 0; i + 1 < busts.length; i += 2) {
    const x = X(busts[i]!);
    const y = Y(busts[i + 1]!);
    g.beginPath();
    g.moveTo(x - 6, y - 6);
    g.lineTo(x + 6, y + 6);
    g.moveTo(x + 6, y - 6);
    g.lineTo(x - 6, y + 6);
    g.stroke();
  }
  // YOU ARE HERE (your desk).
  const st = plan.anchors.start!;
  g.fillStyle = '#2b8a6e';
  g.beginPath();
  g.arc(X(st.x), Y(st.z), 7, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = INK;
  g.font = '800 12px system-ui, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText('YOU ARE HERE', X(st.x) + 10, Y(st.z));
  // Footer.
  g.fillStyle = INK;
  g.font = '800 15px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(footer, pad, pic.height - 20);
}
