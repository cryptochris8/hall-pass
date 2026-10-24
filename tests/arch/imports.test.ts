// docs/ARCHITECTURE.md §10: src/sim and src/school import nothing from three, render, world, people, ui, audio,
// input or the DOM, and never use Math.random / Date / transcendental Math in their code.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const PURE = ['src/sim', 'src/school', 'src/core'].flatMap(files);

describe('architecture rules', () => {
  it('pure modules import only pure modules', () => {
    for (const f of PURE) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/from '([^']+)'/g)) {
        const spec = m[1]!;
        expect(spec, `${f} imports ${spec}`).not.toMatch(/^three|\/(render|world|people|ui|audio|input|game|share|storage)\//);
      }
    }
  });
  it('no Math.random, Date, performance.now or transcendental Math in the sim and school', () => {
    for (const f of PURE.filter((p) => !p.endsWith('core/rng.ts') && !p.endsWith('core/math.ts'))) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/Math\.(random|sin|cos|tan|atan2?|exp|pow|hypot|log)\b|\bDate\b|performance\.now/);
    }
  });
});
