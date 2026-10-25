// ─────────────────────────────────────────────────────────────────────────────
// Music theory helpers (pure, unit-tested): pitch maths, note names, chord symbols
// and voicings for the arranger. Adapted from TRASH PANDA TROUBLE's theory.ts.
// Copied from ATHLETE MAYHEM (src/audio) for HALL PASS.
// ─────────────────────────────────────────────────────────────────────────────

/** MIDI note → frequency in Hz (A4 = 69 = 440 Hz, equal temperament). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Frequency → (fractional) MIDI note. */
export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440);
}

/** Cents → frequency ratio. */
export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

const PITCH_CLASS: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Parse a note name like "G3", "F#4", "Bb2" (C4 = 60) into a MIDI number.
 * Throws on malformed input — note names only appear in hand-written song data.
 */
export function noteToMidi(name: string): number {
  const m = /^([A-Ga-g])([#b]?)(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`noteToMidi: bad note "${name}"`);
  const letter = m[1]!.toUpperCase();
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  const octave = Number(m[3]);
  return (octave + 1) * 12 + PITCH_CLASS[letter]! + acc;
}

/** Chord qualities as semitone intervals above the root (root first). */
export const QUALITIES: Readonly<Record<string, readonly number[]>> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '5': [0, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  add9: [0, 4, 7, 14],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  m9: [0, 3, 7, 10, 14],
  maj9: [0, 4, 7, 11, 14],
  dim: [0, 3, 6],
};

export interface Chord {
  /** Root pitch class 0..11 (0 = C). */
  root: number;
  /** Intervals above the root, root (0) first. */
  intervals: readonly number[];
}

const chordCache = new Map<string, Chord>();

/** Parse a chord symbol: "Em", "Bbmaj7", "A7", "D5", "Gsus4", "F#m9". Throws on unknown symbols. */
export function parseChord(symbol: string): Chord {
  const hit = chordCache.get(symbol);
  if (hit) return hit;
  const m = /^([A-G])([#b]?)(maj9|maj7|m9|m7|m6|add9|sus2|sus4|dim|m|7|6|5|)$/.exec(symbol.trim());
  if (!m || !QUALITIES[m[3]!]) throw new Error(`parseChord: bad chord "${symbol}"`);
  const root = (PITCH_CLASS[m[1]!]! + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const c: Chord = { root, intervals: QUALITIES[m[3]!]! };
  chordCache.set(symbol, c);
  return c;
}

/** Pitch classes of a chord's tones, root first. */
export function chordPcs(symbol: string): number[] {
  const c = parseChord(symbol);
  return c.intervals.map((i) => (c.root + i) % 12);
}

export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;

/** Synth-bass range used by the arranger. */
export const BASS_LOW = 28; // E1
export const BASS_HIGH = 57; // A3

/** Bass root for a chord: the pitch class placed in A1..G#2 (33..44). */
export function bassRoot(symbol: string): number {
  return 33 + ((parseChord(symbol).root - 9 + 12) % 12);
}

/** The chord tone `interval` semitones above the bass root, kept inside the bass range. */
export function bassTone(symbol: string, interval: number): number {
  let n = bassRoot(symbol) + interval;
  while (n > BASS_HIGH) n -= 12;
  while (n < BASS_LOW) n += 12;
  return n;
}

/**
 * Close voicing of a chord with every tone placed in [low, low + 12), sorted
 * ascending. Extensions above the octave (9ths) fold down into the same window.
 */
export function closeVoicing(symbol: string, low = 57): number[] {
  const c = parseChord(symbol);
  const seen = new Set<number>();
  const out: number[] = [];
  for (const iv of c.intervals) {
    const p = (c.root + iv) % 12;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(low + ((p - pitchClass(low) + 12) % 12));
  }
  return out.sort((a, b) => a - b);
}

/** Power-chord voicing: root, fifth, octave — root placed in [low, low + 12). */
export function powerVoicing(symbol: string, low = 40): number[] {
  const c = parseChord(symbol);
  const r = low + ((c.root - pitchClass(low) + 12) % 12);
  return [r, r + 7, r + 12];
}

/** Chord tones spread upward from `low` over `octaves` (arpeggio material). */
export function arpTones(symbol: string, low = 64, octaves = 2): number[] {
  const base = closeVoicing(symbol, low);
  const out: number[] = [];
  for (let o = 0; o < octaves; o++) for (const n of base) out.push(n + 12 * o);
  return out;
}
