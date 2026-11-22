// @ts-check
/**
 * In-memory app state with subscribe/notify. Deliberately tiny: one state
 * object, shallow-merged updates, listeners batched to one call per tick.
 *
 * Shape:
 * {
 *   settings,                                  // see shared/settings.js
 *   data: { user, courses, coursework, planner, announcements, feed, overrides, notes } | each may be null before first load
 *   meta,                                      // cache meta (syncedAt per dataset)
 *   sync: { running, error, phase }            // error: { kind, message } | null
 *   hydrated: boolean                          // true once the cache has been read
 *   visit: { sessionStart, lastActive }
 * }
 */
(() => {
  /** @type {any} */
  let state = {
    settings: { ...Gesso.settings.DEFAULTS },
    data: { user: null, courses: null, coursework: null, planner: null, announcements: null, feed: null, overrides: null, notes: null },
    meta: null,
    sync: { running: false, error: null, phase: '' },
    hydrated: false,
    visit: null,
    resources: {},                             // see data/resources.js
  };

  /** @type {Set<(state: any) => void>} */
  const listeners = new Set();
  let scheduled = false;

  function get() {
    return state;
  }

  /**
   * Shallow-merge a patch (or the result of fn(state)) into state.
   * `data` and `sync` are merged one level deeper since they're updated piecemeal.
   * @param {any} patchOrFn
   */
  function set(patchOrFn) {
    const patch = typeof patchOrFn === 'function' ? patchOrFn(state) : patchOrFn;
    state = {
      ...state,
      ...patch,
      data: patch.data ? { ...state.data, ...patch.data } : state.data,
      sync: patch.sync ? { ...state.sync, ...patch.sync } : state.sync,
    };
    if (!scheduled) {
      scheduled = true;
      // Microtask batching: several set() calls in one tick → one render.
      // (Not requestAnimationFrame: it pauses in background tabs, which would
      // leave stale UI and delay work until the tab is shown.)
      queueMicrotask(() => {
        scheduled = false;
        for (const fn of listeners) {
          try { fn(state); } catch (err) { Gesso.log.error('Listener failed', err); }
        }
      });
    }
  }

  /** @param {(state: any) => void} fn @returns {() => void} unsubscribe */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  Gesso.store = { get, set, subscribe };
})();
