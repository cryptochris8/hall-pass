// ─────────────────────────────────────────────────────────────────────────────
// Shared camera rig (implements CameraRig, src/render/types.ts). Events set a
// goal (position + target + fov) every frame or once; the rig eases toward it
// with a frame-rate independent exponential approach, then layers trauma-based
// shake and FOV kicks on top. Also a slow orbit mode for menus / ceremony.
// Portrait screens get a wider vertical FOV so 16:9-designed framing still fits.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { clamp } from '../core/math';
import type { CameraGoal, CameraRig, Vec3Like } from './types';

export const DEFAULT_FOV = 55;
/** Aspect the event framings are designed for. */
export const DESIGN_ASPECT = 16 / 9;

/**
 * Vertical FOV to use for a designed FOV on a given aspect: on screens narrower than 16:9 the FOV
 * widens toward keeping the designed horizontal coverage (65 % of the way), capped at 100°.
 */
export function effectiveFov(fov: number, aspect: number): number {
  if (!(aspect > 0) || aspect >= DESIGN_ASPECT) return fov;
  const half = THREE.MathUtils.degToRad(fov / 2);
  const required = THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(half) * DESIGN_ASPECT) / aspect));
  return Math.min(100, fov + (required - fov) * 0.65);
}

/** Exponential approach factor for a stiffness (1/s) over dt; ≥ 60 counts as locked. */
export function approachFactor(stiffness: number, dt: number): number {
  if (stiffness >= 60) return 1;
  if (stiffness <= 0 || dt <= 0) return 0;
  return 1 - Math.exp(-stiffness * dt);
}

/** Smooth pseudo-noise in [-1, 1] (sum of incommensurate sines) — deterministic shake. */
export function shakeNoise(t: number, seed: number): number {
  return (Math.sin(t * 37.1 + seed * 1.7) * 0.5 + Math.sin(t * 23.3 + seed * 4.1) * 0.3 + Math.sin(t * 61.7 + seed * 2.9) * 0.2);
}

interface Orbit {
  center: THREE.Vector3;
  radius: number;
  height: number;
  speed: number;
  fov: number;
  angle: number;
}

export class CameraRigImpl implements CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  /** Player setting: when false, shake() and kick() do nothing. */
  shakeEnabled = true;

  private readonly goalPos = new THREE.Vector3(0, 6, 14);
  private readonly goalTarget = new THREE.Vector3(0, 1, 0);
  private goalFov = DEFAULT_FOV;
  private stiffness = 6;
  private readonly pos = new THREE.Vector3(0, 6, 14);
  private readonly target = new THREE.Vector3(0, 1, 0);
  private fov = DEFAULT_FOV;
  private snapNext = true;
  private orbitState: Orbit | null = null;
  private trauma = 0;
  private fovKick = 0;
  private time = 0;
  private aspect = DESIGN_ASPECT;
  private readonly dir = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();

  constructor() {
    // Far plane covers the stadium's sky dome + skyline (stadium STADIUM_ENV.cameraFar = 1200).
    this.camera = new THREE.PerspectiveCamera(DEFAULT_FOV, DESIGN_ASPECT, 0.1, 1300);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.target);
  }

  setGoal(goal: CameraGoal, stiffness = 6): void {
    this.orbitState = null;
    this.goalPos.set(goal.position.x, goal.position.y, goal.position.z);
    this.goalTarget.set(goal.target.x, goal.target.y, goal.target.z);
    this.goalFov = goal.fov ?? DEFAULT_FOV;
    this.stiffness = stiffness;
  }

  snap(): void {
    this.snapNext = true;
  }

  shake(amount: number): void {
    if (!this.shakeEnabled || !(amount > 0)) return;
    this.trauma = clamp(this.trauma + amount, 0, 1);
  }

  kick(fovDelta: number): void {
    if (!this.shakeEnabled || !Number.isFinite(fovDelta)) return;
    this.fovKick = clamp(this.fovKick + fovDelta, -20, 20);
  }

  orbit(center: Vec3Like, radius: number, height: number, speed: number, fov = DEFAULT_FOV): void {
    const prev = this.orbitState;
    // Continue from the current angle around the new centre so switching orbits doesn't jump.
    const angle = prev ? prev.angle : Math.atan2(this.pos.x - center.x, this.pos.z - center.z);
    this.orbitState = { center: new THREE.Vector3(center.x, center.y, center.z), radius, height, speed, fov, angle };
    this.stiffness = 3;
  }

  get yaw(): number {
    this.camera.getWorldDirection(this.dir);
    return Math.atan2(-this.dir.x, -this.dir.z);
  }

  get orbiting(): boolean {
    return this.orbitState !== null;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect > 0 ? aspect : DESIGN_ASPECT;
    this.camera.aspect = this.aspect;
  }

  /** Advance easing/shake and write the camera transform. Call once per frame after gameplay. */
  update(dt: number): void {
    const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    this.time += d;
    const o = this.orbitState;
    if (o) {
      o.angle += o.speed * d;
      this.goalPos.set(o.center.x + Math.sin(o.angle) * o.radius, o.center.y + o.height, o.center.z + Math.cos(o.angle) * o.radius);
      this.goalTarget.copy(o.center);
      this.goalFov = o.fov;
    }
    const k = this.snapNext ? 1 : approachFactor(this.stiffness, d);
    this.snapNext = false;
    this.pos.lerp(this.goalPos, k);
    this.target.lerp(this.goalTarget, k);
    this.fov += (this.goalFov - this.fov) * k;

    // Decay trauma (~0.6 s from full) and the FOV kick.
    this.trauma = Math.max(0, this.trauma - d * 1.6);
    this.fovKick *= Math.exp(-d * 7);
    if (Math.abs(this.fovKick) < 0.01) this.fovKick = 0;

    const cam = this.camera;
    cam.position.copy(this.pos);
    const s = this.trauma * this.trauma;
    if (s > 0) {
      const amp = 0.35 * s;
      cam.position.x += shakeNoise(this.time, 1) * amp;
      cam.position.y += shakeNoise(this.time, 2) * amp;
      cam.position.z += shakeNoise(this.time, 3) * amp;
    }
    this.tmp.copy(this.target);
    cam.lookAt(this.tmp);
    if (s > 0) cam.rotateZ(shakeNoise(this.time, 4) * 0.035 * s);
    const fov = effectiveFov(this.fov + this.fovKick, this.aspect);
    if (Math.abs(cam.fov - fov) > 1e-3 || cam.aspect !== this.aspect) {
      cam.fov = fov;
      cam.aspect = this.aspect;
      cam.updateProjectionMatrix();
    }
  }

  /** Debug snapshot. */
  debug(): { pos: number[]; target: number[]; fov: number; trauma: number } {
    const r = (v: number): number => Math.round(v * 100) / 100;
    return { pos: [r(this.pos.x), r(this.pos.y), r(this.pos.z)], target: [r(this.target.x), r(this.target.y), r(this.target.z)], fov: r(this.camera.fov), trauma: r(this.trauma) };
  }
}
