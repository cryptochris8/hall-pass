// ─────────────────────────────────────────────────────────────────────────────
// GeoBuilder — assembles many primitive parts into ONE flat-shaded,
// vertex-coloured BufferGeometry (one draw call per model part group).
//
// Ink outlines are baked in as an "inverted hull": every inked part also emits a
// copy of its triangles with reversed winding, pushed out along smoothed normals
// and flagged through the `aInk` attribute (xyz = smoothed unit normal, zero on
// body vertices). The model material (materials.ts) paints flagged fragments in
// ink and widens the hull with camera distance so outlines stay ~2 px wide.
// Because the hull is already extruded by INK_BASE, it still reads as a (thin)
// outline under any renderer that ignores the shader hook.
//
// Attributes produced: position, normal, color (linear), and — unless
// `extras` is false (scenery) — aInk (vec3) and aGlow (vec3 linear colour that
// replaces the lit colour at night; zero = no glow).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { hashInts } from '../../core/rng';

export type V3 = readonly [number, number, number];

/** Outline thickness (m) baked into hull vertices. The shader adds more with distance. */
export const INK_BASE = 0.012;

export interface PartOpts {
  /** Position of the part's centre (for lathe: its base). */
  at?: V3;
  /** Euler XYZ rotation (rad). */
  rot?: V3;
  /** Scale applied before rotation. Negative components mirror (winding is fixed up). */
  scale?: V3;
  /** Emit an ink hull for this part (defaults to the builder's `ink`). */
  ink?: boolean;
  /** Night glow colour (hex). Omitted/0 = never glows. */
  glow?: number;
  /** Paint role tag (e.g. truck body/stripe/trim) so colours can be rewritten later. */
  role?: number;
  /** Welded pseudo-random vertex displacement (m) for organic shapes. */
  jitter?: number;
  /** Per-face brightness variation 0..1 (faceted low-poly look). */
  shade?: number;
  /** Seed for jitter/shade. */
  seed?: number;
  /**
   * Smooth shading: keep the source primitive's vertex normals (transformed) instead of flat face
   * normals. Use for rounded toy-like parts (heads, balls, limbs); leave off for faceted scenery.
   */
  smooth?: boolean;
}

const tmpColor = new THREE.Color();
const vA = new THREE.Vector3();
const vB = new THREE.Vector3();
const vC = new THREE.Vector3();
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const fn = new THREE.Vector3();
const mat = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler();
const vPos = new THREE.Vector3();
const vScale = new THREE.Vector3();
const nMat = new THREE.Matrix3();
const nA = new THREE.Vector3();

/** Linear-space RGB for a hex colour (three converts sRGB hex → linear working space). */
export function linear(hex: number): [number, number, number] {
  tmpColor.setHex(hex);
  return [tmpColor.r, tmpColor.g, tmpColor.b];
}

/** Hex colour helpers for build-time palette variation. */
export function shadeHex(hex: number, k: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((hex >> 16) & 255) * k)));
  const g = Math.min(255, Math.max(0, Math.round(((hex >> 8) & 255) * k)));
  const b = Math.min(255, Math.max(0, Math.round((hex & 255) * k)));
  return (r << 16) | (g << 8) | b;
}

export function mixHex(a: number, b: number, t: number): number {
  const ch = (s: number) => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) & 255;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Deterministic 0..1 hash of a few ints. */
export function hash01(...v: number[]): number {
  return hashInts(...v) / 4294967296;
}

