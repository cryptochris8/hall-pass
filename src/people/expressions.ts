// ─────────────────────────────────────────────────────────────────────────────
// Expression → face targets (pure, frozen, shared; ported from Bad Hair Day).
// The rig smooths the numbers and swaps eye / mouth parts. Every face is comic
// (GDD §0): "stern" is an unimpressed flat line, "panicked" a cartoon gasp.
// Two internal faces back the actions: 'sheepish' (busted) and 'blow' (whistle),
// plus 'joy' (celebrate).
// ─────────────────────────────────────────────────────────────────────────────
import type { EyeShape, MouthKind } from './skeleton';
import type { PersonExpression } from './types';

export type Face = PersonExpression | 'sheepish' | 'blow' | 'joy';

export interface FaceTarget {
  eyeL: EyeShape;
  eyeR: EyeShape;
  mouth: MouthKind;
  /** Upper-lid closure added to the base (−1 = force wide open … 1 = closed). */
  lid: number;
  /** Extra lid closure on the right eye only (asymmetric squints). */
  lidR: number;
  /** Lid tilt: + = inner corners down (focused), − = inner corners up (worried). */
  lidTilt: number;
  lowLid: number;
  browY: number;
  /** + = inner ends down (stern), − = inner ends up (worried). */
  browTilt: number;
  /** Extra lift of the left brow (eye radii). */
  browAsym: number;
  pupil: number;
  pupilY: number;
  mouthScale: number;
  blush: number;
  /** Extra head pitch (+ = down) and roll. */
  headX: number;
  headZ: number;
  /** Eye-dart jitter amplitude (nervous / panicked), 0 = none. */
  dart: number;
}

export const EXPRESSIONS: readonly PersonExpression[] = ['neutral', 'smug', 'nervous', 'panicked', 'relieved', 'surprised', 'stern', 'suspicious', 'happy'];
const FACES: readonly Face[] = [...EXPRESSIONS, 'sheepish', 'blow', 'joy'];

function base(): FaceTarget {
  return { eyeL: 'open', eyeR: 'open', mouth: 'smile', lid: 0.06, lidR: 0, lidTilt: 0, lowLid: 0.08, browY: 0, browTilt: 0, browAsym: 0, pupil: 1, pupilY: 0, mouthScale: 0.85, blush: 0.5, headX: 0, headZ: 0, dart: 0 };
}

function build(e: Face): FaceTarget {
  const f = base();
  switch (e) {
    case 'neutral':
      break;
    case 'smug':
      f.mouth = 'smirk';
      f.mouthScale = 1;
      f.lid = 0.4;
      f.lowLid = 0.24;
      f.browAsym = 0.16;
      f.browTilt = 0.05;
      f.headX = -0.08;
      f.headZ = 0.08;
      break;
    case 'nervous':
      f.mouth = 'wavy';
      f.mouthScale = 0.85;
      f.browY = 0.2;
      f.browTilt = -0.42;
      f.lidTilt = -0.15;
      f.pupil = 0.88;
      f.blush = 0.9;
      f.headZ = 0.06;
      f.dart = 0.5;
      break;
    case 'panicked':
      f.mouth = 'open';
      f.mouthScale = 1.2;
      f.lid = -1;
      f.lowLid = 0;
      f.browY = 0.34;
      f.browTilt = -0.36;
      f.pupil = 0.66;
      f.blush = 0.9;
      f.headX = -0.05;
      f.dart = 1;
      break;
    case 'relieved':
      // "Phew": eyes peacefully closed, soft smile, brows relaxed up.
      f.eyeL = f.eyeR = 'closed';
      f.mouth = 'smile';
      f.mouthScale = 1.05;
      f.browY = 0.12;
      f.browTilt = -0.25;
      f.blush = 0.85;
      f.headX = -0.1;
      f.headZ = 0.05;
      break;
    case 'surprised':
      f.mouth = 'o';
      f.mouthScale = 1.25;
      f.lid = -1;
      f.lowLid = 0;
      f.browY = 0.3;
      f.browTilt = -0.15;
      f.pupil = 0.74;
      f.headX = -0.06;
      break;
    case 'stern':
      f.mouth = 'flat';
      f.mouthScale = 1;
      f.lid = 0.3;
      f.lidTilt = 0.12;
      f.lowLid = 0.12;
      f.browY = -0.08;
      f.browTilt = 0.3;
      f.blush = 0.3;
      f.headX = 0.04;
      break;
    case 'suspicious':
      // One eye narrowed, one brow up, mouth pulled flat: "hmmm…"
      f.mouth = 'flat';
      f.mouthScale = 0.8;
      f.lid = 0.32;
      f.lidR = 0.3;
      f.lowLid = 0.3;
      f.browAsym = 0.2;
      f.browTilt = 0.16;
      f.headZ = -0.08;
      f.headX = 0.03;
      break;
    case 'happy':
      f.mouth = 'bigSmile';
      f.mouthScale = 1;
      f.lowLid = 0.3;
      f.browY = 0.1;
      f.browTilt = -0.1;
      f.blush = 1;
      f.headX = -0.03;
      break;
    case 'sheepish':
      f.mouth = 'grin';
      f.mouthScale = 0.9;
      f.lid = 0.05;
      f.lowLid = 0.22;
      f.browY = 0.2;
      f.browTilt = -0.38;
      f.blush = 1.35;
      f.headX = 0.06;
      f.headZ = 0.12;
      break;
    case 'blow':
      f.mouth = 'o';
      f.mouthScale = 0.55;
      f.lid = 0.25;
      f.lowLid = 0.3;
      f.browY = 0.05;
      f.browTilt = 0.28;
      f.blush = 1.45;
      break;
    case 'joy':
      f.eyeL = f.eyeR = 'joy';
      f.mouth = 'grin';
      f.mouthScale = 1.05;
      f.browY = 0.16;
      f.browTilt = -0.15;
      f.blush = 1.1;
      f.headX = -0.08;
      break;
  }
  return f;
}

const TABLE = {} as Record<Face, Readonly<FaceTarget>>;
for (const e of FACES) TABLE[e] = Object.freeze(build(e));

/** Shared, frozen face targets (no per-frame allocation). */
export function faceFor(e: Face): Readonly<FaceTarget> {
  return TABLE[e] ?? TABLE.neutral;
}

export function isExpression(e: unknown): e is PersonExpression {
  return typeof e === 'string' && (EXPRESSIONS as readonly string[]).includes(e);
}
