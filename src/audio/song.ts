// ─────────────────────────────────────────────────────────────────────────────
// Songs & arrangement (pure, deterministic, unit-tested). Four ORIGINAL tunes in a
// teen-sitcom caper style (no existing melodies):
//
//   "Hall Pass"        (title)   G minor, 104 BPM, swung — a funky caper theme: walking
//                                 bass, brass melody, e-piano comp; the bridge adds stabs.
//   "Free Period"      (menu)    F major, 82 BPM, lazy swing — lo-fi: half-time drums,
//                                 e-piano and pad, glockenspiel melody.
//   "Out of Class"     (sneak)   D minor, 92 BPM — the run. Layers follow suspicion:
//                                 0 calm: walking bass, ticking hats, e-piano, glock in the
//                                   bridge · 1 curious: groove drums, 16th hats, chip melody,
//                                   arps · 2 chase: four-on-the-floor, chugging guitar, brass
//                                   stabs and lead, +16 BPM.
//   "Report Card"      (report)  C major, 96 BPM — a two-bar "ta-da", then a calm loop.
//
// arrangeBar() turns (song, bar, layers) into note events on a 16-step grid; the
// music player (music.ts) only schedules them. Machinery copied from ATHLETE MAYHEM's
// song.ts (itself adapted from TRASH PANDA TROUBLE); the tunes and layers are new.
// ─────────────────────────────────────────────────────────────────────────────
import { arpTones, bassRoot, bassTone, closeVoicing, noteToMidi, parseChord, powerVoicing } from './theory';
import type { MusicTrack } from './types';

export type SongId = Exclude<MusicTrack, 'none'>;

export type InstName =
  | 'lead'
  | 'brass'
  | 'stab'
  | 'organ'
  | 'power'
  | 'bass'
  | 'arp'
  | 'chip'
  | 'pad'
  | 'epiano'
  | 'bell'
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'openHat'
  | 'crash'
  | 'tom'
  | 'timp';

export interface NoteEvent {
  inst: InstName;
  /** 16th step within the bar (0..15). */
  step: number;
  /** MIDI note (drums: tom/timp pitch; otherwise unused for percussion). */
  midi: number;
  /** 0..1 velocity. */
  vel: number;
  /** Length in 16th steps. */
  len: number;
  /** Chord tones for chord instruments. */
  chord?: readonly number[];
  /** Power chord: palm-muted chug. */
  mute?: boolean;
  /** Lead: portamento from this MIDI note. */
  glide?: number;
}

/** Melody slot codes: > 0 = MIDI onset, HOLD = sustain previous, REST = silence. */
export const HOLD = -1;
export const REST = 0;

export interface BarSpec {
  /** Chord symbol for the first and second half of the bar. */
  chords: readonly [string, string];
  /** 8 eighth-note melody slots. */
  melody: readonly number[];
}

export interface SectionDef {
  name: string;
  bars: readonly BarSpec[];
}

export interface SongDef {
  id: SongId;
  title: string;
  bpm: number;
  swing8: number;
  swing16: number;
  /** Played once. */
  intro: readonly SectionDef[];
  /** Repeats forever. */
  loop: readonly SectionDef[];
}

/** Parse "D4 - F4 . A4 - - ." into 8 melody slots. */
export function parseMelody(src: string): number[] {
  const out: number[] = [];
  for (const tok of src.trim().split(/\s+/)) {
    if (tok === '-') out.push(HOLD);
    else if (tok === '.') out.push(REST);
    else out.push(noteToMidi(tok));
  }
  if (out.length !== 8) throw new Error(`parseMelody: expected 8 slots, got ${out.length} in "${src}"`);
  return out;
}

/** Build a section from "chord [chord] | melody" lines. */
export function section(name: string, lines: readonly string[]): SectionDef {
  const bars = lines.map((line): BarSpec => {
    const [chordStr, mel] = line.split('|');
    if (chordStr === undefined || mel === undefined) throw new Error(`section ${name}: bad line "${line}"`);
    const cs = chordStr.trim().split(/\s+/);
    const first = cs[0]!;
    parseChord(first);
    if (cs[1]) parseChord(cs[1]);
    return { chords: [first, cs[1] ?? first], melody: parseMelody(mel) };
  });
  return { name, bars };
}

