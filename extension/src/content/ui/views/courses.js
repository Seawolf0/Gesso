// @ts-check
/**
 * Courses page: a card grid of active courses, plus a "Manage" mode to
 * reorder (saved to Canvas's dashboard order), hide, and edit each course.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const d = Gesso.derive;
  const { toDate, HOUR, DAY } = Gesso.time;

  let managing = false;

  /** "3 due this week · 1 missing" for a course card. */
  function courseStats(/** @type {any[]} */ items, /** @type {Date} */ now) {
    const week = items.filter((i) => {
      const t = toDate(i.dueAt)?.getTime();
      return t != null && t >= now.getTime() && t < now.getTime() + 7 * DAY && !d.isDone(i);
    }).length;
    const missing = items.filter((i) => i.status === 'missing').length;
    const graded = items.filter((i) => i.status === 'graded').length;
    const parts = [
      week && h('span', null, `${week} due this week`),
      missing && h('span', { class: 'text-danger' }, `${missing} missing`),
      !week && !missing && h('span', null, `${graded} graded`),
    ].filter(Boolean);
    return h('span', { class: 'course-card__stats' }, parts.flatMap((p, i) => (i ? [h('span', { 'aria-hidden': 'true' }, '·'), p] : [p])));
  }

  function render(/** @type {any} */ state, /** @type {any} */ actions) {
    const { data, settings } = state;
    const now = new Date();
    if (!Array.isArray(data.courses)) {
      return h('div', { class: 'course-grid' }, [0, 1, 2, 3].map(() => h('div', { class: 'skel skel-card' })));
    }
    const hiddenIds = settings.hiddenCourses || [];
    const all = d.sortedCourses(data);
    const visible = all.filter((c) => !hiddenIds.includes(c.id));
    const hidden = all.filter((c) => hiddenIds.includes(c.id));
    const items = d.workItems(data);
    const byCourse = (/** @type {string} */ id) => items.filter((i) => i.courseId === id);
    const nextDue = d.nextDueByCourse(items, now);
    const rerender = () => actions.rerender();

    const head = h('div', { class: 'section-head' },
      h('h2', null, `${visible.length} active ${visible.length === 1 ? 'course' : 'courses'}`),
      h('button', {
        class: ['btn', managing && 'btn--primary'], type: 'button', 'aria-pressed': String(managing), 'data-fkey': 'manage',
        onClick: () => { managing = !managing; rerender(); },
      }, icon(managing ? 'check' : 'pencil', { size: 14 }), managing ? 'Done' : 'Manage courses'));

    if (managing) {
      return h('div', { class: 'courses fade-in' }, head,
        h('p', { class: 'muted', style: { marginBottom: '16px' } }, 'Order is saved to your Canvas dashboard. Hidden courses only disappear from Gesso.'),
        h('ol', { class: 'manage-list' }, all.map((c, idx) => {
          const isHidden = hiddenIds.includes(c.id);
          return h('li', { class: ['manage-row', isHidden && 'manage-row--hidden'] },
            h('span', { class: 'manage-row__swatch', style: { background: Gesso.color.courseGradient(c.color) }, 'aria-hidden': 'true' }),
            h('span', { class: 'manage-row__main' },
              h('span', { class: 'manage-row__name', title: d.courseTooltip(c) }, d.courseTitle(c)),
              h('span', { class: 'faint' }, [c.code, c.term, isHidden && 'Hidden'].filter(Boolean).join(' · '))),
            h('span', { class: 'manage-row__actions' },
              h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': `Move ${d.courseTitle(c)} up`, disabled: idx === 0, 'data-fkey': `up:${c.id}`, onClick: () => Gesso.courseSettings.move(c.id, -1) }, icon('arrowUp', { size: 15 })),
              h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': `Move ${d.courseTitle(c)} down`, disabled: idx === all.length - 1, 'data-fkey': `down:${c.id}`, onClick: () => Gesso.courseSettings.move(c.id, 1) }, icon('arrowDown', { size: 15 })),
              h('button', { class: 'btn btn--ghost btn--icon', type: 'button', 'aria-label': `${isHidden ? 'Show' : 'Hide'} ${d.courseTitle(c)}`, 'aria-pressed': String(isHidden), 'data-fkey': `hide:${c.id}`, onClick: () => Gesso.courseSettings.setHidden(c.id, !isHidden) }, icon(isHidden ? 'eyeOff' : 'eye', { size: 15 })),
              h('button', { class: 'btn btn--sm', type: 'button', 'data-fkey': `edit:${c.id}`, onClick: () => Gesso.courseSettings.open(c) }, 'Edit…')));
        })));
    }

    return h('div', { class: 'courses fade-in' }, head,
      visible.length
        ? h('div', { class: 'course-grid' }, visible.map((c) => ui.courseCard(c, nextDue.get(c.id), now, { extra: courseStats(byCourse(c.id), now) })))
        : h('div', { class: 'panel' }, ui.emptyState({ icon: 'book', title: 'No visible courses', body: hidden.length ? 'All your courses are hidden. Use Manage courses to show them.' : 'Canvas lists no active enrollments for you.' })),
      hidden.length > 0 && h('details', { class: 'hidden-courses' },
        h('summary', null, `Hidden courses (${hidden.length})`),
        h('div', { class: 'course-grid' }, hidden.map((c) => ui.courseCard(c, nextDue.get(c.id), now, { dim: true })))),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.courses = { render };
})();
