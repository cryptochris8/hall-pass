// ─────────────────────────────────────────────────────────────────────────────
// The Hall Report (docs/GDD.md §8): score lines, the grade against the seed's
// par, the rank, and 1–3 teacher remarks — all a pure function of the finished
// SimState (so a replayed recording always gets the same report). Par is the
// perfect bot's run of the reference route (its raw score, before the difficulty
// multiplier). Pure; deterministic.
// ─────────────────────────────────────────────────────────────────────────────
import type { Difficulty, MissionId, SchoolPlan } from '../school/types';
import { createBot } from './bot';
import { createSim, step } from './index';
import { DIFFICULTY, MISSION_RULES } from './tuning';
import { SIM_HZ, type RunConfig, type SimState } from './types';

export const POINTS = {
  mission: 1000,
  perSecondLeft: 20,
  ghost: 1500,
  passUnused: 300,
  closeCall: 150,
  snack: 100,
  distraction: 100,
  caught: -400,
  firstInLine: 500,
};

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'D';
export const GRADES: readonly Grade[] = ['A+', 'A', 'B', 'C', 'D'];
export type Rank = 'GHOST' | 'SMOOTH' | 'CLOSE CALL' | 'DETENTION';

/** Grade points (SCHOOL WEEK averages). */
export const GRADE_POINTS: Readonly<Record<Grade, number>> = { 'A+': 4.3, A: 4, B: 3, C: 2, D: 1 };

export interface ReportLine {
  label: string;
  /** "×3", "2:41", … (shown next to the label), or ''. */
  detail: string;
  points: number;
}

export interface HallReport {
  mission: MissionId;
  difficulty: Difficulty;
  success: boolean;
  /** How the run ended. */
  outcome: 'success' | 'detention' | 'timeout';
  rank: Rank;
  grade: Grade;
  lines: ReportLine[];
  /** Sum of the lines (before the multiplier). */
  raw: number;
  multiplier: number;
  /** The score: raw × multiplier, rounded, never below 0. */
  total: number;
  par: number;
  /** Seconds the run took and seconds left on the bell. */
  seconds: number;
  secondsLeft: number;
  spotted: number;
  caught: number;
  remarks: string[];
}

/** Raw (pre-multiplier) score lines of a finished run. */
export function scoreLines(state: SimState): ReportLine[] {
  const s = state;
  const ok = s.phase === 'success';
  const lines: ReportLine[] = [];
  const startPasses = DIFFICULTY[s.config.difficulty].passes;
  if (ok) {
    const left = Math.floor(s.bell / SIM_HZ);
    lines.push({ label: 'Mission complete', detail: '', points: POINTS.mission });
    lines.push({ label: 'Bell time left', detail: clock(left), points: left * POINTS.perSecondLeft });
    if (s.spottings === 0) lines.push({ label: 'GHOST — never spotted', detail: '', points: POINTS.ghost });
    if (startPasses > 0 && s.passes === startPasses) lines.push({ label: 'Hall pass unused', detail: '', points: POINTS.passUnused });
    if (s.stats.firstInLine) lines.push({ label: 'First in line', detail: '', points: POINTS.firstInLine });
  }
  if (s.closeCalls > 0) lines.push({ label: 'BEHIND YOU close calls', detail: `×${s.closeCalls}`, points: s.closeCalls * POINTS.closeCall });
  if (s.stats.snacks > 0) lines.push({ label: 'Snack packs', detail: `×${s.stats.snacks}`, points: s.stats.snacks * POINTS.snack });
  if (s.stats.distractions > 0) lines.push({ label: 'Distractions that worked', detail: `×${s.stats.distractions}`, points: s.stats.distractions * POINTS.distraction });
  if (s.catches > 0) lines.push({ label: 'Busted', detail: `×${s.catches}`, points: s.catches * POINTS.caught });
  return lines;
}

export function rankOf(state: SimState): Rank {
  if (state.phase !== 'success') return 'DETENTION';
  if (state.catches > 0) return 'CLOSE CALL';
  return state.spottings === 0 ? 'GHOST' : 'SMOOTH';
}

/** Grade from the raw score against par. Not finishing is always a D. */
export function gradeOf(raw: number, par: number, success: boolean): Grade {
  if (!success) return 'D';
  const r = par > 0 ? raw / par : 1;
  if (r >= 0.97) return 'A+';
  if (r >= 0.85) return 'A';
  if (r >= 0.7) return 'B';
  if (r >= 0.5) return 'C';
  return 'D';
}

export function hallReport(state: SimState, par: number): HallReport {
  const lines = scoreLines(state);
  const raw = lines.reduce((a, l) => a + l.points, 0);
  const multiplier = DIFFICULTY[state.config.difficulty].scoreMult;
  const success = state.phase === 'success';
  return {
    mission: state.plan.mission,
    difficulty: state.config.difficulty,
    success,
    outcome: state.phase === 'playing' ? 'timeout' : state.phase,
    rank: rankOf(state),
    grade: gradeOf(raw, par, success),
    lines,
    raw,
    multiplier,
    total: Math.max(0, Math.round(raw * multiplier)),
    par,
    seconds: Math.floor(state.tick / SIM_HZ),
    secondsLeft: Math.floor(state.bell / SIM_HZ),
    spotted: state.spottings,
    caught: state.catches,
    remarks: remarks(state),
  };
}