/** Same bars, new name (a variation pass arranged differently). */
const vary = (s: SectionDef, name: string): SectionDef => ({ name, bars: s.bars });

// ── "Hall Pass" (title) ──────────────────────────────────────────────────
const T_A = section('A', [
  'Gm7      | G4 . Bb4 . C5 - D5 .',
  'C7       | . F5 - D5 C5 . Bb4 .',
  'Gm7      | G4 . Bb4 . C5 - D5 F5',
  'D7       | F#5 - - - D5 . . .',
  'Ebmaj7   | G5 - F5 . D5 . Bb4 .',
  'Cm7      | C5 - Bb4 . G4 . Eb5 .',
  'Am7 D7   | D5 - C5 Bb4 A4 . F#4 .',
  'Gm7      | G4 - - - . . . .',
]);
const T_B = section('B', [
  'Ebmaj7 | Bb4 . Eb5 . G5 - F5 .',
  'D7     | F#5 - D5 . A4 . C5 .',
  'Gm7    | Bb4 . D5 . G5 - F5 D5',
  'C7     | E5 - - - C5 . . .',
  'Ebmaj7 | G5 . F5 . Eb5 . D5 .',
  'Cm7    | Eb5 . D5 . C5 . Bb4 .',
  'D7     | A4 - C5 - F#5 - A5 -',
  'D7     | D5 - - - . . . .',
]);
export const TITLE_SONG: SongDef = {
  id: 'title',
  title: 'Hall Pass',
  bpm: 104,
  swing8: 0.58,
  swing16: 0.5,
  intro: [
    section('intro', [
      'Gm7 | . . . . . . . .',
      'C7  | . . . . . . . .',
      'Gm7 | . . . . . . . .',
      'D7  | . . . . D5 . F#5 .',
    ]),
  ],
  loop: [T_A, T_B, vary(T_A, 'A2'), vary(T_B, 'B2')],
};

// ── "Free Period" (menu) ─────────────────────────────────────────────────
const M_A = section('A', [
  'Fmaj7  | . . A4 C5 E5 - D5 C5',
  'Em7    | B4 - - - . . G4 -',
  'Dm7    | . . F4 A4 C5 - Bb4 A4',
  'Cmaj7  | G4 - - - . . . .',
  'Fmaj7  | . . A4 C5 F5 - E5 C5',
  'Em7    | D5 - B4 - G4 - . .',
  'Dm7 G7 | A4 - C5 - D5 - B4 -',
  'Cmaj7  | C5 - - - . . . .',
]);
const M_B = section('B', [
  'Bbmaj7 | . . D5 F5 A5 - G5 F5',
  'Am7    | E5 - - - . . C5 -',
  'Gm7    | . . Bb4 D5 F5 - E5 D5',
  'C7     | E5 - - - . . . .',
]);
export const MENU_SONG: SongDef = {
  id: 'menu',
  title: 'Free Period',
  bpm: 82,
  swing8: 0.62,
  swing16: 0.55,
  intro: [section('intro', ['Fmaj7 | . . . . . . . .', 'Em7 | . . . . . . . .'])],
  loop: [M_A, M_B, vary(M_A, 'A2'), vary(M_B, 'B2')],
};

// ── "Out of Class" (sneak) ───────────────────────────────────────────────
const S_A = section('A', [
  'Dm   | D4 . F4 . A4 . . G#4',
  'Dm   | A4 . . . F4 . D4 .',
  'Bb   | . . D4 F4 Bb4 - A4 .',
  'A    | E4 . . C#4 . . A3 .',
  'Dm   | D4 . F4 . A4 . C5 .',
  'Gm   | Bb4 - A4 . G4 . F4 .',
  'Bb A | E4 . F4 . G4 . A4 .',
  'Dm   | D4 - - - . . . .',
]);
const S_B = section('B', [
  'Gm   | . . G4 Bb4 D5 - C5 .',
  'Dm   | A4 - - - F4 . . .',
  'Gm   | . . G4 Bb4 D5 - F5 .',
  'A    | E5 - - - C#5 . . .',
  'Bb   | D5 . C5 . Bb4 . A4 .',
  'Gm   | G4 . A4 . Bb4 . C5 .',
  'A    | C#5 - E5 - A5 - G5 -',
  'A    | E5 - - - . . . .',
]);
export const SNEAK_SONG: SongDef = {
  id: 'sneak',
  title: 'Out of Class',
  bpm: 92,
  swing8: 0.55,
  swing16: 0.5,
  intro: [section('intro', ['Dm | . . . . . . . .', 'A | . . . . . . . .'])],
  loop: [S_A, S_B, vary(S_A, 'A2'), vary(S_B, 'B2')],
};

