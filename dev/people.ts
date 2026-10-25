// People dev page: every role in a lineup. Rows = idle · sneak · walk · sprint (treadmill: the roots stay put).
// URL params:
//   view=lineup (default: idle row, close; gait=idle|sneak|walk|sprint, yaw=<rad> turns everyone) | gaits (all four rows) | faces (expression sheet) | actions (action sheet)
//   role=<PersonRole> (faces/actions sheet subject) · seed=N (base seed) · expr=<PersonExpression> (everyone)
//   action=<PersonAction> (everyone, re-played) · look=<rad> (everyone) · t=<s> (pre-roll) · freeze=1 (stop after pre-roll)
//   labels=0 (hide the name tags)
import * as THREE from 'three';
import { createHarness } from './harness';
import { createPerson, type Gait, type Person, type PersonAction, type PersonExpression, type PersonRole } from '../src/people';
import { EXPRESSIONS } from '../src/people/expressions';
import { ACTIONS } from '../src/people/anim';
import { countTriangles } from '../src/render/models/builder';

const ROLES: PersonRole[] = ['student', 'extra', 'snitch', 'patroller', 'sentry', 'investigator', 'listener', 'wanderer'];
const NAMES: Record<PersonRole, string> = {
  student: 'Student',
  extra: 'Extra',
  snitch: 'Preston (snitch)',
  patroller: 'Mr. Dunlap (patroller)',
  sentry: 'Teacher (sentry)',
  investigator: 'VP Hargrove (investigator)',
  listener: 'Librarian (listener)',
  wanderer: 'Ms. Okafor (wanderer)',
};

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'lineup';
const seed0 = Number(params.get('seed') ?? 1) || 1;
const camByView: Record<string, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  lineup: { pos: [0.6, 1.9, 7.6], look: [0.6, 0.9, 0], fov: 38 },
  gaits: { pos: [0.4, 6.5, 9.5], look: [0.4, 0.4, -3.6], fov: 48 },
  faces: { pos: [0, 1.5, 5.6], look: [0, 1.38, 0], fov: 22 },
  actions: { pos: [0, 1.7, 9.6], look: [0, 0.95, 0], fov: 38 },
};
const cam = camByView[view] ?? camByView.lineup!;
const h = createHarness({ ground: 14, camera: cam });

interface Entry {
  p: Person;
  label: string;
  speed: number;
  gait: Gait;
  action?: PersonAction;
}
const people: Entry[] = [];
const add = (role: PersonRole, seed: number, x: number, z: number, speed: number, gait: Gait, label: string, yaw = 0): Person => {
  const p = createPerson({ role, seed });
  p.root.position.set(x, 0, z);
  p.root.rotation.y = yaw;
  h.scene.add(p.root);
  p.setMotion(speed, gait);
  people.push({ p, label, speed, gait });
  return p;
};

const GAP = 1.05;
const x0 = -((ROLES.length - 1) * GAP) / 2 + 0.6;
const GAITS: Record<string, [Gait, number]> = { idle: ['walk', 0], sneak: ['sneak', 1.4], walk: ['walk', 1.5], sprint: ['sprint', 5.2] };
if (view === 'lineup') {
  const [gait, speed] = GAITS[params.get('gait') ?? 'idle'] ?? GAITS.idle!;
  const yaw = params.has('yaw') ? Number(params.get('yaw')) : null;
  ROLES.forEach((r, i) => {
    const cartYaw = yaw ?? -1.15;
    add(r, seed0 + i, x0 + i * GAP + (r === 'wanderer' ? 0.25 : 0), r === 'wanderer' && yaw === null ? -0.3 : 0, speed, gait, NAMES[r], r === 'wanderer' ? cartYaw : (yaw ?? 0));
  });
} else if (view === 'gaits') {
  const rows: [Gait, number, string][] = [
    ['walk', 0, 'idle'],
    ['sneak', 1.4, 'sneak'],
    ['walk', 1.5, 'walk'],
    ['sprint', 5.2, 'sprint'],
  ];
  rows.forEach(([gait, speed, name], ri) =>
    ROLES.forEach((r, i) => add(r, seed0 + i, x0 + i * GAP * 1.25 - 0.8, -ri * 2.6, speed, gait, i === 0 ? name : '', 0.9)),
  );
} else if (view === 'faces') {
  const role = (params.get('role') ?? 'student') as PersonRole;
  EXPRESSIONS.forEach((e, i) => {
    const p = add(role, seed0, (i - (EXPRESSIONS.length - 1) / 2) * 0.44, 0, 0, 'walk', e);
    p.setExpression(e as PersonExpression);
  });
} else if (view === 'actions') {
  const role = (params.get('role') ?? 'patroller') as PersonRole;
  ACTIONS.forEach((a, i) => {
    add(role, seed0, (i - (ACTIONS.length - 1) / 2) * 0.88, 0, 0, 'walk', a);
    people[people.length - 1]!.action = a;
  });
}

const expr = params.get('expr') as PersonExpression | null;
const action = params.get('action') as PersonAction | null;
const look = params.has('look') ? Number(params.get('look')) : null;
for (const e of people) {
  if (expr) e.p.setExpression(expr);
  if (action) e.action = action;
  if (look !== null) e.p.setLook(look);
}

// Labels (DOM, projected).
const labels: { el: HTMLDivElement; p: Person }[] = [];
if (params.get('labels') !== '0') {
  for (const e of people) {
    if (!e.label) continue;
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = e.label;
    document.body.appendChild(el);
    labels.push({ el, p: e.p });
  }
}
const _v = new THREE.Vector3();
const placeLabels = () => {
  for (const l of labels) {
    _v.copy(l.p.root.position);
    _v.y -= 0.02;
    _v.project(h.camera);
    l.el.style.left = `${((_v.x + 1) / 2) * innerWidth}px`;
    l.el.style.top = `${((1 - _v.y) / 2) * innerHeight + 4}px`;
  }
};

// Actions re-play on a loop (each staggered).
const actT = people.map((_, i) => -0.3 * i);
const step = (dt: number) => {
  people.forEach((e, i) => {
    if (e.action) {
      actT[i] = actT[i]! - dt;
      if (actT[i]! <= 0) actT[i] = e.p.play(e.action) + 0.6;
    }
    e.p.update(dt);
  });
};
const pre = Number(params.get('t') ?? 0);
for (let t = 0; t < pre; t += 1 / 30) step(1 / 30);
const freeze = params.get('freeze') === '1';

const tris = people.map((e) => countTriangles(e.p.root));
h.setInfo(`${people.length} people · max ${Math.max(...tris)} tris/person`);
h.onUpdate((dt) => {
  step(freeze ? 0 : dt);
  placeLabels();
});
h.start();
window.__DEV__ = Object.assign(window.__DEV__ ?? {}, {
  people: people.map((e, i) => ({ role: e.p.role, label: e.label, height: e.p.height, tris: tris[i] })),
});
// ready is set by the harness after a few rendered frames.
