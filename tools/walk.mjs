#!/usr/bin/env node
// Scripted walkthrough: loads a page, then runs steps, taking screenshots along the way.
// Starts its own Vite dev server (like shot.mjs). Prints page errors; exit code 1 on any.
//
//   node tools/walk.mjs "/?test=1&noboot=1" shots/walk "wait:title" "key:Enter" "sleep:800" "shot:menu" …
//
// Steps:  wait:<screenId>        wait until __HP__.screen() === id (60 s max)
//         key:<Code>[:holdMs]    real keyboard press (e.g. key:Enter, key:Space:600, key:ArrowRight)
//         pad:<button>[:holdMs]  press a fake DualShock button index (needs --pad)
//         tap:<css selector>     real touch/mouse tap on an element's centre
//         sleep:<ms>             wait
//         until:<js>             wait until the expression is truthy (60 s max)
//         hold:<Code>:<js>       hold a key until the expression is truthy (40 s max)
//         padhold:<button>:<js>  hold a pad button until the expression is truthy (needs --pad)
//         click:<js → [x, y]>    mouse click at page coords (a touch tap with --mobile)
//         tapxy:<js → [x, y]>    touch tap at page coords
//         drag:<js → [x0,y0,x1,y1]>  mouse drag
//         eval:<js>              evaluate JS (result printed)
//         shot:<name>            screenshot → <prefix>-<name>.png
// Options: --mobile (touch, DPR 2, 844×390 unless --w/--h), --w, --h, --pad (install a fake DS4), --url <base>,
//          --audio (keep Web Audio; by default it is stubbed out — headless Chrome has no audio device)
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { existsSync as chromiumExists } from 'node:fs';
// Real Chrome when installed; otherwise a bundled Chromium (cloud containers: /opt/pw-browsers/chromium, or HP_CHROMIUM).
const CHROMIUM = process.env.HP_CHROMIUM || (chromiumExists('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : '');

const args = process.argv.slice(2);
const opt = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const next = args[i + 1];
    const isStep = next !== undefined && /^(wait|key|pad|tap|sleep|eval|shot|until|hold|padhold|click|tapxy|drag):/.test(next);
    if (next === undefined || next.startsWith('--') || isStep) opt[a.slice(2)] = true;
    else {
      opt[a.slice(2)] = next;
      i++;
    }
  } else pos.push(a);
}
const [page = '/', prefix = 'shots/walk', ...steps] = pos;
const mobile = !!opt.mobile;
const width = Number(opt.w ?? (mobile ? 844 : 1280));
const height = Number(opt.h ?? (mobile ? 390 : 720));