// ── "Report Card" (report) ───────────────────────────────────────────────
const R_LOOP = section('A', [
  'Cmaj7  | . . E5 G5 B5 - A5 G5',
  'Am7    | E5 - - - . . C5 -',
  'Dm7    | . . F5 A5 C6 - B5 A5',
  'G7     | G5 - - - . . . .',
  'Cmaj7  | . . G5 E5 C5 - D5 E5',
  'Am7    | A5 - G5 - E5 - . .',
  'Dm7 G7 | F5 - E5 - D5 - B4 -',
  'Cmaj7  | C5 - - - . . . .',
]);
export const REPORT_SONG: SongDef = {
  id: 'report',
  title: 'Report Card',
  bpm: 96,
  swing8: 0.56,
  swing16: 0.5,
  intro: [section('jingle', ['C G | C5 . E5 . G5 . B5 -', 'C | C6 - - - . . . .'])],
  loop: [R_LOOP],
};

export const SONGS: Readonly<Record<SongId, SongDef>> = {
  title: TITLE_SONG,
  menu: MENU_SONG,
  sneak: SNEAK_SONG,
  report: REPORT_SONG,
};

// ── Song position ──────────────────────────────────────────────────────────

export interface BarLocation {
  /** In the one-shot intro. */
  intro: boolean;
  /** Completed passes through the loop (0 during the intro). */
  cycle: number;
  section: SectionDef;
  barInSection: number;
  /** Bar index within the loop (or intro). */
  barInPart: number;
}

const sumBars = (secs: readonly SectionDef[]): number => secs.reduce((n, s) => n + s.bars.length, 0);

/** Where an absolute bar index lands in a song. */
export function locateBar(song: SongDef, bar: number): BarLocation {
  let b = Math.max(0, Math.floor(bar));
  const introBars = sumBars(song.intro);
  let part = song.loop;
  let intro = false;
  let cycle = 0;
  if (b < introBars) {
    part = song.intro;
    intro = true;
  } else {
    b -= introBars;
    const loopBars = Math.max(1, sumBars(song.loop));
    cycle = Math.floor(b / loopBars);
    b %= loopBars;
  }
  const barInPart = b;
  for (const s of part) {
    if (b < s.bars.length) return { intro, cycle, section: s, barInSection: b, barInPart };
    b -= s.bars.length;
  }
  // Unreachable for well-formed songs; fall back to the first loop bar.
  return { intro: false, cycle, section: song.loop[0]!, barInSection: 0, barInPart: 0 };
}

export function barSpec(song: SongDef, bar: number): BarSpec {
  const loc = locateBar(song, bar);
  return loc.section.bars[loc.barInSection]!;
}

/** Length of the one-shot intro in bars. */
export function introBars(song: SongDef): number {
  return sumBars(song.intro);
}

/** Length of one loop pass in bars. */
export function loopBars(song: SongDef): number {
  return sumBars(song.loop);
}

// ── Layers ─────────────────────────────────────────────────────────────────

export type DrumStyle = 'none' | 'rock' | 'four' | 'half' | 'groove' | 'march' | 'build';
export type BassStyle = 'none' | 'pump' | 'drive' | 'groove' | 'root' | 'gallop';
export type MelodyInst = 'none' | 'lead' | 'brass' | 'organ' | 'bell' | 'epiano' | 'chip';

