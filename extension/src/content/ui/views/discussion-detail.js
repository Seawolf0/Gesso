// @ts-check
/**
 * Discussion summary, shown inside the course workspace at
 *   #/courses/:courseId/discussions/:topicId
 *
 * For ungraded discussions (graded ones are assignments → the assignment
 * detail view; if this topic turns out to be graded we forward there).
 * Shows the prompt, author, to-do date, reply counts, and attachments, with
 * "Reply in Canvas" / "Open in Canvas" — the thread itself lives in Canvas.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const { toDate, dueLabel, relative } = Gesso.time;

  /** @param {any} ctx  the workspace's local state */
  function render(ctx) {
    const { course } = ctx;
    const tid = String(ctx.focusItem);
    const key = `discussion:${course.id}:${tid}`;
    const fetcher = () => Gesso.api.canvas.getDiscussionTopic(course.id, tid).then((raw) => Gesso.normalize.discussionTopic(raw, course.id));
    const res = Gesso.resources.ensure(key, fetcher, { ttl: 5 * 60_000 });
    const nativeUrl = `${course.url}/discussion_topics/${tid}`;

    if (!res.data) {
      if (res.error) {
        return h('div', { class: 'panel' }, ui.emptyState({
          icon: 'discussion', title: "This discussion isn't available",
          body: res.error.kind === 'forbidden' || res.error.kind === 'not_found' ? 'It may be locked, unpublished, or not assigned to you.' : res.error.message,
          action: h('a', { class: 'btn btn--sm', href: nativeUrl }, 'Open in Canvas', icon('external', { size: 12 })),
        }));
      }
      return h('div', { class: 'stack' }, h('div', { class: 'skel', style: { height: '120px', borderRadius: '16px' } }), h('div', { class: 'skel', style: { height: '240px', borderRadius: '16px' } }));
    }

    const t = res.data;
    // Graded discussions are assignments: show the assignment detail instead.
    if (t.assignmentId) {
      queueMicrotask(() => location.replace(Gesso.derive.assignmentHref(course.id, t.assignmentId)));
      return h('div', { class: 'skel', style: { height: '120px', borderRadius: '16px' } });
    }

    const now = new Date();
    const posted = toDate(t.postedAt);
    const todo = toDate(t.todoDate);
    const staleTodo = Gesso.derive.isStaleDate(t.todoDate, course, now);

    return h('article', { class: 'adetail', 'aria-labelledby': 'detail-title' },
      h('nav', { class: 'adetail__crumbs', 'aria-label': 'Breadcrumb' },
        Gesso.nav?.previous && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => history.back(), 'data-fkey': 'detail-back' }, icon('arrowLeft', { size: 14 }), 'Back'),
        h('a', { class: 'crumbs__btn', href: Gesso.router.href(`/courses/${course.id}`) }, course.code || Gesso.derive.courseTitle(course)),
        icon('chevronRight', { size: 12 }),
        h('span', { class: 'crumbs__current truncate', 'aria-current': 'page' }, t.title)),
      h('header', { class: 'adetail__head panel', style: { '--c': course.color } },
        h('span', { class: 'adetail__kind', 'aria-hidden': 'true' }, icon('discussion', { size: 20 })),
        h('div', { class: 'adetail__titles' },
          h('h2', { class: 'adetail__title', id: 'detail-title', tabindex: '-1', 'data-fkey': 'detail-title' }, t.title),
          h('div', { class: 'adetail__meta' },
            h('span', null, 'Discussion · not graded'),
            t.author && h('span', null, `Posted by ${t.author}`),
            posted && h('span', { title: dueLabel(posted) }, relative(posted, now)),
            h('span', null, `${t.replies} ${t.replies === 1 ? 'reply' : 'replies'}`),
            t.unread > 0 && ui.pill(`${t.unread} unread`, 'accent'))),
        h('div', { class: 'adetail__actions' },
          !t.locked && h('a', { class: 'btn btn--primary', href: t.url, 'data-fkey': 'detail-primary' }, 'Reply in Canvas', icon('external', { size: 13 })),
          h('a', { class: 'btn', href: t.url, 'data-fkey': 'detail-open' }, 'Open in Canvas', icon('external', { size: 13 })))),
      t.locked && h('div', { class: 'banner banner--warn', role: 'status' }, icon('lock', { size: 18 }),
        h('div', { class: 'banner__text' }, h('p', { class: 'banner__title' }, 'Locked'),
          t.lockExplanation ? h('div', { class: 'banner__body prose prose--tight' }, Gesso.sanitize(t.lockExplanation)) : null)),
      h('div', { class: 'adetail__grid' },
        h('div', { class: 'stack' },
          ui.panel({ title: 'Prompt', icon: 'fileText' },
            t.html.trim() ? h('div', { class: 'prose' }, Gesso.sanitize(t.html)) : h('p', { class: 'faint' }, 'No prompt text.'),
            t.attachments.length > 0 && h('ul', { class: 'flist flist--compact' }, t.attachments.map((/** @type {any} */ f) =>
              h('li', { class: 'frow' },
                h('span', { class: 'frow__icon', 'aria-hidden': 'true' }, icon('file', { size: 15 })),
                h('span', { class: 'frow__main' }, h('a', { class: 'frow__name', href: f.downloadUrl || t.url, target: '_blank', rel: 'noopener noreferrer' }, f.name)),
                h('span', { class: 'frow__size tabular' }, ui.fileSize(f.size)), h('span')))))),
        h('aside', { class: 'stack', 'aria-label': 'Discussion details' },
          ui.panel({ title: 'Details', icon: 'calendar' },
            h('dl', { class: 'kvs' },
              h('div', { class: 'kv' }, h('dt', null, 'To-do date'),
                h('dd', null, todo ? [dueLabel(todo), !staleTodo && h('span', { class: 'faint' }, ` · ${relative(todo, now)}`)] : h('span', { class: 'faint' }, '—'))),
              h('div', { class: 'kv' }, h('dt', null, 'Replies'), h('dd', null, String(t.replies))),
              t.requireInitialPost && h('div', { class: 'kv' }, h('dt', null, 'Note'), h('dd', null, 'You must post before you can see replies.'))),
            staleTodo && h('p', { class: 'field__hint', style: { marginTop: '12px' } },
              'This to-do date is from before the course started — probably left over from a previous term.')))),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.discussionDetail = { render };
})();
