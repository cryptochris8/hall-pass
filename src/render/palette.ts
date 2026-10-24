// ─────────────────────────────────────────────────────────────────────────────
// HALL PASS colour tokens — the single source of truth for the art direction
// (docs/ARCHITECTURE.md §9): "a school on a late afternoon". Sage lockers,
// terrazzo, brick and cream walls under warm low sun and cool fluorescents.
// Gameplay colours are RESERVED (cones, alerts, goal, interact, safe room): never
// use them for decoration. Hex numbers for Three.js; the UI mirrors the UI_*
// values as CSS custom properties.
// SHARED CONTRACT: append tokens in the right section, never repurpose or delete.
// ─────────────────────────────────────────────────────────────────────────────

export const PAL = {
  // ── ink ──
  /** Outline colour for every inked model (deep blue-grey, never pure black). */
  outline: 0x1d2433,

  // ── sky / exterior ──
  skyTop: 0x2a3550,
  ground: 0x3d4a3a,
  groundEdge: 0x2f3a2d,

  // ── lighting ──
  hemiSky: 0xdfe7f2,
  hemiGround: 0x6b5f52,
  sun: 0xffe2b8,
  fluorescent: 0xeef6ff,
  windowWarm: 0xffd49a,

  // ── building ──
  wall: 0xe9e1d0,
  wallTop: 0x8f8778,
  wallCut: 0xcfc5b0,
  brick: 0xa8553f,
  locker: 0x7fa58c,
  lockerDark: 0x5d8069,
  terrazzo: 0xd9d3c6,
  floorRoom: 0xc9b48f,
  floorCafeteria: 0xd8d0bd,
  floorGym: 0xd8a35c,
  floorLibrary: 0x8c7a8f,
  floorBath: 0xbfd6d6,
  floorOffice: 0x9aa6b8,
  floorCourtyard: 0x7e9a5c,
  floorDim: 0xa59e90,

  // ── furniture ──
  desk: 0xb98a5a,
  deskTop: 0xd9b07c,
  shelf: 0x7a5a3e,
  metal: 0x9aa3ad,
  vending: 0xc0392b,
  trophy: 0xb7d4e6,
  bleachers: 0x9b7b4f,
  plant: 0x4f8a4a,

  // ── people (grey box) ──
  student: 0x3b6fd6,
  studentRing: 0xffffff,
  patroller: 0x5a5f73,
  sentry: 0x8a6f5a,
  investigator: 0x6b3f5f,
  sweeper: 0x2f3440,
  wanderer: 0x5f7a6a,
  snitch: 0xb08a2e,
  listener: 0x7a6a8f,

  // ── gameplay (reserved) ──
  cone: 0xffd34d,
  coneSearch: 0xff9a2e,
  coneAlert: 0xff3b3b,
  goal: 0x2e8bff,
  interact: 0xffffff,
  safe: 0x6fe0b4,

  // ── UI mirrors (CSS custom properties on .hp-ui) ──
  uiPaper: 0xf4f1ea,
  uiInk: 0x1d2433,
  uiPlum: 0x1d2433,
} as const;

export type PaletteToken = keyof typeof PAL;
