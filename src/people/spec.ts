// ─────────────────────────────────────────────────────────────────────────────
// Body specs (pure): teen-sitcom proportions for every body the people module
// builds. Ported from Bad Hair Day's family specs (adults unchanged) plus a TEEN
// body: 1.68 m, head ≈ 1/4.6 of the height, longer limbs than BHD's kids.
// Boys and girls share the teen body; they read through hair, face and clothes.
// Model-space metres, feet at y = 0, facing +Z, standing rest (bind) pose.
// ─────────────────────────────────────────────────────────────────────────────

export type BodyKind = 'man' | 'woman' | 'teen';

export interface BodySpec {
  readonly kind: BodyKind;
  /** Top of the head (m, without hair volume). */
  readonly height: number;
  readonly headRx: number;
  readonly headRy: number;
  readonly headRz: number;
  /** Head centre above / in front of the head bone pivot (top of the neck). */
  readonly headCY: number;
  readonly headCZ: number;
  readonly hipsY: number;
  readonly spineY: number;
  readonly chestY: number;
  readonly neckY: number;
  readonly shoulderY: number;
  readonly shoulderX: number;
  readonly hipX: number;
  readonly thighL: number;
  readonly shinL: number;
  readonly ankleY: number;
  readonly upperArmL: number;
  readonly foreArmL: number;
  readonly handR: number;
  readonly armR: number;
  readonly legR: number;
  readonly torsoW: number;
  readonly torsoD: number;
  readonly waistW: number;
  readonly waistD: number;
  readonly hipW: number;
  readonly hipD: number;
  readonly footL: number;
  readonly footW: number;
  readonly eyeR: number;
  readonly eyeYaw: number;
  readonly eyePitch: number;
  readonly browPitch: number;
  readonly nosePitch: number;
  readonly mouthPitch: number;
  readonly iris: number;
  /** Gait scale relative to an adult (step lengths). */
  readonly scale: number;
  /** Always false here (kept for ported code paths that soften kids' proportions). */
  readonly kid: boolean;
}

type Base = Omit<BodySpec, 'hipsY' | 'neckY' | 'scale' | 'kid'>;

function finish(b: Base): BodySpec {
  const hipJoint = b.thighL + b.shinL + b.ankleY;
  const headC = b.height - b.headRy;
  return { ...b, hipsY: hipJoint + b.legR * 0.75, neckY: headC - b.headCY, scale: (b.thighL + b.shinL) / 0.8, kid: false };
}

export const SPECS: Readonly<Record<BodyKind, BodySpec>> = {
  teen: finish({
    kind: 'teen',
    height: 1.68,
    headRx: 0.172,
    headRy: 0.183,
    headRz: 0.17,
    headCY: 0.152,
    headCZ: 0.012,
    spineY: 0.93,
    chestY: 1.065,
    shoulderY: 1.248,
    shoulderX: 0.2,
    hipX: 0.088,
    thighL: 0.378,
    shinL: 0.368,
    ankleY: 0.064,
    upperArmL: 0.282,
    foreArmL: 0.246,
    handR: 0.06,
    armR: 0.0525,
    legR: 0.083,
    torsoW: 0.172,
    torsoD: 0.118,
    waistW: 0.152,
    waistD: 0.108,
    hipW: 0.166,
    hipD: 0.12,
    footL: 0.22,
    footW: 0.084,
    eyeR: 0.052,
    eyeYaw: 0.35,
    eyePitch: -0.05,
    browPitch: 0.43,
    nosePitch: -0.22,
    mouthPitch: -0.48,
    iris: 0.66,
  }),
  man: finish({
    kind: 'man',
    height: 1.78,
    headRx: 0.178,
    headRy: 0.198,
    headRz: 0.175,
    headCY: 0.166,
    headCZ: 0.012,
    spineY: 0.96,
    chestY: 1.11,
    shoulderY: 1.315,
    shoulderX: 0.225,
    hipX: 0.097,
    thighL: 0.39,
    shinL: 0.375,
    ankleY: 0.068,
    upperArmL: 0.3,
    foreArmL: 0.255,
    handR: 0.071,
    armR: 0.0648,
    legR: 0.0938,
    torsoW: 0.205,
    torsoD: 0.14,
    waistW: 0.19,
    waistD: 0.13,
    hipW: 0.185,
    hipD: 0.128,
    footL: 0.24,
    footW: 0.096,
    eyeR: 0.047,
    eyeYaw: 0.34,
    eyePitch: -0.03,
    browPitch: 0.44,
    nosePitch: -0.2,
    mouthPitch: -0.46,
    iris: 0.62,
  }),
  woman: finish({
    kind: 'woman',
    height: 1.66,
    headRx: 0.168,
    headRy: 0.186,
    headRz: 0.166,
    headCY: 0.152,
    headCZ: 0.012,
    spineY: 0.91,
    chestY: 1.045,
    shoulderY: 1.232,
    shoulderX: 0.193,
    hipX: 0.09,
    thighL: 0.365,
    shinL: 0.355,
    ankleY: 0.064,
    upperArmL: 0.272,
    foreArmL: 0.238,
    handR: 0.062,
    armR: 0.0551,
    legR: 0.087,
    torsoW: 0.172,
    torsoD: 0.122,
    waistW: 0.148,
    waistD: 0.11,
    hipW: 0.178,
    hipD: 0.128,
    footL: 0.21,
    footW: 0.083,
    eyeR: 0.049,
    eyeYaw: 0.35,
    eyePitch: -0.05,
    browPitch: 0.42,
    nosePitch: -0.22,
    mouthPitch: -0.48,
    iris: 0.64,
  }),
};

/** Head centre in model space (standing rest pose). */
export function headCenter(s: BodySpec): [number, number, number] {
  return [0, s.neckY + s.headCY, s.headCZ];
}

export function hipJointY(s: BodySpec): number {
  return s.thighL + s.shinL + s.ankleY;
}
