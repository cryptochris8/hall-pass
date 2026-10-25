// ─────────────────────────────────────────────────────────────────────────────
// Props builder kit: a local placement frame on top of GeoBuilder, so furniture
// and wall decor are authored facing local +Z (x = right as seen from the front,
// y = up, z = out of the wall / toward the viewer) and dropped anywhere with a
// yaw (0 = +Z, π/2 = +X). Plus a few flat helpers (floor patches, wall quads).
// Same idea as Bad Hair Day's kit.ts Frame (read-only reference).
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GeoBuilder, PartOpts, V3 } from '../../render/models/builder';

export type LocalOpts = Omit<PartOpts, 'at' | 'rot'> & { rot?: V3 };

const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const eu = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

export class Frame {
  private readonly c: number;
  private readonly s: number;
  constructor(
    readonly b: GeoBuilder,
    readonly ox = 0,
    readonly oy = 0,
    readonly oz = 0,
    readonly yaw = 0,
  ) {
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
  }

  /** World position of a local point. */
  at(lx: number, ly: number, lz: number): V3 {
    return [this.ox + lx * this.c + lz * this.s, this.oy + ly, this.oz - lx * this.s + lz * this.c];
  }

  /** World direction of a local direction (no translation). */
  dir(lx: number, ly: number, lz: number): V3 {
    return [lx * this.c + lz * this.s, ly, -lx * this.s + lz * this.c];
  }

  private opts(lx: number, ly: number, lz: number, o: LocalOpts = {}): PartOpts {
    const r = o.rot ?? [0, 0, 0];
    let rot: V3;
    if (r[0] === 0 && r[2] === 0) rot = [0, r[1] + this.yaw, 0];
    else {
      qa.setFromAxisAngle(UP, this.yaw);
      qb.setFromEuler(eu.set(r[0], r[1], r[2], 'XYZ'));
      eu.setFromQuaternion(qa.multiply(qb), 'XYZ');
      rot = [eu.x, eu.y, eu.z];
    }
    const { rot: _r, ...rest } = o;
    void _r;
    return { ...rest, at: this.at(lx, ly, lz), rot };
  }

  /** Child frame: offset + extra yaw. */
  sub(lx: number, ly: number, lz: number, yaw = 0): Frame {
    const p = this.at(lx, ly, lz);
    return new Frame(this.b, p[0], p[1], p[2], this.yaw + yaw);
  }

  /** Same placement on another builder. */
  on(b: GeoBuilder): Frame {
    return new Frame(b, this.ox, this.oy, this.oz, this.yaw);
  }

