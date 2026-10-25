// ─────────────────────────────────────────────────────────────────────────────
// Level metering (pure): peak / RMS in dBFS, used by the offline QA harness. (From TRASH PANDA TROUBLE.)
// Copied from ATHLETE MAYHEM (src/audio) for HALL PASS.
// ─────────────────────────────────────────────────────────────────────────────

export interface LevelReport {
  /** Sample peak across channels (dBFS). −Infinity for pure silence. */
  peakDb: number;
  /** RMS over the whole signal, channels averaged in power (dBFS). */
  rmsDb: number;
  /** RMS over only the "active" 50 ms windows (those within 40 dB of the loudest window). */
  gatedRmsDb: number;
  /** Fraction of 50 ms windows that are active (not near-silent). */
  activeRatio: number;
  /** Number of NaN / ±Infinity samples (must be 0). */
  nonFinite: number;
  /** Seconds of audio measured. */
  seconds: number;
}

export function toDb(amplitude: number): number {
  return amplitude > 0 ? 20 * Math.log10(amplitude) : -Infinity;
}

export function fromDb(db: number): number {
  return Math.pow(10, db / 20);
}

/** Measure levels of planar channel data. */
export function measureLevels(channels: readonly Float32Array[], sampleRate: number): LevelReport {
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  let peak = 0;
  let sumSq = 0;
  let count = 0;
  let nonFinite = 0;
  const win = Math.max(1, Math.floor(sampleRate * 0.05));
  const nWin = Math.ceil(len / win);
  const winPow = new Float64Array(nWin);
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i]!;
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      const p = v * v;
      sumSq += p;
      winPow[Math.floor(i / win)]! += p;
      count++;
    }
  }
  const nCh = Math.max(1, channels.length);
  let maxWin = 0;
  for (let w = 0; w < nWin; w++) {
    winPow[w] = winPow[w]! / (win * nCh);
    if (winPow[w]! > maxWin) maxWin = winPow[w]!;
  }
  // Gate: windows within 40 dB (power ratio 1e-4) of the loudest window, and above −80 dBFS.
  const gate = Math.max(maxWin * 1e-4, 1e-8);
  let active = 0;
  let gatedSum = 0;
  for (let w = 0; w < nWin; w++) {
    if (winPow[w]! >= gate) {
      active++;
      gatedSum += winPow[w]!;
    }
  }
  return {
    peakDb: toDb(peak),
    rmsDb: count > 0 ? 10 * Math.log10(sumSq / count || 1e-20) : -Infinity,
    gatedRmsDb: active > 0 ? 10 * Math.log10(gatedSum / active) : -Infinity,
    activeRatio: nWin > 0 ? active / nWin : 0,
    nonFinite,
    seconds: len / sampleRate,
  };
}

/**
 * Coarse amplitude envelope (peak per bucket) for drawing QA thumbnails.
 */
export function envelope(channels: readonly Float32Array[], buckets: number): Float32Array {
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const out = new Float32Array(buckets);
  if (len === 0) return out;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const b = Math.min(buckets - 1, Math.floor((i / len) * buckets));
      const a = Math.abs(ch[i]!);
      if (a > out[b]!) out[b] = a;
    }
  }
  return out;
}

export interface BandReport {
  /** Power in dBFS below ~250 Hz, 250 Hz–2.5 kHz, and above ~2.5 kHz. */
  lowDb: number;
  midDb: number;
  highDb: number;
}

/**
 * Rough 3-band power split using one-pole filters (good enough to judge a mix:
 * is the bass there, is the top end harsh?). Uses the first channel.
 */
export function bandLevels(ch: Float32Array, sampleRate: number): BandReport {
  const aLow = 1 - Math.exp((-2 * Math.PI * 250) / sampleRate);
  const aHigh = 1 - Math.exp((-2 * Math.PI * 2500) / sampleRate);
  let lp = 0;
  let lp2 = 0;
  let pl = 0;
  let pm = 0;
  let ph = 0;
  for (let i = 0; i < ch.length; i++) {
    const x = ch[i]!;
    lp += aLow * (x - lp); // < 250 Hz
    lp2 += aHigh * (x - lp2); // < 2.5 kHz
    const low = lp;
    const high = x - lp2;
    const mid = lp2 - lp;
    pl += low * low;
    pm += mid * mid;
    ph += high * high;
  }
  const n = Math.max(1, ch.length);
  const db = (p: number): number => (p > 0 ? 10 * Math.log10(p / n) : -Infinity);
  return { lowDb: db(pl), midDb: db(pm), highDb: db(ph) };
}

/**
 * Audible span: first and last 10 ms window whose power is within `relDb` of the
 * loudest window (and above −70 dBFS). Used by QA to check an effect's real length
 * against the end time its recipe declares (which feeds the voice limiter).
 */
export function audibleSpan(channels: readonly Float32Array[], sampleRate: number, relDb = 30): { start: number; end: number } {
  const len = channels.reduce((m, c) => Math.max(m, c.length), 0);
  const win = Math.max(1, Math.floor(sampleRate * 0.01));
  const nWin = Math.ceil(len / win);
  if (nWin === 0) return { start: 0, end: 0 };
  const pow = new Float64Array(nWin);
  for (const ch of channels) for (let i = 0; i < ch.length; i++) if (Number.isFinite(ch[i]!)) pow[Math.floor(i / win)]! += ch[i]! * ch[i]!;
  let max = 0;
  for (let w = 0; w < nWin; w++) max = Math.max(max, pow[w]!);
  const gate = Math.max(max * Math.pow(10, -relDb / 10), win * channels.length * 1e-7);
  let first = -1;
  let last = -1;
  for (let w = 0; w < nWin; w++) {
    if (pow[w]! >= gate) {
      if (first < 0) first = w;
      last = w;
    }
  }
  if (first < 0) return { start: 0, end: 0 };
  return { start: (first * win) / sampleRate, end: Math.min(len, (last + 1) * win) / sampleRate };
}
