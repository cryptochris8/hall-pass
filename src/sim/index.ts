// ─────────────────────────────────────────────────────────────────────────────
// The run simulation (docs/ARCHITECTURE.md §2–3; contract: src/sim/types.ts).
// createSim(plan, config) → SimState; step(state, input) advances exactly one
// 1/60 s tick and returns what happened. Pure apart from mutating `state`.
//
// Per tick: PA announcements → the student (move, interact: hide / grab /
// pick up a throwable; throw) → noise and hearing → staff (route or brain mode,
// sight and suspicion, chases and catches) → thrown items landing → mission,
// checkpoints → bell. With `absent` (the fairness validator) there is no
// student: staff only follow their routes and PA errands.
// ─────────────────────────────────────────────────────────────────────────────
import { fcos, fsin } from '../core/fmath';
import type { AnchorId, Furniture, SchoolPlan } from '../school/types';
import { castRay, inZone, lineOfSight, sees } from './detect';
import { moveStudent } from './move';
import { chaseSpeed, doorOutside, face, goTo, investigate, lookAround, moveAlong, paOrder, returnToRoute, setMode, startChase, walkSpeed } from './staff/brain';
import { initStaff, stepRoute } from './staff/route';
import { BRAIN, DETECT, DIFFICULTY, HIDE, MISSION_RULES, NOISE, RULES, THROW, hargroveIndex, hearingOf, lunchTick } from './tuning';
import {
  BTN_INTERACT,
  BTN_THROW,
  SIM_DT,
  SIM_HZ,
  type NoiseSource,
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

export function createSim(plan: SchoolPlan, config: RunConfig, opts: { absent?: boolean } = {}): SimState {
  const start = plan.anchors.start!;
  return {
    plan,
    config,
    tick: 0,
    bell: plan.bellTicks,
    phase: 'playing',
    student: { x: start.x, z: start.z, vx: 0, vz: 0, yaw: start.yaw, posture: 'walk', stamina: 1, escort: 0, hidden: -1, hideT: 0, carry: 0, buying: 0, frozen: 0 },
    staff: plan.staff.map(initStaff),
    collected: [],
    checkpoint: 'start',
    passes: DIFFICULTY[config.difficulty].passes,
    catches: 0,
    spottings: 0,
    closeCalls: 0,
    absent: opts.absent === true,
    prevButtons: 0,
    usedThrowables: new Uint8Array(plan.furniture.length),
    thrown: [],
    paNext: 0,
    escapes: 0,
    snacksTaken: new Uint8Array(plan.snacks.length),
    stats: {
      hiddenTicks: 0,
      longestHide: 0,
      longestHideKind: '',
      cameraAlerts: 0,
      throws: 0,
      distractions: 0,
      sprintTicks: 0,
      shoos: 0,
      buysCancelled: 0,
      firstInLine: null,
      snacks: 0,
    },
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

/** Where you stand to use a hide spot (in front of it, on open floor). */
export function hideFront(f: Furniture): { x: number; z: number } {
  const nx = Math.round(fsin(f.face));
  const nz = Math.round(fcos(f.face));
  const half = (nx !== 0 ? f.w : f.d) / 2;
  const off = f.kind === 'locker' ? 0.75 : half + 0.45;
  return { x: f.x + nx * off, z: f.z + nz * off };
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  return (ax - bx) * (ax - bx) + (az - bz) * (az - bz);
}

/** Staff modes that are "going about their business" (can notice you, can hear you). */
function calm(mode: string): boolean {
  return mode === 'route' || mode === 'errand' || mode === 'investigate' || mode === 'return';
}

function emitNoise(state: SimState, x: number, z: number, radius: number, source: NoiseSource, ev: SimEvent[]): void {
  if (radius <= 0.05) return;
  ev.push({ t: 'noise', x, z, radius, source });
  hear(state, x, z, radius, ev);
}

function hear(state: SimState, x: number, z: number, radius: number, ev: SimEvent[]): void {
  const { plan } = state;
  for (let i = 0; i < state.staff.length; i++) {
    const st = state.staff[i]!;
    const spawn = plan.staff[i]!;
    const h = hearingOf(plan, i);
    if (h <= 0 || st.ignore > 0 || !calm(st.mode)) continue;
    const r = radius * h;
    if (dist2(st.x, st.z, x, z) > r * r) continue;
    const before = st.mode;
    investigate(st, plan, spawn, x, z);
    if (st.mode === 'investigate' && before !== 'investigate') ev.push({ t: 'heard', staff: i });
  }
}

export function step(state: SimState, input: TickInput): SimEvent[] {
  const ev: SimEvent[] = [];
  if (state.phase !== 'playing') return ev;
  const { plan } = state;
  const diff = DIFFICULTY[state.config.difficulty];
  const s = state.student;
  state.tick++;

  // ── PA announcements (student-independent) ──
  while (state.paNext < plan.pa.length && plan.pa[state.paNext]!.tick <= state.tick) {
    const pa = plan.pa[state.paNext++]!;
    ev.push({ t: 'pa', id: pa.id });
    const order = paOrder(plan, pa.id);
    if (!order) continue;
    const i = plan.staff.findIndex((sp) => sp.archetype === order.archetype);
    if (i < 0) continue;
    const st = state.staff[i]!;
    if (st.mode === 'chase' || st.mode === 'notice') continue;
    setMode(st, 'errand');
    st.errandTicks = order.seconds * SIM_HZ;
    goTo(st, plan, order.x, order.z);
  }

  const lunch = lunchTick(plan.mission, plan.bellTicks);
  if (lunch > 0 && state.tick === lunch) ev.push({ t: 'lunchBell' });

  const present = !state.absent;
  const pressed = present ? input.buttons & ~state.prevButtons : 0;
  state.prevButtons = present ? input.buttons : 0;

  // ── the student ──
  if (present) {
    if (s.escort > 0) {
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
    } else if (s.hidden >= 0) {
      s.hideT++;
      state.stats.hiddenTicks++;
      if (s.hideT > state.stats.longestHide) {
        state.stats.longestHide = s.hideT;
        state.stats.longestHideKind = plan.furniture[s.hidden]!.kind;
      }
      s.vx = 0;
      s.vz = 0;
      const moving = input.moveX * input.moveX + input.moveY * input.moveY > 40 * 40;
      if ((pressed & BTN_INTERACT) !== 0 || (moving && s.hideT > HIDE.exitDelay)) {
        ev.push({ t: 'hide', spot: s.hidden, enter: false });
        s.hidden = -1;
      }
    } else if (s.buying > 0) {
      // VENDING RUN: standing at the machine while it whirs and clunks. Walking off (or GRAB) cancels it.
      s.vx = 0;
      s.vz = 0;
      const moving = input.moveX * input.moveX + input.moveY * input.moveY > 40 * 40;
      if ((pressed & BTN_INTERACT) !== 0 || moving) {
        s.buying = 0;
        state.stats.buysCancelled++;
        ev.push({ t: 'buy', on: false, done: false });
      } else if (--s.buying === 0) {
        state.collected.push('goal');
        ev.push({ t: 'buy', on: false, done: true });
        ev.push({ t: 'pickup', anchor: 'goal' });
        emitNoise(state, s.x, s.z, NOISE.vending, 'vending', ev);
      } else if (s.buying % SIM_HZ === 0) emitNoise(state, s.x, s.z, NOISE.vending, 'vending', ev);
    } else if (s.frozen > 0) {
      s.frozen--;
      s.vx = 0;
      s.vz = 0;
    } else {
      moveStudent(plan.fine, s, input);
      if ((pressed & BTN_INTERACT) !== 0) interact(state, ev);
      if ((pressed & BTN_THROW) !== 0 && s.carry > 0) throwItem(state, ev);
    }
  }
  const free = present && s.escort === 0;

  // ── footsteps ──
  if (free && s.hidden < 0) {
    let r = NOISE.step[s.posture];
    if (r > 0) {
      if (inZone(plan.zones, 'polished', s.x, s.z)) r *= NOISE.polished;
      if (s.posture === 'sprint' && inZone(plan.zones, 'echo', s.x, s.z)) r *= NOISE.echoSprint;
      if (inZone(plan.zones, 'quiet', s.x, s.z)) r *= NOISE.quiet;
      const speed2 = s.vx * s.vx + s.vz * s.vz;
      if (s.posture === 'sprint' && speed2 > 0.25) state.stats.sprintTicks++;
      if (speed2 > 0.25) {
        hear(state, s.x, s.z, r, ev);
        if (s.posture === 'sprint' && state.tick % Math.round(NOISE.ringEvery * SIM_HZ) === 0) ev.push({ t: 'noise', x: s.x, z: s.z, radius: r, source: 'sprint' });
      }
    }
  }

  // ── staff ──
  const cosH = cosHalves(plan);
  const still = s.vx === 0 && s.vz === 0;
  const lit = inZone(plan.zones, 'dim', s.x, s.z) ? DETECT.dim * (still ? DETECT.stillDim : 1) : 1;
  const posture = DETECT.posture[s.posture];
  for (let i = 0; i < state.staff.length && state.phase === 'playing'; i++) {
    const st = state.staff[i]!;
    const spawn = plan.staff[i]!;
    st.modeT++;
    if (st.ignore > 0) st.ignore--;

    // Sight.
    let seen = 0;
    const perceives = free && st.ignore === 0 && st.mode !== 'report';
    if (perceives) {
      const d2 = dist2(s.x, s.z, st.x, st.z);
      const hiddenFar = s.hidden >= 0 && d2 >= HIDE.seeRadius * HIDE.seeRadius;
      if (!hiddenFar) {
        seen = sees(plan.fine, st, spawn, cosH[i]!, s.x, s.z, s.posture);
        if (spawn.archetype !== 'sweeper' && spawn.coneRange > 0 && d2 < DETECT.contact * DETECT.contact) seen = 100;
      }
      // Close call: right behind them, unseen, while they're unaware.
      if (seen === 0 && s.hidden < 0 && st.level === 'calm' && spawn.coneRange > 0 && d2 < DETECT.closeCall * DETECT.closeCall) {
        const behind = (s.x - st.x) * fsin(st.look) + (s.z - st.z) * fcos(st.look) < 0;
        if (behind && state.tick % SIM_HZ === 0) {
          state.closeCalls++;
          ev.push({ t: 'closeCall', staff: i });
        }
      }
    }
    st.seesStudent = seen > 0;
    if (seen > 0) {
      const rate = Math.max(BRAIN.minFill, DETECT.fill * seen * posture * lit) * diff.fill;
      st.suspicion = Math.min(1, st.suspicion + rate * SIM_DT);
      st.lastX = s.x;
      st.lastZ = s.z;
    } else if (st.mode !== 'chase') st.suspicion = Math.max(0, st.suspicion - DETECT.decay * SIM_DT);
    const lvl = levelOf(st.suspicion);
    if (lvl !== st.level) {
      st.level = lvl;
      ev.push({ t: 'suspicion', staff: i, level: lvl });
      if (lvl === 'spotted' && st.mode !== 'chase') {
        state.spottings++;
        st.heat++;
      }
    }

    // Archetypes that don't chase.
    if (spawn.archetype === 'sweeper') {
      stepRoute(st, spawn, diff.staffSpeed);
      if (st.suspicion >= 1) cameraAlert(state, i, ev);
      continue;
    }
    if (spawn.archetype === 'snitch' && st.suspicion >= 1 && st.mode !== 'report') startReport(state, i);

    // Seen while going about business → stop and stare.
    if (calm(st.mode) && seen > 0 && st.suspicion >= BRAIN.notice && spawn.archetype !== 'snitch') setMode(st, 'notice');

    // PRINCIPAL'S OFFICE: Hargrove walks faster every time he spots you.
    const boost = plan.mission === 'principal' && i === hargroveIndex(plan) ? 1 + MISSION_RULES.hargroveBoost * st.heat : 1;
    brain(state, i, ev, diff.staffSpeed * boost);
  }

  // ── thrown things land ──
  for (let k = state.thrown.length - 1; k >= 0; k--) {
    const t = state.thrown[k]!;
    if (--t.t > 0) continue;
    state.thrown.splice(k, 1);
    const r = NOISE.throwLand * (inZone(plan.zones, 'quiet', t.toX, t.toZ) ? NOISE.quiet : 1);
    // A distraction counts when it sends off someone who was onto you, or close by.
    let onto = 0;
    for (let k2 = 0; k2 < state.staff.length; k2++) {
      const o = state.staff[k2]!;
      if (o.level !== 'calm' || dist2(o.x, o.z, s.x, s.z) < 10 * 10) onto |= 1 << k2;
    }
    const before = state.staff.map((o) => o.mode === 'investigate' && o.wait < 0 ? o.tx * 1e4 + o.tz : NaN);
    emitNoise(state, t.toX, t.toZ, r, 'throw', ev);
    for (let k2 = 0; k2 < state.staff.length; k2++) {
      const o = state.staff[k2]!;
      if ((onto & (1 << k2)) !== 0 && o.mode === 'investigate' && o.tx * 1e4 + o.tz !== before[k2]) {
        state.stats.distractions++;
        break;
      }
    }
  }
  if (state.phase !== 'playing') return ev;

  // ── mission, checkpoints ──
  if (free && s.hidden < 0) {
    for (const [id, a] of Object.entries(plan.anchors)) {
      if (!id.startsWith('checkpoint') || id === state.checkpoint || !a) continue;
      if (dist2(s.x, s.z, a.x, a.z) < RULES.checkpointRadius * RULES.checkpointRadius) {
        state.checkpoint = id as AnchorId;
        ev.push({ t: 'checkpoint', at: state.checkpoint });
      }
    }
    for (let k = 0; k < plan.snacks.length; k++) {
      const sn = plan.snacks[k]!;
      if (state.snacksTaken[k] || dist2(s.x, s.z, sn.x, sn.z) > MISSION_RULES.snackReach * MISSION_RULES.snackReach) continue;
      state.snacksTaken[k] = 1;
      state.stats.snacks++;
      ev.push({ t: 'snack', index: k });
    }
    // PIZZA DAY: the lunch staff shoo you off the counter until the lunch bell.
    if (lunch > 0 && state.tick < lunch && s.buying === 0) {
      const g = plan.anchors.goal!;
      if (dist2(s.x, s.z, g.x, g.z) < MISSION_RULES.shooRadius * MISSION_RULES.shooRadius) {
        const out = doorOutside(plan, 'cafeteria');
        if (out) {
          s.x = out.x;
          s.z = out.z;
        }
        s.vx = 0;
        s.vz = 0;
        s.frozen = Math.round(MISSION_RULES.shooSeconds * SIM_HZ);
        state.stats.shoos++;
        ev.push({ t: 'shoo' });
      }
    }
    const goals = missionGoals(plan);
    if (goals.every((g) => state.collected.includes(g))) {
      const a = plan.anchors.start!;
      if (dist2(s.x, s.z, a.x, a.z) < RULES.reach * RULES.reach) end(state, 'success', ev);
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

/** One staff member's mode machine for this tick. */
function brain(state: SimState, i: number, ev: SimEvent[], speedMult: number): void {
  const { plan } = state;
  const st = state.staff[i]!;
  const spawn = plan.staff[i]!;
  const s = state.student;
  switch (st.mode) {
    case 'route':
      stepRoute(st, spawn, speedMult);
      return;
    case 'errand':
    case 'investigate': {
      if (st.wait < 0) {
        if (moveAlong(st, plan, spawn, walkSpeed(spawn, speedMult * BRAIN.briskMul))) {
          st.wait = st.mode === 'errand' ? st.errandTicks : BRAIN.lookAround * SIM_HZ;
          st.modeT = 0;
        }
      } else {
        lookAround(st, spawn);
        if (--st.wait <= 0) returnToRoute(st, plan, spawn);
      }
      return;
    }
    case 'notice': {
      face(st, spawn, st.lastX, st.lastZ);
      if (st.suspicion >= 1 && st.modeT >= BRAIN.noticeMin * SIM_HZ) startChase(st, plan, st.lastX, st.lastZ, ev, i);
      else if (st.suspicion < BRAIN.loseNotice) investigate(st, plan, spawn, st.lastX, st.lastZ);
      return;
    }
    case 'chase': {
      st.chaseT++;
      if (st.seesStudent) {
        st.lostT = 0;
        st.suspicion = 1;
      } else st.lostT++;
      const home = spawn.route[0]!;
      const leash = spawn.archetype === 'sentry' ? BRAIN.sentryLeash : spawn.archetype === 'listener' ? BRAIN.librarianLeash : Infinity;
      if (st.chaseT > BRAIN.giveUp * SIM_HZ || dist2(st.x, st.z, home.x, home.z) > leash * leash) {
        endChase(state, i, true, ev);
        returnToRoute(st, plan, spawn);
        return;
      }
      if (st.lostT > BRAIN.lostSight * SIM_HZ) {
        setMode(st, 'search');
        st.suspicion = Math.min(st.suspicion, BRAIN.searchKeep);
        goTo(st, plan, st.lastX, st.lastZ);
        return;
      }
      const d2 = dist2(st.x, st.z, s.x, s.z);
      if (st.seesStudent && d2 < BRAIN.directChase * BRAIN.directChase && lineOfSight(plan.fine, st.x, st.z, s.x, s.z, true)) {
        st.path = [s.x, s.z];
        st.pathI = 0;
      } else if (--st.replan <= 0) {
        goTo(st, plan, st.lastX, st.lastZ);
        st.replan = Math.round(BRAIN.replan * SIM_HZ);
      }
      moveAlong(st, plan, spawn, chaseSpeed(spawn, speedMult));
      checkCatch(state, i, ev);
      return;
    }
    case 'search': {
      if (st.wait < 0) {
        if (moveAlong(st, plan, spawn, walkSpeed(spawn, speedMult * BRAIN.briskMul))) {
          st.wait = BRAIN.search * SIM_HZ;
          st.modeT = 0;
        }
      } else {
        lookAround(st, spawn);
        if (--st.wait <= 0) {
          endChase(state, i, true, ev);
          returnToRoute(st, plan, spawn);
          return;
        }
      }
      if (st.seesStudent && st.suspicion >= 1) {
        startChase(st, plan, s.x, s.z, ev, i);
        return;
      }
      checkCatch(state, i, ev);
      return;
    }
    case 'report': {
      const to = state.staff[st.reportTo];
      if (!to) {
        returnToRoute(st, plan, spawn);
        return;
      }
      if (--st.replan <= 0) {
        goTo(st, plan, to.x, to.z);
        st.replan = Math.round(0.5 * SIM_HZ);
      }
      moveAlong(st, plan, spawn, chaseSpeed(spawn, speedMult));
      if (dist2(st.x, st.z, to.x, to.z) < 1.6 * 1.6) {
        ev.push({ t: 'report', staff: i, to: st.reportTo });
        investigate(to, plan, plan.staff[st.reportTo]!, st.lastX, st.lastZ);
        st.suspicion = 0;
        returnToRoute(st, plan, spawn);
      }
      return;
    }
    case 'return': {
      if (moveAlong(st, plan, spawn, walkSpeed(spawn, speedMult))) {
        setMode(st, 'route');
        st.dwell = 0;
        st.dwellT = 0;
        st.sawHide = -1;
      }
      return;
    }
  }
}

/** Caught on contact during a chase or search — or found in the hide spot they saw you climb into. */
function checkCatch(state: SimState, i: number, ev: SimEvent[]): void {
  const st = state.staff[i]!;
  const s = state.student;
  if (s.escort > 0 || state.absent) return;
  if (s.hidden >= 0) {
    if (st.sawHide !== s.hidden) return;
    const f = hideFront(state.plan.furniture[s.hidden]!);
    if (dist2(st.x, st.z, f.x, f.z) > 1.3 * 1.3) return;
    ev.push({ t: 'found', staff: i });
    ev.push({ t: 'hide', spot: s.hidden, enter: false });
    s.hidden = -1;
    caught(state, i, ev);
    return;
  }
  if (dist2(st.x, st.z, s.x, s.z) < BRAIN.catchRadius * BRAIN.catchRadius) caught(state, i, ev);
}

function endChase(state: SimState, i: number, escaped: boolean, ev: SimEvent[]): void {
  const st = state.staff[i]!;
  const wasChase = st.mode === 'chase' || st.mode === 'search';
  st.suspicion = Math.min(st.suspicion, 0.2);
  if (!wasChase) return;
  ev.push({ t: 'chase', staff: i, on: false, escaped });
  if (escaped && !state.staff.some((o, k) => k !== i && (o.mode === 'chase' || o.mode === 'search'))) state.escapes++;
}

function cameraAlert(state: SimState, cam: number, ev: SimEvent[]): void {
  const { plan } = state;
  const c = state.staff[cam]!;
  c.suspicion = 0;
  c.level = 'calm';
  c.ignore = BRAIN.cameraCooldown * SIM_HZ;
  ev.push({ t: 'suspicion', staff: cam, level: 'calm' });
  // The nearest investigator answers; else the nearest patroller; else anyone who walks.
  let best = -1;
  let bestScore = Infinity;
  for (let k = 0; k < state.staff.length; k++) {
    const sp = plan.staff[k]!;
    const o = state.staff[k]!;
    if (sp.archetype === 'sweeper' || sp.archetype === 'snitch' || sp.speed <= 0 || o.mode === 'chase') continue;
    const rank = sp.archetype === 'investigator' ? 0 : sp.archetype === 'patroller' ? 1 : 2;
    const score = rank * 1e6 + dist2(o.x, o.z, c.lastX, c.lastZ);
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  state.stats.cameraAlerts++;
  if (best < 0) return;
  ev.push({ t: 'cameraAlert', camera: cam, to: best });
  investigate(state.staff[best]!, plan, plan.staff[best]!, c.lastX, c.lastZ);
}

function startReport(state: SimState, i: number): void {
  const { plan } = state;
  const st = state.staff[i]!;
  let best = -1;
  let bd = Infinity;
  for (let k = 0; k < state.staff.length; k++) {
    const sp = plan.staff[k]!;
    if (k === i || sp.archetype === 'sweeper' || sp.archetype === 'snitch' || sp.archetype === 'listener') continue;
    const o = state.staff[k]!;
    const d = dist2(o.x, o.z, st.x, st.z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  if (best < 0) return;
  setMode(st, 'report');
  st.reportTo = best;
  st.replan = 0;
}

function interact(state: SimState, ev: SimEvent[]): void {
  const { plan } = state;
  const s = state.student;
  // 1. The mission item.
  const next = missionGoals(plan).find((g) => !state.collected.includes(g));
  if (next) {
    const a = plan.anchors[next]!;
    if (dist2(s.x, s.z, a.x, a.z) < RULES.reach * RULES.reach) {
      if (plan.mission === 'vending') {
        // The purchase takes a while (and rattles); see the student block.
        s.buying = MISSION_RULES.buySeconds * SIM_HZ;
        s.vx = 0;
        s.vz = 0;
        ev.push({ t: 'buy', on: true, done: false });
        emitNoise(state, s.x, s.z, NOISE.vending, 'vending', ev);
        return;
      }
      const lunch = lunchTick(plan.mission, plan.bellTicks);
      if (lunch > 0) {
        if (state.tick < lunch) return;
        state.stats.firstInLine = state.tick <= lunch + MISSION_RULES.firstWindow * SIM_HZ;
      }
      state.collected.push(next);
      ev.push({ t: 'pickup', anchor: next });
      emitNoise(state, s.x, s.z, NOISE.pickup, 'pickup', ev);
      return;
    }
  }
  // 2. A hide spot (nearest within reach).
  let best = -1;
  let bd = HIDE.reach * HIDE.reach;
  for (let k = 0; k < plan.furniture.length; k++) {
    const f = plan.furniture[k]!;
    if (!f.tags.includes('hide')) continue;
    const p = hideFront(f);
    const d = dist2(s.x, s.z, p.x, p.z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  if (best >= 0) {
    const p = hideFront(plan.furniture[best]!);
    const loud = s.posture === 'sprint';
    s.hidden = best;
    s.hideT = 0;
    s.x = p.x;
    s.z = p.z;
    s.vx = 0;
    s.vz = 0;
    for (const st of state.staff) if (st.seesStudent) st.sawHide = best;
    ev.push({ t: 'hide', spot: best, enter: true });
    emitNoise(state, p.x, p.z, loud ? NOISE.hideLoud : NOISE.hideQuiet, 'hide', ev);
    return;
  }
  // 3. Something to throw.
  if (s.carry >= THROW.maxCarry) return;
  for (let k = 0; k < plan.furniture.length; k++) {
    const f = plan.furniture[k]!;
    if (state.usedThrowables[k] || !f.tags.includes('throwables')) continue;
    const rx = Math.max(Math.abs(s.x - f.x) - f.w / 2, 0);
    const rz = Math.max(Math.abs(s.z - f.z) - f.d / 2, 0);
    if (rx * rx + rz * rz > THROW.reach * THROW.reach) continue;
    state.usedThrowables[k] = 1;
    s.carry++;
    ev.push({ t: 'grabThrowable', carry: s.carry });
    return;
  }
}

function throwItem(state: SimState, ev: SimEvent[]): void {
  const s = state.student;
  const dx = fsin(s.yaw);
  const dz = fcos(s.yaw);
  const d = Math.max(1, castRay(state.plan.fine, s.x, s.z, dx, dz, THROW.distance, false) - 0.4);
  const t = { fromX: s.x, fromZ: s.z, toX: s.x + dx * d, toZ: s.z + dz * d, t: THROW.flightTicks };
  state.thrown.push(t);
  s.carry--;
  state.stats.throws++;
  ev.push({ t: 'throw', fromX: t.fromX, fromZ: t.fromZ, toX: t.toX, toZ: t.toZ, ticks: t.t });
}

function caught(state: SimState, i: number, ev: SimEvent[]): void {
  const { plan } = state;
  const st = state.staff[i]!;
  if (state.passes > 0) {
    state.passes--;
    ev.push({ t: 'caught', staff: i, passUsed: true });
    endChase(state, i, false, ev);
    st.suspicion = 0;
    st.level = 'calm';
    st.ignore = RULES.passIgnore * SIM_HZ;
    returnToRoute(st, plan, plan.staff[i]!);
    // Anyone else on your tail drops back to searching.
    for (let k = 0; k < state.staff.length; k++) {
      const o = state.staff[k]!;
      if (k !== i && o.mode === 'chase') {
        setMode(o, 'search');
        goTo(o, plan, o.lastX, o.lastZ);
      }
    }
    return;
  }
  state.catches++;
  ev.push({ t: 'caught', staff: i, passUsed: false });
  if (state.student.buying > 0) {
    state.student.buying = 0;
    state.stats.buysCancelled++;
    ev.push({ t: 'buy', on: false, done: false });
  }
  for (let k = 0; k < state.staff.length; k++) {
    const o = state.staff[k]!;
    if (o.mode === 'chase' || o.mode === 'search' || o.mode === 'notice') {
      endChase(state, k, false, ev);
      returnToRoute(o, plan, plan.staff[k]!);
    }
  }
  if (state.catches >= RULES.maxCatches) {
    end(state, 'detention', ev);
    return;
  }
  state.student.escort = 2 * SIM_HZ;
  state.student.carry = 0;
  state.bell = Math.max(1, state.bell - RULES.bustedSeconds * SIM_HZ);
}

function end(state: SimState, phase: 'success' | 'detention' | 'timeout', ev: SimEvent[]): void {
  state.phase = phase;
  ev.push({ t: 'end', phase });
}

const MODE_ID: Record<string, number> = { route: 0, errand: 1, investigate: 2, notice: 3, chase: 4, search: 5, report: 6, return: 7 };

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
  mix(s.hidden);
  mix(s.carry);
  mix(s.buying);
  mix(s.frozen);
  for (const st of state.staff) {
    mix(st.x);
    mix(st.z);
    mix(st.yaw);
    mix(st.look);
    mix(st.suspicion);
    mix(st.wp);
    mix(st.dwell);
    mix(MODE_ID[st.mode]!);
    mix(st.wait);
    mix(st.chaseT);
    mix(st.lastX);
    mix(st.lastZ);
    mix(st.heat);
  }
  mix(state.collected.length);
  mix(state.catches);
  mix(state.passes);
  mix(state.thrown.length);
  mix(state.paNext);
  for (let k = 0; k < state.snacksTaken.length; k++) mix(state.snacksTaken[k]!);
  return h >>> 0;
}

/** Run a whole input sequence from a fresh state (tests, headless playtest). */
export function replay(plan: SchoolPlan, config: RunConfig, inputs: readonly TickInput[]): SimState {
  const state = createSim(plan, config);
  for (const input of inputs) step(state, input);
  return state;
}
