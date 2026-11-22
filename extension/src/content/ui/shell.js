// @ts-check
/**
 * The app frame: sidebar navigation, top bar, and the content outlet.
 * Built once; `update()` refreshes only the dynamic regions.
 */
(() => {
  const { h, replace } = Gesso.dom;
  const { icon } = Gesso.icons;
  const { href } = Gesso.router;

  const NAV = [
    { route: 'dashboard', path: '/', label: 'Dashboard', icon: 'home' },
    { route: 'assignments', path: '/assignments', label: 'Assignments', icon: 'tasks' },
    { route: 'courses', path: '/courses', label: 'Courses', icon: 'book' },
    { route: 'calendar', path: '/calendar', label: 'Calendar', icon: 'calendar' },
    { route: 'grades', path: '/grades', label: 'Grades', icon: 'chart' },
  ];

  const TITLES = /** @type {Record<string,string>} */ ({
    dashboard: 'Dashboard', assignments: 'Assignments', courses: 'Courses', course: 'Course',
    calendar: 'Calendar', grades: 'Grades', settings: 'Settings', debug: 'Diagnostics', not_found: 'Not found',
  });

  /**
   * @param {ShadowRoot} root
   * @param {{ onRefresh: () => void, onTheme: (t: 'dark'|'light') => void, onClassic: () => void }} actions
   */
  function create(root, actions) {
    const navMain = h('nav', { class: 'nav', 'aria-label': 'Main' });
    const navCourses = h('nav', { class: 'nav', 'aria-label': 'Courses' });
    const topTitle = h('h1', { class: 'topbar__title' });
    const syncStatus = h('div', { class: 'sync-status', role: 'status', 'aria-live': 'polite' });
    const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
    const searchBtn = h('button', {
      class: 'search-trigger', type: 'button', 'aria-label': 'Search and commands', 'aria-keyshortcuts': isMac ? 'Meta+K' : 'Control+K',
      title: `Jump to anything (${isMac ? '⌘K' : 'Ctrl+K'})`, onClick: () => Gesso.palette.show(), 'data-fkey': 'palette-open',
    }, icon('search', { size: 15 }), h('span', { class: 'search-trigger__text' }, 'Search'), h('kbd', { class: 'kbd' }, isMac ? '⌘K' : 'Ctrl K'));
    const refreshBtn = h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': 'Refresh from Canvas', title: 'Refresh from Canvas', onClick: actions.onRefresh });
    const themeDark = h('button', { type: 'button', 'aria-label': 'Dark theme', title: 'Dark theme', onClick: () => actions.onTheme('dark') }, icon('moon', { size: 15 }));
    const themeLight = h('button', { type: 'button', 'aria-label': 'Light theme', title: 'Light theme', onClick: () => actions.onTheme('light') }, icon('sun', { size: 15 }));
    const userChip = h('div', { class: 'user-chip' });
    const outlet = h('main', { class: 'content', id: 'main', tabindex: '-1' });
    const settingsLink = navLink({ path: '/settings', label: 'Settings', icon: 'settings', route: 'settings' }, '');

    // First stop for keyboard users: jump past the sidebar to the view. A real
    // link, because Safari's Option-Tab reaches links but reaches buttons only
    // with macOS Keyboard Navigation on (Apple, Safari keyboard shortcuts). The
    // click is handled here: hashes are routes, so "#main" must not navigate.
    const skip = h('a', { class: 'skip-link', href: '#main', onClick: (/** @type {Event} */ e) => { e.preventDefault(); outlet.focus(); } }, 'Skip to content');
    const frame = h('div', { class: 'app' },
      skip,
      h('aside', { class: 'sidebar' },
        h('div', { class: 'brand' },
          h('span', { class: 'brand__mark', 'aria-hidden': 'true' }, icon('grid', { size: 17 })),
          h('span', { class: 'brand__text' },
            h('div', { class: 'brand__name' }, 'Gesso'),
            h('div', { class: 'brand__sub' }, Gesso.config.canvasHost))),
        navMain,
        h('div', { class: 'nav__label' }, 'Courses'),
        navCourses,
        h('div', { class: 'nav__spacer' }),
        h('div', { class: 'nav' },
          settingsLink,
          h('button', { class: 'nav__item', type: 'button', onClick: actions.onClassic, title: 'Switch the dashboard back to classic Canvas' },
            icon('classic', { size: 18 }), h('span', { class: 'nav__text' }, 'Classic Canvas')),
        ),
      ),
      h('div', { class: 'main' },
        h('header', { class: 'topbar' },
          topTitle,
          h('div', { class: 'topbar__spacer' }),
          searchBtn,
          syncStatus,
          refreshBtn,
          h('div', { class: 'theme-toggle', role: 'group', 'aria-label': 'Theme' }, themeDark, themeLight),
          userChip,
        ),
        outlet,
      ),
    );
    root.append(frame);
    Gesso.overlays.attach(frame);

    /** Re-render the dynamic parts of the frame. */
    function update(/** @type {any} */ state, /** @type {any} */ route) {
      const current = route.name === 'course' ? 'courses' : route.name;
      replace(navMain, NAV.map((n) => navLink(n, current)));
      if (current === 'settings') settingsLink.setAttribute('aria-current', 'page'); else settingsLink.removeAttribute('aria-current');
      replace(navCourses, Gesso.derive.visibleCourses(state.data, state.settings.hiddenCourses).map((/** @type {any} */ c) =>
        h('a', {
          class: 'nav__item nav__course', href: href(`/courses/${c.id}`), title: Gesso.derive.courseTitle(c), 'data-fkey': `nav-course:${c.id}`,
          'aria-current': route.name === 'course' && route.params.id === c.id ? 'page' : undefined,
        },
          h('span', { class: 'dot', style: { '--c': c.color }, 'aria-hidden': 'true' }),
          h('span', { class: 'nav__text truncate' }, c.code || Gesso.derive.courseTitle(c)))));

      const course = route.name === 'course' ? (state.data.courses || []).find((/** @type {any} */ c) => c.id === route.params.id) : null;
      topTitle.textContent = course ? course.code || course.name : TITLES[route.name] || '';
      document.title = `${topTitle.textContent} · Gesso`;

      renderSyncStatus(state);
      themeDark.setAttribute('aria-pressed', String(state.settings.theme === 'dark'));
      themeLight.setAttribute('aria-pressed', String(state.settings.theme === 'light'));

      const user = state.data.user;
      replace(userChip, user && [Gesso.ui.avatar(user), h('span', { class: 'user-chip__name' }, user.name)]);
    }

    /** How long the outcome of a manual refresh stays visible. */
    const RESULT_MS = 5000;
    let resultTimer = 0;

    function renderSyncStatus(/** @type {any} */ state) {
      const { running, error, lastResult } = state.sync;
      const syncedAt = state.meta?.syncedAt?.all;
      refreshBtn.toggleAttribute('disabled', !!running);
      refreshBtn.setAttribute('aria-busy', String(!!running));
      replace(refreshBtn, icon('refresh', { size: 16, class: running ? 'spin' : '' }));
      syncStatus.classList.toggle('sync-status--error', !!error && !running);

      // After a manual refresh, say what happened (otherwise an unchanged
      // dashboard looks like the button did nothing).
      const resultAge = lastResult?.manual ? Date.now() - lastResult.at : Infinity;
      const showResult = !running && !error && lastResult?.ok && resultAge < RESULT_MS;
      clearTimeout(resultTimer);
      if (showResult) resultTimer = window.setTimeout(() => renderSyncStatus(Gesso.store.get()), RESULT_MS - resultAge + 50);

      let content;
      if (running) content = 'Syncing with Canvas…';
      else if (error) content = error.kind === 'auth' ? 'Logged out' : 'Sync failed';
      else if (showResult) {
        const n = lastResult.changes;
        content = [icon('check', { size: 14 }), n ? `Updated · ${n} new ${n === 1 ? 'change' : 'changes'}` : 'Up to date'];
      } else if (syncedAt) content = `Synced ${Gesso.time.relative(new Date(syncedAt))}`;
      else content = 'Not synced yet';
      replace(syncStatus, h('span', {
        class: ['sync-status__text', showResult && 'sync-status__result'],
        title: syncedAt ? `Last synced ${new Date(syncedAt).toLocaleString()}` : '',
      }, content));
    }

    return { outlet, update, renderSyncStatus };
  }

  function navLink(/** @type {{route:string,path:string,label:string,icon:string}} */ n, /** @type {string} */ current) {
    return h('a', {
      class: 'nav__item', href: href(n.path), 'data-fkey': `nav:${n.route}`,
      'aria-current': n.route === current ? 'page' : undefined, title: n.label,
    }, icon(n.icon, { size: 18 }), h('span', { class: 'nav__text' }, n.label));
  }

  Gesso.shell = { create };
})();
