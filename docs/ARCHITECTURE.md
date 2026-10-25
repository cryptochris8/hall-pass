# HALL PASS — Architecture & module contracts

Stack: **Vite 8 + TypeScript 7 (strict) + Three.js 0.186**, no UI framework, no backend, static deploy (Netlify).
Same proven format as MAILBOX MAYHEM (`C:\Users\chris\One-Shot`), TRASH PANDA TROUBLE (`C:\Users\chris\Trash-Panda`),
ATHLETE MAYHEM (`C:\Users\chris\Athlete-Mayhem`) and BAD HAIR DAY! (`bad-har-day`); Trash Panda is on GitHub as `trash-panda`. All four are **read-only
references: never edit them**. Copy and adapt code from them freely (§11 lists what comes from where).
Everything is procedural: models are built in code (no GLB/GLTF/FBX/OBJ, no downloaded assets), audio is synthesized
at runtime, schools are generated from a seed. Only shipped assets: fonts (`@fontsource/*`), favicon and icons.

Design: `docs/GDD.md` (read it first, especially §0 Tone rules).

**What's different from the other four games:** HALL PASS is a stealth game with daily seeds, challenge codes,
ghosts and (later) verified scores. All of those need the gameplay to be **exactly reproducible**: the same
`RunConfig` and the same inputs must give the same run, tick for tick, on every device and in Node. So the
gameplay lives in a **pure, fixed-timestep simulation** (`src/sim`, `src/school`) that never touches Three.js or
the DOM, and everything else only reads it. §3 has the rules.

```
index.html                 single page; #app root                                          [integration]
src/main.ts                bootstrap + URL params                                           [integration]
src/game/                  app state machine, frame loop (fixed-step accumulator), run flow,
                           camera director, debug hooks                                     [integration]
src/core/                  rng.ts (seeded RNG), math.ts, fmath.ts (deterministic trig),
                           code.ts (challenge-code alphabet + checksum)                     [shared, frozen]
src/school/                PURE. Floor-plan generator, room/corridor/furniture modules,
                           tiers, fairness validator                                        [school]
  gen/                     spine → branches → rooms → furnishing → staff → events (GDD §3)  [school]
  validate.ts              time-expanded route search (GDD §3.1)                            [school]
src/sim/                   PURE. The run: student movement + collision, staff archetypes,
                           detection, missions, PA events, scoring, bot, input recording    [sim]
  staff/                   one file per archetype: patroller sentry investigator sweeper
                           wanderer snitch listener                                         [sim]
  missions/                one file per mission: phone vending pizza locker gym principal   [sim]
src/headless/              Node playtest + balance CLI (bundled separately)                 [integration]
src/render/                renderer core, cutaway camera rig, quality governor              [integration]
  palette.ts toon.ts       colour tokens + shared toon gradient                             [shared, frozen*]
  models/                  GeoBuilder (inked vertex-colour geometry), materials, helpers   [shared, frozen]
  fx/                      particles, confetti, noise rings, cone decals (implements Fx)    [world]
src/world/                 builds the 3D school from a SchoolPlan: walls + cut-away, floors,
                           furniture, windows, afternoon lighting, sky                      [world]
src/people/                the student, staff and extra students: rig, faces, outfits,
                           cosmetics, animation                                             [people]
src/audio/                 Web Audio synth SFX, babble voices, music with intensity layers  [audio]
src/input/                 keyboard, gamepad, touch overlay (logic)                         [integration]
  icons.ts touchStyles.ts  touch-button icon art + overlay styling                          [ui]
src/ui/                    DOM screens: title, menus, HUD, minimap, mission card, Hall
                           Report, LOCKER, code entry, CSS                                  [ui]
src/share/                 share-card text + floor-plan image, challenge codes, ghosts      [integration]
src/storage/               localStorage save data                                           [integration]
dev/*.html + dev/*.ts      per-module test pages (dev server only, not in the build);
                           dev/harness.ts = shared renderer/scene/orbit-camera harness      [each owner]
tests/<module>/            Vitest unit tests                                                [each owner]
e2e/                       Playwright tests                                                 [integration]
tools/shot.mjs             screenshot/smoke tool (starts its own Vite server)
tools/walk.mjs             scripted walkthrough (keys/pad/taps + screenshots)
tools/plan.mjs             prints a seed's SchoolPlan as an ASCII floor plan + the reference route
```
\* palette.ts: you MAY append tokens (in the right section). Never repurpose or delete existing ones.

## 1. Contracts (frozen — read the file header of each)