/** Par for a plan: the perfect bot's raw score on the reference route (an estimate when there's no route). */
export function computePar(plan: SchoolPlan, config: RunConfig): number {
  const passes = DIFFICULTY[config.difficulty].passes;
  const estimate = POINTS.mission + POINTS.ghost + (passes > 0 ? POINTS.passUnused : 0) + Math.floor((plan.bellTicks / SIM_HZ) * 0.3) * POINTS.perSecondLeft;
  if (!plan.referenceRoute) return estimate;
  const s = createSim(plan, config);
  const bot = createBot(plan, { skill: 1 });
  while (s.phase === 'playing') step(s, bot.decide(s));
  if (s.phase !== 'success') return estimate;
  return scoreLines(s).reduce((a, l) => a + l.points, 0);
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const HIDE_NAME: Record<string, string> = { locker: 'a locker', stall: 'a bathroom stall', bleachers: 'the bleachers' };

/**
 * 1–3 remarks in the teacher's handwriting, picked from what happened (GDD §8). Funny about the situation, never
 * about the student (GDD §0). Ordered by how remarkable each is; deterministic.
 */
export function remarks(state: SimState): string[] {
  const s = state;
  const st = s.stats;
  const ok = s.phase === 'success';
  const out: [number, string][] = [];
  const secs = Math.max(1, s.tick / SIM_HZ);
  const hid = st.hiddenTicks / SIM_HZ;
  if (s.phase === 'detention') out.push([100, 'Reason: wandering. Duration: emotionally, forever.']);
  if (s.phase === 'timeout') out.push([95, 'Was not in seat when the bell rang. Was there in spirit.']);
  if (ok && s.plan.mission === 'pizza' && st.firstInLine) out.push([90, 'Got PIZZA DAY first in line. Showed no remorse.']);
  if (ok && s.plan.mission === 'pizza' && st.firstInLine === false) out.push([60, 'Made it to PIZZA DAY. The line did not wait.']);
  if (ok && s.spottings === 0 && s.closeCalls >= 2) out.push([85, `Walked right behind staff ${s.closeCalls} times. Nobody noticed. Unsettling.`]);
  else if (ok && s.spottings === 0) out.push([70, 'Nobody saw a thing. Not even the cameras.']);
  if (st.longestHide >= 30 * SIM_HZ) out.push([80, `Spent ${Math.floor(st.longestHide / SIM_HZ)} s in ${HIDE_NAME[st.longestHideKind] ?? 'a hiding spot'}. Called it "thinking time."`]);
  else if (hid > 20 && hid / secs > 0.25) out.push([75, 'Excellent hiding. Concerning amount of hiding.']);
  if (st.cameraAlerts >= 2) out.push([72, `Was seen by the camera ${st.cameraAlerts} times. Waved once.`]);
  if (st.throws >= 3) out.push([55, `Threw ${st.throws} erasers. All of them "by accident."`]);
  if (st.distractions >= 2) out.push([65, 'Created several mysterious noises. Staff remain baffled.']);
  if (st.snacks === s.plan.snacks.length && st.snacks > 0) out.push([68, 'Collected every snack pack. Shared none.']);
  if (st.buysCancelled > 0) out.push([50, 'Abandoned a half-bought bag of chips. The machine kept the change.']);
  if (st.shoos > 0) out.push([58, st.shoos > 1 ? `Shooed away from the lunch counter ${st.shoos} times. Persistent.` : 'Shooed away from the lunch counter. Early bird, wrong worm.']);
  if (ok && s.catches === 2) out.push([66, 'Got walked back to class twice. Knows the way by heart now.']);
  if (ok && s.catches === 1) out.push([45, 'Walked back to class once. Tried again immediately.']);
  if (ok && s.spottings > 0 && s.catches === 0) out.push([52, 'Seen, but never stopped. Smooth operator.']);
  if (ok && s.bell < 10 * SIM_HZ) out.push([78, 'Slid into the seat as the bell rang. Dramatic.']);
  if (st.sprintTicks > 20 * SIM_HZ) out.push([48, 'Ran in the halls. Quite a lot, actually.']);
  if (s.escapes >= 2) out.push([62, `Lost a chasing teacher ${s.escapes} times. Has a future in track.`]);
  if (ok && s.plan.mission === 'principal' && s.spottings === 0) out.push([88, 'Recovered three phones from the principal. The principal is still looking for them.']);
  if (out.length === 0) out.push([1, ok ? 'Back before the bell. Nothing to report. Suspicious.' : 'An eventful period.']);
  out.sort((a, b) => b[0] - a[0]);
  return out.slice(0, 3).map((r) => r[1]);
}

/** Bonus seconds of the first-in-line window (UI: "Lunch bell! You have N s to be first"). */
export const FIRST_WINDOW = MISSION_RULES.firstWindow;
