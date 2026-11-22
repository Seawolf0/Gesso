// @ts-check
/**
 * Assignment detail, shown inside the course workspace at
 *   #/courses/:courseId/assignments/:assignmentId
 *
 * Paints instantly from synced coursework (title, due, points, status), then
 * fills in the full record — description, rubric, submission, comments — from
 *   GET …/assignments/:id   +   GET …/assignments/:id/submissions/:userId
 * (cached as resource `assignment:<course>:<id>`, fresh for 60 s).
 *
 * Submitting happens in Canvas ("Submit in Canvas"). Quizzes and external
 * tools (LTI) can't run here, so they get a summary + "open in Canvas".
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const canvas = Gesso.api.canvas;
  const { toDate, dueLabel, relative, duration } = Gesso.time;

  const TYPE_LABELS = /** @type {Record<string,string>} */ ({
    online_text_entry: 'Text entry', online_url: 'Website URL', online_upload: 'File upload',
    media_recording: 'Media recording', student_annotation: 'Document annotation', online_quiz: 'Quiz',
    discussion_topic: 'Discussion reply', external_tool: 'External tool', on_paper: 'On paper',
    none: 'No submission', not_graded: 'Not graded', wiki_page: 'Page',
  });
  const GRADING_LABELS = /** @type {Record<string,string>} */ ({
    points: 'Points', percent: 'Percentage', letter_grade: 'Letter grade', gpa_scale: 'GPA scale',
    pass_fail: 'Complete / incomplete', not_graded: 'Not graded',
  });
  /** Types a student submits on Canvas's assignment page. */
  const SUBMITTABLE = new Set(['online_text_entry', 'online_url', 'online_upload', 'media_recording', 'student_annotation']);

  // ---------------------------------------------------------------------------

  /**
   * Load (or reuse) the full assignment record as a resource entry. Shared with
   * the peer-review summary, which shows the parent assignment and its rubric.
   */
  function ensureDetail(/** @type {any} */ course, /** @type {string} */ aid, /** @type {string|undefined} */ userId) {
    const key = `assignment:${course.id}:${aid}`;
    const fetcher = async () => {
      const [rawA, rawS] = await Promise.all([
        canvas.getAssignment(course.id, aid),
        userId
          ? canvas.getMySubmission(course.id, aid, userId).catch((/** @type {any} */ err) => {
            if (err?.kind === 'auth') throw err;
            return null; // fall back to the submission included with the assignment
          })
          : Promise.resolve(null),
      ]);
      return Gesso.normalize.assignmentDetail(rawA, rawS, course.id);
    };
    return Gesso.resources.ensure(key, fetcher, { ttl: 60_000 });
  }

  /** @param {any} ctx  the workspace's local state (course, state, focusItem, …) */
  function render(ctx) {
    const { course, state } = ctx;
    const aid = String(ctx.focusItem);
    const res = ensureDetail(course, aid, state.data.user?.id);
    const summary = state.data.coursework?.[course.id]?.assignments?.find((/** @type {any} */ x) => x.id === aid) || null;
    /** @type {any} */
    let a = res.data || summary;
    const nativeUrl = a?.url || `${course.url}/assignments/${aid}`;

    if (!a) {
      if (res.error) {
        return h('div', { class: 'panel' }, ui.emptyState({
          icon: 'alert',
          title: res.error.kind === 'not_found' || res.error.kind === 'forbidden' ? "This assignment isn't available" : "Couldn't load this assignment",
          body: res.error.kind === 'not_found' || res.error.kind === 'forbidden' ? 'It may be unpublished, or not assigned to you.' : res.error.message,
          action: h('a', { class: 'btn btn--sm', href: nativeUrl }, 'Open in Canvas', icon('external', { size: 12 })),
        }));
      }
      return h('div', { class: 'stack' }, h('div', { class: 'skel', style: { height: '120px', borderRadius: '16px' } }), h('div', { class: 'skel', style: { height: '320px', borderRadius: '16px' } }));
    }

    const full = !!res.data;
    const sub = full ? a.submissionDetail : null;
    const now = new Date();
    a = { ...a, staleDue: Gesso.derive.isStaleDate(a.dueAt, course, now) }; // copied-course leftover date (copy; don't mutate cache)

    return h('article', { class: 'adetail', 'aria-labelledby': 'detail-title' },
      crumbs(course, a),
      header(course, a, sub, nativeUrl, Gesso.derive.workItems(state.data, state.settings.hiddenCourses).find((i) => i.key === `assignment:${aid}`),
        full && state.data.user?.id ? { course, userId: state.data.user.id } : null),
      a.locked && full && lockBanner(a),
      res.error && !res.data && h('div', { class: 'banner banner--warn', role: 'status' },
        icon('alert', { size: 18 }),
        h('div', { class: 'banner__text' },
          h('p', { class: 'banner__title' }, 'Showing synced summary only'),
          h('p', { class: 'banner__body' }, `Full details couldn't load: ${res.error.message}`))),
      (a.layout === 'quiz' || a.layout === 'tool') && nativeCallout(a, nativeUrl),
      h('div', { class: 'adetail__grid' },
        h('div', { class: 'stack' },
          descriptionPanel(a, full),
          full && a.rubric && a.rubric.length > 0 && rubricPanel(a, sub),
          full && commentsPanel(sub),
        ),
        h('aside', { class: 'stack', 'aria-label': 'Assignment details' },
          submissionPanel(a, sub, full, now),
          datesPanel(a, now),
          detailsPanel(a, sub, full),
          full && sub && sub.history.length > 1 && historyPanel(sub),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Header & actions
  // ---------------------------------------------------------------------------

  function crumbs(/** @type {any} */ course, /** @type {any} */ a) {
    const back = Gesso.nav?.previous;
    return h('nav', { class: 'adetail__crumbs', 'aria-label': 'Breadcrumb' },
      back && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => history.back(), 'data-fkey': 'detail-back' },
        icon('arrowLeft', { size: 14 }), 'Back'),
      h('a', { class: 'crumbs__btn', href: Gesso.router.href(`/courses/${course.id}/assignments?highlight=${a.id}`) }, 'All assignments'),
      icon('chevronRight', { size: 12 }),
      h('span', { class: 'crumbs__current truncate', 'aria-current': 'page' }, a.name));
  }

  /**
   * The main call to action, labelled for what happens. Text/URL assignments
   * can be submitted here; everything else links to Canvas.
   */
  function primaryAction(/** @type {any} */ a, /** @type {any} */ sub, /** @type {string} */ nativeUrl, /** @type {any} */ submitCtx = null) {
    const attemptsUsed = sub?.attempt ?? 0;
    const unlimited = a.allowedAttempts == null || a.allowedAttempts < 0;
    const attemptsLeft = unlimited || attemptsUsed < a.allowedAttempts;
    const btn = (/** @type {string} */ label, /** @type {string} */ href, /** @type {string} */ iconName = 'external') =>
      h('a', { class: 'btn btn--primary', href, 'data-fkey': 'detail-primary' }, label, icon(iconName, { size: 13 }));
    if (a.layout === 'quiz') return btn(a.status === 'not_submitted' || a.status === 'missing' ? 'Take quiz in Canvas' : 'View quiz in Canvas', nativeUrl);
    if (a.layout === 'tool') return btn('Launch in Canvas', nativeUrl);
    if (a.layout === 'discussion') return btn('Reply in Canvas', a.discussionUrl || nativeUrl);
    if (!a.submissionTypes.some((/** @type {string} */ t) => SUBMITTABLE.has(t))) return null; // on paper / no submission
    if (a.locked) return h('span', { class: 'btn btn--primary', 'aria-disabled': 'true', title: 'Locked' }, icon('lock', { size: 13 }), 'Locked');
    if (!attemptsLeft) return h('span', { class: 'pill' }, 'No attempts left');
    const submitted = !!(sub?.submittedAt || a.submission?.submittedAt);
    // Full details loaded (fresh attempt count) + a text/URL type → submit in Gesso.
    // Experimental (Settings, off by default) until a live submission is verified.
    if (submitCtx && Gesso.store.get().settings.experimentalSubmit && Gesso.submit.eligibility(a, sub).ok) {
      return h('button', { class: 'btn btn--primary', type: 'button', 'data-fkey': 'detail-primary', onClick: () => Gesso.submitUi.open({ ...submitCtx, a, sub, nativeUrl }) },
        icon('upload', { size: 13 }), submitted ? 'Resubmit' : 'Submit');
    }
    return btn(submitted ? 'Resubmit in Canvas' : 'Submit in Canvas', nativeUrl);
  }

  function header(/** @type {any} */ course, /** @type {any} */ a, /** @type {any} */ sub, /** @type {string} */ nativeUrl, /** @type {any} */ item, /** @type {any} */ submitCtx) {
    return h('header', { class: 'adetail__head panel', style: { '--c': course.color } },
      h('span', { class: 'adetail__kind', 'aria-hidden': 'true' }, icon(ui.kindIcon(a.kind), { size: 20 })),
      h('div', { class: 'adetail__titles' },
        h('h2', { class: 'adetail__title', id: 'detail-title', tabindex: '-1', 'data-fkey': 'detail-title' }, a.name),
        h('div', { class: 'adetail__meta' },
          h('span', null, course.code || Gesso.derive.courseTitle(course)),
          a.points != null && h('span', null, `${a.points} pts`),
          a.dueAt && !a.staleDue && h('span', null, `Due ${dueLabel(/** @type {Date} */ (toDate(a.dueAt)))}`),
          a.staleDue && ui.pill('No current due date', null),
          ui.statusPill(a.status),
          a.submission?.late && a.status !== 'late' && ui.pill('Late', 'warn'),
          a.gradePending && ui.pill('Grade not posted yet', 'info'))),
      h('div', { class: 'adetail__actions' },
        Gesso.plannerUi?.detailActions(item), // mark done / snooze, saved to Canvas
        primaryAction(a, sub, nativeUrl, submitCtx),
        h('a', { class: 'btn', href: nativeUrl, 'data-fkey': 'detail-open' }, 'Open in Canvas', icon('external', { size: 13 }))),
    );
  }

  function lockBanner(/** @type {any} */ a) {
    return h('div', { class: 'banner banner--warn', role: 'status' },
      icon('lock', { size: 18 }),
      h('div', { class: 'banner__text' },
        h('p', { class: 'banner__title' }, 'Locked'),
        a.lockExplanation
          ? h('div', { class: 'banner__body prose prose--tight' }, Gesso.sanitize(a.lockExplanation))
          : h('p', { class: 'banner__body' }, 'This assignment is currently locked.')));
  }

  /** Quizzes and LTI tools: a summary card that sends you to Canvas to run them. */
  function nativeCallout(/** @type {any} */ a, /** @type {string} */ nativeUrl) {
    const isQuiz = a.layout === 'quiz';
    const attempts = a.allowedAttempts == null || a.allowedAttempts < 0 ? 'Unlimited attempts' : `${a.allowedAttempts} ${a.allowedAttempts === 1 ? 'attempt' : 'attempts'}`;
    return h('section', { class: 'callout', 'aria-label': isQuiz ? 'Quiz' : 'External tool' },
      h('span', { class: 'callout__icon', 'aria-hidden': 'true' }, icon(isQuiz ? 'quiz' : 'tool', { size: 22 })),
      h('div', { class: 'callout__text' },
        h('p', { class: 'callout__title' }, isQuiz ? 'This is a quiz — it runs in Canvas' : `This assignment runs in an external tool${a.toolHost ? ` (${a.toolHost})` : ''}`),
        h('p', { class: 'callout__body' }, isQuiz
          ? `Timers, question navigation, and proctoring only work in Canvas. ${[a.points != null && `${a.points} points`, a.allowedAttempts != null && attempts].filter(Boolean).join(' · ')}`
          : 'External tools (LTI) launch inside Canvas with your course login, so they can\'t open here.')),
      h('a', { class: 'btn btn--primary', href: nativeUrl }, isQuiz ? 'Open quiz in Canvas' : 'Launch in Canvas', icon('external', { size: 13 })));
  }

  // ---------------------------------------------------------------------------
  // Main column
  // ---------------------------------------------------------------------------

  function descriptionPanel(/** @type {any} */ a, /** @type {boolean} */ full) {
    let body;
    if (!full) body = h('div', { 'aria-busy': 'true' }, ['92%', '86%', '74%', '60%'].map((w) => h('div', { class: 'skel skel-line', style: { width: w } })));
    else if (a.descriptionHtml.trim()) body = h('div', { class: 'prose' }, Gesso.sanitize(a.descriptionHtml));
    else body = h('p', { class: 'faint' }, 'No description.');
    return ui.panel({ title: 'Instructions', icon: 'fileText' }, body);
  }

  function rubricPanel(/** @type {any} */ a, /** @type {any} */ sub, /** @type {{ subtitle?: string }} */ opts = {}) {
    const assessment = sub?.rubricAssessment || {};
    const assessed = Object.keys(assessment).length > 0;
    const showPoints = !a.rubricHidePoints;
    let earned = 0;
    let possible = 0;
    const rows = a.rubric.map((/** @type {any} */ c) => {
      const as = assessment[c.id] || null;
      if (!c.ignoreForScoring) {
        possible += c.points ?? 0;
        if (as?.points != null) earned += as.points;
      }
      return h('tr', null,
        h('th', { scope: 'row', class: 'rubric__crit' },
          ui.richText(c.description, { class: 'rubric__crit-title' }),
          c.longDescription && ui.richText(c.longDescription, { class: 'rubric__crit-long' }),
          c.ignoreForScoring && h('span', { class: 'faint' }, ' (not scored)')),
        h('td', { class: 'rubric__ratings' },
          h('div', { class: 'rubric__rating-list' }, c.ratings.map((/** @type {any} */ r) => {
            const selected = as && (as.ratingId === r.id || (as.ratingId == null && as.points != null && as.points === r.points));
            return h('div', { class: ['rating', selected && 'rating--selected'], title: r.longDescription ? ui.plainText(r.longDescription) : undefined },
              showPoints && r.points != null && h('span', { class: 'rating__pts tabular' }, `${r.points} pts`),
              ui.richText(r.description, { class: 'rating__desc' }),
              selected && h('span', { class: 'sr-only' }, '(selected)'));
          })),
          as?.comments && h('div', { class: 'rubric__comment' }, icon('discussion', { size: 13 }), ui.richText(as.comments))),
        showPoints && h('td', { class: 'num tabular rubric__pts' },
          as?.points != null ? `${as.points} / ${c.points ?? '—'}` : `— / ${c.points ?? '—'}`));
    });
    return ui.panel({
      title: 'Rubric', icon: 'tasks',
      subtitle: opts.subtitle || (assessed ? 'Your instructor\'s assessment is highlighted' : 'Not assessed yet'),
      actions: showPoints && assessed && h('span', { class: 'gsum tabular' }, `${round(earned)} / ${round(possible)}`),
    },
    h('div', { class: 'table-scroll' },
      h('table', { class: 'rubric' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Criterion'), h('th', { scope: 'col' }, 'Ratings'),
          showPoints && h('th', { scope: 'col', class: 'num' }, 'Points'))),
        h('tbody', null, rows))));
  }

  function commentsPanel(/** @type {any} */ sub) {
    const comments = sub?.comments || [];
    return ui.panel({ title: 'Comments', icon: 'discussion', count: comments.length || null },
      comments.length
        ? h('ol', { class: 'comments' }, comments.map((/** @type {any} */ c) => {
          const at = toDate(c.createdAt);
          return h('li', { class: 'comment' },
            ui.avatar({ name: c.author, avatarUrl: c.avatarUrl }),
            h('div', { class: 'comment__body' },
              h('div', { class: 'comment__meta' },
                h('span', { class: 'comment__author' }, c.author),
                at && h('time', { datetime: at.toISOString(), title: dueLabel(at) }, relative(at)),
                c.attempt != null && h('span', { class: 'pill' }, `Attempt ${c.attempt}`)),
              c.text && ui.richText(c.text, { tag: 'div', class: 'comment__text' }),
              c.mediaUrl && h('a', { class: 'link', href: c.mediaUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('video', { size: 13 }), ' Play media comment'),
              c.attachments.length > 0 && fileList(c.attachments)));
        }))
        : h('p', { class: 'faint' }, 'No comments yet. Instructor feedback will appear here.'));
  }

  // ---------------------------------------------------------------------------
  // Aside
  // ---------------------------------------------------------------------------

  function submissionPanel(/** @type {any} */ a, /** @type {any} */ sub, /** @type {boolean} */ full, /** @type {Date} */ now) {
    const s = sub || a.submission;
    const submittedAt = toDate(s?.submittedAt);
    const graded = a.status === 'graded';
    const pct = s?.score != null && a.points ? Math.round((s.score / a.points) * 1000) / 10 : null;
    return ui.panel({ title: 'My submission', icon: 'checkCircle' },
      h('div', { class: 'mysub' },
        h('div', { class: 'mysub__status' },
          ui.statusPill(a.status),
          submittedAt && h('span', { class: 'muted' }, `Submitted ${dueLabel(submittedAt)}`)),
        sub?.secondsLate > 0 && h('p', { class: 'text-warn' }, `${duration(sub.secondsLate * 1000)} late`),
        graded && h('div', { class: 'mysub__grade' },
          h('span', { class: 'mysub__score tabular' }, ui.scoreText(s.score, a.points, s.grade, a.gradingType)),
          pct != null && a.gradingType === 'points' && h('span', { class: 'faint tabular' }, `${pct}%`)),
        a.gradePending && h('p', { class: 'muted' }, 'Graded, but your instructor hasn\'t posted the grade yet.'),
        s?.excused && h('p', { class: 'muted' }, 'Excused — doesn\'t count toward your grade.'),
        s?.pointsDeducted > 0 && h('p', { class: 'text-warn' }, `−${s.pointsDeducted} pts late penalty`),
        sub?.redo && h('p', { class: 'text-warn' }, 'Your instructor asked you to resubmit.'),
        !submittedAt && !graded && h('p', { class: 'faint' }, a.status === 'none' ? 'Nothing to submit online.' : 'Not submitted yet.'),
        full && sub && submittedContent(sub)),
    );
  }

  /** What I turned in: text, URL, and/or files. */
  function submittedContent(/** @type {any} */ sub) {
    const parts = [];
    if (sub.type === 'online_text_entry' && sub.bodyHtml) {
      parts.push(h('details', { class: 'mysub__text' },
        h('summary', null, 'View my text entry'),
        h('div', { class: 'prose prose--tight' }, Gesso.sanitize(sub.bodyHtml))));
    }
    if (sub.url) parts.push(h('a', { class: 'link mysub__url', href: sub.url, target: '_blank', rel: 'noopener noreferrer' }, icon('link', { size: 13 }), ` ${sub.url}`));
    if (sub.attachments.length) parts.push(fileList(sub.attachments));
    return parts.length ? h('div', { class: 'mysub__content' }, parts) : null;
  }

  function fileList(/** @type {any[]} */ files) {
    return h('ul', { class: 'flist flist--compact' }, files.map((f) =>
      h('li', { class: 'frow' },
        h('span', { class: 'frow__icon', 'aria-hidden': 'true' }, icon(/pdf|doc|text/.test(f.contentType) ? 'fileText' : /image/.test(f.contentType) ? 'image' : 'file', { size: 15 })),
        h('span', { class: 'frow__main' },
          f.previewUrl || f.downloadUrl
            ? h('a', { class: 'frow__name', href: f.previewUrl || f.downloadUrl, target: '_blank', rel: 'noopener noreferrer' }, f.name)
            : h('span', { class: 'frow__name' }, f.name)),
        h('span', { class: 'frow__size tabular' }, ui.fileSize(f.size)),
        f.downloadUrl
          ? h('a', { class: 'btn btn--ghost btn--icon btn--sm', href: f.downloadUrl, 'aria-label': `Download ${f.name}`, title: 'Download' }, icon('download', { size: 14 }))
          : h('span'))));
  }

  function datesPanel(/** @type {any} */ a, /** @type {Date} */ now) {
    const row = (/** @type {string} */ label, /** @type {string|null} */ iso) => {
      const d = toDate(iso);
      return h('div', { class: 'kv' },
        h('dt', null, label),
        h('dd', null, d ? [dueLabel(d), h('span', { class: 'faint' }, ` · ${relative(d, now)}`)] : h('span', { class: 'faint' }, '—')));
    };
    return ui.panel({ title: 'Dates', icon: 'calendar' },
      h('dl', { class: 'kvs' },
        row('Due', a.dueAt),
        row('Available from', a.unlockAt),
        row('Available until', a.lockAt)),
      a.staleDue && h('p', { class: 'field__hint', style: { marginTop: '12px' } },
        'These dates are from before this course started — probably left over from a previous term. Check with your instructor for the real due date.'));
  }

  function detailsPanel(/** @type {any} */ a, /** @type {any} */ sub, /** @type {boolean} */ full) {
    const kv = (/** @type {string} */ k, /** @type {any} */ v) => v == null || v === false || v === '' ? null : h('div', { class: 'kv' }, h('dt', null, k), h('dd', null, v));
    const used = sub?.attempt ?? a.submission?.attempt ?? 0;
    const attempts = full
      ? (a.allowedAttempts == null || a.allowedAttempts < 0 ? `${used} used · unlimited` : `${used} of ${a.allowedAttempts} used`)
      : null;
    return ui.panel({ title: 'Details', icon: 'assignment' },
      h('dl', { class: 'kvs' },
        kv('Points', a.points != null ? String(a.points) : '—'),
        kv('Grading', GRADING_LABELS[a.gradingType] || a.gradingType),
        kv('Submit as', a.submissionTypes.map((/** @type {string} */ t) => TYPE_LABELS[t] || t).join(', ') || '—'),
        full && a.allowedExtensions.length > 0 && kv('File types', a.allowedExtensions.map((/** @type {string} */ x) => `.${x}`).join(' ')),
        kv('Attempts', attempts),
        full && a.groupAssignment && kv('Group', 'Group assignment'),
        full && a.peerReviews && kv('Peer review', 'Required'),
        full && a.plagiarismCheck && kv('Plagiarism check', 'Enabled'),
        a.omitFromFinal && kv('Final grade', 'Not counted')));
  }

  function historyPanel(/** @type {any} */ sub) {
    return ui.panel({ title: 'Past attempts', icon: 'clock', count: sub.history.length },
      h('ol', { class: 'attempts' }, [...sub.history].reverse().map((/** @type {any} */ hh) => {
        const at = toDate(hh.submittedAt);
        return h('li', { class: 'attempt' },
          h('span', { class: 'attempt__n' }, `Attempt ${hh.attempt ?? '?'}`),
          h('span', { class: 'faint' }, at ? dueLabel(at) : ''),
          hh.late && ui.pill('Late', 'warn'),
          h('span', { class: 'attempt__score tabular' }, hh.score != null ? String(hh.score) : hh.grade || '—'));
      })));
  }

  const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;

  Gesso.views = Gesso.views || {};
  Gesso.views.assignmentDetail = { render, ensureDetail, rubricPanel };
})();
