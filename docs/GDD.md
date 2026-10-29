# HALL PASS — Game Design Document

> **Three minutes until the bell. No hall pass. One very confiscated phone.**
> *You were never here.*

A browser-based 3D stealth arcade game for teenagers (13–17). The player is a student sneaking around a school
during class — out of the classroom, past hall monitors, teachers, cameras and the vice principal, to pull off one
small mission (get the phone back from the office, make it to the vending machine, be first in line on pizza day)
and get back before the bell. Every school floor is generated from a seed and **proven passable** before it's
played. Short runs (2–4 min), a daily school everyone shares, and challenge codes to send a friend. Procedural 3D
(Three.js, every model built in code), synthesized audio, keyboard + mouse + touch + gamepad. Fifth game on the
browser-arcade shelf (MAILBOX MAYHEM, TRASH PANDA TROUBLE, ATHLETE MAYHEM, BAD HAIR DAY!), same proven stack; the first
one aimed at teens.

Design pillars, in priority order:
1. **Readable stealth** — the player always knows who can see them, who can hear them, and why they got caught.
2. **Fair by construction** — every generated school has a validated unseen route that fits inside the bell timer.
3. **Mischief, not malice** — the fantasy is getting away with something small and harmless, with style.
4. **Short & shareable** — 2–4 minute periods, a daily school, ranks, a share card, challenge codes, ghost races.
5. **Teen-skewing look** — the shelf's inked toon models, under afternoon light and long shadows, with sharp UI.
   Less toy box, more animated sitcom.

---

## 0. Tone rules (non-negotiable — every module)

- **Mischief, not malice.** Every mission is small and harmless: getting your own stuff back, a snack run, a
  birthday note in a friend's locker. Nothing is stolen from anyone, nothing is broken, nobody is hurt.
- **No violence, ever.** The player never hits, trips, locks in or harms staff. Distractions only make noise.
- **Staff are funny, never cruel.** They have comic personalities (the hall monitor who loves his whistle, the vice
  principal with a dramatic coffee mug). Getting caught is a sitcom moment ("Where's your hall pass?") followed by
  being walked back, never a punishment scene.
- **No real school-safety systems or risk behaviours.** No fire alarms, lockdowns, police, weapons, vaping, drugs,
  fights or bullying. Doors, PA chimes and cameras are fine. The snitch is a rival, not a victim.
- **No academics-shaming or appearance jokes.** The comedy comes from the situation, not from people.
- **Failure is comedy.** The worst outcome is a **DETENTION** ending with a funny slip, followed by one-press retry.
- **Player text is data.** The nickname is sanitized and shown with `textContent` only. No chat, no personal data.

## 1. Modes & flow

**Title** (PRESS START, the school at dusk behind) → **Main menu**:
- **DAILY PERIOD** — today's school, mission and staff (date seed, same for everyone). Unlimited attempts; the first
  one is marked on the share card. Results show the daily number (`HALL PASS #61`).
- **SCHOOL WEEK** (career) — five periods Monday → Friday at one generated school, harder each day. Friday is the
  **PRINCIPAL'S OFFICE** finale (§7.6). A week grade at the end. Five schools to clear, unlocked in order (§9).
- **QUICK PERIOD** — random seed, pick a mission type and difficulty.
- **CHALLENGE CODE** — type or paste a code (`H4L-L22`) to play the exact run a friend played (seed + mission +
  difficulty + school tier). Results compare against their score if it was in the code.
- **LOCKER** (cosmetics), **RECORDS**, **HOW TO PLAY**, **SETTINGS**.

Each run: **floor-plan fly-over** (camera sweeps the school, the mission card names the goal, staff glow briefly;
any button skips) → the bell timer starts → play → **outro** (the student slides back into their seat just as the
bell rings, or the detention slip slams down) → **Hall Report** (§8) → RETRY / NEXT / MENU.
**Pause** any time (Esc / Options / pause button): Resume · Restart period · How to play · Settings · Quit.

