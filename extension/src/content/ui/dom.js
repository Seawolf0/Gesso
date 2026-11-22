// @ts-check
/**
 * Minimal DOM building helpers. No virtual DOM: views return real nodes and
 * the app swaps them in. `replace()` keeps keyboard focus stable across
 * re-renders via `data-fkey` attributes.
 *
 *   h('a', { class: ['row', { done }], href, onClick }, 'Label', childNode)
 *
 * Text is always inserted as text nodes — Canvas data (titles, names) is
 * never parsed as HTML.
 */
(() => {
  /** classnames: strings, arrays, and { name: bool } objects. */
  function cx(/** @type {any[]} */ ...args) {
    /** @type {string[]} */
    const out = [];
    for (const a of args) {
      if (!a) continue;
      if (typeof a === 'string') out.push(a);
      else if (Array.isArray(a)) out.push(cx(...a));
      else if (typeof a === 'object') for (const [k, v] of Object.entries(a)) if (v) out.push(k);
    }
    return out.filter(Boolean).join(' ');
  }

  /** @param {Element} el @param {string} key @param {any} value */
  function setProp(el, key, value) {
    if (value == null || value === false) return;
    if (key === 'class') {
      const c = cx(value);
      if (c) el.setAttribute('class', c);
    } else if (key === 'style' && typeof value === 'object') {
      // CSSOM (not the style attribute) so a page CSP can't block it.
      const style = /** @type {HTMLElement} */ (el).style;
      for (const [k, v] of Object.entries(value)) if (v != null) style.setProperty(k.startsWith('--') ? k : k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`), String(v));
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'ref' && typeof value === 'function') {
      value(el);
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, String(value));
    }
  }

  /** @param {Node} parent @param {any} child */
  function appendChild(parent, child) {
    if (child == null || child === false || child === true) return;
    if (Array.isArray(child)) child.forEach((c) => appendChild(parent, c));
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  }

  /**
   * Create an element.
   * @param {string} tag
   * @param {Record<string, any>|null} [props]
   * @param {...any} children
   * @returns {HTMLElement}
   */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) setProp(el, k, v);
    appendChild(el, children);
    return el;
  }

  /** Fragment helper. */
  function frag(/** @type {any[]} */ ...children) {
    const f = document.createDocumentFragment();
    appendChild(f, children);
    return f;
  }

  /**
   * Replace a container's children, restoring focus to the element with the
   * same `data-fkey` if focus was inside the container.
   * @param {Element} container @param {...any} children
   */
  function replace(container, ...children) {
    const root = /** @type {Document|ShadowRoot} */ (container.getRootNode());
    const active = /** @type {HTMLElement|null} */ (root.activeElement);
    const key = active && container.contains(active) ? active.getAttribute('data-fkey') : null;
    // Text inputs also keep their caret/selection across re-renders.
    const input = /** @type {HTMLInputElement|null} */ (key && 'selectionStart' in /** @type {any} */ (active) ? active : null);
    let sel = null;
    try { sel = input ? [input.selectionStart, input.selectionEnd] : null; } catch { /* e.g. type=date */ }
    const f = frag(children);
    container.replaceChildren(f);
    if (key) {
      const again = /** @type {HTMLElement|null} */ (container.querySelector(`[data-fkey="${CSS.escape(key)}"]`));
      again?.focus({ preventScroll: true });
      if (sel && again && 'setSelectionRange' in again) {
        try { /** @type {HTMLInputElement} */ (again).setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ }
      }
    }
  }

  Gesso.dom = { h, frag, cx, replace };
})();
