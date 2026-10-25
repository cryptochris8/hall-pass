// ─────────────────────────────────────────────────────────────────────────────
// Voice limiting (pure, unit-tested). Stops spammy sounds (footsteps, dribbles,
// pickup chains, score ticks) from stacking into a wall of noise and keeps the
// total node count bounded on phones:
//   • per-sound cooldown  — minimum time between two starts of the same sound
//   • per-sound voices    — max overlapping instances of the same sound
//   • global budget       — when many sounds overlap, low-priority ones are dropped
//                           first; stingers (priority 3) always play.
// Times are AudioContext seconds.
// Copied from ATHLETE MAYHEM (src/audio) for HALL PASS.
// ─────────────────────────────────────────────────────────────────────────────

export type Priority = 0 | 1 | 2 | 3;

export interface VoiceRule {
  /** Minimum seconds between two starts of this sound (0 = none). */
  cooldown: number;
  /** Max overlapping voices of this sound. */
  maxVoices: number;
  /** 0 spammy/bed · 1 normal · 2 major · 3 stinger. */
  priority: Priority;
}

/** Default budget of overlapping one-shots (SFX + crowd reactions). */
export const GLOBAL_VOICES = 28;
/** Above this share of the budget, priority-0 (spammy) sounds are already dropped. */
export const SOFT_SHARE = 0.7;

export class VoiceLimiter<K extends string = string> {
  private readonly active = new Map<K, number[]>();
  private readonly last = new Map<K, number>();
  private total = 0;
  private newest = -Infinity;

  constructor(readonly globalMax = GLOBAL_VOICES) {}

  /** Number of voices still sounding at the last prune. */
  get count(): number {
    return this.total;
  }

  /** Whether `key` may start at `now` under `rule`. Does not record anything — call commit() when it plays. */
  allow(key: K, rule: VoiceRule, now: number): boolean {
    // The clock went backwards (a rebuilt AudioContext): forget everything.
    if (now + 1 < this.newest) this.reset();
    this.prune(now);
    const last = this.last.get(key);
    if (last !== undefined && now >= last && now - last < rule.cooldown) return false;
    const voices = this.active.get(key);
    if (voices && voices.length >= Math.max(1, rule.maxVoices)) return false;
    if (rule.priority >= 3) return true;
    if (this.total >= this.globalMax) return rule.priority >= 2;
    if (this.total >= this.globalMax * SOFT_SHARE) return rule.priority >= 1;
    return true;
  }

  /** Record a voice of `key` that started at `now` and rings until `end`. */
  commit(key: K, now: number, end: number): void {
    this.newest = Math.max(this.newest, now);
    this.last.set(key, now);
    let v = this.active.get(key);
    if (!v) {
      v = [];
      this.active.set(key, v);
    }
    v.push(Number.isFinite(end) ? Math.max(now, end) : now);
    this.total++;
  }

  /** allow() + commit() in one go (end known up front). */
  tryStart(key: K, rule: VoiceRule, now: number, end: number): boolean {
    if (!this.allow(key, rule, now)) return false;
    this.commit(key, now, end);
    return true;
  }

  /** Forget voices that have finished by `now`. */
  prune(now: number): void {
    let total = 0;
    for (const [k, ends] of this.active) {
      let w = 0;
      for (let i = 0; i < ends.length; i++) if (ends[i]! > now) ends[w++] = ends[i]!;
      ends.length = w;
      if (w === 0) this.active.delete(k);
      total += w;
    }
    this.total = total;
  }

  /** Voices of one sound still sounding at the last prune. */
  voices(key: K): number {
    return this.active.get(key)?.length ?? 0;
  }

  reset(): void {
    this.active.clear();
    this.last.clear();
    this.total = 0;
    this.newest = -Infinity;
  }
}
