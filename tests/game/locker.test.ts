// LOCKER rules: unlocks, XP, nickname sanitizing, stored looks rebuilt only from known options.
import { describe, expect, it } from 'vitest';
import { BACKPACK, HAIR_COLOUR, HOODIE, nextXpUnlock, sanitizeLook, sanitizeNickname, SNEAKERS, unlocked, xpFor } from '../../src/game/locker';
import { lookFor } from '../../src/people';
import { HAIR_COLORS, TEEN_BOTTOMS, TEEN_TOPS } from '../../src/people/palette';

describe('locker', () => {
  it('the base wardrobe matches the people palette (the default student is always a valid LOCKER look)', () => {
    for (const c of TEEN_TOPS) expect(HOODIE.some((o) => o.value === c)).toBe(true);
    for (const c of HAIR_COLORS) expect(HAIR_COLOUR.some((o) => o.value === c)).toBe(true);
    const d = lookFor({ role: 'student', seed: 0x51ed });
    expect(sanitizeLook(d, d)).toEqual(d);
    expect(TEEN_BOTTOMS.length).toBeGreaterThan(0);
  });

  it('unlocks: XP dyes and colours, signature hoodies by an A week at that school', () => {
    const fresh = { xp: 0, weeks: {} };
    expect(HOODIE.filter((o) => unlocked(o, fresh)).length).toBe(10);
    const westbrook = HOODIE.find((o) => o.name === 'Westbrook High')!;
    expect(unlocked(westbrook, { xp: 0, weeks: { '2': 'B' } })).toBe(false);
    expect(unlocked(westbrook, { xp: 0, weeks: { '2': 'A' } })).toBe(true);
    expect(unlocked(westbrook, { xp: 0, weeks: { '2': 'A+' } })).toBe(true);
    const gold = SNEAKERS.find((o) => o.name === 'Gold')!;
    expect(unlocked(gold, { xp: 1499, weeks: {} })).toBe(false);
    expect(unlocked(gold, { xp: 1500, weeks: {} })).toBe(true);
    expect(nextXpUnlock(0)).toEqual({ name: 'Camo', xp: 600 });
    expect(nextXpUnlock(1e9)).toBeNull();
    expect(BACKPACK[0]!.value).toBeNull();
  });

  it('XP: something for every run, more for a good one', () => {
    expect(xpFor(0)).toBe(25);
    expect(xpFor(-100)).toBe(25);
    expect(xpFor(5000)).toBe(275);
  });

  it('nicknames: safe characters only, single spaces, 12 at most', () => {
    expect(sanitizeNickname('  Mo  ')).toBe('Mo');
    expect(sanitizeNickname('<script>x</script>')).toBe('scriptxscrip'); // tags stripped, then capped at 12
    expect(sanitizeNickname('a    b')).toBe('a b');
    expect(sanitizeNickname('ＡＢＣ')).toBe('ABC'); // full-width letters normalize
    expect(sanitizeNickname('x'.repeat(40))).toHaveLength(12);
    expect(sanitizeNickname('héllo😀')).toBe('hllo');
    expect(sanitizeNickname(42)).toBe('');
  });

  it('stored looks are rebuilt only from known options', () => {
    const d = lookFor({ role: 'student', seed: 0x51ed });
    const l = sanitizeLook({ skin: 99, hairStyle: 'mohawk', hair: 0x123456, top: HOODIE[3]!.value, glasses: 'yes', backpack: null }, d);
    expect(l.skin).toBe(d.skin);
    expect(l.hairStyle).toBe(d.hairStyle);
    expect(l.hair).toBe(d.hair);
    expect(l.top).toBe(HOODIE[3]!.value);
    expect(l.glasses).toBe(d.glasses);
    expect(l.backpack).toBeNull();
    expect(sanitizeLook(null, d)).toEqual(d);
  });
});
