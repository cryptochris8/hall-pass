// Builds a school off the main thread (docs/ARCHITECTURE.md §4: generation + validation can take a second or two on
// a phone — longer for the finale). Message in: GenConfig + id. Message out: the SchoolPlan (typed arrays
// transferred, not copied) and its par (the perfect bot's score, for the Hall Report grade). Requests queue up in
// order, so the app can prefetch the next period while you read the report. A 'week' request builds all five days
// of a SCHOOL WEEK together (they share one building).
import { generateSchool, generateWeek, type GenConfig, type WeekDaySpec } from '../school/gen';
import { computePar } from '../sim/score';

self.onmessage = (e: MessageEvent<(GenConfig & { id: number; kind?: 'school' }) | { id: number; kind: 'week'; seed: number; tier: GenConfig['tier']; days: WeekDaySpec[] }>): void => {
  if (e.data.kind === 'week') {
    // A whole SCHOOL WEEK at once: one building, five days (and each day's par).
    const { id, seed, tier, days } = e.data;
    const plans = generateWeek(seed, tier, days);
    const pars = plans.map((p, i) => computePar(p, { seed, tier, mission: days[i]!.mission, difficulty: days[i]!.difficulty, daily: null }));
    (self as unknown as Worker).postMessage({ id, plans, pars }, plans.flatMap((p) => [p.cells.buffer, p.fine.flags.buffer]));
    return;
  }
  const { id, kind: _kind, ...config } = e.data;
  const plan = generateSchool(config);
  const par = computePar(plan, { seed: config.seed, tier: config.tier, mission: config.mission, difficulty: config.difficulty ?? 'junior', daily: null });
  (self as unknown as Worker).postMessage({ id, plan, par }, [plan.cells.buffer, plan.fine.flags.buffer]);
};
