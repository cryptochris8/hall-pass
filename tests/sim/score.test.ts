// The Hall Report (docs/GDD.md §8): lines, multiplier, grade against par, rank, remarks.
import { describe, expect, it } from 'vitest';
import { generateSchool } from '../../src/school/gen';
import { createSim, step, type RunConfig, type SimState } from '../../src/sim';
import { createBot } from '../../src/sim/bot';
import { computePar, gradeOf, hallReport, POINTS, rankOf, remarks } from '../../src/sim/score';

const config: RunConfig = { seed: 33, mission: 'locker', tier: 1, difficulty: 'junior', daily: null };
const plan = generateSchool(config);

function botRun(c: RunConfig = config, skill = 1): SimState {
  const s = createSim(plan, c);
  const bot = createBot(plan, { skill });
  while (s.phase === 'playing') step(s, bot.decide(s));
  return s;
}

describe('hall report', () => {
  it('a perfect bot run is a GHOST, scores exactly par, grades A+', () => {
    const par = computePar(plan, config);
    const s = botRun();
    expect(s.phase).toBe('success');
    const r = hallReport(s, par);
    expect(r.rank).toBe('GHOST');
    expect(r.raw).toBe(par);
    expect(r.grade).toBe('A+');
    expect(r.lines.map((l) => l.label)).toContain('GHOST — never spotted');
    expect(r.raw).toBe(POINTS.mission + POINTS.ghost + POINTS.passUnused + r.secondsLeft * POINTS.perSecondLeft);
    expect(r.total).toBe(r.raw); // JUNIOR ×1.0
  });

  it('the difficulty multiplier scales the total, not the grade', () => {
    const s = botRun();
    const r = hallReport(s, 1000);
    const senior = hallReport({ ...s, config: { ...s.config, difficulty: 'senior' } }, 1000);
    expect(senior.total).toBe(Math.round(senior.raw * 1.3));
    expect(senior.grade).toBe(r.grade);
  });

  it('ranks and grades', () => {
    const s = botRun();
    expect(rankOf(s)).toBe('GHOST');
    expect(rankOf({ ...s, spottings: 2 })).toBe('SMOOTH');
    expect(rankOf({ ...s, spottings: 2, catches: 1 })).toBe('CLOSE CALL');
    expect(rankOf({ ...s, phase: 'detention' })).toBe('DETENTION');
    expect(rankOf({ ...s, phase: 'timeout' })).toBe('DETENTION');
    expect(gradeOf(1000, 1000, true)).toBe('A+');
    expect(gradeOf(900, 1000, true)).toBe('A');
    expect(gradeOf(750, 1000, true)).toBe('B');
    expect(gradeOf(550, 1000, true)).toBe('C');
    expect(gradeOf(100, 1000, true)).toBe('D');
    expect(gradeOf(5000, 1000, false)).toBe('D');
  });

  it('a detention scores only the extras, minus the catches, and never goes below zero', () => {
    const s = botRun();
    const d: SimState = { ...s, phase: 'detention', catches: 3, closeCalls: 1 };
    const r = hallReport(d, 4000);
    expect(r.success).toBe(false);
    expect(r.lines.some((l) => l.label === 'Mission complete')).toBe(false);
    expect(r.raw).toBe(POINTS.closeCall + 3 * POINTS.caught);
    expect(r.total).toBe(0);
    expect(r.grade).toBe('D');
    expect(r.remarks[0]).toMatch(/wandering/);
  });

  it('remarks: 1–3, deterministic, picked from what happened', () => {
    const s = botRun();
    const a = remarks(s);
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(remarks(s)).toEqual(a);
    const hidey: SimState = { ...s, stats: { ...s.stats, longestHide: 45 * 60, longestHideKind: 'locker', hiddenTicks: 45 * 60 } };
    expect(remarks(hidey).join(' ')).toMatch(/45 s in a locker/);
    const cam: SimState = { ...s, stats: { ...s.stats, cameraAlerts: 3 } };
    expect(remarks(cam).join(' ')).toMatch(/camera 3 times/);
  });
});
