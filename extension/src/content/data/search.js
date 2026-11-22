// @ts-check
/**
 * Command palette search, pure: no DOM, no I/O.
 *
 *   fuzzy(query, text)        → score (higher is better) or -1 for no match
 *   buildIndex(state, extras) → every jump target + action as an Entry
 *   search(index, query)      → ranked entries
 *
 * Index sources:
 *   - actions (theme, refresh, add to-do, shortcuts…) and main views
 *   - courses, and each course's tabs ("CSCI110 Files")
 *   - work items (assignments, quizzes, discussions, to-dos, peer reviews)
 *   - module items and pages, from modules already loaded for a course
 *   - files, from folders already opened (the palette doesn't crawl Files)
 *   - recent announcements
 */
(() => {
  /**
   * @typedef {Object} Entry
   * @property {string} id
   * @property {'action'|'view'|'course'|'tab'|'item'|'module'|'page'|'file'|'announcement'} kind
   * @property {string} title
   * @property {string} [sub]       Context shown on the right (course code, due date…)
   * @property {string} [href]      In-app "#/…" route or an absolute URL
   * @property {string} [action]    Action id, run by the palette UI
   * @property {string} [icon]
   * @property {string} [color]     Course color dot
   * @property {string} [keywords]  Extra words that match but aren't shown
   * @property {number} [boost]     Added to the score (e.g. upcoming work)
   */

  const KIND_ORDER = { action: 1, view: 1, course: 3, tab: 0, item: 2, page: 1, module: 0, file: 0, announcement: 0 };

  /**
   * Fuzzy match. Every query word must appear in `text` as a subsequence.
   * Points for: the word appearing as a substring (more at a word start or the
   * very start), consecutive characters, and characters at word starts. Gaps
   * cost a little, and so does a long text.
   */
  function fuzzy(/** @type {string} */ query, /** @type {string} */ text) {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    const t = text.toLowerCase();
    let total = 0;
    for (const word of q.split(/\s+/)) {
      const s = wordScore(word, t);
      if (s < 0) return -1;
      total += s;
    }
    return total - t.length * 0.05;
  }

  const isBoundary = (/** @type {string} */ t, /** @type {number} */ i) => i === 0 || /[\s\-_:/.(,&]/.test(t[i - 1]) || (/\d/.test(t[i]) && !/\d/.test(t[i - 1]));

  function wordScore(/** @type {string} */ w, /** @type {string} */ t) {
    // Substring: best case. Prefer an occurrence at a word boundary.
    let best = -1;
    for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
      const s = 10 + w.length * 3 + (i === 0 ? 8 : isBoundary(t, i) ? 5 : 0);
      if (s > best) best = s;
    }
    if (best >= 0) return best;
    // Subsequence: walk greedily, preferring boundary characters.
    let score = 0;
    let ti = 0;
    let prev = -2;
    for (const ch of w) {
      let found = -1;
      // Look ahead for a boundary occurrence first, then any occurrence.
      for (let j = ti; j < t.length; j++) if (t[j] === ch && isBoundary(t, j)) { found = j; break; }
      const any = t.indexOf(ch, ti);
      if (any < 0) return -1;
      if (found < 0 || found - any > 8) found = any;
      score += (found === prev + 1 ? 3 : 1) + (isBoundary(t, found) ? 2 : 0) - Math.min(3, (found - ti) * 0.2);
      prev = found;
      ti = found + 1;
    }
    return score;
  }

  /**
   * Rank `index` for `query`. An empty query lists actions, views and the
   * soonest work (by boost).
   * @param {Entry[]} index @param {string} query
   */
  function search(index, query, limit = 40) {
    const q = query.trim();
    const scored = [];
    for (const e of index) {
      const titleScore = fuzzy(q, e.title);
      const fullScore = titleScore >= 0 ? titleScore : fuzzy(q, `${e.title} ${e.sub || ''} ${e.keywords || ''}`) - 4;
      if (fullScore < 0 && q) continue;
      const kindBonus = /** @type {any} */ (KIND_ORDER)[e.kind] || 0;
      scored.push({ e, m: fullScore, s: (q ? fullScore : 0) + kindBonus + (e.boost || 0) });
    }
    // When some entries match well (a real substring), drop the scattered
    // subsequence matches: "pos" shouldn't list "Problem Set 10".
    const top = q ? Math.max(0, ...scored.map((x) => x.m)) : 0;
    const kept = top >= 15 ? scored.filter((x) => x.m >= top * 0.4) : scored;
    kept.sort((a, b) => b.s - a.s || a.e.title.localeCompare(b.e.title));
    return kept.slice(0, limit).map((x) => x.e);
  }

  /** Default actions and views. The UI maps `action` ids to functions. */
  function staticEntries(/** @type {any} */ settings) {
    /** @type {Entry[]} */
    const views = [
      { id: 'view:dashboard', kind: 'view', title: 'Dashboard', href: '#/', icon: 'home', sub: 'g d' },
      { id: 'view:assignments', kind: 'view', title: 'Assignments', href: '#/assignments', icon: 'tasks', sub: 'g a', keywords: 'assignment center todo' },
      { id: 'view:calendar', kind: 'view', title: 'Open calendar', href: '#/calendar', icon: 'calendar', sub: 'g c', keywords: 'calendar week month agenda schedule' },
      { id: 'view:grades', kind: 'view', title: 'Grades', href: '#/grades', icon: 'chart', sub: 'g g', keywords: 'gpa analytics scores' },
      { id: 'view:courses', kind: 'view', title: 'All courses', href: '#/courses', icon: 'book', sub: 'g o' },
      { id: 'view:settings', kind: 'view', title: 'Settings', href: '#/settings', icon: 'settings', sub: 'g s', keywords: 'preferences options accent density' },
      { id: 'view:overdue', kind: 'view', title: 'Overdue & missing work', href: '#/assignments?range=overdue', icon: 'alert', keywords: 'late missing' },
    ];
    /** @type {Entry[]} */
    const actions = [
      { id: 'act:theme', kind: 'action', title: settings?.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme', action: 'toggle-theme', icon: settings?.theme === 'light' ? 'moon' : 'sun', keywords: 'toggle theme dark light mode appearance' },
      { id: 'act:refresh', kind: 'action', title: 'Refresh from Canvas', action: 'refresh', icon: 'refresh', keywords: 'sync reload update' },
      { id: 'act:todo', kind: 'action', title: 'Add a to-do', action: 'add-todo', icon: 'note', keywords: 'new note planner task reminder' },
      { id: 'act:shortcuts', kind: 'action', title: 'Keyboard shortcuts', action: 'shortcuts', icon: 'grid', sub: '?', keywords: 'help keys hotkeys' },
      { id: 'act:classic', kind: 'action', title: 'Switch to classic Canvas dashboard', action: 'classic', icon: 'classic', keywords: 'old original' },
    ];
    return [...actions, ...views];
  }

  const TABS = /** @type {[string, string, string][]} */ ([
    ['assignments', 'Assignments', 'tasks'], ['modules', 'Modules', 'grid'], ['files', 'Files', 'folder'],
    ['announcements', 'Announcements', 'megaphone'], ['grades', 'Grades', 'chart'],
  ]);

  const KIND_ICON = /** @type {Record<string, string>} */ ({ assignment: 'assignment', quiz: 'quiz', discussion: 'discussion', page: 'page', note: 'note', peer_review: 'peerReview' });

  /**
   * Everything the palette can jump to.
   * @param {any} state  store state
   * @param {{ modules?: Record<string, any[]>, files?: { courseId: string, folderId: string, file: any }[] }} [extras]
   *   modules by course id; files from opened folders
   * @param {Date} [now]
   * @returns {Entry[]}
   */
  function buildIndex(state, extras = {}, now = new Date()) {
    const D = Gesso.derive;
    const data = state.data || {};
    const courses = D.visibleCourses(data, state.settings?.hiddenCourses || []);
    const byId = new Map(courses.map((/** @type {any} */ c) => [c.id, c]));
    const label = (/** @type {any} */ c) => (c ? c.code || D.courseTitle(c) : 'Personal');
    /** @type {Entry[]} */
    const out = staticEntries(state.settings);

    for (const c of courses) {
      const title = D.courseTitle(c);
      out.push({ id: `course:${c.id}`, kind: 'course', title: c.code && c.code !== title ? `${c.code} — ${title}` : title, href: `#/courses/${c.id}`, icon: 'book', color: c.color, keywords: c.originalName || '' });
      for (const [tab, name, icon] of TABS) {
        out.push({ id: `tab:${c.id}:${tab}`, kind: 'tab', title: `${label(c)} ${name}`, href: `#/courses/${c.id}/${tab}`, icon, color: c.color });
      }
    }

    // Work items. Upcoming, undone work ranks higher for empty and short queries.
    const items = D.workItems(data, state.settings?.hiddenCourses || []);
    const seenAssignments = new Set();
    for (const i of items) {
      const href = D.itemHref(i);
      const due = Gesso.time.toDate(i.dueAt);
      const hours = due ? (due.getTime() - now.getTime()) / 3_600_000 : null;
      const upcoming = hours != null && hours > -24 && hours < 24 * 14 && !D.isDone(i);
      if (i.assignmentId) seenAssignments.add(i.assignmentId);
      out.push({
        id: `item:${i.key}`, kind: 'item', title: i.title,
        sub: [label(byId.get(i.courseId)), due ? Gesso.time.dueLabel(due) : ''].filter(Boolean).join(' · '),
        href: href || undefined, action: !href && i.kind === 'note' ? `edit-todo:${i.key}` : undefined,
        icon: KIND_ICON[i.kind] || 'assignment', color: byId.get(i.courseId)?.color,
        keywords: i.kind === 'note' ? 'to-do todo note' : i.kind,
        boost: upcoming ? 6 - Math.max(0, /** @type {number} */ (hours)) / 48 : 0,
      });
    }

    // Module items (pages, external links, files) from loaded modules.
    for (const [courseId, modules] of Object.entries(extras.modules || {})) {
      const c = byId.get(courseId);
      if (!c) continue;
      const assignments = data.coursework?.[courseId]?.assignments || [];
      for (const m of modules || []) {
        out.push({ id: `module:${courseId}:${m.id}`, kind: 'module', title: m.name, sub: `${label(c)} · Module`, href: `#/courses/${courseId}/modules`, icon: 'grid', color: c.color });
        for (const it of m.items || []) {
          if (it.type === 'SubHeader' || !it.url) continue;
          // Assignments are already listed as work items.
          if (it.type === 'Assignment' && it.contentId && seenAssignments.has(it.contentId)) continue;
          const asg = it.type === 'Quiz' ? assignments.find((/** @type {any} */ a) => a.quizId === it.contentId)
            : it.type === 'Discussion' ? assignments.find((/** @type {any} */ a) => a.discussionId === it.contentId) : null;
          if (asg && seenAssignments.has(asg.id)) continue;
          out.push({
            id: `mitem:${courseId}:${it.id}`, kind: it.type === 'Page' ? 'page' : 'module', title: it.title,
            sub: `${label(c)} · ${m.name}`, href: it.url, icon: it.type === 'Page' ? 'page' : it.type === 'File' ? 'file' : it.type === 'ExternalUrl' ? 'link' : 'fileText', color: c.color,
            keywords: it.type,
          });
        }
      }
    }

    for (const f of extras.files || []) {
      const c = byId.get(f.courseId);
      if (!c) continue;
      out.push({ id: `file:${f.file.id}`, kind: 'file', title: f.file.name, sub: `${label(c)} · Files`, href: `#/courses/${f.courseId}/files/${f.folderId}`, icon: 'file', color: c.color, keywords: 'file' });
    }

    for (const a of (data.announcements || []).slice(0, 40)) {
      const c = byId.get(a.courseId);
      if (!c) continue;
      out.push({ id: `ann:${a.id}`, kind: 'announcement', title: a.title, sub: `${label(c)} · Announcement`, href: `#/courses/${a.courseId}/announcements/${a.id}`, icon: 'megaphone', color: c.color, keywords: 'announcement' });
    }

    // Duplicate ids can't happen by construction except module items listed twice; keep the first.
    const seen = new Set();
    return out.filter((e) => !seen.has(e.id) && seen.add(e.id));
  }

  Gesso.search = { fuzzy, search, buildIndex, staticEntries };
})();
