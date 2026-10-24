#!/usr/bin/env node
// Screenshot / smoke tool shared by every module. Starts its own Vite dev server
// on a free port (so several can run at once), opens a page in real Chrome with
// software WebGL, waits, optionally runs JS / presses keys, and saves PNGs.
// Prints page console errors and uncaught exceptions — treat any as a failure.
//
// Usage:
//   node tools/shot.mjs <page> <out.png> [options]
//     <page>            path served by Vite, e.g. dev/models.html or "/?test=1"
//   --w 1280 --h 720    viewport (CSS px)            --mobile   (touch + DPR 2, 390x844 default)
//   --wait 1500         ms to wait after load before the first action/shot
//   --eval "js"         JS to run in the page after the wait (may return a value, printed as JSON)
//   --keys "ArrowLeft:500,KeyE,Space"   key presses; ":ms" holds for that long
//   --frames 3 --interval 800           take N shots (out-1.png, out-2.png, …) spaced by interval ms
//   --until "js expr"   wait until expression is truthy (max --timeout ms, default 60000)
//   --url http://…      use an already-running server instead of starting Vite
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { existsSync as chromiumExists } from 'node:fs';
// Real Chrome when installed; otherwise a bundled Chromium (cloud containers: /opt/pw-browsers/chromium, or HP_CHROMIUM).
const CHROMIUM = process.env.HP_CHROMIUM || (chromiumExists('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');

const args = process.argv.slice(2);
const positional = [];
const opt = {};
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) opt[key] = true;
    else {
      opt[key] = next;
      i++;
    }
  } else positional.push(a);
}
const [page = 'index.html', out = 'shots/shot.png'] = positional;
const mobile = !!opt.mobile;
const width = Number(opt.w ?? (mobile ? 390 : 1280));
const height = Number(opt.h ?? (mobile ? 844 : 720));
const wait = Number(opt.wait ?? 1500);
const frames = Number(opt.frames ?? 1);
const interval = Number(opt.interval ?? 800);
const timeout = Number(opt.timeout ?? 60000);

let server = null;
let base = opt.url;
if (!base) {
  const port = 5300 + (process.pid % 600);
  server = await createServer({
    // No HMR / file watching: several agents edit the tree at once, and a reload mid-run kills the page.
    server: { port, strictPort: false, hmr: false, watch: null },
    logLevel: 'error',
    clearScreen: false,
  });
  await server.listen();
  base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
}
const url = page.startsWith('http') ? page : new URL(page.replace(/^\//, ''), base).href;

const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : { channel: 'chrome' }),
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: mobile ? 2 : 1,
  hasTouch: mobile,
  isMobile: mobile,
});
const p = await context.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || String(e))));
p.on('response', (r) => {
  // Report failed loads by URL (the browser's own console line has no URL). The implicit
  // /favicon.ico probe on dev pages is not an error.
  if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`);
});
p.on('console', (m) => {
  if (m.type() === 'error' && /^Failed to load resource/.test(m.text())) return; // covered by 'response'
  if (m.type() === 'error') errors.push('console.error: ' + m.text());
  else if (opt.verbose) console.log(`[${m.type()}] ${m.text()}`);
});

let exitCode = 0;
try {
  await p.goto(url, { waitUntil: 'load', timeout });
  if (opt.until) await p.waitForFunction(opt.until, null, { timeout, polling: 200 });
  await p.waitForTimeout(wait);
  if (opt.keys) {
    for (const k of String(opt.keys).split(',')) {
      const [key, hold] = k.trim().split(':');
      if (hold) {
        await p.keyboard.down(key);
        await p.waitForTimeout(Number(hold));
        await p.keyboard.up(key);
      } else await p.keyboard.press(key);
    }
  }
  if (opt.eval) {
    const r = await p.evaluate(opt.eval);
    if (r !== undefined) console.log('eval →', JSON.stringify(r, null, 2));
  }
  mkdirSync(dirname(resolve(out)), { recursive: true });
  for (let f = 0; f < frames; f++) {
    const file = frames === 1 ? out : out.replace(/(\.png)?$/, `-${f + 1}.png`);
    // .jpg/.jpeg outputs are written as JPEG (quality 88) — e.g. public/cover-art.jpg.
    const jpeg = /\.jpe?g$/i.test(file);
    await p.screenshot(jpeg ? { path: file, type: 'jpeg', quality: 88 } : { path: file });
    console.log('saved', file);
    if (f < frames - 1) await p.waitForTimeout(interval);
  }
} catch (e) {
  console.error('FAILED:', e.message);
  exitCode = 1;
}
if (errors.length) {
  console.log(`\n${errors.length} page error(s):`);
  for (const e of errors.slice(0, 20)) console.log('  ' + e.slice(0, 600));
  exitCode = 1;
} else console.log('no page errors');
await browser.close();
if (server) await server.close();
process.exit(exitCode);
