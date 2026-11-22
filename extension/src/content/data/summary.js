// @ts-check
/**
 * Toolbar popup + badge data. The background worker never fetches,
 * so after each sync or change the content script writes a small
 * summary to storage.local under `popup.summary`:
 *
 *   { v, origin, at, syncedAt, user, loggedOut, overdue,
 *     items: [{ key, title, kind, course, color, dueAt, points, url }] }
 *
 * `items` is undone, unsnoozed work due in the next 14 days, soonest first
 * (max 30). The popup shows the next 5. The worker counts the ones due
 * within 48 hours for the badge, and recounts on a timer, since that number
 * changes as time passes even without a sync.
 */
(() => {
  const KEY = 'popup.summary';
  const WINDOW_DAYS = 14;
  const MAX_ITEMS = 30;

  /**
   * Pure: store state → summary.
   * @param {any} state @param {Date} [now]
   */
  function compute(state, now = new Date()) {
    const D = Gesso.derive;
    const origin = Gesso.config.canvasOrigin;
    const hidden = state.settings?.hiddenCourses || [];
    const items = D.workItems(state.data || {}, hidden);
    const byId = new Map((state.data?.courses || []).map((/** @type {any} */ c) => [c.id, c]));
    const end = now.getTime() + WINDOW_DAYS * 86_400_000;
    const upcoming = items.filter((i) => {
      const t = Gesso.time.toDate(i.dueAt)?.getTime();
      return t != null && t >= now.getTime() && t < end && !D.isDone(i) && !D.isSnoozed(i, now);
    }).sort((a, b) => /** @type {any} */ (Gesso.time.toDate(a.dueAt)).getTime() - /** @type {any} */ (Gesso.time.toDate(b.dueAt)).getTime());
    const toUrl = (/** @type {string|null} */ href) => (!href ? `${origin}/#/` : href.startsWith('#') ? `${origin}/${href}` : href);
    return {
      v: 1,
      origin,
      at: now.getTime(),
      syncedAt: state.meta?.syncedAt?.all || null,
      user: state.data?.user?.name || null,
      loggedOut: state.sync?.error?.kind === 'auth',
      overdue: D.overdue(items, now).length,
      items: upcoming.slice(0, MAX_ITEMS).map((i) => {
        const c = /** @type {any} */ (byId.get(i.courseId));
        return {
          key: i.key, title: i.title, kind: i.kind,
          course: c ? c.code || D.courseTitle(c) : 'Personal', color: c?.color || null,
          dueAt: i.dueAt, points: i.points,
          url: toUrl(i.kind === 'note' ? null : D.itemHref(i)),
        };
      }),
    };
  }

  let started = false;
  let stopped = false;
  let last = '';
  let timer = 0;

  /** Write the summary whenever the data changes (debounced; skipped when unchanged). */
  function start() {
    if (started) return;
    started = true;
    const write = () => {
      if (stopped) return;
      // The popup shows the theme's course colors too.
      const s = Gesso.appearance ? Gesso.appearance.view(Gesso.store.get()) : Gesso.store.get();
      if (!s.hydrated || s.data?.coursework == null) return;
      const summary = compute(s);
      // `at` changes every time; compare without it so idle re-renders don't write.
      const sig = JSON.stringify({ ...summary, at: 0 });
      if (sig === last) return;
      last = sig;
      Gesso.browser.storage.local.set({ [KEY]: summary }).catch((/** @type {any} */ err) => Gesso.log.warn('Popup summary write failed', err));
    };
    Gesso.store.subscribe(() => { clearTimeout(timer); timer = window.setTimeout(write, 400); });
    write();
  }

  Gesso.summary = { KEY, compute, start, stop: () => { stopped = true; clearTimeout(timer); } };
})();
