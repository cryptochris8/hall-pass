// ─────────────────────────────────────────────────────────────────────────────
// The game's sound director (integration; docs/GDD.md §14): turns what the game is
// doing into audio calls. Music by screen; the sneak track's layers from the
// suspicion on screen; the hallway ambience during a run, muffled while you hide;
// every SimEvent mapped to an effect or a babble voice, panned and attenuated by
// where it happened relative to the student; footsteps from the distance walked.
// Pure mapping helpers are exported for tests.
// ─────────────────────────────────────────────────────────────────────────────
import type { AudioEngine, MusicTrack, SfxName, SfxOptions } from '../audio/types';
import type { Archetype, SchoolPlan } from '../school/types';
import { inZone } from '../sim/detect';
import type { SimEvent, SimState, SuspicionLevel } from '../sim/types';

/** Screens the director knows about (a subset of the app's phases). */
export type SoundScreen = 'title' | 'menu' | 'loading' | 'intro' | 'playing' | 'paused' | 'outro' | 'report';

/** Base voice pitch per archetype (1 ≈ a low adult voice). */
const VOICE: Readonly<Record<Archetype, number>> = {
  patroller: 0.95,
  sentry: 1.2,
  investigator: 0.82,
  sweeper: 1,
  wanderer: 1.08,
  snitch: 1.75,
  listener: 1.4,
};

/** The voice of staff member i: archetype base ± a little per person (stable per plan). */
export function voicePitch(plan: Pick<SchoolPlan, 'staff'>, i: number): number {
  const sp = plan.staff[i];
  if (!sp) return 1;
  if (sp.skin === 'secretary0') return 1.45;
  const wobble = [0, 0.08, -0.06, 0.12, -0.1][i % 5]!;
  return VOICE[sp.archetype] * (1 + wobble);
}

/** Music track for a screen (null: leave whatever is playing). */
export function musicFor(screen: SoundScreen): MusicTrack | null {
  switch (screen) {
    case 'title':
      return 'title';
    case 'menu':
      return 'menu';
    case 'loading':
      return null;
    case 'intro':
      return 'none';
    case 'playing':
    case 'paused':
      return 'sneak';
    case 'outro':
      return 'none';
    case 'report':
      return 'report';
  }
}

const LEVEL_VALUE: Readonly<Record<SuspicionLevel, number>> = { calm: 0, curious: 0.45, searching: 0.6, spotted: 1 };

/** Sneak-track intensity from the sim: the most alarmed staff member, chases count as spotted; the last 20 s add tension. */
export function suspicionIntensity(s: SimState): number {
  let v = 0;
  for (const st of s.staff) {
    if (st.mode === 'chase' || st.mode === 'search') v = Math.max(v, st.mode === 'chase' ? 1 : 0.6);
    v = Math.max(v, LEVEL_VALUE[st.level]);
  }
  if (s.phase === 'playing' && s.bell < 20 * 60) v = Math.max(v, 0.4);
  return v;
}

/** Pan and distance falloff for a sound at (x, z) heard from the student. */
export function placeAt(s: SimState, x: number, z: number): { pan: number; volume: number } {
  const dx = x - s.student.x;
  const dz = z - s.student.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  return { pan: Math.max(-0.8, Math.min(0.8, dx / 12)), volume: Math.max(0.25, Math.min(1, 1 - d / 30)) };
}

/** Stride lengths (m) per posture for footsteps. */
const STRIDE = { sneak: 0.6, walk: 0.8, sprint: 1.15 } as const;

