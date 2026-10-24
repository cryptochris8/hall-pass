// ─────────────────────────────────────────────────────────────────────────────
// Model materials. One vertex-coloured MeshToonMaterial family (3-band toon
// gradient) extended via onBeforeCompile:
//   • ink hull  — vertices with a non-zero `aInk` are pushed out along it by a
//                 camera-distance-dependent width and painted ink;
//   • glow      — vertices with a non-zero `aGlow` colour are drawn unlit in
//                 that colour (lamps, candles, legendary sheen, tail lights);
//   • tint/fade — per-instance materials (instanceMaterial) carry their own
//                 colour multiplier + opacity (raccoon hidden-dim, house fade).
// Shared variants are cached: never mutate a returned shared material.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PAL } from '../palette';
import { toonGradient } from '../toon';
import { INK_BASE } from './builder';
import { markShared } from './shared';

/** Outline width (m) = clamp(viewDistance × SCALE, MIN, MAX): roughly constant on screen. */
export const INK_WIDTH = { SCALE: 0.0019, MIN: INK_BASE, MAX: 0.05 } as const;

const shared = {
  uInkColor: { value: new THREE.Color(PAL.outline) },
  uInkScale: { value: INK_WIDTH.SCALE as number },
  uInkMin: { value: INK_WIDTH.MIN as number },
  uInkMax: { value: INK_WIDTH.MAX as number },
  uInkBase: { value: INK_BASE },
};

const VERT_PARS = /* glsl */ `
attribute vec3 aInk;
attribute vec3 aGlow;
varying float vInk;
varying vec3 vGlow;
uniform float uInkScale;
uniform float uInkMin;
uniform float uInkMax;
uniform float uInkBase;
`;

const VERT_INK = /* glsl */ `
vInk = step(0.0001, dot(aInk, aInk));
vGlow = aGlow;
if (vInk > 0.5) {
  vec4 inkP = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  inkP = instanceMatrix * inkP; // measure view distance at the instance's real position
  #endif
  vec4 inkMv = modelViewMatrix * inkP;
  float inkW = clamp(-inkMv.z * uInkScale, uInkMin, uInkMax) - uInkBase;
  transformed += aInk * max(inkW, 0.0);
}
`;

const FRAG_PARS = /* glsl */ `
varying float vInk;
varying vec3 vGlow;
uniform vec3 uInkColor;
uniform vec3 uTint;
uniform float uFade;
`;

const FRAG_BODY = /* glsl */ `
outgoingLight *= uTint;
if (vGlow.r + vGlow.g + vGlow.b > 0.001) outgoingLight = vGlow;
if (vInk > 0.5) outgoingLight = uInkColor;
diffuseColor.a *= uFade;
`;

export interface ModelMatOpts {
  /** Extra constant emissive (hex). */
  emissive?: number;
}

export interface InstanceUniforms {
  uTint: { value: THREE.Color };
  uFade: { value: number };
}

function build(key: string, o: ModelMatOpts, uniforms: InstanceUniforms): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonGradient() });
  if (o.emissive) m.emissive.setHex(o.emissive);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uInkColor = shared.uInkColor;
    shader.uniforms.uInkScale = shared.uInkScale;
    shader.uniforms.uInkMin = shared.uInkMin;
    shader.uniforms.uInkMax = shared.uInkMax;
    shader.uniforms.uInkBase = shared.uInkBase;
    shader.uniforms.uTint = uniforms.uTint;
    shader.uniforms.uFade = uniforms.uFade;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + VERT_INK);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <opaque_fragment>', FRAG_BODY + '#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'hp-model|' + (o.emissive ?? 0);
  m.name = 'hp-model-' + key;
  return m;
}

const cache = new Map<string, THREE.MeshToonMaterial>();
const sharedInstance: InstanceUniforms = { uTint: { value: new THREE.Color(1, 1, 1) }, uFade: { value: 1 } };

/** Shared vertex-coloured toon material for GeoBuilder geometry (needs aInk/aGlow attributes). */
export function modelMaterial(o: ModelMatOpts = {}): THREE.MeshToonMaterial {
  const key = String(o.emissive ?? 0);
  let m = cache.get(key);
  if (!m) {
    m = markShared(build(key, o, sharedInstance));
    cache.set(key, m);
  }
  return m;
}