**As built (M4):** DAILY PERIOD rotates through **all five schools** by date (school = day number mod 5) and the
five everyday missions (not the finale), at JUNIOR, so it really is the same run for everyone; the GDD's "rotates
through the unlocked tiers" would have made it differ per player. Numbering: 2026-09-01 is #1. SCHOOL WEEK plays
FRESHMAN rules Monday–Tuesday and JUNIOR Wednesday–Friday; Monday–Thursday are four of the five everyday missions
(seeded per week), Friday the PRINCIPAL'S OFFICE. The school keeps its name all week, but the floor plan is drawn
per mission (the generator places the mission's room first), so the building changes day to day — a known gap.
CHALLENGE CODE and LOCKER are not in the menu yet (M6 and M5).

## 2. The student (the player — cosmetic only)

One customizable teen, viewed from the 3/4 cutaway camera (§10). Toy-shelf proportions toned down: head ~1/4.5 of
height (the other games are ~1/3.3), longer limbs, so they read as teens, not kids. Nickname (sanitized, 12 chars).
LOCKER options: skin tone, hair (8 styles × colours), hoodie / jacket / tee, backpack, sneakers, headphones, glasses.
All cosmetic; identical gameplay.

Procedural animation states: idle (phone glance, backpack hitch), sneak (crouched, speed-blended), walk, sprint,
hide-enter / hide-exit per hide type, peek (lean at corners), throw, grab, flinch, "busted" freeze, escorted walk,
sit-at-desk, victory slide into the seat. Expressions: neutral, smug, nervous, panicked, relieved.

## 3. The school (procedural floor plans)

One floor per run (two-floor schools with stairwells are a later tier, §9). The school is built on a **grid of
8 m cells** (12 × 8 cells typical) from hand-authored modules + a seed.

**Generator steps** (`src/school/gen/`, pure, deterministic):
1. **Spine:** one or two long main corridors across the grid (straight, L or T).
2. **Branches:** side corridors and dead ends off the spine, until the target corridor length for the tier.
3. **Rooms:** attach rooms to corridor edges by tags and size. Every school has the start classroom, the
   mission room, at least two bathrooms (safe rooms, §6.4), one locker bank per ~3 corridor cells, and 2–4 of:
   library, cafeteria, gym, art room, band room, science lab, trophy hall, courtyard.
4. **Distances:** the mission room must sit 55–80 % of the max path distance from the start classroom.
5. **Furnishing:** desks, lockers, trophy cases, vending machines, cafeteria tables, gym bleachers — each tagged
   as cover, hide spot, noisy floor, or none.
6. **Staff:** place the staff for the tier (§4) and build their patrol routes on the corridor graph.
7. **Events:** schedule 1–3 PA events (§6.6) on the timeline.
8. **Validate** (§3.1). On failure, re-roll steps 6–7 with the next sub-seed (then 3–7). Hard cap 32 tries, then
   fall back to the tier's hand-checked layout so the game always loads.

**Rooms with their own rules:**

| Room | Rule |
|---|---|
| Classroom | A teacher sentry looks out the door window on a cycle. Desks are cover. The start classroom is the checkpoint. |
| Front office | The mission room for PHONE JAIL. A secretary at the desk with a wide, slow cone. The phone is in the drawer behind her. |
| Library | **Quiet zone:** every noise radius ×2. The librarian has sharp ears and no cone, only hearing. |
| Cafeteria | Big and open, tables are low cover (only while sneaking). The lunch staff worker wanders. |
| Gym | Echo: running noise carries across the whole room. Bleachers are hide spots. |
| Bathroom | **Safe room.** Staff never enter. Entering one sets the checkpoint (§6.4). |
| Courtyard | An outdoor shortcut along windows. Every classroom window facing it is a sentry view. |
| Trophy hall | Glass cases are cover with a gap: staff can see you through them at an angle. |

### 3.1 Fairness validator (`src/school/validate.ts`)

With the student unseen and silent, every staff member's movement is a fixed function of time (patrols, seeded
wandering, PA events). The validator runs the staff forward for the whole bell duration and searches a
**time-expanded grid** (0.5 m nav cells × 0.25 s steps, with A*) for a route from the start classroom → mission
goal → start classroom that (details in `docs/ARCHITECTURE.md` §4):
- is never inside any staff vision cone or camera cone, with **≥ 0.6 s clearance** before and after each crossing
  (more on easier tiers);
