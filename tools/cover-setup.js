// Stages the cover art (public/cover-art.jpg): a hall monitor looking down the hall, the student creeping up behind,
// HUD hidden, the logo on top. Run it in the page with tools/walk.mjs (see README "Cover art").
(() => {
  const hp = window.__HP__;
  const s = hp.state();
  const plan = hp.school();
  const i = plan.staff.findIndex((sp) => sp.archetype === 'patroller');
  const st = s.staff[i];
  const w = plan.staff[i].route[st.wp];
  w.look = Math.PI; w.sweep = 0;
  st.dwell = 1e9; st.ignore = 1e9; st.yaw = Math.PI; st.look = Math.PI; st.mode = 'route';
  for (const o of s.staff) o.ignore = 1e9;
  s.student.x = st.x + 0.55;
  s.student.z = st.z + 2.4;
  s.student.yaw = Math.PI;
  s.student.posture = 'sneak';
  hp.camera({ pitch: 34, distance: 7.5, fov: 42, cones: true });
  const css = document.createElement('style');
  css.textContent = '.hp-ui,.hp-menu,.hp-touch{display:none!important}';
  document.head.appendChild(css);
  const logo = document.createElement('div');
  logo.style.cssText = 'position:fixed;left:56px;top:150px;z-index:10;font:900 112px/0.86 "Arial Black",Arial,sans-serif;color:#f4f1ea;letter-spacing:-1px;text-shadow:0 7px 0 #b5523b,0 12px 30px rgba(0,0,0,.5);transform:rotate(-4deg);';
  logo.textContent = 'HALL';
  const l2 = document.createElement('div');
  l2.textContent = 'PASS';
  logo.appendChild(l2);
  const tag = document.createElement('div');
  tag.style.cssText = 'position:fixed;left:62px;top:400px;z-index:10;max-width:620px;font:800 28px/1.25 Arial,sans-serif;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.8);';
  tag.textContent = 'Three minutes until the bell.'; const t2 = document.createElement('div'); t2.textContent = 'No hall pass.'; tag.appendChild(t2);
  document.body.append(logo, tag);
  return 'ok';
})()
