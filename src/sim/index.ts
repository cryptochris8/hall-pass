// ─────────────────────────────────────────────────────────────────────────────
// The run simulation (docs/ARCHITECTURE.md §2–3; contract: src/sim/types.ts).
// createSim(plan, config) → SimState; step(state, input) advances exactly one
// 1/60 s tick and returns what happened. Pure apart from mutating `state`.
//
// Grey-box scope (milestone M1): route-following staff, sight + suspicion,
// hall pass / BUSTED / DETENTION, mission pickups, checkpoints, bell timer.
// Not yet (M3): chasing, noise, hiding, distractions, PA events, brains.
// Until chasing exists, reaching full suspicion counts as being caught.
// ─────────────────────────────────────────────────────────────────────────────
import { fcos, fsin } from '../core/fmath';
import type { AnchorId, SchoolPlan } from '../school/types';
import { inZone, sees } from './detect';
import { moveStudent } from './move';
import { initStaff, stepRoute } from './staff/route';
import { DETECT, DIFFICULTY, RULES } from './tuning';
import {
  BTN_INTERACT,
  SIM_DT,
  SIM_HZ,
  type RunConfig,
  type SimEvent,
  type SimState,
  type SuspicionLevel,
  type TickInput,
} from './types';

export * from './types';

const GOAL_ORDER: readonly AnchorId[] = ['goal', 'goal2', 'goal3'];

/** Goals this mission needs, in order. */
export function missionGoals(plan: SchoolPlan): AnchorId[] {
  return GOAL_ORDER.filter((id) => plan.anchors[id] !== undefined && (plan.mission === 'principal' || id === 'goal'));
}

export function createSim(plan: SchoolPlan, config: RunConfig): SimState {
  const start = plan.anchors.start!;
  return {
    plan,
    config,
    tick: 0,
    bell: plan.bellTicks,
    phase: 'playing',
    student: { x: start.x, z: start.z, vx: 0, vz: 0, yaw: start.yaw, posture: 'walk', stamina: 1, escort: 0 },
    staff: plan.staff.map(initStaff),
    collected: [],
    checkpoint: 'start',
    passes: DIFFICULTY[config.difficulty].passes,
    catches: 0,
    spottings: 0,
    closeCalls: 0,
  };
}

/** cos(half angle) per staff, cached per plan (pure function of the plan). */
const cosCache = new WeakMap<SchoolPlan, Float64Array>();
function cosHalves(plan: SchoolPlan): Float64Array {
  let c = cosCache.get(plan);
  if (!c) {
    c = new Float64Array(plan.staff.length);
    for (let i = 0; i < plan.staff.length; i++) c[i] = fcos(plan.staff[i]!.coneHalf);
    cosCache.set(plan, c);
  }
  return c;
}

function levelOf(s: number): SuspicionLevel {
  if (s >= 1) return 'spotted';
  if (s >= DETECT.searching) return 'searching';
  if (s >= DETECT.curious) return 'curious';
  return 'calm';
}