| Contract | File | Implemented in |
|---|---|---|
| Run config, tick input, sim state, sim events | `src/sim/types.ts` | `src/sim/*` |
| School plan, rooms, walls, furniture, staff spawns, PA events | `src/school/types.ts` | `src/school/*` |
| Staff archetypes | `src/sim/staff/types.ts` | `src/sim/staff/*` |
| Missions | `src/sim/missions/types.ts` | `src/sim/missions/*` |
| People (student, staff, extras) | `src/people/types.ts` | `src/people/index.ts` |
| World (3D school) | `src/world/types.ts` | `src/world/index.ts` |
| Audio | `src/audio/types.ts` | `src/audio/index.ts` |
| UI | `src/ui/types.ts` | `src/ui/index.ts` |
| Input | `src/input/types.ts` | `src/input/*` |
| Render / camera / fx | `src/render/types.ts` | `src/render/*` |
| Share, codes, ghosts | `src/share/types.ts` | `src/share/*` |
| Save data | `src/storage/types.ts` | `src/storage/*` |

Until a module's owner lands it, `src/<module>/index.ts` is a **stub** by the integrator that honours the contract
(capsule people, flat grey walls, silent audio, bare DOM). Owners replace the stub wholesale. The stubs together
are the grey-box prototype (§12, M1).

## 2. Data flow

```
RunConfig ──► school/gen ──► SchoolPlan ──► school/validate ──► SchoolPlan + referenceRoute
                                                                        │
            ┌───────────────────────────────────────────────────────────┘
            ▼
   sim.create(plan, config) ──► SimState
            │
 every tick (1/60 s):  TickInput (from input, bot or recording) ──► sim.step(state, input) ──► SimEvent[]
            │                                                                                    │
            ▼                                                                                    ▼
   world / people / camera read SimState (prev + current,           audio · ui · fx · rumble react to the
   interpolated by the frame's leftover alpha)                       events, never to state diffs they compute
```

### 2.1 Key types (sketch; the frozen files are the source of truth)

```ts
// src/sim/types.ts
export type MissionId = 'phone' | 'vending' | 'pizza' | 'locker' | 'gym' | 'principal';
export type Difficulty = 'freshman' | 'junior' | 'senior';
export type TierId = 1 | 2 | 3 | 4 | 5;
export interface RunConfig { seed: number; mission: MissionId; tier: TierId; difficulty: Difficulty; daily: number | null }

/** One tick of input. Quantized so recordings are tiny and replays exact. */
export interface TickInput {
  moveX: number;          // int −127..127 (quantized stick; keyboard = ±127)
  moveY: number;          // int −127..127, +Y = up on screen
  buttons: number;        // bitfield: SNEAK 1 · SPRINT 2 · INTERACT 4 · THROW 8
}

export interface SimApi {
  create(plan: SchoolPlan, config: RunConfig): SimState;
  /** Advance exactly one tick (SIM_DT = 1/60 s). Pure apart from mutating `state`. */
  step(state: SimState, input: TickInput): readonly SimEvent[];
  /** Stable hash of the whole state, for determinism tests and score verification. */
  hash(state: SimState): number;
}

export type SimEvent =
  | { t: 'noise'; x: number; z: number; radius: number; source: NoiseSource }
  | { t: 'suspicion'; staff: number; level: 'curious' | 'searching' | 'spotted' | 'calm' }
  | { t: 'caught'; staff: number; passUsed: boolean } | { t: 'escortDone'; checkpoint: AnchorId }
  | { t: 'hide'; spot: number; enter: boolean } | { t: 'closeCall'; staff: number }
  | { t: 'pickup'; kind: 'snack' | 'throwable' | 'missionItem'; id: number }
  | { t: 'throw'; from: Vec2; to: Vec2 } | { t: 'pa'; id: PaEventId } | { t: 'checkpoint'; at: AnchorId }
  | { t: 'bell'; secondsLeft: 30 | 10 | 0 } | { t: 'missionStep'; step: number }
  | { t: 'end'; outcome: 'success' | 'detention' | 'timeout'; report: HallReport };
```

