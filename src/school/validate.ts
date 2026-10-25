// ─────────────────────────────────────────────────────────────────────────────
// Fairness validator (docs/GDD.md §3.1, docs/ARCHITECTURE.md §4). Proves a
// school can be done unseen and unheard inside the bell budget, and returns that
// route (the bot follows it; hints and par come from it).
//
// It runs the REAL sim with no student (createSim … { absent: true }): staff then
// follow their routes and PA errands only, a pure function of the plan. Every
// 0.25 s it records what each staff member can see (the sim's own sees()) and
// where they'd hear walking footsteps, dilates that in space (one cell) and time
// (the difficulty's clearance), then A* searches (cell, time, goals done) for
// start → each goal → back to your desk. Moves: wait, walk one cell (silent
// only away from staff), or sneak one cell (slower, silent anywhere unseen).
// Pure and deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import { createSim, step, NO_INPUT } from '../sim';
import { fcos, fsin } from '../core/fmath';
import { inZone } from '../sim/detect';
import { canStep, openAt } from '../sim/nav';
import { MISSION_RULES, NOISE, hearingOf, lunchTick } from '../sim/tuning';
import { FINE, F_LOW, F_SOLID, type AnchorId, type Difficulty, type RoutePoint, type SchoolPlan } from './types';

/** Rays per cone fan when marking sight (≈ 1.5° apart for a 50° cone: < 0.3 m apart at 10 m). */
const FAN_RAYS = 32;

/** Ticks per validator time step (0.25 s). */
export const V_STEP = 15;

export const CLEARANCE: Readonly<Record<Difficulty, { seconds: number; budget: number }>> = {
  freshman: { seconds: 1.0, budget: 0.7 },
  junior: { seconds: 0.6, budget: 0.8 },
  senior: { seconds: 0.4, budget: 0.9 },
};

export interface ValidateResult {
  ok: boolean;
  route: RoutePoint[] | null;
  /** Seconds the route takes (null when none). */
  seconds: number | null;
  expanded: number;
  reason?: 'noPath' | 'overBudget' | 'expansionCap';
}

const GOALS: readonly AnchorId[] = ['goal', 'goal2', 'goal3'];

