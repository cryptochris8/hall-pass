// Inline SVG icons for every ControlIcon (touch buttons; the UI reuses them for prompts via
// controlIconSvg()). 48×48 viewBox, BAD HAIR DAY! house style: chunky cartoon shapes filled with
// `currentColor` (the button sets it: cream on the coral primary, coral on the cream small buttons)
// with a soft plum ink outline (PAL.uiPlum #3a2330) drawn behind the fill (paint-order="stroke") and
// plum details, so each icon reads on either button at 28–40 px.
// All strings are trusted constants — never interpolate user data into them.
import type { ControlIcon } from './types';

const INK = '#3a2330';

/** Filled shape with an ink outline drawn behind the fill. */
const fillAttrs = `fill="currentColor" stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"`;
/** Same, thinner outline (small parts). */
const fillThin = `fill="currentColor" stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke"`;

/** A stroked line in currentColor with an ink outline (ink drawn first, wider). */
function line(d: string, w: number): string {
  return (
    `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 4}" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`
  );
}

/** Plain ink detail stroke. */
const ink = (d: string, w = 2.6): string => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Chunky 4-point sparkle. */
function sparkle(cx: number, cy: number, r: number): string {
  const k = r * 0.2;
  return (
    `M${cx} ${cy - r}Q${cx + k} ${cy - k} ${cx + r} ${cy}Q${cx + k} ${cy + k} ${cx} ${cy + r}` +
    `Q${cx - k} ${cy + k} ${cx - r} ${cy}Q${cx - k} ${cy - k} ${cx} ${cy - r}Z`
  );
}

/** Water / coffee drop pointing down. */
const drop = (cx: number, cy: number, r: number): string =>
  `<path d="M${cx} ${cy - r * 1.7}C${cx + r * 0.4} ${cy - r * 0.9} ${cx + r} ${cy - r * 0.35} ${cx + r} ${cy + r * 0.2}A${r} ${r} 0 0 1 ${cx - r} ${cy + r * 0.2}C${cx - r} ${cy - r * 0.35} ${cx - r * 0.4} ${cy - r * 0.9} ${cx} ${cy - r * 1.7}Z" ${fillThin}/>`;

const HAND =
  `<path d="M15 33V16.5a3 3 0 0 1 6 0V25V12.5a3 3 0 0 1 6 0V25V14.5a3 3 0 0 1 6 0V26v-6.5a3 3 0 0 1 6 0V31c0 7.6-5.6 13-13 13-5.2 0-8.6-2.6-11-6.4l-5.4-8.2a3 3 0 0 1 4.8-3.6z" ${fillAttrs}/>` +
  ink('M21 25v4M27 25v4M33 26v3', 2.2);

