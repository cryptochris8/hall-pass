// ─────────────────────────────────────────────────────────────────────────────
// HALL PASS app (integration). Grey-box build (milestone M1): generate a school,
// run the fixed-timestep sim from player input, draw the cut-away school, staff
// and cones, follow the student with the fixed-yaw camera, and expose the tuning
// panel + debug hooks for the phone test.
//
// Frame loop (docs/ARCHITECTURE.md §2–3):
//   input.update → controls → TickInput (quantized) → accumulate real time →
//   sim.step() 0..4 times at 1/60 s → world/actors read state (interpolated by
//   the leftover alpha) → camera → render → HUD.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { clamp } from '../core/math';
import { createInput, type InputManager } from '../input';
import { GameRenderer, detailTier } from '../render/renderer';
import { PAL } from '../render/palette';
import type { Quality } from '../render/types';
import { generateSchool } from '../school/gen';
import type { Difficulty, MissionId, SchoolPlan, TierId } from '../school/types';
import { createSim, missionGoals, step, BTN_INTERACT, BTN_SNEAK, BTN_SPRINT, SIM_DT, type RunConfig, type SimEvent, type SimState, type TickInput } from '../sim';
import { buildActors, takeSnapshot, type ActorsView, type Snapshot } from '../world/actors';
import { buildSchoolView, type SchoolView, type ViewPoints } from '../world/school';
import { renderDpr } from './device';
import { Hud, missionName, type CameraSettings } from './hud';
import { installViewport } from './viewport';

export interface AppParams {
  seed: number | null;
  tier: TierId | null;
  mission: MissionId | null;
  difficulty: Difficulty | null;
  quality: Quality | null;
  camera: Partial<CameraSettings>;
  debug: boolean;
}

const MAX_STEPS = 4;

const GOAL_LINE: Record<MissionId, string> = {
  phone: 'Get your phone from the front-office drawer',
  vending: 'Buy chips from the machine by the gym',
  pizza: 'Get to the cafeteria counter',
  locker: "Drop the card in your friend's locker",
  gym: 'Grab your gym bag from your locker by the gym',
  principal: "Get the 3 phones (principal's office, front office, a classroom)",
};

export class App {
  private readonly renderer: GameRenderer;
  private readonly input: InputManager;
  private readonly hud: Hud;
  private readonly lights: { hemi: THREE.HemisphereLight; sun: THREE.DirectionalLight };
  private plan!: SchoolPlan;
  private config!: RunConfig;
  private sim!: SimState;
  private view: SchoolView | null = null;
  private actors: ActorsView | null = null;
  private prev!: Snapshot;
  private acc = 0;
  private last = 0;
  private raf = 0;
  private paused = false;
  private ended = false;
  private readonly tick: TickInput = { moveX: 0, moveY: 0, buttons: 0 };
  readonly camera: CameraSettings = { pitch: 46, distance: 12, fov: 48, walls: 'occlude', cones: true };
  private readonly shadows: boolean;
  private readonly v = new THREE.Vector3();
  private readonly proj = { x: 0, y: 0, visible: false };
  private lastEvents: SimEvent[] = [];
  private readonly lead = new THREE.Vector2();
  private readonly viewPts: ViewPoints = { camX: 0, camY: 0, camZ: 0, points: new Float32Array(3 * 16), count: 0 };

  constructor(private readonly root: HTMLElement, params: AppParams) {
    const quality = params.quality ?? 'auto';
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    // Shadows are the strongest depth cue; only an explicit ?quality=low turns them off (1024² map on phones).
    this.shadows = quality !== 'low';
    const bigShadows = detailTier(quality, touch) === 'high';
    this.renderer = new GameRenderer(root, quality);
    this.renderer.scene.background = new THREE.Color(PAL.skyTop);
    Object.assign(this.camera, params.camera);

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

    this.input = createInput({ touchRoot: root });
    this.input.setMode('gameplay');
    this.input.setScheme({
      move: 'xy',
      moveLabel: 'MOVE',
      primary: { label: 'GRAB', icon: 'hand' },
      secondary: { label: 'SNEAK', icon: 'brake', hold: true },
      alt: { label: 'SPRINT', icon: 'run', hold: true },
    });

    this.hud = new Hud(root, {
      newRun: (c) => this.newRun(c),
      camera: (c) => Object.assign(this.camera, c),
      pause: (on) => {
        this.paused = on;
        this.input.reset();
      },
    });

    installViewport(root, window, (size) => this.renderer.resize(size.w, size.h, renderDpr(size.dpr, size.w, size.h, touch, quality)));
    this.newRun({
      seed: params.seed ?? ((Math.random() * 1e6) >>> 0),
      tier: params.tier ?? 1,
      mission: params.mission ?? 'phone',
      difficulty: params.difficulty ?? 'junior',
    });
  }

