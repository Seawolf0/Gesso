// @ts-check
/**
 * The global namespace every extension script attaches to.
 *
 * Why not ES modules? Safari loads manifest `content_scripts` as classic
 * scripts, so `import`/`export` aren't available there. Instead each file adds
 * its exports to `Gesso.<area>`, and the load order lives in manifest.json.
 * The same files also load in extension pages (popup/options) via plain
 * <script> tags, so shared code is written once.
 *
 * Convention: each file is an IIFE that reads what it needs from `Gesso` at the
 * top and assigns its public API at the bottom.
 */
// eslint-disable-next-line no-var
var Gesso = /** @type {any} */ (globalThis).Gesso || {};
/** @type {any} */ (globalThis).Gesso = Gesso;

/** When Safari started running our first content-script file (load-timing split). */
Gesso.bootStart = Gesso.bootStart ?? performance.now();

/** Safari exposes both `browser` (promise-based) and `chrome`; prefer `browser`. */
Gesso.browser = /** @type {any} */ (globalThis).browser || /** @type {any} */ (globalThis).chrome;

/**
 * Our own DOM nodes: the Gesso root, the floating launcher,
 * recovery cards. The injected-element hider must never touch these.
 * Membership is a WeakSet in this script's memory, which a page script can't
 * forge by copying an id, class or attribute. The per-copy random token
 * attribute exists only so the guard *stylesheet* can pre-hide foreign nodes
 * before the observer runs; the JS check is the WeakSet. Each copy of the
 * content script has its own token, so a newer copy's guard hides an older
 * copy's leftovers and not its own root.
 */
Gesso.own = Gesso.own || (() => {
  const nodes = new WeakSet();
  const token = Math.random().toString(36).slice(2, 10);
  return {
    token,
    attr: 'data-gesso-own',
    /** Register a node as ours (before it's inserted anywhere observers watch). */
    add(/** @type {Element} */ el) { nodes.add(el); el.setAttribute('data-gesso-own', token); return el; },
    has(/** @type {any} */ el) { return !!el && nodes.has(el); },
  };
})();

/** Tiny logger that prefixes messages so they're easy to filter in Web Inspector. */
Gesso.log = {
  info: (...args) => console.info('[Gesso]', ...args),
  warn: (...args) => console.warn('[Gesso]', ...args),
  error: (...args) => console.error('[Gesso]', ...args),
};
