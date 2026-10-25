// ─────────────────────────────────────────────────────────────────────────────
// Sign text: one canvas atlas per school (room signs, banners, the cafeteria
// menu, QUIET PLEASE…) drawn with the 2D canvas API and used as a CanvasTexture
// on flat quads. Strings only ever reach fillText (never HTML), are stripped of
// control characters and length-capped. Without a DOM (node tests) the atlas
// still lays out and hands out UVs; texture() returns null and the quads get a
// plain placeholder material.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import type { V3 } from '../../render/models/builder';
import { css } from './palette';

export type TextFont = 'display' | 'board' | 'led' | 'hand';

export interface TextStyle {
  bg: number;
  fg: number;
  font: TextFont;
  /** Optional border colour (inset line). */
  border?: number;
}

interface Slot {
  text: string;
  w: number;
  h: number;
  style: TextStyle;
  x: number;
  y: number;
}

/** A text quad in world space: corners bottom-left, bottom-right, top-right, top-left (seen from the front). */
export interface TextQuad {
  slot: number;
  corners: readonly [V3, V3, V3, V3];
  normal: V3;
}

const ATLAS_W = 1024;

/** Keep sign strings boring: printable characters (and line breaks) only, capped length. */
export function cleanText(s: string, max = 48): string {
  let out = '';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c < 32 && c !== 10) || (c >= 127 && c < 160)) continue;
    out += ch;
    if (out.length >= max) break;
  }
  return out;
}

export class TextAtlas {
  private readonly slots: Slot[] = [];
  private readonly byKey = new Map<string, number>();
  private height = 0;
  private laidOut = false;

  /** Reserve (or reuse) a slot of w × h pixels for a string. Multi-line text uses '\n'. */
  slot(text: string, w: number, h: number, style: TextStyle): number {
    const t = cleanText(text, 160);
    const key = `${t}|${w}|${h}|${style.bg}|${style.fg}|${style.font}|${style.border ?? -1}`;
    const hit = this.byKey.get(key);
    if (hit !== undefined) return hit;
    this.slots.push({ text: t, w: Math.min(ATLAS_W, w), h, style, x: 0, y: 0 });
    this.byKey.set(key, this.slots.length - 1);
    this.laidOut = false;
    return this.slots.length - 1;
  }

  get count(): number {
    return this.slots.length;
  }

  /** Shelf-pack the slots (tallest first); returns the atlas size. */
  layout(): { w: number; h: number } {
    if (!this.laidOut) {
      const order = this.slots.map((_, i) => i).sort((a, b) => this.slots[b]!.h - this.slots[a]!.h || a - b);
      let x = 0;
      let y = 0;
      let rowH = 0;
      for (const i of order) {
        const s = this.slots[i]!;
        if (x + s.w > ATLAS_W) {
          x = 0;
          y += rowH + 2;
          rowH = 0;
        }
        s.x = x;
        s.y = y;
        x += s.w + 2;
        rowH = Math.max(rowH, s.h);
      }
      let h = 64;
      while (h < y + rowH) h *= 2;
      this.height = h;
      this.laidOut = true;
    }
    return { w: ATLAS_W, h: this.height };
  }

  /** UV rectangle (u0, v0 bottom-left, u1, v1 top-right; flipY texture convention). */
  uv(i: number): [number, number, number, number] {
    const { h } = this.layout();
    const s = this.slots[i]!;
    return [s.x / ATLAS_W, 1 - (s.y + s.h) / h, (s.x + s.w) / ATLAS_W, 1 - s.y / h];
  }

  /** Draw the atlas into a CanvasTexture, or null without a DOM. */
  texture(): THREE.CanvasTexture | null {
    if (typeof document === 'undefined' || this.slots.length === 0) return null;
    const { w, h } = this.layout();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return null;
    for (const s of this.slots) drawSlot(g, s);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }
}

const FONTS: Record<TextFont, string> = {
  display: "'Archivo Black', 'Arial Black', Impact, system-ui, sans-serif",
  board: "'Archivo', 'Arial Narrow', Arial, system-ui, sans-serif",
  led: "'JetBrains Mono', 'Courier New', monospace",
  hand: "'Caveat', 'Comic Sans MS', 'Segoe Print', cursive",
};

function drawSlot(g: CanvasRenderingContext2D, s: Slot): void {
  const { x, y, w, h, style } = s;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = css(style.bg);
  g.fillRect(x, y, w, h);
  if (style.border !== undefined) {
    const m = Math.max(3, Math.round(h * 0.07));
    g.strokeStyle = css(style.border);
    g.lineWidth = Math.max(2, Math.round(h * 0.04));
    g.strokeRect(x + m, y + m, w - 2 * m, h - 2 * m);
  }
  const lines = s.text.split('\n');
  const pad = Math.round(Math.min(w, h) * 0.14);
  const lineH = (h - 2 * pad) / lines.length;
  g.fillStyle = css(style.fg);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const weight = style.font === 'display' ? '400' : style.font === 'led' ? '700' : '600';
  lines.forEach((line, k) => {
    let size = Math.floor(lineH * (style.font === 'hand' ? 0.95 : 0.78));
    g.font = `${weight} ${size}px ${FONTS[style.font]}`;
    while (size > 8 && g.measureText(line).width > w - 2 * pad) {
      size -= 2;
      g.font = `${weight} ${size}px ${FONTS[style.font]}`;
    }
    if (style.font === 'led') {
      g.shadowColor = css(style.fg);
      g.shadowBlur = size * 0.35;
    }
    g.fillText(line, x + w / 2, y + pad + lineH * (k + 0.5) + size * 0.04);
  });
  g.restore();
}

/** Non-indexed position/normal/uv geometry for a list of text quads (uvs from the laid-out atlas). */
export function textGeometry(atlas: TextAtlas, quads: readonly TextQuad[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const q of quads) {
    const [u0, v0, u1, v1] = atlas.uv(q.slot);
    const c = q.corners;
    const uvs: [number, number][] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(c[i]![0], c[i]![1], c[i]![2]);
      nor.push(q.normal[0], q.normal[1], q.normal[2]);
      uv.push(uvs[i]![0], uvs[i]![1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
