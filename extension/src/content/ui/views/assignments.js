// @ts-check
/**
 * Assignment center: every assignment, quiz, and discussion across every
 * course in one table, with search, filters, grouping, and sorting.
 *
 * Stateful view: the toolbar (search box, selects) is built once so typing is
 * never interrupted; only the chips and results re-render. View state persists
 * via Gesso.prefs (except the search text). The URL can preset filters:
 *   #/assignments?range=overdue   ?status=missing   ?course=<id>
 */
(() => {
  const { h, replace } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const q = Gesso.query;

  const DEFAULTS = {
    // Due ascending = timeline sections: overdue & missing → upcoming (soonest first) → undated → past (query.js).
    sort: /** @type {{key: any, dir: 'asc'|'desc'}} */ ({ key: 'due', dir: 'asc' }),
    groupBy: /** @type {'none'|'day'|'course'|'status'} */ ('day'),
    filters: { ...q.EMPTY_FILTERS },
  };

  const RANGE_OPTIONS = /** @type {[string, string][]} */ ([
    ['all', 'Any date'], ['overdue', 'Past due'], ['today', 'Due today'], ['week', 'Next 7 days'],
    ['month', 'Next 30 days'], ['past30', 'Last 30 days'], ['custom', 'Custom range…'],
  ]);
  const GROUP_OPTIONS = /** @type {[string, string][]} */ ([
    ['day', 'Day'], ['course', 'Course'], ['status', 'Status'], ['none', 'No grouping'],
  ]);
  const KIND_OPTIONS = [['assignment', 'Assignments'], ['quiz', 'Quizzes'], ['discussion', 'Discussions'], ['other', 'Other']];
  const STATUS_CHIPS = ['not_submitted', 'missing', 'submitted', 'late', 'graded', 'excused', 'none'];

  /** @param {{ route: any }} ctx */
  function create({ route }) {
    const saved = Gesso.prefs.get('assignments', DEFAULTS);
    let view = {
      sort: saved.sort,
      groupBy: saved.groupBy,
      filters: { ...q.EMPTY_FILTERS, ...saved.filters, query: '' },
    };
    applyRouteQuery(route.query);

    /** @type {any} */
    let appState = null;

    // ---- persistent toolbar ------------------------------------------------
    let searchTimer = 0;
    const search = ui.searchField({
      value: '', placeholder: 'Search assignments, courses…', label: 'Search assignments', fkey: 'ac-search',
      onInput: (v) => {
        clearTimeout(searchTimer);
        searchTimer = window.setTimeout(() => setFilters({ query: v }), 90);
      },
    });
    const fromInput = /** @type {HTMLInputElement} */ (h('input', { type: 'date', class: 'date-input', 'aria-label': 'From date' }));
    const toInput = /** @type {HTMLInputElement} */ (h('input', { type: 'date', class: 'date-input', 'aria-label': 'To date' }));
    fromInput.value = view.filters.from;
    toInput.value = view.filters.to;
    fromInput.addEventListener('change', () => setFilters({ from: fromInput.value }));
    toInput.addEventListener('change', () => setFilters({ to: toInput.value }));
    const customRange = h('span', { class: 'custom-range', hidden: view.filters.range !== 'custom' },
      fromInput, h('span', { class: 'faint' }, 'to'), toInput);

    const rangeSelect = ui.selectField({
      label: 'Due', value: view.filters.range, options: RANGE_OPTIONS, fkey: 'ac-range',
      onChange: (v) => setFilters({ range: /** @type {any} */ (v) }),
    });
    const groupSelect = ui.selectField({
      label: 'Group by', value: view.groupBy, options: GROUP_OPTIONS, fkey: 'ac-group',
      onChange: (v) => setView({ groupBy: /** @type {any} */ (v) }),
    });

    const summary = h('p', { class: 'acenter__summary', role: 'status', 'aria-live': 'polite' });
    const chipsRegion = h('div', { class: 'filters' });
    const results = h('div', { class: 'acenter__results' });

    const el = h('div', { class: 'acenter fade-in' },
      h('div', { class: 'toolbar' }, search, rangeSelect, customRange, groupSelect),
      chipsRegion,
      summary,
      results,
    );

    // ---- state helpers -----------------------------------------------------
    function applyRouteQuery(/** @type {URLSearchParams} */ params) {
      if (!params) return;
      const range = params.get('range');
      const status = params.get('status');
      const course = params.get('course');
      if (range || status || course) {
        view.filters = {
          ...q.EMPTY_FILTERS,
          range: /** @type {any} */ (range || 'all'),
          statuses: status ? status.split(',') : [],
          courses: course ? course.split(',') : [],
        };
      }
    }

    function persist() {
      const { query, ...filters } = view.filters;
      Gesso.prefs.set('assignments', { sort: view.sort, groupBy: view.groupBy, filters });
    }
    function setView(/** @type {any} */ patch) {
      view = { ...view, ...patch };
      persist();
      renderDynamic();
    }
    function setFilters(/** @type {any} */ patch) {
      setView({ filters: { ...view.filters, ...patch } });
    }
    function toggle(/** @type {'courses'|'statuses'|'kinds'} */ field, /** @type {string} */ value) {
      const set = new Set(view.filters[field]);
      set.has(value) ? set.delete(value) : set.add(value);
      setFilters({ [field]: [...set] });
    }
    function onSort(/** @type {any} */ key) {
      const dir = view.sort.key === key ? (view.sort.dir === 'asc' ? 'desc' : 'asc') : (key === 'priority' || key === 'grade' || key === 'points' ? 'desc' : 'asc');
      setView({ sort: { key, dir } });
    }
    function resetFilters() {
      /** @type {HTMLInputElement} */ (search.querySelector('input')).value = '';
      fromInput.value = '';
      toInput.value = '';
      /** @type {HTMLSelectElement} */ (rangeSelect.querySelector('select')).value = 'all';
      setView({ filters: { ...q.EMPTY_FILTERS } });
    }

    // ---- rendering ---------------------------------------------------------
    /** @type {any[]|null} */
    let lastKey = null;
    let summaryText = '';

    function renderDynamic() {
      if (!appState) return;
      const { data, settings } = appState;
      const now = new Date();
      customRange.hidden = view.filters.range !== 'custom';
      /** @type {HTMLSelectElement} */ (rangeSelect.querySelector('select')).value = view.filters.range;

      if (!Array.isArray(data.courses) || data.coursework == null) {
        replace(summary, 'Loading assignments…');
        replace(results, h('div', { class: 'panel' }, [0, 1, 2, 3, 4, 5].map(() => h('div', { class: 'skel skel-row' }))));
        return;
      }

      const hidden = settings.hiddenCourses || [];
      // Skip rebuilding chips + table (~800 rows can take 20+ ms) when nothing
      // they show has changed: store updates also fire for sync status,
      // resources, visits… Relative times refresh once a minute.
      const key = [data.coursework, data.planner, data.overrides, data.notes, data.courses, hidden, JSON.stringify(view), Math.floor(now.getTime() / 60_000)];
      const same = lastKey && key.every((k, i) => k === lastKey[i]);
      lastKey = key;
      if (same) {
        replace(summary, summaryText);
        if (appState.sync.running) summary.append(' · syncing…');
        return;
      }
      const courses = Gesso.derive.visibleCourses(data, hidden);
      const courseById = new Map(courses.map((c) => [c.id, c]));
      const all = Gesso.derive.workItems(data, hidden);
      // Timeline sort: overdue work ignores the date filter (its section must never be hidden).
      const keepOverdue = q.isTimeline(view.sort);
      const shown = q.filterItems(all, view.filters, courseById, now, { keepOverdue });
      const f = view.filters;
      const overdueKept = keepOverdue && f.range !== 'all' && f.range !== 'overdue'
        ? shown.length - q.filterItems(all, f, courseById, now).length : 0;
      const filtering = !!(f.query || f.courses.length || f.statuses.length || f.kinds.length || f.range !== 'all');

      // Chips (counts are over all items so they don't jump while filtering)
      /** @type {Record<string, number>} */
      const statusCounts = {};
      for (const i of all) statusCounts[i.status] = (statusCounts[i.status] || 0) + 1;
      const hasPersonal = all.some((i) => !i.courseId);

      replace(chipsRegion,
        h('div', { class: 'filters__row', role: 'group', 'aria-label': 'Type' },
          h('span', { class: 'filters__label' }, 'Type'),
          KIND_OPTIONS.map(([v, l]) => ui.chip({ label: l, pressed: f.kinds.includes(v), onClick: () => toggle('kinds', v), fkey: `kind:${v}` }))),
        h('div', { class: 'filters__row', role: 'group', 'aria-label': 'Status' },
          h('span', { class: 'filters__label' }, 'Status'),
          STATUS_CHIPS.filter((s) => statusCounts[s]).map((s) =>
            ui.chip({ label: q.STATUS_LABELS[s], pressed: f.statuses.includes(s), onClick: () => toggle('statuses', s), fkey: `status:${s}`, count: statusCounts[s] }))),
        h('div', { class: 'filters__row', role: 'group', 'aria-label': 'Course' },
          h('span', { class: 'filters__label' }, 'Course'),
          courses.map((c) => ui.chip({ label: c.code || c.name, color: c.color, pressed: f.courses.includes(c.id), onClick: () => toggle('courses', c.id), fkey: `course:${c.id}` })),
          hasPersonal && ui.chip({ label: 'Personal', pressed: f.courses.includes('personal'), onClick: () => toggle('courses', 'personal'), fkey: 'course:personal' }),
          filtering && h('button', { class: 'btn btn--ghost btn--sm filters__reset', type: 'button', onClick: resetFilters, 'data-fkey': 'reset' },
            icon('x', { size: 13 }), 'Clear filters')),
      );

      const undated = shown.filter((i) => !i.dueAt).length;
      summaryText = [
        `${shown.length} of ${all.length} items`,
        undated ? ` · ${undated} without a due date` : '',
        overdueKept ? ` · ${overdueKept} overdue shown regardless of the date filter` : '',
      ].join('');
      replace(summary, summaryText, appState.sync.running ? ' · syncing…' : '');

      replace(results, shown.length
        ? Gesso.assignmentTable.render({
          items: shown, sort: view.sort, groupBy: view.groupBy, courseById, onSort, now,
          caption: q.isTimeline(view.sort)
            ? 'Assignments: overdue first, then upcoming by soonest due date, then undated, then past'
            : `Assignments, sorted by ${view.sort.key} ${view.sort.dir === 'asc' ? 'ascending' : 'descending'}`,
        })
        : h('div', { class: 'panel' }, ui.emptyState({
          icon: filtering ? 'filter' : 'checkCircle',
          title: filtering ? 'No matches' : 'No assignments',
          body: filtering ? 'Try removing a filter or changing the search.' : 'Your active courses have no assignments yet.',
          action: filtering && h('button', { class: 'btn btn--sm', type: 'button', onClick: resetFilters }, 'Clear filters'),
        })));
    }

    return {
      el,
      update(/** @type {any} */ state, /** @type {any} */ r) {
        appState = state;
        if (r && r.query && r.query.toString() && r.query !== route.query) {
          route = r;
          applyRouteQuery(r.query);
        }
        renderDynamic();
      },
      focusSearch() { /** @type {HTMLInputElement} */ (search.querySelector('input')).focus(); },
    };
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.assignments = { create };
})();
