// Phone layout (landscape 844×390, touch): the menus fit, taps work, the HUD, mini-map and touch controls don't
// overlap the screen edges, and a period plays to the Hall Report.
import { expect, test, type Page } from '@playwright/test';

const screen = (page: Page): Promise<string | null> => page.evaluate(() => (window as any).__HP__?.screen() ?? null); // eslint-disable-line @typescript-eslint/no-explicit-any

test('phone: tap through the menus, play, and nothing spills off screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?test=1');
  await expect.poll(() => screen(page), { timeout: 120_000 }).toBe('title');
  await page.tap('.hp-menu', { position: { x: 400, y: 300 } });
  await expect.poll(() => screen(page)).toBe('main');
  // The main menu scrolls inside its panel, never sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await page.locator('.hp-item', { hasText: 'QUICK PERIOD' }).tap();
  await expect.poll(() => screen(page)).toBe('quick');
  await page.locator('.hp-item', { hasText: 'START' }).tap();
  await expect.poll(() => screen(page), { timeout: 120_000 }).toBe('intro');
  await page.tap('.hp-menu', { position: { x: 200, y: 100 } });
  await expect.poll(() => screen(page)).toBe('playing');
  // HUD pieces stay inside the viewport.
  for (const sel of ['.hp-bell', '.hp-mission', '.hp-minimap', '.hp-pausebtn']) {
    const box = await page.locator(sel).boundingBox();
    expect(box, sel).not.toBeNull();
    expect(box!.x, sel).toBeGreaterThanOrEqual(0);
    expect(box!.y, sel).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, sel).toBeLessThanOrEqual(844 + 1);
    expect(box!.y + box!.height, sel).toBeLessThanOrEqual(390 + 1);
  }
  // The bot finishes it; the report's buttons are tappable.
  await page.evaluate(() => {
    const hp = (window as any).__HP__; // eslint-disable-line @typescript-eslint/no-explicit-any
    hp.autopilot(1);
    for (let i = 0; i < 8 && hp.phase() === 'playing'; i++) hp.warp(60);
  });
  await expect.poll(() => screen(page), { timeout: 60_000 }).toBe('report');
  await page.locator('.hp-item', { hasText: 'MENU' }).tap();
  await expect.poll(() => screen(page)).toBe('main');
  expect(errors).toEqual([]);
});
