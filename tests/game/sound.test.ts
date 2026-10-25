// The sound director: music per screen, suspicion → sneak-track intensity, sim events → sounds with voices and
// placement, footsteps from the distance walked.
import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../../src/audio/types';
import { musicFor, placeAt, SoundDirector, suspicionIntensity, voicePitch } from '../../src/game/sound';
import { generateSchool } from '../../src/school/gen';
import { createSim, type RunConfig, type SimState } from '../../src/sim';

function fakeAudio(): AudioEngine & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    unlock: () => {},
    unlocked: true,
    muted: false,
    play: (n) => void log.push(n),
    setMusic: (t) => void log.push(`music:${t}`),
    setIntensity: (v) => void log.push(`int:${v.toFixed(2)}`),
    setAmbience: (v) => void log.push(`amb:${v}`),
    setMuffled: (m) => void log.push(`muffle:${m}`),
    setVolumes: () => {},
    setMuted: () => {},
    setPaused: (p) => void log.push(`paused:${p}`),
    dispose: () => {},
  };
}

const config: RunConfig = { seed: 9, mission: 'phone', tier: 2, difficulty: 'junior', daily: null };
const plan = generateSchool({ ...config, validate: false });
const fresh = (): SimState => createSim(plan, config);

describe('sound director', () => {
  it('music by screen', () => {
    expect(musicFor('title')).toBe('title');
    expect(musicFor('menu')).toBe('menu');
    expect(musicFor('intro')).toBe('none');
    expect(musicFor('playing')).toBe('sneak');
    expect(musicFor('report')).toBe('report');
    expect(musicFor('loading')).toBeNull();
  });

  it('suspicion intensity: calm 0, curious in the middle, spotted or chased 1, the last 20 s tense', () => {
    const s = fresh();
    expect(suspicionIntensity(s)).toBe(0);
    s.staff[0]!.level = 'curious';
    const mid = suspicionIntensity(s);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.75);
    s.staff[0]!.mode = 'chase';
    expect(suspicionIntensity(s)).toBe(1);
    const t = fresh();
    t.bell = 10 * 60;
    expect(suspicionIntensity(t)).toBeGreaterThanOrEqual(0.4);
  });

  it('voices differ by character and stay in a sane range; Preston is high, Hargrove low', () => {
    const p = plan.staff.map((_, i) => voicePitch(plan, i));
    for (const v of p) {
      expect(v).toBeGreaterThan(0.6);
      expect(v).toBeLessThan(2);
    }
    const snitch = plan.staff.findIndex((s) => s.archetype === 'snitch');
    const vp = plan.staff.findIndex((s) => s.archetype === 'investigator');
    if (snitch >= 0 && vp >= 0) expect(voicePitch(plan, snitch)).toBeGreaterThan(voicePitch(plan, vp));
  });

  it('placement: pan follows left/right, far things are quieter', () => {
    const s = fresh();
    const left = placeAt(s, s.student.x - 10, s.student.z);
    const right = placeAt(s, s.student.x + 10, s.student.z);
    const far = placeAt(s, s.student.x, s.student.z + 40);
    expect(left.pan).toBeLessThan(0);
    expect(right.pan).toBeGreaterThan(0);
    expect(far.volume).toBeLessThan(placeAt(s, s.student.x, s.student.z + 2).volume);
  });

  it('events map to sounds and voices', () => {
    const a = fakeAudio();
    const d = new SoundDirector(a);
    const s = fresh();
    vi.useFakeTimers();
    d.onEvents(
      [
        { t: 'suspicion', staff: 0, level: 'spotted' },
        { t: 'heard', staff: 1 },
        { t: 'hide', spot: 0, enter: true },
        { t: 'pa', id: 'hatsOff' },
        { t: 'caught', staff: 0, passUsed: true },
        { t: 'snack', index: 0 },
        { t: 'end', phase: 'detention' },
      ],
      s,
      plan,
    );
    vi.advanceTimersByTime(1500);
    vi.useRealTimers();
    for (const n of ['spotted', 'vHey', 'vHm', 'lockerIn', 'paChime', 'vAnnounce', 'passFlash', 'vCarryOn', 'snack', 'detention']) expect(a.log, n).toContain(n);
  });

  it('screens: ambience only during a run, the fly-over sting on the mission card, pause ducks', () => {
    const a = fakeAudio();
    const d = new SoundDirector(a);
    d.setScreen('menu', false);
    expect(a.log).toContain('music:menu');
    expect(a.log).toContain('amb:-1');
    d.setScreen('intro', true);
    expect(a.log).toContain('flyover');
    expect(a.log).toContain('amb:0.6');
    d.setScreen('paused', true);
    expect(a.log).toContain('paused:true');
  });

  it('footsteps from the distance walked: walking taps, sprinting squeaks, hiding is silent', () => {
    const a = fakeAudio();
    const d = new SoundDirector(a);
    d.setScreen('playing', true);
    const s = fresh();
    d.update(s, plan, 1 / 60);
    for (let i = 0; i < 20; i++) {
      s.student.x += 0.1;
      d.update(s, plan, 1 / 60);
    }
    expect(a.log.filter((x) => x === 'step').length).toBe(2);
    s.student.posture = 'sprint';
    for (let i = 0; i < 24; i++) {
      s.student.x += 0.1;
      d.update(s, plan, 1 / 60);
    }
    expect(a.log.filter((x) => x === 'squeak').length).toBeGreaterThanOrEqual(2);
    s.student.hidden = 0;
    const before = a.log.length;
    for (let i = 0; i < 10; i++) {
      s.student.x += 0.2;
      d.update(s, plan, 1 / 60);
    }
    expect(a.log.slice(before).some((x) => x === 'step' || x === 'squeak')).toBe(false);
    expect(a.log).toContain('muffle:true');
  });
});
