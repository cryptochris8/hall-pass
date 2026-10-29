// ─────────────────────────────────────────────────────────────────────────────
// LOCKER (docs/GDD.md §2, §9): the student's cosmetics and nickname. All
// cosmetic — identical gameplay. Most options are open from the start; a few are
// unlocked: each school's signature hoodie by clearing its SCHOOL WEEK with an A
// average, and some dyes and colours by XP (earned by every run, even a
// detention). Pure data + rules; the screen lives in app.ts.
// ─────────────────────────────────────────────────────────────────────────────
import type { HairStyle, PersonLook } from '../people/types';
import type { TierId } from '../school/types';

export interface Option<T> {
  value: T;
  name: string;
  /** XP needed (0 = always open). */
  xp?: number;
  /** A school week cleared with an A or A+ at this tier. */
  week?: TierId;
}

/** Skin tones (indexes into the people palette, light → deep). Never locked. */
export const SKIN: readonly Option<number>[] = ['Tone 1', 'Tone 2', 'Tone 3', 'Tone 4', 'Tone 5', 'Tone 6', 'Tone 7', 'Tone 8'].map((name, value) => ({ value, name }));

export const HAIR_STYLE: readonly Option<HairStyle>[] = [
  { value: 'short', name: 'Short' },
  { value: 'buzz', name: 'Buzz' },
  { value: 'curly', name: 'Curly' },
  { value: 'afro', name: 'Afro' },
  { value: 'ponytail', name: 'Ponytail' },
  { value: 'bun', name: 'Bun' },
  { value: 'long', name: 'Long' },
  { value: 'bob', name: 'Bob' },
  { value: 'braids', name: 'Braids' },
];

export const HAIR_COLOUR: readonly Option<number>[] = [
  { value: 0x1b1616, name: 'Black' },
  { value: 0x2e1d15, name: 'Espresso' },
  { value: 0x44291b, name: 'Dark brown' },
  { value: 0x6b3d24, name: 'Chestnut' },
  { value: 0x8c3e22, name: 'Auburn' },
  { value: 0x9b6536, name: 'Caramel' },
  { value: 0xbf8a48, name: 'Honey' },
  { value: 0xd9ad5f, name: 'Blonde' },
  { value: 0xc56a3e, name: 'Strawberry' },
  { value: 0x3a5fb0, name: 'Blue dye', xp: 1000 },
  { value: 0xd977a8, name: 'Pink dye', xp: 2500 },
  { value: 0x7a52b3, name: 'Violet dye', xp: 5000 },
];

export const HOODIE: readonly Option<number>[] = [
  { value: 0x3b6fd6, name: 'Cobalt' },
  { value: 0x8a2f3a, name: 'Maroon' },
  { value: 0x4f7f4f, name: 'Forest' },
  { value: 0x6b3f5f, name: 'Plum' },
  { value: 0xd06a4a, name: 'Rust' },
  { value: 0x2f3e66, name: 'Navy' },
  { value: 0x8f8a80, name: 'Heather' },
  { value: 0xc9a2c6, name: 'Lilac' },
  { value: 0x3f8f8a, name: 'Teal' },
  { value: 0xe0c9a0, name: 'Oat' },
  // Signature hoodies: clear that school's week with an A average.
  { value: 0x9c3b2c, name: 'Maple Middle', week: 1 },
  { value: 0x24365e, name: 'Westbrook High', week: 2 },
  { value: 0x5b3a8c, name: 'Lakeview Spirit', week: 3 },
  { value: 0x5a1f2b, name: "St. Rigid's", week: 4 },
  { value: 0xe08a5a, name: 'Summer School', week: 5 },
];

export const PANTS: readonly Option<number>[] = [
  { value: 0x5b7fb8, name: 'Denim' },
  { value: 0x3f5f93, name: 'Dark denim' },
  { value: 0x34343f, name: 'Black' },
  { value: 0x6b6f7a, name: 'Grey' },
  { value: 0x8a7a5a, name: 'Khaki' },
];