/** A per-instance (NOT shared) model material with its own tint + fade uniforms. Dispose it yourself. */
export function instanceMaterial(o: ModelMatOpts = {}): { material: THREE.MeshToonMaterial; uniforms: InstanceUniforms } {
  const uniforms: InstanceUniforms = { uTint: { value: new THREE.Color(1, 1, 1) }, uFade: { value: 1 } };
  const material = build('inst', o, uniforms);
  return { material, uniforms };
}

/** Apply a fade to a per-instance material (switches transparency on/off only when needed). */
export function setFade(material: THREE.Material, uniforms: InstanceUniforms, alpha: number): void {
  const a = Math.max(0, Math.min(1, alpha));
  uniforms.uFade.value = a;
  const wantTransparent = a < 0.999;
  if (material.transparent !== wantTransparent) {
    material.transparent = wantTransparent;
    material.depthWrite = true;
    material.needsUpdate = true;
  }
}

// ── scenery: plain vertex-coloured toon (no ink / glow attributes) ─────────────
let sceneryMat: THREE.MeshToonMaterial | null = null;
export function sceneryMaterial(): THREE.MeshToonMaterial {
  if (!sceneryMat) {
    sceneryMat = markShared(new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonGradient() }));
    sceneryMat.name = 'hp-scenery';
  }
  return sceneryMat;
}

const basicCache = new Map<string, THREE.MeshBasicMaterial>();

/** Shared unlit material (halos, bulbs, highlight fills, sparkles). */
export function basicMaterial(
  color: number,
  o: { additive?: boolean; opacity?: number; vertexColors?: boolean; doubleSide?: boolean; depthWrite?: boolean } = {},
): THREE.MeshBasicMaterial {
  const key = `${color}|${o.additive ? 1 : 0}|${o.opacity ?? 1}|${o.vertexColors ? 1 : 0}|${o.doubleSide ? 1 : 0}|${o.depthWrite ?? 'd'}`;
  let m = basicCache.get(key);
  if (!m) {
    const transparent = !!o.additive || (o.opacity ?? 1) < 1;
    m = new THREE.MeshBasicMaterial({
      color,
      vertexColors: !!o.vertexColors,
      transparent,
      opacity: o.opacity ?? 1,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: o.depthWrite ?? !transparent,
      side: o.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      fog: !o.additive,
    });
    m.name = 'hp-basic';
    markShared(m);
    basicCache.set(key, m);
  }
  return m;
}

// ── house windows: per-house material, windows glow when their rank < uLit ─────
const WIN_VERT_PARS = /* glsl */ `
attribute float aRank;
varying float vRank;
`;
const WIN_FRAG_PARS = /* glsl */ `
varying float vRank;
uniform float uLit;
uniform vec3 uWarm;
uniform float uFade;
`;
const WIN_FRAG_BODY = /* glsl */ `
if (vRank < uLit) outgoingLight = uWarm * (0.85 + 0.15 * vColor.r);
diffuseColor.a *= uFade;
`;

export interface WindowUniforms {
  uLit: { value: number };
  uFade: { value: number };
}

/** Window glass material: dark blue glass by vertex colour, lit windows glow warm. One per house. */
export function windowMaterial(): { material: THREE.MeshToonMaterial; uniforms: WindowUniforms } {
  const uniforms: WindowUniforms = { uLit: { value: 0 }, uFade: { value: 1 } };
  const warm = new THREE.Color(PAL.windowWarm);
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonGradient() });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLit = uniforms.uLit;
    shader.uniforms.uFade = uniforms.uFade;
    shader.uniforms.uWarm = { value: warm };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIN_VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRank = aRank;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WIN_FRAG_PARS)
      .replace('#include <opaque_fragment>', WIN_FRAG_BODY + '#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'hp-window';
  m.name = 'hp-window';
  return { material: m, uniforms };
}

/** Per-house wall/roof material with fade support (plain vertex-coloured toon). */
export function fadeableSceneryMaterial(): { material: THREE.MeshToonMaterial; uniforms: { uFade: { value: number } } } {
  const uniforms = { uFade: { value: 1 } };
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: toonGradient() });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFade = uniforms.uFade;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFade;')
      .replace('#include <opaque_fragment>', 'diffuseColor.a *= uFade;\n#include <opaque_fragment>');
  };
  m.customProgramCacheKey = () => 'hp-fadeable';
  m.name = 'hp-fadeable';
  return { material: m, uniforms };
}
