// Builds a school off the main thread (docs/ARCHITECTURE.md §4: generation + validation can take a second or two on
// a phone). Message in: GenConfig. Message out: the SchoolPlan (typed arrays transferred, not copied).
import { generateSchool, type GenConfig } from '../school/gen';

self.onmessage = (e: MessageEvent<GenConfig & { id: number }>): void => {
  const { id, ...config } = e.data;
  const plan = generateSchool(config);
  (self as unknown as Worker).postMessage({ id, plan }, [plan.cells.buffer, plan.fine.flags.buffer]);
};
