// ─────────────────────────────────────────────────────────────────────────────
// RENDER CONTRACT — renderer core, shared camera rig, particle/celebration FX.
// Owners: renderer core + camera = integration (src/render/renderer.ts, camera.ts);
//         FX = props module (src/render/fx/).
// FROZEN shared contract (see docs/ARCHITECTURE.md).
// ─────────────────────────────────────────────────────────────────────────────
import type * as THREE from 'three';

export type Quality = 'auto' | 'high' | 'low';

export interface RenderSettings {
  quality: Quality;
  /** Camera shake + FOV kicks (player setting; off = none at all). */
  screenShake: boolean;
  /** Reduce flashing lights / strobing celebrations (accessibility). */
  reducedFlashing: boolean;
}

export interface RenderStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  pixelRatio: number;
}

/** Plain vector shape accepted by APIs (THREE.Vector3 satisfies it). */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** World → screen (CSS px). `visible` false when behind the camera or off-screen. */
export interface Projector {
  project(world: Vec3Like, out: { x: number; y: number; visible: boolean }): void;
}

// ── Camera ────────────────────────────────────────────────────────────────────

export interface CameraGoal {
  /** Camera position (world). */
  position: Vec3Like;
  /** Point the camera looks at (world). */
  target: Vec3Like;
  /** Vertical FOV in degrees (default 55). */
  fov?: number;
}

/**
 * Shared camera rig. Events set a GOAL every frame (or once); the rig eases toward it
 * (critically damped, frame-rate independent) and layers shake + FOV kicks on top.
 * Portrait screens: the rig widens FOV automatically so framing designed for 16:9 still fits.
 */
export interface CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /**
   * Ease toward this view. `stiffness` ≈ 1/s (default 6; 0 = hold current; ≥ 60 ≈ locked).
   * Call every frame for follow cams (cheap, no allocations).
   */
  setGoal(goal: CameraGoal, stiffness?: number): void;
  /** Jump straight to the current goal next frame (cuts, event start). */
  snap(): void;
  /** Add trauma 0..1 (shake decays over ~0.5 s). Ignored when screen shake is off. */
  shake(amount: number): void;
  /** Brief FOV punch in degrees (e.g. +6 on a big hit). Ignored when screen shake is off. */
  kick(fovDelta: number): void;
  /** Slow orbit around `center` (menus, trophy ceremony). Replaced by the next setGoal/orbit. */
  orbit(center: Vec3Like, radius: number, height: number, speed: number, fov?: number): void;
  /** Current world yaw of the camera view direction (rad, 0 = looking toward −Z). */
  readonly yaw: number;
}

// ── FX (particles, confetti, trails, rings) ──────────────────────────────────

export type BurstKind =
  /** little white/grey puffs (footsteps, landings, skids) */
  | 'dust'
  /** bright additive sparks (impacts, perfect contact) */
  | 'spark'
  /** gold stars (bonus pickups, targets) */
  | 'star'
  /** chunky foam bits (obstacle hits, target smashes) */
  | 'foam'
  /** grass clods (kicks, ball landings on the field) */
  | 'turf'
  /** red/orange/yellow flame puffs (on-fire streaks) */
  | 'fire'
  /** tiny additive twinkles that hang in the air (hair shine glints, legendary brush) */
  | 'sparkle'
  /** pink hearts floating up (hugs, Ashley's coffee, Mom approved) */
  | 'heart'
  /** soap suds bubbles, slow and floaty (dishes) */
  | 'bubble'
  /** soft rising steam wisps (coffee) */
  | 'steam'
  /** fluttering autumn leaves (yard, the dog's leaf) */
  | 'leaf'
  /** water droplets (sink rinse, sprinkler, puddle) */
  | 'splash'
  /** little crumbs / cereal bits */
  | 'crumb';

export interface BurstOpts {
  /** Particle count (clamped by quality; default depends on kind). */
  count?: number;
  /** Override colour (hex). */
  color?: number;
  /** Initial speed scale (default 1). */
  speed?: number;
  /** Size scale (default 1). */
  size?: number;
  /** Bias direction (world, normalised by the FX system). */
  dir?: Vec3Like;
}

export interface TrailHandle {
  /** Stop emitting; the trail fades out and frees itself. */
  stop(): void;
  setColor(hex: number): void;
}

/**
 * Pooled particle/celebration system. All calls are cheap and allocation-free after warm-up;
 * the pool caps total particles (quality-dependent), oldest recycled first.
 */
export interface Fx {
  burst(kind: BurstKind, at: Vec3Like, opts?: BurstOpts): void;
  /** Confetti shower around a point (radius m). amount 0..1. */
  confetti(at: Vec3Like, radius?: number, amount?: number): void;
  /** Fireworks (school drop-off finale / results). count = shells. */
  fireworks(count?: number, at?: Vec3Like): void;
  /** Expanding ground ring (landing marker, score pulse). */
  ring(at: Vec3Like, color: number, radius?: number, seconds?: number): void;
  /** Ribbon trail following an object (balls in flight). */
  trail(target: THREE.Object3D, color: number, width?: number): TrailHandle;
  /** Remove everything (event switch). */
  clear(): void;
  update(dt: number, camera: THREE.Camera): void;
  readonly root: THREE.Object3D;
  /** Particle budget tier (optional: implementations may ignore it). */
  setQuality?(q: 'high' | 'low'): void;
  dispose(): void;
}
