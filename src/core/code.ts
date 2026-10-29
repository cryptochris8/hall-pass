// ─────────────────────────────────────────────────────────────────────────────
// Challenge codes (docs/ARCHITECTURE.md §14, GDD §1): one run as 6 characters,
// shown "XXX-XXX". 30 bits: seed 22 · mission 3 · tier 3 · difficulty 2, written
// with a 32-letter alphabet that has no 0 O 1 I (easy to read aloud and to type).
// An optional score rides along after a second dash ("H4L-L22-4120") so a friend
// can see what to beat. Pure; no DOM.
// ─────────────────────────────────────────────────────────────────────────────
import { DIFFICULTIES, MISSION_IDS, type Difficulty, type MissionId, type TierId } from '../school/types';

export const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const CODE_SEED_BITS = 22;
export const CODE_SEED_MAX = (1 << CODE_SEED_BITS) - 1;

export interface ChallengeCode {
  seed: number;
  mission: MissionId;
  tier: TierId;
  difficulty: Difficulty;
  /** The score to beat, when the code carried one. */
  score: number | null;
}

/** "XXX-XXX" (or "XXX-XXX-NNNN" with a score). The seed is masked to 22 bits. */
export function encodeCode(c: Omit<ChallengeCode, 'score'> & { score?: number | null }): string {
  const m = MISSION_IDS.indexOf(c.mission);
  const d = DIFFICULTIES.indexOf(c.difficulty);
  if (m < 0 || d < 0 || c.tier < 1 || c.tier > 5) throw new Error('encodeCode: bad run');
  // 30 bits: seed (22) | mission (3) | tier-1 (3) | difficulty (2). Kept below 2^31 so plain integer math works.
  let v = ((c.seed & CODE_SEED_MAX) << 8) | (m << 5) | ((c.tier - 1) << 2) | d;
  v >>>= 0;
  let s = '';
  for (let i = 0; i < 6; i++) {
    s = CODE_ALPHABET[v & 31]! + s;
    v >>>= 5;
  }
  const base = `${s.slice(0, 3)}-${s.slice(3)}`;
  const score = c.score ?? null;
  return score !== null && Number.isFinite(score) && score > 0 ? `${base}-${Math.min(9999999, Math.floor(score))}` : base;
}

/** The friendly error for anything that isn't a valid code. */
export const BAD_CODE = "That code doesn't look right — check it and try again.";

/**
 * Parse what someone typed or pasted: case-insensitive, spaces and the middle dash optional (a score needs its
 * dash). A character outside the alphabet (0, O, 1, I) is invalid rather than guessed at. Returns null when it isn't
 * a valid code (wrong length, unknown letters, mission or tier out of range).
 */
export function decodeCode(input: string): ChallengeCode | null {
  if (typeof input !== 'string' || input.length > 40) return null;
  const clean = input.toUpperCase().replace(/[\s·.]+/g, '').trim();
  const m = /^([A-Z0-9]{3})-?([A-Z0-9]{3})(?:-(\d{1,7}))?$/.exec(clean);
  if (!m) return null;
  const chars = m[1]! + m[2]!;
  let v = 0;
  for (const ch of chars) {
    const k = CODE_ALPHABET.indexOf(ch);
    if (k < 0) return null;
    v = v * 32 + k;
  }
  const d = v & 3;
  const tier = ((v >>> 2) & 7) + 1;
  const mi = (v >>> 5) & 7;
  const seed = v >>> 8;
  if (d >= DIFFICULTIES.length || mi >= MISSION_IDS.length || tier > 5) return null;
  const score = m[3] !== undefined ? Number(m[3]) : null;
  return { seed, mission: MISSION_IDS[mi]!, tier: tier as TierId, difficulty: DIFFICULTIES[d]!, score: score !== null && score > 0 ? score : null };
}
