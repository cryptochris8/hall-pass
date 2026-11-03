// The mini-map's rules: which staff show, and in what colour (the drawing itself is checked by screenshots).
import { describe, expect, it } from 'vitest';
import { MAP_NEAR, staffDot, staffVisible } from '../../src/ui/minimap';

describe('minimap', () => {
  it('shows staff near you or on alert, never a whole calm patrol across the school', () => {
    expect(staffVisible(MAP_NEAR - 1, 'calm', 'route')).toBe(true);
    expect(staffVisible(MAP_NEAR + 20, 'calm', 'route')).toBe(false);
    expect(staffVisible(MAP_NEAR + 20, 'curious', 'route')).toBe(true);
    expect(staffVisible(MAP_NEAR + 20, 'calm', 'chase')).toBe(true);
    expect(staffVisible(MAP_NEAR + 20, 'calm', 'search')).toBe(true);
  });

  it('colours follow the alert level; chases are red', () => {
    expect(staffDot('calm', 'route')).not.toBe(staffDot('spotted', 'route'));
    expect(staffDot('calm', 'chase')).toBe(staffDot('spotted', 'route'));
    expect(staffDot('calm', 'investigate')).toBe(staffDot('curious', 'route'));
  });
});