  newRun(change: { seed?: number; tier?: TierId; mission?: MissionId; difficulty?: Difficulty }): void {
    const base = this.config ?? { seed: 1, tier: 1, mission: 'phone', difficulty: 'junior', daily: null };
    this.config = { ...base, ...change, daily: null };
    this.plan = generateSchool(this.config);
    this.sim = createSim(this.plan, this.config);
    this.prev = takeSnapshot(this.sim);
    this.view?.dispose();
    this.actors?.dispose();
    this.view = buildSchoolView(this.plan, { shadows: this.shadows });
    this.actors = buildActors(this.plan, { shadows: this.shadows });
    this.renderer.scene.add(this.view.root, this.actors.root);
    this.renderer.invalidateCompile();
    this.acc = 0;
    this.ended = false;
    this.hud.hideBanner();
    this.placeCamera(true);
    this.input.reset();
  }

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
    for (const a of input.getMenuActions()) if (a === 'pause') this.hud.togglePanel();
    const c = input.getControls();
    if (this.ended) {
      if (c.primaryPressed) this.newRun({ seed: (this.config.seed + 1) >>> 0 });
    }
    this.tick.moveX = Math.round(clamp(c.moveX, -1, 1) * 127);
    this.tick.moveY = Math.round(clamp(c.moveY, -1, 1) * 127);
    this.tick.buttons = (c.secondary ? BTN_SNEAK : 0) | (c.alt ? BTN_SPRINT : 0) | (c.primary ? BTN_INTERACT : 0);

