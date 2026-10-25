// Headless playtest (docs/ARCHITECTURE.md §13): generate a school, let the bot play it in the pure sim, report how
// it went. Used by the balance suite (`npm run test:balance`) and, later, the server-side score check. No DOM.
import { generateSchool } from '../school/gen';
import { createSim, step, type RunConfig, type RunPhase, type SimEvent } from '../sim';
import { createBot } from '../sim/bot';

export interface PlaytestResult {
  config: RunConfig;
  phase: Exclude<RunPhase, 'playing'>;
  seconds: number;
  bellLeft: number;
  spottings: number;
  catches: number;
  heard: number;
  escapes: number;
  validated: boolean;
  fallback: boolean;
}

export function playtest(config: RunConfig, skill: number, botSeed = 1): PlaytestResult {
  const plan = generateSchool(config);
  const s = createSim(plan, config);
  const bot = createBot(plan, { skill, seed: botSeed });
  let heard = 0;
  while (s.phase === 'playing') {
    const ev: SimEvent[] = step(s, bot.decide(s));
    for (const e of ev) if (e.t === 'heard') heard++;
  }
  return {
    config,
    phase: s.phase as PlaytestResult['phase'],
    seconds: s.tick / 60,
    bellLeft: s.bell / 60,
    spottings: s.spottings,
    catches: s.catches,
    heard,
    escapes: s.escapes,
    validated: plan.referenceRoute !== null,
    fallback: plan.fallback,
  };
}
