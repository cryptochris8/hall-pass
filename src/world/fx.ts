// ─────────────────────────────────────────────────────────────────────────────
// Stealth feedback in the world (integration): noise rings that ripple out on the
// floor to the radius staff can hear (GDD §5 "drawn as a ring on the floor for a
// moment"), and thrown erasers flying in an arc to where they'll land. Driven by
// sim events; purely visual. Pooled, no per-frame allocation.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PAL } from '../render/palette';
import { toon } from '../render/toon';
import type { NoiseSource, SimEvent } from '../sim/types';

const RINGS = 12;
const THROWS = 4;

interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  t: number;
  life: number;
  radius: number;
}

interface Flight {
  mesh: THREE.Mesh;
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  t: number;
  dur: number;
}

const RING_COLOR: Record<NoiseSource, number> = {
  step: PAL.uiPaper,
  sprint: PAL.uiPaper,
  throw: PAL.coneSearch,
  hide: PAL.uiPaper,
  pickup: PAL.uiPaper,
  vending: PAL.coneSearch,
};

export interface StealthFx {
  readonly root: THREE.Group;
  onEvents(events: readonly SimEvent[]): void;
  update(dt: number): void;
  dispose(): void;
}

export function buildStealthFx(): StealthFx {
  const root = new THREE.Group();
  root.name = 'stealthFx';
  const ringGeo = new THREE.RingGeometry(0.92, 1, 48);
  ringGeo.rotateX(-Math.PI / 2);
  const ballGeo = new THREE.BoxGeometry(0.16, 0.08, 0.1);
  const rings: Ring[] = [];
  for (let i = 0; i < RINGS; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: PAL.uiPaper, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.visible = false;
    mesh.renderOrder = 2;
    mesh.position.y = 0.06;
    root.add(mesh);
    rings.push({ mesh, mat, t: 0, life: 0, radius: 1 });
  }
  const flights: Flight[] = [];
  for (let i = 0; i < THROWS; i++) {
    const mesh = new THREE.Mesh(ballGeo, toon(0xf2a7b8));
    mesh.visible = false;
    mesh.castShadow = true;
    root.add(mesh);
    flights.push({ mesh, fx: 0, fz: 0, tx: 0, tz: 0, t: 0, dur: 0 });
  }
  let nextRing = 0;
  let nextFlight = 0;
  return {
    root,
    onEvents(events) {
      for (const e of events) {
        if (e.t === 'noise') {
          const r = rings[nextRing]!;
          nextRing = (nextRing + 1) % RINGS;
          r.mesh.position.set(e.x, 0.06, e.z);
          r.radius = e.radius;
          r.t = 0;
          r.life = e.source === 'sprint' ? 0.5 : 0.8;
          r.mat.color.setHex(RING_COLOR[e.source]);
          r.mesh.visible = true;
        } else if (e.t === 'throw') {
          const f = flights[nextFlight]!;
          nextFlight = (nextFlight + 1) % THROWS;
          f.fx = e.fromX;
          f.fz = e.fromZ;
          f.tx = e.toX;
          f.tz = e.toZ;
          f.t = 0;
          f.dur = e.ticks / 60;
          f.mesh.visible = true;
        }
      }
    },
    update(dt) {
      for (const r of rings) {
        if (!r.mesh.visible) continue;
        r.t += dt;
        const u = Math.min(1, r.t / r.life);
        const s = r.radius * (0.25 + 0.75 * (1 - (1 - u) * (1 - u)));
        r.mesh.scale.set(s, 1, s);
        r.mat.opacity = 0.75 * (1 - u);
        if (u >= 1) r.mesh.visible = false;
      }
      for (const f of flights) {
        if (!f.mesh.visible) continue;
        f.t += dt;
        const u = Math.min(1, f.t / f.dur);
        f.mesh.position.set(f.fx + (f.tx - f.fx) * u, 1.2 + 2.2 * u * (1 - u) - 1.1 * u, f.fz + (f.tz - f.fz) * u);
        f.mesh.rotation.set(u * 9, u * 5, 0);
        if (u >= 1) f.mesh.visible = false;
      }
    },
    dispose() {
      ringGeo.dispose();
      ballGeo.dispose();
      for (const r of rings) r.mat.dispose();
      root.removeFromParent();
    },
  };
}

/** Gummy-bear snack packs (GDD §7 optional pickups): small bright bags that bob and spin until picked up. */
export interface SnackView {
  readonly root: THREE.Group;
  take(index: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function buildSnacks(spots: readonly { x: number; z: number }[]): SnackView {
  const root = new THREE.Group();
  root.name = 'snacks';
  const geo = new THREE.BoxGeometry(0.26, 0.32, 0.08);
  const mats = [toon(0xff5fa2), toon(0xffb23e), toon(0x6fd3a8)];
  const bags = spots.map((p, i) => {
    const m = new THREE.Mesh(geo, mats[i % mats.length]!);
    m.position.set(p.x, 0.55, p.z);
    m.castShadow = true;
    root.add(m);
    return m;
  });
  let t = 0;
  return {
    root,
    take(i) {
      const b = bags[i];
      if (b) b.visible = false;
    },
    update(dt) {
      t += dt;
      bags.forEach((b, i) => {
        b.position.y = 0.55 + 0.08 * Math.sin(t * 2.4 + i * 1.7);
        b.rotation.y = t * 1.6 + i;
      });
    },
    dispose() {
      geo.dispose(); // toon() materials are shared (cached): never disposed here
      root.removeFromParent();
    },
  };
}
