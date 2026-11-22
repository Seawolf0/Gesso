// @ts-check
/**
 * ⌘K command palette. A native <dialog> (focus trap, Escape, inert
 * background) holding an ARIA combobox: the input owns a listbox, and the
 * active option is announced via aria-activedescendant while focus stays in
 * the input.
 *
 *   ↑/↓ (and Ctrl-P/N) move, Home/End jump, Enter opens, ⌘/Ctrl-Enter opens
 *   in a new tab, Escape closes. ⌘K toggles it (ui/shortcuts.js).
 *
 * Search itself is pure (data/search.js). This file gathers the extras
 * (loaded modules and files from storage), renders, and runs entries.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const { store } = Gesso;
  const storage = Gesso.browser.storage.local;

  /** @type {null | { el: HTMLDialogElement, close: () => void }} */
  let open = null;
  /** Actions the app provides (theme, refresh, classic…). */
  let actions = /** @type {Record<string, () => void>} */ ({});

  function setActions(/** @type {Record<string, () => void>} */ a) {
    actions = a;
  }

  /**
   * Modules and files Gesso has loaded before, from the store and from
   * storage (`res.*`). Courses whose modules were never loaded get them
   * fetched once in the background (cached like the Modules tab does).
   */
  async function gatherExtras() {
    /** @type {Record<string, any[]>} */
    const modules = {};
    /** @type {{ courseId: string, folderId: string, file: any }[]} */
    const files = [];
    let saved = {};
    try { saved = await storage.get(null); } catch { /* storage unavailable: store only */ }
    const P = Gesso.resources.PREFIX;
    /** @type {Record<string, any>} */
    const all = {};
    for (const [k, v] of Object.entries(saved)) if (k.startsWith(P)) all[k.slice(P.length)] = /** @type {any} */ (v)?.data;
    for (const [k, v] of Object.entries(store.get().resources || {})) if (/** @type {any} */ (v)?.data) all[k] = /** @type {any} */ (v).data;
    for (const [k, data] of Object.entries(all)) {
      if (!data) continue;
      if (k.startsWith('modules:')) modules[k.slice(8)] = data;
      else if (k.startsWith('files:') && Array.isArray(data)) {
        for (const f of data) {
          const m = String(f.previewUrl || '').match(/\/courses\/([^/]+)\/files\//);
          if (m) files.push({ courseId: m[1], folderId: k.slice(6), file: f });
        }
      }
    }
    return { modules, files };
  }

  /** Fetch modules for visible courses that have none cached (once; errors back off). */
  function warmModules(/** @type {Record<string, any[]>} */ have) {
    const s = store.get();
    for (const c of Gesso.derive.visibleCourses(s.data, s.settings.hiddenCourses)) {
      if (have[c.id]) continue;
      Gesso.resources.ensure(`modules:${c.id}`, () => Gesso.api.canvas.getModules(c.id).then((ms) => ms.map(Gesso.normalize.module)), { ttl: Infinity });
    }
  }

  function run(/** @type {any} */ entry, newTab = false) {
    close();
    // Let the dialog close (and return focus) before navigating or opening another dialog.
    setTimeout(() => {
      if (entry.action) {
        if (entry.action.startsWith('edit-todo:')) {
          const key = entry.action.slice(10);
          const item = Gesso.derive.workItems(store.get().data).find((i) => i.key === key);
          if (item) Gesso.plannerUi.openTodo(item);
          return;
        }
        actions[entry.action]?.();
        return;
      }
      const href = String(entry.href || '');
      if (!href) return;
      const url = href.startsWith('#') ? `${Gesso.config.canvasOrigin}/${href}` : href;
      if (newTab) window.open(url, '_blank', 'noopener');
      else if (href.startsWith('#')) location.hash = href.slice(1);
      else location.href = url;
    }, 0);
  }

  function close() {
    open?.close();
  }

  function toggle() {
    if (open) close(); else show();
  }

  const KIND_LABEL = /** @type {Record<string, string>} */ ({ action: 'Action', view: 'Go to', course: 'Course', tab: 'Course tab', item: 'Work', module: 'Module', page: 'Page', file: 'File', announcement: 'Announcement' });

  function show() {
    const root = Gesso.overlays.root();
    if (!root || open) return;
    const shadow = /** @type {ShadowRoot} */ (root.getRootNode());
    const opener = /** @type {HTMLElement|null} */ (shadow.activeElement);
    const openerKey = opener?.getAttribute('data-fkey');

    let index = Gesso.search.buildIndex(Gesso.appearance.view(store.get()));
    /** @type {any[]} */
    let results = [];
    let active = 0;

    const listId = 'palette-list';
    const input = /** @type {HTMLInputElement} */ (h('input', {
      class: 'palette__input', type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': listId,
      'aria-autocomplete': 'list', 'aria-label': 'Search courses, assignments, files, pages and actions',
      placeholder: 'Jump to a course, assignment, file, page… or type an action', autocomplete: 'off', spellcheck: 'false',
    }));
    const list = h('ul', { class: 'palette__list', id: listId, role: 'listbox', 'aria-label': 'Results' });
    const status = h('p', { class: 'palette__status', role: 'status', 'aria-live': 'polite' });
    const el = /** @type {HTMLDialogElement} */ (h('dialog', { class: 'palette', 'aria-label': 'Command palette' },
      h('div', { class: 'palette__search' }, icon('search', { size: 17 }), input, h('kbd', { class: 'kbd' }, 'esc')),
      list,
      h('footer', { class: 'palette__foot' },
        h('span', null, h('kbd', { class: 'kbd' }, '↑'), h('kbd', { class: 'kbd' }, '↓'), ' move'),
        h('span', null, h('kbd', { class: 'kbd' }, '↵'), ' open'),
        h('span', null, h('kbd', { class: 'kbd' }, '⌘↵'), ' new tab'),
        h('span', { class: 'palette__spacer' }),
        status)));

    function setActive(/** @type {number} */ i, scroll = true) {
      if (!results.length) { input.removeAttribute('aria-activedescendant'); return; }
      active = (i + results.length) % results.length;
      list.querySelectorAll('[role="option"]').forEach((o, j) => o.setAttribute('aria-selected', String(j === active)));
      input.setAttribute('aria-activedescendant', `pal-opt-${active}`);
      if (scroll) list.querySelector(`#pal-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
    }

    function render() {
      results = Gesso.search.search(index, input.value);
      list.replaceChildren(...results.map((e, i) => h('li', {
        class: 'palette__opt', role: 'option', id: `pal-opt-${i}`, 'aria-selected': 'false',
        onClick: (/** @type {MouseEvent} */ ev) => run(e, ev.metaKey || ev.ctrlKey),
        onMousemove: () => { if (active !== i) setActive(i, false); },
      },
        h('span', { class: 'palette__icon', style: e.color ? { '--c': e.color } : undefined, 'aria-hidden': 'true' }, icon(e.icon || 'sparkles', { size: 15 })),
        h('span', { class: 'palette__text' },
          h('span', { class: 'palette__title' }, e.title),
          e.sub && h('span', { class: 'palette__sub' }, e.sub)),
        h('span', { class: 'palette__kind' }, KIND_LABEL[e.kind] || ''))));
      if (!results.length) list.append(h('li', { class: 'palette__empty', role: 'presentation' }, `No matches for “${input.value.trim()}”.`));
      status.textContent = input.value.trim() ? `${results.length} result${results.length === 1 ? '' : 's'}` : '';
      setActive(0);
    }

    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      const ctrlNav = e.ctrlKey && !e.metaKey && (e.key === 'n' || e.key === 'p');
      if (e.key === 'ArrowDown' || (ctrlNav && e.key === 'n')) { e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp' || (ctrlNav && e.key === 'p')) { e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Home' && results.length && !input.value) { e.preventDefault(); setActive(0); }
      else if (e.key === 'End' && results.length && !input.value) { e.preventDefault(); setActive(results.length - 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (results[active]) run(results[active], e.metaKey || e.ctrlKey);
      }
    });
    el.addEventListener('click', (e) => { if (e.target === el) el.close(); });

    // Fresh data (a sync, warmed modules) → rebuild the index, keep the query.
    const unsubscribe = store.subscribe(() => {
      if (!open) return;
      index = Gesso.search.buildIndex(Gesso.appearance.view(store.get()), extras);
      const keep = active;
      render();
      setActive(Math.min(keep, results.length - 1), false);
    });
    /** @type {any} */
    let extras = {};
    gatherExtras().then((x) => {
      extras = x;
      if (!open) return;
      index = Gesso.search.buildIndex(Gesso.appearance.view(store.get()), extras);
      render();
      warmModules(x.modules);
    });

    el.addEventListener('close', () => {
      unsubscribe();
      el.remove();
      open = null;
      const target = opener?.isConnected ? opener : openerKey ? shadow.querySelector(`[data-fkey="${CSS.escape(openerKey)}"]`) : null;
      /** @type {any} */ (target)?.focus?.({ preventScroll: true });
    });

    root.append(el);
    open = { el, close: () => el.close() };
    el.showModal();
    render();
    input.focus();
  }

  Gesso.palette = { show, close, toggle, setActions, isOpen: () => !!open };
})();
