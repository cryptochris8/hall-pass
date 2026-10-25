// Generator step 9 (docs/GDD.md §7): three gummy-bear snack packs per school, off the reference route (so they're a
// detour you choose, never on the safe line), on open floor you can reach, apart from each other and the goals.
// They never affect staff, so placing them after validation keeps the reference route valid. Pure.
import type { Rng } from '../../core/rng';
import { FINE, F_LOW, F_SOLID, type SchoolPlan } from '../types';

const COUNT = 3;
const OFF_ROUTE = 5;
const APART = 9;
const FROM_ANCHOR = 4;

export function placeSnacks(plan: SchoolPlan, reach: Uint8Array, rng: Rng): { x: number; z: number }[] {
  const { cols, rows, flags } = plan.fine;
  const open = (c: number, r: number): boolean => c > 0 && r > 0 && c < cols - 1 && r < rows - 1 && !(flags[r * cols + c]! & (F_SOLID | F_LOW));
  const route = plan.referenceRoute ?? [];
  const anchors = Object.values(plan.anchors).filter((a) => !!a);
  const cand: { x: number; z: number }[] = [];
  // Every 4th fine cell each way (2 m spacing) is plenty of candidates.
  for (let r = 2; r < rows - 2; r += 4) {
    for (let c = 2; c < cols - 2; c += 4) {
      if (reach[r * cols + c] !== 1) continue;
      let roomy = true;
      for (let dr = -1; dr <= 1 && roomy; dr++) for (let dc = -1; dc <= 1 && roomy; dc++) roomy = open(c + dc, r + dr);
      if (!roomy) continue;
      const x = (c + 0.5) * FINE;
      const z = (r + 0.5) * FINE;
      if (anchors.some((a) => (a.x - x) ** 2 + (a.z - z) ** 2 < FROM_ANCHOR * FROM_ANCHOR)) continue;
      if (route.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < OFF_ROUTE * OFF_ROUTE)) continue;
      cand.push({ x, z });
    }
  }
  const out: { x: number; z: number }[] = [];
  while (out.length < COUNT && cand.length > 0) {
    const p = cand.splice(rng.int(0, cand.length - 1), 1)[0]!;
    if (out.some((q) => (q.x - p.x) ** 2 + (q.z - p.z) ** 2 < APART * APART)) continue;
    out.push(p);
  }
  return out;
}
