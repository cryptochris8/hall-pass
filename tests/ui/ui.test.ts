// @vitest-environment jsdom
// Menus (src/ui): focus navigation from MenuActions, choices, row layout, and user text as plain text.
import { describe, expect, it, vi } from 'vitest';
import { Ui } from '../../src/ui';
import { reportCard } from '../../src/ui/screens';
import type { HallReport } from '../../src/sim/score';

function setup(): Ui {
  document.body.textContent = '';
  const root = document.createElement('div');
  document.body.appendChild(root);
  return new Ui(root);
}

describe('ui', () => {
  it('up/down move focus (skipping disabled items), confirm picks, back goes back', () => {
    const ui = setup();
    const picked: string[] = [];
    const back = vi.fn();
    ui.show({
      id: 'm',
      title: 'Menu',
      items: [
        { kind: 'button', label: 'A', onPick: () => picked.push('A') },
        { kind: 'button', label: 'B', disabled: true, onPick: () => picked.push('B') },
        { kind: 'button', label: 'C', onPick: () => picked.push('C') },
      ],
      onBack: back,
    });
    expect(ui.screenId).toBe('m');
    ui.handle(['down', 'confirm']);
    expect(picked).toEqual(['C']);
    ui.handle(['down', 'confirm']); // wraps to A
    expect(picked).toEqual(['C', 'A']);
    ui.handle(['back']);
    expect(back).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('.hp-focus').length).toBe(1);
  });

  it('left/right cycle a choice and report the value', () => {
    const ui = setup();
    const seen: string[] = [];
    ui.show({
      id: 'c',
      items: [{ kind: 'choice', label: 'Difficulty', options: [{ value: 'f', label: 'F' }, { value: 'j', label: 'J' }, { value: 's', label: 'S' }], value: 'j', onChange: (v) => seen.push(v) }],
    });
    ui.handle(['right', 'right', 'left', 'confirm']);
    expect(seen).toEqual(['s', 'f', 's', 'f']);
    expect(document.querySelector('.hp-choice .hp-r span:nth-child(2)')!.textContent).toBe('F');
  });

  it('onAny screens take any confirm; hide() clears', () => {
    const ui = setup();
    const any = vi.fn();
    ui.show({ id: 't', layout: 'title', items: [], onAny: any });
    ui.handle(['confirm']);
    expect(any).toHaveBeenCalledOnce();
    ui.hide();
    expect(ui.visible).toBe(false);
    expect(ui.handle(['confirm'])).toBe(false);
  });

  it('text is text: markup in labels and report fields never becomes HTML', () => {
    const ui = setup();
    ui.show({ id: 'x', title: '<img src=x onerror=alert(1)>', items: [{ kind: 'button', label: '<b>bold</b>', onPick: () => {} }] });
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('.hp-item b')!.textContent).toBe('<b>bold</b>');
    const r: HallReport = {
      mission: 'phone', difficulty: 'junior', success: true, outcome: 'success', rank: 'GHOST', grade: 'A+',
      lines: [{ label: 'Mission complete', detail: '', points: 1000 }], raw: 1000, multiplier: 1, total: 1000, par: 1000,
      seconds: 60, secondsLeft: 90, spotted: 0, caught: 0, remarks: ['<script>x</script>'],
    };
    const card = reportCard(r, { school: '<i>School</i>', context: 'Quick period', newBest: true });
    expect(card.querySelector('script')).toBeNull();
    expect(card.querySelector('i')).toBeNull();
    expect(card.textContent).toContain('<i>School</i>');
    expect(card.querySelector('.hp-grade')!.textContent).toBe('A+');
  });
});
