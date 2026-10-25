// Builds a school off the main thread (docs/ARCHITECTURE.md §4: generation + validation can take a second or two on
// a phone — longer for the finale). Message in: GenConfig + id. Message out: the SchoolPlan (typed arrays
// transferred, not copied) and its par (the perfect bot's score, for the Hall Report grade). Requests queue up in
// order, so the app can prefetch the next period while you read the report.
import { generateSchool, type GenConfig } from '../school/gen';
import { computePar } from '../sim/score';

self.onmessage = (e: MessageEvent<GenConfig & { id: number }>): void => {
  const { id, ...config } = e.data;
  const plan = generateSchool(config);
  const par = computePar(plan, { seed: config.seed, tier: config.tier, mission: config.mission, difficulty: config.difficulty ?? 'junior', daily: null });
  (self as unknown as Worker).postMessage({ id, plan, par }, [plan.cells.buffer, plan.fine.flags.buffer]);
};
