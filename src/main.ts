// HALL PASS — bootstrap. Everything interesting lives in src/game/app.ts.
//
// URL params (docs/ARCHITECTURE.md §14): ?seed=N, ?tier=1..5, ?mission=phone|vending|pizza|locker|gym|principal,
//   ?difficulty=freshman|junior|senior, ?code=XXX-XXX (play a challenge code), ?autostart=1 (skip the title and mission card), ?quality=auto|high|low,
//   ?test=1 (window.__HP__ in production builds),
//   grey-box camera: ?pitch=55&dist=17&fov=40&walls=occlude|cutaway|low|full&cones=0|1.
import { App, type AppParams } from './game/app';
import { installDebugHooks } from './game/debug';
import type { Quality } from './render/types';
import { DIFFICULTIES, MISSION_IDS, type Difficulty, type MissionId, type TierId } from './school/types';
import type { WallMode } from './world/school';

function parseParams(search: string): AppParams {
  const q = new URLSearchParams(search);
  const num = (key: string): number | null => {
    const raw = q.get(key);
    const n = raw !== null && raw.trim() !== '' ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  const seed = num('seed');
  const tier = num('tier');
  const mission = q.get('mission');
  const difficulty = q.get('difficulty');
  const quality = q.get('quality');
  const walls = q.get('walls');
  const camera: AppParams['camera'] = {};
  const pitch = num('pitch');
  const dist = num('dist');
  const fov = num('fov');
  if (pitch !== null) camera.pitch = Math.min(85, Math.max(30, pitch));
  if (dist !== null) camera.distance = Math.min(40, Math.max(8, dist));
  if (fov !== null) camera.fov = Math.min(70, Math.max(20, fov));
  if (walls === 'occlude' || walls === 'cutaway' || walls === 'low' || walls === 'full') camera.walls = walls as WallMode;
  if (q.get('cones') === '0') camera.cones = false;
  return {
    seed: seed !== null ? Math.floor(seed) >>> 0 : null,
    tier: tier !== null && tier >= 1 && tier <= 5 ? (Math.floor(tier) as TierId) : null,
    mission: mission !== null && (MISSION_IDS as readonly string[]).includes(mission) ? (mission as MissionId) : null,
    difficulty: difficulty !== null && (DIFFICULTIES as readonly string[]).includes(difficulty) ? (difficulty as Difficulty) : null,
    quality: quality === 'high' || quality === 'low' || quality === 'auto' ? (quality as Quality) : null,
    camera,
    debug: import.meta.env.DEV || q.has('test') || q.has('debug'),
    autostart: q.get('autostart') === '1',
    code: q.get('code'),
  };
}

const appEl = document.getElementById('app');
if (!appEl) throw new Error('#app root missing');
const params = parseParams(location.search);

/** Friendly full-screen message instead of a blank page (e.g. no WebGL). textContent only. */
function showFatal(root: HTMLElement, error: unknown): void {
  console.error(error);
  root.textContent = '';
  const box = document.createElement('div');
  box.className = 'hp-fatal';
  const title = document.createElement('strong');
  title.textContent = 'HALL PASS can’t start on this browser.';
  const body = document.createElement('p');
  body.textContent = /webgl/i.test(String(error))
    ? 'It needs WebGL (3D graphics). Turn on hardware acceleration in your browser settings, or try a current Chrome, Edge, Firefox or Safari.'
    : 'Something went wrong while loading. Try reloading the page, or a current Chrome, Edge, Firefox or Safari.';
  box.append(title, body);
  root.appendChild(box);
}

try {
  const app = new App(appEl, params);
  if (params.debug) installDebugHooks(app);
  app.start();
} catch (e) {
  showFatal(appEl, e);
}
