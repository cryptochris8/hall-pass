// ─────────────────────────────────────────────────────────────────────────────
// Looks (pure, no THREE): the PersonLook for a spec (contract lookFor) and the
// extra seeded build traits the look doesn't carry (adult body, garment cut,
// glasses shape…). Same seed + role → same person. Seeded through Rng only.
// ─────────────────────────────────────────────────────────────────────────────
import { Rng, hashInts } from '../core/rng';
import { BACKPACKS, CARDIGANS, EYE_COLORS, HAIR_COLORS, HAIR_GREY, HAIR_SILVER, PEOPLE, SHIRTS, SKIN_TONES, SLACKS, SNEAKERS, TEEN_BOTTOMS, TEEN_TOPS } from './palette';
import type { BodyKind } from './spec';
import type { HairStyle, PersonLook, PersonRole, PersonSpec } from './types';

export const ROLES: readonly PersonRole[] = ['student', 'extra', 'patroller', 'sentry', 'investigator', 'wanderer', 'snitch', 'listener'];
export const HAIR_STYLES: readonly HairStyle[] = ['short', 'buzz', 'curly', 'afro', 'ponytail', 'bun', 'long', 'bob', 'braids'];

const ROLE_SALT: Readonly<Record<PersonRole, number>> = { student: 11, extra: 23, patroller: 37, sentry: 41, investigator: 53, wanderer: 67, snitch: 71, listener: 83 };

/** Independent seeded stream per (role, seed, purpose). */
function stream(spec: PersonSpec, purpose: number): Rng {
  return new Rng(hashInts(spec.seed | 0, ROLE_SALT[spec.role] ?? 1, purpose));
}

const MASC: readonly HairStyle[] = ['short', 'buzz', 'curly', 'afro', 'short'];
const FEM: readonly HairStyle[] = ['ponytail', 'bun', 'long', 'bob', 'braids', 'curly', 'afro', 'long'];

export type TopCut = 'hoodie' | 'tee' | 'jacket' | 'sweater' | 'polo' | 'shirt' | 'cardigan' | 'blazer' | 'overalls' | 'vest';
export type BottomCut = 'jeans' | 'joggers' | 'slacks' | 'skirt' | 'overalls';

/** Seeded build traits (not part of the contract look). */
export interface Traits {
  body: BodyKind;
  /** Femme-coded styling for adults (woman body, skirt option, lashes). Teens share one body. */
  femme: boolean;
  topCut: TopCut;
  bottomCut: BottomCut;
  /** Under-layer colour (shirt under a cardigan / blazer / vest, tee under a jacket). */
  under: number;
  /** Accent colour (cuffs, tie, lanyard trim…). */
  accent: number;
  eyes: number;
  glassesShape: 'round' | 'square';
  glassesFrame: number;
  beard: 'none' | 'stubble' | 'beard' | 'mustache';
  lashes: boolean;
  brows: 'soft' | 'thick' | 'arched';
  /** Body scale (height variation), ~0.97–1.04. */
  scale: number;
}

function femmeFor(spec: PersonSpec): boolean {
  const r = stream(spec, 1);
  switch (spec.role) {
    case 'patroller':
      return r.chance(0.2);
    case 'wanderer':
      return true;
    case 'snitch':
      return false;
    case 'listener':
      return r.chance(0.65);
    default:
      return r.chance(0.5);
  }
}