/** Active instrument layers for a bar. */
export interface Layers {
  drums: DrumStyle;
  /** 0 none · 1 eighths · 2 sixteenths. */
  hats: 0 | 1 | 2;
  /** Open hats on the off-beat 8ths. */
  openHats: boolean;
  bass: BassStyle;
  /** Power chords: palm-muted 8th chugs or sustained. */
  power: 'none' | 'chug' | 'sustain';
  organ: boolean;
  pad: boolean;
  /** E-piano comping. */
  epiano: boolean;
  /** Brass stabs on the off-beats. */
  stabs: boolean;
  arp: boolean;
  melody: MelodyInst;
  /** Melody doubling (brass an octave down, bell/chip an octave up). */
  double: MelodyInst;
  /** Crash on the first bar of each section. */
  crash: boolean;
  /** Drum fill on the last bar of each section. */
  fill: boolean;
  /** 0 none · 1 timpani on 1 & 3 · 2 plus a roll into the next section. */
  timp: 0 | 1 | 2;
}

export const SILENT_LAYERS: Readonly<Layers> = {
  drums: 'none',
  hats: 0,
  openHats: false,
  bass: 'none',
  power: 'none',
  organ: false,
  pad: false,
  epiano: false,
  stabs: false,
  arp: false,
  melody: 'none',
  double: 'none',
  crash: false,
  fill: false,
  timp: 0,
};

const L = (over: Partial<Layers>): Layers => ({ ...SILENT_LAYERS, ...over });

/** Sneak-track intensity thresholds (level 1 = someone's curious, 2 = spotted / chase) with hysteresis. */
export const EVENT_THRESHOLDS = { mid: 0.3, high: 0.75 } as const;
const HYST = 0.05;

/** Discrete intensity level (0..2) with hysteresis against the previous level. */
export function intensityLevel(intensity: number, prevLevel: number): 0 | 1 | 2 {
  const v = Math.min(1, Math.max(0, Number.isFinite(intensity) ? intensity : 0));
  const gate = (threshold: number, wasOn: boolean): boolean => (wasOn ? v >= threshold - HYST : v >= threshold);
  if (gate(EVENT_THRESHOLDS.high, prevLevel >= 2)) return 2;
  if (gate(EVENT_THRESHOLDS.mid, prevLevel >= 1)) return 1;
  return 0;
}

/** Sneak tempo by intensity level: a small lift when someone's curious, a real push in a chase. */
export function eventTempo(level: number): number {
  return SNEAK_SONG.bpm + (level >= 2 ? 16 : level >= 1 ? 4 : 0);
}

