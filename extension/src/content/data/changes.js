// @ts-check
/**
 * "What's new since your last visit".
 *
 * How it works:
 *  1. Every sync compares the previous cached snapshot with fresh data and
 *     emits FeedEvents (new grade, new/changed assignment, new announcement).
 *  2. Events accumulate in a persistent feed (cache.feed), deduped by id.
 *  3. A "visit" is a run of activity with no gap longer than 30 min. Events
 *     detected during the current visit are "new"; older ones show under
 *     "Earlier". "Mark all seen" hides everything detected so far.
 *
 * On the very first sync there's no baseline, so we seed the feed with grades
 * and unread announcements from the past 7 days.
 */
(() => {
  const { DAY, toDate } = Gesso.time;
  const FEED_MAX = 150;
  const FEED_MAX_AGE = 45 * DAY;

  /**
   * @typedef {Object} FeedEvent
   * @property {string} id            Dedupe key
   * @property {'grade'|'assignment_new'|'assignment_changed'|'announcement'} type
   * @property {string|null} courseId
   * @property {string} title
   * @property {string|null} url
   * @property {string|null} at       When it happened in Canvas (ISO), if known
   * @property {number} detectedAt    When we noticed (ms)
   * @property {any} detail
   */

  const isGraded = (/** @type {any} */ s) => !!s && s.state === 'graded' && (s.score != null || s.grade != null);

  /** @returns {FeedEvent} */
  function gradeEvent(/** @type {any} */ a, now = Date.now()) {
    const s = a.submission;
    return {
      id: `grade:${a.id}:${s.score}:${s.grade}`,
      type: 'grade',
      courseId: a.courseId,
      assignmentId: a.id,
      title: a.name,
      url: a.url,
      at: s.gradedAt,
      detectedAt: now,
      detail: { score: s.score, grade: s.grade, points: a.points, gradingType: a.gradingType },
    };
  }

  /** @returns {FeedEvent[]} */
  function diffCoursework(/** @type {any} */ prev, /** @type {any} */ next, now = Date.now()) {
    /** @type {FeedEvent[]} */
    const events = [];
    if (!prev || !next) return events;
    for (const [courseId, cw] of Object.entries(next)) {
      const before = prev[courseId];
      if (!before) continue; // no baseline for this course yet
      const prevById = new Map(before.assignments.map((/** @type {any} */ a) => [a.id, a]));
      for (const a of /** @type {any} */ (cw).assignments) {
        const p = prevById.get(a.id);
        if (!p) {
          events.push({
            id: `new:${a.id}`, type: 'assignment_new', courseId, assignmentId: a.id, title: a.name, url: a.url,
            at: null, detectedAt: now, detail: { dueAt: a.dueAt, points: a.points },
          });
          continue;
        }
        const s = a.submission;
        const ps = p.submission;
        if (isGraded(s) && (!isGraded(ps) || ps.score !== s.score || ps.grade !== s.grade)) {
          events.push(gradeEvent(a, now));
        }
        /** @type {Record<string, {from:any,to:any}>} */
        const changes = {};
        if (p.dueAt !== a.dueAt) changes.dueAt = { from: p.dueAt, to: a.dueAt };
        if (p.points !== a.points) changes.points = { from: p.points, to: a.points };
        if (Object.keys(changes).length) {
          events.push({
            id: `changed:${a.id}:${a.dueAt}:${a.points}`, type: 'assignment_changed', courseId, assignmentId: a.id, title: a.name,
            url: a.url, at: null, detectedAt: now, detail: changes,
          });
        }
      }
    }
    return events;
  }

  /** @returns {FeedEvent} */
  function announcementEvent(/** @type {any} */ a, now = Date.now()) {
    return {
      id: `ann:${a.id}`, type: 'announcement', courseId: a.courseId, title: a.title, url: a.url,
      at: a.postedAt, detectedAt: now, detail: { author: a.author },
    };
  }

  /** @returns {FeedEvent[]} */
  function diffAnnouncements(/** @type {any[]|null} */ prev, /** @type {any[]} */ next, now = Date.now()) {
    if (!prev || !next) return [];
    const seen = new Set(prev.map((a) => a.id));
    return next.filter((a) => !seen.has(a.id)).map((a) => announcementEvent(a, now));
  }

  /** First-run seed: recent grades + unread recent announcements. */
  function seed(/** @type {any} */ data, now = Date.now()) {
    const since = now - 7 * DAY;
    /** @type {FeedEvent[]} */
    const events = [];
    for (const cw of Object.values(data.coursework || {})) {
      for (const a of /** @type {any} */ (cw).assignments) {
        const gradedAt = toDate(a.submission?.gradedAt)?.getTime() ?? 0;
        if (isGraded(a.submission) && gradedAt >= since) events.push(gradeEvent(a, now));
      }
    }
    for (const a of data.announcements || []) {
      const posted = toDate(a.postedAt)?.getTime() ?? 0;
      if (!a.read && posted >= since) events.push(announcementEvent(a, now));
    }
    return events;
  }

  /** Merge new events into the feed, keeping the first detection time. */
  function mergeFeed(/** @type {FeedEvent[]|null} */ feed, /** @type {FeedEvent[]} */ events, now = Date.now()) {
    const byId = new Map((feed || []).map((e) => [e.id, e]));
    for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()]
      .filter((e) => now - e.detectedAt < FEED_MAX_AGE)
      .sort((a, b) => b.detectedAt - a.detectedAt || (toDate(b.at)?.getTime() ?? 0) - (toDate(a.at)?.getTime() ?? 0))
      .slice(0, FEED_MAX);
  }

  /** Start a new visit after a long gap, otherwise extend the current one. */
  function touchVisit(/** @type {any} */ visit, now = Date.now()) {
    if (!visit || now - visit.lastActive > Gesso.config.visitGapMs) {
      return { sessionStart: now, lastActive: now, clearedAt: visit?.clearedAt ?? 0 };
    }
    return { ...visit, lastActive: now };
  }

  /** Split the feed for display. */
  function splitFeed(/** @type {FeedEvent[]|null} */ feed, /** @type {any} */ visit) {
    const start = visit?.sessionStart ?? 0;
    const cleared = visit?.clearedAt ?? 0;
    const all = feed || [];
    const fresh = all.filter((e) => e.detectedAt >= start && e.detectedAt > cleared);
    const earlier = all.filter((e) => !fresh.includes(e)).slice(0, 6);
    return { fresh, earlier };
  }

  /**
   * Where a feed event opens: announcements and assignments open in the
   * Gesso. Events stored before `assignmentId` existed recover it from the id.
   */
  function feedHref(/** @type {FeedEvent & { assignmentId?: string }} */ e) {
    if (!e.courseId) return e.url;
    if (e.type === 'announcement') return `#/courses/${e.courseId}/announcements/${String(e.id).replace(/^ann:/, '')}`;
    const aid = e.assignmentId || (String(e.id).match(/^(?:grade|new|changed):(\d+)/) || [])[1];
    return aid ? Gesso.derive.assignmentHref(e.courseId, aid) : e.url;
  }

  Gesso.changes = { feedHref, diffCoursework, diffAnnouncements, seed, mergeFeed, touchVisit, splitFeed };
})();