- uses sneaking speed only through noise-sensitive zones;
- finishes within **70 % of the bell timer** at FRESHMAN, 80 % at JUNIOR, 90 % at SENIOR;
- may use hide spots (waiting is allowed) but **no distractions** (distractions are the player's bonus tool, never
  a requirement).

The found route is stored with the run as the **reference route** and feeds the bot (§12) and the hint system (§11).

## 4. The staff (behaviour archetypes)

Staff are skins over a small set of **behaviour archetypes** — the same idea as Mailbox Mayhem's hazards — so new
characters (summer-school counsellor, substitute teacher) can be added later without touching the sim.

| Archetype | Default character | Behaviour |
|---|---|---|
| **Patroller** | Mr. Dunlap, hall monitor | Walks a fixed loop at walking speed. Narrow, long cone. Stops at set points to check his watch (a 2 s window). |
| **Sentry** | Classroom teachers | Stands in a doorway or at the board. Turns to look into the hall on a seeded rhythm (a head-turn tell 0.8 s before). |
| **Investigator** | Vice Principal Hargrove | Walks between offices. **Hears** noise: walks to the noise source, searches (looks around for 4 s), then returns to the route. Faster than the patroller. |
| **Sweeper** | Security camera | Fixed point, cone sweeps between two angles. A red light means it's live. Cameras never chase; a camera sighting **alerts the nearest investigator** to that spot. |
| **Wanderer** | Ms. Okafor, custodian | Pushes a cart along random corridor segments. The cart is **moving cover**. Leaves wet floor patches behind (noisy, slippery). |
| **Snitch** | Preston, student council | A student with a real hall pass. Wanders. Seeing you sends him running to the nearest adult to report your position (he doesn't chase). |
| **Listener** | The librarian | No vision cone. Hearing only, at double range inside the library. |

**Staff count by tier:** 3–4 at the middle school, up to 8–10 at the academy (§9). Speeds, cone sizes and timings
come from the difficulty table (§9).

## 5. Detection

Every staff member has a **suspicion** value from 0 to 1, shown as a meter over their head:

| Suspicion | State | What it looks like | What they do |
|---|---|---|---|
| 0 | Calm | Nothing | Follow the route |
| > 0 | Curious | **?** filling, yellow | Stop and turn toward the cause |
| ≥ 0.5 | Searching | **?** full, orange | Walk to the last seen or heard spot and look around |
| 1 | Spotted | **!** red, whistle / "HEY!" | **Chase**: walk fast toward you. Contact = caught. |

- **Sight:** suspicion fills while you are inside a cone. It fills faster when you are closer, near the centre of
  the cone, lit, or sprinting. Sneaking halves it, standing still in shadow halves it again. Cones are drawn on the
  floor (soft yellow, red while chasing); dim zones (stairwells, the gym during film class, the hall by the broken
  light) are drawn darker.
- **Sound:** every action has a **noise radius**, drawn as a ring on the floor for a moment: sneak 0 · walk 2 m ·
  sprint 6 m · door opened fast 5 m · locker slam 7 m · wet floor 5 m · distraction landing 8 m. Staff inside the
  radius get suspicion and the search point.
- **Losing them:** break line of sight and then hide, or stay out of sight for 4 s. A chasing staff member searches
  the last seen spot, then goes back to the route.
- **Close calls:** passing within 1.5 m behind staff without being noticed scores **BEHIND YOU** (§8).
- No instant fails. Every catch has a visible build-up through ? and !, so a getting-caught moment can always be
  explained.

## 6. Player verbs

### 6.1 Movement
Camera-relative movement. **Sneak** (hold, or a light stick tilt) is slow and silent. **Walk** is the default.
**Sprint** (hold) is fast and loud, with a short stamina bar so it's a burst, not a mode. Peek: stop next to a
corner and nudge toward it to lean and see around without being seen.

### 6.2 Hiding
**Interact** next to a hide spot: locker (the most common), bathroom stall, under a cafeteria table, behind gym
bleachers, inside a supply closet, behind the custodian's cart (moving). While hidden: a view through the slats,
staff can't see you, and suspicion drains. A searching investigator may open the **one** locker they saw you enter
— hide out of sight to be safe.

### 6.3 Distractions (limited, never required)
Pick up throwables from desks and shelves (max 3 carried): eraser, crumpled paper, a textbook (loud). **Hold
secondary** to aim (an arc preview shows where it lands and the noise ring it'll make), release to throw. Staff in
range investigate the landing spot. Late-game tool: once the phone is recovered in PHONE JAIL, it can be set to play
a ringtone in a locker on a 5 s timer (one use).

### 6.4 Getting caught (the HALL PASS rule)
- Each run starts with **one hall pass** (two at FRESHMAN, none at SENIOR). The first catch auto-flashes it: "Oh —
  carry on." The staff member walks away, the pass is gone, no time lost.
- Without a pass, a catch is **BUSTED**: a short sitcom beat ("Where are we going?"), then the staff member walks
  you back to your **checkpoint** (the last bathroom you entered, or the start classroom). This costs about 8–12 s
  of bell time. The mission item, if already grabbed, stays with you.
- **Three catches = DETENTION.** The run ends with the detention slip ("Reason: wandering. Duration: emotionally,
  forever.") and the Hall Report. Never a lockout.

### 6.5 Blending in
A few legit students with hall passes walk the halls during the run. Walking next to one (within 1.5 m, at walking
speed) halves the sight suspicion from adults. It does not work on the snitch.

### 6.6 PA events (seeded timeline)
1–3 per run, announced by a chime and a babble voice line with a caption:
- "Would Vice Principal Hargrove please come to the main office." The investigator walks to the office (this opens
  a window elsewhere, and closes one near the office).
- "Custodial to the gym, please." The wanderer leaves for the gym.
- "Mr. Dunlap, your car lights are on." The patroller leaves the building for 30 s.
- "Reminder: hats off in the hallway." Nothing happens. A joke.

## 7. Missions

Every mission is **go there, do one thing, come back** before the bell, so a run is always a loop with a clear
second half. All the mission types use the same school generator. Only the goal room, the item and the twist
change.

| # | Mission | Goal | Twist |
|---|---|---|---|
| 7.1 | **PHONE JAIL** | Get your confiscated phone out of the front-office drawer and back to class. | The secretary sits right next to the drawer. Wait for her coffee walk (her schedule shows on the fly-over). |
| 7.2 | **VENDING RUN** | Buy chips from the machine by the gym. | The machine is loud (a 6 s noisy purchase). Pick the moment. |
| 7.3 | **PIZZA DAY** | Be first in line at the cafeteria when the lunch bell rings. | Reverse timer: you can't arrive early (the lunch staff shoos you back), so you hide nearby and dash on the bell. |
| 7.4 | **LOCKER DROP** | Slip a birthday card into your friend's locker across school. | The friend's locker is in the busiest corridor. Bonus for not being seen at all. |
| 7.5 | **GYM BAG** | Get your gym clothes from your own locker before PE. | Your locker is in the gym hallway under a camera. |
| 7.6 | **PRINCIPAL'S OFFICE** (week finale) | Get back the three phones confiscated this week (yours and two friends', who asked you to) from the principal's office. | Three items in three rooms. Hargrove investigates every noise and walks faster each time he spots you. |

Optional per run: **3 snack pickups** (gummy-bear packs) placed off the reference route, for score.

**As built (M4).** Numbers live in `src/sim/tuning.ts` (`MISSION_RULES`) and `src/school/tiers.ts` (`BELL_SECONDS`).
- **PHONE JAIL:** the secretary is a sentry who sits 1.2–2.2 m from the drawer for 18–26 s (the drawer at the
  edge of her cone, her glances sweeping over it), then walks to a coffee spot two corridor cells away for 14–20 s
  and back. The bell is **3:30** (the wait is part of the mission).
- **VENDING RUN:** GRAB at the machine starts a **6 s purchase**: you can't move, it rattles once a second (an
  8 m-ish noise), and walking off or GRAB again cancels it (chips lost, try again).
- **PIZZA DAY:** the lunch bell rings at **45 %** of the 2:30 bell. Before it, coming within 4 m of the counter gets
  you shooed back out of the cafeteria door. Picking up within **12 s** of the lunch bell is **first in line**
  (+500); later still counts as done. Then back to class.
- **LOCKER DROP:** as designed; the "unseen" bonus is the GHOST line.
- **GYM BAG:** one extra camera on the locker strip 2.75–3.5 m from your locker, sweeping past it, at every tier
  (even the middle school, which otherwise has none).
- **PRINCIPAL'S OFFICE:** Hargrove is the first investigator on the roster (added if the school has none). He hears
  at **×2** and walks and chases **+12 %** faster each time he spots you. The bell is **5:00** (three rooms).
- Every twist is inside the fairness validator: the purchase must fit a quiet, unseen 6 s window; the pizza route
  must reach the counter inside the first-in-line window; the secretary, the gym camera and Hargrove's ears are
  simply part of the simulated staff.

## 8. Scoring — the Hall Report

The Hall Report is styled as a school report card:

| Line | Points |
|---|---|
| Mission complete | 1000 |
| Bell time left | 20 / s |
| Never spotted (no ! all run) | **GHOST** 1500 |
| Hall pass unused | 300 |
| BEHIND YOU close calls | 150 each |
| Snack pickups | 100 each |
| Distractions that pulled staff off you | 100 each |
| Caught (busted) | −400 each |
| Difficulty multiplier | FRESHMAN ×0.8 · JUNIOR ×1.0 · SENIOR ×1.3 |

**As built (M4):** "Hall pass unused" is a flat 300 when you started with any; PIZZA DAY adds **First in line +500**.
Par is the perfect bot's raw score (before the multiplier) on the reference route of the school you play (it is
computed in the generator worker). Grade = raw ÷ par: **A+ ≥ 0.97 · A ≥ 0.85 · B ≥ 0.70 · C ≥ 0.50**, else D;
a run that doesn't finish is always D. Collecting snacks or close calls can beat par.

