// ─────────────────────────────────────────────────────────────────────────────
// Local save data (docs/ARCHITECTURE.md §1: integration). One JSON blob in
// localStorage under SAVE_KEY. Everything read back is untrusted: sanitize()
// rebuilds a valid SaveData from whatever is there (missing, old, hand-edited),
// and every storage access is wrapped so a private window or blocked storage just
// means nothing is remembered — the game never breaks over it.
// ─────────────────────────────────────────────────────────────────────────────
import { DIFFICULTIES, MISSION_IDS, type Difficulty, type MissionId, type TierId } from '../school/types';
import { GRADES, type Grade, type HallReport, type Rank } from '../sim/score';

export const SAVE_KEY = 'hall-pass:save:v1';

export type CameraPreset = 'close' | 'mid' | 'tactical';
export type WallsSetting = 'occlude' | 'cutaway' | 'low' | 'full';

export interface RunRecord {
  score: number;
  grade: Grade;
  rank: Rank;
  seconds: number;
}

export interface WeekProgress {
  tier: TierId;
  seed: number;
  /** Next day to play, 0–4; 5 = the week is over. */
  day: number;
  /** Best grade and score per day (null: not played yet). */
  grades: (Grade | null)[];
  scores: number[];
}

export interface Settings {
  camera: CameraPreset;
  walls: WallsSetting;
  cones: boolean;
  reducedMotion: boolean;
}

export interface SaveData {
  v: 1;
  /** Highest school tier unlocked (SCHOOL WEEK ladder). */
  unlocked: TierId;
  week: WeekProgress | null;
  /** Best week grade per tier. */
  weeks: Partial<Record<string, Grade>>;
  /** Best run per `${mission}:${tier}:${difficulty}`. */
  records: Record<string, RunRecord>;
  /** DAILY results per yyyymmdd: the first attempt (marked on the share card) and the best. */
  daily: Record<string, { first: RunRecord; best: RunRecord; attempts: number }>;
  totals: { runs: number; ghosts: number; detentions: number; snacks: number };
  settings: Settings;
}

export function defaultSave(): SaveData {
  return {
    v: 1,
    unlocked: 1,
    week: null,
    weeks: {},
    records: {},
    daily: {},
    totals: { runs: 0, ghosts: 0, detentions: 0, snacks: 0 },
    settings: { camera: 'close', walls: 'occlude', cones: true, reducedMotion: false },
  };
}

