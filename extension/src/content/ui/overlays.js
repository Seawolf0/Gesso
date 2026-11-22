// @ts-check
/**
 * Toasts and modal dialogs, rendered inside the app's shadow root.
 * Dialogs use the native <dialog> element: focus trapping, Escape to close,
 * and an inert background come for free.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;

  /** @type {HTMLElement|null} */
  let root = null;

  /** Called once by the shell with the element overlays mount into. */
  function attach(/** @type {HTMLElement} */ el) {
    root = el;
  }

  /**
   * Show a short message. Errors stay until dismissed; others fade after 4 s.
   * @param {string} message
   * @param {{ tone?: 'ok'|'danger'|'info', action?: { label: string, onClick: () => void } }} [opts]
   *   `action` adds a button (e.g. "Undo"); the toast then stays 8 s.
   */
  function toast(message, { tone = 'info', action } = {}) {
    if (!root) return;
    let region = root.querySelector('.toasts');
    if (!region) {
      region = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
      root.append(region);
    }
    const close = () => t.remove();
    const t = h('div', { class: `toast toast--${tone}` },
      icon(tone === 'danger' ? 'alert' : tone === 'ok' ? 'checkCircle' : 'sparkles', { size: 16 }),
      h('span', { class: 'toast__text' }, message),
      action && h('button', { class: 'btn btn--sm', type: 'button', onClick: () => { close(); action.onClick(); } }, action.label),
      h('button', { class: 'btn btn--ghost btn--icon btn--sm', type: 'button', 'aria-label': 'Dismiss', onClick: close }, icon('x', { size: 14 })));
    region.append(t);
    if (tone !== 'danger') setTimeout(close, action ? 8000 : 4000);
  }

  /**
   * Open a modal dialog.
   * @param {{ title: string, body: any, onClose?: () => void, class?: string }} o
   * @returns {{ close: () => void, el: HTMLDialogElement }}
   */
  function dialog({ title, body, onClose, class: cls }) {
    if (!root) throw new Error('overlays not attached');
    const shadow = /** @type {any} */ (root.getRootNode());
    const opener = /** @type {HTMLElement|null} */ (shadow.activeElement);
    const openerKey = opener?.getAttribute('data-fkey');
    const titleId = `dlg-${Math.random().toString(36).slice(2)}`;
    const el = /** @type {HTMLDialogElement} */ (h('dialog', { class: ['dialog', cls], 'aria-labelledby': titleId },
      h('header', { class: 'dialog__head' },
        h('h2', { class: 'dialog__title', id: titleId }, title),
        h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': 'Close', onClick: () => el.close() }, icon('x', { size: 16 }))),
      h('div', { class: 'dialog__body' }, body)));
    el.addEventListener('close', () => {
      el.remove();
      onClose?.();
      // Return focus to the opener — or its re-rendered replacement (same data-fkey).
      const target = opener?.isConnected ? opener
        : openerKey ? shadow.querySelector(`[data-fkey="${CSS.escape(openerKey)}"]`) : null;
      target?.focus?.({ preventScroll: true });
    });
    // Click on the backdrop closes, unless a 'cancel' listener vetoes it (same rule as Escape).
    el.addEventListener('click', (e) => {
      if (e.target !== el) return;
      const ev = new Event('cancel', { cancelable: true });
      if (el.dispatchEvent(ev)) el.close();
    });
    root.append(el);
    el.showModal();
    return { close: () => el.close(), el };
  }

  /** The element overlays mount into (the palette builds its own dialog there). */
  const overlayRoot = () => root;

  Gesso.overlays = { attach, toast, dialog, root: overlayRoot };
})();
