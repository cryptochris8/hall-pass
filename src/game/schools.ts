// School requests (integration): one worker builds plans in order; results are cached by config so a prefetched
// period (the next SCHOOL WEEK day, today's DAILY) starts instantly. Falls back to building on the main thread when
// workers aren't available.
import { generateSchool } from '../school/gen';
import type { SchoolPlan } from '../school/types';
import { computePar } from '../sim/score';
import type { RunConfig } from '../sim/types';

export interface BuiltSchool {
  plan: SchoolPlan;
  par: number;
}

const CACHE = 6;

export class Schools {
  private worker: Worker | null = null;
  private broken = false;
  private nextId = 1;
  private readonly waiting = new Map<number, { done: (b: BuiltSchool) => void; config: RunConfig }>();
  private readonly cache = new Map<string, Promise<BuiltSchool>>();

  static key(c: Pick<RunConfig, 'seed' | 'tier' | 'mission' | 'difficulty'>): string {
    return `${c.seed}:${c.tier}:${c.mission}:${c.difficulty}`;
  }

  has(c: RunConfig): boolean {
    return this.cache.has(Schools.key(c));
  }

  /** The school for this run (cached; building it if needed). */
  get(c: RunConfig): Promise<BuiltSchool> {
    const key = Schools.key(c);
    let p = this.cache.get(key);
    if (!p) {
      p = this.build(c);
      this.cache.set(key, p);
      while (this.cache.size > CACHE) this.cache.delete(this.cache.keys().next().value!);
    }
    return p;
  }

  /** Start building a school we'll probably need soon. */
  prefetch(c: RunConfig): void {
    void this.get(c);
  }

  private build(c: RunConfig): Promise<BuiltSchool> {
    const gen = { seed: c.seed, tier: c.tier, mission: c.mission, difficulty: c.difficulty };
    const sync = (): Promise<BuiltSchool> =>
      new Promise((resolve) => {
        // Let the loading banner paint first.
        setTimeout(() => {
          const plan = generateSchool(gen);
          resolve({ plan, par: computePar(plan, c) });
        }, 30);
      });
    if (this.broken) return sync();
    try {
      this.worker ??= this.spawn();
    } catch {
      this.broken = true;
      return sync();
    }
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, { done: resolve, config: c });
      this.worker!.postMessage({ id, ...gen });
    });
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./genWorker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<{ id: number; plan: SchoolPlan; par: number }>): void => {
      const w8 = this.waiting.get(e.data.id);
      this.waiting.delete(e.data.id);
      w8?.done({ plan: e.data.plan, par: e.data.par });
    };
    w.onerror = (): void => {
      // Worker failed (old browser, blocked): finish everything still waiting on the main thread.
      w.terminate();
      this.worker = null;
      this.broken = true;
      const pending = [...this.waiting.values()];
      this.waiting.clear();
      for (const { done, config } of pending) {
        const plan = generateSchool({ seed: config.seed, tier: config.tier, mission: config.mission, difficulty: config.difficulty });
        done({ plan, par: computePar(plan, config) });
      }
    };
    return w;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
