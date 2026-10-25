// Audio bench (dev server only): a button for every SFX and music track, the sneak-track intensity, ambience and
// muffle controls, and the offline QA report.
// Automation: window.__audio (the engine), window.__audioQa(part?, quick?) → { failures, warnings, lines }.
import { createAudioEngine } from '../src/audio/index';
import { formatQa, runQa, type QaPart } from '../src/audio/qa';
import { SFX_NAMES } from '../src/audio/sfx';
import type { MusicTrack } from '../src/audio/types';

const audio = createAudioEngine();

declare global {
  interface Window {
    __audio?: typeof audio;
    __audioQa?: (part?: QaPart, quick?: boolean) => Promise<{ failures: number; warnings: number; lines: string[] }>;
  }
}

window.__audio = audio;
window.__audioQa = async (part: QaPart = 'all', quick = true) => {
  const s = await runQa(quick, part);
  return { failures: s.failures, warnings: s.warnings, lines: formatQa(s) };
};
for (const t of ['pointerup', 'keydown', 'click'] as const) window.addEventListener(t, () => audio.unlock());

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const btn = (parent: HTMLElement, label: string, fn: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', fn);
  parent.appendChild(b);
  return b;
};
const tracks: MusicTrack[] = ['title', 'menu', 'sneak', 'report', 'none'];
const tb = tracks.map((t) =>
  btn($('music'), t, () => {
    audio.setMusic(t);
    tb.forEach((b, i) => b.classList.toggle('on', tracks[i] === t));
  }),
);
for (const n of SFX_NAMES) btn($('sfx'), n, () => audio.play(n));
$('intensity').addEventListener('input', (e) => audio.setIntensity(Number((e.target as HTMLInputElement).value)));
$('ambience').addEventListener('change', (e) => audio.setAmbience((e.target as HTMLInputElement).checked ? 0.6 : -1));
$('muffle').addEventListener('change', (e) => audio.setMuffled((e.target as HTMLInputElement).checked));
$('qa').addEventListener('click', async () => {
  $('out').textContent = 'Rendering…';
  const r = await window.__audioQa!('all', true);
  $('out').textContent = r.lines.join('\n');
});
(window as unknown as { __DEV__: { ready: boolean } }).__DEV__ = { ready: true };