const RANKS: readonly Rank[] = ['GHOST', 'SMOOTH', 'CLOSE CALL', 'DETENTION'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number, def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : def;
const pick = <T extends string>(v: unknown, allowed: readonly T[], def: T): T => (allowed.includes(v as T) ? (v as T) : def);
const tierOf = (v: unknown): TierId => num(v, 1, 5, 1) as TierId;

function record(v: unknown): RunRecord | null {
  if (!isObj(v)) return null;
  const grade = pick(v.grade, GRADES, 'D');
  return { score: num(v.score, 0, 1e7, 0), grade, rank: pick(v.rank, RANKS, 'DETENTION'), seconds: num(v.seconds, 0, 3600, 0) };
}

/** A valid SaveData from anything (the stored JSON is untrusted). Unknown keys are dropped. */
export function sanitize(raw: unknown): SaveData {
  const out = defaultSave();
  if (!isObj(raw) || raw.v !== 1) return out;
  out.unlocked = tierOf(raw.unlocked);
  if (isObj(raw.week)) {
    const w = raw.week;
    const grades = Array.isArray(w.grades) ? w.grades.slice(0, 5).map((g) => (GRADES.includes(g as Grade) ? (g as Grade) : null)) : [];
    while (grades.length < 5) grades.push(null);
    const scores = Array.isArray(w.scores) ? w.scores.slice(0, 5).map((s) => num(s, 0, 1e7, 0)) : [];
    while (scores.length < 5) scores.push(0);
    out.week = { tier: Math.min(tierOf(w.tier), out.unlocked) as TierId, seed: num(w.seed, 0, 0x3fffff, 0), day: num(w.day, 0, 5, 0), grades, scores };
  }
  if (isObj(raw.weeks)) for (const t of ['1', '2', '3', '4', '5']) if (GRADES.includes(raw.weeks[t] as Grade)) out.weeks[t] = raw.weeks[t] as Grade;
  if (isObj(raw.records)) {
    for (const m of MISSION_IDS) for (const t of [1, 2, 3, 4, 5]) for (const d of DIFFICULTIES) {
      const key = recordKey(m, t as TierId, d);
      const r = record(raw.records[key]);
      if (r) out.records[key] = r;
    }
  }
  if (isObj(raw.daily)) {
    // Keep the last 120 days at most.
    const keys = Object.keys(raw.daily).filter((k) => /^\d{8}$/.test(k)).sort().slice(-120);
    for (const k of keys) {
      const d = raw.daily[k];
      if (!isObj(d)) continue;
      const first = record(d.first);
      const best = record(d.best);
      if (first && best) out.daily[k] = { first, best, attempts: num(d.attempts, 1, 1e6, 1) };
    }
  }
  if (isObj(raw.totals)) {
    const t = raw.totals;
    out.totals = { runs: num(t.runs, 0, 1e9, 0), ghosts: num(t.ghosts, 0, 1e9, 0), detentions: num(t.detentions, 0, 1e9, 0), snacks: num(t.snacks, 0, 1e9, 0) };
  }
  if (isObj(raw.settings)) {
    const s = raw.settings;
    out.settings = {
      camera: pick(s.camera, ['close', 'mid', 'tactical'] as const, 'close'),
      walls: pick(s.walls, ['occlude', 'cutaway', 'low', 'full'] as const, 'occlude'),
      cones: s.cones !== false,
      reducedMotion: s.reducedMotion === true,
    };
  }
  return out;
}

export function recordKey(mission: MissionId, tier: TierId, difficulty: Difficulty): string {
  return `${mission}:${tier}:${difficulty}`;
}

function better(a: RunRecord | undefined, b: RunRecord): boolean {
  return !a || b.score > a.score;
}

/** Fold a finished run into the save (records, daily, totals). Returns whether it was a new best for its slot. */
export function recordRun(save: SaveData, r: HallReport, tier: TierId, daily: number | null, snacks: number): boolean {
  const rec: RunRecord = { score: r.total, grade: r.grade, rank: r.rank, seconds: r.seconds };
  const key = recordKey(r.mission, tier, r.difficulty);
  const best = better(save.records[key], rec);
  if (best) save.records[key] = rec;
  if (daily !== null) {
    const k = String(daily);
    const d = save.daily[k];
    if (!d) save.daily[k] = { first: rec, best: rec, attempts: 1 };
    else {
      d.attempts++;
      if (better(d.best, rec)) d.best = rec;
    }
  }
  save.totals.runs++;
  if (r.rank === 'GHOST') save.totals.ghosts++;
  if (r.rank === 'DETENTION') save.totals.detentions++;
  save.totals.snacks += snacks;
  return best;
}

/** Days in a row (ending today or yesterday) with a DAILY played. */
export function dailyStreak(save: SaveData, today: number, civilDay: (yyyymmdd: number) => number): number {
  const days = new Set(Object.keys(save.daily).map((k) => civilDay(Number(k))));
  let d = civilDay(today);
  if (!days.has(d)) d--;
  let n = 0;
  while (days.has(d)) {
    n++;
    d--;
  }
  return n;
}

/** localStorage wrapper: every access guarded. */
export class Store {
  data: SaveData;

  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safeLocalStorage()) {
    let raw: unknown = null;
    try {
      const s = this.storage?.getItem(SAVE_KEY);
      raw = s ? JSON.parse(s) : null;
    } catch {
      raw = null;
    }
    this.data = sanitize(raw);
  }

  save(): void {
    try {
      this.storage?.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage full or blocked: nothing is remembered, nothing breaks */
    }
  }

  reset(): void {
    this.data = defaultSave();
    try {
      this.storage?.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
