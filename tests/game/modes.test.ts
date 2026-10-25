// Game modes (docs/GDD.md §1, §9): DAILY seeds and numbering, the SCHOOL WEEK schedule and grade.
import { describe, expect, it } from 'vitest';
import { civilDay, dailyConfig, dailyNumber, todayKey, unlocksNext, weekConfig, weekGrade, weekPlan } from '../../src/game/modes';

describe('daily', () => {
  it('counts days with integer calendar math', () => {
    expect(civilDay(19700101)).toBe(0);
    expect(civilDay(20000301) - civilDay(20000228)).toBe(2); // 2000 was a leap year
    expect(civilDay(21000301) - civilDay(21000228)).toBe(1); // 2100 isn't
    expect(dailyNumber(20260901)).toBe(1);
    expect(dailyNumber(20261025)).toBe(55);
    expect(dailyNumber(20270101) - dailyNumber(20261231)).toBe(1);
  });

  it('the same date is the same run for everyone; seeds fit a challenge code (22 bits)', () => {
    const a = dailyConfig(20261025);
    expect(dailyConfig(20261025)).toEqual(a);
    expect(a.daily).toBe(20261025);
    expect(a.seed).toBeLessThan(1 << 22);
    expect(a.mission).not.toBe('principal');
    const seeds = new Set<number>();
    const tiers = new Set<number>();
    for (let d = 1; d <= 28; d++) {
      const c = dailyConfig(20261100 + d);
      seeds.add(c.seed);
      tiers.add(c.tier);
    }
    expect(seeds.size).toBe(28);
    expect(tiers.size).toBe(5);
  });

  it('todayKey formats the local date', () => {
    expect(todayKey(new Date(2026, 9, 25, 13, 0))).toBe(20261025);
  });
});

describe('school week', () => {
  it('five periods, four different everyday missions, the office on Friday, harder each day', () => {
    for (let seed = 0; seed < 50; seed++) {
      const w = weekPlan(seed);
      expect(w.map((d) => d.day)).toEqual(['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']);
      expect(w[4]!.mission).toBe('principal');
      expect(new Set(w.slice(0, 4).map((d) => d.mission)).size).toBe(4);
      expect(w.slice(0, 4).every((d) => d.mission !== 'principal')).toBe(true);
      const rank = { freshman: 0, junior: 1, senior: 2 };
      for (let i = 1; i < 5; i++) expect(rank[w[i]!.difficulty]).toBeGreaterThanOrEqual(rank[w[i - 1]!.difficulty]);
    }
    const c = weekConfig(7, 3, 2);
    expect(c).toMatchObject({ seed: 7, tier: 3, mission: weekPlan(7)[2]!.mission });
  });

  it('week grade is the grade-point average; an A average unlocks the next school', () => {
    expect(weekGrade(['A+', 'A+', 'A+', 'A+', 'A+'])).toBe('A+');
    expect(weekGrade(['A+', 'A', 'A', 'B', 'A'])).toBe('A');
    expect(weekGrade(['A', 'B', 'B', 'C', 'A'])).toBe('B');
    expect(weekGrade(['D', 'D', 'C', 'D', 'D'])).toBe('D');
    expect(unlocksNext('A')).toBe(true);
    expect(unlocksNext('A+')).toBe(true);
    expect(unlocksNext('B')).toBe(false);
  });
});