/** The look createPerson uses (pure). Overrides in spec.look win field by field. */
export function deriveLook(spec: PersonSpec): PersonLook {
  const r = stream(spec, 2);
  const femme = femmeFor(spec);
  const role = spec.role;
  const teen = role === 'student' || role === 'extra' || role === 'snitch';
  const skin = r.int(0, SKIN_TONES.length - 1);
  let hairStyle: HairStyle;
  if (role === 'student') hairStyle = r.pick(HAIR_STYLES);
  else if (role === 'snitch') hairStyle = r.pick(['short', 'short', 'curly', 'buzz'] as const);
  else if (role === 'patroller') hairStyle = femme ? 'ponytail' : r.pick(['short', 'buzz'] as const);
  else if (role === 'wanderer') hairStyle = r.pick(['bun', 'afro', 'braids', 'curly'] as const);
  else if (role === 'listener') hairStyle = femme ? r.pick(['bun', 'bob', 'curly', 'bun'] as const) : r.pick(['short', 'curly'] as const);
  else hairStyle = femme ? r.pick(FEM) : r.pick(MASC);
  const greyChance = teen ? 0 : role === 'investigator' || role === 'listener' ? 0.4 : 0.18;
  const hair = r.chance(greyChance) ? (r.chance(0.5) ? HAIR_SILVER : HAIR_GREY) : r.pick(HAIR_COLORS);
  let top: number;
  let bottom: number;
  let shoes: number;
  switch (role) {
    case 'patroller':
      top = PEOPLE.poloMaroon;
      bottom = r.pick([PEOPLE.slacksKhaki, PEOPLE.slacksNavy] as const);
      shoes = r.pick([PEOPLE.shoeBlack, PEOPLE.shoeBrown, PEOPLE.sneakerWhite] as const);
      break;
    case 'sentry':
      top = r.chance(0.55) ? r.pick(CARDIGANS) : r.pick(SHIRTS);
      bottom = r.pick(SLACKS);
      shoes = r.pick([PEOPLE.shoeBlack, PEOPLE.shoeBrown] as const);
      break;
    case 'investigator':
      top = PEOPLE.blazer;
      bottom = r.pick([PEOPLE.slacksGrey, PEOPLE.slacksNavy, PEOPLE.blazer] as const);
      shoes = PEOPLE.shoeBlack;
      break;
    case 'wanderer':
      top = PEOPLE.overalls;
      bottom = PEOPLE.overalls;
      shoes = PEOPLE.workBoot;
      break;
    case 'snitch':
      top = PEOPLE.vestNavy;
      bottom = PEOPLE.slacksKhaki;
      shoes = PEOPLE.shoeBrown;
      break;
    case 'listener':
      top = r.chance(0.6) ? PEOPLE.cardiganLavender : r.pick(CARDIGANS);
      bottom = r.pick(SLACKS);
      shoes = PEOPLE.shoeBrown;
      break;
    default:
      top = r.pick(TEEN_TOPS);
      bottom = r.pick(TEEN_BOTTOMS);
      shoes = r.pick(SNEAKERS);
  }
  const glassesP = role === 'listener' ? 1 : role === 'sentry' ? 0.45 : role === 'snitch' ? 0.5 : role === 'investigator' ? 0.35 : teen ? 0.2 : 0.25;
  const glasses = r.chance(glassesP);
  const backpack = role === 'student' ? r.pick(BACKPACKS) : null;
  const headphones = role === 'student' ? r.chance(0.45) : false;
  const look: PersonLook = { skin, hairStyle, hair, top, bottom, shoes, glasses, backpack, headphones };
  return sanitizeLook({ ...look, ...(spec.look ?? {}) }, look, role);
}

/** Clamp / validate overrides (never throws): bad fields fall back to the seeded look. */
function sanitizeLook(l: PersonLook, fb: PersonLook, role: PersonRole): PersonLook {
  const hex = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(0xffffff, Math.floor(v))) : d);
  const skin = typeof l.skin === 'number' && Number.isFinite(l.skin) ? Math.max(0, Math.min(SKIN_TONES.length - 1, Math.floor(l.skin))) : fb.skin;
  const student = role === 'student';
  return {
    skin,
    hairStyle: HAIR_STYLES.includes(l.hairStyle) ? l.hairStyle : fb.hairStyle,
    hair: hex(l.hair, fb.hair),
    top: hex(l.top, fb.top),
    bottom: hex(l.bottom, fb.bottom),
    shoes: hex(l.shoes, fb.shoes),
    glasses: typeof l.glasses === 'boolean' ? l.glasses : fb.glasses,
    backpack: student && l.backpack !== null ? hex(l.backpack, fb.backpack ?? BACKPACKS[0]!) : null,
    headphones: student ? !!l.headphones : false,
  };
}

