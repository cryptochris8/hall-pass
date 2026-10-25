import { describe, expect, it } from 'vitest';
import { SOFT_SHARE, VoiceLimiter, type VoiceRule } from '../../src/audio/limits';

const rule = (cooldown: number, maxVoices: number, priority: 0 | 1 | 2 | 3): VoiceRule => ({ cooldown, maxVoices, priority });

describe('VoiceLimiter', () => {
  it('cooldown: a repeat inside the window is refused, after it allowed', () => {
    const v = new VoiceLimiter(10);
    const r = rule(0.07, 5, 1);
    expect(v.tryStart('step', r, 0, 0.05)).toBe(true);
    expect(v.tryStart('step', r, 0.03, 0.08)).toBe(false);
    expect(v.tryStart('step', r, 0.069, 0.1)).toBe(false);
    expect(v.tryStart('step', r, 0.071, 0.12)).toBe(true);
    // Other sounds are independent.
    expect(v.tryStart('kick', r, 0.072, 0.2)).toBe(true);
  });

  it('per-sound voices: at most maxVoices overlapping, freed when they end', () => {
    const v = new VoiceLimiter(10);
    const r = rule(0, 2, 1);
    expect(v.tryStart('rim', r, 0, 1)).toBe(true);
    expect(v.tryStart('rim', r, 0.1, 1.1)).toBe(true);
    expect(v.tryStart('rim', r, 0.2, 1.2)).toBe(false);
    expect(v.voices('rim')).toBe(2);
    expect(v.tryStart('rim', r, 1.05, 2)).toBe(true); // the first one finished
  });

  it('global budget drops spammy sounds first, then normal ones; stingers always play', () => {
    const v = new VoiceLimiter(10);
    const busy = rule(0, 100, 2);
    for (let i = 0; i < Math.ceil(10 * SOFT_SHARE); i++) expect(v.tryStart(`x${i}`, busy, 0, 5)).toBe(true);
    // Above the soft share: priority 0 is refused, 1 still allowed.
    expect(v.allow('step', rule(0, 5, 0), 0.1)).toBe(false);
    expect(v.allow('bonus', rule(0, 5, 1), 0.1)).toBe(true);
    while (v.count < 10) v.tryStart(`y${v.count}`, busy, 0.1, 5);
    // Full: only majors and stingers.
    expect(v.allow('bonus', rule(0, 5, 1), 0.2)).toBe(false);
    expect(v.allow('swish', rule(0, 5, 2), 0.2)).toBe(true);
    expect(v.allow('goalHorn', rule(0, 5, 3), 0.2)).toBe(true);
    // Once everything has finished, the budget is free again.
    expect(v.allow('step', rule(0, 5, 0), 6)).toBe(true);
    expect(v.count).toBe(0);
  });

  it('a stinger still respects its own maxVoices', () => {
    const v = new VoiceLimiter(4);
    const r = rule(0, 1, 3);
    expect(v.tryStart('goalHorn', r, 0, 3)).toBe(true);
    expect(v.tryStart('goalHorn', r, 0.5, 3.5)).toBe(false);
  });

  it('non-finite end times never poison the count', () => {
    const v = new VoiceLimiter(4);
    v.commit('a', 1, NaN);
    v.commit('b', 1, Infinity);
    v.prune(1.001);
    expect(v.count).toBe(0);
  });

  it('time going backwards (rebuilt context) does not block sounds forever', () => {
    const v = new VoiceLimiter(4);
    const r = rule(0.5, 1, 1);
    v.tryStart('a', r, 100, 100.2);
    expect(v.allow('a', r, 0.1)).toBe(true);
    v.reset();
    expect(v.count).toBe(0);
  });

  it('20 identical sounds in one frame play once per cooldown window', () => {
    const v = new VoiceLimiter();
    const r = rule(0.06, 3, 0);
    let n = 0;
    for (let i = 0; i < 20; i++) if (v.tryStart('dribble', r, 5, 5.1)) n++;
    expect(n).toBe(1);
  });
});
