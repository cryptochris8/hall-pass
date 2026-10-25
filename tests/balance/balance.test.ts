// Balance suite (docs/GDD.md §12): slow, opt-in — `npm run test:balance`. Plays many seeds per tier × difficulty
// with an imperfect bot and prints success rates; asserts the perfect bot always succeeds.
import { describe, expect, it } from 'vitest';
import { playtest } from '../../src/headless/playtest';
import { MISSION_IDS, type Difficulty, type TierId } from '../../src/school/types';

const RUN = process.env.BALANCE === '1';
const SEEDS = Number(process.env.SEEDS ?? 20);

describe.skipIf(!RUN)('balance', () => {
  it('success rates by tier × difficulty', { timeout: 3600000 }, () => {
    for (const tier of [1, 2, 3, 4, 5] as TierId[]) {
      for (const difficulty of ['freshman', 'junior', 'senior'] as Difficulty[]) {
        let perfect = 0;
        let sloppy = 0;
        let routed = 0;
        for (let seed = 0; seed < SEEDS; seed++) {
          // Missions rotate with the seed, so every mission is covered at every tier × difficulty.
          const config = { seed: 1000 + seed, mission: MISSION_IDS[seed % MISSION_IDS.length]!, tier, difficulty, daily: null };
          const p = playtest(config, 1);
          if (p.validated) routed++;
          if (p.validated && p.phase === 'success') perfect++;
          if (playtest(config, 0.6, seed).phase === 'success') sloppy++;
        }
        console.log(`tier ${tier} ${difficulty.padEnd(8)} perfect ${perfect}/${routed} (validated ${routed}/${SEEDS})  skill 0.6 ${sloppy}/${SEEDS}`);
        expect(perfect).toBe(routed);
      }
    }
  });
});
