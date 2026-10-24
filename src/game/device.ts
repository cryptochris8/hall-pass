// Phone/tablet platform facts the app needs for mobile behaviour (fullscreen, render
// resolution budget). Detection reads the browser once; every decision is a pure function.
import type { Quality } from '../render/types';

export interface PlatformInfo {
  /** iPhone / iPod / iPad (incl. iPadOS, which reports a desktop Mac UA but has touch). */
  ios: boolean;
  /** Primary input is a finger: (pointer: coarse) and no hover. Phones and most tablets. */
  touchPrimary: boolean;
  /** Launched from the home screen / installed (display-mode standalone|fullscreen, or iOS navigator.standalone). */
  standalone: boolean;
  /** Element fullscreen is available (document.fullscreenEnabled + requestFullscreen). False on iPhone. */
  fullscreenApi: boolean;
}

/** iOS / iPadOS detection. iPadOS 13+ sends a Macintosh UA, but Macs have no multi-touch screen. */
export function detectIOS(ua: string, platform: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(ua) || /iPhone|iPad|iPod/i.test(platform)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

function mq(win: Window, query: string): boolean {
  try {
    return typeof win.matchMedia === 'function' && win.matchMedia(query).matches;
  } catch {
    return false;
  }
}

export function detectPlatform(win: Window = window): PlatformInfo {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  const doc = win.document;
  const ua = nav?.userAgent ?? '';
  const ios = detectIOS(ua, nav?.platform ?? '', nav?.maxTouchPoints ?? 0);
  const touchPrimary = mq(win, '(pointer: coarse)') && !mq(win, '(hover: hover)');
  const standalone = nav?.standalone === true || mq(win, '(display-mode: standalone)') || mq(win, '(display-mode: fullscreen)');
  const fullscreenApi =
    !!doc && doc.fullscreenEnabled === true && typeof doc.documentElement?.requestFullscreen === 'function';
  return { ios, touchPrimary, standalone, fullscreenApi };
}

/** The Fullscreen settings row is only offered where it can work (never on iPhone / iOS Safari). */
export function fullscreenAvailable(p: PlatformInfo): boolean {
  return p.fullscreenApi && !p.ios && !p.standalone;
}

export interface FullscreenState {
  /** Player setting. */
  enabled: boolean;
  /** document.fullscreenElement is set. */
  active: boolean;
  /** The player left fullscreen themselves (back gesture / Esc) this session: don't nag. */
  userExited: boolean;
}

/**
 * Enter fullscreen when a run starts from a tap? Only on touch-first devices with the Fullscreen
 * API (Android Chrome, most Android browsers), never on iOS, never when already installed as an
 * app (standalone/fullscreen display mode) and never again after the player backed out of it.
 */
export function shouldAutoFullscreen(p: PlatformInfo, s: FullscreenState): boolean {
  return fullscreenAvailable(p) && p.touchPrimary && s.enabled && !s.active && !s.userExited;
}

/**
 * Device pixels a phone renders by default (auto quality). ~1.2 MP keeps a mid-range phone GPU
 * near 60 fps with our fill rate (full-screen sky, fog, particles) while staying crisp:
 * 390×844 → ×1.9, 430×932 → ×1.75, 360×640 → ×2. Desktops keep the renderer's own cap (×2).
 */
export const PHONE_PIXEL_BUDGET = 1_200_000;
/** Never drop a phone's starting ratio below this (the adaptive governor can still go lower). */
const MIN_PHONE_RATIO = 1;
/** The renderer never renders above ×2. */
const MAX_RATIO = 2;

/**
 * Device-pixel-ratio cap handed to renderer.resize(). The renderer's adaptive governor starts at
 * this ratio and steps down (1.5 → 1 → 0.75) on sustained slow frames, so this only sets the
 * *starting* budget. 'high' is the player asking for full sharpness: no phone budget.
 */
export function renderDpr(dpr: number, cssW: number, cssH: number, touchPrimary: boolean, quality: Quality): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const top = Math.min(d, MAX_RATIO);
  if (!touchPrimary || quality === 'high') return top;
  const area = Math.max(1, cssW) * Math.max(1, cssH);
  const budget = Math.sqrt(PHONE_PIXEL_BUDGET / area);
  const floor = Math.min(top, MIN_PHONE_RATIO);
  return Math.round(Math.max(floor, Math.min(top, budget)) * 100) / 100;
}
