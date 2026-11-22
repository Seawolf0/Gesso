// @ts-check
/**
 * On-demand resources with stale-while-revalidate: modules, folders, files,
 * and full announcement lists for one course. These are only fetched when
 * you open the matching workspace tab.
 *
 * State lives in the store under `resources[key]`:
 *   { data, loading, error, syncedAt, errorAt }
 * and persists to storage.local as `res.<key>` so revisits paint instantly.
 *
 * Views call `ensure(key, fetcher)` while rendering. It's idempotent: it
 * starts at most one fetch per key, never refetches fresh data, and backs off
 * after an error, so calling it on every render can't loop.
 */
(() => {
  const { store } = Gesso;
  const storage = Gesso.browser.storage.local;
  const DEFAULT_TTL = 10 * 60_000;
  const ERROR_BACKOFF = 30_000;
  const PREFIX = 'res.';

  /** @type {Map<string, Promise<any>>} */
  const inflight = new Map();
  /** Keys whose persisted copy we've already tried to read. */
  const hydrated = new Set();

  function entry(/** @type {string} */ key) {
    return store.get().resources?.[key] || null;
  }

  function setEntry(/** @type {string} */ key, /** @type {any} */ patch) {
    store.set((/** @type {any} */ s) => ({
      resources: { ...s.resources, [key]: { ...(s.resources?.[key] || {}), ...patch } },
    }));
  }

  /**
   * Fetch (or refetch) a resource now.
   * @param {string} key
   * @param {() => Promise<any>} fetcher  returns normalized data
   * @param {{ persist?: boolean }} [opts]
   */
  function load(key, fetcher, { persist = true } = {}) {
    if (inflight.has(key)) return /** @type {Promise<any>} */ (inflight.get(key));
    setEntry(key, { loading: true });
    const p = fetcher()
      .then(async (data) => {
        const syncedAt = Date.now();
        setEntry(key, { data, loading: false, error: null, syncedAt });
        if (persist) {
          try { await storage.set({ [PREFIX + key]: { data, syncedAt } }); } catch { /* quota: memory only */ }
        }
        return data;
      })
      .catch((/** @type {any} */ err) => {
        Gesso.log.warn(`Loading ${key} failed`, err);
        setEntry(key, { loading: false, error: { kind: err?.kind || 'unknown', message: err?.message || String(err) }, errorAt: Date.now() });
        return null;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  /**
   * Make sure `key` is loaded or loading; returns the current entry (possibly
   * stale or empty). Safe to call during render.
   * @param {string} key
   * @param {() => Promise<any>} fetcher
   * @param {{ ttl?: number, persist?: boolean }} [opts]
   */
  function ensure(key, fetcher, { ttl = DEFAULT_TTL, persist = true } = {}) {
    const e = entry(key);
    if (persist && !e && !hydrated.has(key)) {
      hydrated.add(key);
      // Read the persisted copy first (fast), then decide whether to fetch.
      storage.get(PREFIX + key).then((/** @type {any} */ got) => {
        const saved = got[PREFIX + key];
        if (saved && !entry(key)?.data) setEntry(key, { data: saved.data, syncedAt: saved.syncedAt });
        ensure(key, fetcher, { ttl, persist });
      }).catch(() => ensure(key, fetcher, { ttl, persist: false }));
      return { data: null, loading: true, error: null, syncedAt: 0 };
    }
    const fresh = e?.syncedAt && Date.now() - e.syncedAt < ttl;
    const backingOff = e?.error && Date.now() - (e.errorAt || 0) < ERROR_BACKOFF;
    if (!fresh && !backingOff && !inflight.has(key)) queueMicrotask(() => load(key, fetcher, { persist }));
    return e || { data: null, loading: true, error: null, syncedAt: 0 };
  }

  /** Drop a resource so the next ensure() refetches (e.g. after a write). */
  function invalidate(/** @type {string} */ key) {
    setEntry(key, { syncedAt: 0, error: null, errorAt: 0 });
  }

  /** Patch cached data in place (optimistic updates). */
  function mutate(/** @type {string} */ key, /** @type {(data: any) => any} */ fn) {
    const e = entry(key);
    if (e?.data) setEntry(key, { data: fn(e.data) });
  }

  Gesso.resources = { PREFIX, ensure, load, invalidate, mutate, entry };
})();
