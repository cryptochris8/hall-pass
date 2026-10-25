// ─────────────────────────────────────────────────────────────────────────────
// Game modes (docs/GDD.md §1, §9): which run each mode plays. Pure apart from
// `todayKey()` (the local date). DAILY PERIOD is the same school, mission and
// staff for everyone on a date; SCHOOL WEEK is five periods at one school,
// harder each day, with the PRINCIPAL'S OFFICE on Friday.
// ─────────────────────────────────────────────────────────────────────────────
import { Rng, hashInts } from '../core/rng';
import type { Difficulty, MissionId, TierId } from '../school/types';
import { GRADE_POINTS, type Grade } from '../sim/score';
import { SIM_VERSION, type RunConfig } from '../sim/types';

/** Local date as yyyymmdd. */
export function todayKey(now = new Date()): number {
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

/** Days since 1970-01-01 for a yyyymmdd (proleptic Gregorian, integer math). */
export function civilDay(yyyymmdd: number): number {
  let y = Math.floor(yyyymmdd / 10000);
  const m = Math.floor(yyyymmdd / 100) % 100;
  const d = yyyymmdd % 100;
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** DAILY numbering: 2026-09-01 is HALL PASS #1. */
const DAILY_EPOCH = civilDay(20260901);

export function dailyNumber(yyyymmdd: number): number {
  return civilDay(yyyymmdd) - DAILY_EPOCH + 1;
}

/** The DAILY rotates the five everyday missions (the finale is the week's) and all five schools. */
const DAILY_MISSIONS: readonly MissionId[] = ['phone', 'vending', 'pizza', 'locker', 'gym'];

export function dailyConfig(yyyymmdd: number): RunConfig {
  const n = dailyNumber(yyyymmdd);
  const mix = hashInts(SIM_VERSION, yyyymmdd, 0xd417);
  return {
    seed: hashInts(SIM_VERSION, yyyymmdd) & 0x3fffff,
    tier: (((n % 5) + 5) % 5 + 1) as TierId,
    mission: DAILY_MISSIONS[mix % DAILY_MISSIONS.length]!,
    difficulty: 'junior',
    daily: yyyymmdd,
  };
}

export const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;
/** Harder each day: FRESHMAN rules early in the week, JUNIOR from Wednesday; Friday is the finale. */
const WEEK_DIFFICULTY: readonly Difficulty[] = ['freshman', 'freshman', 'junior', 'junior', 'junior'];

export interface WeekDay {
  day: (typeof WEEKDAYS)[number];
  mission: MissionId;
  difficulty: Difficulty;
}

/** The five periods of a week at school `seed` (Monday–Thursday: four of the everyday missions; Friday: the office). */
export function weekPlan(seed: number): WeekDay[] {
  const rng = new Rng(hashInts(seed, 0x3eec));
  const pool = DAILY_MISSIONS.slice();
  const days: WeekDay[] = [];
  for (let d = 0; d < 4; d++) {
    const mission = pool.splice(rng.int(0, pool.length - 1), 1)[0]!;
    days.push({ day: WEEKDAYS[d]!, mission, difficulty: WEEK_DIFFICULTY[d]! });
  }
  days.push({ day: 'FRIDAY', mission: 'principal', difficulty: WEEK_DIFFICULTY[4]! });
  return days;
}

export function weekConfig(seed: number, tier: TierId, day: number): RunConfig {
  const d = weekPlan(seed)[day]!;
  return { seed, tier, mission: d.mission, difficulty: d.difficulty, daily: null };
}

/** The week grade: the average of the five day grades (grade points), as a letter. */
export function weekGrade(grades: readonly Grade[]): Grade {
  if (grades.length === 0) return 'D';
  const avg = grades.reduce((a, g) => a + GRADE_POINTS[g], 0) / grades.length;
  if (avg >= 4.15) return 'A+';
  if (avg >= 3.5) return 'A';
  if (avg >= 2.5) return 'B';
  if (avg >= 1.5) return 'C';
  return 'D';
}

/** Clearing a week with an A average (A or A+) unlocks the next school (GDD §9). */
export function unlocksNext(grade: Grade): boolean {
  return grade === 'A' || grade === 'A+';
}
