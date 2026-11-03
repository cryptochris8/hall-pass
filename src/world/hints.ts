// Hint footprints on the floor (docs/GDD.md §11): soft pale prints along the next stretch of a safe route, fading
// in when the player has stalled and out again once they move on. Pooled meshes, one shared geometry + material.
import * as THREE from 'three';
import type { Footprint } from '../game/hints';

const MAX = 24;

export interface HintView {
  readonly root: THREE.Group;
  /** Show these prints (null: fade out). */
  set(prints: readonly Footprint[] | null): void;
  update(dt: number): void;
  dispose(): void;
}

export function buildHints(): HintView {
  const root = new THREE.Group();
  root.name = 'hints';
  // A sneaker print: an oval sole and a smaller heel.
  const sole = new THREE.CircleGeometry(0.5, 16);
  sole.scale(0.16, 0.24, 1);
  sole.translate(0, 0.06, 0);
  const heel = new THREE.CircleGeometry(0.5, 12);
  heel.scale(0.13, 0.13, 1);
  heel.translate(0, -0.17, 0);
  const geo = new THREE.BufferGeometry();
  const merged = [sole, heel];
  const pos: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const g of merged) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
    g.dispose();
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const prints: THREE.Mesh[] = [];
  for (let i = 0; i < MAX; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    m.renderOrder = 2;
    root.add(m);
    prints.push(m);
  }
  let target = 0;
  let opacity = 0;
  let t = 0;
  return {
    root,
    set(list) {
      if (!list) {
        target = 0;
        return;
      }
      target = 1;
      prints.forEach((m, i) => {
        const p = list[i];
        m.visible = !!p;
        if (!p) return;
        // Feet sit either side of the line, toes pointing along the route.
        const ox = Math.cos(p.yaw) * 0.14 * p.side;
        const oz = -Math.sin(p.yaw) * 0.14 * p.side;
        m.position.set(p.x + ox, 0.05, p.z + oz);
        m.rotation.y = p.yaw + Math.PI;
      });
    },
    update(dt) {
      t += dt;
      opacity += (target - opacity) * Math.min(1, dt * (target > opacity ? 2 : 4));
      // A slow shimmer running along the prints shows the direction.
      mat.opacity = opacity * (0.85 + 0.15 * Math.sin(t * 3));
      if (opacity < 0.01 && target === 0) for (const m of prints) m.visible = false;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      root.removeFromParent();
    },
  };
}
