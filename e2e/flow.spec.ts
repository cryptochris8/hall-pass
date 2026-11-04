// End-to-end (docs/ARCHITECTURE.md §13): the real production build in Chromium with software WebGL. The bot plays
// ((window as unknown as { __HP__: HP }).__HP__.autopilot + warp) so a whole period fits in a test. Any page error fails the test.
import { expect, test, type Page } from '@playwright/test';

/** The debug hooks (src/game/app.ts debugApi), untyped here: tests poke at plain data. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HP = any;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text() + (m.location().url ? ` (${m.location().url})` : ''));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

const screen = (page: Page): Promise<string | null> => page.evaluate(() => (window as unknown as { __HP__?: HP }).__HP__?.screen() ?? null);

async function waitScreen(page: Page, id: string): Promise<void> {
  await expect.poll(() => screen(page), { timeout: 120_000 }).toBe(id);
}

/** Let the bot finish the period in a few big jumps, then wait for the Hall Report. */
async function botFinish(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __HP__: HP }).__HP__.start();
    (window as unknown as { __HP__: HP }).__HP__.autopilot(1);
  });
  for (let i = 0; i < 8 && (await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.phase())) === 'playing'; i++) await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.warp(60));
  await waitScreen(page, 'report');
}

test.beforeEach(async ({ page }) => {
  // A fresh save every test.
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('hp-e2e')) {
        localStorage.clear();
        sessionStorage.setItem('hp-e2e', '1');
      }
    } catch {
      /* storage blocked */
    }
  });
});

test('title → DAILY → a full period → Hall Report → share card', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1');
  await waitScreen(page, 'title');
  await expect(page.locator('.hp-logo')).toContainText('HALL PASS');
  await page.keyboard.press('Enter');
  await waitScreen(page, 'main');
  await expect(page.locator('.hp-item').first()).toContainText('DAILY PERIOD #');
  await page.keyboard.press('Enter'); // DAILY is focused first
  await waitScreen(page, 'intro');
  await expect(page.locator('.hp-card')).toContainText('Press GRAB');
  const cfg = await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.config());
  expect(cfg.daily).not.toBeNull();
  await botFinish(page);
  const report = await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.report());
  expect(report.success).toBe(true);
  expect(report.rank).toBe('GHOST'); // the perfect bot is never seen
  await expect(page.locator('.hp-paper .hp-grade')).toHaveText(report.grade);
  await expect(page.locator('.hp-stamp')).toHaveText('GHOST');
  // Share: the picture and the three-line text with the challenge code.
  await page.locator('.hp-item', { hasText: 'SHARE' }).click();
  await waitScreen(page, 'share');
  await expect(page.locator('.hp-share-img')).toBeVisible();
  const text = await page.locator('.hp-share-text').textContent();
  expect(text).toMatch(/^HALL PASS #\d+ {2}·/);
  expect(text).toMatch(/[2-9A-HJ-NP-Z]{3}-[2-9A-HJ-NP-Z]{3}-\d+$/);
  // The run was saved: records and the daily.
  const save = await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.save());
  expect(save.totals.runs).toBe(1);
  expect(Object.keys(save.daily)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('SCHOOL WEEK: Monday and Tuesday are the same building', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1');
  await waitScreen(page, 'title');
  await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.play('week'));
  await waitScreen(page, 'intro');
  await expect(page.locator('.hp-card .hp-kicker')).toContainText('MONDAY');
  const monday = await page.evaluate(() => ({ name: (window as unknown as { __HP__: HP }).__HP__.school().name, cells: Array.from((window as unknown as { __HP__: HP }).__HP__.school().cells as Int16Array).join(',') }));
  await botFinish(page);
  await page.locator('.hp-item.hp-primary', { hasText: 'NEXT: TUESDAY' }).click();
  await waitScreen(page, 'intro');
  await expect(page.locator('.hp-card .hp-kicker')).toContainText('TUESDAY');
  const tuesday = await page.evaluate(() => ({ name: (window as unknown as { __HP__: HP }).__HP__.school().name, cells: Array.from((window as unknown as { __HP__: HP }).__HP__.school().cells as Int16Array).join(',') }));
  expect(tuesday).toEqual(monday);
  expect(errors).toEqual([]);
});

test('challenge codes: a bad code is explained, a good one plays that exact school', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1');
  await waitScreen(page, 'title');
  await page.keyboard.press('Enter');
  await waitScreen(page, 'main');
  await page.locator('.hp-item', { hasText: 'CHALLENGE CODE' }).click();
  await waitScreen(page, 'code');
  const field = page.locator('.hp-field input');
  await field.fill('H0L-ZZZ');
  await field.press('Enter');
  await expect(page.locator('.hp-error')).toContainText("doesn't look right");
  await field.fill('23a 9v7-5220'); // lower case, a space instead of the dash, with a score
  await field.press('Enter');
  await waitScreen(page, 'intro');
  const cfg = await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.config());
  expect(cfg).toMatchObject({ seed: expect.any(Number), daily: null });
  await expect(page.locator('.hp-card')).toContainText('Score to beat: 5220');
  expect(errors).toEqual([]);
});

test('settings persist across a reload; the mini-map and hints toggle', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/?test=1&mission=locker&tier=1&difficulty=freshman&seed=21&autostart=1');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __HP__?: HP }).__HP__?.phase()), { timeout: 120_000 }).toBe('playing');
  await expect(page.locator('.hp-minimap')).toBeVisible();
  // Twenty seconds standing still on FRESHMAN: footprints.
  await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.warp(22));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.state().tick)).toBeGreaterThan(22 * 60);
  // Turn the mini-map off in Settings (pause menu), reload, still off.
  await page.keyboard.press('Escape');
  await waitScreen(page, 'pause');
  await page.locator('.hp-item', { hasText: 'SETTINGS' }).click();
  await waitScreen(page, 'settings');
  await page.locator('.hp-item', { hasText: 'Mini-map' }).click();
  expect(await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.save().settings.minimap)).toBe(false);
  await page.reload();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __HP__?: HP }).__HP__?.phase()), { timeout: 120_000 }).toBe('playing');
  expect(await page.evaluate(() => (window as unknown as { __HP__: HP }).__HP__.save().settings.minimap)).toBe(false);
  await expect(page.locator('.hp-minimap')).toBeHidden();
  expect(errors).toEqual([]);
});
