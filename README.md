# HALL PASS

> *Three minutes until the bell. No hall pass. One very confiscated phone.*

A procedural 3D browser stealth arcade game for teens (13–17), and the fifth game on the browser-arcade shelf
(MAILBOX MAYHEM, TRASH PANDA TROUBLE, ATHLETE MAYHEM, BAD HAIR DAY!). It uses the same stack: Vite + TypeScript +
Three.js, every model and sound procedural, no backend.

- Design: [`docs/GDD.md`](docs/GDD.md). Modules, contracts, determinism rules, build order:
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Status: grey box (milestones M0 + M1)

What works:

- **School generator** (`src/school`): corridor spine and branches, rooms, the mission room 55–80 % of the way across
  the school, a 0.5 m movement/sight grid with walls, 5 m halls with locker banks and doors, furniture, goals,
  checkpoints, dim/quiet/echo zones, and staff routes for all seven archetypes. Deterministic per seed; every plan
  is checked for reachability (3,000 plans in the tests, no fallbacks needed).
- **Simulation** (`src/sim`): fixed 60 Hz, replays bit for bit (tested). Student movement and collision, sneak and
  sprint, route-following staff, vision cones blocked by walls (and by desks when you sneak), suspicion, the hall
  pass, BUSTED (walked back to your checkpoint, 10 s lost), DETENTION after 3 catches, mission pickups, the bell.
- **Grey-box view** (`src/world`, `src/game`): the fixed-yaw cut-away camera, capsule people, cone decals drawn from
  the same rays the sim tests, ?/! markers, a HUD and a tuning panel.

Not yet (later milestones): the fairness validator and bot (M2); chasing, noise, hiding, distractions, PA
announcements (M3); menus, Hall Report, SCHOOL WEEK, DAILY (M4); real art and audio (M5); share cards, codes, ghosts
(M6). Until chasing exists, a full suspicion meter counts as being caught.

## Run it

```bash
npm install
npm run dev            # http://localhost:5195
npm test               # Vitest
npm run plan -- --seed 42 --tier 2 --mission phone   # ASCII floor plan of a seed
npm run build
```

Controls (grey box): WASD/arrows or the left stick to move, **hold E** (or the SNEAK button) to sneak, a light stick
tilt also sneaks, **hold Shift** (or SPRINT) to sprint, **Space** (or GRAB) to pick up the goal. Esc or ⚙ opens the
tuning panel. Sneak sits on the secondary slot for now; the GDD's dedicated sneak key (C/Ctrl, L2) comes with the
input changes in M3.

URL params: `?seed=N&tier=1..5&mission=phone|vending|pizza|locker|gym|principal&difficulty=freshman|junior|senior`,
camera `&pitch=60&dist=28&fov=40&walls=cutaway|low|full&cones=0`, `?quality=auto|high|low`, `?test=1` exposes
`window.__HP__` in production builds.

## The phone test (GDD open question 1)

Is the fixed cut-away camera readable on a phone with a crowded school? On your PC:

```bash
npm run dev -- --host  # prints a Network URL like http://192.168.1.20:5195
```

Open that URL on your phone (same Wi-Fi), hold it in landscape and play. Try tier 4 (the academy, 11 staff).
Open ⚙ to change the camera pitch, distance, field of view, wall mode (cut-away / low / full) and cones, live.
Note the numbers that feel best.

Screenshots: `node tools/shot.mjs "/?test=1&seed=11&tier=4" shots/x.png --mobile --w 844 --h 390`.

Not deployed. Publishing (Netlify) needs Chris's explicit approval each time.
