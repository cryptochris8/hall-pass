// ─────────────────────────────────────────────────────────────────────────────
// People colour tokens (owner: people). Ported from Bad Hair Day's palette (skin
// tones, hair, eyes, face inks) and extended with the HALL PASS staff / student
// wardrobe. Kept here so src/render/palette.ts stays untouched; the integrator
// may merge these into PAL later (same names, `PEOPLE.` → `PAL.`).
// Never uses the reserved gameplay colours (cone yellow/orange/red, goal blue,
// interact white ring, safe mint).
// ─────────────────────────────────────────────────────────────────────────────

/** Skin tones, light → deep (PersonLook.skin indexes this, 0–7). */
export const SKIN_TONES: readonly number[] = [0xffe0c7, 0xf9d0ae, 0xf0bb90, 0xe0a57a, 0xc98a5e, 0xa86d45, 0x85522f, 0x5f3a22];

/** Natural hair colours (+ silver for some staff). */
export const HAIR_COLORS: readonly number[] = [
  0x2e1d15, // espresso
  0x44291b, // dark brown
  0x6b3d24, // chestnut
  0x8c3e22, // auburn
  0x9b6536, // caramel
  0xbf8a48, // honey
  0xd9ad5f, // golden blonde
  0xc56a3e, // strawberry
  0x1b1616, // black
];
export const HAIR_SILVER = 0xb9b6bd;
export const HAIR_GREY = 0x8d8a90;

/** Iris colours. */
export const EYE_COLORS: readonly number[] = [0x4a2e1f, 0x6b4a2b, 0x3f6f9f, 0x4f7f4f, 0x7a8a5a, 0x2e2e3a];

export const PEOPLE = {
  // ── face ──
  eyeWhite: 0xfffdf7,
  eyeInk: 0x1f2230,
  lipLine: 0x5b2636,
  mouthDark: 0x6e2a3c,
  tongue: 0xf28a9c,
  teeth: 0xfffbf2,
  blush: 0xff8f9e,
  glassesFrame: 0x2b2f3a,
  glassesFrameWarm: 0x8a4f3c,
  glassesFrameRed: 0xa33a3a,

  // ── shoes ──
  sneakerWhite: 0xf3f2ec,
  sneakerSole: 0xe4e0d6,
  shoeBrown: 0x5a3b2a,
  shoeBlack: 0x2a2a30,
  workBoot: 0x6b4a32,

  // ── student wardrobe ──
  denim: 0x5b7fb8,
  jeansDark: 0x3f5f93,
  jeansBlack: 0x34343f,
  hoodieString: 0xf1ece2,
  headphones: 0x30333d,
  headphonePad: 0x5a5f6e,

  // ── staff wardrobe ──
  slacksGrey: 0x5c6170,
  slacksNavy: 0x2f3a52,
  slacksKhaki: 0xb59c74,
  skirtNavy: 0x34405e,
  shirtWhite: 0xf2f0ea,
  shirtBlue: 0xbcd0e6,
  /** Hall monitor polo (school maroon) + cap. */
  poloMaroon: 0x8a2f3a,
  capNavy: 0x27324a,
  lanyard: 0x3c5f9a,
  whistle: 0xc9d1da,
  badge: 0xf7f5ef,
  watchStrap: 0x2b2f3a,
  goldTrim: 0xe8b84a,
  /** Vice principal: charcoal blazer, plum tie, the dramatic mug. */
  blazer: 0x3e4250,
  tiePlum: 0x6b3f5f,
  mugBody: 0xfdf6ea,
  mugBand: 0x2f6f73,
  coffee: 0x6b4430,
  /** Custodian: work overalls + the cart. */
  overalls: 0x4f6f78,
  overallsDark: 0x3c5760,
  workShirt: 0xd8cdb8,
  cartBody: 0x5d6a7a,
  cartDark: 0x3d4654,
  cartBin: 0x7f8f6e,
  bucket: 0x4a7fa8,
  mopHandle: 0xb98a5a,
  mopHead: 0xe8e0cc,
  water: 0x8fb8cf,
  /** Student-council sweater vest + clipboard. */
  vestNavy: 0x2f3e66,
  vestTrim: 0xb08a2e,
  clipboard: 0xa87a4f,
  clip: 0xb9c0c8,
  paper: 0xfbf8f0,
  paperLine: 0x9fb2cc,
  /** Cardigans (teachers, librarian). */
  cardiganLavender: 0x7a6a8f,
  cardiganSage: 0x7f9a7c,
  cardiganRust: 0xa8624a,
  cardiganOat: 0xc9b896,
  cardiganTeal: 0x4f7f86,
} as const;

/** Hoodie / jacket colours for students (none of the reserved gameplay colours). */
export const TEEN_TOPS: readonly number[] = [0x3b6fd6, 0x8a2f3a, 0x4f7f4f, 0x6b3f5f, 0xd06a4a, 0x2f3e66, 0x8f8a80, 0xc9a2c6, 0x3f8f8a, 0xe0c9a0];
export const TEEN_BOTTOMS: readonly number[] = [PEOPLE.denim, PEOPLE.jeansDark, PEOPLE.jeansBlack, 0x6b6f7a, 0x8a7a5a];
export const SNEAKERS: readonly number[] = [0xf3f2ec, 0x2a2a30, 0xc0392b, 0x3f5f93, 0x6fae7f, 0xe7c7a0];
export const BACKPACKS: readonly number[] = [0xc0392b, 0x2f3e66, 0x3f8f8a, 0x8a6fae, 0x3d4654, 0xd9874a, 0x5f7a6a];
export const CARDIGANS: readonly number[] = [PEOPLE.cardiganLavender, PEOPLE.cardiganSage, PEOPLE.cardiganRust, PEOPLE.cardiganOat, PEOPLE.cardiganTeal];
export const SHIRTS: readonly number[] = [PEOPLE.shirtWhite, PEOPLE.shirtBlue, 0xe6d6c0, 0xcfd9c6];
export const SLACKS: readonly number[] = [PEOPLE.slacksGrey, PEOPLE.slacksNavy, PEOPLE.slacksKhaki, 0x4a3f3a];
