// @ts-check
/**
 * App bootstrap inside the shadow root: styles, appearance, shell, routing,
 * rendering on state change, and the sync lifecycle.
 */
(() => {
  const { h, replace } = Gesso.dom;
  const { store } = Gesso;

  /** Install all style sheets into the shadow root. */
  function installStyles(/** @type {ShadowRoot} */ root) {
    const text = Gesso.styles.sheets.join('\n');
    // Constructable stylesheets aren't subject to the page's CSP for inline styles.
    if ('adoptedStyleSheets' in root && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      root.adoptedStyleSheets = [sheet];
    } else {
      /** @type {ShadowRoot} */ (root).append(h('style', null, text));
    }
  }

  /** Theme, mode, density, accent → host attributes + custom properties (ui/appearance.js). */
  function applyAppearance(/** @type {HTMLElement} */ host, /** @type {any} */ settings, /** @type {{ animate?: boolean }} */ opts = {}) {
    Gesso.appearance.apply(host, settings, opts);
  }

  /**
   * Where the time to first paint goes. Everything before "script start" is
   * spent before Safari can run any extension code: redirects, connection
   * setup, and Canvas generating the dashboard HTML (time to first byte).
   */
  function logTiming(/** @type {number} */ bootAt, /** @type {boolean} */ hadCache) {
    const now = performance.now();
    const r = (/** @type {number} */ n) => Math.round(n);
    Gesso.log.info(`First paint ${hadCache ? 'from cache' : '(no cache yet)'} in ${r(now - bootAt)} ms after script start; ${r(now)} ms after navigation start.`);

    // Phase timestamps relative to navigation start. Safari may record no
    // PerformanceNavigationTiming entry for a load we stop with window.stop(),
    // so fall back to the legacy performance.timing (epoch ms).
    /** @type {{ redirectCount: number, redirectStart: number, redirectEnd: number, fetchStart: number, domainLookupStart: number, connectEnd: number, requestStart: number, responseStart: number }|null} */
    let t = null;
    let source = '';
    const nav = /** @type {PerformanceNavigationTiming|undefined} */ (performance.getEntriesByType('navigation')[0]);
    if (nav && nav.responseStart > 0) {
      t = nav;
      source = 'PerformanceNavigationTiming';
    } else if (performance.timing && performance.timing.responseStart > 0) {
      const T = performance.timing;
      const rel = (/** @type {number} */ v) => (v ? v - T.navigationStart : 0);
      t = {
        redirectCount: performance.navigation?.redirectCount ?? 0,
        redirectStart: rel(T.redirectStart), redirectEnd: rel(T.redirectEnd), fetchStart: rel(T.fetchStart),
        domainLookupStart: rel(T.domainLookupStart), connectEnd: rel(T.connectEnd),
        requestStart: rel(T.requestStart), responseStart: rel(T.responseStart),
      };
      source = 'performance.timing (fallback)';
    }
    if (!t) {
      Gesso.log.info('Load timing (ms): unavailable — Safari recorded no navigation timing for this load.');
      return;
    }
    const breakdown = {
      source,
      'redirects (count)': t.redirectCount,
      'redirect time': r(t.redirectEnd - t.redirectStart),
      'navigation start → fetch start (unload previous page, redirects)': r(t.fetchStart),
      'before request (DNS, TCP/TLS)': r(t.requestStart - t.fetchStart),
      'DNS + connect (part of above)': r(t.connectEnd - t.domainLookupStart),
      'Canvas server: request → first byte': r(t.responseStart - t.requestStart),
      // Safari: from the page's first byte until it runs our first script file.
      'first byte → first extension file (Safari injecting scripts)': r((Gesso.bootStart ?? bootAt) - t.responseStart),
      // Ours: evaluating all our script files before main.js runs.
      'evaluating extension files (ours)': r(bootAt - (Gesso.bootStart ?? bootAt)),
      'script start → first paint': r(now - bootAt),
      total: r(now),
    };
    Gesso.log.info(`Load timing (ms): ${JSON.stringify(breakdown)}`);
    Gesso.diagnostics = { ...(Gesso.diagnostics || {}), loadTiming: breakdown };
  }

  /** Last-resort error screen if the app itself fails to start. */
  function renderFatal(/** @type {ShadowRoot} */ root, /** @type {any} */ err) {
    Gesso.log.error('Gesso failed to start', err);
    try { installStyles(root); } catch { /* ignore */ }
    root.replaceChildren(h('div', { class: 'fatal' },
      h('h1', null, 'Gesso hit a problem'),
      h('p', { class: 'muted' }, 'The dashboard could not start. Classic Canvas still works.'),
      h('pre', null, String(err?.stack || err)),
      h('div', { class: 'render-error__actions' },
        h('button', { class: 'btn btn--primary', type: 'button', onClick: () => location.reload() }, 'Reload'),
        h('a', { class: 'btn', href: `${Gesso.config.canvasOrigin}/?gesso=classic` }, 'Open Classic Canvas')),
    ));
  }

  /**
   * Start the app.
   * @param {{ host: HTMLElement, shadow: ShadowRoot }} mount
   * @param {{ bootAt: number }} timing
   */
  async function start({ host, shadow }, { bootAt }) {
    installStyles(shadow);

    const [settings] = await Promise.all([Gesso.settings.load(), Gesso.prefs.load()]);
    if (settings.mode === 'classic') {
      // The sync mirror was stale; honor the real setting.
      Gesso.takeover.switchToClassic();
      return;
    }
    Gesso.settings.writeModeMirror('gesso');
    store.set({ settings });
    applyAppearance(host, settings, { animate: false });

    const actions = {
      onRefresh: () => Gesso.sync.refresh({ force: true }),
      onMarkSeen: () => Gesso.sync.markFeedSeen(),
      onTheme: (/** @type {'dark'|'light'} */ theme) => Gesso.settings.update({ theme }),
      onClassic: async () => {
        await Gesso.settings.update({ mode: 'classic' });
        Gesso.takeover.switchToClassic();
      },
    };

    // Default view (Settings): only when Canvas was opened without a hash,
    // e.g. the toolbar popup's "Open" or a bookmark of the bare dashboard URL.
    // An explicit "#/" (the Dashboard link) is respected.
    if (!location.hash && settings.defaultView && settings.defaultView !== 'dashboard') {
      history.replaceState(null, '', `#/${settings.defaultView}`);
    }

    const shell = Gesso.shell.create(shadow, actions);
    Gesso.appearance.decorate(); // the sidebar exists now: add the theme's motif
    Gesso.shortcuts.install(shadow);
    Gesso.palette.setActions({
      'toggle-theme': () => Gesso.settings.update({ theme: store.get().settings.theme === 'light' ? 'dark' : 'light' }),
      refresh: actions.onRefresh,
      'add-todo': () => Gesso.plannerUi.openTodo(),
      shortcuts: () => Gesso.shortcuts.showHelp(),
      classic: actions.onClassic,
    });
    Gesso.summary?.start(); // toolbar popup + badge data
    let route = Gesso.router.parse();
    let lastRouteName = '';

    /**
     * Two kinds of views:
     *  - stateless: `render(state, actions)` → node, rebuilt on every change
     *  - stateful:  `create({ route })` → { el, update(state, route) }, built
     *    once per `instanceKey` and updated in place (keeps inputs, scroll,
     *    and tab-local state across data refreshes)
     */
    /** @type {{ key: string, instance: any }|null} */
    let current = null;
    const STATEFUL = /** @type {Record<string, { view: () => any, key: (r: any) => string }>} */ ({
      assignments: { view: () => Gesso.views.assignments, key: () => 'assignments' },
      course: { view: () => Gesso.views.course, key: (r) => `course:${r.params.id}` },
      calendar: { view: () => Gesso.views.calendar, key: () => 'calendar' },
    });
    const viewActions = { ...actions, rerender: () => render() };

    /** `#/open?path=…` (from the native-page launcher) → the matching view. */
    function resolveDeepLink() {
      if (route.name !== 'open') return;
      const state = store.get();
      const target = Gesso.deeplink.resolve(route.query.get('path') || '/', {
        hint: route.query.get('hint'),
        data: state.data,
        folders: (courseId) => Gesso.resources.entry(`folders:${courseId}`)?.data || null,
      });
      history.replaceState(null, '', `#${target}`); // the /open URL never stays in history
      route = Gesso.router.parse();
    }

    /** Set when a newer copy of the content script took over the page: this copy goes quiet. */
    let retired = false;

    /** Render, timed: the last 50 render durations go to Gesso.diagnostics.renders (#/debug). */
    function render() {
      if (retired) return;
      const t0 = performance.now();
      try {
        renderNow();
      } catch (err) {
        // Never leave a blank view: show what failed, with a way out.
        renderError(err);
      }
      const ms = performance.now() - t0;
      const d = (Gesso.diagnostics ||= {});
      (d.renders ||= []).push({ route: route.name, ms: Math.round(ms * 10) / 10, at: Date.now() });
      if (d.renders.length > 50) d.renders.shift();
      if (ms > 100) Gesso.log.warn(`Slow render: ${route.name} took ${Math.round(ms)} ms`);
    }

    /** An error card in place of the view; the sidebar and top bar stay usable. */
    function renderError(/** @type {any} */ err) {
      Gesso.log.error(`Render failed on ${route.name} (${route.path})`, err);
      if (Gesso.health?.noteError(err, `render ${route.name}`)) return; // a dead extension context gets its own card
      current = null;
      try {
        replace(shell.outlet, h('div', { class: 'panel render-error', role: 'alert' },
          Gesso.ui.emptyState({
            icon: 'alert', title: 'This view couldn’t be shown',
            body: `${err?.message || err}. Other views may still work.`,
            action: h('div', { class: 'render-error__actions' },
              h('button', { class: 'btn btn--primary', type: 'button', onClick: () => Gesso.health.reload('render error card') }, 'Reload'),
              h('a', { class: 'btn', href: `${Gesso.config.canvasOrigin}/?gesso=classic` }, 'Open Classic Canvas'),
              route.name !== 'dashboard' && h('a', { class: 'btn btn--ghost', href: '#/' }, 'Go to the dashboard')),
          })));
      } catch (err2) {
        // Even the card failed (shell gone?): the overlay card uses inline styles only.
        Gesso.health?.showCard({ kind: 'render', title: 'Gesso couldn’t draw this page', body: 'Reload to start it again, or use classic Canvas.', detail: String(err?.message || err) });
      }
    }

    function renderNow() {
      if (route.name === 'open') {
        const s = store.get();
        if (!s.hydrated) return; // resolve with cached data, not before it's loaded
        // Quiz/discussion URLs map to assignments via synced coursework, and
        // submission URLs need to know who "me" is (mine vs a peer review);
        // with no cache yet, wait for the first sync (or its failure).
        const needsCoursework = /\/(quizzes|discussion_topics)\/|\/(anonymous_)?submissions\/|reviewee_id=/.test(route.query.get('path') || '');
        if (needsCoursework && s.data.coursework == null && !s.sync.error) return;
        resolveDeepLink();
      }
      // Views see the theme's course colors (Canvas's own stay in canvasColor).
      const state = Gesso.appearance.view(store.get());
      const navigated = lastRouteName !== route.path;
      // Scroll to top *before* rendering, so a view that scrolls to a
      // deep-linked item (announcement, assignment) isn't overridden.
      if (navigated && lastRouteName) {
        window.scrollTo(0, 0);
        Gesso.nav.previous = lastRouteName; // lets detail views offer "Back" only after in-app navigation
      }
      shell.update(state, route);
      const stateful = STATEFUL[route.name];
      if (stateful) {
        const key = stateful.key(route);
        if (current?.key !== key) {
          current = { key, instance: stateful.view().create({ route }) };
          replace(shell.outlet, current.instance.el);
        }
        current.instance.update(state, route);
      } else {
        current = null;
        let view;
        switch (route.name) {
          case 'dashboard': view = Gesso.views.dashboard.render(state, viewActions); break;
          case 'courses': view = Gesso.views.courses.render(state, viewActions); break;
          case 'debug': view = Gesso.views.debug.render(state, viewActions); break;
          case 'grades': view = Gesso.views.grades.render(state); break;
          case 'settings': view = Gesso.views.settings.render(state); break;
          default: view = Gesso.views.placeholder.render(route.name);
        }
        replace(shell.outlet, view);
      }
      // On navigation (not data refreshes), move focus into the new view so
      // Tab / screen readers start there — unless the view already focused
      // something inside itself (e.g. a deep-linked announcement).
      if (navigated && lastRouteName) {
        const active = shadow.activeElement;
        if (!active || !shell.outlet.contains(active)) shell.outlet.focus({ preventScroll: true });
      }
      lastRouteName = route.path;
    }

    const unsubscribe = store.subscribe(render);
    Gesso.router.onChange((r) => { route = r; render(); });
    Gesso.settings.onChange((s) => {
      store.set({ settings: s });
      applyAppearance(host, s);
      if (s.mode === 'classic') Gesso.takeover.switchToClassic(); // changed in another tab
    });

    // First paint from cache, then revalidate.
    const hadCache = await Gesso.sync.hydrate();
    render();
    logTiming(bootAt, hadCache);

    if (!hadCache || Gesso.sync.isStale()) Gesso.sync.refresh();
    Gesso.sync.startAuto();

    // Keep "Synced 3m ago" honest.
    setInterval(() => shell.renderSyncStatus(store.get()), 30_000);

    // Never blank: keep the root in the page, check health on return,
    // resync stale data, detect a dead extension context.
    Gesso.health.install({
      host, shadow,
      isHealthy: () => !!shadow.querySelector('.app') && shell.outlet.isConnected && shell.outlet.childNodes.length > 0,
      rerender: () => { current = null; render(); }, // also rebuilds stateful views
      isStale: () => Gesso.sync.isStale(),
      onStale: () => Gesso.sync.refresh(),
      // A newer copy of the content script owns the page now: stop rendering, syncing and writing.
      onRetire: () => { retired = true; unsubscribe(); Gesso.sync.disable(); Gesso.summary?.stop?.(); },
    });
    // Startup counts too: verify the first paint is actually visible (only in a visible tab;
    // a background tab is checked when it's shown).
    if (document.visibilityState !== 'hidden') Gesso.health.verifyStartup();
  }

  /** Navigation memory shared with views (e.g. detail views' "Back"). */
  Gesso.nav = { previous: /** @type {string|null} */ (null) };

  Gesso.app = { start, renderFatal, applyAppearance };
})();
