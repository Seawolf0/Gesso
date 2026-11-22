// @ts-check
/**
 * Global keyboard shortcuts for Gesso.
 *
 *   ⌘K / Ctrl-K  command palette (works even while typing)
 *   g d  dashboard     g a  assignments    g c  calendar
 *   g g  grades        g o  courses        g s  settings
 *   ?    this list
 *
 * Keys typed into a field, or while a dialog is open, are left alone (except
 * ⌘K). Events from inside the shadow root reach `window` retargeted to the
 * host, so the real target comes from `composedPath()[0]`.
 *
 * The listener runs in the *capture* phase and swallows the second key of a
 * `g` sequence, so `g a` doesn't also reach the calendar's own `a` (agenda)
 * key, which listens on window in the bubble phase and skips handled events.
 */
(() => {
  const { h } = Gesso.dom;

  /** Second key after `g` → route. */
  const GO = /** @type {Record<string, [string, string]>} */ ({
    d: ['/', 'Dashboard'],
    a: ['/assignments', 'Assignments'],
    c: ['/calendar', 'Calendar'],
    g: ['/grades', 'Grades'],
    o: ['/courses', 'Courses'],
    s: ['/settings', 'Settings'],
  });
  const SEQUENCE_MS = 1500;

  /** Is the user typing somewhere? */
  function isEditable(/** @type {any} */ el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type);
  }

  /**
   * Pure key → command mapping (unit-tested).
   * @param {{ key: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean, shiftKey?: boolean }} e
   * @param {{ pendingG: boolean, editable: boolean, dialogOpen: boolean }} ctx
   * @returns {{ type: 'palette' }|{ type: 'go', path: string }|{ type: 'help' }|{ type: 'startG' }|{ type: 'cancelG' }|null}
   */
  function interpret(e, ctx) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') return { type: 'palette' };
    if (ctx.editable || ctx.dialogOpen || mod || e.altKey) return ctx.pendingG ? { type: 'cancelG' } : null;
    if (ctx.pendingG) {
      const target = GO[e.key.toLowerCase()];
      return target && !e.shiftKey ? { type: 'go', path: target[0] } : { type: 'cancelG' };
    }
    if (e.key === 'g' && !e.shiftKey) return { type: 'startG' };
    if (e.key === '?') return { type: 'help' };
    return null;
  }

  /** @param {ShadowRoot} shadow */
  function install(shadow) {
    let pendingG = 0;
    window.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = e.composedPath()[0];
      const cmd = interpret(e, {
        pendingG: !!pendingG && Date.now() - pendingG < SEQUENCE_MS,
        editable: isEditable(target),
        dialogOpen: !!shadow.querySelector('dialog[open]'),
      });
      if (!cmd) return;
      // ⌘K over another dialog (to-do, snooze…) would stack modals: ignore it.
      if (cmd.type === 'palette' && shadow.querySelector('dialog[open]') && !Gesso.palette.isOpen()) return;
      if (cmd.type === 'cancelG') { pendingG = 0; return; }
      if (cmd.type === 'startG') { pendingG = Date.now(); return; }
      e.preventDefault();
      e.stopImmediatePropagation();
      pendingG = 0;
      if (cmd.type === 'palette') Gesso.palette.toggle();
      else if (cmd.type === 'go') Gesso.router.go(cmd.path);
      else if (cmd.type === 'help') showHelp();
    }, true);
  }

  const kbd = (/** @type {string} */ k) => h('kbd', { class: 'kbd' }, k);
  const keys = (/** @type {string} */ combo) => combo.split(' ').map(kbd);

  /** The `?` overlay. Lists the calendar's keys when the calendar is open. */
  function showHelp() {
    const onCalendar = Gesso.router.parse().name === 'calendar';
    const row = (/** @type {string} */ combo, /** @type {string} */ what) => h('div', { class: 'keys__row' }, h('dt', null, keys(combo)), h('dd', null, what));
    const isMac = /Mac/.test(navigator.platform || navigator.userAgent);
    const body = h('div', { class: 'keys' },
      h('section', null,
        h('h3', { class: 'set-legend' }, 'Anywhere in Gesso'),
        h('dl', null,
          row(isMac ? '⌘ K' : 'Ctrl K', 'Command palette: jump to anything, run actions'),
          ...Object.entries(GO).map(([k, [, label]]) => row(`g ${k}`, `Go to ${label}`)),
          row('?', 'Show this list'))),
      h('section', null,
        h('h3', { class: 'set-legend' }, 'In the command palette'),
        h('dl', null,
          row('↑ ↓', 'Move through results'),
          row('↵', 'Open'),
          row(isMac ? '⌘ ↵' : 'Ctrl ↵', 'Open in a new tab'),
          row('esc', 'Close'))),
      h('section', { class: onCalendar ? 'keys--here' : undefined },
        h('h3', { class: 'set-legend' }, `Calendar${onCalendar ? ' (this page)' : ''}`),
        h('dl', null,
          row('← →', 'Previous / next week, month or range'),
          row('t', 'Today'),
          row('w', 'Week view'), row('m', 'Month view'), row('a', 'Agenda view'))),
      h('p', { class: 'faint set-note' }, 'Shortcuts are off while you type in a field. Press g, then the letter, within a second and a half.'),
      h('section', null,
        h('h3', { class: 'set-legend' }, 'Moving with Tab in Safari'),
        h('p', { class: 'set-note' },
          'By default Safari’s Tab key only visits text fields and pop-up menus. ',
          isMac ? 'Use Option-Tab to also reach links (rows, tabs, the sidebar). ' : '',
          'Buttons (done, snooze, theme…) also need Keyboard Navigation in macOS System Settings → Keyboard. ',
          'To make plain Tab reach links, turn on “Press Tab to highlight each item on a webpage” in Safari Settings → Advanced. ',
          'The shortcuts above and ⌘K work either way.')));
    Gesso.overlays.dialog({ title: 'Keyboard shortcuts', body, class: 'dialog--narrow' });
  }

  Gesso.shortcuts = { install, interpret, isEditable, showHelp, GO };
})();