```ts
// src/school/types.ts
export interface SchoolPlan {
  seed: number; tier: TierId; mission: MissionId; name: string;     // name from the generator ("Pine Hollow High")
  grid: { cols: number; rows: number; cell: 8 };                    // metres per cell
  rooms: Room[];                    // kind, rect, doors, tags (quiet, echo, safe, outdoor)
  walls: WallSeg[];                 // axis-aligned only: x/z start-end, height class, window flag
  furniture: Furniture[];           // kind, pos, yaw, footprint, tags: cover | lowCover | hide | noisy | throwables
  zones: Zone[];                    // light level (lit | dim), floor (normal | polished | wet), quiet ×2, echo
  anchors: Record<AnchorId, Anchor>;// start desk, checkpoints (bathrooms), mission goal(s), bus loop…
  staff: StaffSpawn[];              // archetype, skin id, route (waypoints + dwell), cone params
  extras: ExtraSpawn[];             // legit students with passes (blend-in, GDD §6.5)
  snacks: Vec2[]; throwables: Vec2[];
  pa: PaEvent[];                    // tick, id, effect
  bellTicks: number;
  referenceRoute: RoutePoint[] | null;   // filled by validate(); null = not validated (never ships)
}
```

## 3. Determinism rules (`src/sim`, `src/school`, `src/core`) — the most important section

1. **Fixed timestep.** `SIM_DT = 1/60` s. The frame loop accumulates real time and calls `step()` 0..4 times per
   frame (it drops time beyond that, so a slow phone runs slower but never diverges). Rendering interpolates between
   the last two states.
2. **No `Math.random()`, no `Date`, no `performance.now()`** inside sim or school. Randomness only from `Rng`
   (`src/core/rng.ts`), seeded from `RunConfig.seed` with a fixed sub-seed per system (`hashInts(seed, SYS_STAFF)`),
   so adding a new random call in one system never shifts another system's numbers.
3. **No transcendental `Math.*` in the state path:** no `sin`, `cos`, `atan2`, `exp`, `pow`, `hypot`. Engines may
   round them differently (V8 vs JavaScriptCore), and a server-side check must match a Safari run bit for bit.
   Use `src/core/fmath.ts` (polynomial `fsin`/`fcos`, `fatan2`, table-based yaw vectors) or plain `+ − × ÷` and
   `Math.sqrt` (which is correctly rounded everywhere). `Math.floor/round/min/max/abs` are fine. Render code may use
   anything.
4. **Stable iteration.** Arrays indexed by spawn order only. No iterating `Map`/`Set` or object keys whose order
   depends on runtime history. Ties in searches break by index.
5. **No reading render, DOM or audio state.** Light level comes from `SchoolPlan.zones`, never from the renderer.
   What the world draws is derived from the plan, not the other way round.
6. **Versioned.** `SIM_VERSION` (an integer in `src/sim/types.ts`) goes up whenever a change alters outcomes.
   Recordings and challenge codes carry it; a mismatched recording plays as "this ghost is from an older version".
7. **Tested.** `tests/sim/determinism.test.ts` replays recorded runs twice and compares `hash()` at every 60th tick,
   and CI runs the same recordings in Node and in Chromium (Playwright) and compares the final hash.

## 4. School generator & validator (`src/school`)

- The generator follows GDD §3 step by step. Each step is its own pure function with its own sub-seed and its own
  tests, and `tools/plan.mjs` prints the result as ASCII so changes can be reviewed without a browser.
- **Walls are axis-aligned** on the 8 m grid (doors and windows are gaps or flags on a segment). This keeps the
  cut-away camera simple (§6), sight raycasts exact (grid DDA) and floor plans readable on the minimap.
