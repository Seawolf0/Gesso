// @ts-check
/**
 * #/settings (including the Canvas-pages dark mode section).
 * Stateless: every control writes settings right away; the store
 * re-renders right away (Gesso.settings notifies this tab itself), and
 * other tabs and the popup pick changes up too (storage events, plus pings).
 *
 *   Appearance      theme gallery, mode, accent, course colors, density (ui/theme-editor.js)
 *   Custom theme    the custom theme editor, when the custom theme is selected
 *   Dashboard       default view, "due soon" window
 *   Grades          GPA scale (the Grades page's dialog)
 *   Courses         courses hidden from Gesso
 *   Canvas pages    Gesso button on/off, dark mode
 *   Keyboard        shortcut list
 *   Data            clear cached data, reset settings
 *   About           version, tagline, the trademark disclaimer
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;

  /** Shown in About and the README. Describing compatibility with Canvas is fine; the name isn't ours. */
  const DISCLAIMER = 'Gesso is an unofficial project and is not affiliated with or endorsed by Instructure. Canvas is a trademark of Instructure, Inc.';
  const version = (() => { try { return String(Gesso.browser.runtime.getManifest().version || ''); } catch { return ''; } })();

  const update = (/** @type {any} */ patch) => Gesso.settings.update(patch);

  function check(/** @type {string} */ fkey, /** @type {boolean} */ checked, /** @type {(on: boolean) => void} */ onChange, /** @type {boolean} */ disabled = false) {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', 'data-fkey': fkey, disabled }));
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }

  /** A row: label + hint on the left, control on the right. */
  const row = (/** @type {string} */ label, /** @type {string|null} */ hint, /** @type {any} */ control, /** @type {string} */ id = '') =>
    h('div', { class: 'set-line' },
      h('div', { class: 'set-line__text' },
        h(id ? 'label' : 'span', { class: 'set-line__label', for: id || undefined }, label),
        hint && h('span', { class: 'set-hint' }, hint)),
      h('div', { class: 'set-line__control' }, control));

  function nativeDarkPanel(/** @type {any} */ s) {
    const off = new Set(s.nativeDarkOff || []);
    const mode = s.nativeDark || 'match';
    const active = mode === 'on' || (mode === 'match' && s.theme !== 'light');
    const setType = (/** @type {string} */ type, /** @type {boolean} */ dark) => {
      const next = new Set(off);
      if (dark) next.delete(type); else next.add(type);
      update({ nativeDarkOff: [...next] });
    };
    return ui.panel({ title: 'Canvas pages', icon: 'moon', subtitle: 'Native Canvas pages: assignments, discussions, quizzes, the editor…', id: 'set-native' },
      row('Gesso button', 'The floating "Gesso" and moon buttons at the bottom-right of Canvas pages.',
        h('label', { class: 'switch' }, check('set-launcher', s.showLauncher !== false, (on) => update({ showLauncher: on })), h('span', { class: 'sr-only' }, 'Show the Gesso button on Canvas pages'))),
      h('div', { class: 'set-row' },
        ui.selectField({
          label: 'Dark mode', value: mode, fkey: 'set-native-dark',
          options: [['match', `Match the Gesso theme (now ${s.theme === 'light' ? 'light' : 'dark'})`], ['on', 'Always dark'], ['off', 'Off']],
          onChange: (v) => update({ nativeDark: /** @type {any} */ (v) }),
        })),
      h('fieldset', { class: 'set-group', disabled: !active },
        h('legend', { class: 'set-legend' }, 'Pages'),
        h('div', { class: 'set-grid' }, Gesso.nativeDark.PAGE_TYPES.map(([type, label]) =>
          h('label', { class: 'set-check' }, check(`set-type:${type}`, !off.has(type), (on) => setType(type, on)), h('span', null, label))))),
      h('fieldset', { class: 'set-group', disabled: !active },
        h('legend', { class: 'set-legend' }, 'Content'),
        h('label', { class: 'set-check' }, check('set-editor', s.darkEditor !== false, (on) => update({ darkEditor: on })),
          h('span', null, 'Dark text editor', h('span', { class: 'set-hint' }, 'Off keeps the editor light, so it looks like the published page.'))),
        h('label', { class: 'set-check' }, check('set-pdfs', !!s.darkPdfs, (on) => update({ darkPdfs: on })),
          h('span', null, 'Dark PDFs and document previews', h('span', { class: 'set-hint' }, 'Inverts the whole preview, including any photos in it. Photos and videos on pages always keep their real colors.')))),
      h('p', { class: 'faint set-note' }, 'The moon button on each Canvas page turns dark mode on or off for that kind of page. Changes apply to open tabs right away.'));
  }

  async function clearCache() {
    await Gesso.cache.clear();
    Gesso.overlays.toast('Cached data cleared. Reloading from Canvas…', { tone: 'info' });
    await Gesso.sync.refresh({ force: true });
    const err = Gesso.store.get().sync.error;
    Gesso.overlays.toast(err ? `Reload from Canvas failed: ${err.message}` : 'Reloaded everything from Canvas', { tone: err ? 'danger' : 'ok' });
  }

  function confirmReset() {
    const dlg = Gesso.overlays.dialog({
      title: 'Reset settings?', class: 'dialog--narrow',
      body: h('div', { class: 'form' },
        h('p', null, 'Theme (back to Gesso, dark), accent, course colors, density, default view, the due-soon window, the GPA scale, the Gesso button and Canvas-page dark mode go back to their defaults.'),
        h('p', { class: 'muted' }, 'Kept: your custom theme (pick it again in Appearance), hidden courses, GPA credits and exclusions, and everything saved in Canvas (nicknames, colors, to-dos, done and snoozed items).'),
        h('div', { class: 'form__actions' },
          h('span', { style: { flex: '1' } }),
          h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel'),
          h('button', { class: 'btn btn--primary', type: 'button', onClick: async () => { await Gesso.settings.reset(); dlg.close(); Gesso.overlays.toast('Settings reset', { tone: 'ok' }); } }, 'Reset'))),
    });
  }

  function render(/** @type {any} */ state) {
    const s = state.settings;
    const courses = Gesso.derive.sortedCourses(state.data);
    const hidden = courses.filter((/** @type {any} */ c) => (s.hiddenCourses || []).includes(c.id));
    const gpaCustom = !!s.gpaScale;
    const isMac = /Mac/.test(navigator.platform || navigator.userAgent);

    return h('div', { class: 'settings-page fade-in' },
      Gesso.themeEditor.appearancePanel(state),
      Gesso.themeEditor.customPanel(state),

      ui.panel({ title: 'Dashboard', icon: 'home', id: 'set-dashboard' },
        row('Open to', 'What Canvas shows when you open it from the toolbar or the bare address. The Dashboard link always goes to the dashboard.',
          ui.selectField({
            label: 'Default view', value: s.defaultView || 'dashboard', fkey: 'set-default-view',
            options: [['dashboard', 'Dashboard'], ['assignments', 'Assignments'], ['calendar', 'Calendar'], ['grades', 'Grades']],
            onChange: (v) => update({ defaultView: v }),
          })),
        row('"Due soon" window', 'How far ahead the Due soon panel, the stats and course cards look.',
          ui.selectField({
            label: 'Due soon', value: String(s.dueSoonDays), fkey: 'set-due-soon',
            options: [3, 5, 7, 10, 14, 21].map((n) => /** @type {[string, string]} */ ([String(n), `${n} days`])),
            onChange: (v) => update({ dueSoonDays: Number(v) }),
          }))),

      ui.panel({ title: 'Grades', icon: 'chart', id: 'set-grades' },
        row('GPA scale', gpaCustom ? 'Custom scale.' : 'Default 4.0 scale with +/−.',
          h('button', { class: 'btn', type: 'button', 'data-fkey': 'set-gpa', onClick: () => Gesso.views.grades.editScale(s) }, icon('pencil', { size: 14 }), 'Edit scale')),
        row('Credits and courses in the GPA', null, h('a', { class: 'btn btn--ghost', href: Gesso.router.href('/grades') }, 'On the Grades page', icon('chevronRight', { size: 13 })))),

      ui.panel({ title: 'Courses', icon: 'book', id: 'set-courses', subtitle: 'Hide a course with Edit… on the Courses page, or Settings in its workspace. Only affects Gesso.' },
        hidden.length
          ? h('ul', { class: 'set-list' }, hidden.map((/** @type {any} */ c) => h('li', { class: 'set-list__row' },
            h('span', { class: 'dot', style: { '--c': c.color }, 'aria-hidden': 'true' }),
            h('span', { class: 'truncate' }, c.code ? `${c.code} — ${Gesso.derive.courseTitle(c)}` : Gesso.derive.courseTitle(c)),
            h('button', { class: 'btn btn--sm', type: 'button', 'data-fkey': `set-unhide:${c.id}`, onClick: () => Gesso.courseSettings.setHidden(c.id, false) }, icon('eye', { size: 14 }), 'Show'))))
          : h('p', { class: 'faint' }, 'No hidden courses.')),

      nativeDarkPanel(s),

      ui.panel({ title: 'Experimental', icon: 'sparkles', id: 'set-experimental', subtitle: 'Features not yet verified against real Canvas. Off by default.' },
        row('Submit from Gesso (text, links, files)',
          'Adds "Submit" to assignments that accept a text entry, website URL or file upload. Each submission is checked by re-reading it from Canvas, but no real submission has been verified yet. Leave it off for anything that matters; "Submit in Canvas" always works.',
          h('label', { class: 'switch' }, check('set-exp-submit', !!s.experimentalSubmit, (on) => update({ experimentalSubmit: on })), h('span', { class: 'sr-only' }, 'Submit text, links and files from Gesso (experimental)')))),

      ui.panel({ title: 'Keyboard', icon: 'grid', id: 'set-keys' },
        row('Shortcuts', `${isMac ? '⌘K' : 'Ctrl+K'} opens the command palette; g then d, a, c, g, o or s goes to a page.`,
          h('button', { class: 'btn', type: 'button', 'data-fkey': 'set-shortcuts', onClick: () => Gesso.shortcuts.showHelp() }, 'Show all (?)'))),

      ui.panel({ title: 'Data', icon: 'refresh', id: 'set-data', subtitle: 'Everything is stored on this Mac in Safari’s extension storage. Nothing is sent anywhere but Canvas.' },
        row('Cached Canvas data', state.meta?.syncedAt?.all ? `Last synced ${Gesso.time.relative(new Date(state.meta.syncedAt.all))}.` : 'Not synced yet.',
          h('button', { class: 'btn', type: 'button', 'data-fkey': 'set-clear', disabled: !!state.sync.running, onClick: clearCache }, 'Clear and reload')),
        row('Settings', 'Back to the defaults. Your data in Canvas isn’t touched.',
          h('button', { class: 'btn', type: 'button', 'data-fkey': 'set-reset', onClick: confirmReset }, 'Reset settings…'))),

      ui.panel({ title: 'About', icon: 'page', id: 'set-about' },
        h('p', null, h('strong', null, 'Gesso'), version ? ` ${version}` : '', ' · An unofficial dashboard for Canvas.'),
        h('p', { class: 'muted' }, DISCLAIMER)),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.settings = { render };
})();
