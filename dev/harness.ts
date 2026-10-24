// Shared dev-page harness (dev server only — never in the build). Gives a module test page a renderer, scene,
// default lighting, a ground, a camera with drag-orbit + wheel zoom, URL-param framing for screenshots, a stats
// line and `window.__DEV__` for tools/shot.mjs --eval / --until.
//
//   import { createHarness } from './harness';
//   const h = createHarness({ camera: { pos: [0, 1.6, 3], look: [0, 1, 0] } });
//   h.scene.add(myThing); h.onUpdate((dt, t) => myThing.update(dt)); h.start();
//
// URL params: ?cam=x,y,z&look=x,y,z&fov=40 (framing) · ?bg=hex · ?time=minutes (for pages that use lighting keys)
//             ?still=1 (freeze the orbit auto-rotate) · ?stats=0 (hide the stats line)
import * as THREE from 'three';
import { GameRenderer } from '../src/render/renderer';
import { PAL } from '../src/render/palette';

export interface HarnessOpts {
  camera?: { pos: [number, number, number]; look: [number, number, number]; fov?: number };
  /** Default hemisphere + key light (disable when the page brings its own, e.g. the world). */
  lights?: boolean;
  /** A big soft floor disc at y = 0. */
  ground?: boolean | number;
  background?: number;
}

export interface Harness {
  readonly scene: THREE.Scene;
  readonly renderer: GameRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly params: URLSearchParams;
  onUpdate(fn: (dt: number, t: number) => void): void;
  /** Set the orbit target/position (also what URL params override). */
  frame(pos: [number, number, number], look: [number, number, number], fov?: number): void;
  /** Extra text for the stats line. */
  setInfo(text: string): void;
  start(): void;
}

declare global {
  interface Window {
    __DEV__?: Record<string, unknown> & { ready?: boolean; frames?: number };
  }
}

const vec = (s: string | null): [number, number, number] | null => {
  if (!s) return null;
  const p = s.split(',').map(Number);
  return p.length === 3 && p.every(Number.isFinite) ? [p[0]!, p[1]!, p[2]!] : null;
};

export function createHarness(opts: HarnessOpts = {}): Harness {
  const params = new URLSearchParams(location.search);
  const app = document.getElementById('app') ?? document.body;
  const r = new GameRenderer(app, 'high');
  const scene = r.scene;
  const bg = params.get('bg');
  scene.background = new THREE.Color(bg ? Number.parseInt(bg, 16) : (opts.background ?? 0xcfe6f2));
  if (opts.lights !== false) {
    const hemi = new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, 1.25);
    const key = new THREE.DirectionalLight(PAL.sun, 2.1);
    key.position.set(3, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -4;
    sc.right = sc.top = 4;
    scene.add(hemi, key, key.target);
  }
  if (opts.ground !== false && opts.ground !== undefined) {
    const size = typeof opts.ground === 'number' ? opts.ground : 6;
    const g = new THREE.Mesh(new THREE.CircleGeometry(size, 48), new THREE.MeshToonMaterial({ color: PAL.terrazzo }));
    g.rotation.x = -Math.PI / 2;
    g.receiveShadow = true;
    scene.add(g);
  }

  const cam = r.rig.camera;
  const target = new THREE.Vector3(...(opts.camera?.look ?? [0, 1, 0]));
  const pos = new THREE.Vector3(...(opts.camera?.pos ?? [0, 1.6, 4]));
  let fov = opts.camera?.fov ?? 40;
  const frame = (p: [number, number, number], l: [number, number, number], f?: number) => {
    pos.set(...p);
    target.set(...l);
    if (f) fov = f;
    r.rig.setGoal({ position: pos, target, fov }, 100);
    r.rig.snap();
  };
  frame(vec(params.get('cam')) ?? [pos.x, pos.y, pos.z], vec(params.get('look')) ?? [target.x, target.y, target.z], Number(params.get('fov')) || fov);

  // Drag to orbit, wheel to zoom (interactive inspection; screenshots use URL params).
  let dragging = false;
  let lx = 0;
  let ly = 0;
  r.canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
  });
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const off = pos.clone().sub(target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= (e.clientX - lx) * 0.008;
    sph.phi = Math.min(Math.PI - 0.05, Math.max(0.05, sph.phi - (e.clientY - ly) * 0.008));
    lx = e.clientX;
    ly = e.clientY;
    pos.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    r.rig.setGoal({ position: pos, target, fov }, 100);
  });
  r.canvas.addEventListener(
    'wheel',
    (e) => {
      const off = pos.clone().sub(target).multiplyScalar(e.deltaY > 0 ? 1.1 : 0.9);
      pos.copy(target).add(off);
      r.rig.setGoal({ position: pos, target, fov }, 100);
      e.preventDefault();
    },
    { passive: false },
  );

  const stats = document.createElement('div');
  stats.style.cssText =
    'position:fixed;left:8px;top:6px;font:600 12px/1.3 system-ui;color:#fff;text-shadow:0 1px 2px #000;z-index:10;pointer-events:none;white-space:pre';
  if (params.get('stats') !== '0') document.body.appendChild(stats);
  let info = '';

  const updates: ((dt: number, t: number) => void)[] = [];
  const onResize = () => r.resize(app.clientWidth || innerWidth, app.clientHeight || innerHeight, devicePixelRatio || 1);
  window.addEventListener('resize', onResize);
  window.__DEV__ = { ready: false, frames: 0 };

  return {
    scene,
    renderer: r,
    camera: cam,
    params,
    onUpdate: (fn) => void updates.push(fn),
    frame,
    setInfo: (t) => void (info = t),
    start() {
      onResize();
      let last = performance.now();
      let t = 0;
      const loop = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        t += dt;
        for (const fn of updates) fn(dt, t);
        r.render(dt);
        const s = r.stats();
        stats.textContent = `${s.drawCalls} calls · ${(s.triangles / 1000).toFixed(1)}k tris · ${s.fps} fps${info ? '\n' + info : ''}`;
        const d = window.__DEV__!;
        d.frames = (d.frames ?? 0) + 1;
        if (d.frames > 2) d.ready = true;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
  };
}