export const SNEAKERS: readonly Option<number>[] = [
  { value: 0xf3f2ec, name: 'White' },
  { value: 0x2a2a30, name: 'Black' },
  { value: 0xc0392b, name: 'Red' },
  { value: 0x3f5f93, name: 'Navy' },
  { value: 0x6fae7f, name: 'Sage' },
  { value: 0xe7c7a0, name: 'Tan' },
  { value: 0xd9b44a, name: 'Gold', xp: 1500 },
  { value: 0xe85d9b, name: 'Hot pink', xp: 3500 },
];

/** Backpack colours (null = no backpack). */
export const BACKPACK: readonly Option<number | null>[] = [
  { value: null, name: 'None' },
  { value: 0xc0392b, name: 'Red' },
  { value: 0x2f3e66, name: 'Navy' },
  { value: 0x3f8f8a, name: 'Teal' },
  { value: 0x8a6fae, name: 'Purple' },
  { value: 0x3d4654, name: 'Slate' },
  { value: 0xd9874a, name: 'Orange' },
  { value: 0x5f7a6a, name: 'Olive' },
  { value: 0x5f6b3a, name: 'Camo', xp: 600 },
  { value: 0x9a5fd0, name: 'Glitter', xp: 2000 },
];

export interface Unlocks {
  xp: number;
  /** Best week grade per tier ('1'…'5'). */
  weeks: Partial<Record<string, string>>;
}

export function unlocked<T>(o: Option<T>, u: Unlocks): boolean {
  if (o.xp !== undefined && u.xp < o.xp) return false;
  if (o.week !== undefined) {
    const g = u.weeks[String(o.week)];
    if (g !== 'A' && g !== 'A+') return false;
  }
  return true;
}

/** What it takes, for a locked option ("1500 XP", "an A week" at that school). */
export function lockReason<T>(o: Option<T>): string {
  if (o.week !== undefined) return 'an A week';
  return `${o.xp ?? 0} XP`;
}

/** XP for a finished run: something for every run, more for a good one. */
export function xpFor(total: number): number {
  return 25 + Math.floor(Math.max(0, total) / 20);
}

/** The next XP unlock above `xp` (null when everything is open). */
export function nextXpUnlock(xp: number): { name: string; xp: number } | null {
  const all = [...HAIR_COLOUR, ...SNEAKERS, ...BACKPACK].filter((o) => o.xp !== undefined && o.xp > xp);
  all.sort((a, b) => a.xp! - b.xp!);
  const o = all[0];
  return o ? { name: o.name, xp: o.xp! } : null;
}

export const NICK_MAX = 12;

/**
 * A nickname you can put on a share card: letters, digits, space, dot, dash and underscore only, single spaces,
 * at most 12 characters. Anything else is dropped (it is only ever shown with textContent anyway).
 */
export function sanitizeNickname(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICK_MAX)
    .trim();
}

/** A stored look, rebuilt only from known options (anything else falls back to `fallback`). */
export function sanitizeLook(raw: unknown, fallback: PersonLook): PersonLook {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pick = <T>(list: readonly Option<T>[], v: unknown, d: T): T => (list.some((o) => o.value === v) ? (v as T) : d);
  return {
    skin: pick(SKIN, r.skin, fallback.skin),
    hairStyle: pick(HAIR_STYLE, r.hairStyle, fallback.hairStyle),
    hair: pick(HAIR_COLOUR, r.hair, fallback.hair),
    top: pick(HOODIE, r.top, fallback.top),
    bottom: pick(PANTS, r.bottom, fallback.bottom),
    shoes: pick(SNEAKERS, r.shoes, fallback.shoes),
    glasses: typeof r.glasses === 'boolean' ? r.glasses : fallback.glasses,
    backpack: pick(BACKPACK, r.backpack, fallback.backpack),
    headphones: typeof r.headphones === 'boolean' ? r.headphones : fallback.headphones,
  };
}
