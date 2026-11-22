// Accessibility audit of Gesso running in the preview. Loaded by
// dev/preview/index.html?a11y=1; results in window.__a11y. Run by test.sh in
// dark and light (?theme=light).
//
// For every route (and the main dialogs) it checks, inside the shadow root:
//   name       every interactive element has an accessible name
//   nested     no interactive element inside a link or button
//   ids        ids are unique; aria-labelledby/-describedby/-controls/
//              -activedescendant and label[for] point at existing ids
//   img        images have alt (empty is fine for decoration)
//   focus      nothing non-interactive is in the tab order (tabindex=0 on a
//              plain span/div without a role)
//   headings   no skipped levels inside the view (h2 → h4)
// And once per theme:
//   contrast   text tokens on surface tokens meet WCAG AA (4.5:1 normal text;
//              3:1 for the faint/disabled tier and non-text accents)
//   motion     a prefers-reduced-motion rule exists
(async () => {
  const host = document.getElementById('host');
  const shadow = host.shadowRoot;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const findings = [];
  const add = (where, rule, el, msg) => findings.push({ where, rule, el: el ? describe(el) : '', msg });
  function describe(el) {
    const cls = el.getAttribute('class') ? `.${String(el.getAttribute('class')).trim().split(/\s+/).slice(0, 3).join('.')}` : '';
    const fk = el.getAttribute('data-fkey') ? `[${el.getAttribute('data-fkey')}]` : '';
    return `${el.tagName.toLowerCase()}${cls}${fk} "${(el.textContent || '').trim().slice(0, 40)}"`;
  }

  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="checkbox"], [role="radio"], [role="option"], [role="combobox"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const byId = (id) => shadow.getElementById ? shadow.getElementById(id) : shadow.querySelector(`#${CSS.escape(id)}`);

  function accessibleName(el) {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    const lb = el.getAttribute('aria-labelledby');
    if (lb) {
      const t = lb.split(/\s+/).map((id) => byId(id)?.textContent || '').join(' ').trim();
      if (t) return t;
    }
    if (el.id) {
      const lab = shadow.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lab && lab.textContent.trim()) return lab.textContent.trim();
    }
    const wrap = el.closest('label');
    if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
    if (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type) && el.value) return el.value;
    if (el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['submit', 'button', 'reset', 'checkbox', 'radio'].includes(el.type)) || el.tagName === 'TEXTAREA') {
      return el.getAttribute('title') || '';
    }
    const text = (el.textContent || '').trim();
    if (text) return text;
    const img = el.querySelector('img[alt]');
    if (img && img.alt.trim()) return img.alt.trim();
    return el.getAttribute('title') || '';
  }

  function audit(where) {
    const root = shadow;
    // ids
    const seen = new Map();
    for (const el of root.querySelectorAll('[id]')) {
      if (seen.has(el.id)) add(where, 'ids', el, `duplicate id "${el.id}"`);
      seen.set(el.id, el);
    }
    for (const attr of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-activedescendant']) {
      for (const el of root.querySelectorAll(`[${attr}]`)) {
        for (const id of el.getAttribute(attr).split(/\s+/).filter(Boolean)) if (!byId(id)) add(where, 'ids', el, `${attr} → missing #${id}`);
      }
    }
    for (const lab of root.querySelectorAll('label[for]')) if (!byId(lab.getAttribute('for'))) add(where, 'ids', lab, `label for → missing #${lab.getAttribute('for')}`);

    for (const el of root.querySelectorAll(INTERACTIVE)) {
      if (el.closest('[hidden], [inert]') || el.disabled) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (!accessibleName(el)) add(where, 'name', el, 'no accessible name');
      const outer = el.parentElement?.closest('a[href], button');
      if (outer) add(where, 'nested', el, `inside ${describe(outer)}`);
      const ti = el.getAttribute('tabindex');
      if (ti === '0' && /^(SPAN|DIV|LI|P|SECTION)$/.test(el.tagName) && !el.getAttribute('role')) add(where, 'focus', el, 'focusable without a role or action');
    }
    for (const img of root.querySelectorAll('img')) if (!img.hasAttribute('alt')) add(where, 'img', img, 'img without alt');

    // headings inside the main view
    let prev = 1; // the top bar's h1
    for (const hd of root.querySelectorAll('main h1, main h2, main h3, main h4, main h5, main h6, dialog[open] h2, dialog[open] h3')) {
      const lvl = Number(hd.tagName[1]);
      if (hd.closest('dialog')) continue;
      if (lvl > prev + 1) add(where, 'headings', hd, `h${prev} → h${lvl}`);
      prev = lvl;
    }
  }

  // ---- contrast of design tokens ---------------------------------------------
  function parseColor(c) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillStyle = c;
    const v = ctx.fillStyle;
    if (v.startsWith('#')) return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).concat(1);
    const m = v.match(/rgba?\(([^)]+)\)/);
    const p = m[1].split(',').map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  const lum = ([r, g, b]) => [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
    .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (fg, bg) => fg[3] >= 1 ? fg : [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

  function contrast(where) {
    const cs = getComputedStyle(host);
    const tok = (n) => parseColor(cs.getPropertyValue(`--${n}`).trim());
    const surfaces = ['bg', 'surface', 'surface-2'];
    const checks = [
      ...['text', 'text-2'].flatMap((t) => surfaces.map((s) => [t, s, 4.5])),
      ...surfaces.map((s) => ['text-3', s, 4.5]),
      ['text-3', 'surface-3', 3],
      ...['accent-text', 'danger', 'warn', 'ok', 'info'].flatMap((t) => ['surface', 'bg'].map((s) => [t, s, 4.5])),
      ...['danger', 'warn', 'ok', 'info'].map((t) => [t, `${t}-soft`, 4.5, 'surface']),
      ['accent-fg', 'accent', 4.5],
      ['focus', 'surface', 3], ['focus', 'bg', 3], // focus ring (non-text, WCAG 1.4.11)
    ];
    for (const [fg, bg, min, under] of checks) {
      const base = under ? tok(under) : null;
      const b = base ? over(tok(bg), base) : tok(bg);
      const r = ratio(over(tok(fg), b), b);
      if (r < min) add(where, 'contrast', null, `--${fg} on --${bg}${under ? ` (over --${under})` : ''}: ${r.toFixed(2)}:1 < ${min}:1`);
    }
    const css = Gesso.styles.sheets.join('\n');
    if (!/prefers-reduced-motion:\s*reduce/.test(css)) add(where, 'motion', null, 'no prefers-reduced-motion rule');
  }

  // ---- drive ----------------------------------------------------------------
  const wait = async (fn, ms = 4000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) return false; await sleep(30); } return true; };
  await wait(() => window.__ready && window.__ready(), 8000);
  const theme = host.getAttribute('data-theme');
  contrast(`tokens (${theme})`);

  const routes = ['/', '/assignments', '/courses', '/calendar/week/2026-11-15', '/calendar/month/2026-11', '/calendar/agenda/2026-11-18', '/grades', '/settings', '/debug',
    '/courses/101', '/courses/101/assignments', '/courses/101/modules', '/courses/101/files', '/courses/101/announcements', '/courses/101/grades',
    '/courses/101/assignments/1', '/courses/105/discussions/901', '/courses/103/peer-reviews/24?reviewee=4724', '/courses/106'];
  for (const r of routes) {
    location.hash = r;
    await sleep(250);
    await wait(() => !shadow.querySelector('main .skel'), 3000);
    audit(r);
  }
  // Dialogs
  location.hash = '/';
  await sleep(200);
  const dialogs = [
    ['palette', () => Gesso.palette.show()],
    ['shortcuts', () => Gesso.shortcuts.showHelp()],
    ['to-do', () => Gesso.plannerUi.openTodo()],
    ['snooze', () => Gesso.plannerUi.openSnooze(Gesso.derive.workItems(Gesso.store.get().data).find((i) => Gesso.planner.linkTarget(i)))],
    ['course settings', () => Gesso.courseSettings.open(Gesso.store.get().data.courses[0])],
  ];
  for (const [name, open] of dialogs) {
    open();
    await sleep(150);
    audit(`dialog: ${name}`);
    shadow.querySelectorAll('dialog[open]').forEach((d) => d.close());
    await sleep(80);
  }

  window.__a11y = { theme, count: findings.length, findings };
  for (const f of findings) console.error(`A11Y ${f.where} · ${f.rule} · ${f.el} · ${f.msg}`);
  console.log(`a11y (${theme}): ${findings.length} finding(s)`);
})();
