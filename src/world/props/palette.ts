// ─────────────────────────────────────────────────────────────────────────────
// Props colour tokens (owner: props). Decoration colours for furniture and
// school dressing that src/render/palette.ts doesn't have. School neutrals and
// faded school colours only: the gameplay colours (cone yellow/red, goal blue,
// interact white, safe mint) stay reserved — the goal highlight uses PAL.goal
// itself, nothing else here comes close to it.
// ─────────────────────────────────────────────────────────────────────────────
import { PAL } from '../../render/palette';

export const PP = {
  // ── wood / laminate / metal ──
  woodDark: 0x6e4b32,
  woodMid: 0x9a6b44,
  laminate: 0xe3d6b8,
  cafTop: 0xd8cfb6,
  metalDark: 0x56606c,
  metalLight: 0xc3c9cf,
  stainless: 0xb7bfc5,
  chrome: 0xdfe3e7,
  /** Student chair plastic (two muted school-supply colours). */
  chairA: 0x3f7f8c,
  chairB: 0xb8613f,
  stool: 0x4a5560,

  // ── paper / stationery ──
  paper: 0xf6f1e4,
  paperYellow: 0xf2e19a,
  paperPink: 0xf1c6c0,
  paperBlue: 0xc9dceb,
  paperGreen: 0xcfe3c4,
  pencil: 0xe0a83a,
  apple: 0xc8402f,
  leaf: 0x5c8f3e,
  mug: 0x3d6fa8,
  coffee: 0x4a2f22,
  cardboard: 0xc49a66,

  // ── lockers ──
  lockerDoor: 0x8cb39a,
  lockerVent: 0x3a4a41,
  lockerInside: 0x1f2a24,
  lockerPlate: 0xd9d3c0,

  // ── bathroom ──
  stallPanel: 0x9fb4bf,
  stallPost: 0x7f93a0,
  porcelain: 0xf1f1ee,
  mirror: 0xcfe2ea,
  mirrorGlint: 0xf4fbff,
  /** Stall door 'occupied' latch (muted green — not the reserved safe-room mint). */
  latch: 0x7f9a5a,

  // ── books (muted spines) ──
  books: [0xa8453a, 0x2f4b7a, 0xc99a3a, 0x3f6b4a, 0x6b4a7a, 0x3f7f8c, 0xe8dcc0, 0x8a5a3a, 0xb8613f] as readonly number[],

  // ── vending / cafeteria ──
  vendTeal: 0x2f6f73,
  vendGlass: 0xfff1d0,
  vendDark: 0x23262e,
  snacks: [0xe0663a, 0xe8c04a, 0x6aa84f, 0xd94f6a, 0x8a5ad0, 0xf2f2f2, 0xf09a3e] as readonly number[],
  tray: 0xc98a4e,
  pizza: 0xe8b04a,
  peas: 0x7fae4a,
  mash: 0xf0e6c8,
  corn: 0xf0cf52,
  sauce: 0xb5462f,
  glass: 0xcfe6ee,
  counterFront: 0x8796a2,
  milk: 0xf4f4f0,

  // ── office ──
  monitor: 0x2b2f38,
  screen: 0xcfe9e6,
  keyboard: 0xe3e0d8,
  trayGrey: 0x6b7480,
  plantPot: 0xb8613f,

  // ── trophies ──
  gold: 0xd8a93a,
  silver: 0xc9ced4,
  bronze: 0xb07a46,
  felt: 0x2c3a5a,

  // ── outdoor ──
  concrete: 0xb8b2a6,
  soil: 0x5a4330,
  shrub: PAL.plant,
  shrubDark: 0x3f7440,
  flowerA: 0xe8a0b4,
  flowerB: 0xf2e6a0,
  flowerC: 0xf4f4f0,
  trunk: 0x7a5a3e,
  canopyA: 0x5a8f48,
  canopyB: 0x4a7d3f,

  // ── walls / doors / boards ──
  doorWood: 0xa9744a,
  doorFrame: 0x5e6b7a,
  doorGlass: 0xbcd6e0,
  lintelTop: 0xbdb5a5,
  whiteboard: 0xf7f7f2,
  boardFrame: 0xb9c0c6,
  markerBlue: 0x2f4f9e,
  markerRed: 0xb5462f,
  markerGreen: 0x2f7a4e,
  markerBlack: 0x2b2f38,
  cork: 0xc59a62,
  clockRim: 0x2f3440,
  clockFace: 0xfbf8ef,
  windowFrame: 0xf2ede2,
  /** Window pane glow: warm late-afternoon light (unlit vertex glow). */
  windowGlow: 0xffe2ae,
  sunPatch: 0xffd49a,
  signNavy: 0x2c3e66,
  signText: 0xf4f1ea,
  scoreboard: 0x23262e,
  scoreDigit: 0xff8a3d,

  // ── hallway ──
  fountain: 0xb7bfc5,
  trashCan: 0x5f6f5a,
  trashLid: 0x4a5747,
  recycle: 0x3f6b8a,

  // ── gym ──
  courtLine: 0xf5f0e6,
  courtPaint: 0xb5462f,
  hoopOrange: 0xe0662c,
  backboard: 0xf7f7f2,
  pad: 0x2c3e66,
  net: 0xf4f4f0,

  // ── classroom extras ──
  backpack: [0x7a2e3a, 0x2f4b7a, 0x3f6b4a, 0x6b4a7a, 0xb8613f] as readonly number[],
  rugRed: 0x8a3a3a,
  rugBlue: 0x3f5a7a,
  rugGreen: 0x4f6b4a,
  beanbag: [0xb8613f, 0x3f7f8c, 0x6b4a7a] as readonly number[],
} as const;

/** Faded school-colour pairs (primary, accent) for banners and pennants, picked per school seed. */
export const SCHOOL_COLOURS: readonly (readonly [number, number])[] = [
  [0x7a2e3a, 0xd9b45a], // maroon / gold
  [0x2c3e66, 0xf1e6c8], // navy / cream
  [0x2f5e46, 0xf1e6c8], // forest / cream
  [0x5a3f7a, 0xd9b45a], // purple / gold
  [0xb5622f, 0x2c3e66], // burnt orange / navy
  [0x8a2f2f, 0xe8e2d4], // red / white
];

/** CSS colour string for a hex number (canvas text). */
export function css(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
