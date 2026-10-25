import { describe, expect, it } from 'vitest';
import { audibleSpan, bandLevels, envelope, fromDb, measureLevels, toDb } from '../../src/audio/meter';
import { makeApplause, makeDriveCurve, makeLcg, makeNoise, makeReverbIR, makeSoftClipCurve, organCoefficients, pulseCoefficients } from '../../src/audio/noise';

const SR = 44100;

function sine(freq: number, seconds: number, amp = 1): Float32Array {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

const diffEnergy = (a: Float32Array): number => {
  let s = 0;
  let e = 0;
  for (let i = 1; i < a.length; i++) {
    s += (a[i]! - a[i - 1]!) ** 2;
    e += a[i]! ** 2;
  }
  return s / e;
};

describe('generators', () => {
  it('LCG is deterministic and in [-1, 1)', () => {
    const a = makeLcg(5);
    const b = makeLcg(5);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
    }
  });

  it('noise is finite, DC-free and normalised; white > pink > brown in HF content', () => {
    for (const kind of ['white', 'pink', 'brown'] as const) {
      const n = makeNoise(kind, SR);
      let peak = 0;
      let mean = 0;
      for (const v of n) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
        mean += v;
      }
      expect(peak).toBeCloseTo(0.95, 5);
      expect(Math.abs(mean / n.length)).toBeLessThan(1e-4);
    }
    expect(diffEnergy(makeNoise('white', SR))).toBeGreaterThan(diffEnergy(makeNoise('pink', SR)));
    expect(diffEnergy(makeNoise('pink', SR))).toBeGreaterThan(diffEnergy(makeNoise('brown', SR)));
  });

  it('stadium reverb IR: stereo, finite, decorrelated, decays, has a predelay', () => {
    const [l, r] = makeReverbIR(SR, 2.6, 2.3, 77, 0.022);
    expect(l.length).toBe(Math.floor(2.6 * SR));
    const rmsAt = (a: Float32Array, t: number): number => {
      const i0 = Math.floor(t * SR);
      let s = 0;
      for (let i = i0; i < i0 + 2000; i++) s += a[i]! ** 2;
      return Math.sqrt(s / 2000);
    };
    for (const ch of [l, r]) {
      expect(ch.every(Number.isFinite)).toBe(true);
      expect(rmsAt(ch, 2.0)).toBeLessThan(rmsAt(ch, 0.1) * 0.2);
      for (let i = 0; i < Math.floor(0.02 * SR); i++) expect(ch[i]).toBe(0);
    }
    expect(l).not.toEqual(r);
  });

  it('applause: dense, finite, normalised, clap energy concentrated in the mid band', () => {
    const a = makeApplause(SR, 2, 200, 9);
    expect(a.length).toBe(2 * SR);
    let peak = 0;
    for (const v of a) {
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeCloseTo(0.95, 5);
    const lv = measureLevels([a], SR);
    expect(lv.activeRatio).toBeGreaterThan(0.95); // no gaps: it's a texture
    const b = bandLevels(a, SR);
    expect(b.midDb).toBeGreaterThan(b.lowDb);
  });

  it('pulse and organ spectra', () => {
    const sq = pulseCoefficients(0.5, 16);
    expect(Math.abs(sq.real[2]!)).toBeLessThan(1e-9); // a square has no even harmonics
    expect(Math.abs(sq.real[1]!)).toBeGreaterThan(0.5);
    const thin = pulseCoefficients(0.125, 16);
    expect(Math.abs(thin.real[2]!)).toBeGreaterThan(0.1);
    const org = organCoefficients([8, 8, 0, 8, 0, 0]);
    expect(org.imag[1]).toBe(1);
    expect(org.imag[2]).toBe(1);
    expect(org.imag[3]).toBe(0);
    expect(org.imag[4]).toBe(1);
  });
});

describe('shaper curves', () => {
  it('soft clip: linear below the knee, monotonic, never above the ceiling (< −0.5 dBFS)', () => {
    const ceiling = 0.93;
    const c = makeSoftClipCurve(4097, ceiling, 0.62);
    let prev = -Infinity;
    for (let i = 0; i < c.length; i++) {
      const u = (i / (c.length - 1)) * 4 - 2;
      const y = c[i]!;
      expect(Math.abs(y)).toBeLessThanOrEqual(ceiling + 1e-6);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
      if (Math.abs(u) <= 0.6) expect(Math.abs(y - u)).toBeLessThan(1e-5);
    }
    expect(toDb(ceiling)).toBeLessThan(-0.5);
  });

  it('drive curve is bounded and odd-symmetric', () => {
    const c = makeDriveCurve(4, 1025);
    expect(c[0]).toBeCloseTo(-1, 6);
    expect(c[c.length - 1]).toBeCloseTo(1, 6);
    expect(c[512]).toBeCloseTo(0, 6);
    for (let i = 0; i < c.length; i++) expect(Math.abs(c[i]! + c[c.length - 1 - i]!)).toBeLessThan(1e-6);
  });
});

describe('meter', () => {
  it('dB conversions', () => {
    expect(toDb(1)).toBe(0);
    expect(toDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(toDb(0)).toBe(-Infinity);
    expect(fromDb(-6.0206)).toBeCloseTo(0.5, 4);
  });

  it('full-scale sine: peak 0 dB, RMS −3 dB', () => {
    const s = sine(1000, 1);
    const r = measureLevels([s, s], SR);
    expect(r.peakDb).toBeCloseTo(0, 2);
    expect(r.rmsDb).toBeCloseTo(-3.01, 1);
    expect(r.activeRatio).toBe(1);
  });

  it('silence is −∞; gating ignores silent stretches; NaNs are counted', () => {
    expect(measureLevels([new Float32Array(SR)], SR).peakDb).toBe(-Infinity);
    const half = new Float32Array(SR);
    half.set(sine(500, 0.5, 0.1));
    const g = measureLevels([half], SR);
    expect(g.activeRatio).toBeCloseTo(0.5, 1);
    expect(g.gatedRmsDb).toBeCloseTo(-23.01, 0);
    expect(measureLevels([new Float32Array([0.1, NaN, 0.2, Infinity])], SR).nonFinite).toBe(2);
  });

  it('envelope tracks peaks per bucket', () => {
    const a = new Float32Array(1000);
    a[10] = 0.5;
    a[990] = -0.9;
    const e = envelope([a], 10);
    expect(e[0]).toBeCloseTo(0.5, 6);
    expect(e[9]).toBeCloseTo(0.9, 6);
  });

  it('audibleSpan finds a burst inside silence and ignores a −40 dB tail', () => {
    const a = new Float32Array(SR * 2);
    a.set(sine(700, 0.3, 0.5), Math.floor(0.5 * SR)); // 0.5 .. 0.8 s
    a.set(sine(700, 0.5, 0.005), Math.floor(0.8 * SR)); // −40 dB relative tail
    const s = audibleSpan([a], SR, 30);
    expect(s.start).toBeCloseTo(0.5, 1);
    expect(s.end).toBeCloseTo(0.8, 1);
    expect(audibleSpan([new Float32Array(100)], SR).end).toBe(0);
  });

  it('band levels separate low / mid / high', () => {
    const lo = bandLevels(sine(80, 1, 0.5), SR);
    expect(lo.lowDb).toBeGreaterThan(lo.midDb + 6);
    const hi = bandLevels(sine(8000, 1, 0.5), SR);
    expect(hi.highDb).toBeGreaterThan(hi.lowDb + 6);
  });
});