- **The validator runs the real sim.** It never re-implements staff logic:
  1. Run `sim.step()` for the whole bell duration with an **absent student** (no noise, never seen), so every
     staff member follows their scheduled behaviour, PA events included. Record each staff pose every 0.25 s.
  2. From those poses, mark every (0.5 m nav cell, 0.25 s step) that any cone or camera can see, using the same
     `sees()` function the sim uses for detection. Dilate by 1 cell and by the difficulty's clearance in time.
  3. A* through (cell, time) for start → goal (with the mission's dwell, e.g. the 6 s vending purchase) → start,
     at sneak or walk speed, waiting allowed, hide spots allowed, no distractions.
  4. Check the GDD §3.1 time budget. Store the route as `plan.referenceRoute`.
- **Budget:** generate + validate in **≤ 400 ms** on a mid-range phone (a Pixel 6a class device) at tier 5. If the
  validator exceeds 250 ms it switches to 1.0 m cells for that seed. Track it with `tests/school/perf.test.ts`.
- On failure: re-roll staff and events (up to 24 times), then rooms (8 more), then the tier's hand-checked fallback
  layout. The re-roll count is part of the plan, so the same seed always ends with the same plan.

## 5. Staff & detection (`src/sim/staff`, `src/sim/detect.ts`)

```ts
// src/sim/staff/types.ts
export type Archetype = 'patroller' | 'sentry' | 'investigator' | 'sweeper' | 'wanderer' | 'snitch' | 'listener';
export interface StaffBrain {
  readonly archetype: Archetype;
  /** Called once per tick before detection. Mutates only its own StaffState. */
  think(self: StaffState, ctx: StaffContext): void;
  /** React to a sim event that concerns this staff member (noise heard, report from the snitch, PA). */
  notify(self: StaffState, ev: StaffNotice, ctx: StaffContext): void;
}
```

- A brain decides **intent** (route target, look target, speed, state). Shared code moves the body along nav paths
  (`findPath` from Bad Hair Day's `world/nav.ts`, moved into `src/sim/nav.ts`) and turns the head toward the look
  target at the archetype's turn rate. Brains never move bodies directly.
- **Skins are not the sim's business.** `StaffSpawn.skin` is a string the sim stores and never reads. New characters
  (substitute teacher, coach) are a `people/` skin plus, at most, new tuning numbers for an existing archetype.
- **One `sees(staff, point, posture)` function** (`src/sim/detect.ts`) decides sight: range, cone angle, occluders
  (walls; low cover only against a sneaking student), light zone. The cone decal on the floor is drawn from
  `visibilityPolygon(staff)` in the same file, at 30 Hz, so **what's drawn is what's tested**.
- Suspicion, noise radii and the 4 s lose-them rule follow GDD §5. Their numbers live in `src/sim/tuning.ts`
  together with the difficulty table (GDD §9). Nothing else hard-codes a gameplay number.

## 6. Camera & world conventions

- Metres, **Y up**, floor y = 0. The school grid starts at the origin and grows toward **+X (east)** and **+Z
  (south)**. Cell (i, j) covers x ∈ [8i, 8i + 8), z ∈ [8j, 8j + 8).
- **Fixed-yaw camera**: it always looks from +Z toward −Z. Default framing is Trash Panda's playtested one (46° pitch,
  12 m, FOV 48°), leading the student's velocity by up to 2 m; the phone test (GDD open question 1) picks the final
  numbers, with Mid (52°, 18 m) and Tactical (60°, 28 m) presets to compare. **The camera never rotates**, so north is always up the screen and the
  minimap matches the view.
- Walls that stand between the camera and the student or a nearby staff member drop to a low height
  (`src/world/school.ts`, 'occlude' mode; Bad Hair Day's whole-south-side cut-away remains as 'cutaway'). Lowered
  walls still block sight in the sim: it's visual only.
- **Characters face their local +Z**; `root.rotation.y = yaw` (0 faces the camera).
- Screen-relative move input with the fixed camera: `worldX = moveX`, `worldZ = −moveY`.
- Lighting is owned by the world: hemisphere + ONE shadow-casting key light (the low afternoon sun) + fake glows for
  fluorescent strips and windows (`aGlow` vertex colours, additive sprites). Dim zones from the plan are rendered
  darker. Nothing else adds real-time lights.

## 7. DOM layering (z-order, bottom → top)

1. `#app > canvas` — WebGL.
2. `#app > .hp-fade` — black fade for transitions (game).
3. `#app > .hp-touch` — touch controls overlay (input): joystick left (inner ring = sneak), buttons right (mirrored
   for left hand). Bottom ~45 % of the screen during play; never covers the top HUD band.
4. `#app > .hp-ui` — HUD (bell timer, suspicion strip, minimap, prompts), captions, banners, menus (ui). HUD in the
   top band (safe-area aware), `pointer-events: none` except buttons. Menus full-screen above everything.

Every layer honours `env(safe-area-inset-*)`. The page never scrolls or zooms (`touch-action: none`).
CSS class prefix **`hp-`** everywhere. User strings (the nickname, a pasted code) → `textContent` only.

## 8. UI kit & look

- Theme tokens as CSS custom properties on `.hp-ui`: `--hp-paper --hp-ink --hp-locker (sage) --hp-brick --hp-cone
  (warm yellow) --hp-alert (red) --hp-goal (electric blue) --hp-ink-soft`.
- Fonts: display **Archivo Black** (titles, banners), UI **Archivo** (condensed widths for the HUD), handwriting
  **Caveat** (teacher remarks on the Hall Report), mono **JetBrains Mono** (bell timer digits, challenge codes).
- Shared classes (`src/ui/styles.css`): `hp-panel` · `hp-btn` / `hp-btn--primary` · `hp-chip` (`data-slot` shows
  the glyph) · `hp-meter` (`--value`) · `hp-tag` · `hp-glyph` · `hp-code` (a challenge code, selectable,
  copy button) · `hp-slip` (detention/report paper).
- The minimap is a 2D canvas drawn from `SchoolPlan` in the style of a fire-evacuation map ("YOU ARE HERE"). Staff
  appear on it only while on screen or alerted.

## 9. Visual style guide (every module that builds geometry)

- **An animated teen sitcom, not a toy box:** clean inked toon (GeoBuilder `inked()`, shared `modelMaterial()` with a
  harder 3-band ramp than Bad Hair Day's), longer proportions (head ≈ 1/4.5 of height), readable silhouettes. Never
  realistic, never childish.
- Colours **only** from `src/render/palette.ts`. School neutrals (sage lockers, terrazzo, brick, cream walls,
  faded school-colour banners) under warm sun and cool fluorescents. Gameplay colours are reserved: cones warm
  yellow → red, mission goal electric blue, interact white ring, safe room mint. Don't use them for decoration.
- Cache geometry (`cachedGeo`), share materials (`markShared()`), dispose the rest (`disposeTree`). Furniture is
  instanced per kind (lockers, desks, chairs: one `InstancedMesh` each).
- **Performance budget** (mid-range phone, 60 fps): ≤ 220 draw calls, ≤ 300 k triangles on screen; characters
  ≤ 8 k tris each, up to 10 staff + 6 extras + the student. Cone decals: one dynamic mesh per visible staff
  member, rebuilt at 30 Hz with no allocations. Quality 'low' drops shadows and cone soft edges.

## 10. Rules for every module

- TypeScript strict; no `any` without a comment explaining why. **No new runtime dependencies** (three only).
- **Only edit files you own** (tree above). Shared contracts (`src/*/types.ts`, `src/core/*`, `src/render/models/*`,
  `src/render/toon.ts`) are frozen. If you truly need a change, describe it in your final report instead. You MAY
  append tokens to `palette.ts`.
- `src/sim` and `src/school` follow §3 with no exceptions, import nothing from `three` (not even math classes;
  use `src/core/math.ts`), and nothing from render, world, people, ui, audio or input. A lint check
  (`tests/arch/imports.test.ts`) fails the build otherwise.
- Every non-trivial pure function gets a Vitest test (`tests/<module>/…`). All your tests pass before you finish
  (`npx vitest run tests/<module>`).
- `npx tsc --noEmit` must be clean for your files (others may be mid-edit — only your files count).
- Verify visually: `node tools/shot.mjs dev/<page>.html shots/<name>.png --until "window.__DEV__ && window.__DEV__.ready"`
  and **look at the PNG**. Any page error = failure. Scratch screenshots go in `shots/` (gitignored). The machine is
  shared by several agents at once — don't leave servers running, and keep screenshot runs sequential.
- Tone (GDD §0): mischief, not malice. No violence, no cruel staff, no real school-safety systems or risk
  behaviours, failure is comedy.

## 11. Where code comes from

| Module | Source | Notes |
|---|---|---|
| `core/rng.ts`, `core/math.ts` | Bad Hair Day (identical in Athlete Mayhem) | Add `fmath.ts` and `code.ts` (new) |
| `input/*` | Bad Hair Day | Add the SNEAK slot (keyboard C/Ctrl, pad L2 or light tilt, touch inner ring) and quantization to `TickInput` |
| `render/models/*`, `render/quality.ts`, `render/toon.ts` | Bad Hair Day | New toon ramp |
| `game/{audioUnlock,device,fade,fullscreen,viewport}.ts` | any (identical in all four) | |
| `world/cutaway.ts`, `cutMaterial.ts` | Bad Hair Day | Generalize from the fixed house layout to `SchoolPlan.walls` |
| `sim/nav.ts`, `sim/collision.ts` | Bad Hair Day `world/nav.ts`, `world/collision.ts` | Move into the sim, apply §3 (no transcendental math) |
| `people/*` | Bad Hair Day `family/*` | Teen proportions, staff outfits, LOCKER cosmetics; no long-hair rig |
| `audio/*` incl. `babble.ts` | Bad Hair Day | New lo-fi stems; intensity layers driven by `suspicion` events |
| `ui/*` (dom, focus, glyphs, hud, screens) | Bad Hair Day / Athlete Mayhem | New theme (§8) |
| Staff state machine, detection, hearing, hiding | Trash Panda Trouble `src/sim/enemies.ts`, `alert.ts`, `player.ts` | Reviewed 2026-10-25. Port the **logic** into `sim/staff/*` and `sim/detect.ts`, not the files: patrol → investigate → notice (a short warning beat before any chase) → chase (give-up timer, leash from home) → search last-known spot → return; a minimum fill rate; catch at close range even from behind; hidden unless within 1.5 m. Its sim uses variable dt and `Math.sin/atan2/hypot`, so everything is rewritten against §3 and the fine grid. |
| Camera framing, occlusion fade | Trash Panda Trouble `src/render/camera/framing.ts`, `world/occlusion.ts` | Its playtested camera (46°, 11 m, FOV 48°) is the grey box's default; `world/school.ts` 'occlude' lowers only the walls that block the student or nearby staff (its fade-what-blocks idea). |
| Fairness validator pattern, bot, headless bundle | Mailbox Mayhem `sim/fairness.ts`, bot; `game-generator/engines/mayhem-run/vite.headless.config.ts` | The time-expanded search is new |
| `tools/shot.mjs`, `tools/walk.mjs` | Bad Hair Day | |

Later, if HALL PASS becomes a `game-generator` engine: `RunConfig` is already the seam a GameSpec would set (school
name, staff names, mission), and `src/share` is where the host bridge would go. Don't build either now.

## 12. Build order (milestones)

| | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | Shared modules copied, stubs for every contract, `npm test` and `tsc` green, a capsule walks a flat floor |
| M1 | **Grey box** | Generator steps 1–5, the cut-away camera on generated plans, capsule staff on routes, sight cones drawn. **Phone test of the camera** (GDD open question 1) before going further. |
| M2 | Validator + bot | Validator + reference route; the bot clears a FRESHMAN run unseen by following it; determinism test passing in Node and Chromium |
| M3 | Stealth | All seven archetypes, suspicion, noise, hiding, distractions, catches, checkpoints, PA events |
| M4 | Missions + flow | Six missions, bell timer, Hall Report, menus, SCHOOL WEEK, DAILY |
| M5 | Art + audio | People, furniture kits, lighting, music layers, SFX, babble, captions |
| M6 | Share | Share card + floor-plan image, challenge codes, ghost recording and replay |
| M7 | Polish | Balance suite green (GDD §12 targets), perf budget on a real phone, e2e, cover art |

Owners work in parallel from M3 on: **school**, **sim**, **world**, **people**, **audio**, **ui**, with
**integration** owning game, render core, input, share, storage, headless and e2e.

## 13. Testing

- `npm test` — Vitest unit tests for every module (fast; runs in CI on every push).
- `tests/sim/determinism.test.ts` — recorded runs replay to identical hashes (§3.7).
- `tests/school/validator.test.ts` — for 200 seeds per tier: every plan validates or falls back, and the bot
  following `referenceRoute` in the real sim is **never spotted** (validator and sim agree).
- `npm run test:balance` — the GDD §12 balance suite (500 seeds × tier × mission × difficulty, bot at target skill).
  Slow; run before tuning changes are merged. `CALIBRATE=1` prints suggested tuning numbers.
- `npm run test:e2e` — Playwright in real Chromium with software WebGL: title → DAILY → autopilot run → Hall
  Report → share card, plus a phone-viewport layout pass.

## 14. Debug hooks / URL params

With `?test=1` (always in dev) the app exposes `window.__HP__` (src/game/debug.ts): `screen()`, `seed()`,
`config()`, `school()` (the SchoolPlan), `staff()` (poses + suspicion), `route()` (the reference route),
`state()`, `hash()`, `autopilot(skill | null)`, `warp(seconds)`, `showCones(bool)`, `showNav(bool)`,
`record()` / `replay(recording)`, `stats()`. URL params: `?mission=phone|vending|pizza|locker|gym|principal`,
`?tier=1..5`, `?seed=N`, `?difficulty=freshman|junior|senior`, `?code=H4L-L22`, `&autostart=1` (jump straight in),
`?quality=auto|high|low`, `?noboot=1`, `?test=1`.

**Challenge codes** (`src/core/code.ts`): 30 bits → 6 characters from a 32-letter alphabet without `0 O 1 I`,
shown as `XXX-XXX`. Layout: seed 22 bits · mission 3 · tier 3 · difficulty 2. A code whose mission or tier is out of
range is rejected with "That code doesn't look right — check it and try again." The DAILY seed is `hashInts(SIM_VERSION, yyyymmdd) & 0x3fffff`.
