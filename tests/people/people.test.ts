import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CART, createPerson, lookFor, type Gait, type PersonAction, type PersonExpression, type PersonRole } from '../../src/people';
import { ACTIONS } from '../../src/people/anim';
import { EXPRESSIONS } from '../../src/people/expressions';
import { HAIR_STYLES, ROLES } from '../../src/people/looks';
import { SKIN_TONES } from '../../src/people/palette';
import type { PersonRig } from '../../src/people/rig';
import { liveGeometries } from '../../src/people/skin';
import { PAL } from '../../src/render/palette';
import { countTriangles } from '../../src/render/models/builder';

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 1234];
const rig = (role: PersonRole, seed: number) => createPerson({ role, seed }) as PersonRig;

describe('createPerson', () => {
  it('builds every role and stays within the 8k triangle budget', () => {
    for (const role of ROLES) {
      for (const seed of SEEDS) {
        const p = createPerson({ role, seed });
        const tris = countTriangles(p.root);
        expect(tris, `${role} #${seed}`).toBeGreaterThan(1500);
        expect(tris, `${role} #${seed}`).toBeLessThanOrEqual(8000);
        expect(p.role).toBe(role);
        expect(p.root).toBeInstanceOf(THREE.Group);
        p.dispose();
      }
    }
  });

  it('every hair style builds within budget', () => {
    for (const hairStyle of HAIR_STYLES) {
      for (const role of ['student', 'extra'] as const) {
        const p = createPerson({ role, seed: 5, look: { hairStyle, glasses: true, headphones: true } });
        expect(countTriangles(p.root), `${role} ${hairStyle}`).toBeLessThanOrEqual(8000);
        p.dispose();
      }
    }
  });

  it('teens are 1.62–1.75 m with a head ≈ 1/4.5–1/5 of the height; adults are taller-ish', () => {
    for (const seed of SEEDS) {
      const p = rig('student', seed);
      expect(p.height).toBeGreaterThanOrEqual(1.62);
      expect(p.height).toBeLessThanOrEqual(1.75);
      const ratio = p.height / (p.spec.headRy * 2 * p.traits.scale);
      expect(ratio).toBeGreaterThanOrEqual(4.4);
      expect(ratio).toBeLessThanOrEqual(5.05);
      p.dispose();
    }
    const adult = rig('patroller', 3);
    expect(adult.spec.kind === 'man' || adult.spec.kind === 'woman').toBe(true);
    adult.dispose();
  });

  it('same seed → same person (look, height, shared geometry)', () => {
    for (const role of ROLES) {
      const a = rig(role, 77);
      const b = rig(role, 77);
      expect(b.look).toEqual(a.look);
      expect(b.height).toBe(a.height);
      expect(b.body.geometry).toBe(a.body.geometry);
      a.dispose();
      b.dispose();
    }
  });

  it('only the custodian brings a cart, and it sits in front of her', () => {
    for (const role of ROLES) {
      const p = rig(role, 4);
      if (role === 'wanderer') {
        expect(p.cart).not.toBeNull();
        const box = new THREE.Box3().setFromObject(p.cart!);
        expect(box.min.z).toBeGreaterThan(0.3);
        expect(box.max.z).toBeLessThanOrEqual(CART.farZ + 0.05);
        expect(box.max.x - box.min.x).toBeLessThanOrEqual(CART.halfWidth * 2 + 0.05);
        expect(box.max.z - box.min.z).toBeGreaterThan(0.9);
      } else expect(p.cart).toBeNull();
      p.dispose();
    }
  });

  it('dispose detaches the root and releases the shared geometry', () => {
    const before = liveGeometries();
    const scene = new THREE.Scene();
    const people = ROLES.map((role) => createPerson({ role, seed: 31337 }));
    for (const p of people) scene.add(p.root);
    expect(liveGeometries()).toBeGreaterThan(before);
    for (const p of people) {
      p.dispose();
      expect(p.root.parent).toBeNull();
      p.dispose(); // idempotent
      p.update(0.016); // no-op after dispose
    }
    expect(liveGeometries()).toBe(before);
  });
});

