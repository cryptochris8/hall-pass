// ─────────────────────────────────────────────────────────────────────────────
// HALL PASS app (integration): the game flow (docs/GDD.md §1) around the
// fixed-timestep sim.
//
//   title (the bot plays an attract run behind it) → main menu → DAILY PERIOD /
//   SCHOOL WEEK / QUICK PERIOD → "Building the school…" → mission card over a
//   fly-over → play (pause any time) → outro → Hall Report → RETRY / NEXT / MENU.
//
// Frame loop (docs/ARCHITECTURE.md §2–3):
//   input.update → controls (or the bot) → TickInput (quantized) → accumulate
//   real time → sim.step() 0..4 times at 1/60 s → world/actors read state
//   (interpolated by the leftover alpha) → camera → render → HUD.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { createAudio } from '../audio';
import type { AudioEngine } from '../audio/types';
import { BAD_CODE, decodeCode, encodeCode } from '../core/code';
import { clamp } from '../core/math';
import { hashInts } from '../core/rng';
import { createInput, type InputManager } from '../input';
import { GameRenderer, detailTier } from '../render/renderer';
import { PAL } from '../render/palette';
import { lookFor } from '../people';
import type { PersonLook } from '../people/types';
import type { Quality } from '../render/types';
import { MISSION_IDS, planSize, type Difficulty, type MissionId, type SchoolPlan, type TierId } from '../school/types';
import { createSim, hideFront, missionGoals, step, BTN_INTERACT, BTN_SNEAK, BTN_SPRINT, BTN_THROW, SIM_DT, SIM_HZ, type RunConfig, type SimEvent, type SimState, type TickInput } from '../sim';
import { createBot, type Bot } from '../sim/bot';
import { hallReport, type HallReport } from '../sim/score';
import { DIFFICULTY, HIDE, MISSION_RULES, RULES, THROW, lunchTick } from '../sim/tuning';
import { drawFloorPlan, planPicture, shareText } from '../share/card';
import { Player, Recorder, type Recording } from '../share/ghost';
import { dailyStreak, GhostStore, ghostKey, recordRun, Store, type CameraPreset } from '../storage';
import { Ui, el, type Item, type ScreenSpec } from '../ui';
import { helpGrid, missionCard, reportCard, table } from '../ui/screens';
import { DIFFICULTY_NAME, DIFFICULTY_NOTE, GOAL_LINE, MISSION_NAME, TIER_NAME, TIER_NOTE, clock } from '../ui/text';
import { buildSnacks, buildStealthFx, type SnackView, type StealthFx } from '../world/fx';
import { buildGhost, type GhostView } from '../world/ghost';
import { buildActors, takeSnapshot, type ActorsView, type Snapshot } from '../world/actors';
import { buildSchoolView, type SchoolView, type ViewPoints, type WallMode } from '../world/school';
import { installAudioUnlock } from './audioUnlock';
import { renderDpr } from './device';
import { Hud, type CameraSettings } from './hud';
import { BACKPACK, HAIR_COLOUR, HAIR_STYLE, HOODIE, lockReason, nextXpUnlock, NICK_MAX, PANTS, sanitizeLook, sanitizeNickname, SKIN, SNEAKERS, unlocked, type Option } from './locker';
import { civilDay, dailyConfig, dailyNumber, todayKey, unlocksNext, weekConfig, weekGrade, weekPlan, WEEKDAYS } from './modes';
import { Schools, type BuiltSchool } from './schools';
import { SoundDirector, type SoundScreen } from './sound';
import { installViewport } from './viewport';

export interface AppParams {
  seed: number | null;
  tier: TierId | null;
  mission: MissionId | null;
  difficulty: Difficulty | null;
  quality: Quality | null;
  camera: Partial<CameraSettings>;
  debug: boolean;
  /** Skip the title and the mission card: straight into a run (tests, screenshots). */
  autostart: boolean;
  /** ?code= — open straight into that challenge. */
  code: string | null;
}

const MAX_STEPS = 4;
const OUTRO_SECONDS = 1.8;
const FLYOVER_SECONDS = 4.5;

const PA_LINES: Record<'vpToOffice' | 'custodialToGym' | 'carLights' | 'hatsOff', string> = {
  vpToOffice: '"Would Vice Principal Hargrove please come to the main office."',
  custodialToGym: '"Custodial to the gym, please."',
  carLights: '"Mr. Dunlap, your car lights are on."',
  hatsOff: '"Reminder: hats off in the hallway."',
};

/** Short HUD goal per mission (the full sentence is on the mission card). */
const HUD_GOAL: Record<MissionId, string> = {
  phone: 'Get your phone from the front-office drawer',
  vending: 'Buy chips from the machine by the gym',
  pizza: 'Be first in line at the cafeteria counter',
  locker: "Drop the card in your friend's locker",
  gym: 'Grab your gym bag from your locker by the gym',
  principal: "Get the 3 phones (principal's office, front office, a classroom)",
};

const CAMERA_PRESETS: Record<CameraPreset, Pick<CameraSettings, 'pitch' | 'distance' | 'fov'>> = {
  close: { pitch: 46, distance: 12, fov: 48 },
  mid: { pitch: 52, distance: 18, fov: 45 },
  tactical: { pitch: 60, distance: 28, fov: 40 },
};

type Mode =
  | { kind: 'daily'; day: number }
  | { kind: 'week'; tier: TierId; seed: number; day: number }
  | { kind: 'quick' }
  | { kind: 'challenge'; score: number | null }
  | { kind: 'attract' };

/** The ghost race: a second sim fed your best run's inputs, drawn see-through. */
interface GhostRun {
  sim: SimState;
  player: Player;
  view: GhostView;
  score: number;
  px: number;
  pz: number;
}
type Phase = 'boot' | 'title' | 'menu' | 'loading' | 'intro' | 'playing' | 'paused' | 'outro' | 'report';

