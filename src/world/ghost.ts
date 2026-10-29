// The ghost student (docs/GDD.md §8.2): your best run on this exact school, replayed as a see-through copy of the
// student. Same rig and look as the real one; every material cloned translucent and tinted (so the shared ones
// are untouched), no shadows. Driven by the ghost's own sim state; purely visual.
import * as THREE from 'three';
import { createPerson, type PersonLook } from '../people';
import type { Posture } from '../sim/types';

export interface GhostView {
  readonly root: THREE.Group;
  update(x: number, z: number, yaw: number, posture: Posture, visible: boolean, dt: number): void;
  dispose(): void;
}

export function buildGhost(seed: number, look: PersonLook | null = null): GhostView {
  const root = new THREE.Group();
  root.name = 'ghost';
  const person = createPerson({ role: 'student', seed, look: look ?? undefined });
  const clones: THREE.Material[] = [];
  const tint = new THREE.Color(0x9fd6ff);
  person.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = false;
    m.receiveShadow = false;
    const swap = (mat: THREE.Material): THREE.Material => {
      const c = mat.clone();
      c.transparent = true;
      c.opacity = 0.38;
      c.depthWrite = false;
      const col = (c as THREE.MeshToonMaterial).color;
      if (col) col.lerp(tint, 0.55);
      clones.push(c);
      return c;
    };
    m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
    m.renderOrder = 3;
  });
  root.add(person.root);
  let lastX = NaN;
  let lastZ = NaN;
  return {
    root,
    update(x, z, yaw, posture, visible, dt) {
      root.position.set(x, 0, z);
      root.rotation.y = yaw;
      root.visible = visible;
      if (dt > 0) {
        const sp = Number.isNaN(lastX) ? 0 : Math.hypot(x - lastX, z - lastZ) / dt;
        person.setMotion(Math.min(sp, 8), posture);
      }
      lastX = x;
      lastZ = z;
      person.update(dt);
    },
    dispose() {
      person.dispose();
      for (const c of clones) c.dispose();
      root.removeFromParent();
    },
  };
}
