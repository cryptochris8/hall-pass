// Engine behaviour on a stubbed Web Audio: nothing before unlock, cooldowns and voice limits, mute, remembered
// settings, ambience on/off, and the hiding muffle.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, fadeInFor, fadeOutFor, sliderToGain } from '../../src/audio/index';
import { SFX_META } from '../../src/audio/sfx';
import { type FakeEnv, installFakeAudio, uninstallFakeAudio } from './fakeAudio';

let env: FakeEnv;
beforeEach(() => {
  env = installFakeAudio();
});
afterEach(() => uninstallFakeAudio());

function nodesFor(fn: () => void): number {
  const before = env.last().nodes;
  fn();
  return env.last().nodes - before;
}

describe('audio engine', () => {
  it('pure helpers', () => {
    expect(sliderToGain(0.5)).toBeCloseTo(0.25, 9);
    expect(sliderToGain(NaN)).toBe(0);
    expect(fadeInFor('report')).toBeLessThan(0.1);
    expect(fadeInFor('sneak')).toBeGreaterThan(1);
    expect(fadeOutFor('report')).toBeLessThan(fadeOutFor('menu'));
  });

  it('plays nothing before unlock (and creates no context), then schedules nodes', () => {
    const a = createAudioEngine();
    a.play('lockerIn');
    a.setMusic('sneak');
    a.setAmbience(0.6);
    expect(env.ctxs().length).toBe(0);
    a.unlock();
    expect(a.unlocked).toBe(true);
    vi.advanceTimersByTime(50);
    expect(nodesFor(() => a.play('lockerIn'))).toBeGreaterThan(5);
    expect(a.debugInfo().track).toBe('sneak');
    expect(a.debugInfo().ambience).toBeCloseTo(0.6, 9);
    a.dispose();
  });

  it('footstep spam is cut by the cooldown; voices by their limit', () => {
    const a = createAudioEngine();
    a.unlock();
    vi.advanceTimersByTime(100);
    expect(nodesFor(() => a.play('step'))).toBeGreaterThan(0);
    expect(nodesFor(() => a.play('step'))).toBe(0);
    vi.advanceTimersByTime(Math.ceil(SFX_META.step.cooldown * 1000) + 20);
    expect(nodesFor(() => a.play('step'))).toBeGreaterThan(0);
    let played = 0;
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(Math.ceil(SFX_META.vHey.cooldown * 1000) + 5);
      if (nodesFor(() => a.play('vHey')) > 0) played++;
    }
    expect(played).toBeGreaterThan(1);
    a.dispose();
  });

  it('muted plays nothing; the muffle and ambience toggle without throwing', () => {
    const a = createAudioEngine();
    a.unlock();
    vi.advanceTimersByTime(100);
    a.setMuted(true);
    expect(nodesFor(() => a.play('bell'))).toBe(0);
    a.setMuted(false);
    expect(nodesFor(() => a.play('bell'))).toBeGreaterThan(0);
    a.setAmbience(0.6);
    a.setMuffled(true);
    expect(a.debugInfo().muffled).toBe(true);
    a.setAmbience(-1);
    expect(a.debugInfo().ambience).toBe(-1);
    for (let i = 0; i < 40; i++) vi.advanceTimersByTime(25); // scheduler keeps ticking
    a.dispose();
  });

  it('a broken audio stack never throws into the game', () => {
    const a = createAudioEngine();
    a.unlock();
    (env.last().constructor as unknown as { explode: boolean }).explode = true;
    expect(() => {
      a.play('busted');
      a.setMusic('report');
      a.setIntensity(1);
      a.setAmbience(0.4);
      a.setMuffled(true);
      vi.advanceTimersByTime(200);
    }).not.toThrow();
    a.dispose();
  });
});
