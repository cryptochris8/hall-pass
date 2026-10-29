// Menu + Hall Report styles (docs/ARCHITECTURE.md §8). Theme tokens on .hp-menu. System font stacks only (no
// network, no font packages): display = heavy grotesque, handwriting = whatever script face the device has.
export const MENU_CSS = `
.hp-menu { position: absolute; inset: 0; z-index: 4; display: grid; place-items: center; overflow: hidden;
  --hp-paper: #f4f1ea; --hp-ink: #1d2433; --hp-ink-soft: #4a5468; --hp-locker: #8fb39a; --hp-brick: #b5523b;
  --hp-cone: #ffd34d; --hp-alert: #e0453a; --hp-goal: #2e8bff; --hp-mint: #6fd3a8;
  --hp-display: 'Archivo Black', 'Arial Black', 'Helvetica Neue', Impact, system-ui, sans-serif;
  --hp-body: 'Archivo', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --hp-hand: 'Caveat', 'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', cursive;
  --hp-mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
  color: var(--hp-paper); font: 600 15px/1.35 var(--hp-body); pointer-events: auto;
  background: radial-gradient(120% 90% at 50% 30%, rgba(29,36,51,.35), rgba(16,20,30,.86));
  padding: max(14px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(14px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  box-sizing: border-box; }
.hp-menu[hidden] { display: none; }
.hp-menu.hp-clear { background: linear-gradient(180deg, rgba(16,20,30,.2), rgba(16,20,30,.6)); }
.hp-menu.hp-side { place-items: center start; background: linear-gradient(90deg, rgba(16,20,30,.55), rgba(16,20,30,0) 60%); }
.hp-menu.hp-side .hp-screen { width: min(430px, 100%); }
.hp-menu.hp-side .hp-item { min-height: 42px; padding: 7px 12px; }
@media (max-aspect-ratio: 1/1) {
  .hp-menu.hp-side { place-items: end center; background: linear-gradient(0deg, rgba(16,20,30,.6), rgba(16,20,30,0) 70%); }
  .hp-menu.hp-side .hp-screen { max-height: 58%; }
}
.hp-layout-menu { background: rgba(16,20,30,.78); border-radius: 18px; padding: 18px; box-shadow: 0 12px 40px rgba(0,0,0,.35);
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.hp-menu * { box-sizing: border-box; }
.hp-screen { width: min(560px, 100%); max-height: 100%; overflow: auto; display: flex; flex-direction: column; gap: 10px;
  animation: hp-in .22s ease-out both; scrollbar-width: thin; }
@keyframes hp-in { from { opacity: 0; transform: translateY(10px); } }
@media (prefers-reduced-motion: reduce) { .hp-screen, .hp-stamp, .hp-press { animation: none !important; } }
.hp-kicker { font: 800 12px/1 var(--hp-body); letter-spacing: .16em; text-transform: uppercase; color: var(--hp-cone); }
.hp-h1 { margin: 0; font: 900 clamp(30px, 7vw, 46px)/1 var(--hp-display); letter-spacing: .01em; text-transform: uppercase; }
.hp-sub { margin: 0; opacity: .85; font-weight: 500; }
.hp-items { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.hp-items.hp-row { flex-direction: row; flex-wrap: wrap; }
.hp-items.hp-row > * { flex: 1 1 140px; }
.hp-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 10px 14px; border: 0;
  border-radius: 12px; background: rgba(244,241,234,.1); color: inherit; font: inherit; text-align: left; cursor: pointer;
  outline: 3px solid transparent; outline-offset: 0; transition: background .12s, outline-color .12s; }
.hp-item:hover { background: rgba(244,241,234,.16); }
.hp-item.hp-focus { outline-color: var(--hp-cone); background: rgba(244,241,234,.18); }
.hp-item.hp-primary { background: var(--hp-goal); color: #fff; }
.hp-item.hp-primary.hp-focus { background: #4a9dff; }
.hp-item[aria-disabled="true"] { opacity: .45; cursor: default; }
.hp-item .hp-l { flex: 1 1 auto; min-width: 0; }
.hp-item .hp-l b { display: block; font: 800 16px/1.15 var(--hp-body); letter-spacing: .02em; }
.hp-item .hp-l small { display: block; margin-top: 2px; opacity: .78; font-weight: 500; font-size: 13px; }
.hp-item .hp-r { flex: none; font: 800 13px/1 var(--hp-body); opacity: .9; white-space: nowrap; }
.hp-choice .hp-r { display: flex; align-items: center; gap: 8px; }
.hp-choice .hp-r span { min-width: 9ch; text-align: center; }
.hp-arrow { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; background: rgba(244,241,234,.14); }
.hp-note { margin: 0; font-size: 13px; opacity: .75; font-weight: 500; }
.hp-tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
.hp-tbl td { padding: 5px 4px; border-bottom: 1px solid rgba(244,241,234,.12); }
.hp-tbl td:last-child { text-align: right; font-family: var(--hp-mono); }
.hp-tbl tr.hp-dim td { opacity: .45; }
.hp-field { display: flex; flex-direction: column; gap: 6px; font-weight: 800; }
.hp-field input { font: 800 26px/1 var(--hp-mono); letter-spacing: .12em; text-transform: uppercase; padding: 12px 14px; border-radius: 12px;
  border: 3px solid rgba(244,241,234,.25); background: rgba(244,241,234,.08); color: var(--hp-paper); outline: none; width: 100%; user-select: text; -webkit-user-select: text; }
.hp-field input:focus { border-color: var(--hp-cone); }
.hp-error { color: #ff8a80; font-weight: 700; }
.hp-share-img { width: 100%; height: auto; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.4); background: var(--hp-paper); }
.hp-share-text { margin: 0; white-space: pre-wrap; font: 700 13px/1.45 var(--hp-mono); background: rgba(244,241,234,.08); padding: 10px 12px; border-radius: 10px; user-select: text; -webkit-user-select: text; }
.hp-help { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; font-size: 14px; }
.hp-help b { color: var(--hp-cone); white-space: nowrap; }
.hp-help span { opacity: .9; font-weight: 500; }

/* Title */
.hp-layout-title { align-items: center; text-align: center; gap: 14px; width: min(720px, 100%); }
.hp-logo { margin: 0; font: 900 clamp(54px, 15vw, 128px)/.86 var(--hp-display); letter-spacing: -.01em; color: var(--hp-paper);
  text-shadow: 0 6px 0 var(--hp-brick), 0 10px 26px rgba(0,0,0,.45); transform: rotate(-3deg); }
.hp-logo small { display: block; font-size: .3em; letter-spacing: .3em; color: var(--hp-cone); text-shadow: none; transform: none; margin-top: .5em; }
.hp-tag { font: 600 clamp(15px, 3.4vw, 20px)/1.3 var(--hp-body); opacity: .92; max-width: 28em; }
.hp-press { margin-top: 10px; font: 900 clamp(18px, 4vw, 24px)/1 var(--hp-display); letter-spacing: .12em; color: var(--hp-cone);
  animation: hp-blink 1.3s steps(2, start) infinite; background: none; border: 0; cursor: pointer; padding: 10px 16px; }
@keyframes hp-blink { 50% { opacity: .25; } }

/* Mission card (fly-over) */
.hp-layout-card { align-self: end; margin-bottom: 3vh; }
.hp-card { width: min(520px, 100%); background: var(--hp-paper); color: var(--hp-ink);
  border-radius: 16px; padding: 16px 18px; box-shadow: 0 14px 40px rgba(0,0,0,.4); border-left: 10px solid var(--hp-goal); }
.hp-card .hp-kicker { color: var(--hp-brick); }
.hp-card .hp-h1 { font-size: clamp(26px, 6vw, 36px); }
.hp-card p { margin: 6px 0 0; }
.hp-card .hp-twist { color: var(--hp-ink-soft); font-weight: 600; }
.hp-card .hp-meta { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.hp-chip { display: inline-block; padding: 4px 8px; border-radius: 999px; background: rgba(29,36,51,.08); font: 800 12px/1 var(--hp-body);
  letter-spacing: .06em; text-transform: uppercase; }
.hp-card .hp-go { margin-top: 12px; font: 800 13px/1 var(--hp-body); letter-spacing: .1em; color: var(--hp-goal); text-transform: uppercase; }

/* Hall Report: a school report card */
.hp-layout-report { width: min(600px, 100%); }
.hp-paper { position: relative; background: var(--hp-paper); color: var(--hp-ink); border-radius: 6px; padding: 18px 20px 16px;
  box-shadow: 0 16px 44px rgba(0,0,0,.45); background-image: repeating-linear-gradient(180deg, transparent 0 27px, rgba(46,139,255,.12) 27px 28px);
  overflow: hidden; }
.hp-paper::before { content: ''; position: absolute; left: 44px; top: 0; bottom: 0; width: 2px; background: rgba(224,69,58,.35); }
.hp-paper.hp-slip { background-color: #f7d9d4; }
.hp-rhead { position: relative; display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; padding-left: 36px; }
.hp-rhead h2 { margin: 0; font: 900 clamp(20px, 5vw, 28px)/1.05 var(--hp-display); text-transform: uppercase; }
.hp-rhead small { display: block; margin-top: 4px; color: var(--hp-ink-soft); font-weight: 600; font-size: 13px; }
.hp-grade { flex: none; display: grid; place-items: center; width: 74px; height: 74px; border: 4px solid var(--hp-alert); border-radius: 50%;
  color: var(--hp-alert); font: 700 40px/1 var(--hp-hand); transform: rotate(-8deg); }
.hp-lines { position: relative; margin: 12px 0 6px 36px; width: calc(100% - 36px); border-collapse: collapse; font-size: 14px; }
.hp-lines td { padding: 3px 0; height: 28px; }
.hp-lines td:nth-child(2) { color: var(--hp-ink-soft); font-family: var(--hp-mono); font-size: 13px; padding: 0 8px; white-space: nowrap; }
.hp-lines td:last-child { text-align: right; font-family: var(--hp-mono); font-weight: 700; white-space: nowrap; }
.hp-lines tr.hp-neg td:last-child { color: var(--hp-alert); }
.hp-lines tr.hp-total td { border-top: 2px solid var(--hp-ink); font-weight: 800; font-size: 16px; }
.hp-stamp { position: relative; display: inline-block; margin: 8px 0 2px 36px; padding: 6px 14px; border: 4px solid currentColor; border-radius: 8px;
  font: 900 clamp(24px, 6vw, 34px)/1 var(--hp-display); letter-spacing: .06em; transform: rotate(-4deg); animation: hp-stamp .35s cubic-bezier(.2,1.6,.4,1) both .15s; }
@keyframes hp-stamp { from { opacity: 0; transform: scale(1.8) rotate(-4deg); } }
.hp-stamp.hp-GHOST { color: #2b8a6e; } .hp-stamp.hp-SMOOTH { color: var(--hp-goal); }
.hp-stamp.hp-CLOSE { color: #c77700; } .hp-stamp.hp-DETENTION { color: var(--hp-alert); }
.hp-remarks { position: relative; margin: 8px 0 0 36px; padding: 0; list-style: none; font: 700 clamp(19px, 4.4vw, 23px)/1.22 var(--hp-hand); color: #23419a; }
.hp-remarks li + li { margin-top: 4px; }
.hp-best { position: relative; margin: 8px 0 0 36px; font: 800 12px/1 var(--hp-body); letter-spacing: .12em; text-transform: uppercase; color: var(--hp-brick); }
@media (max-height: 520px) {
  .hp-paper { padding: 12px 14px; }
  .hp-lines td { height: 22px; padding: 1px 0; }
  .hp-grade { width: 56px; height: 56px; font-size: 30px; }
  .hp-item { min-height: 40px; padding: 7px 12px; }
}
`;
