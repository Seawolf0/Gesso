// @ts-check
/**
 * Static configuration. Anything a user can change lives in settings.js instead.
 *
 * The Canvas domain has exactly one source of truth: `host_permissions[0]` in
 * manifest.json (the content_scripts `matches` entry must match it). Safari
 * fixes match patterns at build time, so changing schools means editing
 * manifest.json and rebuilding — see README.
 */
(() => {
  const manifest = Gesso.browser.runtime.getManifest();
  const hostPattern = (manifest.host_permissions || [])[0] || 'https://umd.instructure.com/*';
  const canvasOrigin = hostPattern.replace(/\/\*$/, '');

  Gesso.config = Object.freeze({
    version: manifest.version,
    canvasOrigin,
    canvasHost: new URL(canvasOrigin).host,

    /** Bump when the shape of cached data changes; old caches are discarded. */
    cacheSchemaVersion: 4, // v4: grade fields (posted_at presence, period ids, whole-course scores); v3: peer-review fields (2.5c/d); v2: planner date provenance + term dates

    api: Object.freeze({
      perPage: 100,
      /** Canvas penalizes parallel requests; 3 keeps the dashboard sync fast without tripping throttling. */
      maxConcurrent: 3,
      /** Below this X-Rate-Limit-Remaining value we drop to one request at a time. */
      lowWaterMark: 200,
      /** Below this we also pause between requests. */
      criticalWaterMark: 60,
      maxRetries: 4,
      /** Safety stop for runaway pagination. */
      maxPages: 50,
      timeoutMs: 30_000,
    }),

    sync: Object.freeze({
      /** Data older than this is refreshed in the background on load / tab focus. */
      staleAfterMs: 5 * 60_000,
      /** While Gesso is visible, refresh at most this often. */
      autoRefreshMs: 10 * 60_000,
      /** Another tab syncing within this window → skip our own sync. */
      lockMs: 45_000,
      /** Planner window used for the dashboard (days relative to today). */
      plannerPastDays: 21,
      plannerFutureDays: 28,
      // planner_notes (to-dos + snoozes): a wider window than planner/items.
      notesPastDays: 60,
      notesFutureDays: 365,
      announcementDays: 21,
    }),

    /** A gap longer than this starts a new "visit" for the What's-new feed. */
    visitGapMs: 30 * 60_000,
  });
})();
