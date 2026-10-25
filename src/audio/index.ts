// ─────────────────────────────────────────────────────────────────────────────
// HALL PASS audio engine (docs/GDD.md §14). Everything is synthesized at runtime
// with Web Audio: no files, no network, no paid APIs, no existing melodies.
//
//   createAudio() → AudioEngine   (contract: ./types.ts)
//
// • SFX (sfx.ts): every SfxName, with per-sound cooldowns / voice limits, priority
//   ducking, optional pan, and the school PA's slap-back echo.
// • Ambience (ambience.ts): fluorescent hum, classes through the walls, distant
//   lockers and doors, eased by setAmbience.
// • Music (music.ts / song.ts): four original tracks with crossfades; the sneak track
//   layers up with the suspicion on screen (setIntensity).
// • Mixer (mixer.ts): master / music / sfx(+ambience) volumes, pause ducks, the hiding
//   muffle, glue compressor + soft-clip ceiling so stacked hits never clip.
//
// The AudioContext is created lazily in unlock() (call it from a user gesture). Every
// method is a safe no-op until then — settings, the requested track, the intensity
// and the ambience level are remembered and applied on unlock.
//
// Robustness (copied from ATHLETE MAYHEM, which carried it over from Mailbox Mayhem /
// Trash Panda Trouble): nothing here may throw into the game loop. The context is
// watched for 'statechange' / 'error' and a stalled clock; a dead context is torn down
// and rebuilt — immediately when the page already has user activation, otherwise on the
// next tap/key. iOS 'interrupted' and hidden→visible both resume; the context is
// suspended while the tab is hidden. unlock() is cheap and idempotent.
// ─────────────────────────────────────────────────────────────────────────────
import { SchoolBed } from './ambience';
import { VoiceLimiter } from './limits';
import { buildMixer, duckParam, MIX_TRIM, MUFFLE_HZ, type Mixer, PAUSE_AMB, PAUSE_MUSIC } from './mixer';
import { MusicPlayer, type PlayableTrack } from './music';
import { playSfx, SFX_META } from './sfx';
import { silentBuffer, smoothSet } from './synth';
import type { AudioEngine, AudioVolumes, MusicTrack, SfxName, SfxOptions } from './types';

export type { AudioEngine } from './types';

/** Scheduler: wake every 25 ms, schedule 120 ms ahead. */
const TICK_MS = 25;
const LOOKAHEAD = 0.12;
/** A 'running' context whose clock has not moved for this long (wall ms, tab visible) is considered wedged. */
export const STALL_MS = 3000;
/** Retry resume() at most this often (wall ms) while locked but the page has user activation. */
export const RETRY_MS = 1000;
/** At most this many automatic rebuilds per minute (then wait for a user gesture). */
const MAX_REBUILDS_PER_MIN = 4;
/** Start offset for scheduled one-shots (s): a hair ahead of "now" so the attack is never clipped. */
const START_DELAY = 0.005;

/** Slider (0..1) → gain. Squared for a roughly perceptual taper. */
export function sliderToGain(v: number): number {
  const c = Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  return c * c;
}

/** How long the outgoing track takes to fade when switching to `next`. */
export function fadeOutFor(next: MusicTrack): number {
  return next === 'report' ? 0.35 : next === 'sneak' ? 0.8 : next === 'none' ? 1.2 : 1.0;
}

/** How long the incoming track takes to fade in (jingles and the event start on the beat). */
export function fadeInFor(track: PlayableTrack): number {
  return track === 'title' ? 0.6 : track === 'menu' ? 0.9 : track === 'sneak' ? 1.5 : 0.04;
}

type AudioCtor = typeof AudioContext;
type CtxState = AudioContextState | 'interrupted';

/**
 * Events that carry user activation (HTML spec) — any of them can unlock audio. Deliberately not
 * pointerdown/touchstart: for touch those don't grant activation (the context would stay suspended).
 */
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown', 'mousedown'] as const;

const noop = (): void => undefined;
const wallNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function hasBeenActive(): boolean {
  try {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    return !!ua && ua.hasBeenActive;
  } catch {
    return false;
  }
}
const docHidden = (): boolean => typeof document !== 'undefined' && !!document.hidden;

interface DuckState {
  until: number;
  depth: number;
}

/** Live numbers for the dev bench (not part of the contract). */
export interface AudioDebugInfo {
  state: string;
  track: MusicTrack;
  bpm: number;
  musicLevel: number;
  ambience: number;
  muffled: boolean;
  voices: number;
}

