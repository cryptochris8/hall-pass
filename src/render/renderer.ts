// ─────────────────────────────────────────────────────────────────────────────
// Renderer core (integration): one WebGLRenderer + one Scene for the whole game,
// the shared camera rig, adaptive pixel ratio (QualityGovernor), the projector
// used by world-anchored UI, and shader pre-compilation. The stadium owns every
// light, the sky and fog; events add their props under their own root group.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { clamp } from '../core/math';
import { CameraRigImpl } from './camera';
import { PAL } from './palette';
import { QualityGovernor } from './quality';
import type { Projector, Quality, RenderStats } from './types';

/** Stadium detail tier for a quality setting: 'auto' is high on desktops, low on touch-first phones. */
export function detailTier(quality: Quality, touchPrimary: boolean): 'high' | 'low' {
  if (quality === 'high') return 'high';
  if (quality === 'low') return 'low';
  return touchPrimary ? 'low' : 'high';
}

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig = new CameraRigImpl();
  readonly canvas: HTMLCanvasElement;
  readonly projector: Projector;
  private readonly governor: QualityGovernor;
  private width = 1;
  private height = 1;
  private ratio = 1;
  private frameEma = 1 / 60;
  private compiled = false;
  private disposed = false;
  private readonly v = new THREE.Vector3();

  constructor(container: HTMLElement, quality: Quality) {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    this.renderer = new THREE.WebGLRenderer({ antialias: dpr < 2, alpha: false, stencil: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true; // lights toggle castShadow; the flag itself never flips
    this.renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap was removed in three r186
    this.renderer.setClearColor(PAL.skyTop, 1);
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.touchAction = 'none';
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    container.appendChild(this.canvas);
    this.scene.name = 'hallPass';
    this.governor = new QualityGovernor(quality, Math.min(dpr, 2));

    const cam = this.rig.camera;
    const out = this.v;
    this.projector = {
      project: (world, res) => {
        out.set(world.x, world.y, world.z).applyMatrix4(cam.matrixWorldInverse);
        if (out.z > -cam.near) {
          res.visible = false;
          return;
        }
        out.applyMatrix4(cam.projectionMatrix);
        res.x = ((out.x + 1) / 2) * this.width;
        res.y = ((1 - out.y) / 2) * this.height;
        res.visible = out.x >= -1.05 && out.x <= 1.05 && out.y >= -1.05 && out.y <= 1.05;
      },
    };
    this.resize(container.clientWidth || 1280, container.clientHeight || 720, dpr);
  }

  private readonly onContextLost = (e: Event): void => {
    e.preventDefault(); // let the browser restore the context
  };

  setQuality(q: Quality): void {
    this.governor.setMode(q);
    this.applyRatio(this.governor.ratio);
  }

  resize(width: number, height: number, dprCap: number): void {
    if (this.disposed) return;
    this.width = Math.max(1, Math.floor(width));
    this.height = Math.max(1, Math.floor(height));
    this.governor.setMaxRatio(clamp(dprCap, 0.5, 2));
    this.rig.setAspect(this.width / this.height);
    this.applyRatio(this.governor.ratio);
  }

  private applyRatio(ratio: number): void {
    this.ratio = ratio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(this.width, this.height, true);
  }

  /** Recompile shaders on the next frame (after big scene changes) to avoid mid-play hitches. */
  invalidateCompile(): void {
    this.compiled = false;
  }

  render(realDt: number): void {
    if (this.disposed) return;
    if (realDt > 0 && realDt < 0.5) this.frameEma += (realDt - this.frameEma) * 0.05;
    const ratio = this.governor.update(realDt);
    if (Math.abs(ratio - this.ratio) > 1e-3) this.applyRatio(ratio);
    this.rig.update(realDt);
    const cam = this.rig.camera;
    if (!this.compiled) {
      this.compiled = true;
      this.renderer.compile(this.scene, cam);
    }
    this.renderer.render(this.scene, cam);
  }

  stats(): RenderStats {
    const info = this.renderer.info.render;
    return { fps: Math.round(1 / Math.max(1e-3, this.frameEma)), drawCalls: info.calls, triangles: info.triangles, pixelRatio: this.ratio };
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false);
    this.scene.clear();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
