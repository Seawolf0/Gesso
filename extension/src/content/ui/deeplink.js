// @ts-check
/**
 * Native Canvas URL → equivalent Gesso route.
 *
 * Used by the floating "Gesso" launcher on native pages: it navigates to
 * `/#/open?path=<native path>[&hint=announcement]`, and the app resolves that
 * here (with all synced data available) and replaces the history entry with
 * the real route. Pure function → unit-tested in dev/tests.
 *
 *   /courses/:id                          → /courses/:id
 *   /courses/:id/assignments[/:aid…]      → /courses/:id/assignments[/:aid]  (assignment detail view)
 *   /courses/:id/assignments/:aid?reviewee_id=:u (live peer-review shape),
 *   /courses/:id/assignments/:aid/(anonymous_)submissions/:x  (not mine) → /courses/:id/peer-reviews/:aid?reviewee|anon=
 *   /courses/:id/quizzes[/:qid…]          → /courses/:id/assignments[/<assignment for quiz>]
 *   /courses/:id/discussion_topics/:tid   → announcement (if known/hinted) | graded → assignment detail | ungraded → discussion summary
 *   /courses/:id/announcements[/:tid]     → /courses/:id/announcements[/:tid]
 *   /courses/:id/modules…                 → /courses/:id/modules
 *   /courses/:id/files[/folder/…]         → /courses/:id/files[/:folderId when resolvable]
 *   /courses/:id/grades…                  → /courses/:id/grades
 *   /calendar → /calendar · /grades → /grades · /courses → /courses
 *   anything else                          → / (dashboard)
 */
(() => {
  /**
   * @param {string} path      native pathname, e.g. "/courses/123/assignments/456"
   * @param {{ hint?: string|null, data?: any, folders?: (courseId: string) => any[]|null }} [ctx]
   * @returns {string} Gesso route path (without "#")
   */
  function resolve(path, { hint = null, data = {}, folders } = {}) {
    const [pathOnly, search = ''] = String(path || '/').split('?');
    const query = new URLSearchParams(search);
    const p = pathOnly.replace(/\/+$/, '') || '/';
    if (p === '/' || p === '') return '/';
    if (p === '/calendar') return '/calendar';
    if (p === '/grades') return '/grades';
    if (p === '/courses') return '/courses';

    const m = p.match(/^\/courses\/(\d+)(?:\/([^/]+)(?:\/([^/]+))?(?:\/(.*))?)?$/);
    if (!m) return '/';
    const [, courseId, section, itemId, rest] = m;
    const base = `/courses/${courseId}`;
    // If we know the course list and this course isn't in it (concluded,
    // dropped), there's nothing to show — go to the dashboard.
    if (Array.isArray(data.courses) && data.courses.length && !data.courses.some((/** @type {any} */ c) => c.id === courseId)) return '/';

    const assignments = /** @type {any[]} */ (data.coursework?.[courseId]?.assignments || []);
    const knownAnnouncement = (/** @type {string} */ id) =>
      (data.announcements || []).some((/** @type {any} */ a) => a.id === id && a.courseId === courseId);

    switch (section) {
      case undefined:
        return base;
      case 'assignments': {
        if (itemId === 'syllabus') return base; // /assignments/syllabus is the syllabus page
        // …/assignments/:aid/submissions/:userId is a peer review when it's someone else's
        // submission; …/anonymous_submissions/:anonId always is.
        const sub = (rest || '').match(/^(anonymous_)?submissions\/([^/?#]+)/);
        const revieweeParam = query.get('reviewee_id');
        if (itemId && /^\d+$/.test(itemId) && revieweeParam && revieweeParam !== String(data.user?.id || '')) {
          return `${base}/peer-reviews/${itemId}?reviewee=${encodeURIComponent(revieweeParam)}`; // live peer-review URL shape
        }
        if (itemId && /^\d+$/.test(itemId) && sub) {
          if (sub[1]) return `${base}/peer-reviews/${itemId}?anon=${encodeURIComponent(sub[2])}`;
          if (data.user?.id && sub[2] !== String(data.user.id)) return `${base}/peer-reviews/${itemId}?reviewee=${encodeURIComponent(sub[2])}`;
        }
        if (itemId && /^\d+$/.test(itemId)) return `${base}/assignments/${itemId}`; // detail view
        return `${base}/assignments`;
      }
      case 'quizzes': {
        const a = itemId ? assignments.find((x) => x.quizId === itemId) : null;
        return a ? `${base}/assignments/${a.id}` : `${base}/assignments`;
      }
      case 'announcements':
        return itemId && /^\d+$/.test(itemId) ? `${base}/announcements/${itemId}` : `${base}/announcements`;
      case 'discussion_topics': {
        if (!itemId || !/^\d+$/.test(itemId)) return base;
        if (hint === 'announcement' || knownAnnouncement(itemId)) return `${base}/announcements/${itemId}`;
        const a = assignments.find((x) => x.discussionId === itemId);
        return a ? `${base}/assignments/${a.id}` : `${base}/discussions/${itemId}`; // ungraded → discussion summary
      }
      case 'modules':
        return `${base}/modules`;
      case 'files': {
        // /courses/:id/files/folder/Lectures/Week%2012 → match by folder path
        if (itemId === 'folder' && rest && folders) {
          const want = `course files/${decodeURIComponent(rest)}`.toLowerCase();
          const f = (folders(courseId) || []).find((x) => x.fullName.toLowerCase() === want);
          if (f) return `${base}/files/${f.id}`;
        }
        return `${base}/files`;
      }
      case 'grades':
        return `${base}/grades`;
      default:
        return base; // pages, syllabus, people… → course overview
    }
  }

  Gesso.deeplink = { resolve };
})();
