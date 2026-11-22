// @ts-check
/**
 * Hash router. Gesso lives at the Canvas dashboard URL ("/"), and views
 * are addressed by hash so back/forward and bookmarks work:
 *
 *   /#/                                    dashboard
 *   /#/assignments[?range=&status=&course=] assignment center (query presets filters)
 *   /#/courses                             all courses
 *   /#/courses/:id                         course workspace → Overview
 *   /#/courses/:id/:tab                    tab = assignments|modules|files|announcements|grades
 *   /#/courses/:id/assignments/:assignmentId   assignment detail view
 *   /#/courses/:id/assignments?highlight=:id   assignments tab with that row highlighted
 *   /#/courses/:id/announcements/:topicId      …with that announcement open (marks it read)
 *   /#/courses/:id/discussions/:topicId        ungraded discussion summary (graded → assignment detail)
 *   /#/courses/:id/peer-reviews/:assignmentId?request=&reviewee=&anon=   peer-review summary
 *   /#/courses/:id/files/:folderId             …showing that folder
 *   /#/calendar                            calendar: last-used view around today
 *   /#/calendar/week/2026-11-15            …week starting that Sunday
 *   /#/calendar/month/2026-11              …month
 *   /#/calendar/agenda/2026-11-18          …14-day agenda from that date
 *   /#/grades                              grade analytics
 *   /#/settings                            settings
 *   /#/debug                               diagnostics: load timing, item date provenance, past-term dates
 *   /#/open?path=/courses/1/…[&hint=announcement]
 *       Deep link from a native Canvas URL (used by the floating launcher);
 *       resolved by ui/deeplink.js and replaced in history by the real route.
 *
 * Rule: every view and sub-view has its own URL, so reload, back/forward,
 * and bookmarks always return to the same place.
 */
(() => {
  /** @typedef {{ name: string, params: Record<string,string>, path: string, query: URLSearchParams }} Route */

  const ROUTES = [
    { name: 'dashboard', re: /^\/?$/, keys: [] },
    { name: 'assignments', re: /^\/assignments\/?$/, keys: [] },
    { name: 'courses', re: /^\/courses\/?$/, keys: [] },
    { name: 'course', re: /^\/courses\/([^/]+)(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/, keys: ['id', 'tab', 'item'] },
    { name: 'open', re: /^\/open\/?$/, keys: [] },
    { name: 'debug', re: /^\/debug\/?$/, keys: [] },
    { name: 'calendar', re: /^\/calendar(?:\/(week|month|agenda)(?:\/(\d{4}-\d{2}(?:-\d{2})?))?)?\/?$/, keys: ['view', 'date'] },
    { name: 'grades', re: /^\/grades\/?$/, keys: [] },
    { name: 'settings', re: /^\/settings\/?$/, keys: [] },
  ];

  /** @returns {Route} */
  function parse(hash = location.hash) {
    // Split at the first "?" only: query values may themselves contain "?".
    const raw = hash.replace(/^#/, '');
    const qi = raw.indexOf('?');
    const rawPath = qi < 0 ? raw : raw.slice(0, qi);
    const rawQuery = qi < 0 ? '' : raw.slice(qi + 1);
    const path = decodeURIComponent(rawPath) || '/';
    const query = new URLSearchParams(rawQuery);
    for (const r of ROUTES) {
      const m = path.match(r.re);
      if (!m) continue;
      /** @type {Record<string,string>} */
      const params = {};
      r.keys.forEach((k, i) => { if (m[i + 1]) params[k] = m[i + 1]; });
      return { name: r.name, params, path, query };
    }
    return { name: 'not_found', params: {}, path, query };
  }

  /** `href` value for an in-app link. */
  const href = (/** @type {string} */ path) => `#${path}`;

  function go(/** @type {string} */ path) {
    location.hash = path;
  }

  /** @param {(route: Route) => void} fn */
  function onChange(fn) {
    window.addEventListener('hashchange', () => fn(parse()));
  }

  Gesso.router = { parse, href, go, onChange };
})();
