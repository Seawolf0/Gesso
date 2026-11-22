// @ts-check
/**
 * Peer-review summary, shown inside the course workspace at
 *   #/courses/:courseId/peer-reviews/:assignmentId?request=&reviewee=&anon=
 *
 * Which assignment you're reviewing, whose work (when Canvas tells us), the
 * due date (with where it came from), and the rubric — plus "Open peer
 * review in Canvas", where the actual reviewing happens.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const { toDate, dueLabel, relative } = Gesso.time;

  /** Human wording for where a peer review's due date came from. */
  function sourceLabel(/** @type {string} */ src) {
    if (src.startsWith('assignment peer_reviews_assign_at')) return 'The assignment’s peer-review due date';
    if (src.startsWith('assignment peer-review sub-assignment')) return 'Canvas’s peer-review assignment';
    if (src.startsWith('related assignment')) return `The ${src.replace(/^related assignment /, '')} assignment`;
    return 'Your Canvas planner';
  }

  /** @param {any} ctx  the workspace's local state; ctx.route carries the query */
  function render(ctx) {
    const { course, state, route } = ctx;
    const aid = String(ctx.focusItem);
    const q = route?.query || new URLSearchParams();
    const requestId = q.get('request');
    const revieweeId = q.get('reviewee');
    const anonId = q.get('anon');
    const me = state.data.user?.id;
    const now = new Date();

    // The synced work item (due date + provenance + done state), when present.
    const item = Gesso.derive.workItems(state.data).find((/** @type {any} */ i) =>
      i.kind === 'peer_review' && i.courseId === course.id && (requestId ? i.plannable?.id === requestId : i.review?.parentAssignmentId === aid)) || null;

    const parentRes = Gesso.views.assignmentDetail.ensureDetail(course, aid, me);
    const summary = state.data.coursework?.[course.id]?.assignments?.find((/** @type {any} */ a) => a.id === aid) || null;
    const parent = parentRes.data || summary;

    // Reviewee name: Canvas may not let students list peer reviews — tolerate that.
    const prKey = `peerreviews:${course.id}:${aid}`;
    const prRes = Gesso.resources.ensure(prKey, () => Gesso.api.canvas.getPeerReviews(course.id, aid), { ttl: 10 * 60_000 });
    const mine = (prRes.data || []).filter((/** @type {any} */ r) => String(r.assessor_id) === String(me));
    const match = mine.find((/** @type {any} */ r) => revieweeId && String(r.user_id) === String(revieweeId)) || (mine.length === 1 ? mine[0] : null);
    const anonymous = !!anonId || !!parent?.anonymousPeerReviews;
    const revieweeName = anonymous ? null : match?.user?.display_name || match?.user?.name || null;
    const done = item ? item.status === 'submitted' : match?.workflow_state === 'completed';

    const nativeUrl = item?.url
      || (anonId ? `${course.url}/assignments/${aid}/anonymous_submissions/${anonId}`
        : revieweeId ? `${course.url}/assignments/${aid}/submissions/${revieweeId}` : `${course.url}/assignments/${aid}`);
    const title = parent?.name || item?.title?.replace(/^Peer review: /, '') || 'Assignment';
    const due = toDate(item?.dueAt);
    const stale = toDate(item?.staleDueAt);
    const related = item?.review?.relatedAssignmentId
      ? state.data.coursework?.[course.id]?.assignments?.find((/** @type {any} */ a) => a.id === item.review.relatedAssignmentId) : null;

    return h('article', { class: 'adetail', 'aria-labelledby': 'detail-title' },
      h('nav', { class: 'adetail__crumbs', 'aria-label': 'Breadcrumb' },
        Gesso.nav?.previous && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => history.back(), 'data-fkey': 'detail-back' }, icon('arrowLeft', { size: 14 }), 'Back'),
        h('a', { class: 'crumbs__btn', href: Gesso.router.href(`/courses/${course.id}/assignments`) }, 'All assignments'),
        icon('chevronRight', { size: 12 }),
        h('span', { class: 'crumbs__current truncate', 'aria-current': 'page' }, `Peer review: ${title}`)),
      h('header', { class: 'adetail__head panel', style: { '--c': course.color } },
        h('span', { class: 'adetail__kind', 'aria-hidden': 'true' }, icon('peerReview', { size: 20 })),
        h('div', { class: 'adetail__titles' },
          h('h2', { class: 'adetail__title', id: 'detail-title', tabindex: '-1', 'data-fkey': 'detail-title' }, `Peer review: ${title}`),
          h('div', { class: 'adetail__meta' },
            h('span', null, course.code || Gesso.derive.courseTitle(course)),
            h('span', null, anonymous ? 'Reviewing an anonymous classmate' : revieweeName ? `Reviewing ${revieweeName}` : 'Reviewing a classmate'),
            due && h('span', null, `Due ${dueLabel(due)}`),
            !due && ui.pill('No current due date'),
            done ? ui.pill('Review completed', 'ok', 'check') : ui.pill('To do', 'accent'))),
        h('div', { class: 'adetail__actions' },
          h('a', { class: 'btn btn--primary', href: nativeUrl, 'data-fkey': 'detail-primary' }, 'Open peer review in Canvas', icon('external', { size: 13 })),
          h('a', { class: 'btn', href: Gesso.derive.assignmentHref(course.id, aid), 'data-fkey': 'detail-assignment' }, 'View assignment'))),
      h('div', { class: 'adetail__grid' },
        h('div', { class: 'stack' },
          ui.panel({ title: 'What to do', icon: 'peerReview' },
            h('p', null, `Read ${anonymous ? 'your classmate’s' : revieweeName ? `${revieweeName}’s` : 'your classmate’s'} submission for “${title}” in Canvas, leave comments${parent?.rubric?.length ? ', and fill in the rubric below' : ''}. Reviewing happens in Canvas — the button above opens it.`)),
          parentRes.data && parent.rubric?.length > 0
            ? Gesso.views.assignmentDetail.rubricPanel(parent, null, { subtitle: 'Use this rubric when you review (you fill it in on Canvas)' })
            : !parentRes.data && !parentRes.error && h('div', { class: 'skel', style: { height: '160px', borderRadius: '16px' } })),
        h('aside', { class: 'stack', 'aria-label': 'Peer review details' },
          ui.panel({ title: 'Details', icon: 'calendar' },
            h('dl', { class: 'kvs' },
              h('div', { class: 'kv' }, h('dt', null, 'Due'),
                h('dd', null, due ? [dueLabel(due), h('span', { class: 'faint' }, ` · ${relative(due, now)}`)] : h('span', { class: 'faint' }, 'No current due date'))),
              due && item && h('div', { class: 'kv' }, h('dt', null, 'Date from'), h('dd', null, sourceLabel(item.dateSource))),
              h('div', { class: 'kv' }, h('dt', null, 'Assignment'), h('dd', null, h('a', { class: 'link', href: Gesso.derive.assignmentHref(course.id, aid) }, title))),
              related && h('div', { class: 'kv' }, h('dt', null, 'Graded as'), h('dd', null, h('a', { class: 'link', href: Gesso.derive.assignmentHref(course.id, related.id) }, related.name))),
              h('div', { class: 'kv' }, h('dt', null, 'Anonymous'), h('dd', null, anonymous ? 'Yes' : 'No'))),
            stale && h('p', { class: 'field__hint', style: { marginTop: '12px' } },
              `Canvas lists ${dueLabel(stale)} for this review — from before the course started, so it's probably left over from a previous term.`)))),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.peerReviewDetail = { render };
})();