export function step(state: SimState, input: TickInput): SimEvent[] {
  const ev: SimEvent[] = [];
  if (state.phase !== 'playing') return ev;
  const { plan } = state;
  const diff = DIFFICULTY[state.config.difficulty];
  const s = state.student;
  state.tick++;

  // ── student ──
  if (s.escort > 0) {
    // BUSTED: walked back to the checkpoint (shown as a fade by the app).
    s.escort--;
    s.vx = 0;
    s.vz = 0;
    if (s.escort === 0) {
      const a = plan.anchors[state.checkpoint] ?? plan.anchors.start!;
      s.x = a.x;
      s.z = a.z;
      s.yaw = a.yaw;
      for (const st of state.staff) {
        st.suspicion = 0;
        st.level = 'calm';
      }
      ev.push({ t: 'escortDone', checkpoint: state.checkpoint });
    }
  } else {
    moveStudent(plan.fine, s, input);
  }
  const free = s.escort === 0;
  const interact = free && (input.buttons & BTN_INTERACT) !== 0;

  // ── staff ──
  const cosH = cosHalves(plan);
  const lit = inZone(plan.zones, 'dim', s.x, s.z) ? DETECT.dim * (s.vx === 0 && s.vz === 0 ? DETECT.stillDim : 1) : 1;
  const posture = DETECT.posture[s.posture];
  for (let i = 0; i < state.staff.length; i++) {
    const st = state.staff[i]!;
    const spawn = plan.staff[i]!;
    stepRoute(st, spawn, diff.staffSpeed);
    if (st.ignore > 0) st.ignore--;
    let seen = 0;
    if (free && st.ignore === 0) {
      seen = sees(plan.fine, st, spawn, cosH[i]!, s.x, s.z, s.posture);
      const dx = s.x - st.x;
      const dz = s.z - st.z;
      const d2 = dx * dx + dz * dz;
      if (spawn.archetype !== 'sweeper' && spawn.coneRange > 0 && d2 < DETECT.contact * DETECT.contact) seen = 100;
      // Close call: right behind them, unseen, while they're unaware.
      if (seen === 0 && st.level === 'calm' && d2 < DETECT.closeCall * DETECT.closeCall && spawn.coneRange > 0) {
        const behind = dx * fsin(st.look) + dz * fcos(st.look) < 0;
        if (behind && state.tick % SIM_HZ === 0) {
          state.closeCalls++;
          ev.push({ t: 'closeCall', staff: i });
        }
      }
    }
    st.seesStudent = seen > 0;
    if (seen > 0) st.suspicion = Math.min(1, st.suspicion + DETECT.fill * diff.fill * seen * posture * lit * SIM_DT);
    else st.suspicion = Math.max(0, st.suspicion - DETECT.decay * SIM_DT);
    const lvl = levelOf(st.suspicion);
    if (lvl !== st.level) {
      st.level = lvl;
      ev.push({ t: 'suspicion', staff: i, level: lvl });
      if (lvl === 'spotted') {
        state.spottings++;
        caught(state, i, ev);
      }
    }
  }
  if (state.phase !== 'playing') return ev;

  // ── mission, checkpoints ──
  if (free) {
    const goals = missionGoals(plan);
    const next = goals.find((g) => !state.collected.includes(g));
    if (next && interact) {
      const a = plan.anchors[next]!;
      const dx = s.x - a.x;
      const dz = s.z - a.z;
      if (dx * dx + dz * dz < RULES.reach * RULES.reach) {
        state.collected.push(next);
        ev.push({ t: 'pickup', anchor: next });
      }
    }
    for (const [id, a] of Object.entries(plan.anchors)) {
      if (!id.startsWith('checkpoint') || id === state.checkpoint || !a) continue;
      const dx = s.x - a.x;
      const dz = s.z - a.z;
      if (dx * dx + dz * dz < RULES.checkpointRadius * RULES.checkpointRadius) {
        state.checkpoint = id as AnchorId;
        ev.push({ t: 'checkpoint', at: state.checkpoint });
      }
    }
    if (!next) {
      const a = plan.anchors.start!;
      const dx = s.x - a.x;
      const dz = s.z - a.z;
      if (dx * dx + dz * dz < RULES.reach * RULES.reach) end(state, 'success', ev);
    }
  }

  // ── bell ──
  if (state.phase === 'playing') {
    state.bell--;
    if (state.bell === 30 * SIM_HZ) ev.push({ t: 'bell', secondsLeft: 30 });
    if (state.bell === 10 * SIM_HZ) ev.push({ t: 'bell', secondsLeft: 10 });
    if (state.bell <= 0) {
      state.bell = 0;
      ev.push({ t: 'bell', secondsLeft: 0 });
      end(state, 'timeout', ev);
    }
  }
  return ev;
}

function caught(state: SimState, i: number, ev: SimEvent[]): void {
  const st = state.staff[i]!;
  if (state.passes > 0) {
    state.passes--;
    st.suspicion = 0;
    st.level = 'calm';
    st.ignore = RULES.passIgnore * SIM_HZ;
    ev.push({ t: 'caught', staff: i, passUsed: true });
    return;
  }
  state.catches++;
  ev.push({ t: 'caught', staff: i, passUsed: false });
  if (state.catches >= RULES.maxCatches) {
    end(state, 'detention', ev);
    return;
  }
  state.student.escort = 2 * SIM_HZ;
  state.bell = Math.max(1, state.bell - RULES.bustedSeconds * SIM_HZ);
}

function end(state: SimState, phase: 'success' | 'detention' | 'timeout', ev: SimEvent[]): void {
  state.phase = phase;
  ev.push({ t: 'end', phase });
}

/** Stable hash of the whole dynamic state (determinism tests, score verification). */
export function hashState(state: SimState): number {
  const buf = new Float64Array(1);
  const bytes = new Uint8Array(buf.buffer);
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    buf[0] = v;
    for (let k = 0; k < 8; k++) {
      h ^= bytes[k]!;
      h = Math.imul(h, 0x01000193);
    }
  };
  const s = state.student;
  mix(state.tick);
  mix(state.bell);
  mix(s.x);
  mix(s.z);
  mix(s.vx);
  mix(s.vz);
  mix(s.yaw);
  mix(s.stamina);
  mix(s.escort);
  for (const st of state.staff) {
    mix(st.x);
    mix(st.z);
    mix(st.yaw);
    mix(st.look);
    mix(st.suspicion);
    mix(st.wp);
    mix(st.dwell);
  }
  mix(state.collected.length);
  mix(state.catches);
  mix(state.passes);
  return h >>> 0;
}

/** Run a whole input sequence from a fresh state (tests, headless playtest). */
export function replay(plan: SchoolPlan, config: RunConfig, inputs: readonly TickInput[]): SimState {
  const state = createSim(plan, config);
  for (const input of inputs) step(state, input);
  return state;
}