export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private inkA: number[] = [];
  private glowA: number[] = [];
  /** One role tag per vertex (only meaningful for parts added with `role`). */
  readonly roles: number[] = [];
  private faceCounter = 0;

  /**
   * @param ink    default outline setting for parts
   * @param extras emit aInk/aGlow attributes (needed by modelMaterial; scenery skips them)
   */
  constructor(
    private readonly ink = true,
    private readonly extras = true,
  ) {}

  /** Number of triangles added so far (body + hull). */
  get triangles(): number {
    return this.pos.length / 9;
  }

  /** Add any three.js geometry (indexed or not). The temp geometry is disposed. */
  add(geo: THREE.BufferGeometry, color: number, o: PartOpts = {}): this {
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const index = geo.getIndex();
    const triCount = index ? index.count / 3 : posAttr.count / 3;

    // Transform matrix.
    const s = o.scale ?? [1, 1, 1];
    euler.set(o.rot?.[0] ?? 0, o.rot?.[1] ?? 0, o.rot?.[2] ?? 0, 'XYZ');
    quat.setFromEuler(euler);
    vPos.set(o.at?.[0] ?? 0, o.at?.[1] ?? 0, o.at?.[2] ?? 0);
    vScale.set(s[0], s[1], s[2]);
    mat.compose(vPos, quat, vScale);
    const mirrored = s[0] * s[1] * s[2] < 0;

    const jitter = o.jitter ?? 0;
    const seed = o.seed ?? 0;
    const shade = o.shade ?? 0;
    const doInk = (o.ink ?? this.ink) && this.extras;
    const [cr, cg, cb] = linear(color);
    const glow = o.glow ? linear(o.glow) : ([0, 0, 0] as const);
    const role = o.role ?? 0;
    const normAttr = o.smooth ? (geo.getAttribute('normal') as THREE.BufferAttribute | undefined) : undefined;
    if (normAttr) nMat.getNormalMatrix(mat);

    // Pass 1: transformed triangle corners + flat face normals (degenerates dropped).
    const tri: number[] = [];
    const nrm: number[] = [];
    /** Per-corner smooth normals (only when `smooth`). */
    const cnr: number[] = [];
    const read = (i: number, out: THREE.Vector3) => {
      out.fromBufferAttribute(posAttr, i);
      if (jitter > 0) {
        const kx = Math.round(out.x * 1000);
        const ky = Math.round(out.y * 1000);
        const kz = Math.round(out.z * 1000);
        out.x += (hash01(kx, ky, kz, seed, 1) - 0.5) * 2 * jitter;
        out.y += (hash01(kx, ky, kz, seed, 2) - 0.5) * 2 * jitter;
        out.z += (hash01(kx, ky, kz, seed, 3) - 0.5) * 2 * jitter;
      }
      out.applyMatrix4(mat);
    };
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      let i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      let i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      if (mirrored) [i1, i2] = [i2, i1];
      read(i0, vA);
      read(i1, vB);
      read(i2, vC);
      e1.subVectors(vB, vA);
      e2.subVectors(vC, vA);
      fn.crossVectors(e1, e2);
      const len = fn.length();
      if (len < 1e-9) continue; // degenerate (cone tips, collapsed hexa faces)
      fn.multiplyScalar(1 / len);
      tri.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      nrm.push(fn.x, fn.y, fn.z);
      if (normAttr) {
        for (const i of [i0, i1, i2]) {
          nA.fromBufferAttribute(normAttr, i).applyMatrix3(nMat).normalize();
          // Guard against primitives whose seam normals point inward relative to the face.
          if (nA.dot(fn) < -0.2) nA.copy(fn);
          cnr.push(nA.x, nA.y, nA.z);
        }
      }
    }

    // Smoothed per-position normals for the hull, weighted by each face's corner
    // angle so the result is independent of triangulation (a box corner gets the
    // true diagonal → equal outline width on every side).
    let smooth: Map<string, [number, number, number]> | null = null;
    const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    if (doInk) {
      smooth = new Map();
      for (let f = 0; f < nrm.length / 3; f++) {
        for (let c = 0; c < 3; c++) {
          const o9 = f * 9 + c * 3;
          const p1 = f * 9 + ((c + 1) % 3) * 3;
          const p2 = f * 9 + ((c + 2) % 3) * 3;
          e1.set(tri[p1]! - tri[o9]!, tri[p1 + 1]! - tri[o9 + 1]!, tri[p1 + 2]! - tri[o9 + 2]!);
          e2.set(tri[p2]! - tri[o9]!, tri[p2 + 1]! - tri[o9 + 1]!, tri[p2 + 2]! - tri[o9 + 2]!);
          const w = e1.angleTo(e2);
          const k = key(tri[o9]!, tri[o9 + 1]!, tri[o9 + 2]!);
          const acc = smooth.get(k);
          if (acc) {
            acc[0] += nrm[f * 3]! * w;
            acc[1] += nrm[f * 3 + 1]! * w;
            acc[2] += nrm[f * 3 + 2]! * w;
          } else smooth.set(k, [nrm[f * 3]! * w, nrm[f * 3 + 1]! * w, nrm[f * 3 + 2]! * w]);
        }
      }
      for (const v of smooth.values()) {
        const l = Math.hypot(v[0], v[1], v[2]) || 1;
        v[0] /= l;
        v[1] /= l;
        v[2] /= l;
      }
    }

    // Pass 2: emit body triangles (+ hull).
    for (let f = 0; f < nrm.length / 3; f++) {
      const nx = nrm[f * 3]!;
      const ny = nrm[f * 3 + 1]!;
      const nz = nrm[f * 3 + 2]!;
      let k = 1;
      if (shade > 0) k = 1 + (hash01(seed, this.faceCounter++, 77) - 0.5) * 2 * shade;
      for (let c = 0; c < 3; c++) {
        const o9 = f * 9 + c * 3;
        this.pos.push(tri[o9]!, tri[o9 + 1]!, tri[o9 + 2]!);
        if (normAttr) this.nor.push(cnr[o9]!, cnr[o9 + 1]!, cnr[o9 + 2]!);
        else this.nor.push(nx, ny, nz);
        this.col.push(cr * k, cg * k, cb * k);
        this.roles.push(role);
        if (this.extras) {
          this.inkA.push(0, 0, 0);
          this.glowA.push(glow[0], glow[1], glow[2]);
        }
      }
      if (smooth) {
        // Hull: reversed winding (0,2,1), pushed out along the smoothed normal.
        for (const c of [0, 2, 1]) {
          const o9 = f * 9 + c * 3;
          const x = tri[o9]!;
          const y = tri[o9 + 1]!;
          const z = tri[o9 + 2]!;
          const sn = smooth.get(key(x, y, z))!;
          this.pos.push(x + sn[0] * INK_BASE, y + sn[1] * INK_BASE, z + sn[2] * INK_BASE);
          this.nor.push(-nx, -ny, -nz);
          this.col.push(0.02, 0.012, 0.008); // ≈ ink in linear space (shader overrides anyway)
          this.roles.push(-1);
          this.inkA.push(sn[0], sn[1], sn[2]);
          this.glowA.push(0, 0, 0);
        }
      }
    }
    geo.dispose();
    return this;
  }

  box(w: number, h: number, d: number, color: number, o?: PartOpts): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, o);
  }

  /** Solid from 8 corners: bottom quad 0..3 then top quad 4..7, each ordered (−x,−z) (+x,−z) (+x,+z) (−x,+z). */
  hexa(c: readonly V3[], color: number, o?: PartOpts): this {
    return this.add(hexaGeometry(c), color, o);
  }

  /**
   * Tapered box centred at the origin: bottom w0×d0, top w1×d1, height h.
   * The top face is shifted by (sx, sz) — handy for windshields and hoods.
   */
  taper(w0: number, d0: number, w1: number, d1: number, h: number, color: number, o: PartOpts & { sx?: number; sz?: number } = {}): this {
    const sx = o.sx ?? 0;
    const sz = o.sz ?? 0;
    const y0 = -h / 2;
    const y1 = h / 2;
    return this.hexa(
      [
        [-w0 / 2, y0, -d0 / 2],
        [w0 / 2, y0, -d0 / 2],
        [w0 / 2, y0, d0 / 2],
        [-w0 / 2, y0, d0 / 2],
        [-w1 / 2 + sx, y1, -d1 / 2 + sz],
        [w1 / 2 + sx, y1, -d1 / 2 + sz],
        [w1 / 2 + sx, y1, d1 / 2 + sz],
        [-w1 / 2 + sx, y1, d1 / 2 + sz],
      ],
      color,
      o,
    );
  }

  /** Triangular prism (gable), base width w at y=−h/2, apex at y=+h/2, depth d along Z. */
  gable(w: number, h: number, d: number, color: number, o?: PartOpts): this {
    return this.taper(w, d, 0, d, h, color, o);
  }

  /** Cylinder along Y (centred). */
  cyl(rTop: number, rBot: number, h: number, seg: number, color: number, o?: PartOpts): this {
    return this.add(new THREE.CylinderGeometry(rTop, rBot, h, seg, 1), color, o);
  }

  /** Cone along +Y (centred). */
  cone(r: number, h: number, seg: number, color: number, o?: PartOpts): this {
    return this.add(new THREE.ConeGeometry(r, h, seg, 1), color, o);
  }

  /** Low-poly ball (icosahedron). detail 0 = 20 faces, 1 = 80. */
  ball(r: number, detail: number, color: number, o?: PartOpts): this {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, o);
  }

  dodeca(r: number, color: number, o?: PartOpts): this {
    return this.add(new THREE.DodecahedronGeometry(r, 0), color, o);
  }

  sphere(r: number, ws: number, hs: number, color: number, o?: PartOpts): this {
    return this.add(new THREE.SphereGeometry(r, ws, hs), color, o);
  }

  torus(r: number, tube: number, rs: number, ts: number, color: number, o?: PartOpts, arc = Math.PI * 2): this {
    return this.add(new THREE.TorusGeometry(r, tube, rs, ts, arc), color, o);
  }

  /** Lathe around Y from [radius, y] points (base at `at`). */
  lathe(pts: readonly (readonly [number, number])[], seg: number, color: number, o?: PartOpts): this {
    return this.add(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg), color, o);
  }

  /** Extrude a 2D outline (XY, CCW) along Z by `depth`, centred in Z. */
  extrude(pts: readonly (readonly [number, number])[], depth: number, color: number, o?: PartOpts): this {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    return this.add(g, color, o);
  }

  /** Flat disc (cylinder) lying in XZ. */
  disc(r: number, h: number, seg: number, color: number, o?: PartOpts): this {
    return this.cyl(r, r, h, seg, color, o);
  }

  /** Build the merged geometry. The builder can't be reused afterwards. */
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.extras) {
      g.setAttribute('aInk', new THREE.Float32BufferAttribute(this.inkA, 3));
      g.setAttribute('aGlow', new THREE.Float32BufferAttribute(this.glowA, 3));
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Indexed hexahedron from 8 corners (see GeoBuilder.hexa for corner order). */
export function hexaGeometry(c: readonly V3[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const p: number[] = [];
  for (let i = 0; i < 8; i++) p.push(c[i]![0], c[i]![1], c[i]![2]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  // CCW-from-outside winding (verified in tests/models/builder.test.ts).
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 5, 1, 0, 4, 5, 1, 5, 6, 1, 6, 2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0]);
  return g;
}

/** Merge simple textured planes (position/normal/uv, indexed) into one geometry; disposes the inputs. */
export function mergeUvPlanes(quads: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  for (const q of quads) {
    const p = q.getAttribute('position');
    const n = q.getAttribute('normal');
    const u = q.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u.getX(i), u.getY(i));
    }
    const ix = q.getIndex()!;
    for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    base += p.count;
    q.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Count triangles of every mesh under an object (visible or not). */
export function countTriangles(root: THREE.Object3D, visibleOnly = false): number {
  let n = 0;
  root.traverse((o) => {
    if (visibleOnly) {
      let v: THREE.Object3D | null = o;
      while (v) {
        if (!v.visible) return;
        v = v.parent;
      }
    }
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry) {
      const g = m.geometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    }
  });
  return n;
}