export class SoundDirector {
  private screen: SoundScreen = 'title';
  private intensity = 0;
  private holdChase = 0;
  private stride = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private paTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly audio: AudioEngine) {}

  /** The app changed screen. `run` = a player run is loaded (not the attract run). */
  setScreen(screen: SoundScreen, run: boolean): void {
    this.screen = screen;
    const track = musicFor(screen);
    if (track) this.audio.setMusic(track);
    this.audio.setPaused(screen === 'paused');
    const inRun = run && (screen === 'intro' || screen === 'playing' || screen === 'paused' || screen === 'outro');
    this.audio.setAmbience(inRun ? 0.6 : -1);
    if (!inRun) this.audio.setMuffled(false);
    if (screen === 'intro') this.audio.play('flyover');
    if (screen !== 'playing' && screen !== 'paused') {
      this.intensity = 0;
      this.audio.setIntensity(0);
    }
  }

  /** Per frame while a player run is live: intensity (with a short hold after a chase), muffle, footsteps. */
  update(s: SimState, plan: SchoolPlan, dt: number): void {
    if (this.screen !== 'playing') return;
    let v = suspicionIntensity(s);
    if (v >= 1) this.holdChase = 2;
    else if (this.holdChase > 0) {
      this.holdChase -= dt;
      v = Math.max(v, 0.6);
    }
    if (Math.abs(v - this.intensity) > 0.01) {
      this.intensity = v;
      this.audio.setIntensity(v);
    }
    this.audio.setMuffled(s.student.hidden >= 0);
    // Footsteps from the distance actually walked.
    const st = s.student;
    if (Number.isFinite(this.lastX) && st.hidden < 0 && st.escort === 0) {
      const d = Math.hypot(st.x - this.lastX, st.z - this.lastZ);
      if (d < 2) {
        this.stride += d;
        const len = STRIDE[st.posture];
        if (this.stride >= len) {
          this.stride -= len;
          const polished = inZone(plan.zones, 'polished', st.x, st.z);
          if (st.posture === 'sprint') this.audio.play('squeak', { volume: polished ? 1 : 0.75 });
          else this.audio.play('step', { volume: st.posture === 'sneak' ? 0.22 : polished ? 0.75 : 0.55 });
        }
      }
    }
    this.lastX = st.x;
    this.lastZ = st.z;
  }

  /** A new run: reset the footstep tracker. */
  reset(): void {
    this.lastX = NaN;
    this.lastZ = NaN;
    this.stride = 0;
    this.holdChase = 0;
    if (this.paTimer) clearTimeout(this.paTimer);
    this.paTimer = null;
  }

  /** Sounds for this tick's sim events. */
  onEvents(ev: readonly SimEvent[], s: SimState, plan: SchoolPlan): void {
    const at = (i: number): SfxOptions => {
      const st = s.staff[i];
      return st ? placeAt(s, st.x, st.z) : {};
    };
    const say = (name: SfxName, i: number): void => this.audio.play(name, { ...at(i), pitch: voicePitch(plan, i) });
    const chasing = (): boolean => s.staff.some((st) => st.mode === 'chase');
    for (const e of ev) {
      switch (e.t) {
        case 'suspicion':
          if (plan.staff[e.staff]?.archetype === 'sweeper') break;
          if (e.level === 'curious') this.audio.play('curious', at(e.staff));
          else if (e.level === 'spotted') {
            this.audio.play('spotted');
            say('vHey', e.staff);
          }
          break;
        case 'heard':
          say('vHm', e.staff);
          break;
        case 'chase':
          if (e.on && plan.staff[e.staff]?.archetype === 'patroller') this.audio.play('whistle', at(e.staff));
          if (!e.on && e.escaped && !chasing()) this.audio.play('lostThem');
          break;
        case 'caught':
          if (e.passUsed) {
            this.audio.play('passFlash');
            say('vCarryOn', e.staff);
          } else if (s.phase === 'playing') {
            this.audio.play('busted');
            setTimeout(() => say('vWhere', e.staff), 350);
          }
          break;
        case 'hide':
          this.audio.play(e.enter ? 'lockerIn' : 'lockerOut');
          break;
        case 'found':
          this.audio.play('found');
          break;
        case 'throw':
          this.audio.play('throw');
          break;
        case 'noise':
          if (e.source === 'throw') this.audio.play('eraserLand', placeAt(s, e.x, e.z));
          else if (e.source === 'vending' && s.student.buying > 0) this.audio.play('vendRattle');
          break;
        case 'grabThrowable':
          this.audio.play('grab');
          break;
        case 'pickup':
          if (plan.mission !== 'vending') this.audio.play('item');
          break;
        case 'snack':
          this.audio.play('snack');
          break;
        case 'buy':
          if (e.on) this.audio.play('vendWhir');
          else if (e.done) {
            this.audio.play('vendClunk');
            this.audio.play('item');
          } else this.audio.play('buyCancel');
          break;
        case 'report':
          say('vTattle', e.staff);
          break;
        case 'cameraAlert':
          this.audio.play('cameraAlert', at(e.camera));
          break;
        case 'pa':
          this.audio.play('paChime');
          if (this.paTimer) clearTimeout(this.paTimer);
          this.paTimer = setTimeout(() => this.audio.play('vAnnounce', { pitch: e.id === 'carLights' || e.id === 'hatsOff' ? 1.15 : 0.95 }), 1000);
          break;
        case 'bell':
          if (e.secondsLeft > 0) this.audio.play('clockTick');
          break;
        case 'lunchBell':
          this.audio.play('lunchBell');
          break;
        case 'shoo':
          this.audio.play('vNotYet', { pitch: 1.35 });
          break;
        case 'end':
          this.audio.play(e.phase === 'success' ? 'success' : e.phase === 'detention' ? 'detention' : 'bell');
          if (e.phase === 'timeout') setTimeout(() => this.audio.play('detention'), 1400);
          break;
        default:
          break;
      }
    }
  }
}