**Grade** from the score against the run's **par** (set per seed by the bot's run of the reference route at JUNIOR):
A+ / A / B / C / D, plus the four **ranks** shown big: **GHOST** (never spotted, never caught) · **SMOOTH** (spotted,
never caught) · **CLOSE CALL** (caught at least once, mission done) · **DETENTION** (three catches or out of time).
Then 1–3 funny **remarks** chosen from what happened, in teacher's handwriting: *"Excellent hiding. Concerning
amount of hiding."* · *"Spent 40 s in a locker. Called it 'thinking time'."* · *"Was seen by the camera 3 times.
Waved once."* · *"Got PIZZA DAY first in line. Showed no remorse."*

### 8.1 Share card
Plain text plus a small picture of the floor plan with the player's path drawn on it:
```
HALL PASS #61  ·  Westbrook High  ·  JUNIOR
PHONE JAIL  ·  2:41  ·  spotted 0×  ·  GHOST  ·  A+
H4L-L22
```
The code at the bottom is the challenge code (§1).

### 8.2 Ghost races
The game records the **inputs** of your best run per seed (the sim is deterministic, so a few KB is enough) and
replays it as a see-through **ghost** student. It's local only in v1. Online ghosts and leaderboards would need a
server that re-runs submitted inputs headlessly to verify the score (§13).

