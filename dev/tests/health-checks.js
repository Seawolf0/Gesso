// Never-blank checks: simulate each way Gesso could
// disappear, and check it comes back VISIBLE (computed styles, size, styles
// applied, view content, and a hit test at the window's center), or reloads
// once / shows a card, logging the cause. "Verified visible" must only be
// logged when the result really is visible.
// Loaded by dev/preview/index.html?health=1; results in window.__healthChecks.
(async () => {
  const results = [];
  const host = document.getElementById('host');
  const shadow = host.shadowRoot;
  const $ = (sel) => shadow.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tick = () => new Promise((r) => queueMicrotask(r));
  async function waitFor(fn, ms = 3000, what = 'condition') {
    const end = Date.now() + ms;
    for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(20); }
  }
  const ok = (v, msg) => { if (!v) throw new Error(msg || 'expected truthy'); };
  const eq = (a, b, msg = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
  const events = () => Gesso.health.events();
  const lastEvent = () => events().slice(-1)[0] || {};
  // The log keeps 20 entries; each check starts with it cleared, so "since" = everything.
  const since = () => events();
  const visible = (on) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (on ? 'visible' : 'hidden') });

  // Every automatic reload goes through Gesso.health.reload: count instead of reloading.
  let reloads = [];
  let rootAtReload = [];
  Gesso.health.reload = (why) => { reloads.push(why); rootAtReload.push(host.isConnected); };

  /** Gesso is really on screen: no hiding styles, nonzero size, styled, content, center hit. */
  const visibleContent = () => Gesso.health.visibilityProblems(host).length === 0 && ($('main')?.innerText || '').trim().length > 20;
  const problems = () => Gesso.health.visibilityProblems(host).join('; ');

  const check = async (name, fn) => {
    reloads = [];
    Gesso.health.clearEvents();
    try { await fn(); results.push({ name, ok: true }); }
    catch (err) { results.push({ name, ok: false, error: String(err && err.message || err) }); }
    Gesso.health.hideCard(); Gesso.health._reset();
    if (!host.isConnected && !Gesso.health.isRetired()) document.body.append(host);
    await sleep(30);
  };
  /** Replace <body> the way a page script would: a new element, with `children`. */
  const replaceBody = (...children) => {
    const nb = document.createElement('body');
    nb.append(...children);
    document.documentElement.replaceChild(nb, document.body);
    return nb;
  };
  const foreignDiv = (id, text = 'Canvas content') => { const d = document.createElement('div'); d.id = id; d.textContent = text; return d; };

  await waitFor(() => window.__ready && window.__ready(), 8000, 'app ready');
  // Exactly like the live page: our root registered as ours, and the injected-element hider running.
  Gesso.own.add(host);
  Gesso.takeover.hideForeignElements(host);
  Gesso.health.clearEvents();
  ok(visibleContent(), `starts visible (${problems()})`);

  await check('root removed from <body> → put back, app state kept, verified visible', async () => {
    location.hash = '/assignments';
    const search = await waitFor(() => $('input[type="search"]'), 3000, 'assignments view');
    search.value = 'kept';
        host.remove();
    await waitFor(() => since().some((e) => e.action === 'verified visible'), 2000, 'verified');
    ok($('input[type="search"]') === search && search.value === 'kept', 'same DOM, same state');
    ok(visibleContent(), `visible: ${problems()}`);
    ok(/root was removed from <body>/.test(since()[0].cause), JSON.stringify(since()));
    eq(reloads.length, 0, 'no reload');
  });

  await check('<body> replaced (as logged live, no second copy) → remounted and VISIBLE, foreign content hidden', async () => {
        const nb = replaceBody(foreignDiv('umd-session-timeout'));
    await waitFor(() => since().some((e) => e.action === 'verified visible'), 2000, 'verified');
    ok(host.parentElement === nb, 'in the new body');
    ok(getComputedStyle(nb.querySelector('#umd-session-timeout')).display === 'none', 'foreign hidden');
    ok(visibleContent(), `visible: ${problems()}`);
    ok(/<body> was replaced/.test(since()[0].cause), since()[0].cause);
  });

  await check('LIVE SEQUENCE (console 2026-11-21): <body> replaced → remount → hider runs on the new <body> → root still visible with content', async () => {
    const hidLogs = [];
    const info = console.info;
    console.info = (...a) => { if (String(a[1] || '').startsWith('Hid an element')) hidLogs.push(a[1]); info(...a); };
    try {
      const injected = foreignDiv('umd-help-widget', 'Help');
      const nb = replaceBody(injected);
      await waitFor(() => events().some((e) => e.action === 'verified visible'), 2000, 'verified');
      ok(host.parentElement === nb, 'root in the new body');
      ok(!hidLogs.some((l) => /gesso-root|id="host"/.test(l)), `hider left our root alone (${hidLogs.join(' | ')})`);
      ok(host.style.getPropertyValue('display') !== 'none' && getComputedStyle(host).display !== 'none', 'root not hidden');
      ok(visibleContent(), `visible with content: ${problems()}`);
      // The hider still does its job on genuine injections, including one that forges our id AND token attribute.
      ok(getComputedStyle(injected).display === 'none', 'injected widget hidden');
      const forged = document.createElement('div');
      forged.id = host.id;
      forged.setAttribute(Gesso.own.attr, Gesso.own.token);
      forged.textContent = 'forged';
      document.body.append(forged);
      await waitFor(() => getComputedStyle(forged).display === 'none', 1000, 'forged copy hidden');
      ok(!Gesso.own.has(forged), 'forged node is not ours');
      forged.remove();
    } finally { console.info = info; }
  });

  await check('<body> replaced twice in a row → both remounts verified visible', async () => {
        replaceBody(foreignDiv('first'));
    await tick(); await tick();
    replaceBody(foreignDiv('second'));
    await waitFor(() => since().filter((e) => e.action === 'verified visible').length >= 1 && host.parentElement === document.body, 2000, 'remounted');
    await sleep(150);
    ok(visibleContent(), `visible: ${problems()}`);
    eq(reloads.length, 0, 'no reload');
  });

  await check('the whole document cleared → skeleton rebuilt, verified visible', async () => {
        document.documentElement.remove();
    await waitFor(() => since().some((e) => e.action === 'verified visible'), 2000, 'verified');
    ok(/whole document was cleared/.test(since()[0].cause), since()[0].cause);
    ok(visibleContent(), `visible: ${problems()}`);
  });

  await check('remount while a page rule hides the root → verification fails by name, one reload, no false success', async () => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`#${host.id} { display: none !important; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        try {
      replaceBody(foreignDiv('x'));
      await waitFor(() => reloads.length === 1, 2000, 'reload');
      const evs = since();
      ok(evs.some((e) => /verification failed/.test(e.cause) && /the root is display:none/.test(e.cause) && /reloading/.test(e.action)), JSON.stringify(evs));
      ok(!evs.some((e) => e.action === 'verified visible'), 'never logged success');
    } finally { document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet); }
  });

  await check('remount after the shadow root lost its styles → verification fails, one reload; again within 2 min → card', async () => {
    const sheets = [...shadow.adoptedStyleSheets]; // a copy: the property is a live array
    shadow.adoptedStyleSheets = [];
        try {
      replaceBody(foreignDiv('y'));
      await waitFor(() => reloads.length === 1, 2000, 'first reload');
      ok(since().some((e) => /no styles|styles aren’t applied/.test(e.cause)), JSON.stringify(since()));
      // Same failure again (the cooldown stands for the reload that "happened"):
      replaceBody(foreignDiv('z'));
      await waitFor(() => $('[data-health-card="render"]'), 2000, 'card');
      eq(reloads.length, 1, 'no second reload');
      ok(!since().some((e) => e.action === 'verified visible'), 'never logged success');
    } finally { shadow.adoptedStyleSheets = sheets; }
  });

  await check('<body> replaced right after an extension restart → no remount, page reloads', async () => {
    const id = browser.runtime.id;
    delete browser.runtime.id;
        try {
      replaceBody(foreignDiv('after-restart'));
      await waitFor(() => reloads.length === 1, 2000, 'reload');
      eq(rootAtReload.slice(-1), [false], 'root NOT put back with a dead context (state when it reloaded)');
      ok(since().some((e) => /extension context is gone/.test(e.cause) && /not remounting; reloading/.test(e.action)), JSON.stringify(since()));
      // A second replacement within seconds (the reload didn't happen in the test): the card, visibly.
      replaceBody(foreignDiv('again'));
      const card = await waitFor(() => host.isConnected && $('[data-health-card="extension"]'), 2000, 'extension card in an attached root');
      ok(/updated or restarted/.test(card.textContent), 'card text');
      eq(reloads.length, 1, 'still one reload');
    } finally { browser.runtime.id = id; }
    Gesso.health.hideCard();
    Gesso.health._reset();
    if (host.parentElement !== document.body) document.body.append(host);
  });

  await check('removal loop → stops after 5 remounts in a minute (reload once)', async () => {
    // Remove the root each time it comes back, until the watchdog gives up (6th time).
    for (let i = 0; i < 8 && !reloads.length; i++) {
      await waitFor(() => host.isConnected || reloads.length, 1500, `remount ${i}`);
      if (!reloads.length) host.remove();
      await tick(); await tick();
    }
    try { await waitFor(() => reloads.length === 1, 2000, 'reload after the loop'); }
    catch (e) { throw new Error(`${e.message}: reloads=${JSON.stringify(reloads)} events=${JSON.stringify(events().map((x) => `${x.cause} → ${x.action}`))}`); }
    ok(events().some((e) => /remounts in a minute/.test(e.cause)), 'logged');
  });

  await check('back/forward cache restore (pageshow persisted) with stale data → resync', async () => {
    const orig = Gesso.sync.refresh;
    let called = 0;
    Gesso.sync.refresh = () => { called++; return Promise.resolve(); };
    Gesso.store.set({ meta: { ...Gesso.store.get().meta, syncedAt: { all: Date.now() - 60 * 60e3 } } });
    try {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      await sleep(20);
      eq(called, 1, 'refresh calls');
    } finally { Gesso.sync.refresh = orig; Gesso.store.set({ meta: { ...Gesso.store.get().meta, syncedAt: { all: Date.now() } } }); }
  });

  await check('return to the tab with an empty view → re-rendered and visible, no reload', async () => {
    location.hash = '/assignments';
    await waitFor(() => $('input[type="search"]'), 3000, 'assignments');
    $('main').replaceChildren();
    visible(true);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await sleep(30);
      ok(visibleContent(), `visible: ${problems()}`);
      eq(reloads.length, 0, 'no reload');
    } finally { visible(false); }
  });

  await check('extension context gone on return → "updated or restarted" card; cleared when it responds again', async () => {
    const id = browser.runtime.id;
    delete browser.runtime.id;
    visible(true);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      const card = await waitFor(() => $('[data-health-card="extension"]'), 1000, 'card');
      ok(/updated or restarted/.test(card.textContent) && card.querySelector('[data-health-reload]'), 'card with Reload');
      ok(shadow.activeElement?.hasAttribute('data-health-reload'), 'focus on Reload');
    } finally {
      browser.runtime.id = id;
      document.dispatchEvent(new Event('visibilitychange'));
      visible(false);
    }
    await sleep(20);
    ok(!$('[data-health-card]'), 'card gone');
  });

  await check('"Extension context invalidated" from a storage call → the same card', async () => {
    const set = browser.storage.local.set;
    browser.storage.local.set = async () => { throw new Error('Extension context invalidated.'); };
    try {
      await Gesso.cache.save({ feed: [] }, Gesso.store.get().meta);
      await waitFor(() => $('[data-health-card="extension"]'), 1000, 'card');
    } finally { browser.storage.local.set = set; }
  });

  await check('a view that throws → error card with the reason, Reload, Open Classic Canvas', async () => {
    const orig = Gesso.views.grades.render;
    Gesso.views.grades.render = () => { throw new Error('boom in grades'); };
    try {
      location.hash = '/grades';
      const card = await waitFor(() => $('.render-error'), 2000, 'error card');
      ok(/boom in grades/.test(card.textContent) && card.querySelector('a[href$="/?gesso=classic"]'), card.textContent);
    } finally { Gesso.views.grades.render = orig; }
    location.hash = '/';
    await waitFor(() => !$('.render-error') && visibleContent(), 2000, 'recovered and visible');
  });

  await check('session expired while idle → logged-out banner, visible', async () => {
    window.__mockFail = 'auth';
    Gesso.store.set({ meta: { ...Gesso.store.get().meta, syncedAt: { all: Date.now() - 60 * 60e3 } } });
    visible(true);
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await waitFor(() => Gesso.store.get().sync.error?.kind === 'auth', 3000, 'auth error');
      await sleep(50);
      ok(/logged out/i.test($('main').textContent) && visibleContent(), `visible: ${problems()}`);
    } finally { window.__mockFail = undefined; visible(false); }
  });

  await check('app frame gone for good → one reload, then a card', async () => {
    const frame = $('.app');
    frame.remove();
    try {
      Gesso.health.onReturn('test: frame removed');
      eq(reloads.length, 1, 'reloads');
      Gesso.health.onReturn('test: frame removed again');
      eq(reloads.length, 1, 'no second reload');
      ok($('[data-health-card="render"]'), 'card instead');
    } finally { shadow.prepend(frame); }
  });

  await check('recovery log is persistent and shown in #/debug', async () => {
    host.remove();
    await waitFor(() => events().some((e) => e.action === 'verified visible'), 2000, 'an event');
    ok(JSON.parse(localStorage.getItem('gesso.health')).every((e) => e.at && e.cause && e.action), 'stored in localStorage');
    location.hash = '/debug';
    await waitFor(() => /Recovery log/.test($('main').textContent) && /verified visible/.test($('main').textContent), 2000, 'debug panel');
    location.hash = '/';
    await sleep(100);
  });

  // ---- The live bug: a NEWER copy of Gesso mounted (⌘B rebuild) -------
  // Last, because standing down is permanent for this copy's app.

  /** A second root, as a newer content script would build it. `working` = it rendered. */
  const newerRoot = (working) => {
    const d = document.createElement('div');
    d.id = host.id;
    d.setAttribute(Gesso.own.attr, 'newercopy'); // a newer copy has its own token
    const sh = d.attachShadow({ mode: 'open' });
    if (working) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.app { display: grid; min-height: 100vh; } main { padding: 40px; font: 16px system-ui; }');
      sh.adoptedStyleSheets = [sheet];
      sh.innerHTML = '<div class="app"><main><h1>Newer copy</h1><p>The rebuilt extension rendered this.</p></main></div>';
    }
    return d;
  };

  await check('LIVE BUG: <body> replaced by a newer copy (log showed a second #root) → this copy stands down; newer copy verified visible', async () => {
        const fresh = newerRoot(true);
    replaceBody(fresh);
    await waitFor(() => Gesso.health.isRetired(), 1000, 'stood down');
    ok(!host.isConnected, 'old root not re-added next to the new one');
    eq(document.querySelectorAll(`#${host.id}`).length, 1, 'exactly one root in the page');
    ok(since().some((e) => /newer copy of Gesso took over/.test(e.cause) && e.action === 'this copy stood down'), JSON.stringify(since()));
    await waitFor(() => since().some((e) => /newer copy is showing/.test(e.cause) && e.action === 'verified visible'), 7000, 'newer copy verified');
    eq(reloads.length, 0, 'no reload');
    // This copy is quiet: no sync, no rendering.
    await Gesso.sync.refresh({ force: true });
    ok(!Gesso.store.get().sync.running, 'sync disabled');
  });

  await check('LIVE BUG variant: the newer copy rendered nothing → reload once (never a silent blank page)', async () => {
    // Bring this copy's watchdog back for the scenario (its app stays stood down).
    document.querySelectorAll(`#${host.id}`).forEach((d) => d.remove());
    document.body.append(host);
    Gesso.health._reset({ unretire: true });
        replaceBody(newerRoot(false));
    await waitFor(() => Gesso.health.isRetired(), 1000, 'stood down');
    await waitFor(() => reloads.length === 1, 7000, 'reload after the grace period');
    ok(since().some((e) => /newer copy isn’t showing anything/.test(e.cause) && /app frame is missing|no styles|0×0/.test(e.cause) && /reloading/.test(e.action)), JSON.stringify(since()));
  });

  const failed = results.filter((r) => !r.ok);
  window.__healthChecks = { passed: results.length - failed.length, failed: failed.length, failures: failed };
  for (const r of results) console[r.ok ? 'log' : 'error'](`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
})();
