// @ts-check
/**
 * Raw Canvas API objects → the app's compact models.
 *
 * Why normalize? (1) The cache stays small (Safari's storage is slow with big
 * values). (2) Views never touch raw API quirks. (3) Odd data — missing fields,
 * restricted courses, unposted grades — is handled once, here.
 */
(() => {
  const { canvasOrigin } = Gesso.config;
  const { courseColor } = Gesso.color;

  /**
   * @typedef {Object} User
   * @property {string} id
   * @property {string} name
   * @property {string} firstName
   * @property {string|null} avatarUrl
   *
   * @typedef {Object} CourseGrade
   * @property {number|null} score         Canvas's computed current score (%)
   * @property {string|null} letter        Canvas's computed current grade (letter, if a scheme exists)
   * @property {number|null} finalScore
   * @property {string|null} periodTitle   Current grading period, if the course uses them
   *
   * @typedef {Object} Course
   * @property {string} id
   * @property {string} name               Nickname if the user set one, else the course name
   * @property {string} originalName
   * @property {string} code
   * @property {string|null} term
   * @property {string|null} termStart
   * @property {string|null} termEnd
   * @property {string|null} startAt       Course start (falls back when the term has no dates)
   * @property {string|null} endAt
   * @property {string|null} imageUrl
   * @property {string} color
   * @property {number|null} position      Dashboard order from Canvas
   * @property {boolean} favorite
   * @property {boolean} concluded
   * @property {string} url
   * @property {boolean} applyWeights
   * @property {boolean} hideFinalGrades
   * @property {string} role               student | teacher | ta | observer | designer
   * @property {CourseGrade} grade
   *
   * @typedef {Object} Submission
   * @property {string|null} state         submitted | unsubmitted | graded | pending_review
   * @property {number|null} score
   * @property {string|null} grade
   * @property {string|null} submittedAt
   * @property {string|null} gradedAt
   * @property {string|null} postedAt
   * @property {boolean} late
   * @property {boolean} missing
   * @property {boolean} excused
   * @property {number|null} pointsDeducted
   * @property {number|null} attempt
   *
   * @typedef {'not_submitted'|'submitted'|'graded'|'late'|'missing'|'excused'|'none'} SubmissionStatus
   *
   * @typedef {Object} Assignment
   * @property {string} id
   * @property {string} courseId
   * @property {string} groupId
   * @property {string} name
   * @property {string} url
   * @property {string|null} dueAt         Already the student's effective due date (overrides applied)
   * @property {string|null} unlockAt
   * @property {string|null} lockAt
   * @property {number|null} points
   * @property {string} gradingType
   * @property {'assignment'|'quiz'|'discussion'} kind
   * @property {string[]} submissionTypes
   * @property {boolean} omitFromFinal
   * @property {boolean} locked
   * @property {string|null} quizId          Classic quiz id, for quiz assignments
   * @property {string|null} discussionId    Topic id, for graded discussions
   * @property {Submission|null} submission
   * @property {SubmissionStatus} status
   * @property {boolean} gradePending      Graded but not yet posted to the student
   *
   * @typedef {Object} AssignmentGroup
   * @property {string} id
   * @property {string} courseId
   * @property {string} name
   * @property {number} position
   * @property {number} weight
   * @property {{ dropLowest: number, dropHighest: number, neverDrop: string[] }} rules
   *
   * @typedef {'assignment'|'quiz'|'discussion'|'page'|'note'|'event'|'announcement'|'peer_review'|'other'} PlannerType
   *
   * @typedef {Object} PlannerItem
   * @property {string} key                `${type}:${id}`
   * @property {PlannerType} type
   * @property {string} plannableType      Raw Canvas plannable_type (needed for planner overrides)
   * @property {string} id
   * @property {string|null} courseId
   * @property {string} title
   * @property {string|null} url
   * @property {string|null} date
   * @property {string} dateSource          Which Canvas field `date` came from
   * @property {Record<string,string>} rawDates  The candidate date fields Canvas sent (debugging)
   * @property {string|null} endAt
   * @property {boolean} allDay
   * @property {number|null} points
   * @property {string|null} assignmentId
   * @property {{ id: string, done: boolean, dismissed: boolean }|null} override
   * @property {{ submitted: boolean, graded: boolean, late: boolean, missing: boolean, excused: boolean, feedback: boolean }|null} submission
   * @property {boolean} newActivity
   * @property {string|null} details
   * @property {{ parentAssignmentId: string|null, revieweeId: string|null, anonymousId: string|null, done: boolean }|null} review  Peer reviews only
   * @property {boolean} snooze            A Gesso snooze note
   *
   * @typedef {Object} Announcement
   * @property {string} id
   * @property {string|null} courseId
   * @property {string} title
   * @property {string|null} postedAt
   * @property {boolean} read
   * @property {string} url
   * @property {string} author
   * @property {string} preview            Plain-text excerpt
   */

  // ---------------------------------------------------------------------------

  const str = (/** @type {any} */ v) => (v == null ? null : String(v));
  const num = (/** @type {any} */ v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
  const absUrl = (/** @type {string|null|undefined} */ path) => {
    if (!path) return null;
    try { return new URL(path, canvasOrigin).toString(); } catch { return null; }
  };

  /** HTML → short plain text without executing anything (DOMParser is inert). */
  function textSnippet(/** @type {string|null|undefined} */ html, max = 240) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
  }

  // ---------------------------------------------------------------------------

  /** @returns {User} */
  function user(/** @type {any} */ raw) {
    const name = raw.short_name || raw.name || 'there';
    return {
      id: String(raw.id),
      name,
      firstName: String(name).split(/\s+/)[0],
      avatarUrl: raw.avatar_url && !/avatar-50\.png$/.test(raw.avatar_url) ? raw.avatar_url : null,
    };
  }

  /**
   * @param {any} raw
   * @param {Record<string,string>} colors     from /users/self/colors
   * @param {Record<string,number>} positions  from /users/self/dashboard_positions
   * @returns {Course|null}  null for courses Canvas restricts by date
   */
  function course(raw, colors, positions) {
    if (!raw || raw.access_restricted_by_date) return null;
    const id = String(raw.id);
    const enrollments = Array.isArray(raw.enrollments) ? raw.enrollments : [];
    const enr = enrollments.find((e) => e.type === 'student') || enrollments[0] || {};
    // With grading periods, Canvas's own dashboard shows the current period's grade.
    const usePeriod = !!enr.has_grading_periods && enr.current_period_computed_current_score != null;

    // Whole-course scores (Canvas's computed_*), whatever the grading periods.
    const total = {
      score: num(enr.computed_current_score),
      letter: str(enr.computed_current_grade),
      finalScore: num(enr.computed_final_score),
      finalLetter: str(enr.computed_final_grade),
    };
    return {
      id,
      name: raw.name || raw.course_code || 'Untitled course',
      originalName: raw.original_name || raw.name || '',
      code: raw.course_code || '',
      term: raw.term?.name && raw.term.name !== 'Default Term' ? raw.term.name : null,
      // Term/course dates — used to spot due dates left over from a copied course.
      termStart: raw.term?.start_at || null,
      termEnd: raw.term?.end_at || null,
      startAt: raw.start_at || null,
      endAt: raw.end_at || null,
      imageUrl: raw.image_download_url || null,
      color: courseColor(colors[`course_${id}`], id),
      position: positions[`course_${id}`] ?? null,
      favorite: !!raw.is_favorite,
      concluded: !!raw.concluded,
      url: `${canvasOrigin}/courses/${id}`,
      applyWeights: !!raw.apply_assignment_group_weights,
      hideFinalGrades: !!raw.hide_final_grades,
      gradingStandardId: str(raw.grading_standard_id),
      role: String(enr.type || 'student').replace(/Enrollment$/i, '').toLowerCase(),
      grade: {
        score: num(usePeriod ? enr.current_period_computed_current_score : enr.computed_current_score),
        letter: str(usePeriod ? enr.current_period_computed_current_grade : enr.computed_current_grade),
        finalScore: num(usePeriod ? enr.current_period_computed_final_score : enr.computed_final_score),
        finalLetter: str(usePeriod ? enr.current_period_computed_final_grade : enr.computed_final_grade),
        periodTitle: usePeriod ? str(enr.current_grading_period_title) : null,
        // Grading periods: which score `score` is, and the whole-course one.
        usePeriod,
        periodId: usePeriod ? str(enr.current_grading_period_id) : null,
        hasPeriods: !!enr.has_grading_periods,
        total,
      },
    };
  }

  /** @returns {Submission|null} */
  function submission(/** @type {any} */ raw) {
    if (!raw) return null;
    return {
      state: raw.workflow_state || null,
      score: num(raw.score),
      grade: str(raw.grade),
      submittedAt: raw.submitted_at || null,
      gradedAt: raw.graded_at || null,
      postedAt: raw.posted_at || null,
      // Whether the response carried posted_at at all (the grade engine only
      // applies the posted-grades rule when it did).
      postedKnown: 'posted_at' in raw,
      late: !!raw.late,
      missing: !!raw.missing,
      excused: !!raw.excused,
      pointsDeducted: num(raw.points_deducted),
      attempt: num(raw.attempt),
    };
  }

  const NO_SUBMISSION_TYPES = new Set(['none', 'on_paper', 'not_graded']);

  /**
   * Single place that decides an assignment's status.
   * Order matters: excused beats everything; a posted grade beats late/missing
   * flags (the late tag is shown separately); Canvas's own `missing` flag is
   * trusted because it accounts for late policies and extensions.
   * @returns {SubmissionStatus}
   */
  function deriveStatus(/** @type {Submission|null} */ s, /** @type {string[]} */ types) {
    if (s?.excused) return 'excused';
    if (s && s.state === 'graded' && (s.score != null || s.grade != null)) return 'graded';
    if (s?.missing) return 'missing';
    if (s && (s.submittedAt || s.state === 'submitted' || s.state === 'pending_review')) return s.late ? 'late' : 'submitted';
    if (types.length && types.every((t) => NO_SUBMISSION_TYPES.has(t))) return 'none';
    return 'not_submitted';
  }

  /** @returns {Assignment} */
  function assignment(/** @type {any} */ raw, /** @type {string} */ courseId) {
    const types = Array.isArray(raw.submission_types) ? raw.submission_types : [];
    const sub = submission(raw.submission);
    const kind = raw.is_quiz_assignment || raw.is_quiz_lti_assignment || types.includes('online_quiz')
      ? 'quiz'
      : types.includes('discussion_topic') ? 'discussion' : 'assignment';
    return {
      id: String(raw.id),
      courseId,
      groupId: String(raw.assignment_group_id ?? ''),
      name: raw.name || 'Untitled',
      url: absUrl(raw.html_url) || `${canvasOrigin}/courses/${courseId}/assignments/${raw.id}`,
      dueAt: raw.due_at || null,
      unlockAt: raw.unlock_at || null,
      lockAt: raw.lock_at || null,
      points: num(raw.points_possible),
      gradingType: raw.grading_type || 'points',
      kind,
      submissionTypes: types,
      omitFromFinal: !!raw.omit_from_final_grade,
      anonymous: !!raw.anonymize_students,
      locked: !!raw.locked_for_user,
      // Peer reviews: the review due date (when reviews are auto-assigned), the
      // newer peer-review sub-assignment's due date (shape undocumented → defensive).
      peerReviews: !!raw.peer_reviews,
      peerReviewsDueAt: raw.peer_reviews_assign_at || null,
      peerReviewSubDueAt: (raw.peer_review_sub_assignment || raw.peer_review)?.due_at || null,
      anonymousPeerReviews: !!raw.anonymous_peer_reviews,
      // Let native quiz / discussion URLs be mapped back to this assignment.
      quizId: raw.quiz_id != null ? String(raw.quiz_id) : null,
      discussionId: raw.discussion_topic?.id != null ? String(raw.discussion_topic.id) : null,
      submission: sub,
      status: deriveStatus(sub, types),
      gradePending: !!sub && sub.state === 'graded' && !sub.postedAt && sub.score == null,
    };
  }

  /** @returns {AssignmentGroup} */
  function assignmentGroup(/** @type {any} */ raw, /** @type {string} */ courseId) {
    const rules = raw.rules || {};
    return {
      id: String(raw.id),
      courseId,
      name: raw.name || 'Assignments',
      position: num(raw.position) ?? 0,
      weight: num(raw.group_weight) ?? 0,
      rules: {
        dropLowest: num(rules.drop_lowest) ?? 0,
        dropHighest: num(rules.drop_highest) ?? 0,
        neverDrop: (rules.never_drop || []).map(String),
      },
    };
  }

  /** Canvas plannable_type → our PlannerType. */
  const PLANNER_TYPES = /** @type {Record<string, PlannerType>} */ ({
    assignment: 'assignment',
    sub_assignment: 'assignment',
    quiz: 'quiz',
    discussion_topic: 'discussion',
    wiki_page: 'page',
    planner_note: 'note',
    calendar_event: 'event',
    announcement: 'announcement',
    assessment_request: 'peer_review',
  });

  /** Pick a planner item's date and remember which field it came from. */
  function plannerDate(/** @type {any} */ raw, /** @type {any} */ p) {
    /** @type {[string, any][]} */
    const candidates = [
      ['plannable_date', raw.plannable_date], ['plannable.todo_date', p.todo_date],
      ['plannable.due_at', p.due_at], ['plannable.start_at', p.start_at],
    ];
    /** @type {Record<string,string>} */
    const rawDates = {};
    for (const [k, v] of candidates) if (v) rawDates[k] = v;
    const hit = candidates.find(([, v]) => v);
    return { date: hit ? hit[1] : null, dateSource: hit ? hit[0] : 'none', rawDates };
  }

  /** @returns {PlannerItem} */
  function plannerItem(/** @type {any} */ raw) {
    const p = raw.plannable || {};
    const type = PLANNER_TYPES[raw.plannable_type] || 'other';
    const id = String(raw.plannable_id ?? p.id);
    const subs = raw.submissions && typeof raw.submissions === 'object' ? raw.submissions : null;
    const ov = raw.planner_override;
    // Peer reviews (assessment requests) point at the classmate's submission:
    //   /courses/:cid/assignments/:aid/submissions/:userId?reviewee_id=…
    //   /courses/:cid/assignments/:aid/anonymous_submissions/:anonId
    // They are *not* the assignment itself, so they never merge into it.
    const review = type === 'peer_review' ? peerReviewInfo(raw, p) : null;
    const assignmentId = review ? null
      : raw.plannable_type === 'assignment' ? id : p.assignment_id != null ? String(p.assignment_id) : null;
    return {
      key: `${type}:${id}`,
      type,
      plannableType: raw.plannable_type,
      id,
      courseId: str(raw.course_id ?? p.course_id),
      title: p.title || p.name || 'Untitled',
      // Planner notes link to an API URL — not useful to open in a tab.
      url: type === 'note' ? null : absUrl(raw.html_url),
      // Canvas's own planner date first (it's what the planner filters/sorts by),
      // then the item's to-do date, due date, start. Provenance kept for #/debug.
      ...plannerDate(raw, p),
      endAt: p.end_at || null,
      allDay: !!p.all_day,
      points: num(p.points_possible),
      assignmentId,
      override: ov ? { id: String(ov.id), done: !!ov.marked_complete, dismissed: !!ov.dismissed } : null,
      submission: subs ? {
        submitted: !!subs.submitted,
        graded: !!subs.graded,
        late: !!subs.late,
        missing: !!subs.missing,
        excused: !!subs.excused,
        // Docs say `with_feedback`; live Canvas has returned `has_feedback`. Accept both.
        feedback: !!(subs.with_feedback || subs.has_feedback),
      } : null,
      newActivity: !!raw.new_activity,
      details: p.details || null,
      // A planner note Gesso created to snooze an item: hidden from
      // to-do lists and the calendar; the item it points at is hidden instead.
      snooze: type === 'note' && isSnoozeText(p.details ?? p.description),
      review,
    };
  }

  // ---------------------------------------------------------------------------
  // Planner overrides and notes
  // ---------------------------------------------------------------------------

  /** Marks a planner note as a Gesso snooze. Starts the note's text. */
  const SNOOZE_MARK = '[Gesso snooze]';
  const isSnoozeText = (/** @type {any} */ s) => typeof s === 'string' && s.startsWith(SNOOZE_MARK);

  /**
   * Canvas reports an override's plannable_type as a class name
   * ("Assignment", "Quizzes::Quiz", "DiscussionTopic"), while requests use
   * snake_case ("assignment", "quiz", "discussion_topic"). Map to the latter.
   */
  function plannableType(/** @type {any} */ t) {
    return String(t || '').replace(/^.*::/, '').replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  }

  /**
   * @typedef {Object} PlannerOverride
   * @property {string} id
   * @property {string} type          snake_case plannable_type
   * @property {string} plannableId
   * @property {string|null} assignmentId
   * @property {boolean} done
   * @property {boolean} dismissed
   * @property {boolean} deleted
   * @returns {PlannerOverride}
   */
  function override(/** @type {any} */ raw) {
    return {
      id: String(raw.id),
      type: plannableType(raw.plannable_type),
      plannableId: String(raw.plannable_id),
      assignmentId: str(raw.assignment_id),
      done: !!raw.marked_complete,
      dismissed: !!raw.dismissed,
      deleted: raw.workflow_state === 'deleted' || !!raw.deleted_at,
    };
  }

  /**
   * @typedef {Object} PlannerNote
   * @property {string} id
   * @property {string} title
   * @property {string|null} details
   * @property {string|null} courseId
   * @property {string|null} todoDate
   * @property {{ type: string, id: string, url: string|null }|null} linked
   * @property {boolean} snooze
   * @property {boolean} deleted
   * @returns {PlannerNote}
   */
  function plannerNote(/** @type {any} */ raw) {
    const details = raw.details ?? raw.description ?? null;
    return {
      id: String(raw.id),
      title: raw.title || 'Untitled',
      details: details || null,
      courseId: str(raw.course_id),
      todoDate: raw.todo_date || null,
      linked: raw.linked_object_type && raw.linked_object_id != null
        ? { type: plannableType(raw.linked_object_type), id: String(raw.linked_object_id), url: absUrl(raw.linked_object_html_url) }
        : null,
      snooze: isSnoozeText(details),
      deleted: raw.workflow_state === 'deleted',
    };
  }

  /** Parent assignment + reviewee for a peer-review planner item. */
  function peerReviewInfo(/** @type {any} */ raw, /** @type {any} */ p) {
    return { ...peerReviewFromUrl(raw.html_url, p.assignment_id), done: p.workflow_state === 'completed' };
  }

  /**
   * Parse a peer-review URL. Canvas uses several shapes (seen live: the first):
   *   /courses/:c/assignments/:a?reviewee_id=:u
   *   /courses/:c/assignments/:a/submissions/:u[?reviewee_id=:u]
   *   /courses/:c/assignments/:a/anonymous_submissions/:anon
   * `explicitAssignmentId` (plannable.assignment_id, if Canvas sends it) wins.
   */
  function peerReviewFromUrl(/** @type {string|null|undefined} */ href, /** @type {any} */ explicitAssignmentId = null) {
    const url = String(href || '');
    const m = url.match(/\/courses\/\d+\/assignments\/(\d+)(?:\/(anonymous_)?submissions\/([^/?#]+))?/);
    let revieweeId = null;
    try { revieweeId = new URL(url, canvasOrigin).searchParams.get('reviewee_id'); } catch { /* ignore */ }
    return {
      parentAssignmentId: explicitAssignmentId != null ? String(explicitAssignmentId) : m ? m[1] : null,
      parentVia: explicitAssignmentId != null ? 'plannable.assignment_id' : m ? 'item URL' : null,
      revieweeId: revieweeId || (m && m[3] && !m[2] ? m[3] : null),
      anonymousId: m && m[2] ? m[3] : null,
    };
  }

  /**
   * Calendar Events API → CalendarEvent. `effective_context_code` (when set)
   * says which calendar the event shows on, e.g. a section event shown on
   * its course. Assignment events are never requested (see canvas.js).
   * @returns {{ key: string, id: string, title: string, start: string|null, end: string|null, allDay: boolean,
   *   allDayDate: string|null, contextCode: string, courseId: string|null, personal: boolean,
   *   location: string|null, address: string|null, description: string|null, url: string|null, hidden: boolean, deleted: boolean }}
   */
  function calendarEvent(/** @type {any} */ raw) {
    const contextCode = String(raw.effective_context_code || raw.context_code || '').split(',')[0];
    const course = contextCode.match(/^course_(\d+)$/);
    return {
      key: `event:${raw.id}`,
      id: String(raw.id),
      title: raw.title || 'Untitled event',
      start: raw.start_at || null,
      end: raw.end_at || null,
      allDay: !!raw.all_day,
      allDayDate: raw.all_day_date || null,
      contextCode,
      courseId: course ? course[1] : null,
      personal: contextCode.startsWith('user_'),
      location: raw.location_name || null,
      address: raw.location_address || null,
      description: raw.description || null,
      url: absUrl(raw.html_url),
      hidden: !!raw.hidden,
      deleted: raw.workflow_state === 'deleted',
    };
  }

  /** @returns {Announcement} */
  function announcement(/** @type {any} */ raw) {
    const ctx = String(raw.context_code || '');
    const fromUrl = String(raw.html_url || '').match(/\/courses\/(\d+)/);
    return {
      id: String(raw.id),
      courseId: ctx.startsWith('course_') ? ctx.slice(7) : fromUrl ? fromUrl[1] : null,
      title: raw.title || 'Announcement',
      postedAt: raw.posted_at || raw.delayed_post_at || raw.created_at || null,
      read: raw.read_state === 'read',
      url: absUrl(raw.html_url) || canvasOrigin,
      author: raw.user_name || raw.author?.display_name || '',
      preview: textSnippet(raw.message),
    };
  }

  // ---------------------------------------------------------------------------
  // Course workspace models
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} ModuleItem
   * @property {string} id
   * @property {string} title
   * @property {string} type        File | Page | Discussion | Assignment | Quiz | SubHeader | ExternalUrl | ExternalTool
   * @property {number} indent
   * @property {string|null} url    Canvas page for the item (null for SubHeader)
   * @property {boolean} newTab
   * @property {{ type: string, done: boolean, minScore: number|null }|null} requirement
   * @property {string|null} dueAt
   * @property {number|null} points
   * @property {boolean} locked
   *
   * @typedef {Object} Module
   * @property {string} id
   * @property {string} name
   * @property {number} position
   * @property {'locked'|'unlocked'|'started'|'completed'|null} state
   * @property {string|null} unlockAt
   * @property {boolean} sequential
   * @property {ModuleItem[]} items
   */

  /** @returns {ModuleItem} */
  function moduleItem(/** @type {any} */ raw) {
    const cd = raw.content_details || {};
    const req = raw.completion_requirement;
    const external = raw.type === 'ExternalUrl';
    return {
      id: String(raw.id),
      title: raw.title || 'Untitled',
      type: raw.type || 'Page',
      indent: Math.min(num(raw.indent) ?? 0, 5),
      url: raw.type === 'SubHeader' ? null : (external ? raw.external_url : absUrl(raw.html_url)) || null,
      newTab: external || !!raw.new_tab,
      contentId: raw.content_id != null ? String(raw.content_id) : null, // assignment/quiz/topic id

      requirement: req ? { type: req.type, done: !!req.completed, minScore: num(req.min_score ?? req.min_percentage) } : null,
      dueAt: cd.due_at || null,
      points: num(cd.points_possible),
      locked: !!cd.locked_for_user,
    };
  }

  /** @returns {Module} */
  function module(/** @type {any} */ raw) {
    return {
      id: String(raw.id),
      name: raw.name || 'Module',
      position: num(raw.position) ?? 0,
      state: raw.state || null,
      unlockAt: raw.unlock_at || null,
      sequential: !!raw.require_sequential_progress,
      items: (raw.items || []).map(moduleItem),
    };
  }

  /**
   * @typedef {Object} Folder
   * @property {string} id
   * @property {string} name
   * @property {string} fullName
   * @property {string|null} parentId
   * @property {number} filesCount
   * @property {number} foldersCount
   * @property {boolean} locked
   * @property {number} position
   *
   * @typedef {Object} CanvasFile
   * @property {string} id
   * @property {string} name
   * @property {number} size
   * @property {string} contentType
   * @property {string} mimeClass
   * @property {string|null} updatedAt
   * @property {string|null} folderId
   * @property {string} previewUrl   Canvas's file page (preview + download)
   * @property {string|null} downloadUrl
   * @property {boolean} locked
   */

  /** @returns {Folder|null}  null for folders hidden from the student */
  function folder(/** @type {any} */ raw) {
    if (raw.hidden_for_user) return null;
    return {
      id: String(raw.id),
      name: raw.name || 'Folder',
      fullName: raw.full_name || raw.name || '',
      parentId: raw.parent_folder_id == null ? null : String(raw.parent_folder_id),
      filesCount: num(raw.files_count) ?? 0,
      foldersCount: num(raw.folders_count) ?? 0,
      locked: !!raw.locked_for_user,
      position: num(raw.position) ?? 0,
    };
  }

  /** @returns {CanvasFile} */
  function file(/** @type {any} */ raw, /** @type {string} */ courseId) {
    return {
      id: String(raw.id),
      name: fileName(raw),
      size: num(raw.size) ?? 0,
      contentType: raw['content-type'] || '',
      mimeClass: raw.mime_class || '',
      updatedAt: raw.modified_at || raw.updated_at || null,
      folderId: raw.folder_id == null ? null : String(raw.folder_id),
      previewUrl: `${canvasOrigin}/courses/${courseId}/files/${raw.id}`,
      downloadUrl: raw.url || null,
      locked: !!raw.locked_for_user,
    };
  }

  // ---------------------------------------------------------------------------
  // Assignment detail
  // ---------------------------------------------------------------------------

  /** File display name: decode entities, and URL-decode the raw `filename` fallback. */
  function fileName(/** @type {any} */ raw) {
    if (raw.display_name) return decodeEntities(raw.display_name);
    if (raw.filename) {
      try { return decodeURIComponent(String(raw.filename).replace(/\+/g, ' ')); } catch { return raw.filename; }
    }
    return 'File';
  }

  /** "Q&amp;A" → "Q&A" (text only; nothing is parsed as markup). */
  function decodeEntities(/** @type {string} */ s) {
    const str = String(s ?? '');
    if (!/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(str)) return str;
    return new DOMParser().parseFromString(`<!doctype html><body>${str.replace(/</g, '&lt;')}`, 'text/html').body.textContent || str;
  }

  /** A file attached to a submission or comment (field shapes per Canvas File). */
  function attachment(/** @type {any} */ raw) {
    return {
      id: String(raw.id),
      name: fileName(raw),
      size: num(raw.size) ?? 0,
      contentType: raw['content-type'] || raw.content_type || '',
      downloadUrl: raw.url || null,
      previewUrl: absUrl(raw.preview_url),
    };
  }

  /** Detailed submission: the summary fields plus content, history, comments, rubric. */
  function submissionDetail(/** @type {any} */ raw) {
    if (!raw) return null;
    const base = /** @type {any} */ (submission(raw));
    const comments = (raw.submission_comments || []).map((/** @type {any} */ c) => ({
      id: String(c.id),
      author: c.author_name || c.author?.display_name || 'Instructor',
      avatarUrl: c.author?.avatar_image_url || null,
      text: c.comment || '',
      createdAt: c.created_at || null,
      attempt: num(c.attempt),
      attachments: (c.attachments || []).map(attachment),
      mediaUrl: c.media_comment?.url || null,
    }));
    /** @type {Record<string, { points: number|null, ratingId: string|null, comments: string }>} */
    const rubricAssessment = {};
    for (const [critId, a] of Object.entries(raw.rubric_assessment || {})) {
      const v = /** @type {any} */ (a);
      rubricAssessment[critId] = { points: num(v?.points), ratingId: str(v?.rating_id), comments: v?.comments || '' };
    }
    // History: oldest → newest, only real attempts.
    const history = (raw.submission_history || [])
      .filter((/** @type {any} */ h) => h.submitted_at || h.attempt)
      .map((/** @type {any} */ h) => ({
        attempt: num(h.attempt),
        submittedAt: h.submitted_at || null,
        type: h.submission_type || null,
        score: num(h.score),
        grade: str(h.grade),
        late: !!h.late,
        attachments: (h.attachments || []).map(attachment),
        url: h.url || null,
      }));
    return {
      ...base,
      type: raw.submission_type || null,
      bodyHtml: raw.body || '',
      url: raw.url || null,
      previewUrl: absUrl(raw.preview_url),
      secondsLate: num(raw.seconds_late),
      latePolicy: raw.late_policy_status || null,
      redo: !!raw.redo_request,
      attachments: (raw.attachments || []).map(attachment),
      history,
      comments,
      rubricAssessment,
    };
  }

  /**
   * Everything the assignment detail view shows. `kind` decides the layout:
   * quizzes and external tools (LTI) can't run in Gesso.
   * @returns {any}
   */
  function assignmentDetail(/** @type {any} */ raw, /** @type {any} */ rawSubmission, /** @type {string} */ courseId) {
    const summary = assignment({ ...raw, submission: rawSubmission || raw.submission }, courseId);
    const types = summary.submissionTypes;
    const isQuiz = summary.kind === 'quiz';
    const isTool = !isQuiz && types.includes('external_tool');
    const tool = raw.external_tool_tag_attributes || {};
    let toolHost = null;
    try { toolHost = tool.url ? new URL(tool.url).hostname : null; } catch { /* ignore */ }
    const rs = raw.rubric_settings || {};
    return {
      ...summary,
      layout: isQuiz ? 'quiz' : isTool ? 'tool' : summary.kind === 'discussion' ? 'discussion' : 'assignment',
      descriptionHtml: raw.description || '',
      lockExplanation: raw.lock_explanation || null,
      allowedExtensions: Array.isArray(raw.allowed_extensions) ? raw.allowed_extensions : [],
      allowedAttempts: num(raw.allowed_attempts), // -1 or null = unlimited
      groupAssignment: raw.group_category_id != null,
      peerReviews: !!raw.peer_reviews,
      plagiarismCheck: !!(raw.turnitin_enabled || raw.vericite_enabled),
      toolHost,
      discussionUrl: absUrl(raw.discussion_topic?.html_url),
      rubric: Array.isArray(raw.rubric) ? raw.rubric.map((/** @type {any} */ c) => ({
        id: String(c.id),
        description: c.description || '',
        longDescription: c.long_description || '',
        points: num(c.points),
        ignoreForScoring: !!c.ignore_for_scoring,
        useRange: !!c.criterion_use_range,
        ratings: (c.ratings || []).map((/** @type {any} */ r) => ({
          id: String(r.id), description: r.description || '', longDescription: r.long_description || '', points: num(r.points),
        })),
      })) : null,
      rubricPoints: num(rs.points_possible),
      rubricHidePoints: !!rs.hide_points,
      submissionDetail: submissionDetail(rawSubmission),
    };
  }

  /** A discussion topic (for the Gesso summary of ungraded discussions). */
  function discussionTopic(/** @type {any} */ raw, /** @type {string} */ courseId) {
    return {
      id: String(raw.id),
      courseId,
      title: raw.title || 'Discussion',
      html: raw.message || '',
      url: absUrl(raw.html_url) || `${canvasOrigin}/courses/${courseId}/discussion_topics/${raw.id}`,
      author: raw.user_name || raw.author?.display_name || '',
      postedAt: raw.posted_at || null,
      todoDate: raw.todo_date || null,
      lockAt: raw.lock_at || null,
      replies: num(raw.discussion_subentry_count) ?? 0,
      unread: num(raw.unread_count) ?? 0,
      read: raw.read_state === 'read',
      assignmentId: raw.assignment_id != null ? String(raw.assignment_id) : null,
      locked: !!raw.locked_for_user,
      lockExplanation: raw.lock_explanation || null,
      requireInitialPost: !!raw.require_initial_post,
      attachments: (raw.attachments || []).map(attachment),
    };
  }

  /** Full announcement (message HTML is sanitized at render time, never stored raw elsewhere). */
  function announcementFull(/** @type {any} */ raw) {
    return { ...announcement(raw), html: raw.message || '' };
  }

  Gesso.normalize = {
    user, course, submission, deriveStatus, assignment, assignmentGroup, plannerItem, announcement, textSnippet,
    override, plannerNote, plannableType, isSnoozeText, SNOOZE_MARK,
    module, moduleItem, folder, file, announcementFull,
    assignmentDetail, submissionDetail, attachment, discussionTopic, fileName, decodeEntities, peerReviewFromUrl, calendarEvent,
  };
})();