    if (!this.paused && !this.ended) {
      this.acc += dt;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < MAX_STEPS) {
        takeSnapshot(this.sim, this.prev);
        const ev = step(this.sim, this.tick);
        if (ev.length) this.onEvents(ev);
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === MAX_STEPS) this.acc = 0; // slow device: run slower, never diverge
    }
    const alpha = this.paused || this.ended ? 1 : clamp(this.acc / SIM_DT, 0, 1);
    this.actors!.update(this.prev, this.sim, alpha, this.camera.cones);
    const f = this.actors!.focus;
    this.placeCamera(false, dt);
    const camPos = this.renderer.rig.camera.position;
    this.viewPts.camX = camPos.x;
    this.viewPts.camY = camPos.y;
    this.viewPts.camZ = camPos.z;
    this.actors!.viewPoints(this.viewPts, 16);
    this.view!.update(dt, f.x, f.z, this.camera.walls, this.viewPts);
    this.renderer.render(dt);
    this.updateHud();
  }

  private placeCamera(snap: boolean, dt = 0): void {
    const f = this.actors ? this.actors.focus : new THREE.Vector3(this.sim.student.x, 0, this.sim.student.z);
    if (!this.actors) f.set(this.sim.student.x, 0, this.sim.student.z);
    // Lead toward where the student is heading (up to 2 m), smoothed.
    const s = this.sim.student;
    const k = snap ? 1 : 1 - Math.exp(-3 * dt);
    this.lead.x += (clamp(s.vx * 0.45, -2, 2) - this.lead.x) * k;
    this.lead.y += (clamp(s.vz * 0.45, -2, 2) - this.lead.y) * k;
    const p = (this.camera.pitch * Math.PI) / 180;
    const d = this.camera.distance;
    const tx = f.x + this.lead.x;
    const tz = f.z + this.lead.y;
    this.renderer.rig.setGoal(
      { position: { x: tx, y: Math.sin(p) * d, z: tz + Math.cos(p) * d }, target: { x: tx, y: 0.6, z: tz }, fov: this.camera.fov },
      snap ? 60 : 9,
    );
    if (snap) this.renderer.rig.snap();
    // Sun follows the focus so the shadow map covers what's on screen.
    const sun = this.lights.sun;
    sun.target.position.set(tx, 0, tz);
    sun.position.set(tx - 26, 24, tz + 12);
  }

  private onEvents(ev: SimEvent[]): void {
    this.lastEvents = ev;
    for (const e of ev) {
      if (e.t === 'pickup') this.view?.setGoalDone(e.anchor, true);
      if (e.t === 'caught') {
        const who = this.plan.staff[e.staff]!.name;
        if (e.passUsed) this.flash(`${who}: "Oh — carry on."`, 'You showed your hall pass.');
        else if (this.sim.phase === 'playing') this.flash('BUSTED', `${who}: "Where are we going?" Walking you back…`);
      }
      if (e.t === 'end') this.onEnd(e.phase);
    }
  }

  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  private flash(title: string, sub: string): void {
    this.hud.showBanner(title, sub, null);
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      if (!this.ended) this.hud.hideBanner();
    }, 1800);
  }

  private onEnd(phase: 'success' | 'detention' | 'timeout'): void {
    this.ended = true;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    const s = this.sim;
    const left = Math.ceil(s.bell / 60);
    const title = phase === 'success' ? (s.spottings === 0 ? 'GHOST' : s.catches === 0 ? 'SMOOTH' : 'CLOSE CALL') : phase === 'detention' ? 'DETENTION' : 'THE BELL RANG';
    const sub =
      phase === 'success'
        ? `Back in your seat with ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} to spare. Spotted ${s.spottings}×, busted ${s.catches}×.`
        : phase === 'detention'
          ? 'Reason: wandering. Duration: emotionally, forever.'
          : 'You were not in your seat.';
    this.hud.showBanner(title, `${sub} Tap or press Space for the next school.`, () => this.newRun({ seed: (this.config.seed + 1) >>> 0 }));
  }

  private updateHud(): void {
    const s = this.sim;
    const goals = missionGoals(this.plan);
    const left = goals.filter((g) => !s.collected.includes(g)).length;
    const line = left > 0 ? (goals.length > 1 ? `${GOAL_LINE[this.config.mission]} (${goals.length - left}/${goals.length})` : GOAL_LINE[this.config.mission]) : 'Got it. Back to your seat!';
    const st = this.renderer.stats();
    this.hud.update({
      bellTicks: s.bell,
      missionLine: line,
      passes: s.passes,
      catches: s.catches,
      school: this.plan.name,
      seed: this.config.seed,
      tier: this.config.tier,
      mission: this.config.mission,
      difficulty: this.config.difficulty,
      camera: this.camera,
      stats:
        `${this.plan.name} (${missionName(this.config.mission)})\n` +
        `${st.fps} fps · ${st.drawCalls} draws · ${Math.round(st.triangles / 1000)}k tris · dpr ${st.pixelRatio}\n` +
        `${this.plan.staff.length} staff · ${this.view!.stats.wallBoxes} wall boxes · ${this.view!.stats.furniture} furniture\n` +
        `rerolls ${this.plan.rerolls}${this.plan.fallback ? ' (fallback)' : ''} · tick ${s.tick}`,
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

  // ── debug hooks (window.__HP__) ──
  debugApi() {
    return {
      screen: () => (this.ended ? 'results' : this.paused ? 'paused' : 'playing'),
      seed: () => this.config.seed,
      config: () => ({ ...this.config }),
      school: () => this.plan,
      staff: () => this.sim.staff.map((s, i) => ({ name: this.plan.staff[i]!.name, ...s })),
      state: () => this.sim,
      events: () => this.lastEvents,
      newRun: (c: Parameters<App['newRun']>[0]) => this.newRun(c),
      camera: (c?: Partial<CameraSettings>) => (c ? Object.assign(this.camera, c) : { ...this.camera }),
      teleport: (x: number, z: number) => {
        this.sim.student.x = x;
        this.sim.student.z = z;
      },
      warp: (seconds: number) => {
        for (let i = 0; i < seconds * 60 && this.sim.phase === 'playing'; i++) {
          takeSnapshot(this.sim, this.prev);
          const ev = step(this.sim, { moveX: 0, moveY: 0, buttons: 0 });
          if (ev.length) this.onEvents(ev);
        }
      },
      panel: (open: boolean) => this.hud.togglePanel(open),
      stats: () => ({ ...this.renderer.stats(), ...this.view!.stats, cut: this.view!.cutCount(), focus: [this.actors!.focus.x, this.actors!.focus.z] }),
      ready: () => true,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.input.dispose();
    this.view?.dispose();
    this.actors?.dispose();
    this.renderer.dispose();
    this.root.textContent = '';
  }
}