**As built (M6).**
- **Challenge codes** (`src/core/code.ts`): `XXX-XXX`, 30 bits (seed 22 · mission 3 · tier 3 · difficulty 2) in a
  32-letter alphabet without 0 O 1 I; an optional score after a second dash (`23A-9V7-5220`) is the score to beat.
  Main menu → CHALLENGE CODE (type or paste; a bad code gets "That code doesn't look right — check it and try
  again."), or open the game with `?code=`. A DAILY's code replays the same school but isn't marked as the daily.
- **Share** (Hall Report → SHARE): the three-line text (§8.1) with the code, and a 640 px evacuation-map picture —
  corridors, walls, YOU ARE HERE at your desk, the goal(s) in blue, your route in red, an X where you were busted.
  COPY TEXT, SAVE PICTURE, and SHARE… where the device has a share sheet. Nothing is sent anywhere by the game.
  No nickname yet (that comes with LOCKER).
- **Ghosts**: every run's inputs are recorded (run-length encoded; a few KB for keyboard play, more for analog
  sticks). A successful run that beats your best on that exact school (seed + school + mission + difficulty) is kept
  as its ghost — 12 schools at most, oldest dropped. Playing that school again (RETRY, a challenge code, the same
  DAILY) races a see-through copy of you, replayed in a second sim. The mission card and the report say so.
  Settings → Ghost races turns it off. Ghosts are local only (open question 3 stays open).

