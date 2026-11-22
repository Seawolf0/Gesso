// @ts-check
/**
 * The sortable, groupable assignments table. Used by the Assignment center
 * and by each course workspace's Assignments tab.
 *
 * A real <table> for screen readers. Every row also works as a big click
 * target: clicking anywhere opens the item — Gesso's assignment detail
 * view when there's one, else native Canvas (⌘-click → new tab) — while
 * keyboard users tab to the title link inside.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const q = Gesso.query;
  const { toDate, relative, dueLabel } = Gesso.time;

  /**
   * @typedef {'title'|'course'|'due'|'points'|'status'|'grade'|'priority'} SortKey
   * @typedef {{ key: SortKey, dir: 'asc'|'desc' }} Sort
   */

  const COLUMNS = /** @type {{ key: SortKey, label: string, cls?: string }[]} */ ([
    { key: 'title', label: 'Assignment' },
    { key: 'course', label: 'Course', cls: 'col-course' },
    { key: 'due', label: 'Due' },
    { key: 'points', label: 'Points', cls: 'num col-points' },
    { key: 'status', label: 'Status' },
    { key: 'grade', label: 'Grade', cls: 'num' },
    { key: 'priority', label: 'Priority', cls: 'col-priority' },
  ]);

  const PRIORITY_TONE = /** @type {Record<string, any>} */ ({ high: 'danger', medium: 'warn', low: null });

  /** Clicking anywhere on a row follows its link. */
  function onTableClick(/** @type {MouseEvent} */ e) {
    const target = /** @type {Element} */ (e.target);
    if (target.closest('a, button, input, label')) return;
    const tr = target.closest('tr[data-href]');
    const href = tr?.getAttribute('data-href');
    if (!href) return;
    // Gesso routes are "#/…" hashes; resolve them against this page for new tabs.
    if (e.metaKey || e.ctrlKey) window.open(new URL(href, location.href).toString(), '_blank', 'noopener');
    else location.href = href;
  }

  /**
   * @param {{
   *   items: any[], sort: Sort, groupBy: 'none'|'day'|'course'|'status'|'group',
   *   courseById: Map<string, any>, groupById?: Map<string, any>,
   *   onSort: (key: SortKey) => void, hideCourse?: boolean, now?: Date, caption: string,
   *   highlightKey?: string|null,
   * }} o
   */
  function render({ items, sort, groupBy, courseById, groupById, onSort, hideCourse = false, now = new Date(), caption, highlightKey = null }) {
    const cols = COLUMNS.filter((c) => !(hideCourse && c.key === 'course'));
    // Default due-ascending sort → timeline sections (Overdue, Upcoming, …); see query.js.
    const layout = q.layoutItems(items, sort, groupBy, { courseById, groupById, now });

    const head = h('thead', null, h('tr', null, cols.map((c) => {
      const active = sort.key === c.key;
      return h('th', {
        scope: 'col', class: c.cls,
        'aria-sort': active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none',
      },
        h('button', { class: ['th-btn', active && 'th-btn--active'], type: 'button', onClick: () => onSort(c.key), 'data-fkey': `sort:${c.key}` },
          c.label,
          icon(active ? (sort.dir === 'asc' ? 'arrowUp' : 'arrowDown') : 'sort', { size: 12, class: 'th-btn__icon' })));
    })));

    const bodies = layout.flatMap(({ section, groups }) => {
      const showGroupRows = groups.length > 1 || (groups[0] && groups[0].key !== 'all');
      return [
        section && h('tbody', { class: `section section--${section.key}` },
          h('tr', { class: 'section-row' },
            h('th', { colspan: String(cols.length), scope: 'colgroup' },
              h('span', { class: 'section-row__label' }, section.label),
              h('span', { class: 'section-row__count' }, String(section.count))))),
        ...groups.map((g) => h('tbody', null,
          showGroupRows && h('tr', { class: 'group-row' },
            h('th', { colspan: String(cols.length), scope: 'colgroup' },
              h('span', { class: 'group-row__label' }, g.label),
              g.sublabel && h('span', { class: 'group-row__sub' }, g.sublabel),
              h('span', { class: 'group-row__count' }, String(g.items.length)))),
          g.items.map((i) => row(i, courseById.get(i.courseId), cols, now, i.key === highlightKey)),
        )),
      ];
    });

    const table = h('table', { class: 'atable' },
      h('caption', { class: 'sr-only' }, caption),
      h('colgroup', null, cols.map((c) => h('col', { class: `colw-${c.key}` }))),
      head, bodies);
    table.addEventListener('click', onTableClick);
    return h('div', { class: 'atable-wrap' }, table);
  }

  /** One assignment row. */
  function row(/** @type {any} */ i, /** @type {any} */ course, /** @type {any[]} */ cols, /** @type {Date} */ now, highlighted = false) {
    const due = toDate(i.dueAt);
    const urgency = Gesso.derive.urgency(i, now);
    const done = Gesso.derive.isDone(i);
    const prio = q.priority(i, now);
    const pct = i.score != null && i.points ? Math.round((i.score / i.points) * 1000) / 10 : null;
    const href = Gesso.derive.itemHref(i); // Gesso detail view when backed by an assignment
    const snoozed = Gesso.plannerUi?.snoozeLabel(i, now);

    /** @type {Record<string, any>} */
    const cells = {
      // Flex layout lives on an inner div: display:flex on a <td> breaks table layout.
      title: h('td', null, h('div', { class: 'atitle' },
        h('span', { class: 'atitle__icon', 'aria-hidden': 'true' }, icon(ui.kindIcon(i.kind), { size: 14 })),
        h('span', { class: 'atitle__main' },
          href
            ? h('a', { class: 'atitle__link', href, 'data-fkey': `row:${i.key}` }, i.title)
            : i.kind === 'note' && Gesso.plannerUi
              ? h('button', { class: 'atitle__link btn-plain', type: 'button', 'data-fkey': `row:${i.key}`, onClick: () => Gesso.plannerUi.openTodo(i) }, i.title)
              : h('span', { class: 'atitle__link' }, i.title),
          (i.late || i.markedComplete || i.locked || snoozed) && h('span', { class: 'atitle__tags' },
            i.late && i.status !== 'late' && ui.pill('Late', 'warn'),
            i.markedComplete && ui.pill('Marked done', 'ok', 'check'),
            snoozed && ui.pill(snoozed, null, 'clock'),
            i.locked && ui.pill('Locked', null, 'lock'))),
        Gesso.plannerUi?.rowActions(i))),
      course: h('td', { class: 'col-course' },
        h('span', { class: 'acourse' },
          h('span', { class: 'dot', style: { '--c': course?.color || 'var(--text-3)' }, 'aria-hidden': 'true' }),
          h('span', { class: 'truncate' }, course ? course.code || course.name : 'Personal'))),
      due: h('td', { class: 'adue' },
        due
          ? [h('span', { class: ['adue__rel', !done && `adue__rel--${urgency}`] }, relative(due, now)),
            h('span', { class: 'adue__abs' }, dueLabel(due))]
          : i.staleDueAt
            // A date left over from a previous term (copied course) — not "944 days ago".
            ? [h('span', { class: 'adue__rel faint' }, 'No current due date'),
              h('span', { class: 'adue__abs', title: 'This date is from before the course started — likely left over from a previous term.' },
                `Canvas date: ${dueLabel(/** @type {Date} */ (toDate(i.staleDueAt)))}`)]
            : h('span', { class: 'faint' }, 'No due date')),
      points: h('td', { class: 'num col-points tabular' }, i.points != null ? String(i.points) : '—'),
      status: h('td', null, ui.statusPill(i.status)),
      grade: h('td', { class: 'num tabular' },
        i.gradePending ? h('span', { class: 'faint', title: 'Graded, not yet posted by the instructor' }, 'Pending')
          : [h('span', { class: 'agrade' }, ui.scoreText(i.score, i.points, i.grade, i.gradingType)),
            pct != null && i.gradingType === 'points' && h('span', { class: 'agrade__pct' }, `${pct}%`)]),
      priority: h('td', { class: 'col-priority' },
        prio.level === 'none' ? h('span', { class: 'faint' }, '—') : ui.pill(prio.label, PRIORITY_TONE[prio.level])),
    };
    return h('tr', {
      class: ['arow', done && 'arow--done', highlighted && 'arow--highlight'], 'data-href': href || undefined,
      'aria-current': highlighted ? 'true' : undefined,
      style: { '--c': course?.color || 'var(--text-3)' },
    }, cols.map((c) => cells[c.key]));
  }

  Gesso.assignmentTable = { render, COLUMNS };
})();
