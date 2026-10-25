// People module entry (contract: src/people/types.ts). STUB by the integrator until the people owner lands the
// ported rig: a capsule body + head so the world can integrate against the real API.
import * as THREE from 'three';
import { toon } from '../render/toon';
import type { Person, PersonLook, PersonSpec } from './types';

export * from './types';

const TOPS = [0x3b6fd6, 0x8a6f5a, 0x5a5f73, 0x6b3f5f, 0x5f7a6a, 0xb08a2e, 0x7a6a8f];

export function lookFor(spec: PersonSpec): PersonLook {
  return {
    skin: spec.seed % 8,
    hairStyle: 'short',
    hair: 0x3a2a1e,
    top: TOPS[spec.seed % TOPS.length]!,
    bottom: 0x2f3a52,
    shoes: 0xf2f2f2,
    glasses: false,
    backpack: spec.role === 'student' ? 0xc0392b : null,
    headphones: false,
    ...spec.look,
  };
}

export function createPerson(spec: PersonSpec): Person {
  const look = lookFor(spec);
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.75, 4, 12).translate(0, 0.66, 0), toon(look.top));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12).translate(0, 1.48, 0), toon(0xe8b48a));
  root.add(body, head);
  return {
    role: spec.role,
    look,
    root,
    height: 1.72,
    setMotion() {},
    setLook(yaw) {
      head.rotation.y = Math.max(-1.3, Math.min(1.3, yaw));
    },
    play() {
      return 0.5;
    },
    setExpression() {},
    update() {},
    dispose() {
      body.geometry.dispose();
      head.geometry.dispose();
      root.removeFromParent();
    },
  };
}