## 9. Difficulty & progression

| | FRESHMAN | JUNIOR | SENIOR |
|---|---|---|---|
| Vision cones on the floor | full | full | faint (only when you're near) |
| Suspicion fill rate | ×0.6 | ×1.0 | ×1.4 |
| Staff walk speed | ×0.85 | ×1.0 | ×1.15 |
| Head-turn tell | 1.2 s | 0.8 s | 0.5 s |
| Hall passes | 2 | 1 | 0 |
| Validator clearance / time budget | 1.0 s / 70 % | 0.6 s / 80 % | 0.4 s / 90 % |
| Score multiplier | ×0.8 | ×1.0 | ×1.3 |

**School tiers** (SCHOOL WEEK ladder; DAILY rotates through the unlocked tiers):
1. **Maple Middle** — one floor, 3–4 staff, no cameras.
2. **Westbrook High** — adds cameras and the snitch.
3. **Lakeview High (Spirit Week)** — decorations block sight lines, a pep-rally PA event.
4. **St. Rigid's Academy** — strict private school: cameras everywhere, two investigators, polished noisy floors.
5. **Summer School** — half the lights off, a lone substitute teacher, a custodian everywhere. Two floors.

School names on the DAILY come from a name generator (place + mascot: "Pine Hollow High, Home of the Owls"). Never
real schools.

**Unlocks** (local save): XP from every run, even a detention, unlocks LOCKER cosmetics and new mission types.
Clearing a school week with an A average unlocks the next tier and its signature hoodie.

## 10. Presentation

- **Cutaway 3/4 camera** (Bad Hair Day's dollhouse approach): about 55° pitch, no ceilings, walls cut away toward
  the camera, so you can see into the rooms and around corners at once. The camera leads slightly ahead of the
  movement direction and pulls out a little while you're hiding.
- **Light:** late-afternoon sun through classroom windows in long gold bars, cooler fluorescent corridors, dim
  stairwells. Light level is part of detection (§5), so the lighting is gameplay, not just mood.
- **Palette:** sage-green lockers, terrazzo floors, brick, faded school-colour banners. Vision cones in warm yellow,
  alerts in red, mission markers in electric blue. No toy-box candy colours.
- **UI:** sharp and modern: a bell timer like a lock-screen clock, suspicion meters, a minimap shaped like the
  school's fire-evacuation map ("YOU ARE HERE"). Captions for every voice line.
- **Juice:** slow-motion near misses, a record-scratch freeze on BUSTED, a locker-door rattle when staff walk past
  your hide, the bell ringing as you slide into your seat, a confetti burst of report-card stars.
- **Title / cover:** the school at golden hour, a long shadow of the student sneaking past a hall monitor's cone.
  Rendered from the game's own scene into `public/cover-art.jpg`.

## 11. Hints & accessibility

- **Hints** (Settings, on by default at FRESHMAN): after 20 s without progress, footprints from the reference route
  fade in for the next stretch.
- **Accessibility:** cone colours chosen to read under the common colour-vision deficiencies (shape and pattern
  carry state too: dotted = curious, solid = chasing); reduced motion (no slow-motion, gentler camera);
  hold-to-toggle for sneak and sprint; adjustable game speed (0.8× / 1.0×) that marks the run but keeps it
  scoreable; full captions.

## 12. Bot & testing

- **Bot** (`src/sim/bot.ts`): plays through `GameControls` like a player. It follows the validator's reference route,
  reacts to deviations (waits at hide spots, re-plans when an investigator moves), and has a skill dial (reaction
  time and how much clearance it insists on). Used for the attract mode on the title screen, for setting par per
  seed, and in CI.
- **CI balance:** for each school tier × mission × difficulty, the bot at the target skill clears **≥ 95 %** of
  500 seeds at FRESHMAN, **≥ 85 %** at JUNIOR, **≥ 70 %** at SENIOR. A cheaper headless check runs the validator on
  10,000 seeds per tier for re-roll rates and fallback counts.
- **Headless sim:** the sim (generator, staff AI, detection, scoring) is pure and runs in Node with no DOM, ~500×
  realtime target, so a run can be re-checked from its inputs (§8.2).
- **Visual QA:** `tools/shot.mjs` and `tools/walk.mjs` as in the other games; debug hooks on `window.__HP__`
  (`seed()`, `school()`, `staff()`, `route()`, `autopilot(skill)`, `warp(seconds)`, `showCones(bool)`).
  URL params: `?mission=phone|vending|pizza|locker|gym|principal`, `?tier=1..5`, `?seed=N`,
  `?difficulty=freshman|junior|senior`, `?code=H4L-L22`, `?test=1`.

## 13. Platform

Static site (Netlify), no backend, no accounts in v1. Desktop + mobile, **phone first** (landscape preferred,
portrait works with a taller camera). 60 fps target on mid-range phones (quality governor). Save data in
localStorage (records, cosmetics, ghosts). A later server (leaderboards, online ghosts) re-runs submitted inputs
headlessly before accepting a score. For players aged 13–17 there is no chat and no free text anyone else sees
apart from the nickname on a share card the player chooses to send.

## 14. Audio

All synthesized at runtime (Web Audio):
- **Music:** a lo-fi beat that layers up with the highest suspicion on screen (calm → hi-hats → bass → full chase
  stem), a tense two-chord sting on the fly-over, a triumphant brass hit plus the bell on success, a sad trombone
  on DETENTION.
- **SFX:** squeaky sneakers (louder on wet and polished floors), locker clangs and rattles, doors, the vending
  machine, the whistle, the camera's servo whine, the PA chime, the school bell, paper and eraser landings, the
  phone ringtone decoy.
- **Voices:** babble voices per staff member (pitch and timbre per character) with captions: "HEY!", "Hm?",
  "Where's your hall pass?", Hargrove's "Not on my watch."

**As built (audio, part of M5).** Everything is synthesized at runtime (`src/audio`; engine, mixer, instruments and
QA harness copied from ATHLETE MAYHEM, the songs, effects, voices and ambience new):
- **Music:** four original tracks — "Hall Pass" (title, swung G-minor caper), "Free Period" (menus, lo-fi),
  "Out of Class" (the run) and "Report Card" (the Hall Report jingle and loop). The run track has three layers
  chosen by the most alarmed staff member on screen: calm (walking bass, ticking hats, e-piano) → curious (groove
  drums, chip melody, arps) → spotted / chase (four-on-the-floor, chugging guitar, brass, +16 BPM); the last 20 s
  of the bell hold it at least at the middle layer. The mission card plays a tense two-chord sting over silence.
- **SFX:** sneaker steps and sprint squeaks (louder on polished floors; sneaking is a soft pad), locker doors and
  creaks, eraser toss and landing, pick-ups and snacks, "?" and "!" stings, the hall monitor's whistle when a
  patroller gives chase, a record scratch for BUSTED, the hall-pass flash, the camera's servo and beeps, the PA
  ding-dong with a babbled announcement through a telephone-band filter, the school bell, a tick-tock at 30 s and
  10 s, the lunch bell, the vending machine (whir, a rattle every second, the clunk, coins back on a cancel), a
  brass hit + bell on success and a sad trombone on DETENTION. Staff sounds are panned and quieter with distance.
- **Voices:** babble (formant blips) per character — "Hey!", "Hm?", "Where are we going?", "Oh — carry on.",
  Preston's tattle, the lunch staff's "Not yet" — each person with their own pitch (Hargrove low, Preston high).
- **Ambience:** fluorescent hum, classes murmuring through the walls, HVAC, and now and then a far locker slam, a
  door, a teacher's voice, a chair scrape or a cough. Hiding muffles the world (music and ambience low-passed).
- Settings has Music and Sound-effect volumes; M mutes. Not built: the phone-ringtone decoy (there is no phone
  decoy item) and wet floors.

## 15. Controls

| Action | Keyboard | Gamepad (PS / Xbox) | Touch |
|---|---|---|---|
| Move | WASD / arrows | left stick / D-pad | virtual joystick |
| Sneak (hold) | C (or Ctrl) | light stick tilt, or L2 / LT | joystick inner ring |
| Sprint (hold) | Shift (or L) | R2 / RT | small button (hold) |
| Interact / hide / grab | Space (or J) | Cross / A | big button |
| Aim and throw (hold, release) | E (or K) | Circle / B, Square / X | small button (drag to aim) |
| Pause | Esc / P | Options / Start | pause button |
| Menus | arrows + Enter/Space, Esc back | D-pad/stick + Cross, Circle back | tap |

Every prompt shows the right glyph for the active device (from the shared input stack).

## 16. Build plan & reuse

Module ownership and frozen contracts go in `docs/ARCHITECTURE.md`, following the format of the other four games.
Expected reuse:

| Area | Source | Notes |
|---|---|---|
| core (seeded RNG, math), input stack, UI kit, storage, quality governor, viewport, audio unlock | any of the four games (identical or near-identical) | Take the newest copy (Bad Hair Day) |
| Character rig, faces, babble voices, emotes | Bad Hair Day `src/family/`, `src/audio/babble.ts` | Re-proportion for teens (§2) |
| Cutaway camera, wall cut-away materials, nav paths, collision | Bad Hair Day `src/world/cutaway.ts`, `cutMaterial.ts`, `nav.ts`, `collision.ts` | The core of the stealth camera (§10) |
| Stealth AI, alert meters, guard roles, hide spots | Trash Panda Trouble | **Not reviewed yet** — the repo isn't on GitHub. Check before committing to this estimate. |
| Fairness validator idea, bot + headless sim pattern | Mailbox Mayhem `sim/fairness.ts` and bot | The time-expanded search (§3.1) is new code |
| Synth music engine and SFX | any of the four games | New lo-fi stems with suspicion layering |
| New code | — | floor-plan generator, staff archetypes, detection model, time-expanded validator, missions, Hall Report, challenge codes, ghost recording |

## 17. Open questions

1. Does the **cutaway camera** stay readable on a phone at the academy tier's 8–10 staff? Prototype it with
   grey boxes before any art.
2. Should **PIZZA DAY**'s reverse timer stay? It plays differently from the other missions. Test it with players.
3. Should the **ghost** of a friend's run travel inside the challenge code (it would make codes much longer), or
   wait for the server?
4. How much of Trash Panda's stealth code really carries over? Push the repo to GitHub and check.
5. Playtest with a few teenagers before art lock: do they read it as "for us" or "for kids"?
