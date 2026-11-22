// @ts-check
/**
 * Typed wrappers for the Canvas endpoints the app uses. Each returns raw API
 * objects; normalize.js turns them into the app's compact models.
 *
 * Every endpoint here was checked against https://canvas.instructure.com/doc/api
 * (Nov 2026). Notes on non-obvious choices are inline.
 */
(() => {
  const { get, getAll, write } = Gesso.api.client;
  const { isoDate, addDays } = Gesso.time;

  /** GET /api/v1/users/self — name, avatar, locale. */
  function getSelf() {
    return get('/api/v1/users/self');
  }

  /**
   * GET /api/v1/courses — the student's active courses with scores.
   * `total_scores` adds computed_current_score/grade to the enrollment;
   * `current_grading_period_scores` adds the current_period_* variants.
   * Canvas omits scores when the course hides final grades.
   */
  function getCourses() {
    return getAll('/api/v1/courses', {
      enrollment_state: 'active',
      'include[]': ['total_scores', 'current_grading_period_scores', 'course_image', 'term', 'concluded', 'favorites'],
    });
  }

  /** GET /api/v1/users/self/colors → { custom_colors: { course_42: "#abc123" } } */
  function getColors() {
    return get('/api/v1/users/self/colors');
  }

  /** GET /api/v1/users/self/dashboard_positions → { dashboard_positions: { course_42: 2 } } */
  function getDashboardPositions() {
    return get('/api/v1/users/self/dashboard_positions');
  }

  /**
   * GET /api/v1/courses/:id/assignment_groups with assignments + the student's
   * submission. `override_assignment_dates` (default true) means `due_at` is
   * already the date that applies to *this* student when overrides exist.
   */
  function getAssignmentGroups(/** @type {string} */ courseId) {
    return getAll(`/api/v1/courses/${encodeURIComponent(courseId)}/assignment_groups`, {
      // peer_review: the peer-review sub-assignment (due date) where that Canvas feature is on.
      'include[]': ['assignments', 'submission', 'peer_review'],
      override_assignment_dates: true,
    });
  }

  /**
   * GET /api/v1/planner/items — Canvas's own to-do model across all courses:
   * assignments, quizzes, discussions, pages, planner notes, calendar events,
   * each with submission flags and the user's planner_override (done state).
   */
  function getPlannerItems(/** @type {Date} */ start, /** @type {Date} */ end) {
    return getAll('/api/v1/planner/items', {
      start_date: start.toISOString(),
      end_date: end.toISOString(),
    });
  }

  /**
   * GET /api/v1/announcements for many courses. context_codes[] is required;
   * we batch them so the URL stays a reasonable length.
   */
  async function getAnnouncements(/** @type {string[]} */ courseIds, /** @type {number} */ days) {
    if (!courseIds.length) return [];
    const now = new Date();
    const batches = [];
    for (let i = 0; i < courseIds.length; i += 10) batches.push(courseIds.slice(i, i + 10));
    const results = await Promise.all(
      batches.map((ids) =>
        getAll('/api/v1/announcements', {
          'context_codes[]': ids.map((id) => `course_${id}`),
          start_date: isoDate(addDays(now, -days)),
          end_date: isoDate(addDays(now, 1)),
          active_only: true,
        }),
      ),
    );
    return results.flat();
  }

  /**
   * GET /api/v1/calendar_events (Calendar Events API, checked Nov 2026):
   * - `type=event` only: assignment deadlines come from synced coursework,
   *   which is authoritative for status/points.
   * - `context_codes[]` is "limited to 10 context codes, additional ones are
   *   ignored", so requests are batched by 10. Omitting it returns only the
   *   personal calendar, so `user_<id>` is passed explicitly.
   * - `start_date` and `end_date` are both inclusive (yyyy-mm-dd).
   * @param {string[]} contextCodes  e.g. ['course_42', 'user_7']
   * @param {Date} start @param {Date} end
   */
  async function getCalendarEvents(contextCodes, start, end) {
    if (!contextCodes.length) return [];
    const batches = [];
    for (let i = 0; i < contextCodes.length; i += 10) batches.push(contextCodes.slice(i, i + 10));
    const results = await Promise.all(batches.map((codes) => getAll('/api/v1/calendar_events', {
      type: 'event',
      'context_codes[]': codes,
      start_date: isoDate(start),
      end_date: isoDate(end),
    })));
    return results.flat();
  }

  // ---------------------------------------------------------------------------
  // Course workspace: fetched on demand, cached per course.
  // ---------------------------------------------------------------------------

  const cid = (/** @type {string} */ id) => encodeURIComponent(id);

  /**
   * GET /api/v1/courses/:id/modules with items + content_details (due dates,
   * points, locks). Canvas omits `items` for modules it deems too large —
   * those are filled in from the module's own items endpoint.
   */
  async function getModules(/** @type {string} */ courseId) {
    const modules = await getAll(`/api/v1/courses/${cid(courseId)}/modules`, {
      'include[]': ['items', 'content_details'],
    });
    await Promise.all(modules.map(async (/** @type {any} */ m) => {
      if (!Array.isArray(m.items) && m.items_count > 0) {
        m.items = await getAll(`/api/v1/courses/${cid(courseId)}/modules/${encodeURIComponent(m.id)}/items`, {
          'include[]': ['content_details'],
        });
      }
    }));
    return modules;
  }

  /** GET /api/v1/courses/:id/folders — every folder in the course, flat. */
  function getFolders(/** @type {string} */ courseId) {
    return getAll(`/api/v1/courses/${cid(courseId)}/folders`);
  }

  /** GET /api/v1/folders/:id/files — files directly inside one folder. */
  function getFolderFiles(/** @type {string} */ folderId) {
    return getAll(`/api/v1/folders/${encodeURIComponent(folderId)}/files`, { sort: 'name' });
  }

  /** GET /api/v1/courses/:id/files?search_term= — server-side name search across the course. */
  function searchFiles(/** @type {string} */ courseId, /** @type {string} */ term) {
    return getAll(`/api/v1/courses/${cid(courseId)}/files`, { search_term: term, sort: 'name' });
  }

  /** All announcements for one course over the past `days`. */
  function getCourseAnnouncements(/** @type {string} */ courseId, days = 365) {
    const now = new Date();
    return getAll('/api/v1/announcements', {
      'context_codes[]': [`course_${courseId}`],
      start_date: isoDate(addDays(now, -days)),
      end_date: isoDate(addDays(now, 1)),
      active_only: true,
    });
  }

  /**
   * GET /api/v1/courses/:course_id/assignments/:id — full assignment: HTML
   * description, dates (overrides applied for this student), rubric, lock
   * info, submission types, attempts.
   */
  function getAssignment(/** @type {string} */ courseId, /** @type {string} */ assignmentId) {
    return get(`/api/v1/courses/${cid(courseId)}/assignments/${encodeURIComponent(assignmentId)}`, {
      'include[]': ['submission'], // fallback status if the detailed submission call fails
      override_assignment_dates: true,
    });
  }

  /**
   * GET /api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id
   * with history, comments, and rubric assessment. Uses the numeric user id
   * (the docs don't promise that "self" works here).
   */
  function getMySubmission(/** @type {string} */ courseId, /** @type {string} */ assignmentId, /** @type {string} */ userId) {
    return get(`/api/v1/courses/${cid(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submissions/${encodeURIComponent(userId)}`, {
      'include[]': ['submission_history', 'submission_comments', 'rubric_assessment'],
    });
  }

  /**
   * GET /api/v1/courses/:course_id/assignments/:assignment_id/peer_reviews?include[]=user
   * (gives the reviewee's name). Student access isn't documented — callers
   * must tolerate `forbidden`.
   */
  function getPeerReviews(/** @type {string} */ courseId, /** @type {string} */ assignmentId) {
    return getAll(`/api/v1/courses/${cid(courseId)}/assignments/${encodeURIComponent(assignmentId)}/peer_reviews`, { 'include[]': ['user'] });
  }

  /** GET /api/v1/courses/:course_id/discussion_topics/:topic_id */
  function getDiscussionTopic(/** @type {string} */ courseId, /** @type {string} */ topicId) {
    return get(`/api/v1/courses/${cid(courseId)}/discussion_topics/${encodeURIComponent(topicId)}`);
  }

  // ---------------------------------------------------------------------------
  // Grades
  // ---------------------------------------------------------------------------

  /**
   * One grading period's assignment groups (Assignment Groups API):
   * `grading_period_id` + `scope_assignments_to_student` (student-only) let
   * Canvas decide which assignments belong to the period — by each
   * assignment's effective due date for this student, exactly as its grade
   * calculator does.
   */
  function getPeriodAssignmentGroups(/** @type {string} */ courseId, /** @type {string} */ periodId) {
    return getAll(`/api/v1/courses/${cid(courseId)}/assignment_groups`, {
      'include[]': ['assignments', 'submission'],
      override_assignment_dates: true,
      grading_period_id: periodId,
      scope_assignments_to_student: true,
    });
  }

  /**
   * GET /api/v1/courses/:course_id/grading_standards — "visible to the user".
   * Whether students may read it isn't documented; callers fall back to
   * Canvas's letter / default scheme on `forbidden`.
   */
  function getGradingStandards(/** @type {string} */ courseId) {
    return getAll(`/api/v1/courses/${cid(courseId)}/grading_standards`);
  }

  // ---------------------------------------------------------------------------
  // Writes (CSRF handled by the client). Each mirrors a Canvas setting, so the
  // change also shows up in Canvas itself and the Canvas mobile apps.
  // ---------------------------------------------------------------------------

  /** PUT /api/v1/courses/:course_id/discussion_topics/:topic_id/read → 204 */
  function markTopicRead(/** @type {string} */ courseId, /** @type {string} */ topicId) {
    return write('PUT', `/api/v1/courses/${cid(courseId)}/discussion_topics/${encodeURIComponent(topicId)}/read`);
  }

  /** PUT /api/v1/users/self/course_nicknames/:course_id (nickname: 1–59 chars) */
  function setNickname(/** @type {string} */ courseId, /** @type {string} */ nickname) {
    return write('PUT', `/api/v1/users/self/course_nicknames/${cid(courseId)}`, { nickname });
  }

  /** DELETE /api/v1/users/self/course_nicknames/:course_id */
  function clearNickname(/** @type {string} */ courseId) {
    return write('DELETE', `/api/v1/users/self/course_nicknames/${cid(courseId)}`);
  }

  /** PUT /api/v1/users/self/colors/course_:id { hexcode } */
  function setCourseColor(/** @type {string} */ courseId, /** @type {string} */ hex) {
    return write('PUT', `/api/v1/users/self/colors/course_${cid(courseId)}`, { hexcode: hex });
  }

  /** PUT /api/v1/users/self/dashboard_positions { dashboard_positions: { course_42: 0, … } } */
  function setDashboardPositions(/** @type {Record<string, number>} */ positions) {
    return write('PUT', '/api/v1/users/self/dashboard_positions', { dashboard_positions: positions });
  }

  // ---------------------------------------------------------------------------
  // Planner: overrides = "marked done", notes = personal to-dos and
  // snoozes. Checked against https://canvas.instructure.com/doc/api/planner.html
  // (page generated 2026-11-19):
  //  - POST overrides needs plannable_type (lowercase: assignment, quiz,
  //    discussion_topic, wiki_page, planner_note, calendar_event,
  //    assessment_request, sub_assignment, peer_review_sub_assignment, …) and
  //    plannable_id; PUT takes only marked_complete / dismissed.
  //  - The override *object* reports plannable_type as a class name
  //    ("Assignment"); normalize.override maps it back.
  //  - POST notes: title, details, todo_date (yyyy-mm-dd), course_id, and
  //    linked_object_type + linked_object_id (assignment, quiz,
  //    discussion_topic, wiki_page, announcement; needs course_id; one linked
  //    note per object). PUT can't change the link.
  //  - The note object calls the text `description`; params call it `details`.
  // ---------------------------------------------------------------------------

  /** GET /api/v1/planner/overrides — every override this user has (paginated). */
  function getPlannerOverrides() {
    return getAll('/api/v1/planner/overrides');
  }

  /** GET /api/v1/planner/overrides/:id */
  function getPlannerOverride(/** @type {string} */ id) {
    return get(`/api/v1/planner/overrides/${encodeURIComponent(id)}`);
  }

  /** POST /api/v1/planner/overrides */
  function createPlannerOverride(/** @type {{ plannable_type: string, plannable_id: string, marked_complete?: boolean, dismissed?: boolean }} */ body) {
    return write('POST', '/api/v1/planner/overrides', body);
  }

  /** PUT /api/v1/planner/overrides/:id */
  function updatePlannerOverride(/** @type {string} */ id, /** @type {{ marked_complete?: boolean, dismissed?: boolean }} */ body) {
    return write('PUT', `/api/v1/planner/overrides/${encodeURIComponent(id)}`, body);
  }

  /** DELETE /api/v1/planner/overrides/:id */
  function deletePlannerOverride(/** @type {string} */ id) {
    return write('DELETE', `/api/v1/planner/overrides/${encodeURIComponent(id)}`);
  }

  /**
   * GET /api/v1/planner_notes. Both dates are inclusive. The user's own
   * context code must be passed to get notes without a course, so callers
   * pass `user_<id>` plus every course.
   */
  async function getPlannerNotes(/** @type {Date} */ start, /** @type {Date} */ end, /** @type {string[]} */ contextCodes) {
    return getAll('/api/v1/planner_notes', {
      start_date: start.toISOString(),
      end_date: end.toISOString(),
      'context_codes[]': contextCodes,
    });
  }

  /** GET /api/v1/planner_notes/:id */
  function getPlannerNote(/** @type {string} */ id) {
    return get(`/api/v1/planner_notes/${encodeURIComponent(id)}`);
  }

  /** POST /api/v1/planner_notes */
  function createPlannerNote(/** @type {{ title?: string, details?: string, todo_date: string, course_id?: string|null, linked_object_type?: string, linked_object_id?: string }} */ body) {
    return write('POST', '/api/v1/planner_notes', body);
  }

  /** PUT /api/v1/planner_notes/:id (title, details, todo_date, course_id) */
  function updatePlannerNote(/** @type {string} */ id, /** @type {{ title?: string, details?: string, todo_date?: string, course_id?: string|null }} */ body) {
    return write('PUT', `/api/v1/planner_notes/${encodeURIComponent(id)}`, body);
  }

  /** DELETE /api/v1/planner_notes/:id */
  function deletePlannerNote(/** @type {string} */ id) {
    return write('DELETE', `/api/v1/planner_notes/${encodeURIComponent(id)}`);
  }

  /**
   * POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions
   * (Submissions API, checked 2026-11-20). Students only, actively enrolled.
   * submission[submission_type] must be one the assignment allows, or Canvas
   * returns 400. `body` is an HTML snippet that Canvas sanitizes like its web
   * UI; `url` must be http(s) (no scheme → http). comment[text_comment] is
   * optional. Sent as JSON like every other write here.
   * @param {{ submission: { submission_type: 'online_text_entry'|'online_url', body?: string, url?: string }, comment?: { text_comment: string } }} body
   */
  function submitAssignment(/** @type {string} */ courseId, /** @type {string} */ assignmentId, body) {
    return write('POST', `/api/v1/courses/${cid(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submissions`, body);
  }

  Gesso.api.canvas = {
    getSelf, getCourses, getColors, getDashboardPositions,
    getAssignmentGroups, getPlannerItems, getAnnouncements, getCalendarEvents,
    getModules, getFolders, getFolderFiles, searchFiles, getCourseAnnouncements,
    getAssignment, getMySubmission, getDiscussionTopic, getPeerReviews,
    getPeriodAssignmentGroups, getGradingStandards,
    markTopicRead, setNickname, clearNickname, setCourseColor, setDashboardPositions,
    getPlannerOverrides, getPlannerOverride, createPlannerOverride, updatePlannerOverride, deletePlannerOverride,
    getPlannerNotes, getPlannerNote, createPlannerNote, updatePlannerNote, deletePlannerNote,
    submitAssignment,
  };
})();