/** Move a tempo toward its target by at most `maxStep` BPM (applied once per bar). */
export function stepTempo(current: number, target: number, maxStep = 4): number {
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

/** Title: bass + e-piano intro, then the caper — brass melody on A, lead + stabs on the bridge. */
export function titleLayers(bar: number): Layers {
  const loc = locateBar(TITLE_SONG, bar);
  if (loc.intro) return L({ bass: 'groove', epiano: true, hats: loc.barInSection >= 2 ? 1 : 0, drums: loc.barInSection === 3 ? 'build' : 'none', melody: 'brass' });
  const n = loc.section.name;
  const second = n.endsWith('2');
  if (n.startsWith('A')) return L({ drums: 'groove', hats: 2, bass: 'groove', epiano: true, melody: second ? 'organ' : 'brass', double: second ? 'bell' : 'none', crash: true, fill: true });
  return L({ drums: 'groove', hats: 2, openHats: true, bass: 'groove', organ: true, stabs: true, melody: 'lead', double: second ? 'brass' : 'bell', crash: true, fill: true });
}

/** Menu: lo-fi half-time; glockenspiel on A, chip on B, pad comes in on the repeats. */
export function menuLayers(bar: number): Layers {
  const loc = locateBar(MENU_SONG, bar);
  if (loc.intro) return L({ epiano: true, pad: true, hats: 1 });
  const n = loc.section.name;
  const second = n.endsWith('2');
  return L({ drums: 'half', hats: 1, bass: 'root', epiano: true, pad: second || n.startsWith('B'), melody: n.startsWith('A') ? 'bell' : 'chip', fill: false });
}

/** Sneak: layers by suspicion level (0 calm · 1 curious · 2 chase). */
export function sneakLayers(bar: number, level: 0 | 1 | 2): Layers {
  const loc = locateBar(SNEAK_SONG, bar);
  if (loc.intro) return L({ bass: 'groove', hats: 1, epiano: true });
  const b = loc.section.name.startsWith('B');
  if (level >= 2) {
    return L({
      drums: 'four',
      hats: 2,
      openHats: true,
      bass: 'drive',
      power: b ? 'sustain' : 'chug',
      stabs: true,
      melody: 'lead',
      double: 'brass',
      arp: b,
      crash: true,
      fill: true,
    });
  }
  if (level >= 1) return L({ drums: 'groove', hats: 2, bass: 'groove', epiano: true, arp: b, melody: b ? 'bell' : 'chip', fill: true });
  return L({ hats: 1, bass: 'groove', epiano: true, melody: b ? 'bell' : 'none' });
}

/** Report: the "ta-da" jingle, then a calm loop (glock, chip on alternate passes). */
export function reportLayers(bar: number): Layers {
  const loc = locateBar(REPORT_SONG, bar);
  if (loc.intro) return L({ melody: 'brass', double: 'bell', organ: true, crash: true, timp: loc.barInSection === 0 ? 2 : 1, bass: 'root' });
  return L({ drums: 'groove', hats: 1, bass: 'root', epiano: true, pad: true, melody: loc.cycle % 2 === 1 ? 'chip' : 'bell', fill: false });
}

/** Layers for any track (sneak uses the intensity level). */
export function layersFor(song: SongDef, bar: number, level: 0 | 1 | 2 = 0): Layers {
  switch (song.id) {
    case 'title':
      return titleLayers(bar);
    case 'menu':
      return menuLayers(bar);
    case 'sneak':
      return sneakLayers(bar, level);
    case 'report':
      return reportLayers(bar);
  }
}

// ── Arrangement ────────────────────────────────────────────────────────────

/** Octave offset of each melody instrument; doublings: brass drops an octave, bell/chip go up. */
const MELODY_OCTAVE: Readonly<Record<Exclude<MelodyInst, 'none'>, number>> = { lead: 0, brass: 0, organ: 0, bell: 12, epiano: 0, chip: 0 };
const DOUBLE_OCTAVE: Readonly<Record<Exclude<MelodyInst, 'none'>, number>> = { lead: 0, brass: -12, organ: -12, bell: 12, epiano: 0, chip: 12 };

function melodyEvents(spec: BarSpec, inst: Exclude<MelodyInst, 'none'>, octave: number, velScale: number, out: NoteEvent[]): void {
  let prev = -1;
  for (let slot = 0; slot < 8; slot++) {
    const m = spec.melody[slot]!;
    if (m === HOLD) continue;
    if (m === REST) {
      prev = -1;
      continue;
    }
    let holds = 0;
    while (slot + 1 + holds < 8 && spec.melody[slot + 1 + holds] === HOLD) holds++;
    const len = (1 + holds) * 2;
    const midi = m + octave;
    const ev: NoteEvent = { inst, step: slot * 2, midi, vel: (slot % 2 === 0 ? 0.92 : 0.78) * velScale, len };
    // Lead: legato slides between close neighbours.
    if (inst === 'lead' && prev > 0 && Math.abs(prev - midi) <= 2 && prev !== midi) ev.glide = prev;
    out.push(ev);
    prev = midi;
  }
}

/**
 * Arrange one bar. Appends events to `out` (caller clears it).
 * @param bar absolute bar index since the track started
 */
export function arrangeBar(song: SongDef, bar: number, layers: Layers, out: NoteEvent[]): void {
  const loc = locateBar(song, bar);
  const spec = loc.section.bars[loc.barInSection]!;
  const next = barSpec(song, bar + 1);
  const split = spec.chords[1] !== spec.chords[0];
  const chordAt = (step: number): string => spec.chords[step < 8 ? 0 : 1];
  const firstOfSection = loc.barInSection === 0;
  const lastOfSection = loc.barInSection === loc.section.bars.length - 1;
  const fillBar = layers.fill && lastOfSection;

  // ── Melody (+ doubling) ──
  if (layers.melody !== 'none') melodyEvents(spec, layers.melody, MELODY_OCTAVE[layers.melody], 1, out);
  if (layers.double !== 'none' && layers.double !== layers.melody) melodyEvents(spec, layers.double, DOUBLE_OCTAVE[layers.double], 0.75, out);

  // ── Bass ──
  const root = (step: number): number => bassRoot(chordAt(step));
  switch (layers.bass) {
    case 'pump':
      for (let s = 0; s < 16; s += 2) out.push({ inst: 'bass', step: s, midi: root(s), vel: s % 4 === 0 ? 0.95 : 0.75, len: 2 });
      break;
    case 'drive':
      for (let s = 0; s < 16; s += 2) out.push({ inst: 'bass', step: s, midi: root(s) + (s % 4 === 2 ? 12 : 0), vel: s % 4 === 0 ? 1 : 0.8, len: 2 });
      break;
    case 'groove': {
      const c0 = chordAt(0);
      const c1 = chordAt(8);
      const q = parseChord(c1);
      out.push({ inst: 'bass', step: 0, midi: root(0), vel: 1, len: 3 });
      out.push({ inst: 'bass', step: 3, midi: root(0), vel: 0.7, len: 1 });
      out.push({ inst: 'bass', step: 6, midi: root(0) + 12, vel: 0.8, len: 2 });
      out.push({ inst: 'bass', step: 8, midi: root(8), vel: 0.95, len: 2 });
      out.push({ inst: 'bass', step: 10, midi: bassTone(c1, q.intervals[2] ?? 7), vel: 0.75, len: 1 });
      out.push({ inst: 'bass', step: 11, midi: root(8) + 12, vel: 0.7, len: 2 });
      // Chromatic approach into the next bar's root.
      const target = bassRoot(next.chords[0]);
      const from = bassTone(c1, 0);
      out.push({ inst: 'bass', step: 14, midi: from > target ? target + 1 : from < target ? target - 1 : c0 === next.chords[0] ? target + 7 : target - 1, vel: 0.7, len: 2 });
      break;
    }
    case 'root':
      out.push({ inst: 'bass', step: 0, midi: root(0), vel: 0.95, len: split ? 7 : 14 });
      if (split) out.push({ inst: 'bass', step: 8, midi: root(8), vel: 0.9, len: 7 });
      break;
    case 'gallop':
      for (const s of [0, 3, 4, 8, 11, 12]) out.push({ inst: 'bass', step: s, midi: root(s) + (s === 4 || s === 12 ? 7 : 0), vel: s % 4 === 0 ? 0.95 : 0.7, len: s % 4 === 3 ? 1 : 2 });
      break;
    case 'none':
      break;
  }

  // ── Chords ──
  const halves: ReadonlyArray<readonly [number, number]> = split ? [[0, 8], [8, 8]] : [[0, 16]];
  if (layers.power === 'chug') {
    for (let s = 0; s < 16; s += 2) out.push({ inst: 'power', step: s, midi: 0, vel: s % 4 === 0 ? 0.95 : 0.7, len: 2, chord: powerVoicing(chordAt(s), 40), mute: true });
  } else if (layers.power === 'sustain') {
    for (const [s, len] of halves) out.push({ inst: 'power', step: s, midi: 0, vel: 0.9, len, chord: powerVoicing(chordAt(s), 40) });
  }
  if (layers.organ) for (const [s, len] of halves) out.push({ inst: 'organ', step: s, midi: 0, vel: 0.8, len, chord: closeVoicing(chordAt(s), 60) });
  if (layers.pad) for (const [s, len] of halves) out.push({ inst: 'pad', step: s, midi: 0, vel: 0.8, len, chord: closeVoicing(chordAt(s), 55) });
  if (layers.epiano) {
    for (const [s, len] of [
      [0, 3],
      [6, 2],
      [10, 4],
    ] as const)
      out.push({ inst: 'epiano', step: s, midi: 0, vel: s === 0 ? 0.8 : 0.62, len, chord: closeVoicing(chordAt(s), 57) });
  }
  if (layers.stabs) for (const s of [6, 14]) out.push({ inst: 'stab', step: s, midi: 0, vel: 0.85, len: 1, chord: closeVoicing(chordAt(s), 62) });
  if (layers.arp) {
    for (let s = 0; s < 16; s++) {
      const tones = arpTones(chordAt(s), 64, 2);
      const i = s % 8 < 4 ? s % 8 : 7 - (s % 8); // up-down figure
      out.push({ inst: 'arp', step: s, midi: tones[Math.min(tones.length - 1, i + (s >= 8 ? 1 : 0))]!, vel: s % 4 === 0 ? 0.9 : 0.6, len: 1 });
    }
  }

  // ── Timpani ──
  if (layers.timp > 0) {
    const t0 = 40 + ((parseChord(chordAt(0)).root - 4 + 12) % 12); // E2..D#3
    const t1 = 40 + ((parseChord(chordAt(8)).root - 4 + 12) % 12);
    out.push({ inst: 'timp', step: 0, midi: t0, vel: 0.95, len: 4 });
    if (layers.timp === 2 && lastOfSection) {
      for (let s = 8; s < 16; s++) out.push({ inst: 'timp', step: s, midi: t1, vel: 0.35 + 0.06 * (s - 8), len: 1 });
    } else out.push({ inst: 'timp', step: 8, midi: t1, vel: 0.8, len: 4 });
  }

  // ── Drums ──
  if (layers.crash && firstOfSection) out.push({ inst: 'crash', step: 0, midi: 0, vel: 1, len: 8 });
  const drumSteps = fillBar ? 8 : 16;
  const kick = (s: number, v: number): void => void (s < drumSteps && out.push({ inst: 'kick', step: s, midi: 0, vel: v, len: 1 }));
  const snare = (s: number, v: number): void => void (s < drumSteps && out.push({ inst: 'snare', step: s, midi: 0, vel: v, len: 1 }));
  switch (layers.drums) {
    case 'rock':
      for (const s of bar % 2 === 0 ? [0, 8, 10] : [0, 3, 8]) kick(s, s === 0 ? 1 : 0.85);
      snare(4, 1);
      snare(12, 1);
      break;
    case 'four':
      for (const s of [0, 4, 8, 12]) kick(s, 1);
      snare(4, 0.95);
      snare(12, 0.95);
      for (const s of [4, 12]) if (s < drumSteps) out.push({ inst: 'clap', step: s, midi: 0, vel: 0.8, len: 1 });
      break;
    case 'half':
      kick(0, 1);
      kick(10, 0.8);
      snare(8, 1);
      break;
    case 'groove':
      for (const s of [0, 7, 10]) kick(s, s === 0 ? 0.9 : 0.7);
      snare(4, 0.85);
      snare(12, 0.85);
      snare(15, 0.22);
      break;
    case 'march':
      kick(0, 0.9);
      kick(8, 0.85);
      for (const [s, v] of [
        [0, 0.9],
        [3, 0.4],
        [4, 0.75],
        [6, 0.4],
        [7, 0.45],
        [8, 0.9],
        [11, 0.4],
        [12, 0.75],
        [14, 0.5],
        [15, 0.55],
      ] as const)
        snare(s, v * 0.7);
      break;
    case 'build':
      kick(0, 1);
      kick(8, 0.9);
      for (let s = 0; s < 16; s += s < 8 ? 2 : 1) snare(s, 0.3 + 0.045 * s);
      break;
    case 'none':
      break;
  }
  if (layers.hats > 0) {
    const stepBy = layers.hats === 2 ? 1 : 2;
    for (let s = 0; s < drumSteps; s += stepBy) {
      const offbeat8 = s % 4 === 2;
      const open = layers.openHats && offbeat8;
      out.push({ inst: open ? 'openHat' : 'hat', step: s, midi: 0, vel: s % 4 === 0 ? 0.85 : offbeat8 ? 0.7 : 0.45, len: 1 });
    }
  }
  if (fillBar && layers.drums !== 'none') {
    // Tom fill: high, high, mid, mid, low, low + snare pickups.
    const toms: ReadonlyArray<readonly [number, number]> = [
      [8, 52],
      [10, 52],
      [12, 47],
      [13, 47],
      [14, 43],
      [15, 43],
    ];
    for (const [s, m] of toms) out.push({ inst: 'tom', step: s, midi: m, vel: 0.85, len: 1 });
    out.push({ inst: 'snare', step: 11, midi: 0, vel: 0.6, len: 1 });
    out.push({ inst: 'kick', step: 8, midi: 0, vel: 0.9, len: 1 });
  }
}
