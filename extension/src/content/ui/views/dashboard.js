// @ts-check
/**
 * Unified dashboard: greeting, stats, course cards, overdue, due soon,
 * what's new, and announcements.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const d = Gesso.derive;
  const { toDate, fmt, dayLabel, dayDiff, HOUR } = Gesso.time;
  const { splitFeed } = Gesso.changes;

  /**
   * @param {any} state
   * @param {{ onRefresh: () => void, onMarkSeen: () => void }} actions
   */
  function render(state, actions) {
    const { data, sync, settings, visit, meta } = state;
    const now = new Date();

    // No cache yet and the first sync hasn't produced courses.
    if (!Array.isArray(data.courses)) {
      if (sync.error) {
        return h('div', { class: 'dash' },
          ui.errorBanner(sync.error, { onRetry: actions.onRefresh, hasCache: false }),
          ui.emptyState(sync.error.kind === 'auth'
            ? { icon: 'logout', title: 'Nothing to show yet', body: 'Your courses and deadlines will appear here once you log in to Canvas.' }
            : { icon: 'wifiOff', title: 'Nothing to show yet', body: 'Once Canvas responds, your courses and deadlines will appear here.' }));
      }
      return skeleton(data.user, now);
    }

    const hidden = settings.hiddenCourses || [];
    const courses = d.visibleCourses(data, hidden);
    const courseById = new Map(courses.map((c) => [c.id, c]));
    const items = d.workItems(data, hidden);
    const soon = d.dueSoon(items, settings.dueSoonDays, now);
    const late = d.overdue(items, now);
    const next48 = soon.todo.filter((i) => (toDate(i.dueAt)?.getTime() ?? 0) - now.getTime() < 48 * HOUR).length;
    const unread = (data.announcements || []).filter((/** @type {any} */ a) => !a.read && courseById.has(a.courseId)).length;
    const courseworkLoading = data.coursework == null;

    return h('div', { class: 'dash' },
      sync.error && ui.errorBanner(sync.error, { onRetry: actions.onRefresh, hasCache: true, syncedAt: meta?.syncedAt?.all }),
      header(data.user, now, next48, late.length, courseworkLoading),
      stats({ next48, week: soon.todo.length, overdue: late.length, unread, loading: courseworkLoading, days: settings.dueSoonDays }),
      coursesSection(courses, d.nextDueByCourse(items, now), now),
      h('div', { class: 'dash-grid' },
        h('div', { class: 'stack' },
          late.length > 0 && overduePanel(late, courseById, now),
          dueSoonPanel(soon, courseById, settings.dueSoonDays, courseworkLoading, now),
        ),
        h('div', { class: 'stack' },
          whatsNewPanel(splitFeed(data.feed, visit), courseById, actions, courseworkLoading),
          announcementsPanel(d.recentAnnouncements(data, 6, hidden), courseById, unread),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Header + stats
  // ---------------------------------------------------------------------------

  function header(/** @type {any} */ user, /** @type {Date} */ now, /** @type {number} */ next48, /** @type {number} */ overdueCount, /** @type {boolean} */ loading) {
    let sub = 'Loading your coursework…';
    if (!loading) {
      const parts = [];
      if (next48) parts.push(`${next48} ${next48 === 1 ? 'thing' : 'things'} due in the next 48 hours`);
      if (overdueCount) parts.push(`${overdueCount} overdue`);
      sub = parts.length ? `You have ${parts.join(' and ')}.` : 'Nothing due in the next 48 hours. Nice.';
    }
    return h('header', { class: 'dash-head' },
      h('div', null,
        h('h1', { class: 'greet__title' }, `${Gesso.time.greeting(now)}${user?.firstName ? `, ${user.firstName}` : ''}`),
        h('p', { class: 'greet__sub' }, sub),
      ),
      h('div', { class: 'date-chip', 'aria-label': fmt.longDate.format(now) },
        h('span', { class: 'date-chip__day', 'aria-hidden': 'true' }, String(now.getDate())),
        h('span', { 'aria-hidden': 'true' },
          h('span', { class: 'date-chip__weekday', style: { display: 'block' } }, fmt.weekdayLong.format(now)),
          h('span', { class: 'date-chip__month' }, now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        ),
      ),
    );
  }

  function stats(/** @type {{ next48: number, week: number, overdue: number, unread: number, loading: boolean, days: number }} */ s) {
    const tile = (/** @type {string} */ iconName, /** @type {string|null} */ tone, /** @type {any} */ value, /** @type {string} */ label) =>
      h('div', { class: ['stat', tone && `stat--${tone}`] },
        h('span', { class: 'stat__icon' }, icon(iconName, { size: 18 })),
        h('div', null,
          h('div', { class: 'stat__value' }, s.loading ? '–' : String(value)),
          h('div', { class: 'stat__label' }, label)));
    return h('div', { class: 'stats' },
      tile('clock', s.next48 ? 'warn' : null, s.next48, 'Due in 48 hours'),
      tile('calendar', 'accent', s.week, `Due in ${s.days} days`),
      tile(s.overdue ? 'alert' : 'checkCircle', s.overdue ? 'danger' : 'ok', s.overdue, 'Overdue'),
      tile('megaphone', s.unread ? 'accent' : null, s.unread, 'Unread announcements'),
    );
  }

  // ---------------------------------------------------------------------------
  // Courses
  // ---------------------------------------------------------------------------

  function coursesSection(/** @type {any[]} */ courses, /** @type {Map<string, any>} */ nextDue, /** @type {Date} */ now) {
    return h('section', { 'aria-labelledby': 'courses-title' },
      h('div', { class: 'section-head' },
        h('h2', { id: 'courses-title' }, 'Courses'),
        h('span', { class: 'faint' }, `${courses.length} active`)),
      courses.length
        ? h('div', { class: 'course-grid' }, courses.map((c) => ui.courseCard(c, nextDue.get(c.id), now)))
        : h('div', { class: 'panel' }, ui.emptyState({ icon: 'book', title: 'No active courses', body: "Canvas doesn't list any active enrollments for you right now." })),
    );
  }

  // ---------------------------------------------------------------------------
  // Work lists
  // ---------------------------------------------------------------------------

  function overduePanel(/** @type {any[]} */ items, /** @type {Map<string, any>} */ courseById, /** @type {Date} */ now) {
    return ui.panel({ title: 'Overdue & missing', icon: 'alert', count: items.length, id: 'overdue', subtitle: 'Past due and not submitted' },
      h('div', { class: 'work-list' }, items.slice(0, 12).map((i) => ui.workRow(i, courseById.get(i.courseId), now, 'date'))),
      items.length > 12 && h('p', { class: 'done-note' },
        h('a', { class: 'link', href: Gesso.router.href('/assignments?range=overdue') }, `See all ${items.length} in Assignments`)),
    );
  }

  function dueSoonPanel(/** @type {{todo:any[],done:any[],snoozed?:any[]}} */ soon, /** @type {Map<string, any>} */ courseById, /** @type {number} */ days, /** @type {boolean} */ loading, /** @type {Date} */ now) {
    let body;
    if (loading) {
      body = h('div', null, [0, 1, 2, 3].map(() => h('div', { class: 'skel skel-row' })));
    } else if (!soon.todo.length) {
      body = ui.emptyState({
        icon: 'checkCircle',
        title: soon.done.length ? 'All caught up' : 'Nothing due',
        body: soon.done.length ? `Everything due in the next ${days} days is done.` : `No deadlines in the next ${days} days.`,
      });
    } else {
      body = h('div', null,
        d.groupByDay(soon.todo).map((g) =>
          h('div', { class: 'day-group' },
            h('h3', { class: 'day-group__label' },
              dayLabel(g.day, now),
              dayDiff(now, g.day) < 2 && h('span', { class: 'faint' }, Gesso.time.monthDay(g.day))),
            h('div', { class: 'work-list' }, g.items.map((i) => ui.workRow(i, courseById.get(i.courseId), now, 'time'))),
          )),
      );
    }
    return ui.panel({
      title: 'Due soon', icon: 'calendar', id: 'due-soon', count: loading ? null : soon.todo.length,
      subtitle: `Next ${days} days`,
      actions: h('button', { class: 'btn btn--sm', type: 'button', 'data-fkey': 'add-todo', onClick: () => Gesso.plannerUi.openTodo() }, icon('note', { size: 14 }), 'Add to-do'),
    },
      body,
      !loading && soon.done.length > 0 && h('p', { class: 'done-note' }, icon('check', { size: 14 }),
        `${soon.done.length} more already submitted or marked done`),
      !loading && soon.snoozed?.length > 0 && h('p', { class: 'done-note done-note--snoozed' }, icon('clock', { size: 14 }),
        `${soon.snoozed.length} snoozed: `,
        h('a', { class: 'link', href: Gesso.router.href('/assignments') }, 'see them in Assignments')),
    );
  }

  // ---------------------------------------------------------------------------
  // What's new
  // ---------------------------------------------------------------------------

  function feedItem(/** @type {any} */ e, /** @type {any} */ course, /** @type {boolean} */ old) {
    const courseLabel = course ? course.code || course.name : '';
    const iconName = { grade: 'grade', announcement: 'megaphone', assignment_new: 'sparkles', assignment_changed: 'clock' }[/** @type {string} */ (e.type)] || 'sparkles';
    let meta = '';
    let value = null;
    if (e.type === 'grade') {
      meta = 'New grade';
      value = ui.scoreText(e.detail.score, e.detail.points, e.detail.grade, e.detail.gradingType);
    } else if (e.type === 'announcement') {
      meta = e.detail.author ? `Announcement · ${e.detail.author}` : 'Announcement';
    } else if (e.type === 'assignment_new') {
      const due = toDate(e.detail.dueAt);
      meta = due ? `New · due ${Gesso.time.monthDay(due)}` : 'New assignment';
    } else if (e.type === 'assignment_changed') {
      const c = e.detail;
      if (c.dueAt) {
        const to = toDate(c.dueAt.to);
        meta = to ? `Due date moved to ${Gesso.time.dueLabel(to)}` : 'Due date removed';
      } else if (c.points) {
        meta = `Points changed ${c.points.from ?? '—'} → ${c.points.to ?? '—'}`;
      }
    }
    // Announcements and assignments (grades, new/changed) open in Gesso.
    const href = Gesso.changes.feedHref(e);
    const tag = href ? 'a' : 'div';
    return h(tag, { class: ['feed-item', old && 'feed-item--old'], href: href || undefined, 'data-fkey': `feed:${e.id}` },
      h('span', { class: `feed-item__icon feed-item__icon--${e.type}`, 'aria-hidden': 'true' }, icon(iconName, { size: 15 })),
      h('span', { style: { minWidth: '0' } },
        h('span', { class: 'feed-item__title', style: { display: 'block' } }, e.title),
        h('span', { class: 'feed-item__meta', style: { display: 'block' } }, [courseLabel, meta].filter(Boolean).join(' · '))),
      value && h('span', { class: 'feed-item__value' }, value),
    );
  }

  function whatsNewPanel(/** @type {{fresh:any[], earlier:any[]}} */ feed, /** @type {Map<string, any>} */ courseById, /** @type {any} */ actions, /** @type {boolean} */ loading) {
    const { fresh, earlier } = feed;
    let body;
    if (loading && !fresh.length && !earlier.length) {
      body = h('div', null, [0, 1, 2].map(() => h('div', { class: 'skel skel-row' })));
    } else if (!fresh.length && !earlier.length) {
      body = ui.emptyState({ icon: 'sparkles', title: 'Nothing new yet', body: 'New grades, announcements, and assignment changes will show up here after each sync.' });
    } else {
      body = h('div', { class: 'feed' },
        fresh.length === 0 && h('p', { class: 'empty__body', style: { padding: '0 8px 8px' } }, 'Nothing new since your last visit.'),
        fresh.slice(0, 10).map((e) => feedItem(e, courseById.get(e.courseId), false)),
        earlier.length > 0 && h('p', { class: 'feed__divider' }, 'Earlier'),
        earlier.slice(0, fresh.length ? 3 : 6).map((e) => feedItem(e, courseById.get(e.courseId), true)),
      );
    }
    return ui.panel({
      title: "What's new", icon: 'sparkles', id: 'whats-new', count: fresh.length,
      subtitle: 'Since your last visit',
      actions: fresh.length > 0 && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: actions.onMarkSeen }, 'Mark all seen'),
    }, body);
  }

  // ---------------------------------------------------------------------------
  // Announcements
  // ---------------------------------------------------------------------------

  function announcementsPanel(/** @type {any[]} */ list, /** @type {Map<string, any>} */ courseById, /** @type {number} */ unread) {
    const body = list.length
      ? h('div', { class: 'ann-list' }, list.map((a) => {
        const course = courseById.get(a.courseId);
        // Opens in the course workspace (marks it read there), not native Canvas.
        const href = a.courseId ? Gesso.router.href(`/courses/${a.courseId}/announcements/${a.id}`) : a.url;
        return h('a', { class: ['ann-item', !a.read && 'ann-item--unread'], href, 'data-fkey': `ann:${a.id}` },
          !a.read && h('span', { class: 'sr-only' }, 'Unread: '),
          h('span', { class: 'ann-item__title', style: { display: 'block' } }, a.title),
          h('span', { class: 'ann-item__meta' },
            course && h('span', { class: 'dot', style: { '--c': course.color } }),
            h('span', { class: 'truncate' }, [course?.code || course?.name, a.author].filter(Boolean).join(' · ')),
            h('span', { 'aria-hidden': 'true' }, '·'),
            ui.timeAgo(a.postedAt)),
          a.preview && h('span', { class: 'ann-item__preview' }, a.preview),
        );
      }))
      : ui.emptyState({ icon: 'megaphone', title: 'No recent announcements', body: 'Announcements from the last three weeks show up here.' });
    return ui.panel({ title: 'Announcements', icon: 'megaphone', id: 'announcements', count: unread, subtitle: unread ? `${unread} unread` : 'All read' }, body);
  }

  // ---------------------------------------------------------------------------
  // Skeleton (first ever load, no cache)
  // ---------------------------------------------------------------------------

  function skeleton(/** @type {any} */ user, /** @type {Date} */ now) {
    const line = (/** @type {string} */ w, /** @type {string} */ hgt = '12px') => h('div', { class: 'skel skel-line', style: { width: w, height: hgt } });
    return h('div', { class: 'dash', 'aria-busy': 'true', 'aria-label': 'Loading your dashboard' },
      h('header', { class: 'dash-head' },
        h('div', null,
          h('h1', { class: 'greet__title' }, `${Gesso.time.greeting(now)}${user?.firstName ? `, ${user.firstName}` : ''}`),
          h('p', { class: 'greet__sub' }, 'Fetching your courses from Canvas…'))),
      h('div', { class: 'stats' }, [0, 1, 2, 3].map(() => h('div', { class: 'stat' }, h('div', { class: 'skel', style: { width: '40px', height: '40px', borderRadius: '12px' } }), h('div', { style: { flex: '1' } }, line('40%', '18px'), line('70%'))))),
      h('div', { class: 'course-grid' }, [0, 1, 2, 3].map(() => h('div', { class: 'skel skel-card' }))),
      h('div', { class: 'dash-grid' },
        h('div', { class: 'panel' }, line('30%', '16px'), [0, 1, 2, 3, 4].map(() => h('div', { class: 'skel skel-row' }))),
        h('div', { class: 'panel' }, line('40%', '16px'), [0, 1, 2].map(() => h('div', { class: 'skel skel-row' })))),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.dashboard = { render };
})();
