// ─────────────────────────────────────────────────────────────────────────────
// Ghost recordings (docs/GDD.md §8.2). The sim is deterministic, so a run is just
// its inputs: one TickInput per tick, run-length encoded (a player holds the
// stick still for long stretches) and packed into a short base64 string, tagged
// with SIM_VERSION and the run config. Replaying the inputs against the same plan
// reproduces the run exactly — the ghost student, and later a server-side score
// check. Pure; no DOM.
// ─────────────────────────────────────────────────────────────────────────────
import type { RunConfig, TickInput } from '../sim/types';
import { SIM_VERSION } from '../sim/types';

export interface Recording {
  v: number;
  config: Pick<RunConfig, 'seed' | 'tier' | 'mission' | 'difficulty'>;
  /** Ticks recorded. */
  ticks: number;
  /** RLE inputs, base64: repeated [moveX i8, moveY i8, buttons u8, count u16 LE]. */
  data: string;
  /** Final score (for "beat your best"). */
  score: number;
}

/** Collects inputs tick by tick; cheap enough to run on every real run. */
export class Recorder {
  private readonly runs: number[] = [];
  private last = -1;
  private count = 0;
  ticks = 0;

  push(input: TickInput): void {
    const key = ((input.moveX + 128) & 255) | (((input.moveY + 128) & 255) << 8) | ((input.buttons & 255) << 16);
    this.ticks++;
    if (key === this.last && this.count < 0xffff) {
      this.count++;
      return;
    }
    if (this.count > 0) this.runs.push(this.last, this.count);
    this.last = key;
    this.count = 1;
  }

  finish(config: Recording['config'], score: number): Recording {
    const runs = this.runs.slice();
    if (this.count > 0) runs.push(this.last, this.count);
    const bytes = new Uint8Array((runs.length / 2) * 5);
    for (let i = 0, o = 0; i < runs.length; i += 2, o += 5) {
      const k = runs[i]!;
      const n = runs[i + 1]!;
      bytes[o] = k & 255;
      bytes[o + 1] = (k >>> 8) & 255;
      bytes[o + 2] = (k >>> 16) & 255;
      bytes[o + 3] = n & 255;
      bytes[o + 4] = (n >>> 8) & 255;
    }
    return { v: SIM_VERSION, config: { ...config }, ticks: this.ticks, data: toBase64(bytes), score };
  }
}

/** Plays a recording back one tick at a time (NO_INPUT once it runs out). */
export class Player {
  private readonly bytes: Uint8Array;
  private o = 0;
  private left = 0;
  private readonly cur: TickInput = { moveX: 0, moveY: 0, buttons: 0 };

  constructor(rec: Recording) {
    this.bytes = fromBase64(rec.data);
  }

  next(): TickInput {
    if (this.left === 0) {
      if (this.o + 5 > this.bytes.length) {
        this.cur.moveX = 0;
        this.cur.moveY = 0;
        this.cur.buttons = 0;
        return this.cur;
      }
      const b = this.bytes;
      this.cur.moveX = b[this.o]! - 128;
      this.cur.moveY = b[this.o + 1]! - 128;
      this.cur.buttons = b[this.o + 2]!;
      this.left = b[this.o + 3]! | (b[this.o + 4]! << 8);
      this.o += 5;
    }
    this.left--;
    return this.cur;
  }
}

/** Every input of a recording (tests, headless verification). */
export function decodeInputs(rec: Recording): TickInput[] {
  const p = new Player(rec);
  const out: TickInput[] = [];
  for (let i = 0; i < rec.ticks; i++) out.push({ ...p.next() });
  return out;
}

/** A recording that can be trusted to replay: right version, sane shape. Anything else is null. */
export function validRecording(raw: unknown): Recording | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const c = r.config as Record<string, unknown> | undefined;
  if (r.v !== SIM_VERSION || !c || typeof r.data !== 'string' || r.data.length > 400_000 || !/^[A-Za-z0-9+/=]*$/.test(r.data)) return null;
  if (typeof r.ticks !== 'number' || !Number.isInteger(r.ticks) || r.ticks < 0 || r.ticks > 60 * 60 * 20) return null;
  if (typeof c.seed !== 'number' || typeof c.tier !== 'number' || typeof c.mission !== 'string' || typeof c.difficulty !== 'string') return null;
  return {
    v: SIM_VERSION,
    config: { seed: c.seed, tier: c.tier as RunConfig['tier'], mission: c.mission as RunConfig['mission'], difficulty: c.difficulty as RunConfig['difficulty'] },
    ticks: r.ticks,
    data: r.data,
    score: typeof r.score === 'number' && Number.isFinite(r.score) ? r.score : 0,
  };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    s += B64[(n >>> 18) & 63]! + B64[(n >>> 12) & 63]! + (b === undefined ? '=' : B64[(n >>> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!);
  }
  return s;
}

function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1] ?? 'A') << 12) | (B64.indexOf(clean[i + 2] ?? 'A') << 6) | B64.indexOf(clean[i + 3] ?? 'A');
    if (o < out.length) out[o++] = (n >>> 16) & 255;
    if (o < out.length) out[o++] = (n >>> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