export function validatePlan(
  plan: SchoolPlan,
  difficulty: Difficulty,
  opts: { maxExpand?: number; clearance?: Difficulty; probe?: (blocked: (t: number, x: number, z: number) => boolean, raw: (t: number, x: number, z: number) => boolean) => void } = {},
): ValidateResult {
  const { cols, rows, flags } = plan.fine;
  const N = cols * rows;
  const T = Math.floor(plan.bellTicks / V_STEP) + 1;

  // ── 1. Run the staff alone and mark what they see / hear at every step ──
  const config = { seed: plan.seed, mission: plan.mission, tier: plan.tier, difficulty, daily: null };
  const sim = createSim(plan, config, { absent: true });
  // Bitsets are row-aligned (RW words per grid row) so a one-cell spatial dilation is a few shifts and ORs per row.
  const RW = (cols + 31) >>> 5;
  const LW = rows * RW; // words per time layer
  const raw = new Uint32Array(T * LW);
  const rawNoise = new Uint32Array(T * LW);
  const bit = (arr: Uint32Array, t: number, c: number, r: number): void => {
    arr[t * LW + r * RW + (c >>> 5)]! |= 1 << (c & 31);
  };
  /** Mark every cell a ray crosses from (ox, oz) for `len` metres (grid traversal, like castRay). */
  const markRay = (t: number, ox: number, oz: number, dx: number, dz: number, len: number): void => {
    let c = Math.floor(ox / FINE);
    let r = Math.floor(oz / FINE);
    const sc = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const sr = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdc = sc !== 0 ? FINE / Math.abs(dx) : Infinity;
    const tdr = sr !== 0 ? FINE / Math.abs(dz) : Infinity;
    let tmc = sc > 0 ? ((c + 1) * FINE - ox) / dx : sc < 0 ? (c * FINE - ox) / dx : Infinity;
    let tmr = sr > 0 ? ((r + 1) * FINE - oz) / dz : sr < 0 ? (r * FINE - oz) / dz : Infinity;
    for (let guard = 0; guard < 256; guard++) {
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      if (guard > 0 && flags[r * cols + c]! & F_SOLID) return;
      bit(raw, t, c, r);
      const tn = Math.min(tmc, tmr);
      if (tn >= len) return;
      if (tmc < tmr) {
        tmc += tdc;
        c += sc;
      } else {
        tmr += tdr;
        r += sr;
      }
    }
  };
  const prevLook = new Float64Array(plan.staff.length);
  const lookLo = new Float64Array(plan.staff.length);
  const lookHi = new Float64Array(plan.staff.length);
  // VENDING RUN: steps when someone would hear the machine from the goal (the purchase rattles once a second).
  const vending = plan.mission === 'vending';
  const goalA = plan.anchors.goal!;
  const vendBad = new Uint8Array(T);
  const quiet = plan.zones.some((z) => z.kind === 'quiet');
  const polished = plan.zones.some((z) => z.kind === 'polished');
  for (let t = 0; t < T; t++) {
    // Step the staff tick by tick, tracking how far each head turned either way since the last sample.
    for (let k = 0; k < sim.staff.length; k++) {
      lookLo[k] = 0;
      lookHi[k] = 0;
    }
    if (t > 0) {
      for (let k = 0; k < V_STEP; k++) {
        step(sim, NO_INPUT);
        for (let j = 0; j < sim.staff.length; j++) {
          let d = sim.staff[j]!.look - prevLook[j]!;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d < -Math.PI) d += 2 * Math.PI;
          if (d < lookLo[j]!) lookLo[j] = d;
          if (d > lookHi[j]!) lookHi[j] = d;
        }
      }
    }
    for (let k = 0; k < sim.staff.length; k++) {
      const st = sim.staff[k]!;
      const sp = plan.staff[k]!;
      if (sp.coneRange > 0) {
        // The cone's visible area over the last step: a fan of rays ~1.5° apart covering every look direction any
        // tick since the previous sample (heads can sweep 30° in a quarter second, so one snapshot would strobe),
        // each marked cell by cell up to the first wall. The one-cell dilation below fills the slivers between rays.
        const half = sp.coneHalf;
        const base = t > 0 ? prevLook[k]! : st.look;
        const a0 = base + lookLo[k]! - half;
        const a1 = base + lookHi[k]! + half;
        const rays = Math.max(FAN_RAYS, Math.ceil(((a1 - a0) / (2 * half)) * FAN_RAYS));
        for (let j = 0; j <= rays; j++) {
          const a = a0 + ((a1 - a0) * j) / rays;
          markRay(t, st.x, st.z, fsin(a), fcos(a), sp.coneRange);
        }
        // Right next to someone counts whatever the angle (bumping into them).
        const oc = Math.floor(st.x / FINE);
        const orr = Math.floor(st.z / FINE);
        for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
          const cc = oc + dc;
          const rr = orr + dr;
          if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) bit(raw, t, cc, rr);
        }
      }
      prevLook[k] = st.look;
      // Footsteps: walking within earshot (plus a margin) is as bad as being seen — but sneaking is silent.
      const h = hearingOf(plan, k);
      if (vending && h > 0) {
        const rv = NOISE.vending * h + 1.6;
        if ((st.x - goalA.x) * (st.x - goalA.x) + (st.z - goalA.z) * (st.z - goalA.z) < rv * rv) vendBad[t] = 1;
      }
      if (h > 0) {
        let rad = NOISE.step.walk * h * (polished ? NOISE.polished : 1);
        if (quiet && inZone(plan.zones, 'quiet', st.x, st.z)) rad *= NOISE.quiet;
        rad += 0.6;
        const c0 = Math.max(0, Math.floor((st.x - rad) / FINE));
        const c1 = Math.min(cols - 1, Math.floor((st.x + rad) / FINE));
        const r0 = Math.max(0, Math.floor((st.z - rad) / FINE));
        const r1 = Math.min(rows - 1, Math.floor((st.z + rad) / FINE));
        for (let r = r0; r <= r1; r++) {
          for (let c = c0; c <= c1; c++) {
            const dx = (c + 0.5) * FINE - st.x;
            const dz = (r + 0.5) * FINE - st.z;
            if (dx * dx + dz * dz <= rad * rad) bit(rawNoise, t, c, r);
          }
        }
      }
    }
  }
  // ── 2. Dilate: one cell in space (sight only), then the clearance in time ──
  const spatial = (src: Uint32Array): void => {
    const row = new Uint32Array(RW);
    const tmp = new Uint32Array(LW);
    for (let t = 0; t < T; t++) {
      const base = t * LW;
      // Horizontal: x | x<<1 | x>>1 across word boundaries.
      for (let r = 0; r < rows; r++) {
        const o = base + r * RW;
        for (let w = 0; w < RW; w++) row[w] = src[o + w]!;
        for (let w = 0; w < RW; w++) {
          const x = row[w]!;
          const left = (x << 1) | (w > 0 ? row[w - 1]! >>> 31 : 0);
          const right = (x >>> 1) | (w + 1 < RW ? row[w + 1]! << 31 : 0);
          tmp[r * RW + w] = x | left | right;
        }
      }
      // Vertical: OR with the rows above and below.
      for (let r = 0; r < rows; r++) {
        const o = base + r * RW;
        for (let w = 0; w < RW; w++) {
          let v = tmp[r * RW + w]!;
          if (r > 0) v |= tmp[(r - 1) * RW + w]!;
          if (r + 1 < rows) v |= tmp[(r + 1) * RW + w]!;
          src[o + w] = v;
        }
      }
    }
  };
  spatial(raw);
  const clear = CLEARANCE[opts.clearance ?? difficulty];
  const k = Math.ceil((clear.seconds * 60) / V_STEP);
  const dilate = (src: Uint32Array): Uint32Array => {
    const out = new Uint32Array(T * LW);
    for (let t = 0; t < T; t++) {
      const lo = Math.max(0, t - k);
      const hi = Math.min(T - 1, t + k);
      const o = t * LW;
      for (let u = lo; u <= hi; u++) {
        const sOff = u * LW;
        for (let w = 0; w < LW; w++) out[o + w]! |= src[sOff + w]!;
      }
    }
    return out;
  };
  const blocked = dilate(raw);
  const noisy = dilate(rawNoise);
  // PIZZA DAY: the counter is off limits (you get shooed) until the lunch bell; first in line means picking up
  // within the window after it (less a 2 s margin for a player running a little late).
  const lunch = lunchTick(plan.mission, plan.bellTicks);
  const lunchStep = Math.ceil(lunch / V_STEP);
  const lastPick = lunch > 0 ? Math.floor((lunch + (MISSION_RULES.firstWindow - 2) * 60) / V_STEP) : T;
  if (lunch > 0) {
    const rr = MISSION_RULES.shooRadius + 1.0;
    const c0 = Math.max(0, Math.floor((goalA.x - rr) / FINE));
    const c1 = Math.min(cols - 1, Math.floor((goalA.x + rr) / FINE));
    const r0 = Math.max(0, Math.floor((goalA.z - rr) / FINE));
    const r1 = Math.min(rows - 1, Math.floor((goalA.z + rr) / FINE));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dx = (c + 0.5) * FINE - goalA.x;
        const dz = (r + 0.5) * FINE - goalA.z;
        if (dx * dx + dz * dz > rr * rr) continue;
        for (let t = 0; t < Math.min(T, lunchStep); t++) bit(blocked, t, c, r);
      }
    }
  }
  const quietBuy = (() => {
    // Dilate the vending noise steps in time by the clearance too.
    const kk = k;
    const out = new Uint8Array(T);
    for (let t = 0; t < T; t++) if (vendBad[t]) for (let u = Math.max(0, t - kk); u <= Math.min(T - 1, t + kk); u++) out[u] = 1;
    return out;
  })();
  const buySteps = Math.ceil((MISSION_RULES.buySeconds * 60) / V_STEP) + 1;
  const isBlocked = (t: number, i: number): boolean => {
    if (t >= T) return true;
    const c = i % cols;
    const r = (i - c) / cols;
    return (blocked[t * LW + r * RW + (c >>> 5)]! & (1 << (c & 31))) !== 0;
  };
  const isNoisy = (t: number, i: number): boolean => {
    const c = i % cols;
    const r = (i - c) / cols;
    return (noisy[t * LW + r * RW + (c >>> 5)]! & (1 << (c & 31))) !== 0;
  };
  const walk = (c: number, r: number): boolean => openAt(plan.fine, c, r);
  if (opts.probe) {
    const at = (arr: Uint32Array, t: number, x: number, z: number): boolean => {
      const c = Math.floor(x / FINE);
      const r = Math.floor(z / FINE);
      return (arr[t * LW + r * RW + (c >>> 5)]! & (1 << (c & 31))) !== 0;
    };
    opts.probe((t, x, z) => at(blocked, t, x, z), (t, x, z) => at(raw, t, x, z));
  }

  // ── 3. Targets and admissible heuristics (Chebyshev BFS steps on the static grid) ──
  const cellOf = (x: number, z: number): number => Math.floor(z / FINE) * cols + Math.floor(x / FINE);
  const goals = GOALS.filter((g) => plan.anchors[g] && (plan.mission === 'principal' || g === 'goal'));
  const targets = [...goals.map((g) => plan.anchors[g]!), plan.anchors.start!];
  const reachCells = 2; // seed cells within 1.0 m of the anchor (the sim's reach is 1.3 m: margin for drift)
  const bfs = (from: number): Int32Array => {
    const d = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let h = 0;
    let tl = 0;
    const fc = from % cols;
    const fr = (from - fc) / cols;
    for (let dr = -reachCells; dr <= reachCells; dr++) {
      for (let dc = -reachCells; dc <= reachCells; dc++) {
        if (!walk(fc + dc, fr + dr) || (dc * dc + dr * dr) * FINE * FINE > 1.0) continue;
        const i = (fr + dr) * cols + fc + dc;
        if (d[i] === -1) {
          d[i] = 0;
          q[tl++] = i;
        }
      }
    }
    while (h < tl) {
      const i = q[h++]!;
      const c = i % cols;
      const r = (i - c) / cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (!canStep(plan.fine, c, r, dc, dr)) continue;
          const j = nr * cols + nc;
          if (d[j] !== -1) continue;
          d[j] = d[i]! + 1;
          q[tl++] = j;
        }
      }
    }
    return d;
  };
  const dist = targets.map((a) => bfs(cellOf(a.x, a.z)));
  // Fixed legs after each target (target g's anchor → target g+1).
  const legAfter: number[] = targets.map(() => 0);
  for (let g = targets.length - 2; g >= 0; g--) {
    const a = targets[g]!;
    const d = dist[g + 1]![cellOf(a.x, a.z)]!;
    if (d < 0) return { ok: false, route: null, seconds: null, expanded: 0, reason: 'noPath' };
    legAfter[g] = d + legAfter[g + 1]!;
  }
  const start = cellOf(plan.anchors.start!.x, plan.anchors.start!.z);
  if (dist[0]![start]! < 0) return { ok: false, route: null, seconds: null, expanded: 0, reason: 'noPath' };
  // PIZZA DAY's wait for the lunch bell is forced, so its slack is measured on the time after it.
  const budgetTicks = lunch > 0 ? lunch + clear.budget * (plan.bellTicks - lunch) : clear.budget * plan.bellTicks;
  const budgetSteps = Math.floor(budgetTicks / V_STEP);

  // ── 4. Safe-interval A* (SIPP) over (cell, safe interval, goals done) ──
  // A cell's safe intervals are its maximal runs of unseen time steps. Waiting is free inside an interval, so the
  // search only needs the earliest arrival into each interval: optimal for "wait anywhere" planning, and far
  // smaller than searching every (cell, time). Walking needs both cells out of earshot at arrival; sneaking takes
  // 2 steps (3 diagonally) and needs both cells unseen the whole time.
  const G = targets.length;
  const intervals = new Map<number, Int32Array>();
  const ivOf = (cell: number): Int32Array => {
    let iv = intervals.get(cell);
    if (!iv) {
      const out: number[] = [];
      let s0 = -1;
      for (let t = 0; t < T; t++) {
        const free = !isBlocked(t, cell);
        if (free && s0 < 0) s0 = t;
        if (!free && s0 >= 0) {
          out.push(s0, t - 1);
          s0 = -1;
        }
      }
      if (s0 >= 0) out.push(s0, T - 1);
      iv = Int32Array.from(out);
      intervals.set(cell, iv);
    }
    return iv;
  };
  const h = (cell: number, g: number): number => dist[g]![cell]! + legAfter[g]!;
  // Reaching a goal completes it on arrival — except the vending machine (a purchase, see below) and the pizza
  // counter after the first-in-line window.
  const advanceG = (cell: number, g: number, t: number): number => {
    let gg = g;
    while (gg < G - 1 && dist[gg]![cell] === 0) {
      if (vending && gg === 0) break;
      if (lunch > 0 && gg === 0 && t > lastPick) break;
      gg++;
    }
    return gg;
  };
  // State id → (cell, interval index, g, arrival time, parent, move cost, sneak).
  const sCell: number[] = [];
  const sIv: number[] = [];
  const sG: number[] = [];
  const sT: number[] = [];
  const sParent: number[] = [];
  const sCost: number[] = [];
  const sSneak: boolean[] = [];
  const sBuy: boolean[] = [];
  const sF: number[] = [];
  const sH: number[] = [];
  const best = new Map<number, number>(); // (cell, iv, g) → best arrival
  const keyOf = (cell: number, iv: number, g: number): number => (cell * 64 + iv) * G + g;
  const heap: number[] = [];
  const less = (a: number, b: number): boolean => {
    const fa = sF[a]!;
    const fb = sF[b]!;
    if (fa !== fb) return fa < fb;
    const ha = sH[a]!;
    const hb = sH[b]!;
    return ha !== hb ? ha < hb : a < b;
  };
  const push = (id: number): void => {
    heap.push(id);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i]!, heap[p]!)) break;
      [heap[i], heap[p]] = [heap[p]!, heap[i]!];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= heap.length) break;
        let m = l;
        if (l + 1 < heap.length && less(heap[l + 1]!, heap[l]!)) m = l + 1;
        if (!less(heap[m]!, heap[i]!)) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  const addState = (cell: number, iv: number, g: number, t: number, parent: number, cost: number, sneak: boolean, buy = false): void => {
    if (iv >= 64) return;
    const k = keyOf(cell, iv, g);
    const prev = best.get(k);
    if (prev !== undefined && prev <= t) return;
    best.set(k, t);
    const id = sCell.length;
    sCell.push(cell);
    sIv.push(iv);
    sG.push(g);
    sT.push(t);
    sParent.push(parent);
    sCost.push(cost);
    sSneak.push(sneak);
    sBuy.push(buy);
    const hh = h(cell, g);
    sH.push(hh);
    sF.push(t + hh);
    push(id);
  };
  const startIvs = ivOf(start);
  if (startIvs.length === 0 || startIvs[0] !== 0) return { ok: false, route: null, seconds: null, expanded: 0, reason: 'noPath' };
  addState(start, 0, advanceG(start, 0, 0), 0, -1, 0, false);
  const maxExpand = opts.maxExpand ?? 200000;
  let goal = -1;
  let expanded = 0;
  while (heap.length > 0) {
    if (++expanded > maxExpand) return { ok: false, route: null, seconds: null, expanded, reason: 'expansionCap' };
    const id = pop();
    const cell = sCell[id]!;
    const g = sG[id]!;
    const ta = sT[id]!;
    if (best.get(keyOf(cell, sIv[id]!, g)) !== ta) continue; // superseded
    if (g === G - 1 && dist[G - 1]![cell] === 0) {
      goal = id;
      break;
    }
    if (ta + h(cell, g) > budgetSteps) continue;
    const myIv = ivOf(cell);
    const e = myIv[sIv[id]! * 2 + 1]!; // last safe step here
    // VENDING RUN: stand at the machine for the whole purchase, unseen, with nobody in earshot of it.
    if (vending && g === 0 && dist[0]![cell] === 0) {
      for (let t = ta; t + buySteps <= e; t++) {
        let ok = true;
        for (let u = t; u <= t + buySteps && ok; u++) ok = quietBuy[u] === 0;
        if (ok) {
          addState(cell, sIv[id]!, advanceG(cell, 1, t + buySteps), t + buySteps, id, buySteps, false, true);
          break;
        }
      }
    }
    const c = cell % cols;
    const r = (cell - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (!canStep(plan.fine, c, r, dc, dr)) continue;
        const n = nr * cols + nc;
        const nIv = ivOf(n);
        const sneakCost = dr && dc ? 3 : 2;
        for (let j = 0; j < nIv.length; j += 2) {
          const s0 = nIv[j]!;
          const e0 = nIv[j + 1]!;
          if (e0 < ta + 1 || s0 > e + sneakCost) continue;
          // Walk: first arrival t in the window where both ends are out of earshot.
          let walked = -1;
          for (let t = Math.max(ta + 1, s0); t <= Math.min(e + 1, e0); t++) {
            if (!isNoisy(t, n) && !isNoisy(t, cell)) {
              walked = t;
              break;
            }
          }
          if (walked >= 0) addState(n, j / 2, advanceG(n, g, walked), walked, id, 1, false);
          // Sneak: first arrival t with both cells unseen for the whole move (always silent).
          for (let t = Math.max(ta + sneakCost, s0); t <= Math.min(e + sneakCost, e0); t++) {
            if (walked >= 0 && t >= walked) break;
            let clear = true;
            for (let u = t - sneakCost + 1; u <= t && clear; u++) clear = !isBlocked(u, n) && !isBlocked(u, cell);
            if (clear) {
              addState(n, j / 2, advanceG(n, g, t), t, id, sneakCost, true);
              break;
            }
          }
        }
      }
    }
  }
  if (goal < 0) return { ok: false, route: null, seconds: null, expanded, reason: 'noPath' };

  // ── 5. Route points: each step's arrival, plus the wait before it (departure = arrival − move cost) ──
  const chain: number[] = [];
  for (let id = goal; id !== -1; id = sParent[id]!) chain.push(id);
  chain.reverse();
  const pt = (cell: number, t: number, sneak: boolean): RoutePoint => ({
    x: ((cell % cols) + 0.5) * FINE,
    z: (Math.floor(cell / cols) + 0.5) * FINE,
    tick: t * V_STEP,
    sneak,
  });
  const route: RoutePoint[] = [pt(sCell[chain[0]!]!, 0, false)];
  for (let k2 = 1; k2 < chain.length; k2++) {
    const prev = chain[k2 - 1]!;
    const id = chain[k2]!;
    const depart = sT[id]! - sCost[id]!;
    if (depart > sT[prev]!) route.push(pt(sCell[prev]!, depart, false));
    const p = pt(sCell[id]!, sT[id]!, sSneak[id]!);
    // A purchase starts (interact) when the wait at the machine ends; anything else completes on arrival.
    if (sBuy[id]) route[route.length - 1]!.interact = true;
    else if (sG[id]! > sG[prev]!) p.interact = true;
    route.push(p);
  }
  const seconds = route[route.length - 1]!.tick / 60;
  return { ok: true, route, seconds, expanded };
}
