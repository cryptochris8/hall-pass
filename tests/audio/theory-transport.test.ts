import { describe, expect, it } from 'vitest';
import {
  arpTones,
  BASS_HIGH,
  BASS_LOW,
  bassRoot,
  bassTone,
  centsToRatio,
  chordPcs,
  closeVoicing,
  freqToMidi,
  midiToFreq,
  noteToMidi,
  parseChord,
  pitchClass,
  powerVoicing,
} from '../../src/audio/theory';
import { barDuration, STEPS_PER_BAR, stepOffsetInBar, stepOffsetInBeat, Transport } from '../../src/audio/transport';

describe('pitch maths', () => {
  it('midi ↔ frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 9);
    expect(midiToFreq(81)).toBeCloseTo(880, 9);
    expect(freqToMidi(261.6255653)).toBeCloseTo(60, 5);
    expect(centsToRatio(1200)).toBeCloseTo(2, 12);
  });

  it('note names', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#5')).toBe(78);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('C#6')).toBe(85);
    expect(() => noteToMidi('H2')).toThrow();
  });

  it('pitch classes wrap negatives', () => {
    expect(pitchClass(-1)).toBe(11);
    expect(pitchClass(60)).toBe(0);
  });
});

describe('chords', () => {
  it('parses symbols incl. power chords, sus and 9ths', () => {
    expect(chordPcs('C')).toEqual([0, 4, 7]);
    expect(chordPcs('Em')).toEqual([4, 7, 11]);
    expect(chordPcs('A5')).toEqual([9, 4]);
    expect(chordPcs('Esus4')).toEqual([4, 9, 11]);
    expect(chordPcs('F#m7')).toEqual([6, 9, 1, 4]);
    expect(chordPcs('Bbmaj7')).toEqual([10, 2, 5, 9]);
    expect(parseChord('Ab').root).toBe(8);
    expect(() => parseChord('Xm')).toThrow();
    expect(() => parseChord('Cmadd9')).toThrow();
  });

  it('close voicings stay inside one octave window and contain every chord tone', () => {
    for (const sym of ['C', 'Em7', 'A5', 'Dmaj7', 'Gsus4', 'F#m9', 'Bdim']) {
      const v = closeVoicing(sym, 57);
      for (const n of v) {
        expect(n).toBeGreaterThanOrEqual(57);
        expect(n).toBeLessThan(69);
      }
      expect(new Set(v.map(pitchClass))).toEqual(new Set(chordPcs(sym)));
      for (let i = 1; i < v.length; i++) expect(v[i]!).toBeGreaterThan(v[i - 1]!);
    }
  });

  it('power voicing is root-fifth-octave', () => {
    expect(powerVoicing('E', 40)).toEqual([40, 47, 52]);
    expect(powerVoicing('A5', 40)).toEqual([45, 52, 57]);
    expect(powerVoicing('D#m', 40)).toEqual([51, 58, 63]);
  });

  it('bass notes stay in the synth-bass range', () => {
    for (const sym of ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']) {
      const r = bassRoot(sym);
      expect(r).toBeGreaterThanOrEqual(33);
      expect(r).toBeLessThanOrEqual(44);
      expect(pitchClass(r)).toBe(parseChord(sym).root);
      for (const iv of [0, 7, 12, 19, 24]) {
        const n = bassTone(sym, iv);
        expect(n).toBeGreaterThanOrEqual(BASS_LOW);
        expect(n).toBeLessThanOrEqual(BASS_HIGH);
      }
    }
  });

  it('arp tones climb over the requested octaves', () => {
    const a = arpTones('C', 60, 2);
    expect(a).toEqual([60, 64, 67, 72, 76, 79]);
  });
});

describe('transport', () => {
  it('straight and swung step offsets', () => {
    expect([0, 1, 2, 3].map((i) => stepOffsetInBeat(i, 0.5, 0.5))).toEqual([0, 0.25, 0.5, 0.75]);
    const sw = [0, 1, 2, 3].map((i) => stepOffsetInBeat(i, 0.5, 0.57));
    for (let i = 1; i < 4; i++) expect(sw[i]!).toBeGreaterThan(sw[i - 1]!);
    expect(sw[1]).toBeGreaterThan(0.25); // swung 16th arrives late
    expect(barDuration(120)).toBeCloseTo(2, 12);
    expect(stepOffsetInBar(4, 120, 0.5, 0.5)).toBeCloseTo(0.5, 12);
  });

  it('advances 16 steps per bar; tempo changes land on the bar line', () => {
    const tr = new Transport(0, 120);
    for (let i = 0; i < 5; i++) tr.advance();
    tr.setTempo(150);
    expect(tr.bpm).toBe(120);
    let newBar = false;
    while (!newBar) newBar = tr.advance();
    expect(tr.bpm).toBe(150);
    expect(tr.barStart).toBeCloseTo(2, 12);
    let prev = -1;
    for (let i = 0; i < STEPS_PER_BAR * 4; i++) {
      expect(tr.time).toBeGreaterThan(prev);
      prev = tr.time;
      tr.advance();
    }
  });

  it('resync skips whole bars after a stall, keeping the groove position', () => {
    const tr = new Transport(0, 120);
    for (let i = 0; i < 6; i++) tr.advance();
    const step = tr.step;
    tr.resync(7.3);
    expect(tr.step).toBe(step);
    expect(tr.time).toBeGreaterThanOrEqual(7.3);
    expect(tr.time - 7.3).toBeLessThan(barDuration(120));
  });
});