export class App {
  private readonly renderer: GameRenderer;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly ui: Ui;
  private readonly store = new Store();
  private readonly schools = new Schools();
  private readonly ghosts = new GhostStore();
  /** Inputs of the run in progress (null for attract runs). */
  private recorder: Recorder | null = null;
  private lastRecording: Recording | null = null;
  /** The route for the share card: [x, z, …] every quarter second, and where you got busted. */
  private path: number[] = [];
  private busts: number[] = [];
  private ghost: GhostRun | null = null;
  private reportScreen: ScreenSpec | null = null;
  private codeDraft = '';
  /** LOCKER is open: the attract run holds still and the camera frames the student. */
  private lockerOpen = false;
  private codeError: string | null = null;
  private readonly audio: AudioEngine;
  private readonly sound: SoundDirector;
  private readonly unlockOff: () => void;
  private readonly lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight };
  private plan: SchoolPlan | null = null;
  private par = 0;
  private config: RunConfig = { seed: 1, tier: 1, mission: 'phone', difficulty: 'junior', daily: null };
  private mode: Mode = { kind: 'attract' };
  private phase: Phase = 'boot';
  private sim: SimState | null = null;
  private view: SchoolView | null = null;
  private actors: ActorsView | null = null;
  private fx: StealthFx | null = null;
  private snacks: SnackView | null = null;
  private prev!: Snapshot;
  private acc = 0;
  private last = 0;
  private clockT = 0;
  private raf = 0;
  /** The bot at the wheel: attract runs, and ?test autopilot. */
  private bot: Bot | null = null;
  private autopilot: number | null = null;
  private phaseT = 0;
  private report: HallReport | null = null;
  private loadId = 0;
  private readonly tick: TickInput = { moveX: 0, moveY: 0, buttons: 0 };
  readonly camera: CameraSettings = { pitch: 46, distance: 12, fov: 48, walls: 'occlude', cones: true };
  private readonly shadows: boolean;
  private readonly v = new THREE.Vector3();
  private readonly proj = { x: 0, y: 0, visible: false };
  private lastEvents: SimEvent[] = [];
  private readonly lead = new THREE.Vector2();
  private readonly viewPts: ViewPoints = { camX: 0, camY: 0, camZ: 0, points: new Float32Array(3 * 16), count: 0 };
  /** QUICK PERIOD picks (remembered for the session). */
  private quick: { mission: MissionId; tier: TierId; difficulty: Difficulty };
  private attractN = 0;
  private resetArmed = false;

  constructor(private readonly root: HTMLElement, private readonly params: AppParams) {
    const quality = params.quality ?? 'auto';
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    // Shadows are the strongest depth cue; only an explicit ?quality=low turns them off (1024² map on phones).
    this.shadows = quality !== 'low';
    const bigShadows = detailTier(quality, touch) === 'high';
    this.renderer = new GameRenderer(root, quality);
    this.renderer.scene.background = new THREE.Color(PAL.skyTop);
    const set = this.store.data.settings;
    Object.assign(this.camera, CAMERA_PRESETS[set.camera], { walls: set.walls, cones: set.cones }, params.camera);

    // A strong low sun over a weaker fill: walls and people get a lit side, a shaded side and long shadows.
    const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.05);
    const sun = new THREE.DirectionalLight(PAL.sun, 2.4);
    sun.castShadow = this.shadows;
    sun.shadow.mapSize.set(bigShadows ? 2048 : 1024, bigShadows ? 2048 : 1024);
    const sc = sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 120;
    sun.shadow.bias = -0.0006;
    this.renderer.scene.add(hemi, sun, sun.target);
    this.lights = { hemi, sun };

    // Audio: every activating gesture unlocks it while it's locked (phones need the end of a tap).
    this.audio = createAudio();
    this.sound = new SoundDirector(this.audio);
    this.unlockOff = installAudioUnlock(window, this.audio);
    this.applyVolumes();

    this.input = createInput({ touchRoot: root });
    this.input.onFirstGesture(() => this.audio.unlock());
    this.input.setMode('menu');
    this.input.setScheme({
      move: 'xy',
      moveLabel: 'MOVE',
      primary: { label: 'GRAB', icon: 'hand' },
      secondary: { label: 'THROW', icon: 'toss' },
      alt: { label: 'SPRINT', icon: 'run', hold: true },
    });

    this.hud = new Hud(
      root,
      {
        newRun: (c) => this.play({ kind: 'quick' }, { ...this.config, ...c, daily: null }),
        camera: (c) => Object.assign(this.camera, c),
        pause: (on) => {
          if (on && this.phase === 'playing') this.setPhase('paused');
          else if (!on && this.phase === 'paused' && !this.ui.visible) this.resume();
        },
        menu: () => this.pause(),
      },
      params.debug,
    );
    this.hud.root.hidden = true;
    this.ui = new Ui(root);
    this.ui.sound = (k) => this.audio.play(k === 'move' ? 'uiMove' : k === 'confirm' ? 'uiConfirm' : 'uiBack');

    const unlocked = this.store.data.unlocked;
    this.quick = {
      mission: params.mission ?? 'phone',
      tier: (params.tier !== null ? Math.min(params.tier, params.debug ? 5 : unlocked) : 1) as TierId,
      difficulty: params.difficulty ?? 'junior',
    };

    installViewport(root, window, (size) => this.renderer.resize(size.w, size.h, renderDpr(size.dpr, size.w, size.h, touch, quality)));
    if (params.autostart) {
      const c: RunConfig = {
        seed: params.seed ?? ((Math.random() * 0x3fffff) >>> 0),
        tier: params.tier ?? 1,
        mission: params.mission ?? 'phone',
        difficulty: params.difficulty ?? 'junior',
        daily: null,
      };
      this.play({ kind: 'quick' }, c);
    } else if (params.code !== null) {
      const c = decodeCode(params.code);
      this.showTitle();
      this.startAttract();
      if (c) this.playCode(c);
      else {
        this.codeDraft = params.code.slice(0, 16);
        this.codeError = BAD_CODE;
        this.showCode();
      }
    } else {
      this.showTitle();
      this.startAttract();
    }
  }

  // ── flow ─────────────────────────────────────────────────────────────────

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseT = 0;
    const menus = p === 'title' || p === 'menu' || p === 'loading' || p === 'intro' || p === 'paused' || p === 'report' || p === 'outro';
    this.input.setMode(menus ? 'menu' : 'gameplay');
    this.input.reset();
    const run = this.mode.kind !== 'attract';
    this.hud.root.hidden = !run || p === 'title' || p === 'menu' || p === 'loading';
    if (p !== 'boot') this.sound.setScreen(p as SoundScreen, run);
  }

  private applyVolumes(): void {
    const s = this.store.data.settings;
    this.audio.setVolumes({ master: 1, music: s.music, sfx: s.sfx });
    this.audio.setMuted(s.muted);
  }

  private showTitle(): void {
    this.setPhase('title');
    this.ui.show({
      id: 'title',
      layout: 'title',
      clear: true,
      subtitle: 'Three minutes until the bell. No hall pass. One very confiscated phone.',
      body: [el('div', 'hp-press', 'PRESS START')],
      items: [],
      onAny: () => this.showMain(),
    });
  }

  private showMain(focus = 0): void {
    if (this.mode.kind === 'attract' || this.phase === 'report') this.ensureAttract();
    this.setPhase('menu');
    const save = this.store.data;
    const today = todayKey();
    const daily = dailyConfig(today);
    this.schools.prefetch(daily);
    const d = save.daily[String(today)];
    const w = save.week;
    const weekSub = w && w.day < 5 ? `Continue: ${WEEKDAYS[w.day]} · ${MISSION_NAME[weekPlan(w.seed)[w.day]!.mission]} · ${TIER_NAME[w.tier]}` : 'Five periods, one school, Monday to Friday';
    this.ui.show({
      id: 'main',
      kicker: 'Main menu',
      title: 'Where to?',
      clear: true,
      items: [
        {
          kind: 'button',
          label: `DAILY PERIOD #${dailyNumber(today)}`,
          sub: `${MISSION_NAME[daily.mission]} · ${TIER_NAME[daily.tier]} · same school for everyone today`,
          right: d ? `${d.best.grade} · ${d.best.score}` : 'NEW',
          primary: true,
          onPick: () => this.play({ kind: 'daily', day: today }, daily),
        },
        { kind: 'button', label: 'SCHOOL WEEK', sub: weekSub, right: `School ${save.unlocked}/5`, onPick: () => this.showWeek() },
        { kind: 'button', label: 'QUICK PERIOD', sub: 'Random school · pick the mission and difficulty', onPick: () => this.showQuick() },
        { kind: 'button', label: 'CHALLENGE CODE', sub: "Play the exact run a friend played", onPick: () => this.showCode() },
        { kind: 'button', label: 'LOCKER', sub: `Your look and nickname · ${save.totals.xp} XP`, onPick: () => this.showLocker() },
        { kind: 'button', label: 'RECORDS', sub: 'Best grades, streaks, weeks cleared', onPick: () => this.showRecords() },
        { kind: 'button', label: 'HOW TO PLAY', onPick: () => this.showHelp(() => this.showMain(6)) },
        { kind: 'button', label: 'SETTINGS', onPick: () => this.showSettings(() => this.showMain(7)) },
      ],
      focus,
      onBack: () => this.showTitle(),
    });
  }

  private showQuick(focus = 0): void {
    const q = this.quick;
    const unlocked = this.params.debug ? 5 : this.store.data.unlocked;
    const tiers = ([1, 2, 3, 4, 5] as TierId[]).filter((t) => t <= unlocked);
    this.ui.show({
      id: 'quick',
      kicker: 'Quick period',
      title: MISSION_NAME[q.mission],
      subtitle: `${GOAL_LINE[q.mission]}.`,
      clear: true,
      items: [
        {
          kind: 'choice',
          label: 'Mission',
          options: MISSION_IDS.map((m) => ({ value: m, label: MISSION_NAME[m] })),
          value: q.mission,
          onChange: (v) => {
            q.mission = v as MissionId;
            this.showQuick(0);
          },
        },
        {
          kind: 'choice',
          label: 'School',
          sub: `${TIER_NOTE[q.tier]}${unlocked < 5 ? ' · clear a SCHOOL WEEK with an A to unlock the next' : ''}`,
          options: tiers.map((t) => ({ value: String(t), label: TIER_NAME[t] })),
          value: String(q.tier),
          onChange: (v) => {
            q.tier = Number(v) as TierId;
            this.showQuick(1);
          },
        },
        {
          kind: 'choice',
          label: 'Difficulty',
          sub: DIFFICULTY_NOTE[q.difficulty],
          options: (['freshman', 'junior', 'senior'] as const).map((d) => ({ value: d, label: DIFFICULTY_NAME[d] })),
          value: q.difficulty,
          onChange: (v) => {
            q.difficulty = v as Difficulty;
            this.showQuick(2);
          },
        },
        {
          kind: 'button',
          label: 'START',
          primary: true,
          onPick: () => this.play({ kind: 'quick' }, { seed: (Math.random() * 0x3fffff) >>> 0, tier: q.tier, mission: q.mission, difficulty: q.difficulty, daily: null }),
        },
        { kind: 'button', label: 'BACK', onPick: () => this.showMain(2) },
      ],
      focus,
      onBack: () => this.showMain(2),
    });
  }

  /** CHALLENGE CODE: type or paste a code. */
  private showCode(): void {
    if (this.phase !== 'menu') this.setPhase('menu');
    const submit = (v: string): void => {
      this.codeDraft = v;
      const c = decodeCode(v);
      if (!c) {
        this.codeError = BAD_CODE;
        this.audio.play('uiDenied');
        this.ui.setInputError(BAD_CODE);
        return;
      }
      this.codeError = null;
      this.playCode(c);
    };
    this.ui.show({
      id: 'code',
      kicker: 'Challenge code',
      title: 'Play a friend’s run',
      subtitle: 'Same school, same staff, same mission, same difficulty. Codes look like H4L-L22 (a score after a second dash is the one to beat).',
      input: { label: 'Code', value: this.codeDraft, placeholder: 'XXX-XXX', maxLength: 16, error: this.codeError, onSubmit: submit },
      clear: true,
      items: [
        { kind: 'button', label: 'PLAY', primary: true, onPick: () => submit(this.ui.inputValue) },
        { kind: 'button', label: 'BACK', onPick: () => this.showMain(3) },
      ],
      onBack: () => this.showMain(3),
    });
  }

  private playCode(c: NonNullable<ReturnType<typeof decodeCode>>): void {
    this.play({ kind: 'challenge', score: c.score }, { seed: c.seed, tier: c.tier, mission: c.mission, difficulty: c.difficulty, daily: null });
  }

  /** The student's look: the LOCKER choices, or one fixed default — the same student in every school. */
  private studentLook(): PersonLook {
    const raw = this.store.data.locker.look;
    return raw ? sanitizeLook(raw, this.defaultLook()) : this.defaultLook();
  }

  private defaultLook(): PersonLook {
    return sanitizeLook(lookFor({ role: 'student', seed: 0x51ed }), lookFor({ role: 'student', seed: 0x51ed }));
  }

  /** LOCKER: cosmetics (all gameplay-neutral) and the nickname for share cards. */
  private showLocker(focus = 0): void {
    const save = this.store.data;
    const look = this.studentLook();
    const u = { xp: save.totals.xp, weeks: save.weeks };
    this.lockerOpen = true;
    const commit = (next: PersonLook, f: number): void => {
      save.locker.look = { ...next };
      this.store.save();
      this.rebuildStudent();
      this.showLocker(f);
    };
    const leave = (): void => {
      save.locker.nickname = sanitizeNickname(this.ui.inputValue);
      this.store.save();
      this.lockerOpen = false;
      this.showMain(4);
    };
    const choice = <T>(label: string, list: readonly Option<T>[], value: T, set: (v: T) => PersonLook, f: number): Item => {
      const open = list.filter((o) => unlocked(o, u));
      const locked = list.filter((o) => !unlocked(o, u));
      const idx = Math.max(0, open.findIndex((o) => o.value === value));
      return {
        kind: 'choice',
        label,
        sub: locked.length ? `+${locked.length} locked · next: ${locked[0]!.name} (${lockReason(locked[0]!)})` : undefined,
        options: open.map((o, i) => ({ value: String(i), label: o.name })),
        value: String(idx),
        onChange: (v) => commit(set(open[Number(v)]!.value), f),
      };
    };
    const onOff = [
      { value: 'on', label: 'ON' },
      { value: 'off', label: 'OFF' },
    ];
    const next = nextXpUnlock(save.totals.xp);
    this.ui.show({
      id: 'locker',
      kicker: 'Locker',
      title: 'Your look',
      subtitle: `${save.totals.xp} XP${next ? ` · next: ${next.name} at ${next.xp}` : ' · everything unlocked'} · all cosmetic`,
      side: true,
      clear: true,
      input: {
        label: 'Nickname (only on share cards you send)',
        value: save.locker.nickname,
        placeholder: 'optional',
        maxLength: NICK_MAX,
        autofocus: false,
        onSubmit: (v) => {
          save.locker.nickname = sanitizeNickname(v);
          this.store.save();
          this.ui.setInputError(save.locker.nickname !== v.trim() ? `Saved as "${save.locker.nickname}" (letters, numbers, . - _)` : null);
        },
      },
      items: [
        choice('Skin tone', SKIN, look.skin, (v) => ({ ...look, skin: v }), 0),
        choice('Hair', HAIR_STYLE, look.hairStyle, (v) => ({ ...look, hairStyle: v }), 1),
        choice('Hair colour', HAIR_COLOUR, look.hair, (v) => ({ ...look, hair: v }), 2),
        choice('Hoodie', HOODIE, look.top, (v) => ({ ...look, top: v }), 3),
        choice('Pants', PANTS, look.bottom, (v) => ({ ...look, bottom: v }), 4),
        choice('Sneakers', SNEAKERS, look.shoes, (v) => ({ ...look, shoes: v }), 5),
        choice('Backpack', BACKPACK, look.backpack, (v) => ({ ...look, backpack: v }), 6),
        { kind: 'choice', label: 'Glasses', options: onOff, value: look.glasses ? 'on' : 'off', onChange: (v) => commit({ ...look, glasses: v === 'on' }, 7) },
        { kind: 'choice', label: 'Headphones', options: onOff, value: look.headphones ? 'on' : 'off', onChange: (v) => commit({ ...look, headphones: v === 'on' }, 8) },
        {
          kind: 'button',
          label: 'SURPRISE ME',
          onPick: () => {
            const rnd = <T>(list: readonly Option<T>[]): T => {
              const open = list.filter((o) => unlocked(o, u));
              return open[Math.floor(Math.random() * open.length)]!.value;
            };
            commit(
              { skin: rnd(SKIN), hairStyle: rnd(HAIR_STYLE), hair: rnd(HAIR_COLOUR), top: rnd(HOODIE), bottom: rnd(PANTS), shoes: rnd(SNEAKERS), backpack: rnd(BACKPACK), glasses: Math.random() < 0.3, headphones: Math.random() < 0.5 },
              9,
            );
          },
        },
        { kind: 'button', label: 'DONE', primary: true, onPick: leave },
      ],
      focus,
      onBack: leave,
    });
  }

  /** Rebuild the people of the current scene with the LOCKER look. */
  private rebuildStudent(): void {
    const plan = this.plan;
    if (!plan || !this.sim) return;
    this.actors?.dispose();
    this.actors = buildActors(plan, { shadows: this.shadows, look: this.studentLook() });
    this.renderer.scene.add(this.actors.root);
    this.renderer.invalidateCompile();
  }

  private weekTier: TierId | null = null;

  private showWeek(): void {
    const save = this.store.data;
    const w = save.week;
    const tier = this.weekTier ?? w?.tier ?? save.unlocked;
    const active = w && w.tier === tier && w.day < 5 ? w : null;
    const finished = w && w.tier === tier && w.day >= 5 ? w : null;
    const plan = active ? weekPlan(active.seed) : null;
    if (active) this.schools.prefetch(weekConfig(active.seed, active.tier, active.day));
    const rows = active
      ? plan!.map((d, i) => ({
          left: `${d.day} · ${MISSION_NAME[d.mission]} · ${DIFFICULTY_NAME[d.difficulty]}`,
          right: active.grades[i] ? `${active.grades[i]} · ${active.scores[i]}` : i === active.day ? 'NEXT' : '—',
          dim: i > active.day,
        }))
      : [];
    const tiers = ([1, 2, 3, 4, 5] as TierId[]).filter((t) => t <= save.unlocked);
    const items: Item[] = [
      {
        kind: 'choice',
        label: 'School',
        sub: `${TIER_NOTE[tier]}${save.weeks[String(tier)] ? ` · best week ${save.weeks[String(tier)]}` : ''}`,
        options: tiers.map((t) => ({ value: String(t), label: TIER_NAME[t] })),
        value: String(tier),
        onChange: (v) => {
          this.weekTier = Number(v) as TierId;
          this.showWeek();
        },
      },
    ];
    if (active) {
      const d = plan![active.day]!;
      items.push({ kind: 'button', label: `CONTINUE: ${d.day}`, sub: `${MISSION_NAME[d.mission]} · ${DIFFICULTY_NAME[d.difficulty]}`, primary: true, onPick: () => this.playWeekDay(active.day) });
      items.push({ kind: 'button', label: 'START A NEW WEEK', sub: 'A different school. This week’s grades are dropped.', onPick: () => this.newWeek(tier) });
    } else {
      items.push({ kind: 'button', label: 'START THE WEEK', sub: 'Monday to Friday. Friday is the PRINCIPAL’S OFFICE.', primary: true, onPick: () => this.newWeek(tier) });
    }
    items.push({ kind: 'button', label: 'BACK', onPick: () => this.showMain(1) });
    const lockNote = save.unlocked < 5 ? `Clear a week here with an A average to unlock ${TIER_NAME[(save.unlocked + 1) as TierId]}.` : 'Every school is unlocked.';
    this.ui.show({
      id: 'week',
      kicker: 'School week',
      title: TIER_NAME[tier],
      subtitle: finished ? `Last week here: ${weekGrade(finished.grades.filter((g) => g !== null))} average.` : 'Five periods at one school, harder each day.',
      body: [rows.length > 0 ? table(rows) : null, el('p', 'hp-note', lockNote)],
      clear: true,
      items,
      focus: 1,
      onBack: () => this.showMain(1),
    });
  }

  private newWeek(tier: TierId): void {
    const save = this.store.data;
    save.week = { tier, seed: (Math.random() * 0x3fffff) >>> 0, day: 0, grades: [null, null, null, null, null], scores: [0, 0, 0, 0, 0] };
    this.store.save();
    this.playWeekDay(0);
  }

  private playWeekDay(day: number): void {
    const w = this.store.data.week!;
    this.play({ kind: 'week', tier: w.tier, seed: w.seed, day }, weekConfig(w.seed, w.tier, day));
  }

  private showRecords(): void {
    const save = this.store.data;
    const rows = MISSION_IDS.map((m) => {
      let best: { score: number; grade: string; rank: string } | null = null;
      for (const [k, r] of Object.entries(save.records)) if (k.startsWith(`${m}:`) && (!best || r.score > best.score)) best = r;
      return { left: MISSION_NAME[m], right: best ? `${best.grade} · ${best.rank} · ${best.score}` : '—', dim: !best };
    });
    const weeks = ([1, 2, 3, 4, 5] as TierId[]).map((t) => ({ left: `Week: ${TIER_NAME[t]}`, right: save.weeks[String(t)] ?? (t <= save.unlocked ? '—' : 'locked'), dim: !save.weeks[String(t)] }));
    const t = save.totals;
    this.ui.show({
      id: 'records',
      kicker: 'Records',
      title: 'Permanent record',
      subtitle: `${t.runs} periods · ${t.ghosts} GHOST runs · ${t.detentions} detentions · ${t.snacks} snacks · daily streak ${dailyStreak(save, todayKey(), civilDay)}`,
      body: [table(rows), table(weeks)],
      clear: true,
      items: [{ kind: 'button', label: 'BACK', onPick: () => this.showMain(5) }],
      onBack: () => this.showMain(5),
    });
  }

  private showHelp(back: () => void): void {
    this.ui.show({
      id: 'help',
      kicker: 'How to play',
      title: 'Go there, do one thing, come back',
      subtitle: 'Sneak out of class, get the job done and slide back into your seat before the bell. Staff see in cones and hear footsteps.',
      body: [
        helpGrid([
          ['Move', 'WASD / arrows · left stick · joystick'],
          ['Sneak (hold)', 'C · L2 / LT · inner ring of the joystick. Silent, harder to see.'],
          ['Sprint (hold)', 'Shift · R2 / RT. Fast and loud.'],
          ['Grab / hide', 'Space · Cross / A. Lockers, stalls and bleachers hide you.'],
          ['Throw', 'E · Circle / B. Erasers from desks make a noise where they land.'],
          ['Pause', 'Esc · Options / Start · the II button'],
        ]),
        helpGrid([
          ['? yellow', 'Someone noticed something. Get out of their cone.'],
          ['! red', 'Spotted: they come after you. Break line of sight or hide.'],
          ['Hall pass', 'The first catch just costs your pass. Then you get walked back (BUSTED).'],
          ['Detention', 'Three catches, or not in your seat when the bell rings.'],
          ['Score', 'Bell time left, never being spotted (GHOST), close calls behind staff, snack packs.'],
        ]),
      ],
      clear: true,
      items: [{ kind: 'button', label: 'BACK', onPick: back }],
      onBack: back,
    });
  }

  private showSettings(back: () => void, focus = 0): void {
    const s = this.store.data.settings;
    const save = (): void => {
      Object.assign(this.camera, CAMERA_PRESETS[s.camera], { walls: s.walls, cones: s.cones });
      this.store.save();
    };
    const onOff = [
      { value: 'on', label: 'ON' },
      { value: 'off', label: 'OFF' },
    ];
    this.ui.show({
      id: 'settings',
      kicker: 'Settings',
      title: 'Settings',
      clear: true,
      items: [
        {
          kind: 'choice',
          label: 'Camera',
          options: [
            { value: 'close', label: 'CLOSE' },
            { value: 'mid', label: 'MID' },
            { value: 'tactical', label: 'TACTICAL' },
          ],
          value: s.camera,
          onChange: (v) => {
            s.camera = v as CameraPreset;
            save();
          },
        },
        {
          kind: 'choice',
          label: 'Walls near the camera',
          options: [
            { value: 'occlude', label: 'FADE' },
            { value: 'cutaway', label: 'CUT AWAY' },
            { value: 'low', label: 'LOW' },
            { value: 'full', label: 'FULL' },
          ],
          value: s.walls,
          onChange: (v) => {
            s.walls = v as WallMode;
            save();
          },
        },
        {
          kind: 'choice',
          label: 'Vision cones',
          options: onOff,
          value: s.cones ? 'on' : 'off',
          onChange: (v) => {
            s.cones = v === 'on';
            save();
          },
        },
        {
          kind: 'choice',
          label: 'Music',
          options: VOLUME_STEPS,
          value: volumeKey(s.music),
          onChange: (v) => {
            s.music = Number(v);
            this.applyVolumes();
            save();
          },
        },
        {
          kind: 'choice',
          label: 'Sound effects',
          sub: 'M mutes everything',
          options: VOLUME_STEPS,
          value: volumeKey(s.sfx),
          onChange: (v) => {
            s.sfx = Number(v);
            this.applyVolumes();
            save();
            this.audio.play('item');
          },
        },
        {
          kind: 'choice',
          label: 'Ghost races',
          sub: 'Your best run on a school races you when you play it again',
          options: onOff,
          value: s.ghosts ? 'on' : 'off',
          onChange: (v) => {
            s.ghosts = v === 'on';
            save();
          },
        },
        {
          kind: 'choice',
          label: 'Reduced motion',
          sub: 'Skips the fly-over and keeps the camera calm',
          options: onOff,
          value: s.reducedMotion ? 'on' : 'off',
          onChange: (v) => {
            s.reducedMotion = v === 'on';
            save();
          },
        },
        {
          kind: 'button',
          label: this.resetArmed ? 'REALLY RESET? Press again' : 'RESET SAVE DATA',
          sub: 'Records, weeks and unlocks',
          onPick: () => {
            if (!this.resetArmed) {
              this.resetArmed = true;
              this.showSettings(back, 7);
              return;
            }
            this.resetArmed = false;
            this.store.reset();
            this.applyVolumes();
            this.showSettings(back, 7);
          },
        },
        { kind: 'button', label: 'BACK', onPick: () => ((this.resetArmed = false), back()) },
      ],
      focus,
      onBack: () => ((this.resetArmed = false), back()),
    });
  }

  private pause(): void {
    if (this.phase !== 'playing') return;
    this.setPhase('paused');
    this.showPause();
  }

  private showPause(focus = 0): void {
    const items: Item[] = [
      { kind: 'button', label: 'RESUME', primary: true, onPick: () => this.resume() },
      { kind: 'button', label: 'RESTART PERIOD', onPick: () => this.retry() },
      { kind: 'button', label: 'HOW TO PLAY', onPick: () => this.showHelp(() => this.showPause(2)) },
      { kind: 'button', label: 'SETTINGS', onPick: () => this.showSettings(() => this.showPause(3)) },
      { kind: 'button', label: 'QUIT TO MENU', onPick: () => this.quitToMenu() },
    ];
    if (this.params.debug) items.push({ kind: 'button', label: 'TUNING PANEL (debug)', onPick: () => (this.ui.hide(), this.hud.togglePanel(true)) });
    this.ui.show({ id: 'pause', kicker: 'Paused', title: MISSION_NAME[this.config.mission], subtitle: this.plan?.name, items, focus, onBack: () => this.resume() });
  }

  private resume(): void {
    this.ui.hide();
    this.setPhase('playing');
    this.last = performance.now();
  }

  private retry(): void {
    this.play(this.mode, this.config);
  }

  private quitToMenu(): void {
    this.ghost?.view.dispose();
    this.ghost = null;
    this.mode = { kind: 'attract' };
    this.showMain();
  }

  // ── runs ─────────────────────────────────────────────────────────────────

  /** Build (or fetch) the school, then start the run behind the mission card. */
  private play(mode: Mode, config: RunConfig): void {
    this.mode = mode;
    this.config = config;
    const id = ++this.loadId;
    const ready = this.schools.has(config);
    this.setPhase('loading');
    if (!ready || !this.params.autostart) {
      this.ui.show({
        id: 'loading',
        kicker: TIER_NAME[config.tier],
        title: 'Building the school…',
        subtitle: 'Checking there’s a way through unseen.',
        items: [],
      });
    }
    void this.schools.get(config).then((built) => {
      if (id !== this.loadId) return; // superseded
      this.startRun(built, false);
      if (this.params.autostart) {
        this.ui.hide();
        this.setPhase('playing');
      } else this.showIntro();
    });
  }

  private ensureAttract(): void {
    if (this.mode.kind !== 'attract' || !this.sim || this.bot === null) this.startAttract();
  }

  /** A bot-played run behind the title and menus. */
  private startAttract(): void {
    this.mode = { kind: 'attract' };
    const n = this.attractN++;
    const missions: MissionId[] = ['locker', 'vending', 'gym', 'phone'];
    const c: RunConfig = { seed: hashInts(todayKey(), n, 0xa77) & 0x3fffff, tier: ((n % 3) + 1) as TierId, mission: missions[n % missions.length]!, difficulty: 'junior', daily: null };
    const id = ++this.loadId;
    void this.schools.get(c).then((built) => {
      if (id !== this.loadId || this.mode.kind !== 'attract') return;
      this.config = c;
      this.startRun(built, true);
    });
  }

  private startRun(built: BuiltSchool, attract: boolean): void {
    const plan = built.plan;
    this.plan = plan;
    this.par = built.par;
    this.report = null;
    this.sim = createSim(plan, this.config);
    this.bot = attract ? createBot(plan, { skill: 0.9, seed: this.attractN }) : this.autopilot !== null ? createBot(plan, { skill: this.autopilot }) : null;
    this.prev = takeSnapshot(this.sim);
    this.view?.dispose();
    this.actors?.dispose();
    this.fx?.dispose();
    this.snacks?.dispose();
    this.ghost?.view.dispose();
    this.ghost = null;
    this.recorder = attract ? null : new Recorder();
    this.lastRecording = null;
    this.path = [];
    this.busts = [];
    if (!attract && this.store.data.settings.ghosts) {
      const rec = this.ghosts.get(ghostKey(this.config));
      if (rec) {
        const view = buildGhost(plan.seed ^ 0x51ed, this.studentLook());
        this.renderer.scene.add(view.root);
        const gs = createSim(plan, this.config);
        this.ghost = { sim: gs, player: new Player(rec), view, score: rec.score, px: gs.student.x, pz: gs.student.z };
      }
    }
    this.view = buildSchoolView(plan, { shadows: this.shadows });
    this.actors = buildActors(plan, { shadows: this.shadows, look: this.studentLook() });
    this.fx = buildStealthFx();
    this.snacks = buildSnacks(plan.snacks);
    this.renderer.scene.add(this.view.root, this.actors.root, this.fx.root, this.snacks.root);
    this.renderer.invalidateCompile();
    this.acc = 0;
    this.sound.reset();
    this.hud.hideBanner();
    this.lead.set(0, 0);
    this.placeCamera(true);
    this.input.reset();
  }

  private showIntro(): void {
    const plan = this.plan!;
    this.setPhase('intro');
    const m = this.mode;
    const kicker = m.kind === 'daily' ? `Daily period #${dailyNumber(m.day)}` : m.kind === 'week' ? `School week · ${WEEKDAYS[m.day]}` : m.kind === 'challenge' ? 'Challenge code' : 'Quick period';
    const reduced = this.store.data.settings.reducedMotion;
    if (!reduced) {
      // Fly-over: start high over the whole school, then glide down to your desk.
      const { w, d } = planSize(plan);
      const span = Math.max(w, d);
      const p = (62 * Math.PI) / 180;
      const dist = span * 0.95;
      this.renderer.rig.setGoal({ position: { x: w / 2, y: Math.sin(p) * dist, z: d / 2 + Math.cos(p) * dist }, target: { x: w / 2, y: 0, z: d / 2 }, fov: 40 }, 60);
      this.renderer.rig.snap();
    }
    this.ui.show({
      id: 'intro',
      layout: 'card',
      clear: true,
      body: [
        missionCard(
          {
            kicker,
            mission: this.config.mission,
            difficulty: this.config.difficulty,
            school: plan.name,
            motto: plan.motto,
            bellSeconds: plan.bellTicks / SIM_HZ,
            passes: DIFFICULTY[this.config.difficulty].passes,
            snacks: plan.snacks.length,
            ghost: this.ghost?.score ?? null,
            toBeat: m.kind === 'challenge' ? m.score : null,
          },
          'Press GRAB / tap to start',
        ),
      ],
      items: [],
      onAny: () => this.beginPlay(),
    });
  }

  private beginPlay(): void {
    if (this.phase !== 'intro') return;
    this.ui.hide();
    this.setPhase('playing');
    this.placeCamera(true);
    this.last = performance.now();
  }

  private onEnd(phase: 'success' | 'detention' | 'timeout'): void {
    if (this.mode.kind === 'attract') {
      // Next attract school after a beat.
      setTimeout(() => {
        if (this.mode.kind === 'attract') this.startAttract();
      }, 1500);
      return;
    }
    this.setPhase('outro');
    const s = this.sim!;
    const title = phase === 'success' ? 'BACK IN YOUR SEAT' : phase === 'detention' ? 'DETENTION' : 'THE BELL RANG';
    const sub =
      phase === 'success'
        ? `With ${clock(s.bell / SIM_HZ)} to spare.`
        : phase === 'detention'
          ? 'Reason: wandering. Duration: emotionally, forever.'
          : 'You were not in your seat.';
    this.hud.showBanner(title, sub, null);
    this.report = hallReport(s, this.par);
    this.path.push(s.student.x, s.student.z);
    if (this.recorder) {
      this.lastRecording = this.recorder.finish(this.config, this.report.total);
      this.recorder = null;
    }
  }

  private showReport(): void {
    const r = this.report!;
    const plan = this.plan!;
    this.hud.hideBanner();
    this.setPhase('report');
    const save = this.store.data;
    const newBest = recordRun(save, r, this.config.tier, this.config.daily, this.sim!.stats.snacks);
    const m = this.mode;
    let context = 'Quick period';
    let footer = '';
    const items: Item[] = [];
    if (m.kind === 'daily') {
      const d = save.daily[String(m.day)];
      context = `Daily period #${dailyNumber(m.day)}`;
      footer = d && d.attempts === 1 ? 'First attempt' : d ? `Attempt ${d.attempts} · today's best ${d.best.score}` : '';
      items.push({ kind: 'button', label: 'RETRY', primary: true, onPick: () => this.retry() });
    } else if (m.kind === 'week') {
      const w = save.week;
      context = `School week · ${WEEKDAYS[m.day]}`;
      if (w && w.seed === m.seed && w.tier === m.tier) {
        const g = w.grades[m.day];
        if (!g || r.total > w.scores[m.day]!) {
          w.grades[m.day] = r.grade;
          w.scores[m.day] = r.total;
        }
        w.day = Math.max(w.day, m.day + 1);
        if (m.day === 4) {
          const wg = weekGrade(w.grades.map((x) => x ?? 'D'));
          const key = String(w.tier);
          const prevBest = save.weeks[key];
          if (!prevBest || GRADE_ORDER.indexOf(wg) < GRADE_ORDER.indexOf(prevBest)) save.weeks[key] = wg;
          footer = `Week grade ${wg}`;
          if (unlocksNext(wg) && w.tier === save.unlocked && save.unlocked < 5) {
            save.unlocked = (save.unlocked + 1) as TierId;
            footer += ` · ${TIER_NAME[save.unlocked]} unlocked!`;
          } else if (!unlocksNext(wg) && w.tier === save.unlocked && save.unlocked < 5) footer += ' · an A average unlocks the next school';
          items.push({ kind: 'button', label: 'NEW WEEK', primary: true, onPick: () => this.newWeek(w.tier) });
        } else {
          const next = weekPlan(w.seed)[m.day + 1]!;
          this.schools.prefetch(weekConfig(w.seed, w.tier, m.day + 1));
          items.push({ kind: 'button', label: `NEXT: ${next.day}`, sub: MISSION_NAME[next.mission], primary: true, onPick: () => this.playWeekDay(m.day + 1) });
        }
      }
      items.push({ kind: 'button', label: 'RETRY', onPick: () => this.retry() });
    } else if (m.kind === 'challenge') {
      context = 'Challenge code';
      if (m.score !== null) footer = r.total > m.score ? `Beat their ${m.score}!` : r.total === m.score ? `Tied their ${m.score}` : `Their score: ${m.score}`;
      items.push({ kind: 'button', label: 'RETRY', primary: true, onPick: () => this.retry() });
    } else {
      items.push({ kind: 'button', label: 'NEW SCHOOL', primary: true, onPick: () => this.play({ kind: 'quick' }, { ...this.config, seed: (this.config.seed + 1) & 0x3fffff }) });
      items.push({ kind: 'button', label: 'RETRY', onPick: () => this.retry() });
    }
    // Your best run here becomes the ghost you race next time.
    if (this.lastRecording && r.success && this.ghosts.offer(this.lastRecording)) footer = [footer, 'Ghost saved'].filter(Boolean).join(' · ');
    if (this.ghost && r.success) footer = [footer, r.total > this.ghost.score ? 'Beat your ghost' : `Ghost ${this.ghost.score}`].filter(Boolean).join(' · ');
    items.push({ kind: 'button', label: 'SHARE', onPick: () => this.showShare() });
    items.push({ kind: 'button', label: 'MENU', onPick: () => this.quitToMenu() });
    this.store.save();
    setTimeout(() => {
      if (this.phase !== 'report') return;
      this.audio.play('stamp');
      setTimeout(() => {
        if (this.phase !== 'report') return;
        this.audio.play(r.grade === 'A+' || r.grade === 'A' ? 'gradeA' : 'gradeLow');
        if (newBest && r.total > 0) setTimeout(() => this.audio.play('newBest'), 500);
      }, 250);
    }, 300);
    this.reportScreen = {
      id: 'report',
      layout: 'report',
      body: [reportCard(r, { school: plan.name, context, newBest, footer })],
      items,
      row: true,
      onBack: () => this.quitToMenu(),
    };
    this.ui.show(this.reportScreen);
  }

  /** The challenge code of the run just played (with its score). */
  private runCode(): string {
    const c = this.config;
    return encodeCode({ seed: c.seed, mission: c.mission, tier: c.tier, difficulty: c.difficulty, score: this.report?.total ?? null });
  }

  /** SHARE: the text, the floor-plan picture, copy / save / share. Nothing leaves the device unless you send it. */
  private showShare(): void {
    const r = this.report;
    const plan = this.plan;
    if (!r || !plan) return;
    const code = this.runCode();
    const daily = this.config.daily !== null ? dailyNumber(this.config.daily) : null;
    const text = shareText(r, plan.name, code, daily, this.store.data.locker.nickname);
    const pic = planPicture(plan, 640);
    const canvas = document.createElement('canvas');
    canvas.width = pic.width;
    canvas.height = pic.height;
    const g = canvas.getContext('2d');
    let url = '';
    if (g) {
      drawFloorPlan(g, plan, this.path, this.busts, `${daily !== null ? `HALL PASS #${daily}` : 'HALL PASS'} · ${MISSION_NAME[r.mission]}`, `${r.rank} · ${r.grade} · ${r.total} pts · ${code}`, pic);
      try {
        url = canvas.toDataURL('image/png');
      } catch {
        url = '';
      }
    }
    const img = url ? el('img', 'hp-share-img') : null;
    if (img) {
      img.src = url;
      img.alt = 'Floor plan of the school with your route drawn on it';
    }
    const back = (): void => {
      if (this.reportScreen) this.ui.show(this.reportScreen);
    };
    const note = (msg: string): void => this.hud.showBanner(msg, '', null);
    const items: Item[] = [
      {
        kind: 'button',
        label: 'COPY TEXT',
        sub: code,
        primary: true,
        onPick: () => {
          void navigator.clipboard?.writeText(text).then(
            () => note('Copied'),
            () => note('Copy failed: select the text instead'),
          );
          setTimeout(() => this.hud.hideBanner(), 1200);
        },
      },
    ];
    if (url) {
      items.push({
        kind: 'button',
        label: 'SAVE PICTURE',
        onPick: () => {
          const a = document.createElement('a');
          a.href = url;
          a.download = `hall-pass-${code.slice(0, 7)}.png`;
          a.click();
        },
      });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (typeof nav.share === 'function') {
        items.push({
          kind: 'button',
          label: 'SHARE…',
          onPick: () => {
            canvas.toBlob((blob) => {
              const files = blob ? [new File([blob], `hall-pass-${code.slice(0, 7)}.png`, { type: 'image/png' })] : [];
              const data: ShareData = files.length && nav.canShare?.({ files }) ? { text, files } : { text };
              void nav.share(data).catch(() => undefined);
            }, 'image/png');
          },
        });
      }
    }
    items.push({ kind: 'button', label: 'BACK', onPick: back });
    this.ui.show({
      id: 'share',
      kicker: 'Share',
      title: 'Hall Report',
      body: [img, el('pre', 'hp-share-text', text)],
      items,
      row: true,
      onBack: back,
    });
  }

  // ── frame ────────────────────────────────────────────────────────────────

  start(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = clamp((now - this.last) / 1000, 0, 0.1);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(dt: number): void {
    const input = this.input;
    input.update(dt);
    this.clockT += dt;
    this.phaseT += dt;
    const actions = input.getMenuActions();
    if (actions.includes('mute')) {
      const st = this.store.data.settings;
      st.muted = !st.muted;
      this.applyVolumes();
      this.store.save();
      this.hud.showBanner(st.muted ? 'Sound off' : 'Sound on', 'M toggles sound', null);
      setTimeout(() => {
        if (this.phase === 'playing') this.hud.hideBanner();
      }, 900);
    }
    if (this.ui.visible) this.ui.handle(actions);
    else if (this.phase === 'playing') {
      for (const a of actions) if (a === 'pause') this.pause();
    } else if (this.phase === 'paused' && this.hud.panelOpen) {
      for (const a of actions) if (a === 'pause' || a === 'back') this.hud.togglePanel(false);
    }
    if (this.phase === 'intro' && this.phaseT > FLYOVER_SECONDS + 4) this.beginPlay();
    if (this.phase === 'outro' && this.phaseT > OUTRO_SECONDS) this.showReport();

    const sim = this.sim;
    if (!sim || !this.actors || !this.view || !this.plan) {
      this.renderer.render(dt);
      return;
    }
    const attract = this.mode.kind === 'attract';
    const running = attract ? sim.phase === 'playing' && !this.lockerOpen : this.phase === 'playing';
    if (this.bot && (attract || this.autopilot !== null)) {
      const b = this.bot.decide(sim);
      this.tick.moveX = b.moveX;
      this.tick.moveY = b.moveY;
      this.tick.buttons = b.buttons;
    } else {
      const c = input.getControls();
      this.tick.moveX = Math.round(clamp(c.moveX, -1, 1) * 127);
      this.tick.moveY = Math.round(clamp(c.moveY, -1, 1) * 127);
      this.tick.buttons = (c.sneak ? BTN_SNEAK : 0) | (c.secondary ? BTN_THROW : 0) | (c.alt ? BTN_SPRINT : 0) | (c.primary ? BTN_INTERACT : 0);
    }

    if (running) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < MAX_STEPS) {
        takeSnapshot(sim, this.prev);
        this.recorder?.push(this.tick);
        const ev = step(sim, this.tick);
        if (ev.length) this.onEvents(ev);
        if (!attract) this.afterStep(sim);
        this.acc -= SIM_DT;
        steps++;
        if (this.bot && (attract || this.autopilot !== null)) {
          const b = this.bot.decide(sim);
          this.tick.moveX = b.moveX;
          this.tick.moveY = b.moveY;
          this.tick.buttons = b.buttons;
        }
        if (sim.phase !== 'playing') break;
      }
      if (steps === MAX_STEPS) this.acc = 0; // slow device: run slower, never diverge
    }
    if (!attract && this.phase === 'playing') this.sound.update(sim, this.plan, dt);
    const frozen = !running;
    const alpha = frozen ? 1 : clamp(this.acc / SIM_DT, 0, 1);
    this.actors.update(this.prev, sim, alpha, this.camera.cones, this.phase === 'paused' ? 0 : dt);
    this.fx!.update(this.phase === 'paused' ? 0 : dt);
    this.snacks!.update(dt);
    if (this.ghost) {
      const g = this.ghost;
      const gs = g.sim.student;
      const a = alpha;
      g.view.update(g.px + (gs.x - g.px) * a, g.pz + (gs.z - g.pz) * a, gs.yaw, gs.posture, g.sim.phase === 'playing' && gs.hidden < 0, this.phase === 'paused' ? 0 : dt);
    }
    const f = this.actors.focus;
    if (this.phase === 'intro' && !this.store.data.settings.reducedMotion) {
      // After a beat over the whole school, glide down to the student.
      if (this.phaseT > 1.4) this.placeCamera(false, dt, 1.6);
    } else this.placeCamera(false, dt);
    const camPos = this.renderer.rig.camera.position;
    this.viewPts.camX = camPos.x;
    this.viewPts.camY = camPos.y;
    this.viewPts.camZ = camPos.z;
    this.actors.viewPoints(this.viewPts, 16);
    this.view.update(dt, f.x, f.z, this.camera.walls, this.viewPts);
    this.renderer.render(dt);
    if (!this.hud.root.hidden) this.updateHud();
  }

  /** Per sim tick of a player run: sample the route for the share card, advance the ghost. */
  private afterStep(sim: SimState): void {
    if (sim.tick % 15 === 0 && sim.student.hidden < 0) this.path.push(Math.round(sim.student.x * 10) / 10, Math.round(sim.student.z * 10) / 10);
    const g = this.ghost;
    if (g && g.sim.phase === 'playing') {
      g.px = g.sim.student.x;
      g.pz = g.sim.student.z;
      step(g.sim, g.player.next());
    }
  }

  private placeCamera(snap: boolean, dt = 0, stiffness = 9): void {
    const sim = this.sim!;
    const f = this.actors ? this.actors.focus : new THREE.Vector3(sim.student.x, 0, sim.student.z);
    if (!this.actors) f.set(sim.student.x, 0, sim.student.z);
    // Lead toward where the student is heading (up to 2 m), smoothed.
    const s = sim.student;
    const k = snap ? 1 : 1 - Math.exp(-3 * dt);
    this.lead.x += (clamp(s.vx * 0.45, -2, 2) - this.lead.x) * k;
    this.lead.y += (clamp(s.vz * 0.45, -2, 2) - this.lead.y) * k;
    if (this.lockerOpen && this.mode.kind === 'attract') {
      // LOCKER: a close, low shot of the student, framed to the right of the panel (above it on a portrait phone).
      // Stand in front of the student (where they face) and slide the frame so they sit beside the panel.
      const portrait = this.renderer.rig.camera.aspect < 1;
      const fx = Math.sin(s.yaw);
      const fz = Math.cos(s.yaw);
      // Looking back along −forward, screen-right is (fz, −fx); aim left of the student so they sit right of centre.
      const side = portrait ? 0 : 1.1;
      const lift = portrait ? 0.55 : 0;
      const tx2 = f.x - fz * side;
      const tz2 = f.z + fx * side;
      this.renderer.rig.setGoal({ position: { x: tx2 + fx * 4.4, y: 1.9 + lift, z: tz2 + fz * 4.4 }, target: { x: tx2, y: 0.95 - lift * 0.6, z: tz2 }, fov: 40 }, snap ? 60 : 4);
      if (snap) this.renderer.rig.snap();
      return;
    }
    const cam = this.mode.kind === 'attract' ? CAMERA_PRESETS.mid : this.camera;
    const p = (cam.pitch * Math.PI) / 180;
    const d = cam.distance;
    const tx = f.x + this.lead.x;
    const tz = f.z + this.lead.y;
    this.renderer.rig.setGoal({ position: { x: tx, y: Math.sin(p) * d, z: tz + Math.cos(p) * d }, target: { x: tx, y: 0.6, z: tz }, fov: cam.fov }, snap ? 60 : stiffness);
    if (snap) this.renderer.rig.snap();
    // Sun follows the focus so the shadow map covers what's on screen.
    const sun = this.lights.sun;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx - 26, 24, tz + 12);
  }

  private onEvents(ev: SimEvent[]): void {
    this.lastEvents = ev;
    this.actors?.onEvents(ev, this.sim!);
    this.fx?.onEvents(ev);
    const quiet = this.mode.kind === 'attract';
    const plan = this.plan!;
    if (!quiet) this.sound.onEvents(ev, this.sim!, plan);
    for (const e of ev) {
      if (e.t === 'pickup') this.view?.setGoalDone(e.anchor, true);
      if (e.t === 'snack') this.snacks?.take(e.index);
      if (e.t === 'end') this.onEnd(e.phase);
      if (quiet) continue;
      if (e.t === 'caught' && !e.passUsed) this.busts.push(this.sim!.student.x, this.sim!.student.z);
      if (e.t === 'caught') {
        const who = plan.staff[e.staff]!.name;
        if (e.passUsed) this.flash(`${who}: "Oh — carry on."`, 'You showed your hall pass.');
        else if (this.sim!.phase === 'playing') this.flash('BUSTED', `${who}: "Where are we going?" Walking you back…`);
      }
      if (e.t === 'pa') this.flash('PA ANNOUNCEMENT', PA_LINES[e.id]);
      if (e.t === 'report') this.flash('Preston', `"${plan.staff[e.to]!.name}! Someone's out of class!"`);
      if (e.t === 'cameraAlert') this.flash('Security camera', `${plan.staff[e.to]!.name} is coming to check.`);
      if (e.t === 'found') this.flash('Found you', `${plan.staff[e.staff]!.name} saw you climb in.`);
      if (e.t === 'chase' && !e.on && e.escaped && !this.sim!.staff.some((st) => st.mode === 'chase')) this.flash('Lost them', 'They gave up looking.');
      if (e.t === 'lunchBell') this.flash('LUNCH BELL!', `Get to the counter: ${MISSION_RULES.firstWindow} s to be first in line.`);
      if (e.t === 'shoo') this.flash('Lunch staff', '"Not yet, hon. Lunch bell first."');
      if (e.t === 'buy' && !e.on && !e.done) this.flash('Purchase cancelled', 'The machine keeps your change. Stand still to buy.');
      if (e.t === 'snack') this.flash('Snack pack!', `${this.sim!.stats.snacks} of ${plan.snacks.length}`);
    }
  }

  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private flash(title: string, sub: string): void {
    this.hud.showBanner(title, sub, null);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      if (this.phase === 'playing' || this.phase === 'paused') this.hud.hideBanner();
    }, 1800);
  }

  private updateHud(): void {
    const s = this.sim!;
    const plan = this.plan!;
    const goals = missionGoals(plan);
    const left = goals.filter((g) => !s.collected.includes(g)).length;
    const line = left > 0 ? (goals.length > 1 ? `${HUD_GOAL[this.config.mission]} (${goals.length - left}/${goals.length})` : HUD_GOAL[this.config.mission]) : 'Got it. Back to your seat!';
    const prompt = this.promptFor(s);
    const st = this.renderer.stats();
    this.hud.update({
      bellTicks: s.bell,
      missionLine: line,
      passes: s.passes,
      catches: s.catches,
      school: plan.name,
      seed: this.config.seed,
      tier: this.config.tier,
      mission: this.config.mission,
      difficulty: this.config.difficulty,
      camera: this.camera,
      prompt,
      carry: s.student.carry,
      hidden: s.student.hidden >= 0,
      chased: s.staff.some((st2) => st2.mode === 'chase'),
      badge: this.badgeFor(s),
      stats:
        `${plan.name} (${MISSION_NAME[this.config.mission]})\n` +
        `${st.fps} fps · ${st.drawCalls} draws · ${Math.round(st.triangles / 1000)}k tris · dpr ${st.pixelRatio}\n` +
        `${plan.staff.length} staff · ${this.view!.stats.wallBoxes} wall boxes · ${this.view!.stats.furniture} furniture\n` +
        `rerolls ${plan.rerolls}${plan.fallback ? ' (fallback)' : ''} · par ${this.par} · tick ${s.tick}`,
    });
    const cam = this.renderer.rig.camera;
    cam.updateMatrixWorld();
    const pts = s.staff.map((st2, i) => {
      if (st2.level === 'calm') return null;
      this.actors!.headOf(i, this.v);
      this.renderer.projector.project(this.v, this.proj);
      return this.proj.visible ? { x: this.proj.x, y: this.proj.y, level: st2.level } : null;
    });
    this.hud.markers(pts);
  }

  private badgeFor(s: SimState): string | null {
    const plan = this.plan!;
    if (s.student.buying > 0) return `Buying… ${Math.ceil(s.student.buying / SIM_HZ)} s · stand still`;
    const lunch = lunchTick(plan.mission, plan.bellTicks);
    if (lunch > 0 && !s.collected.includes('goal')) {
      if (s.tick < lunch) return `Lunch bell in ${clock((lunch - s.tick) / SIM_HZ)}`;
      const left = lunch + MISSION_RULES.firstWindow * SIM_HZ - s.tick;
      return left > 0 ? `LUNCH! First in line: ${Math.ceil(left / SIM_HZ)} s` : 'The line is forming…';
    }
    if (s.stats.snacks > 0) return `Snacks ${s.stats.snacks}/${plan.snacks.length}`;
    return null;
  }

  /** What GRAB would do right now (shown as a prompt). */
  private promptFor(s: SimState): string | null {
    const plan = this.plan!;
    const st = s.student;
    if (st.escort > 0 || s.phase !== 'playing' || st.buying > 0) return null;
    if (st.hidden >= 0) return 'GRAB: climb out';
    const next = missionGoals(plan).find((g) => !s.collected.includes(g));
    const a = next ? plan.anchors[next] : null;
    if (a && Math.hypot(st.x - a.x, st.z - a.z) < RULES.reach) {
      if (this.config.mission === 'vending') return 'GRAB: buy chips (6 s, loud!)';
      if (this.config.mission === 'pizza') return 'GRAB: get in line';
      return 'GRAB: take it';
    }
    for (const f of plan.furniture) {
      if (!f.tags.includes('hide')) continue;
      const p = hideFront(f);
      if (Math.hypot(st.x - p.x, st.z - p.z) < HIDE.reach) return `GRAB: hide in the ${f.kind === 'locker' ? 'locker' : f.kind === 'stall' ? 'stall' : 'bleachers'}`;
    }
    if (st.carry < THROW.maxCarry) {
      for (let k = 0; k < plan.furniture.length; k++) {
        const f = plan.furniture[k]!;
        if (s.usedThrowables[k] || !f.tags.includes('throwables')) continue;
        const rx = Math.max(Math.abs(st.x - f.x) - f.w / 2, 0);
        const rz = Math.max(Math.abs(st.z - f.z) - f.d / 2, 0);
        if (rx * rx + rz * rz < THROW.reach * THROW.reach) return 'GRAB: pick up an eraser';
      }
    }
    return null;
  }

  // ── debug hooks (window.__HP__) ──
  debugApi() {
    return {
      screen: () => (this.ui.visible ? this.ui.screenId : this.phase),
      phase: () => this.phase,
      seed: () => this.config.seed,
      config: () => ({ ...this.config }),
      school: () => this.plan,
      route: () => this.plan?.referenceRoute ?? null,
      staff: () => this.sim?.staff.map((s, i) => ({ name: this.plan!.staff[i]!.name, ...s })) ?? [],
      state: () => this.sim,
      report: () => this.report,
      save: () => this.store.data,
      events: () => this.lastEvents,
      /** Start a run: 'daily' (today), 'quick' (with config overrides), 'week' (continue / start). */
      play: (kind: 'daily' | 'quick' | 'week', c: Partial<RunConfig> = {}) => {
        if (kind === 'daily') this.play({ kind: 'daily', day: todayKey() }, dailyConfig(todayKey()));
        else if (kind === 'week') {
          const w = this.store.data.week;
          if (w && w.day < 5) this.playWeekDay(w.day);
          else this.newWeek(this.store.data.unlocked);
        } else this.play({ kind: 'quick' }, { ...this.config, ...c, daily: null });
      },
      menu: () => this.showMain(),
      start: () => this.beginPlay(),
      action: (a: Parameters<Ui['handle']>[0][number]) => this.ui.handle([a]),
      autopilot: (skill: number | null) => {
        this.autopilot = skill;
        this.bot = skill !== null && this.plan ? createBot(this.plan, { skill }) : null;
      },
      camera: (c?: Partial<CameraSettings>) => (c ? Object.assign(this.camera, c) : { ...this.camera }),
      teleport: (x: number, z: number) => {
        if (!this.sim) return;
        this.sim.student.x = x;
        this.sim.student.z = z;
      },
      warp: (seconds: number) => {
        const sim = this.sim;
        if (!sim) return;
        for (let i = 0; i < seconds * 60 && sim.phase === 'playing'; i++) {
          takeSnapshot(sim, this.prev);
          const input = this.bot && this.autopilot !== null ? this.bot.decide(sim) : { moveX: 0, moveY: 0, buttons: 0 };
          this.recorder?.push(input);
          const ev = step(sim, input);
          if (ev.length) this.onEvents(ev);
          if (this.mode.kind !== 'attract') this.afterStep(sim);
        }
      },
      panel: (open: boolean) => this.hud.togglePanel(open),
      stats: () => ({ ...this.renderer.stats(), ...(this.view?.stats ?? {}), cut: this.view?.cutCount() ?? 0, focus: this.actors ? [this.actors.focus.x, this.actors.focus.z] : null }),
      ready: () => this.sim !== null,
      audio: () => this.audio,
      code: () => (this.report ? this.runCode() : null),
      record: () => this.lastRecording,
      ghost: () => (this.ghost ? { x: this.ghost.sim.student.x, z: this.ghost.sim.student.z, phase: this.ghost.sim.phase, score: this.ghost.score } : null),
      share: () => this.showShare(),
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.unlockOff();
    this.audio.dispose();
    this.schools.dispose();
    this.input.dispose();
    this.view?.dispose();
    this.actors?.dispose();
    this.renderer.dispose();
    this.root.textContent = '';
  }
}

const GRADE_ORDER = ['A+', 'A', 'B', 'C', 'D'];

const VOLUME_STEPS = [
  { value: '0', label: 'OFF' },
  { value: '0.25', label: '25%' },
  { value: '0.5', label: '50%' },
  { value: '0.8', label: '80%' },
  { value: '1', label: '100%' },
];

/** The volume step nearest a stored volume. */
function volumeKey(v: number): string {
  let best = VOLUME_STEPS[0]!.value;
  for (const s of VOLUME_STEPS) if (Math.abs(Number(s.value) - v) < Math.abs(Number(best) - v)) best = s.value;
  return best;
}