// BAD HAIR DAY! house-style art (ui module).
const BODIES: Readonly<Record<ControlIcon, string>> = {
  go: `<path d="${sparkle(21, 27, 17)}" ${fillAttrs}/><path d="${sparkle(38.5, 10.5, 7)}" ${fillThin}/><circle cx="39" cy="37" r="3" fill="${INK}"/>`,
  hand: HAND + ink('M6 13l3.4 2.8M4.5 20.5l4-.2M40.5 6.5l-2.6 3.6', 2.4),
  whistle:
    ink('M40 10l3.5-3.5M42.5 17l4.5-1M34.5 8l1-4.5', 2.8) +
    `<circle cx="9.5" cy="15" r="3.6" fill="none" stroke="${INK}" stroke-width="2.8"/>` +
    `<path d="M18 18h19a3.2 3.2 0 0 1 3.2 3.2v4.4a3.2 3.2 0 0 1-3.2 3.2h-8.6A10.4 10.4 0 1 1 18 18z" ${fillAttrs}/>` +
    `<circle cx="18" cy="28.4" r="4.2" fill="${INK}"/>`,
  treat:
    `<path d="M11 17l2-7h22l2 7-2.4 25H13.4z" ${fillAttrs}/>` +
    ink('M13 10.2l2.6 3.4 2.6-3.4 2.6 3.4 2.6-3.4 2.6 3.4 2.6-3.4 2.6 3.4 2.6-3.4', 2.2) +
    `<path d="M17.5 27.5a2.8 2.8 0 1 1 4-2.6h5a2.8 2.8 0 1 1 4 2.6 2.8 2.8 0 1 1-4 2.6h-5a2.8 2.8 0 1 1-4-2.6z" fill="${INK}"/>`,
  brush:
    line('M30 30l11 11', 5) +
    `<ellipse cx="20" cy="20" rx="15" ry="11" transform="rotate(-45 20 20)" ${fillAttrs}/>` +
    `<g fill="${INK}"><circle cx="15" cy="20.5" r="1.7"/><circle cx="20" cy="15.5" r="1.7"/><circle cx="20" cy="21" r="1.7"/><circle cx="25" cy="19.5" r="1.7"/><circle cx="19" cy="26" r="1.7"/><circle cx="24.5" cy="25" r="1.7"/><circle cx="15.5" cy="15" r="1.7"/></g>`,
  pass:
    line('M22.5 32.5l7.5 7.5', 4) +
    `<ellipse cx="15.5" cy="25.5" rx="11" ry="8" transform="rotate(-45 15.5 25.5)" ${fillThin}/>` +
    `<g fill="${INK}"><circle cx="12" cy="26" r="1.4"/><circle cx="15.5" cy="22.5" r="1.4"/><circle cx="16" cy="27" r="1.4"/><circle cx="19.5" cy="25" r="1.4"/></g>` +
    line('M22 11c7-4.5 16-2 19 5.5', 3.6) +
    `<path d="M44 12.5l-2 8.5-7.5-4z" ${fillThin}/>`,
  done: line('M9 25l10 10L39 13', 6.5) + `<path d="${sparkle(40, 36, 6)}" ${fillThin}/>`,
  pour:
    `<path d="M9 21.5h21l-2.2 16.5a4 4 0 0 1-4 3.5H15.2a4 4 0 0 1-4-3.5z" ${fillAttrs}/>` +
    line('M29.5 24.5c4.5-1 7 1.5 5.8 5.5', 3) +
    `<path d="M9 21.5L5 14.5h24.5l.5 7" ${fillAttrs}/>` +
    `<path d="M12 12c0-3.5 3-6 7-6s7 2.5 7 6z" ${fillThin}/>` +
    drop(39.5, 13, 3.4) +
    drop(41, 25, 2.6),
  toss:
    `<path d="M9.5 42c-2.5-6 .5-14 6.5-16l-2.5-4.5h9L20 26c6 2 9 10 6.5 16z" ${fillAttrs}/>` +
    ink('M14 22.5l4.5 3 4.5-3', 2.4) +
    `<path d="M22 13C26 5.5 36 4 42 9.5" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="3.5 5"/>` +
    `<path d="M44.5 6.5l-.8 8.2-7-3.6z" ${fillThin}/>`,
  catch:
    `<path d="M5 25.5h11.5l3 3.5h9l3-3.5H43c0 10-8.4 17.5-19 17.5S5 35.5 5 25.5z" ${fillAttrs}/>` +
    `<ellipse cx="9.5" cy="24" rx="5" ry="3" ${fillThin}/><ellipse cx="38.5" cy="24" rx="5" ry="3" ${fillThin}/>` +
    ink('M13 31.5l3.2 3M35 31.5l-3.2 3M24 35v3.5', 2.2) +
    `<circle cx="24" cy="13.5" r="6" ${fillThin}/>` +
    ink('M15.5 6l2.6 3M32.5 6l-2.6 3M24 1.5v3.5', 2.4),
  drop:
    line('M24 6v18', 5.5) +
    `<path d="M14.5 20.5L24 31l9.5-10.5z" ${fillAttrs}/>` +
    `<path d="M7 34.5h8l3 5h12l3-5h8v6.5a2.5 2.5 0 0 1-2.5 2.5h-29A2.5 2.5 0 0 1 7 41z" ${fillAttrs}/>`,
  rinse:
    `<path d="M8 12.5h20a5 5 0 0 1 5 5V21h-7v-1.5H8z" ${fillAttrs}/>` +
    `<rect x="13" y="6" width="8" height="5" rx="2" ${fillThin}/>` +
    drop(29.5, 32, 4.4) +
    drop(20, 39.5, 3) +
    drop(38.5, 40.5, 2.8),
  music:
    `<path d="M18 13l20-5.5v6.5L18 19.5z" fill="${INK}"/>` +
    line('M18 35V14M38 30V9', 2.6) +
    `<ellipse cx="13" cy="36" rx="7" ry="5.2" transform="rotate(-20 13 36)" ${fillAttrs}/>` +
    `<ellipse cx="33" cy="31" rx="7" ry="5.2" transform="rotate(-20 33 31)" ${fillAttrs}/>`,
  run:
    ink('M3 18h9M2 25.5h7M4 33h6', 3) +
    `<path d="M13 32c0-6.4 1.8-12.4 4.6-15l5.4.8c2 3.2 6.2 5.2 11 6.2l7 1.8c2.8.8 4 2.8 4 5.6V32z" ${fillAttrs}/>` +
    `<path d="M12 33h34v3.8a3.2 3.2 0 0 1-3.2 3.2H15.2a3.2 3.2 0 0 1-3.2-3.2z" ${fillThin}/>` +
    ink('M22.8 21l3.6-2M25.6 24.2l3.6-2.2', 2.2),
  gas:
    `<path d="M24 4.5L40 20.5H30.5V24h-13v-3.5H8z" ${fillAttrs}/>` +
    `<path d="M24 22.5L40 38.5H30.5V43h-13v-4.5H8z" ${fillAttrs}/>`,
  brake:
    `<path d="M16.5 5h15L43 16.5v15L31.5 43h-15L5 31.5v-15z" ${fillAttrs}/>` +
    `<rect x="12" y="20.5" width="24" height="7" rx="3.5" fill="${INK}"/>`,
  honk:
    `<circle cx="11" cy="24" r="8" ${fillAttrs}/>` +
    `<path d="M17.5 20.5h5L37 10v28L22.5 27.5h-5z" ${fillAttrs}/>` +
    ink('M42 16.5l3.5-2.5M43.5 24h4M42 31.5l3.5 2.5', 2.8),
};

export const CONTROL_ICONS: readonly ControlIcon[] = Object.freeze(Object.keys(BODIES) as ControlIcon[]);

/**
 * Inline SVG markup for a ControlIcon (trusted constant). Unknown values fall back to 'go' so a
 * bad scheme can never inject markup or leave a button blank.
 */
export function controlIconSvg(icon: ControlIcon): string {
  const name: ControlIcon = isControlIcon(icon) ? icon : 'go';
  return `<svg class="hp-ico hp-ico--${name}" viewBox="0 0 48 48" aria-hidden="true" focusable="false">${BODIES[name]}</svg>`;
}

/** Own-property check (never trusts inherited keys like 'constructor'). */
export function isControlIcon(v: unknown): v is ControlIcon {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(BODIES, v);
}
