// @ts-check
/**
 * Small per-view UI preferences (sort, grouping, filters, collapsed modules…),
 * persisted to storage.local under one `prefs` key. Loaded once at startup so
 * reads are synchronous; writes are debounced.
 */
(() => {
  const KEY = 'prefs';
  const VERSION = 2;
  const storage = Gesso.browser.storage.local;
  /** @type {Record<string, any>} */
  let values = {};
  let timer = 0;

  async function load() {
    try { values = (await storage.get(KEY))[KEY] || {}; } catch { values = {}; }
    if (migrate(values)) storage.set({ [KEY]: values }).catch(() => {});
  }

  /**
   * One-time changes to saved prefs, keyed by `values.v`. Each step runs once;
   * afterwards whatever the user picks is saved and wins as usual.
   *   v2: the default due sort became the timeline (overdue →
   *      upcoming → undated → past). Reset any saved assignment sort once so
   *      the new default shows; grouping and filters are kept.
   * @returns {boolean} whether anything changed
   */
  function migrate(/** @type {Record<string, any>} */ v) {
    const from = typeof v.v === 'number' ? v.v : 1;
    if (from >= VERSION) return false;
    if (from < 2) {
      if (v.assignments && typeof v.assignments === 'object') delete v.assignments.sort;
      delete v.courseAssignments;
    }
    v.v = VERSION;
    return true;
  }

  /**
   * @template T
   * @param {string} name @param {T} defaults
   * @returns {T}
   */
  function get(name, defaults) {
    const v = values[name];
    return v && typeof v === 'object' && !Array.isArray(v) ? { ...defaults, ...v } : (v ?? defaults);
  }

  function set(/** @type {string} */ name, /** @type {any} */ value) {
    values[name] = value;
    clearTimeout(timer);
    timer = setTimeout(() => { storage.set({ [KEY]: values }).catch(() => {}); }, 400);
  }

  Gesso.prefs = { load, get, set, migrate, VERSION };
})();