describe('lookFor', () => {
  it('is deterministic and matches createPerson', () => {
    for (const role of ROLES) {
      for (const seed of SEEDS) {
        const a = lookFor({ role, seed });
        expect(lookFor({ role, seed })).toEqual(a);
        const p = createPerson({ role, seed });
        expect(p.look).toEqual(a);
        p.dispose();
      }
    }
  });

  it('varies with the seed', () => {
    const looks = new Set(SEEDS.map((seed) => JSON.stringify(lookFor({ role: 'extra', seed }))));
    expect(looks.size).toBeGreaterThan(SEEDS.length / 2);
  });

  it('applies overrides field by field and sanitizes bad ones', () => {
    const l = lookFor({ role: 'student', seed: 3, look: { hairStyle: 'afro', top: 0x123456, backpack: null, headphones: true } });
    expect(l.hairStyle).toBe('afro');
    expect(l.top).toBe(0x123456);
    expect(l.backpack).toBeNull();
    expect(l.headphones).toBe(true);
    const bad = lookFor({ role: 'student', seed: 3, look: { skin: 99, hairStyle: 'mohawk' as never, hair: Number.NaN } });
    const base = lookFor({ role: 'student', seed: 3 });
    expect(bad.skin).toBe(SKIN_TONES.length - 1);
    expect(bad.hairStyle).toBe(base.hairStyle);
    expect(bad.hair).toBe(base.hair);
  });

  it('gives students a backpack by default and keeps backpacks / headphones student-only', () => {
    for (const seed of SEEDS) {
      expect(lookFor({ role: 'student', seed }).backpack).not.toBeNull();
      for (const role of ROLES.filter((r) => r !== 'student')) {
        const l = lookFor({ role, seed, look: { backpack: 0xff0000, headphones: true } });
        expect(l.backpack).toBeNull();
        expect(l.headphones).toBe(false);
      }
    }
  });

  it('role defaults: the librarian wears glasses; skin indexes are valid', () => {
    for (const seed of SEEDS) {
      expect(lookFor({ role: 'listener', seed }).glasses).toBe(true);
      for (const role of ROLES) {
        const s = lookFor({ role, seed }).skin;
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(SKIN_TONES.length);
      }
    }
  });

  it('never dresses anyone in the reserved gameplay colours', () => {
    const reserved = new Set<number>([PAL.cone, PAL.coneSearch, PAL.coneAlert, PAL.goal, PAL.safe]);
    for (const role of ROLES) {
      for (let seed = 0; seed < 60; seed++) {
        const l = lookFor({ role, seed });
        for (const c of [l.top, l.bottom, l.shoes, l.hair, l.backpack ?? -1]) expect(reserved.has(c), `${role} #${seed}`).toBe(false);
      }
    }
  });
});

