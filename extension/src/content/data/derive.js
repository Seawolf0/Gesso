// @ts-check
/**
 * Pure selectors: state → what the views show. No I/O, no DOM — which also
 * makes them easy to test (see dev/tests).
 */
(() => {
  const { HOUR, DAY, toDate, startOfDay, addDays } = Gesso.time;

  /**
   * One row of "work" regardless of where Canvas keeps it.
   * @typedef {Object} WorkItem
   * @property {string} key
   * @property {'assignment'|'quiz'|'discussion'|'page'|'note'|'peer_review'} kind
   * @property {string|null} courseId
   * @property {string} title
   * @property {string|null} url
   * @property {string|null} dueAt
   * @property {number|null} points
   * @property {'not_submitted'|'submitted'|'graded'|'late'|'missing'|'excused'|'none'} status
   * @property {boolean} late
   * @property {boolean} markedComplete   Checked off in Canvas's planner
   * @property {boolean} gradePending
   * @property {string|null} assignmentId
   * @property {{ id: string, type: string, overrideId: string|null }|null} plannable  For planner overrides
   * @property {number|null} score
   * @property {string|null} grade
   * @property {string} gradingType
   * @property {string|null} groupId       Assignment group (assignments only)
   * @property {boolean} locked
   * @property {string|null} staleDueAt     Canvas's date when it's a leftover from a past term (then dueAt is null)
   * @property {string} dateSource          Which Canvas field the date came from (shown in #/debug)
   * @property {Record<string,string>|null} rawDates
   * @property {string|null} [quizId]        Classic quiz id (planner override target when no planner record)
   * @property {string|null} [discussionId]  Graded discussion's topic id (same)
   * @property {string|null} [snoozedUntil]  yyyy-mm-dd the item comes back (a Gesso snooze note in Canvas)
   * @property {string|null} [details]       Notes only: the note's text
   */

  const DONE_STATUSES = new Set(['submitted', 'graded', 'excused', 'late']);

  /** @param {WorkItem} item */
  const isDone = (item) => item.markedComplete || DONE_STATUSES.has(item.status);

  /** All active courses in Canvas dashboard order (hidden ones included). */
  function sortedCourses(/** @type {any} */ data) {
    const courses = /** @type {any[]} */ (data.courses || []);
    return [...courses].sort((a, b) => {
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      return pa - pb || a.name.localeCompare(b.name);
    });
  }

  /**
   * Clean up registrar-style Canvas course names for display:
   *   "CSCI110-0101,0102,0103,…"                         → "CSCI110"
   *   "SCHL100-0101: Honors Program: Leadership …"     → "Honors Program: Leadership …"
   *   "CIVC201S-0101: Civic Leadership and Public Life-Fall 2026" → "Civic Leadership and Public Life"
   * Names that don't follow the pattern are returned unchanged.
   */
  function cleanCourseName(/** @type {string} */ name) {
    const original = String(name || '').trim();
    let s = original;
    // 1) Section-number list after the course code: "CODE-0101,0102,…" → "CODE"
    s = s.replace(/^([A-Z]{2,6}\s?\d{3}[A-Z]{0,2}(?:\/[A-Z]{2,6}\s?\d{3}[A-Z]{0,2})*)[-_ ]\d{3,4}(?:\s*[,/]\s*\d{1,4})*(?:\s*,?\s*(?:\.{3}|…))?/, '$1');
    // 2) Leading course code before a real title: "CODE: Title" / "CODE - Title" → "Title"
    const m = s.match(/^[A-Z]{2,6}\s?\d{3}[A-Z]{0,2}\s*(?::|\s[-–—]\s)\s*(.{3,})$/);
    if (m) s = m[1].trim();
    // 3) Trailing term: "-Fall 2026", " (Spring 2027)"
    s = s.replace(/\s*[-–—,(]?\s*(?:Fall|Spring|Summer|Winter)\s+\d{4}\)?\s*$/i, '').trim();
    return s || original;
  }

  /** Display title: the user's nickname if they set one, else the cleaned Canvas name. */
  function courseTitle(/** @type {any} */ course) {
    if (!course) return '';
    const hasNickname = course.originalName && course.name !== course.originalName;
    return hasNickname ? course.name : cleanCourseName(course.originalName || course.name);
  }

  /** Tooltip with the full Canvas name, when the displayed title differs from it. */
  function courseTooltip(/** @type {any} */ course) {
    const full = course?.originalName || course?.name || '';
    return full && full !== courseTitle(course) ? full : undefined;
  }

  // ---------------------------------------------------------------------------
  // Links: the single place that decides where an item opens.
  // ---------------------------------------------------------------------------

  /** Gesso route (with "#") for an ungraded discussion's summary view. */
  function discussionHref(/** @type {string} */ courseId, /** @type {string} */ topicId) {
    return `#/courses/${courseId}/discussions/${topicId}`;
  }

  /** Gesso route (with "#") for an assignment's detail view. */
  function assignmentHref(/** @type {string} */ courseId, /** @type {string} */ assignmentId) {
    return `#/courses/${courseId}/assignments/${assignmentId}`;
  }

  /**
   * Where a WorkItem opens. Anything backed by a Canvas assignment (incl.
   * graded quizzes/discussions) → the Gesso detail view. Ungraded
   * discussions → the Gesso discussion summary. Peer reviews → the Gesso
   * peer-review summary. Ungraded quizzes, pages → native Canvas. Notes →
   * nowhere (null).
   */
  function itemHref(/** @type {any} */ item) {
    if (item.assignmentId && item.courseId) return assignmentHref(item.courseId, item.assignmentId);
    if (item.kind === 'discussion' && item.courseId && item.plannable?.id) return discussionHref(item.courseId, item.plannable.id);
    if (item.kind === 'peer_review') return peerReviewHref(item) || item.url || null;
    return item.url || null;
  }

  /**
   * Has the course ended? Canvas says so (`concluded`), or the course's (or
   * else its term's) end date has passed. Used for wording only: Canvas
   * decides what a student may still do in it.
   */
  function courseEnded(/** @type {any} */ course, now = new Date()) {
    if (!course) return false;
    if (course.concluded) return true;
    const end = toDate(course.endAt) || toDate(course.termEnd);
    return !!end && end.getTime() < now.getTime();
  }

  /** Courses shown in Gesso: dashboard order, minus ones the user hid. */
  function visibleCourses(/** @type {any} */ data, /** @type {string[]} */ hidden = []) {
    const h = new Set(hidden);
    return sortedCourses(data).filter((c) => !h.has(c.id));
  }

  /**
   * Is this due date a leftover from a previous offering of the course?
   * Instructors copy courses between terms; items whose dates weren't updated
   * keep e.g. a 2024 due date in a Fall 2026 course. Such a date is "stale"
   * if it falls more than 14 days before the term starts (or the course
   * starts, or — when Canvas gives neither — more than a year ago).
   */
  function isStaleDate(/** @type {string|null} */ iso, /** @type {any} */ course, now = new Date()) {
    const due = toDate(iso);
    if (!due || !course) return false;
    const start = toDate(course.termStart) || toDate(course.startAt);
    const floor = start ? start.getTime() : now.getTime() - 365 * DAY;
    return due.getTime() < floor - 14 * DAY;
  }

  /** Status of a planner item that isn't a graded assignment. */
  function plannerStatus(/** @type {any} */ p) {
    const s = p.submission;
    if (!s) return 'none';
    if (s.excused) return 'excused';
    if (s.graded) return 'graded';
    if (s.missing) return 'missing';
    if (s.submitted) return s.late ? 'late' : 'submitted';
    return 'not_submitted';
  }

  /**
   * Merge assignments (authoritative for grades/points/status) with planner
   * items (authoritative for "marked done" and for things that aren't
   * assignments: ungraded quizzes/discussions, pages with to-do dates, notes).
   * @returns {WorkItem[]}
   */
  function workItems(/** @type {any} */ data, /** @type {string[]} */ hidden = []) {
    const h = new Set(hidden);
    const activeCourseIds = new Set((data.courses || []).map((/** @type {any} */ c) => c.id).filter((/** @type {string} */ id) => !h.has(id)));
    const courseById = new Map((data.courses || []).map((/** @type {any} */ c) => [c.id, c]));
    const now = new Date();
    /** A stale (past-term) date is treated as "no current due date" everywhere. */
    const dates = (/** @type {string|null} */ iso, /** @type {string|null} */ courseId) => {
      const stale = isStaleDate(iso, courseById.get(courseId), now);
      return { dueAt: stale ? null : iso, staleDueAt: stale ? iso : null };
    };
    /** @type {Map<string, WorkItem>} */
    const items = new Map();

    for (const [courseId, cw] of Object.entries(data.coursework || {})) {
      if (!activeCourseIds.has(courseId)) continue;
      for (const a of /** @type {any} */ (cw).assignments || []) {
        items.set(`assignment:${a.id}`, {
          key: `assignment:${a.id}`,
          kind: a.kind,
          courseId,
          title: a.name,
          url: a.url,
          ...dates(a.dueAt, courseId),
          dateSource: 'assignment.due_at',
          rawDates: a.dueAt ? { due_at: a.dueAt } : null,
          points: a.points,
          status: a.status,
          late: !!a.submission?.late,
          markedComplete: false,
          gradePending: a.gradePending,
          assignmentId: a.id,
          plannable: null,
          score: a.submission?.score ?? null,
          grade: a.submission?.grade ?? null,
          gradingType: a.gradingType,
          groupId: a.groupId,
          locked: a.locked,
          quizId: a.quizId || null,
          discussionId: a.discussionId || null,
        });
      }
    }

    const snoozeNoteIds = new Set((data.notes || []).filter((/** @type {any} */ n) => n.snooze).map((/** @type {any} */ n) => n.id));
    for (const p of data.planner || []) {
      if (p.type === 'event' || p.type === 'announcement' || p.type === 'other') continue;
      if (p.type === 'note' && (p.snooze || snoozeNoteIds.has(p.id))) continue; // a snooze, not a to-do
      if (p.courseId && !activeCourseIds.has(p.courseId)) continue;
      const plannable = { id: p.id, type: p.plannableType, overrideId: p.override?.id || null };
      const existing = p.assignmentId ? items.get(`assignment:${p.assignmentId}`) : null;
      if (existing) {
        existing.markedComplete = !!p.override?.done;
        existing.plannable = plannable;
        continue;
      }
      if (p.type === 'peer_review') {
        items.set(p.key, peerReviewItem(p, plannable, data));
        continue;
      }
      items.set(p.key, {
        key: p.key,
        kind: p.type,
        courseId: p.courseId,
        title: p.title,
        url: p.url,
        ...dates(p.date, p.courseId),
        dateSource: p.dateSource ? `planner ${p.dateSource}` : 'planner',
        rawDates: p.rawDates || null,
        points: p.points,
        status: /** @type {any} */ (plannerStatus(p)),
        late: !!p.submission?.late,
        markedComplete: !!p.override?.done,
        gradePending: false,
        assignmentId: p.assignmentId,
        plannable,
        score: null,
        grade: null,
        gradingType: 'points',
        groupId: null,
        locked: false,
        details: p.details || null,
      });
    }

    // Notes from planner_notes (a wider window than planner/items; also notes
    // just created here). Snooze notes aren't to-dos.
    for (const n of data.notes || []) {
      if (n.snooze || n.deleted || items.has(`note:${n.id}`)) continue;
      if (n.courseId && !activeCourseIds.has(n.courseId)) continue;
      items.set(`note:${n.id}`, {
        key: `note:${n.id}`, kind: 'note', courseId: n.courseId, title: n.title, url: null,
        ...dates(n.todoDate, n.courseId), dateSource: 'planner_notes todo_date', rawDates: n.todoDate ? { todo_date: n.todoDate } : null,
        points: null, status: 'none', late: false, markedComplete: false, gradePending: false, assignmentId: null,
        plannable: { id: n.id, type: 'planner_note', overrideId: null },
        score: null, grade: null, gradingType: 'points', groupId: null, locked: false, details: n.details,
      });
    }

    // Done state from the overrides list (authoritative, covers every date)
    // and snoozes from linked notes. Both written by data/planner.js.
    const P = Gesso.planner;
    if (P) {
      const ovIndex = data.overrides ? P.overrideIndex(data.overrides) : null;
      const snIndex = P.snoozeIndex(data.notes);
      for (const item of items.values()) {
        const ov = ovIndex && P.overrideFor(item, ovIndex);
        if (ov) item.markedComplete = ov.done;
        const sn = P.snoozeFor(item, snIndex);
        item.snoozedUntil = sn ? P.noteDay(sn.todoDate) : null;
      }
    }
    return [...items.values()];
  }

  /** Hidden by a snooze right now. */
  const isSnoozed = (/** @type {WorkItem} */ item, now = new Date()) => !!Gesso.planner?.isSnoozed(item, now);

  // ---------------------------------------------------------------------------
  // Peer reviews
  // ---------------------------------------------------------------------------

  const STOP = new Set(['peer', 'review', 'reviews', 'the', 'a', 'an', 'of', 'and', 'for', 'to', 'draft', 'final']);
  const tokens = (/** @type {string} */ s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((t) => t && !STOP.has(t));

  /**
   * A separate assignment the instructor created for the peer-review step,
   * e.g. "Policy Brief Peer Review" for parent "Policy Brief Draft":
   * its name says "peer review" and all its other words appear in the
   * parent's name. Returns it only if exactly one matches.
   */
  function relatedPeerReviewAssignment(/** @type {any} */ parent, /** @type {any[]} */ assignments) {
    if (!parent) return null;
    const parentTokens = new Set(tokens(parent.name));
    const hits = assignments.filter((a) => {
      if (a.id === parent.id || !/peer[\s-]*review/i.test(a.name)) return false;
      const core = tokens(a.name);
      return core.length > 0 && core.every((t) => parentTokens.has(t));
    });
    return hits.length === 1 ? hits[0] : null;
  }

  /** Exact name match, ignoring only case/punctuation ("Draft" matters here). */
  const normName = (/** @type {string} */ s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sameName = (/** @type {string} */ a, /** @type {string} */ b) => !!normName(a) && normName(a) === normName(b);

  /**
   * Which assignment a peer review belongs to. Derived from the item itself
   * at render time (not only from the cached `review` field), so cache shape
   * changes can't break it:
   *   1. the id in `p.review` / the item URL (any /courses/:c/assignments/:a shape)
   *   2. else an assignment in the course with the same name as the planner title
   * @returns {{ info: any, parent: any|null, trace: string[] }}
   */
  function resolvePeerReviewParent(/** @type {any} */ p, /** @type {any[]} */ assignments) {
    const trace = [];
    const fromUrl = Gesso.normalize.peerReviewFromUrl(p.url);
    const info = { ...fromUrl, ...(p.review || {}) };
    if (!info.parentAssignmentId && fromUrl.parentAssignmentId) Object.assign(info, { parentAssignmentId: fromUrl.parentAssignmentId, parentVia: fromUrl.parentVia });
    if (!info.revieweeId) info.revieweeId = fromUrl.revieweeId;
    let parent = info.parentAssignmentId ? assignments.find((a) => a.id === info.parentAssignmentId) || null : null;
    if (info.parentAssignmentId) {
      trace.push(parent
        ? `parent: assignment ${info.parentAssignmentId} "${parent.name}" (from ${info.parentVia || 'item'})`
        : `parent: id ${info.parentAssignmentId} (from ${info.parentVia || 'item'}) not in synced coursework`);
    } else {
      trace.push(`parent: no assignment id in the item (url: ${p.url || 'none'})`);
    }
    if (!parent) {
      const byName = assignments.filter((a) => sameName(a.name, p.title));
      if (byName.length === 1) {
        parent = byName[0];
        info.parentAssignmentId = parent.id;
        info.parentVia = 'name match';
        trace.push(`parent: matched by name → assignment ${parent.id} "${parent.name}"`);
      } else {
        trace.push(byName.length ? `parent: ${byName.length} assignments named "${p.title}" — ambiguous` : `parent: no assignment named "${p.title}"`);
      }
    }
    return { info, parent, trace };
  }

  /**
   * Due date for a peer review, best source first, with a trace of every step
   * (shown in #/debug):
   *  1. the parent assignment's peer-review due date (peer_reviews_assign_at)
   *  2. the parent's peer-review sub-assignment due date
   *  3. a related "… Peer Review" assignment's due date
   *  4. the planner's own date
   * Dates from before the term (copied-course leftovers) are skipped.
   * @returns {{ dueAt: string|null, staleDueAt: string|null, dateSource: string, related: any|null, info: any, trace: string[] }}
   */
  function peerReviewDue(/** @type {any} */ p, /** @type {any} */ course, /** @type {any} */ cw) {
    const assignments = cw?.assignments || [];
    const { info, parent, trace } = resolvePeerReviewParent(p, assignments);
    // Related "… Peer Review" assignment: compare against the parent's name, or
    // the planner title when the parent isn't known.
    const related = relatedPeerReviewAssignment(parent || { id: null, name: p.title }, assignments);
    const fmt = (/** @type {string|null|undefined} */ iso) => (iso ? `${iso}${isStaleDate(iso, course) ? ' (stale: before term start)' : ''}` : 'none');
    const candidates = /** @type {[string, string|null|undefined, string][]} */ ([
      ['assignment peer_reviews_assign_at', parent?.peerReviewsDueAt, parent ? fmt(parent.peerReviewsDueAt) : 'no parent'],
      ['assignment peer-review sub-assignment', parent?.peerReviewSubDueAt, parent ? fmt(parent.peerReviewSubDueAt) : 'no parent'],
      [related ? `related assignment "${related.name}"` : 'related assignment', related?.dueAt,
        related ? fmt(related.dueAt) : `no unique "… Peer Review" assignment matching "${parent?.name || p.title}"`],
      [`planner ${p.dateSource || ''}`.trim(), p.date, fmt(p.date)],
    ]);
    for (const [source, iso, why] of candidates) {
      const ok = !!iso && !isStaleDate(iso, course);
      trace.push(`${ok ? '✓' : '✗'} ${source}: ${why}`);
      if (ok) return { dueAt: /** @type {string} */ (iso), staleDueAt: null, dateSource: source, related, info, trace };
    }
    return { dueAt: null, staleDueAt: p.date && isStaleDate(p.date, course) ? p.date : null, dateSource: `planner ${p.dateSource || ''}`.trim(), related, info, trace };
  }

  /** WorkItem for a peer-review planner item (labelled, dated, linked). */
  function peerReviewItem(/** @type {any} */ p, /** @type {any} */ plannable, /** @type {any} */ data) {
    const course = (data.courses || []).find((/** @type {any} */ c) => c.id === p.courseId);
    const due = peerReviewDue(p, course, data.coursework?.[p.courseId]);
    return {
      key: p.key,
      kind: 'peer_review',
      courseId: p.courseId,
      title: `Peer review: ${p.title}`,
      url: p.url,
      dueAt: due.dueAt,
      staleDueAt: due.staleDueAt,
      dateSource: due.dateSource,
      rawDates: p.rawDates || null,
      points: null,
      status: /** @type {any} */ (due.info.done ? 'submitted' : 'not_submitted'),
      late: false,
      markedComplete: !!p.override?.done,
      gradePending: false,
      assignmentId: null,
      plannable,
      score: null,
      grade: null,
      gradingType: 'points',
      groupId: null,
      locked: false,
      review: { ...due.info, relatedAssignmentId: due.related?.id || null },
      resolution: due.trace, // shown in #/debug
    };
  }

  /** Gesso route for a peer review summary. */
  function peerReviewHref(/** @type {any} */ item) {
    const r = item.review;
    if (!r?.parentAssignmentId || !item.courseId) return null;
    const q = new URLSearchParams();
    if (item.plannable?.id) q.set('request', item.plannable.id);
    if (r.revieweeId) q.set('reviewee', r.revieweeId);
    if (r.anonymousId) q.set('anon', r.anonymousId);
    return `#/courses/${item.courseId}/peer-reviews/${r.parentAssignmentId}${q.toString() ? `?${q}` : ''}`;
  }

  /** 'overdue' | 'critical' (<24h) | 'high' (<48h) | 'medium' (<4d) | 'low' */
  function urgency(/** @type {WorkItem} */ item, now = new Date()) {
    const due = toDate(item.dueAt);
    if (!due) return 'low';
    const hours = (due.getTime() - now.getTime()) / HOUR;
    if (hours < 0) return 'overdue';
    if (hours < 24) return 'critical';
    if (hours < 48) return 'high';
    if (hours < 96) return 'medium';
    return 'low';
  }

  const byDue = (/** @type {WorkItem} */ a, /** @type {WorkItem} */ b) =>
    (toDate(a.dueAt)?.getTime() ?? Infinity) - (toDate(b.dueAt)?.getTime() ?? Infinity) || a.title.localeCompare(b.title);

  /**
   * Items due from now through the end of day `days` from today.
   * @returns {{ todo: WorkItem[], done: WorkItem[], snoozed: WorkItem[] }}
   */
  function dueSoon(/** @type {WorkItem[]} */ items, days = 7, now = new Date()) {
    const end = addDays(startOfDay(now), days + 1).getTime();
    const inWindow = items.filter((i) => {
      const t = toDate(i.dueAt)?.getTime();
      return t != null && t >= now.getTime() && t < end;
    }).sort(byDue);
    return {
      todo: inWindow.filter((i) => !isDone(i) && !isSnoozed(i, now)),
      done: inWindow.filter(isDone),
      snoozed: inWindow.filter((i) => !isDone(i) && isSnoozed(i, now)),
    };
  }

  /**
   * Past-due work that still needs attention: anything Canvas flags missing,
   * plus unsubmitted work from the last 14 days (Canvas may not flag those yet).
   */
  function overdue(/** @type {WorkItem[]} */ items, now = new Date()) {
    const recent = now.getTime() - 14 * DAY;
    return items.filter((i) => {
      if (isDone(i) || isSnoozed(i, now)) return false;
      const t = toDate(i.dueAt)?.getTime();
      if (t == null || t >= now.getTime()) return false;
      return i.status === 'missing' || (i.status === 'not_submitted' && t >= recent);
    }).sort(byDue).reverse();
  }

  /** Group items by local day → [{ day: Date, items }]. */
  function groupByDay(/** @type {WorkItem[]} */ items) {
    /** @type {Map<string, { day: Date, items: WorkItem[] }>} */
    const groups = new Map();
    for (const item of items) {
      const d = toDate(item.dueAt);
      if (!d) continue;
      const k = Gesso.time.dayKey(d);
      if (!groups.has(k)) groups.set(k, { day: startOfDay(d), items: [] });
      /** @type {any} */ (groups.get(k)).items.push(item);
    }
    return [...groups.values()];
  }

  /**
   * How to display a course's grade on the dashboard.
   * @returns {{ primary: string, secondary: string, score: number|null, tone: 'good'|'ok'|'warn'|'bad'|'none' }}
   */
  function gradeDisplay(/** @type {any} */ course) {
    if (course.role !== 'student') return { primary: cap(course.role), secondary: '', score: null, tone: 'none' };
    if (course.hideFinalGrades) return { primary: 'Hidden', secondary: 'Totals hidden by instructor', score: null, tone: 'none' };
    const { score, letter, periodTitle } = course.grade;
    if (score == null) return { primary: '—', secondary: 'No grades yet', score: null, tone: 'none' };
    const pct = `${round1(score)}%`;
    const tone = score >= 90 ? 'good' : score >= 80 ? 'ok' : score >= 70 ? 'warn' : 'bad';
    return { primary: letter || pct, secondary: letter ? pct : (periodTitle || ''), score, tone };
  }

  const round1 = (/** @type {number} */ n) => (Math.round(n * 10) / 10).toString();
  const cap = (/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** Announcements newest first, limited to active courses. */
  function recentAnnouncements(/** @type {any} */ data, limit = 6, /** @type {string[]} */ hidden = []) {
    const active = new Set(visibleCourses(data, hidden).map((/** @type {any} */ c) => c.id));
    return (data.announcements || [])
      .filter((/** @type {any} */ a) => !a.courseId || active.has(a.courseId))
      .sort((/** @type {any} */ a, /** @type {any} */ b) => (toDate(b.postedAt)?.getTime() ?? 0) - (toDate(a.postedAt)?.getTime() ?? 0))
      .slice(0, limit);
  }

  /** Next undone item per course (for course cards). */
  function nextDueByCourse(/** @type {WorkItem[]} */ items, now = new Date()) {
    /** @type {Map<string, WorkItem>} */
    const next = new Map();
    for (const i of [...items].sort(byDue)) {
      const t = toDate(i.dueAt)?.getTime();
      if (!i.courseId || t == null || t < now.getTime() || isDone(i) || isSnoozed(i, now)) continue;
      if (!next.has(i.courseId)) next.set(i.courseId, i);
    }
    return next;
  }

  Gesso.derive = {
    isDone, isSnoozed, isStaleDate, courseEnded, relatedPeerReviewAssignment, peerReviewDue, peerReviewHref, cleanCourseName, courseTitle, courseTooltip, assignmentHref, discussionHref, itemHref, sortedCourses, visibleCourses, workItems, urgency, dueSoon, overdue, groupByDay,
    gradeDisplay, recentAnnouncements, nextDueByCourse,
  };
})();
