// @ts-check
/**
 * Sync orchestration: cache → store (instant), then network → store + cache.
 *
 *   hydrate()  read cache.* into the store (first paint)
 *   refresh()  fetch fresh data, diff for "What's new", write store + cache
 *   startAuto() refresh when stale on tab focus, and periodically while visible
 *
 * Only runs in a Canvas tab (content script). The service worker never
 * fetches: Safari can drop session cookies on extension background requests.
 */
(() => {
  const { store, cache, normalize, changes } = Gesso;
  const canvas = Gesso.api.canvas;
  const { addDays, startOfDay } = Gesso.time;
  const cfg = Gesso.config.sync;

  /** @type {Promise<void>|null} */
  let running = null;
  /** Set when this copy of the content script stood down (health.js). */
  let disabled = false;

  /** Load cached data into the store. Returns true if there was a cache. */
  async function hydrate() {
    const { meta, data, visit } = await cache.load();
    const v = changes.touchVisit(visit);
    cache.saveVisit(v);
    store.set({ meta, data: data || {}, visit: v, hydrated: true });
    return !!data?.courses;
  }

  function isStale() {
    const t = store.get().meta?.syncedAt?.all;
    return !t || Date.now() - t > cfg.staleAfterMs;
  }

  /** Turn any thrown value into something the UI can render. */
  function toUiError(/** @type {any} */ err) {
    return { kind: err?.kind || 'unknown', message: err?.message || String(err) };
  }

  /**
   * Run a non-critical request; on failure keep `fallback` and record a warning.
   * Auth errors always propagate (the whole sync is pointless when logged out).
   * @template T
   * @param {Promise<T>} promise @param {T} fallback @param {string} label @param {string[]} warnings
   * @returns {Promise<T>}
   */
  async function soft(promise, fallback, label, warnings) {
    try {
      return await promise;
    } catch (err) {
      if (/** @type {any} */ (err)?.kind === 'auth') throw err;
      Gesso.log.warn(`${label} failed`, err);
      warnings.push(label);
      return fallback;
    }
  }

  /** Assignment groups (+ assignments + my submission) for every course. */
  async function fetchCoursework(/** @type {any[]} */ courses, /** @type {any} */ prev, /** @type {string[]} */ warnings) {
    /** @type {Record<string, any>} */
    const out = {};
    await Promise.all(courses.map(async (c) => {
      const groups = await soft(canvas.getAssignmentGroups(c.id), null, c.code || c.name, warnings);
      if (!groups) {
        if (prev?.[c.id]) out[c.id] = prev[c.id]; // keep last good data for this course
        return;
      }
      out[c.id] = {
        groups: groups.map((/** @type {any} */ g) => normalize.assignmentGroup(g, c.id)),
        assignments: groups.flatMap((/** @type {any} */ g) =>
          (g.assignments || []).map((/** @type {any} */ a) => normalize.assignment(a, c.id))),
      };
    }));
    return out;
  }

  /**
   * Fetch everything the dashboard needs. Safe to call repeatedly: concurrent
   * calls share one run, and other tabs are respected via a storage lock.
   */
  function refresh({ force = false } = {}) {
    if (disabled) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      if (!(await cache.acquireLock(force))) {
        Gesso.log.info('Another Canvas tab is syncing; using its results.');
        return;
      }
      const startedAt = performance.now();
      store.set({ sync: { running: true, error: null, warnings: [] } });
      /** @type {string[]} */
      const warnings = [];
      let prev = store.get().data || {};
      const meta = { ...(store.get().meta || cache.emptyMeta()) };

      try {
        // 1) Who's logged in. Fails fast with kind 'auth' when logged out.
        const user = normalize.user(await canvas.getSelf());
        if (meta.userId && meta.userId !== user.id) {
          // A different person logged in on this Mac — never mix their data.
          await cache.clear();
          prev = {};
          meta.syncedAt = {};
        }
        meta.userId = user.id;
        store.set({ data: { user } });

        // 2) Courses, colors, order → course cards can paint right away.
        const [rawCourses, colors, positions] = await Promise.all([
          canvas.getCourses(),
          soft(canvas.getColors(), {}, 'Course colors', warnings),
          soft(canvas.getDashboardPositions(), {}, 'Course order', warnings),
        ]);
        const courses = rawCourses
          .map((/** @type {any} */ c) => normalize.course(c, colors?.custom_colors || {}, positions?.dashboard_positions || {}))
          .filter(Boolean);
        store.set({ data: { courses } });

        // 3) Everything else in parallel (the client's queue limits concurrency).
        const today = startOfDay(new Date());
        const noteCodes = [`user_${user.id}`, ...courses.map((/** @type {any} */ c) => `course_${c.id}`)];
        const [coursework, planner, announcements, overrides, notes] = await Promise.all([
          fetchCoursework(courses, prev.coursework, warnings),
          soft(
            canvas.getPlannerItems(addDays(today, -cfg.plannerPastDays), addDays(today, cfg.plannerFutureDays))
              .then((items) => items.map(normalize.plannerItem)),
            prev.planner || [], 'Planner', warnings,
          ),
          soft(
            canvas.getAnnouncements(courses.map((/** @type {any} */ c) => c.id), cfg.announcementDays)
              .then((list) => list.map(normalize.announcement)),
            prev.announcements || null, 'Announcements', warnings,
          ),
          // Done state for every date, and to-dos/snoozes beyond the planner window.
          soft(canvas.getPlannerOverrides().then((list) => list.map(normalize.override)), prev.overrides || null, 'Planner overrides', warnings),
          soft(
            canvas.getPlannerNotes(addDays(today, -cfg.notesPastDays), addDays(today, cfg.notesFutureDays), noteCodes)
              .then((list) => list.map(normalize.plannerNote)),
            prev.notes || null, 'Planner notes', warnings,
          ),
        ]);

        // 4) What's new since the last snapshot.
        const events = prev.coursework
          ? [...changes.diffCoursework(prev.coursework, coursework), ...changes.diffAnnouncements(prev.announcements, announcements || [])]
          : changes.seed({ coursework, announcements });
        const feed = changes.mergeFeed(prev.feed, events);

        meta.syncedAt = { ...meta.syncedAt, all: Date.now() };
        const fresh = { user, courses, coursework, planner, announcements: announcements || [], feed, overrides, notes };
        const ms = Math.round(performance.now() - startedAt);
        const lastResult = { at: Date.now(), ok: true, changes: events.length, ms, manual: force };
        store.set({ data: fresh, meta, sync: { running: false, error: null, warnings, lastResult } });
        Gesso.log.info(`Sync finished in ${ms} ms: ${courses.length} courses, ${events.length} changes${warnings.length ? `, partial failures: ${warnings.join(', ')}` : ''}.`);
        await cache.save(fresh, meta);
      } catch (err) {
        Gesso.log.error('Sync failed', err);
        Gesso.health?.noteError(err, 'sync');
        const lastResult = { at: Date.now(), ok: false, changes: 0, ms: Math.round(performance.now() - startedAt), manual: force };
        store.set({ sync: { running: false, error: toUiError(err), warnings, lastResult } });
      } finally {
        await cache.releaseLock().catch(() => {});
        running = null;
      }
    })();
    return running;
  }

  /** Mark everything currently in the feed as seen. */
  async function markFeedSeen() {
    const visit = { ...store.get().visit, clearedAt: Date.now() };
    store.set({ visit });
    await cache.saveVisit(visit);
  }

  let autoStarted = false;
  /** Background refresh policy while Gesso is open. */
  function startAuto() {
    if (autoStarted) return;
    autoStarted = true;

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      const visit = changes.touchVisit(store.get().visit);
      store.set({ visit });
      cache.saveVisit(visit);
      if (isStale()) refresh();
    });

    setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, cfg.autoRefreshMs);

    // Another tab finished a sync → adopt its data without refetching.
    cache.onExternalUpdate((datasets, meta) => store.set({ data: datasets, meta }));
  }

  Gesso.sync = { hydrate, refresh, isStale, startAuto, markFeedSeen, disable: () => { disabled = true; } };
})();
