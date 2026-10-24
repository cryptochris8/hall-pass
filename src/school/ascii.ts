// ASCII floor plan of a SchoolPlan (tools/plan.mjs, debugging). One character per 1 m (2×2 fine cells):
//   # wall/solid   + low furniture   . floor   S start   G goal   C checkpoint   P/T/I/K/W/N/L staff (first stop)
import { CELL_CORRIDOR, FINE, F_LOW, F_SOLID, type SchoolPlan } from './types';

const STAFF_CHAR: Record<string, string> = {
  patroller: 'P',
  sentry: 'T',
  investigator: 'I',
  sweeper: 'K',
  wanderer: 'W',
  snitch: 'N',
  listener: 'L',
};

export function planAscii(plan: SchoolPlan): string {
  const step = Math.round(1 / FINE);
  const cols = Math.floor(plan.fine.cols / step);
  const rows = Math.floor(plan.fine.rows / step);
  const g: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: string[] = [];
    for (let c = 0; c < cols; c++) {
      let solid = 0;
      let low = 0;
      for (let dr = 0; dr < step; dr++) for (let dc = 0; dc < step; dc++) {
        const f = plan.fine.flags[(r * step + dr) * plan.fine.cols + c * step + dc]!;
        if (f & F_SOLID) solid++;
        else if (f & F_LOW) low++;
      }
      line.push(solid >= 2 ? '#' : solid + low >= 2 ? '+' : '.');
    }
    g.push(line);
  }
  const put = (x: number, z: number, ch: string): void => {
    const r = Math.floor(z);
    const c = Math.floor(x);
    if (g[r] && c >= 0 && c < cols) g[r]![c] = ch;
  };
  for (const s of plan.staff) put(s.route[0]!.x, s.route[0]!.z, STAFF_CHAR[s.archetype] ?? '?');
  for (const [id, a] of Object.entries(plan.anchors)) if (a) put(a.x, a.z, id === 'start' ? 'S' : id.startsWith('goal') ? 'G' : 'C');
  const corridors = Array.from(plan.cells).filter((v) => v === CELL_CORRIDOR).length;
  const head = [
    `${plan.name} — ${plan.motto}`,
    `seed ${plan.seed} · tier ${plan.tier} · mission ${plan.mission} · ${plan.grid.cols}×${plan.grid.rows} cells · ${corridors} corridor cells · ${plan.rooms.length} rooms · ${plan.staff.length} staff · rerolls ${plan.rerolls}${plan.fallback ? ' · FALLBACK' : ''}`,
    `rooms: ${plan.rooms.map((r) => r.kind + (r.tags.length ? `(${r.tags.join(',')})` : '')).join(' ')}`,
    `staff: ${plan.staff.map((s) => `${s.archetype}:${s.name}`).join(', ')}`,
  ];
  return head.join('\n') + '\n' + g.map((l) => l.join('')).join('\n');
}