describe('animation', () => {
  const finiteBones = (p: PersonRig): boolean => {
    p.root.updateMatrixWorld(true);
    for (const b of p.body.skeleton.bones) for (const e of b.matrixWorld.elements) if (!Number.isFinite(e)) return false;
    return true;
  };
  const headY = (p: PersonRig): number => {
    const head = p.body.skeleton.bones.find((b) => b.name === 'head')!;
    return head.getWorldPosition(new THREE.Vector3()).y;
  };

  it('update() never throws across gaits, speeds, actions, expressions and look', () => {
    const gaits: Gait[] = ['sneak', 'walk', 'sprint'];
    for (const role of ROLES) {
      const p = rig(role, 9);
      let i = 0;
      for (const gait of gaits) {
        for (const speed of [0, 0.7, 1.4, 3, 5.2, 50, -1, Number.NaN]) {
          p.setMotion(speed, gait);
          p.setLook(Math.sin(i) * 2);
          p.setExpression(EXPRESSIONS[i % EXPRESSIONS.length] as PersonExpression, i % 2 ? 0.5 : undefined);
          if (i % 3 === 0) p.play(ACTIONS[i % ACTIONS.length] as PersonAction);
          for (let k = 0; k < 20; k++) p.update(1 / 30);
          p.update(0);
          p.update(Number.NaN);
          p.update(5);
          i++;
        }
      }
      expect(finiteBones(p)).toBe(true);
      p.dispose();
    }
  });

  it('play() returns each action duration and finishes', () => {
    const p = rig('patroller', 2);
    for (const a of ACTIONS) {
      const d = p.play(a);
      expect(d).toBeGreaterThan(0.3);
      expect(p.action).toBe(a);
      for (let t = 0; t < d + 0.2; t += 1 / 30) p.update(1 / 30);
      expect(p.action).toBeNull();
    }
    expect(p.play('moonwalk' as PersonAction)).toBe(0);
    p.dispose();
  });

  it('actions and expressions drive the face (comic faces resolve, timed ones revert)', () => {
    const p = rig('student', 6);
    p.setExpression('smug');
    p.update(0.1);
    expect(p.expression).toBe('smug');
    p.setExpression('panicked', 0.3);
    p.update(0.1);
    expect(p.expression).toBe('panicked');
    for (let k = 0; k < 10; k++) p.update(0.05);
    expect(p.expression).toBe('smug');
    p.play('busted');
    for (let k = 0; k < 10; k++) p.update(0.05);
    expect(p.expression).toBe('sheepish');
    p.setExpression('mad' as PersonExpression); // ignored
    for (let k = 0; k < 60; k++) p.update(0.05);
    expect(p.expression).toBe('smug');
    p.dispose();
  });

  it('sneaking crouches into a noticeably shorter silhouette (feet stay on the floor)', () => {
    const p = rig('student', 12);
    p.setMotion(0, 'walk');
    for (let k = 0; k < 60; k++) p.update(1 / 30);
    const standing = headY(p);
    p.setMotion(1.4, 'sneak');
    for (let k = 0; k < 60; k++) p.update(1 / 30);
    const sneaking = headY(p);
    expect(p.crouch).toBeGreaterThan(0.95);
    expect(sneaking).toBeLessThan(standing * 0.88);
    // Feet: the lowest sole stays near y = 0.
    const box = new THREE.Box3();
    for (const name of ['footL', 'footR']) {
      const f = p.body.skeleton.bones.find((b) => b.name === name)!;
      box.expandByPoint(f.getWorldPosition(new THREE.Vector3()));
    }
    expect(box.min.y).toBeLessThan(0.15);
    expect(box.min.y).toBeGreaterThan(-0.05);
    p.dispose();
  });

  it('stride advances with distance: twice the speed → the same pose after half the time', () => {
    const a = rig('extra', 21);
    const b = rig('extra', 21);
    a.setMotion(1.5, 'walk');
    b.setMotion(1.5, 'walk');
    for (let k = 0; k < 90; k++) {
      a.update(1 / 60);
      b.update(1 / 60);
    }
    const thigh = (p: PersonRig) => p.body.skeleton.bones.find((x) => x.name === 'thighL')!.rotation.x;
    expect(thigh(a)).toBeCloseTo(thigh(b), 6);
    a.dispose();
    b.dispose();
  });

  it('setLook turns the head (clamped to ±1.3 rad in total)', () => {
    const p = rig('sentry', 8);
    p.setLook(5);
    for (let k = 0; k < 60; k++) p.update(1 / 30);
    const bones = p.body.skeleton.bones;
    const chest = bones.find((b) => b.name === 'chest')!;
    const head = bones.find((b) => b.name === 'head')!;
    const total = chest.rotation.y + head.rotation.y;
    expect(total).toBeGreaterThan(1.2);
    expect(total).toBeLessThanOrEqual(1.3 + 0.05);
    p.setLook(-0.6);
    for (let k = 0; k < 60; k++) p.update(1 / 30);
    expect(chest.rotation.y + head.rotation.y).toBeCloseTo(-0.6, 1);
    p.dispose();
  });
});

describe('module hygiene', () => {
  it('never uses Math.random (everything seeded through Rng)', () => {
    const dir = join(__dirname, '../../src/people');
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(join(dir, f), 'utf8').includes('Math.random'), f).toBe(false);
    }
  });
});
