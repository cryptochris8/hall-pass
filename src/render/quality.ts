// Adaptive render resolution. 'auto' starts at min(dpr, 2) and steps the pixel
// ratio down (…→ 1.0 → 0.75) when frame time stays high, and cautiously back up
// when there is lots of headroom. Pure logic (no DOM) so it is unit-testable.
import type { Quality } from './types';

/** Frame time (s) above which we consider the frame slow (~42 fps). */
const SLOW = 1 / 42;
/** Frame time (s) below which we consider there is headroom (~58 fps). */
const FAST = 1 / 58;
/** Seconds of sustained slowness before stepping down. */
const DOWN_AFTER = 1.5;
/** Seconds of sustained headroom before stepping up. */
const UP_AFTER = 8;
/** After stepping down, don't try to step up again for this long (avoid ping-pong). */
const UP_COOLDOWN = 12;

export function qualityLevels(maxRatio: number): number[] {
  const top = Math.max(0.75, Math.min(2, maxRatio));
  const levels = [top];
  for (const r of [1.5, 1, 0.75]) if (r < top - 1e-6) levels.push(r);
  return levels;
}

export class QualityGovernor {
  private levels: number[];
  private level = 0;
  private ema = 1 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private cooldown = 0;
  private downs = 0;

  constructor(
    private mode: Quality,
    maxRatio: number,
  ) {
    this.levels = qualityLevels(maxRatio);
  }

  /** Change the device ratio cap (e.g. window moved to another monitor). */
  setMaxRatio(maxRatio: number): void {
    this.levels = qualityLevels(maxRatio);
    this.level = Math.min(this.level, this.levels.length - 1);
  }

  setMode(mode: Quality): void {
    this.mode = mode;
    this.slowFor = this.fastFor = 0;
    if (mode === 'auto') this.level = 0;
  }

  /** Smoothed frame time (s). */
  get frameTime(): number {
    return this.ema;
  }

  /** Current target pixel ratio. */
  get ratio(): number {
    if (this.mode === 'high') return this.levels[0]!;
    if (this.mode === 'low') return Math.min(this.levels[0]!, 0.75);
    return this.levels[this.level]!;
  }

  /** Feed one frame's real dt (s). Returns the target pixel ratio. */
  update(dt: number): number {
    // Ignore hitches from tab switches / GC pauses; they aren't sustained load.
    if (!(dt > 0) || dt > 0.25) return this.ratio;
    this.ema += (dt - this.ema) * 0.08;
    if (this.mode !== 'auto') return this.ratio;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.ema > SLOW) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.ema < FAST) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = 0;
      this.fastFor = 0;
    }
    if (this.slowFor >= DOWN_AFTER && this.level < this.levels.length - 1) {
      this.level++;
      this.downs++;
      this.slowFor = 0;
      this.cooldown = UP_COOLDOWN * this.downs;
      this.ema = 1 / 60; // give the new resolution a fair chance
    } else if (this.fastFor >= UP_AFTER && this.level > 0 && this.cooldown <= 0) {
      this.level--;
      this.fastFor = 0;
    }
    return this.ratio;
  }
}
