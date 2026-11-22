// Interaction checks against Gesso running in the preview: command palette,
// shortcuts, the ? overlay, settings controls, the popup summary.
// Loaded by dev/preview/index.html?uicheck=1 after the app starts; results in
// window.__uiChecks. Run by dev/tools/test.sh.
(async () => {
  const results = [];
  const host = document.getElementById('host');
  const shadow = host.shadowRoot;
  const $ = (sel) => shadow.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 3000, what = 'condition') {
    const end = Date.now() + ms;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await sleep(30);
    }
  }
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (err) { results.push({ name, ok: false, error: String(err && err.message || err) }); }
    // Leave every check with no dialog open.
    shadow.querySelectorAll('dialog[open]').forEach((d) => d.close());
    await sleep(30);
  };
  const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
  const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  /** Key press from inside the shadow root (retargeted like a real one). */
  const press = (key, opts = {}, target = $('main')) => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...opts }));
  const go = async (path) => { location.hash = path; await sleep(150); };

  await waitFor(() => window.__ready && window.__ready(), 8000, 'app ready');

  await check('⌘K opens the palette with focus in the combobox', async () => {
    press('k', { metaKey: true });
    const dlg = await waitFor(() => $('dialog.palette[open]'), 1000, 'palette');
    const input = dlg.querySelector('input[role="combobox"]');
    ok(shadow.activeElement === input, 'focus in input');
    ok(input.getAttribute('aria-controls') === 'palette-list' && input.getAttribute('aria-activedescendant') === 'pal-opt-0', 'combobox wiring');
    ok(dlg.querySelectorAll('[role="option"]').length > 5, 'default results');
    press('k', { metaKey: true }, input);
    await waitFor(() => !$('dialog.palette'), 1000, 'palette closed by ⌘K');
  });

  await check('palette: type, arrow, Enter navigates to the assignment', async () => {
    await go('/');
    Gesso.palette.show();
    const input = await waitFor(() => $('dialog.palette[open] input'));
    input.value = 'lab 9';
    input.dispatchEvent(new Event('input'));
    const first = await waitFor(() => $('#pal-opt-0'));
    ok(/Lab 9: Recursion/.test(first.textContent), `first result: ${first.textContent}`);
    press('ArrowDown', {}, input);
    ok(input.getAttribute('aria-activedescendant') === 'pal-opt-1' || !$('#pal-opt-1'), 'arrow moves');
    press('ArrowUp', {}, input);
    ok(input.getAttribute('aria-activedescendant') === 'pal-opt-0', 'arrow back');
    press('Enter', {}, input);
    await waitFor(() => location.hash === '#/courses/101/assignments/2', 1500, `hash, got ${location.hash}`);
    ok(!$('dialog.palette'), 'closed after opening');
  });

  await check('palette: actions run (theme toggle), and focus returns to the opener', async () => {
    await go('/');
    const btn = $('[data-fkey="palette-open"]');
    btn.focus();
    btn.click();
    const input = await waitFor(() => $('dialog.palette[open] input'));
    input.value = 'light theme';
    input.dispatchEvent(new Event('input'));
    press('Enter', {}, input);
    await waitFor(() => host.getAttribute('data-theme') === 'light', 1500, 'light theme');
    ok(shadow.activeElement?.getAttribute('data-fkey') === 'palette-open', `focus back on the opener, got ${shadow.activeElement?.outerHTML?.slice(0, 80)}`);
    await Gesso.settings.update({ theme: 'dark' });
    await waitFor(() => host.getAttribute('data-theme') === 'dark');
  });

  await check('palette: no matches shows a message', async () => {
    Gesso.palette.show();
    const input = await waitFor(() => $('dialog.palette[open] input'));
    input.value = 'zzzzqqqq';
    input.dispatchEvent(new Event('input'));
    await waitFor(() => $('.palette__empty'), 1000, 'empty message');
    ok(!input.hasAttribute('aria-activedescendant'), 'no active option');
  });

  await check('g a / g c / g g / g d navigate', async () => {
    await go('/');
    for (const [k, hash] of [['a', '#/assignments'], ['c', '#/calendar'], ['g', '#/grades'], ['o', '#/courses'], ['s', '#/settings'], ['d', '#/']]) {
      press('g'); press(k);
      await waitFor(() => location.hash === hash, 1000, `g ${k} → ${hash} (at ${location.hash})`);
    }
  });

  await check("g a on the calendar goes to Assignments (doesn't switch the calendar to agenda)", async () => {
    await go('/calendar/week/2026-11-15');
    await waitFor(() => $('.cal'), 2000, 'calendar');
    press('g'); press('a');
    await waitFor(() => location.hash === '#/assignments', 1000, `hash ${location.hash}`);
    await go('/calendar/week/2026-11-15');
    await waitFor(() => $('.cal'));
    press('a');
    await waitFor(() => location.hash.startsWith('#/calendar/agenda'), 1000, 'plain a still switches to agenda');
  });

  await check('shortcuts stay quiet while typing', async () => {
    await go('/assignments');
    const input = await waitFor(() => $('input[type="search"]'), 2000, 'search field');
    input.focus();
    press('g', {}, input); press('d', {}, input);
    await sleep(100);
    ok(location.hash === '#/assignments', `moved to ${location.hash}`);
    press('?', { shiftKey: true }, input);
    await sleep(50);
    ok(!$('dialog[open]'), 'no help overlay while typing');
  });

  await check('? opens the shortcut list; ⌘K is ignored over another dialog', async () => {
    await go('/calendar/week/2026-11-15');
    press('?', { shiftKey: true });
    const dlg = await waitFor(() => $('dialog[open]'), 1000, 'help');
    ok(/Keyboard shortcuts/.test(dlg.textContent) && /g\s*a/.test(dlg.textContent.replace(/\s+/g, ' ')), 'content');
    ok(dlg.querySelector('.keys--here'), 'calendar section highlighted on the calendar');
    press('k', { metaKey: true }, dlg.querySelector('button'));
    await sleep(80);
    ok(!$('dialog.palette'), 'no palette stacked on the help dialog');
  });

  await check('settings: accent, density, default view, due-soon window write settings', async () => {
    await go('/settings');
    await waitFor(() => $('[data-fkey="set-accent:#e0876a"]'), 2000, 'settings page');
    $('[data-fkey="set-accent:#e0876a"]').click();
    await waitFor(() => host.style.getPropertyValue('--accent') === '#e0876a', 1000, 'accent applied');
    const compact = $('[data-fkey="set-density:compact"]');
    compact.click();
    await waitFor(() => host.getAttribute('data-density') === 'compact', 1000, 'density');
    const sel = $('[data-fkey="set-default-view"]');
    sel.value = 'calendar'; sel.dispatchEvent(new Event('change'));
    const due = $('[data-fkey="set-due-soon"]');
    due.value = '14'; due.dispatchEvent(new Event('change'));
    await waitFor(() => Gesso.store.get().settings.defaultView === 'calendar' && Gesso.store.get().settings.dueSoonDays === 14, 1000, 'stored');
    await Gesso.settings.reset();
    await waitFor(() => host.getAttribute('data-density') === 'comfortable' && Gesso.store.get().settings.dueSoonDays === 7, 1000, 'reset');
  });

  await check('settings: theme gallery switches themes; the custom editor previews live and saves on change', async () => {
    await go('/settings');
    const card = await waitFor(() => $('[data-fkey="theme:harbor"]'), 2000, 'gallery');
    ok($('.tgallery').getAttribute('role') === 'radiogroup', 'radiogroup');
    card.click();
    const harbor = Gesso.themes.resolve({ themeId: 'harbor' }, 'dark');
    await waitFor(() => host.style.getPropertyValue('--bg') === harbor.bg && host.getAttribute('data-theme-id') === 'harbor', 1000, 'harbor applied');
    ok($('.tcard--on [data-fkey="theme:harbor"]'), 'selected state');
    ok(Gesso.themes.readPaintRecord(localStorage.getItem('gesso.paint'))?.bg === harbor.bg, 'paint mirror written');
    // Course colors from the theme palette, then back.
    $('[data-fkey="set-course-colors:theme"]').click();
    await waitFor(() => $('.pstrip'), 1000, 'palette strip');
    $('[data-fkey="set-course-colors:canvas"]').click();
    // Create a custom theme from the current one.
    $('[data-fkey="theme:custom"]').click();
    await waitFor(() => $('#set-custom'), 1500, 'custom editor');
    eq(Gesso.store.get().settings.customTheme.base, 'harbor');
    // Live preview: moving the accent changes the page but writes nothing.
    const well = $('[data-fkey="ced:accent"]');
    well.value = '#e0876a'; well.dispatchEvent(new Event('input'));
    ok(host.style.getPropertyValue('--accent') === '#e0876a', 'previewed');
    ok(Gesso.store.get().settings.customTheme.accent === '', 'not saved yet');
    well.dispatchEvent(new Event('change'));
    await waitFor(() => Gesso.store.get().settings.customTheme.accent === '#e0876a', 1000, 'saved on change');
    // A hand-picked low-contrast text color is reported.
    const text = $('[data-fkey="ced:text"]');
    text.value = '#3a3a3a'; text.dispatchEvent(new Event('change'));
    await waitFor(() => $('.ced-check--warn'), 1000, 'contrast warning');
    ok(/Text on/.test($('.ced-check--warn').textContent), 'names the pair');
    $('[data-fkey="ced-auto:text"]').click();
    await waitFor(() => $('.ced-check--ok'), 1000, 'back to readable');
    // Export produces a valid theme file.
    $('[data-fkey="ced-export"]').click();
    await waitFor(() => Gesso.diagnostics?.lastThemeExport, 1000, 'export');
    ok(Gesso.themes.parseFile(Gesso.diagnostics.lastThemeExport.text).ok, 'exported file parses');
    await Gesso.settings.reset();
    await waitFor(() => host.getAttribute('data-theme-id') === 'gesso', 1000, 'reset to Gesso');
  });

  await check('settings: launcher toggle and GPA scale dialog', async () => {
    const cb = await waitFor(() => $('[data-fkey="set-launcher"]'));
    cb.click();
    await waitFor(() => Gesso.store.get().settings.showLauncher === false, 1000, 'launcher off');
    $('[data-fkey="set-launcher"]').click();
    await waitFor(() => Gesso.store.get().settings.showLauncher === true, 1000, 'launcher on');
    $('[data-fkey="set-gpa"]').click();
    const dlg = await waitFor(() => $('dialog[open]'), 1000, 'GPA dialog');
    ok(/GPA scale/.test(dlg.textContent), 'GPA dialog title');
  });

  await check('popup summary is written for the toolbar', async () => {
    let s = null;
    for (let i = 0; i < 60 && !s; i++) { s = (await browser.storage.local.get('popup.summary'))['popup.summary']; if (!s) await sleep(50); }
    ok(s && Array.isArray(s.items) && s.items.length > 0, 'items');
    ok(s.items.every((i) => /^https:\/\/umd\.instructure\.com\//.test(i.url)), 'absolute URLs');
  });

  await check('submit here is off by default (experimental setting)', async () => {
    await Gesso.settings.update({ experimentalSubmit: false });
    await go('/courses/103/assignments/21');
    const prim = await waitFor(() => { const b = $('[data-fkey="detail-primary"]'); return b && $('.adetail__actions') && b; }, 4000, 'primary action');
    await sleep(300); // full details loaded
    ok($('[data-fkey="detail-primary"]').tagName === 'A' && /Submit in Canvas/.test($('[data-fkey="detail-primary"]').textContent), `got ${prim.outerHTML.slice(0, 80)}`);
    await go('/settings');
    const cb = await waitFor(() => $('[data-fkey="set-exp-submit"]'), 2000, 'experimental toggle');
    ok(!cb.checked, 'toggle off by default');
    cb.click();
    await waitFor(() => Gesso.store.get().settings.experimentalSubmit === true, 1000, 'enabled');
  });

  await check('submit here: text submission is confirmed before "Submitted"', async () => {
    delete window.__mockSubs?.['103:21'];
    await go('/courses/103/assignments/21');
    const btn = await waitFor(() => { const b = $('[data-fkey="detail-primary"]'); return b && b.tagName === 'BUTTON' && b; }, 4000, 'Submit button (full details loaded)');
    btn.click();
    const dlg = await waitFor(() => $('dialog[open] form'), 1000, 'dialog');
    ok(/attempt 1/.test(dlg.textContent), 'says which attempt');
    const submit = dlg.querySelector('button[type="submit"]');
    submit.click();
    await waitFor(() => /Write something/.test(dlg.textContent), 1000, 'empty text rejected');
    const ta = dlg.querySelector('#sub-text');
    ta.value = 'UI check text';
    submit.click();
    await waitFor(() => /Canvas recorded it/.test($('dialog[open]')?.textContent || ''), 6000, 'confirmed');
    ok(window.__mockSubs['103:21']?.attempt === 1, 'mock recorded');
  });

  await check('submit here: URL validation, and a dropped submission says to check Canvas', async () => {
    await go('/courses/103/assignments/21');
    const btn = await waitFor(() => { const b = $('[data-fkey="detail-primary"]'); return b && b.tagName === 'BUTTON' && /Resubmit/.test(b.textContent) && b; }, 4000, 'Resubmit button');
    btn.click();
    const dlg = await waitFor(() => $('dialog[open] form'), 1000, 'dialog');
    dlg.querySelector('input[value="online_url"]').click();
    const url = dlg.querySelector('#sub-url');
    url.value = 'not a url';
    dlg.querySelector('button[type="submit"]').click();
    await waitFor(() => /full website address/.test(dlg.textContent), 1000, 'bad URL rejected');
    url.value = 'example.com/doc';
    window.__mockSubmitBroken = true;
    dlg.querySelector('button[type="submit"]').click();
    await waitFor(() => /Check in Canvas/.test(dlg.textContent), 8000, 'posted-but-unconfirmed message');
    window.__mockSubmitBroken = false;
    ok(dlg.querySelector('button[type="submit"]').disabled, 'no blind resubmit from the same dialog');
    await Gesso.settings.update({ experimentalSubmit: false });
  });

  await check('submit files: wrong type refused before upload; two files upload and are confirmed', async () => {
    await Gesso.settings.update({ experimentalSubmit: true });
    await go('/courses/101/assignments/1');
    const btn = await waitFor(() => { const b = $('[data-fkey="detail-primary"]'); return b && b.tagName === 'BUTTON' && b; }, 4000, 'Submit button');
    btn.click();
    const dlg = await waitFor(() => $('dialog[open] form'), 1000, 'dialog');
    const picker = dlg.querySelector('#sub-files');
    ok(picker && picker.getAttribute('accept') === '.zip,.java', `accept=${picker?.getAttribute('accept')}`);
    const add = (files) => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); picker.files = dt.files; picker.dispatchEvent(new Event('change')); };
    add([new File(['x'], 'notes.txt')]);
    await waitFor(() => /Not an allowed type/.test(dlg.textContent), 1000, 'type flagged');
    dlg.querySelector('button[aria-label="Remove notes.txt"]').click();
    add([new File(['class Main {}'], 'Main.java'), new File(['PK'], 'project.zip')]);
    const before = window.__mockWrites.length;
    dlg.querySelector('button[type="submit"]').click();
    await waitFor(() => /Canvas recorded it/.test($('dialog[open]')?.textContent || ''), 15000, 'confirmed');
    ok(/Main\.java, project\.zip/.test($('dialog[open]').textContent), 'lists the files');
    ok(window.__mockWrites.slice(before).some((w) => w.body?.submission?.submission_type === 'online_upload'), 'submitted as online_upload');
    await Gesso.settings.update({ experimentalSubmit: false });
  });

  await check('#/debug shows no tokens or verifiers', async () => {
    await go('/debug');
    const run = await waitFor(() => $('[data-fkey="up-run"]'), 2000, 'upload test button');
    run.click();
    await waitFor(() => /Passed: the upload/.test(shadow.textContent), 20000, 'upload test passed');
    const text = $('main').textContent;
    ok(!/token=eyJ|verifier=v\d|x-amz-signature":\s*"sig/.test(text) && !/eyJ[A-Za-z0-9_-]{8,}\./.test(text), 'secrets visible');
  });

  const failed = results.filter((r) => !r.ok);
  window.__uiChecks = { passed: results.length - failed.length, failed: failed.length, failures: failed };
  for (const r of results) console[r.ok ? 'log' : 'error'](`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
})();
