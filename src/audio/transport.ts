// ─────────────────────────────────────────────────────────────────────────────
// Musical transport (pure timing math, from TRASH PANDA TROUBLE). A bar is 16 sixteenth-note steps in 4/4.
// Tempo and swing changes are deferred to the next bar line so the groove never
// stumbles mid-bar. The music player asks for "the time of the next step",
// schedules it, then advances — the classic Web Audio lookahead pattern.
// Copied from ATHLETE MAYHEM (src/audio) for HALL PASS.
// ─────────────────────────────────────────────────────────────────────────────

export const STEPS_PER_BAR = 16;

/**
 * Offset (in beats, 0..1) of 16th step `i` (0..3) inside one beat.
 * swing8: position of the off-beat 8th (0.5 = straight, 0.667 = triplet shuffle).
 * swing16: position of each off-beat 16th inside its 8th (0.5 = straight).
 */
export function stepOffsetInBeat(i: number, swing8: number, swing16: number): number {
  switch (i) {
    case 0:
      return 0;
    case 1:
      return swing16 * swing8;
    case 2:
      return swing8;
    default:
      return swing8 + swing16 * (1 - swing8);
  }
}

/** Seconds from the bar line to step `step` (0..15). */
export function stepOffsetInBar(step: number, bpm: number, swing8: number, swing16: number): number {
  const beat = 60 / bpm;
  const b = Math.floor(step / 4);
  return (b + stepOffsetInBeat(step % 4, swing8, swing16)) * beat;
}

export function barDuration(bpm: number): number {
  return (60 / bpm) * 4;
}

export class Transport {
  /** Index of the bar containing the next step to schedule. */
  bar = 0;
  /** Next step to schedule (0..15). */
  step = 0;
  /** Absolute time of the current bar line. */
  barStart: number;
  bpm: number;
  swing8: number;
  swing16: number;
  private pendingBpm: number | null = null;

  constructor(startTime: number, bpm: number, swing8 = 0.5, swing16 = 0.5) {
    this.barStart = startTime;
    this.bpm = bpm;
    this.swing8 = swing8;
    this.swing16 = swing16;
  }

  /** Absolute time of the next step to schedule. */
  get time(): number {
    return this.barStart + stepOffsetInBar(this.step, this.bpm, this.swing8, this.swing16);
  }

  /** Duration of one 16th at the current tempo (unswung). */
  get sixteenth(): number {
    return 15 / this.bpm;
  }

  /** Request a tempo; it takes effect at the next bar line. */
  setTempo(bpm: number): void {
    this.pendingBpm = bpm;
  }

  /** Move to the next step. Returns true when a new bar begins. */
  advance(): boolean {
    this.step++;
    if (this.step < STEPS_PER_BAR) return false;
    this.step = 0;
    this.barStart += barDuration(this.bpm);
    this.bar++;
    if (this.pendingBpm !== null) {
      this.bpm = this.pendingBpm;
      this.pendingBpm = null;
    }
    return true;
  }

  /**
   * If the scheduler fell behind (timers throttled, tab frozen), jump the bar grid
   * forward so the next step lands at or after `now` instead of firing a burst of
   * stale notes. Keeps the step position within the bar.
   */
  resync(now: number): void {
    if (this.time >= now) return;
    const bd = barDuration(this.bpm);
    const behind = now - this.time;
    const bars = Math.ceil(behind / bd);
    this.barStart += bars * bd;
    this.bar += bars;
  }
}
