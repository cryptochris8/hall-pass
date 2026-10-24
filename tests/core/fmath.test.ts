import { describe, expect, it } from 'vitest';
import { fatan2, fcos, fsin, turnToward, wrapAngle, yawOf } from '../../src/core/fmath';

describe('fmath', () => {
  it('fsin / fcos match Math within 1e-7 over many turns', () => {
    for (let a = -20; a <= 20; a += 0.0137) {
      expect(Math.abs(fsin(a) - Math.sin(a))).toBeLessThan(1e-7);
      expect(Math.abs(fcos(a) - Math.cos(a))).toBeLessThan(1e-7);
    }
  });
  it('fatan2 matches Math.atan2 within 1e-7', () => {
    for (let y = -3; y <= 3; y += 0.173) for (let x = -3; x <= 3; x += 0.191) {
      expect(Math.abs(fatan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-7);
    }
    expect(fatan2(0, 0)).toBe(0);
    expect(fatan2(1, 0)).toBeCloseTo(Math.PI / 2, 12);
  });
  it('yaw convention: 0 faces +Z, +π/2 faces +X', () => {
    expect(yawOf(0, 1)).toBeCloseTo(0, 12);
    expect(yawOf(1, 0)).toBeCloseTo(Math.PI / 2, 12);
    expect(fsin(yawOf(0.3, -0.8))).toBeCloseTo(0.3 / Math.hypot(0.3, 0.8), 6);
  });
  it('wrapAngle and turnToward take the short way round', () => {
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(turnToward(3, -3, 0.1)).toBeCloseTo(wrapAngle(3.1), 12);
    expect(turnToward(0, 0.05, 0.1)).toBe(0.05);
  });
});
