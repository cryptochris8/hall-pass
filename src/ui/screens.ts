// Screen content builders (docs/GDD.md §1, §8): the mission card, the Hall Report card, and small tables for the
// menus. They only build DOM from data (textContent everywhere); the flow (src/game/app.ts) wires the items.
import type { Difficulty, MissionId } from '../school/types';
import type { HallReport } from '../sim/score';
import { el } from './index';
import { DIFFICULTY_NAME, GOAL_LINE, MISSION_NAME, TWIST, clock } from './text';

export interface CardInfo {
  kicker: string;
  mission: MissionId;
  difficulty: Difficulty;
  school: string;
  motto: string;
  bellSeconds: number;
  passes: number;
  snacks: number;
  /** Your best score here when its ghost will race you (null: no ghost). */
  ghost?: number | null;
  /** A friend's score to beat (challenge codes). */
  toBeat?: number | null;
}

export function missionCard(c: CardInfo, goLabel: string): HTMLElement {
  const card = el('div', 'hp-card');
  card.append(el('div', 'hp-kicker', c.kicker));
  card.append(el('h2', 'hp-h1', MISSION_NAME[c.mission]));
  card.append(el('p', '', GOAL_LINE[c.mission] + ', then get back to your seat before the bell.'));
  card.append(el('p', 'hp-twist', TWIST[c.mission]));
  const meta = el('div', 'hp-meta');
  meta.append(
    el('span', 'hp-chip', `Bell ${clock(c.bellSeconds)}`),
    el('span', 'hp-chip', DIFFICULTY_NAME[c.difficulty]),
    el('span', 'hp-chip', c.passes === 0 ? 'No hall pass' : `${c.passes} hall pass${c.passes > 1 ? 'es' : ''}`),
  );
  if (c.snacks > 0) meta.append(el('span', 'hp-chip', `${c.snacks} snack packs hidden`));
  if (c.ghost) meta.append(el('span', 'hp-chip', `Ghost of your best: ${c.ghost}`));
  if (c.toBeat) meta.append(el('span', 'hp-chip', `Score to beat: ${c.toBeat}`));
  card.append(meta);
  card.append(el('p', 'hp-twist', `${c.school} · ${c.motto}`));
  card.append(el('div', 'hp-go', goLabel));
  return card;
}

export interface ReportInfo {
  school: string;
  /** "SCHOOL WEEK · WEDNESDAY", "DAILY PERIOD #55", "QUICK PERIOD". */
  context: string;
  newBest: boolean;
  /** Extra line under the remarks (week progress, daily first attempt…). */
  footer?: string;
}

export function reportCard(r: HallReport, info: ReportInfo): HTMLElement {
  const paper = el('div', `hp-paper${r.rank === 'DETENTION' ? ' hp-slip' : ''}`);
  const head = el('div', 'hp-rhead');
  const h = el('div');
  h.append(el('h2', '', r.rank === 'DETENTION' ? (r.outcome === 'timeout' ? 'TARDY SLIP' : 'DETENTION SLIP') : 'HALL REPORT'));
  h.append(el('small', '', `${MISSION_NAME[r.mission]} · ${DIFFICULTY_NAME[r.difficulty]} · ${info.school}`));
  h.append(el('small', '', info.context));
  head.append(h, el('div', 'hp-grade', r.grade));
  paper.append(head);

  const t = el('table', 'hp-lines');
  const row = (label: string, detail: string, pts: string, cls = ''): void => {
    const tr = el('tr', cls);
    tr.append(el('td', '', label), el('td', '', detail), el('td', '', pts));
    t.append(tr);
  };
  if (r.lines.length === 0) row(r.outcome === 'timeout' ? 'Not in your seat at the bell' : 'Mission not done', '', '0');
  for (const l of r.lines) row(l.label, l.detail, l.points > 0 ? `+${l.points}` : String(l.points), l.points < 0 ? 'hp-neg' : '');
  if (r.multiplier !== 1) row(`${DIFFICULTY_NAME[r.difficulty]} multiplier`, `×${r.multiplier}`, '');
  row('TOTAL', '', String(r.total), 'hp-total');
  paper.append(t);

  const rankCls = r.rank === 'CLOSE CALL' ? 'CLOSE' : r.rank;
  paper.append(el('div', `hp-stamp hp-${rankCls}`, r.rank));
  const ul = el('ul', 'hp-remarks');
  for (const m of r.remarks) ul.append(el('li', '', m));
  paper.append(ul);
  const best = [info.newBest && r.total > 0 ? 'New personal best' : '', `Time ${clock(r.seconds)}`, `Par ${r.par}`, info.footer ?? ''].filter(Boolean).join(' · ');
  paper.append(el('div', 'hp-best', best));
  return paper;
}

/** A two-column table (records, week days). Rows with `dim` are greyed (not played yet). */
export function table(rows: { left: string; right: string; dim?: boolean }[]): HTMLElement {
  const t = el('table', 'hp-tbl');
  for (const r of rows) {
    const tr = el('tr', r.dim ? 'hp-dim' : '');
    tr.append(el('td', '', r.left), el('td', '', r.right));
    t.append(tr);
  }
  return t;
}

export function helpGrid(rows: [string, string][]): HTMLElement {
  const g = el('div', 'hp-help');
  for (const [k, v] of rows) g.append(el('b', '', k), el('span', '', v));
  return g;
}
