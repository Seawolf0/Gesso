// @ts-check
/**
 * Persistent cache in browser.storage.local (stale-while-revalidate).
 *
 * Layout — one key per dataset so a refresh rewrites only what changed:
 *   cache.meta           { schema, origin, userId, syncedAt: { [dataset]: ms }, writer }
 *   cache.user           User
 *   cache.courses        Course[]
 *   cache.coursework     { [courseId]: { groups: AssignmentGroup[], assignments: Assignment[] } }
 *   cache.planner        PlannerItem[]
 *   cache.announcements  Announcement[]
 *   cache.feed           FeedEvent[]          ("What's new" history)
 *   cache.overrides      PlannerOverride[]    (marked done)
 *   cache.notes          PlannerNote[]        (to-dos and snoozes)
 *   cache.visit          { sessionStart, lastActive }
 *   cache.lock           { owner, at }        (cross-tab sync lock)
 *
 * Caches from a different Canvas origin, user, or schema version are discarded.
 */
(() => {
  const { cacheSchemaVersion, canvasOrigin, sync: syncCfg } = Gesso.config;
  const storage = Gesso.browser.storage.local;

  const KEYS = Object.freeze({
    meta: 'cache.meta',
    user: 'cache.user',
    courses: 'cache.courses',
    coursework: 'cache.coursework',
    planner: 'cache.planner',
    announcements: 'cache.announcements',
    feed: 'cache.feed',
    overrides: 'cache.overrides',
    notes: 'cache.notes',
    visit: 'cache.visit',
    lock: 'cache.lock',
  });

  /** Datasets that sync writes and other tabs should pick up. */
  const DATASETS = ['user', 'courses', 'coursework', 'planner', 'announcements', 'feed', 'overrides', 'notes'];

  /** Identifies this tab's writes so we can ignore our own change events. */
  const TAB_TOKEN = Math.random().toString(36).slice(2);

  function emptyMeta() {
    return { schema: cacheSchemaVersion, origin: canvasOrigin, userId: null, syncedAt: {}, writer: TAB_TOKEN };
  }

  /** Read everything the app needs for first paint, in one storage call. */
  async function load() {
    const keys = [KEYS.meta, ...DATASETS.map((d) => KEYS[d]), KEYS.visit];
    const raw = await storage.get(keys);
    const meta = raw[KEYS.meta];
    if (!meta || meta.schema !== cacheSchemaVersion || meta.origin !== canvasOrigin) {
      if (meta) await clear(); // stale schema or different school
      return { meta: emptyMeta(), data: null, visit: raw[KEYS.visit] || null };
    }
    /** @type {Record<string, any>} */
    const data = {};
    for (const d of DATASETS) data[d] = raw[KEYS[d]] ?? null;
    return { meta, data, visit: raw[KEYS.visit] || null };
  }

  /**
   * Persist some datasets plus meta in a single write (so other tabs see a
   * consistent snapshot in one onChanged event).
   * @param {Record<string, any>} datasets  e.g. { courses: [...], planner: [...] }
   * @param {any} meta
   */
  async function save(datasets, meta) {
    /** @type {Record<string, any>} */
    const payload = { [KEYS.meta]: { ...meta, writer: TAB_TOKEN } };
    for (const [name, value] of Object.entries(datasets)) {
      if (!(name in KEYS)) throw new Error(`Unknown cache dataset: ${name}`);
      payload[/** @type {any} */ (KEYS)[name]] = value;
    }
    try {
      await storage.set(payload);
    } catch (err) {
      // Most likely a quota error (the app still works from memory), or a dead extension context.
      Gesso.log.warn('Cache write failed', err);
      Gesso.health?.noteError(err, 'cache.save');
    }
  }

  async function saveVisit(/** @type {any} */ visit) {
    try { await storage.set({ [KEYS.visit]: visit }); } catch { /* non-critical */ }
  }

  /** Remove every cache.* and res.* key (settings are kept). */
  async function clear() {
    const all = await storage.get(null);
    const resourceKeys = Object.keys(all).filter((k) => k.startsWith('res.'));
    await storage.remove([...Object.values(KEYS), ...resourceKeys]);
    Gesso.store?.set({ resources: {} });
  }

  /**
   * Best-effort cross-tab lock so two Canvas tabs don't sync simultaneously.
   * @returns {Promise<boolean>} true if this tab may sync now
   */
  async function acquireLock(force = false) {
    const now = Date.now();
    const { [KEYS.lock]: lock } = await storage.get(KEYS.lock);
    if (!force && lock && lock.owner !== TAB_TOKEN && now - lock.at < syncCfg.lockMs) return false;
    await storage.set({ [KEYS.lock]: { owner: TAB_TOKEN, at: now } });
    return true;
  }

  async function releaseLock() {
    const { [KEYS.lock]: lock } = await storage.get(KEYS.lock);
    if (lock?.owner === TAB_TOKEN) await storage.remove(KEYS.lock);
  }

  /**
   * Call `fn(datasets, meta)` when *another* tab writes fresh data.
   * @param {(datasets: Record<string, any>, meta: any) => void} fn
   */
  function onExternalUpdate(fn) {
    Gesso.browser.storage.onChanged.addListener((/** @type {any} */ changes, /** @type {string} */ area) => {
      if (area !== 'local') return;
      const metaChange = changes[KEYS.meta];
      if (!metaChange?.newValue || metaChange.newValue.writer === TAB_TOKEN) return;
      /** @type {Record<string, any>} */
      const datasets = {};
      for (const d of DATASETS) {
        const c = changes[/** @type {any} */ (KEYS)[d]];
        if (c && 'newValue' in c) datasets[d] = c.newValue;
      }
      fn(datasets, metaChange.newValue);
    });
  }

  Gesso.cache = { KEYS, DATASETS, emptyMeta, load, save, saveVisit, clear, acquireLock, releaseLock, onExternalUpdate };
})();