  add(geo: THREE.BufferGeometry, color: number, lx: number, ly: number, lz: number, o?: LocalOpts): this {
    this.b.add(geo, color, this.opts(lx, ly, lz, o));
    return this;
  }
  box(w: number, h: number, d: number, color: number, lx: number, ly: number, lz: number, o?: LocalOpts): this {
    this.b.box(w, h, d, color, this.opts(lx, ly, lz, o));
    return this;
  }
  /** Box between two corners (local x0..x1, y0..y1, z0..z1). */
  span(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: number, o?: LocalOpts): this {
    return this.box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, o);
  }
  /** Rounded box (108 tris at seg 1 before ink — use for hero parts only). */
  rbox(w: number, h: number, d: number, r: number, color: number, lx: number, ly: number, lz: number, o: LocalOpts = {}): this {
    const rr = Math.max(0.002, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    this.b.add(new RoundedBoxGeometry(w, h, d, 1, rr), color, this.opts(lx, ly, lz, { smooth: true, ...o }));
    return this;
  }
  taper(w0: number, d0: number, w1: number, d1: number, h: number, color: number, lx: number, ly: number, lz: number, o: LocalOpts & { sx?: number; sz?: number } = {}): this {
    const { sx, sz, ...rest } = o;
    this.b.taper(w0, d0, w1, d1, h, color, { ...this.opts(lx, ly, lz, rest), ...(sx !== undefined ? { sx } : {}), ...(sz !== undefined ? { sz } : {}) });
    return this;
  }
  /** Solid from 8 local corners (see GeoBuilder.hexa for the order). */
  hexa(c: readonly V3[], color: number, o: Omit<LocalOpts, 'rot' | 'scale'> = {}): this {
    this.b.hexa(
      c.map((p) => this.at(p[0], p[1], p[2])),
      color,
      o,
    );
    return this;
  }
  cyl(rt: number, rb: number, h: number, seg: number, color: number, lx: number, ly: number, lz: number, o?: LocalOpts): this {
    this.b.cyl(rt, rb, h, seg, color, this.opts(lx, ly, lz, o));
    return this;
  }
  ball(r: number, detail: number, color: number, lx: number, ly: number, lz: number, o?: LocalOpts): this {
    this.b.ball(r, detail, color, this.opts(lx, ly, lz, o));
    return this;
  }
  cone(r: number, h: number, seg: number, color: number, lx: number, ly: number, lz: number, o?: LocalOpts): this {
    this.b.cone(r, h, seg, color, this.opts(lx, ly, lz, o));
    return this;
  }
  torus(r: number, tube: number, rs: number, ts: number, color: number, lx: number, ly: number, lz: number, o?: LocalOpts, arc = Math.PI * 2): this {
    this.b.torus(r, tube, rs, ts, color, this.opts(lx, ly, lz, o), arc);
    return this;
  }
  lathe(pts: readonly (readonly [number, number])[], seg: number, color: number, lx: number, ly: number, lz: number, o?: LocalOpts): this {
    this.b.lathe(pts, seg, color, this.opts(lx, ly, lz, o));
    return this;
  }
  /** Flat quad in the local XY plane facing local +Z, at depth z (2 tris, never inked). */
  quad(x0: number, x1: number, y0: number, y1: number, z: number, color: number, o: Omit<LocalOpts, 'ink'> = {}): this {
    if (x1 - x0 <= 1e-4 || y1 - y0 <= 1e-4) return this;
    this.b.add(new THREE.PlaneGeometry(x1 - x0, y1 - y0), color, this.opts((x0 + x1) / 2, (y0 + y1) / 2, z, { ...o, ink: false }));
    return this;
  }
  /** Flat quad lying on the floor plane at height y (facing up), from 4 local XZ corners (CCW seen from above). */
  floor(pts: readonly (readonly [number, number])[], y: number, color: number, glow?: number): this {
    const g = new THREE.BufferGeometry();
    const p: number[] = [];
    const tri = (a: number, b: number, c: number) => {
      for (const i of [a, b, c]) {
        const w = this.at(pts[i]![0], y, pts[i]![1]);
        p.push(w[0], w[1], w[2]);
      }
    };
    tri(0, 1, 2);
    tri(0, 2, 3);
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    // Make sure it faces up whatever the corner order.
    // y of (p1 − p0) × (p2 − p0): positive = CCW seen from above.
    const ny = (p[5]! - p[2]!) * (p[6]! - p[0]!) - (p[3]! - p[0]!) * (p[8]! - p[2]!);
    if (ny < 0) {
      const q: number[] = [];
      for (let t = 0; t < 2; t++) for (const c of [0, 2, 1]) q.push(p[t * 9 + c * 3]!, p[t * 9 + c * 3 + 1]!, p[t * 9 + c * 3 + 2]!);
      g.setAttribute('position', new THREE.Float32BufferAttribute(q, 3));
    }
    this.b.add(g, color, { ink: false, ...(glow ? { glow } : {}) });
    return this;
  }
  /** Floor rectangle (local x0..x1, z0..z1) at height y. */
  floorRect(x0: number, x1: number, z0: number, z1: number, y: number, color: number, glow?: number): this {
    return this.floor(
      [
        [x0, z0],
        [x0, z1],
        [x1, z1],
        [x1, z0],
      ],
      y,
      color,
      glow,
    );
  }
  /** Flat ring on the floor (court circles). */
  floorRing(x: number, z: number, r0: number, r1: number, seg: number, y: number, color: number, arc0 = 0, arc = Math.PI * 2): this {
    const g = new THREE.RingGeometry(r0, r1, seg, 1, arc0, arc);
    g.rotateX(-Math.PI / 2);
    this.b.add(g, color, { ink: false, at: this.at(x, y, z), rot: [0, this.yaw, 0] });
    return this;
  }
}