let server = null;
let base = opt.url;
if (!base) {
  const port = 5900 + (process.pid % 90);
  server = await createServer({
    // No HMR / file watching: several agents edit the tree at once, and a reload mid-run kills the page.
    server: { port, strictPort: false, hmr: false, watch: null },
    logLevel: 'error',
    clearScreen: false,
  });
  await server.listen();
  base = server.resolvedUrls?.local?.[0] ?? `http://localhost:${port}/`;
}
const browser = await chromium.launch({
  ...(CHROMIUM ? { executablePath: CHROMIUM } : { channel: 'chrome' }),
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, hasTouch: mobile, isMobile: mobile });
const p = await ctx.newPage();
if (!opt.audio)
  await p.addInitScript(() => {
    try {
      Object.defineProperty(window, 'AudioContext', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitAudioContext', { value: undefined, configurable: true });
    } catch {
      /* ignore */
    }
  });
if (opt.pad) {
  await p.addInitScript(() => {
    const mk = () => ({ pressed: false, touched: false, value: 0 });
    const pad = { id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: Array.from({ length: 18 }, mk), axes: [0, 0, 0, 0] };
    window.__pad = {
      press(i, v = 1) { const b = pad.buttons[i]; b.pressed = v > 0.1; b.value = v; pad.timestamp++; },
      release(i) { const b = pad.buttons[i]; b.pressed = false; b.value = 0; pad.timestamp++; },
      axis(i, v) { pad.axes[i] = v; pad.timestamp++; },
    };
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
  });
}
const errors = [];
p.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || String(e))));
p.on('response', (r) => {
  if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`);
});
p.on('console', (m) => {
  if (m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && !/AudioContext encountered an error/.test(m.text())) errors.push('console.error: ' + m.text());
});

let code = 0;
try {
  await p.goto(new URL(page.replace(/^\//, ''), base).href, { waitUntil: 'load', timeout: 90000 });
  await p.waitForFunction(() => !!window.__HP__, null, { timeout: 90000 });
  mkdirSync(dirname(resolve(prefix + '-x.png')), { recursive: true });
  for (const step of steps) {
    const i = step.indexOf(':');
    const kind = step.slice(0, i);
    const arg = step.slice(i + 1);
    if (kind === 'wait') await p.waitForFunction((s) => window.__HP__.screen() === s, arg, { timeout: 60000, polling: 100 });
    else if (kind === 'key') {
      const [k, hold] = arg.split(':');
      if (hold) {
        await p.keyboard.down(k);
        await p.waitForTimeout(Number(hold));
        await p.keyboard.up(k);
      } else await p.keyboard.press(k);
    } else if (kind === 'pad') {
      const [b, hold] = arg.split(':');
      await p.evaluate((n) => window.__pad.press(n), Number(b));
      await p.waitForTimeout(Number(hold ?? 260)); // ≥ 250 ms: slow software-GL frames can miss shorter presses
      await p.evaluate((n) => window.__pad.release(n), Number(b));
    } else if (kind === 'tap') {
      const box = await p.locator(arg).first().boundingBox();
      if (!box) throw new Error('tap target not found: ' + arg);
      if (mobile) await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      else await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else if (kind === 'hold' || kind === 'padhold') {
      const j = arg.indexOf(':');
      const key = arg.slice(0, j);
      const cond = arg.slice(j + 1);
      if (kind === 'hold') await p.keyboard.down(key);
      else await p.evaluate((n) => window.__pad.press(n), Number(key));
      try {
        await p.waitForFunction(cond, null, { timeout: 40000, polling: 30 });
      } catch {
        console.log(kind + ' timeout', cond);
      }
      if (kind === 'hold') await p.keyboard.up(key);
      else await p.evaluate((n) => window.__pad.release(n), Number(key));
    } else if (kind === 'click' || kind === 'tapxy') {
      const xy = await p.evaluate(arg);
      if (!xy) console.log('click target missing', arg);
      else if (mobile || kind === 'tapxy') await p.touchscreen.tap(xy[0], xy[1]);
      else {
        await p.mouse.move(xy[0], xy[1], { steps: 4 });
        await p.mouse.down();
        await p.waitForTimeout(60);
        await p.mouse.up();
      }
    } else if (kind === 'drag') {
      const v = await p.evaluate(arg);
      if (!v) console.log('drag target missing', arg);
      else {
        await p.mouse.move(v[0], v[1], { steps: 3 });
        await p.mouse.down();
        await p.mouse.move((v[0] + v[2]) / 2, (v[1] + v[3]) / 2, { steps: 6 });
        await p.waitForTimeout(150);
        await p.mouse.move(v[2], v[3], { steps: 6 });
        await p.waitForTimeout(250);
        await p.mouse.up();
      }
    } else if (kind === 'until') {
      try {
        await p.waitForFunction(arg, null, { timeout: 60000, polling: 100 });
      } catch {
        console.log('until timeout', arg);
      }
    } else if (kind === 'sleep') await p.waitForTimeout(Number(arg));
    else if (kind === 'eval') {
      const r = await p.evaluate(arg);
      if (r !== undefined) console.log(`eval ${arg.slice(0, 50)} →`, JSON.stringify(r));
    } else if (kind === 'shot') {
      const file = `${prefix}-${arg}.png`;
      await p.screenshot({ path: file });
      console.log('saved', file, '| screen:', await p.evaluate(() => window.__HP__.screen()));
    } else throw new Error('unknown step ' + step);
  }
} catch (e) {
  console.error('FAILED:', e.message);
  code = 1;
}
if (errors.length) {
  console.log(`\n${errors.length} page error(s):`);
  for (const e of errors.slice(0, 20)) console.log('  ' + e.slice(0, 700));
  code = 1;
} else console.log('no page errors');
await browser.close();
if (server) await server.close();
process.exit(code);