const FEM_HAIR: readonly HairStyle[] = ['ponytail', 'bun', 'long', 'bob', 'braids'];

export function deriveTraits(spec: PersonSpec, look: PersonLook): Traits {
  const r = stream(spec, 3);
  const role = spec.role;
  const femme = femmeFor(spec);
  const teen = role === 'student' || role === 'extra' || role === 'snitch';
  const body: BodyKind = teen ? 'teen' : femme ? 'woman' : 'man';
  const femCoded = teen ? FEM_HAIR.includes(look.hairStyle) : femme;
  let topCut: TopCut;
  let bottomCut: BottomCut;
  switch (role) {
    case 'student':
      topCut = 'hoodie';
      bottomCut = 'jeans';
      break;
    case 'extra': {
      topCut = r.pick(['hoodie', 'tee', 'jacket', 'sweater', 'tee'] as const);
      const k = r.next();
      bottomCut = femCoded && k < 0.3 ? 'skirt' : k < 0.55 ? 'joggers' : 'jeans';
      break;
    }
    case 'patroller':
      topCut = 'polo';
      bottomCut = 'slacks';
      break;
    case 'sentry':
      topCut = CARDIGANS.includes(look.top) ? 'cardigan' : 'shirt';
      bottomCut = femme && r.chance(0.5) ? 'skirt' : 'slacks';
      break;
    case 'investigator':
      topCut = 'blazer';
      bottomCut = femme && r.chance(0.4) ? 'skirt' : 'slacks';
      break;
    case 'wanderer':
      topCut = 'overalls';
      bottomCut = 'overalls';
      break;
    case 'snitch':
      topCut = 'vest';
      bottomCut = 'slacks';
      break;
    case 'listener':
      topCut = 'cardigan';
      bottomCut = femme && r.chance(0.5) ? 'skirt' : 'slacks';
      break;
  }
  const under =
    topCut === 'cardigan' || topCut === 'blazer' || topCut === 'vest'
      ? r.pick(SHIRTS)
      : topCut === 'jacket'
        ? r.pick([0xf2f0ea, 0x30333d, 0xd8cdb8, 0x8f8a80] as const)
        : topCut === 'overalls'
          ? PEOPLE.workShirt
          : 0;
  const accent = role === 'investigator' ? PEOPLE.tiePlum : role === 'snitch' ? PEOPLE.vestTrim : r.pick(TEEN_TOPS);
  const beard: Traits['beard'] = femme || teen ? 'none' : role === 'investigator' ? (r.chance(0.6) ? 'mustache' : 'stubble') : r.chance(0.3) ? r.pick(['stubble', 'beard', 'mustache'] as const) : 'none';
  return {
    body,
    femme,
    topCut,
    bottomCut,
    under,
    accent,
    eyes: r.pick(EYE_COLORS),
    glassesShape: r.chance(0.5) ? 'round' : 'square',
    glassesFrame: r.pick([PEOPLE.glassesFrame, PEOPLE.glassesFrameWarm, PEOPLE.glassesFrameRed, PEOPLE.glassesFrame] as const),
    beard,
    lashes: femCoded,
    brows: femCoded ? 'arched' : role === 'patroller' || role === 'investigator' ? 'thick' : r.chance(0.5) ? 'soft' : 'thick',
    scale: teen ? 0.965 + r.next() * 0.075 : 0.97 + r.next() * 0.07,
  };
}

/** Geometry cache key: everything the skinned geometry depends on. */
export function lookKey(role: PersonRole, look: PersonLook, t: Traits): string {
  return [
    role,
    look.skin,
    look.hairStyle,
    look.hair,
    look.top,
    look.bottom,
    look.shoes,
    look.glasses ? 1 : 0,
    look.backpack ?? -1,
    look.headphones ? 1 : 0,
    t.body,
    t.femme ? 1 : 0,
    t.topCut,
    t.bottomCut,
    t.under,
    t.accent,
    t.eyes,
    t.glassesShape,
    t.glassesFrame,
    t.beard,
    t.lashes ? 1 : 0,
    t.brows,
  ].join('|');
}