export class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private mix: Mixer | null = null;
  private volumes: AudioVolumes = { master: 1, music: 1, sfx: 1 };
  private isMuted = false;
  private paused = false;
  private track: MusicTrack = 'none';
  private intensity = 0;
  /** < 0 = bed off (until the first setAmbience). */
  private ambience = -1;
  private muffled = false;
  private player: MusicPlayer | null = null;
  private readonly fading: MusicPlayer[] = [];
  private bed: SchoolBed | null = null;
  private readonly limiter = new VoiceLimiter<string>();
  private readonly ducks: Record<'music' | 'minor', DuckState> = { music: { until: 0, depth: 0 }, minor: { until: 0, depth: 0 } };
  private timer: ReturnType<typeof setInterval> | null = null;
  private hiddenSuspended = false;
  private gestureArmed = false;
  private docListening = false;
  private disposed = false;
  private watchCtx = 0;
  private watchWall = 0;
  private lastRetry = -Infinity;
  private readonly rebuilds: number[] = [];

  get unlocked(): boolean {
    return !this.disposed && !!this.ctx && this.ctx.state === 'running';
  }

  get muted(): boolean {
    return this.isMuted;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  unlock(): void {
    if (this.disposed) return;
    try {
      let ctx = this.ctx;
      if (ctx && ctx.state === 'running') {
        this.disarmGestureResume();
        return;
      }
      if (ctx && ctx.state === 'closed') {
        this.teardown();
        ctx = null;
      }
      if (!ctx) {
        if (!this.build()) return;
        ctx = this.ctx!;
        if (ctx.state === 'running') {
          this.disarmGestureResume();
          return;
        }
      }
      if (!docHidden()) {
        this.hiddenSuspended = false;
        void ctx.resume().catch(noop);
      }
      // iOS/WebKit unlock: start a 1-sample silent buffer inside the gesture.
      const src = ctx.createBufferSource();
      src.buffer = silentBuffer(ctx);
      src.connect(ctx.destination);
      src.start(0);
      if (ctx.state !== 'running') this.armGestureResume();
    } catch {
      // Audio is optional — never let it crash the game. Re-arm so the next gesture retries.
      this.armGestureResume();
    }
  }

  /** Create the context + mixer graph and restart the current track / ambience bed. Returns false when Web Audio is unavailable. */
  private build(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as Window & { webkitAudioContext?: AudioCtor };
    const AC: AudioCtor | undefined = typeof AudioContext !== 'undefined' ? AudioContext : w.webkitAudioContext;
    if (!AC) return false;
    // iOS 17+: play through the ringer/silent switch like a game should.
    try {
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'playback';
    } catch {
      /* optional API */
    }
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    try {
      this.mix = buildMixer(ctx);
      this.applyVolumes(true);
      this.applyPause(true);
      ctx.addEventListener('statechange', this.onStateChange);
      ctx.addEventListener('error', this.onCtxError);
    } catch (e) {
      this.teardown();
      throw e;
    }
    if (this.timer === null) this.timer = setInterval(this.tick, TICK_MS);
    this.listenDocument();
    this.resetWatch();
    if (this.track !== 'none') this.startTrack(this.track);
    if (this.ambience >= 0) this.startBed();
    this.applyMuffle(true);
    return true;
  }

  private teardown(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.mix = null;
    this.player = null;
    this.fading.length = 0;
    this.bed = null;
    this.ducks.music.until = this.ducks.minor.until = 0;
    this.limiter.reset();
    if (!ctx) return;
    try {
      ctx.removeEventListener('statechange', this.onStateChange);
      ctx.removeEventListener('error', this.onCtxError);
      if (ctx.state !== 'closed') void ctx.close().catch(noop);
    } catch {
      /* already gone */
    }
  }

  private recover(): void {
    if (this.disposed) return;
    this.teardown();
    const now = wallNow();
    while (this.rebuilds.length && now - this.rebuilds[0]! > 60000) this.rebuilds.shift();
    if (this.rebuilds.length < MAX_REBUILDS_PER_MIN && hasBeenActive() && !docHidden()) {
      this.rebuilds.push(now);
      this.unlock();
    } else this.armGestureResume();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      this.disarmGestureResume();
      this.unlistenDocument();
    } catch {
      /* ignore */
    }
    this.teardown();
  }

  private listenDocument(): void {
    if (this.docListening || typeof document === 'undefined' || typeof window === 'undefined') return;
    this.docListening = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pageshow', this.onWake);
    window.addEventListener('focus', this.onWake);
  }

  private unlistenDocument(): void {
    if (!this.docListening) return;
    this.docListening = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pageshow', this.onWake);
    window.removeEventListener('focus', this.onWake);
  }

  private readonly onVisibility = (): void => {
    try {
      const ctx = this.ctx;
      if (docHidden()) {
        if (ctx && ctx.state === 'running') {
          this.hiddenSuspended = true;
          void ctx.suspend().catch(noop);
        }
      } else {
        this.hiddenSuspended = false;
        this.wake();
      }
    } catch {
      /* never throw from an event handler */
    }
  };

  private readonly onWake = (): void => {
    try {
      if (!docHidden()) this.wake();
    } catch {
      /* ignore */
    }
  };

  private wake(): void {
    if (this.disposed) return;
    const ctx = this.ctx;
    this.resetWatch();
    if (!ctx) return;
    const st = ctx.state as CtxState;
    if (st === 'closed') this.recover();
    else if (st !== 'running') {
      void ctx.resume().catch(noop);
      this.armGestureResume();
    }
  }

  private readonly onStateChange = (): void => {
    try {
      const st = this.ctx?.state as CtxState | undefined;
      if (!st || this.disposed) return;
      if (st === 'running') {
        this.disarmGestureResume();
        this.resetWatch();
      } else if (st === 'closed') this.recover();
      else if (!this.hiddenSuspended) this.armGestureResume();
    } catch {
      /* ignore */
    }
  };

  private readonly onCtxError = (): void => {
    try {
      this.recover();
    } catch {
      /* ignore */
    }
  };

  private armGestureResume(): void {
    if (this.gestureArmed || this.disposed || typeof window === 'undefined') return;
    this.gestureArmed = true;
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, { capture: true, passive: true });
  }

  private disarmGestureResume(): void {
    if (!this.gestureArmed) return;
    this.gestureArmed = false;
    for (const type of GESTURES) window.removeEventListener(type, this.onGesture, { capture: true });
  }

  private readonly onGesture = (): void => {
    this.unlock();
  };

  private resetWatch(): void {
    this.watchCtx = this.ctx?.currentTime ?? 0;
    this.watchWall = wallNow();
  }

  /** Ready to make sound right now? */
  private live(): Mixer | null {
    return !this.disposed && this.ctx && this.mix && this.ctx.state === 'running' ? this.mix : null;
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  setVolumes(v: AudioVolumes): void {
    if (!v) return;
    this.volumes = { master: v.master, music: v.music, sfx: v.sfx };
    this.safe(() => this.applyVolumes(false));
  }

  setMuted(muted: boolean): void {
    this.isMuted = !!muted;
    this.safe(() => this.applyVolumes(false));
  }

  private applyVolumes(instant: boolean): void {
    const m = this.mix;
    const ctx = this.ctx;
    if (!m || !ctx) return;
    const now = ctx.currentTime;
    const set = (p: AudioParam, v: number): void => {
      if (instant) {
        p.cancelScheduledValues(now);
        p.setValueAtTime(v, now);
      } else smoothSet(p, v, now, 0.04);
    };
    const sfx = sliderToGain(this.volumes.sfx);
    set(m.master.gain, this.isMuted ? 0 : sliderToGain(this.volumes.master));
    set(m.music.gain, sliderToGain(this.volumes.music) * MIX_TRIM.music);
    set(m.sfx.gain, sfx);
    set(m.amb.gain, sfx * MIX_TRIM.amb);
  }

  setPaused(paused: boolean): void {
    const p = !!paused;
    if (this.paused === p) return;
    this.paused = p;
    this.safe(() => this.applyPause(false));
  }

  private applyPause(instant: boolean): void {
    const m = this.mix;
    const ctx = this.ctx;
    if (!m || !ctx) return;
    const now = ctx.currentTime;
    const tc = instant ? 0.001 : 0.1;
    this.ducks.music.until = 0;
    smoothSet(m.musicDuck.gain, 1, now, tc);
    smoothSet(m.musicPause.gain, this.paused ? PAUSE_MUSIC : 1, now, tc);
    smoothSet(m.ambPause.gain, this.paused ? PAUSE_AMB : 1, now, tc);
  }

  setMuffled(muffled: boolean): void {
    const v = !!muffled;
    if (this.muffled === v) return;
    this.muffled = v;
    this.safe(() => this.applyMuffle(false));
  }

  private applyMuffle(instant: boolean): void {
    const m = this.mix;
    const ctx = this.ctx;
    if (!m || !ctx) return;
    smoothSet(m.muffle.frequency, this.muffled ? MUFFLE_HZ : 20000, ctx.currentTime, instant ? 0.001 : 0.08);
  }

  // ── Music ─────────────────────────────────────────────────────────────────

  setMusic(track: MusicTrack): void {
    if (track === this.track) return;
    if (track !== 'none' && !(['title', 'menu', 'sneak', 'report'] as const).includes(track)) return;
    this.track = track;
    this.safe(() => {
      if (this.ctx) this.startTrack(track);
    });
  }

  private startTrack(track: MusicTrack): void {
    const ctx = this.ctx;
    const m = this.mix;
    if (!ctx || !m) return;
    const now = ctx.currentTime;
    if (this.player) {
      this.player.stop(now, fadeOutFor(track));
      this.fading.push(this.player);
      this.player = null;
    }
    if (track === 'none') return;
    this.player = new MusicPlayer(ctx, m.music, track, now + 0.03, { fadeIn: fadeInFor(track), intensity: this.intensity });
    if (ctx.state === 'running') this.player.pump(now + LOOKAHEAD, now);
  }

  setIntensity(level: number): void {
    this.intensity = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
    this.safe(() => this.player?.setIntensity(this.intensity));
  }

  // ── Ambience ──────────────────────────────────────────────────────────────

  setAmbience(level: number): void {
    if (!Number.isFinite(level)) return;
    this.ambience = level < 0 ? -1 : Math.min(1, level);
    this.safe(() => {
      if (!this.ctx) return;
      if (this.ambience < 0) {
        this.bed?.stop(this.ctx.currentTime, 0.8);
        this.bed = null;
      } else if (this.bed) this.bed.setLevel(this.ambience, this.ctx.currentTime);
      else this.startBed();
    });
  }

  private startBed(): void {
    const ctx = this.ctx;
    const m = this.mix;
    if (!ctx || !m || this.ambience < 0) return;
    this.bed = new SchoolBed(ctx, m.ambBed, ctx.currentTime + 0.02, this.ambience);
  }

  // ── Scheduler heartbeat (also the lock-retry + stall watchdog) ────────────

  private readonly tick = (): void => {
    try {
      const ctx = this.ctx;
      if (!ctx || this.disposed) return;
      const w = wallNow();
      if (ctx.state !== 'running') {
        if (!this.hiddenSuspended && !docHidden() && ctx.state !== 'closed' && w - this.lastRetry >= RETRY_MS && hasBeenActive()) {
          this.lastRetry = w;
          void ctx.resume().catch(noop);
        }
        return;
      }
      const now = ctx.currentTime;
      if (now > this.watchCtx + 0.001) {
        this.watchCtx = now;
        this.watchWall = w;
      } else if (w - this.watchWall > STALL_MS && !docHidden()) {
        this.recover();
        return;
      }
      const until = now + LOOKAHEAD;
      this.player?.pump(until, now);
      for (let i = this.fading.length - 1; i >= 0; i--) {
        const p = this.fading[i]!;
        p.pump(until, now);
        if (p.finished) this.fading.splice(i, 1);
      }
      this.bed?.pump(until, now);
    } catch {
      // A scheduler hiccup must never escape the timer.
    }
  };

  // ── Priority ducking ──────────────────────────────────────────────────────

  private duck(music: number, minor: number, seconds: number, at: number): void {
    const m = this.mix;
    if (!m) return;
    if (music > 0 && this.claimDuck('music', music, seconds, at)) duckParam(m.musicDuck.gain, 1, music, seconds, at);
    if (minor > 0 && this.claimDuck('minor', minor, seconds, at)) duckParam(m.sfxMinor.gain, 1, minor, seconds, at);
  }

  /** A shallower duck never cuts short a deeper one that is still in effect. */
  private claimDuck(bus: 'music' | 'minor', depth: number, seconds: number, at: number): boolean {
    const d = this.ducks[bus];
    const until = at + seconds;
    if (at < d.until && d.depth > depth && d.until > until) return false;
    d.until = until;
    d.depth = depth;
    return true;
  }

  // ── SFX ───────────────────────────────────────────────────────────────────

  play(name: SfxName, opts?: SfxOptions): void {
    try {
      const m = this.live();
      if (!m || this.isMuted) return;
      const meta = SFX_META[name];
      if (!meta) return;
      const now = m.ctx.currentTime;
      if (!this.limiter.allow(name, meta, now)) return;
      const t = now + START_DELAY;
      const pitch = opts?.pitch !== undefined && Number.isFinite(opts.pitch) && opts.pitch > 0 ? opts.pitch : 1;
      const end = playSfx(m.ctx, meta.minor ? m.sfxMinor : m.sfx, name, t, { pitch, volume: opts?.volume, pan: opts?.pan, echo: m.echo });
      if (end <= t) return;
      this.limiter.commit(name, now, end);
      if (meta.duck) this.duck(meta.duck.music, meta.duck.minor, meta.duck.seconds, t);
    } catch {
      // A malformed option must never take the game down.
    }
  }

  /** Live numbers for the dev bench. */
  debugInfo(): AudioDebugInfo {
    return {
      state: this.disposed ? 'disposed' : (this.ctx?.state ?? 'none'),
      track: this.track,
      bpm: this.player?.bpm ?? 0,
      musicLevel: this.player?.intensityLevel ?? 0,
      ambience: this.bed?.currentLevel ?? -1,
      muffled: this.muffled,
      voices: this.limiter.count,
    };
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/** The engine with its dev-bench extras (debugInfo). */
export function createAudioEngine(): WebAudioEngine {
  return new WebAudioEngine();
}

export function createAudio(): AudioEngine {
  return new WebAudioEngine();
}
