// @ts-check
/**
 * Course workspace: header + tabs (Overview, Assignments, Modules, Files,
 * Announcements, Grades). Stateful per course so tab-local UI state (file
 * search, open announcements, sort) survives data refreshes.
 */
(() => {
  const { h, replace } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const d = Gesso.derive;
  const { toDate, dueLabel, relative } = Gesso.time;

  const TABS = [
    ['overview', 'Overview'], ['assignments', 'Assignments'], ['modules', 'Modules'],
    ['files', 'Files'], ['announcements', 'Announcements'], ['grades', 'Grades'],
  ];

  /** @param {{ route: any }} ctx */
  function create({ route }) {
    const courseId = route.params.id;
    const el = h('div', { class: 'workspace fade-in' });
    /** @type {any} */
    let appState = null;

    /**
     * Tab-local state that must survive re-renders. Tab renderers receive
     * this very object as `ctx` (with per-render fields assigned onto it), so
     * their mutations — search text, sort, open announcements — persist.
     */
    const local = /** @type {any} */ ({
      files: { folderId: null, query: '', expanded: new Set() },
      openAnn: new Set(),
      // Sort + grouping for the Assignments tab, saved across courses (prefs `courseAssignments`).
      // Default: due ascending = timeline sections (overdue → upcoming → undated → past).
      ...Gesso.prefs.get('courseAssignments', { aSort: { key: /** @type {any} */ ('due'), dir: /** @type {'asc'|'desc'} */ ('asc') }, aGroup: 'none' }),
      aQuery: '',
      aTimer: 0,
      // Grades tab: what-if scores (never sent to Canvas) and the needed-score calculator.
      gWhatIfOn: false,
      gWhatIf: new Map(),
      gTarget: null,
      gNeedFor: 'all',
      gTimer: 0,
      /** Deep-link target from the URL (announcement id / assignment id). */
      focusItem: null,
      /** data-fkey of an element to scroll to + focus once it exists. */
      pendingTarget: null,
      /** Last route item we acted on, so data refreshes don't re-trigger it. */
      handledItem: null,
    });

    function rerender() { if (appState) render(); }

    /**
     * React to the URL's third segment and query:
     *   /assignments/:id             → assignment detail view (focus its title)
     *   /assignments?highlight=:id   → table with that row highlighted + scrolled to
     *   /announcements/:id           → that announcement open (+ marked read)
     *   /files/:folderId             → that folder
     */
    function applyRouteItem() {
      const { tab, item } = route.params;
      const highlight = route.query?.get('highlight') || null;
      const key = `${tab}/${item || ''}?${route.query?.toString() || ''}`;
      if (tab === 'files') local.files.folderId = item || null; // folder lives in the URL
      if (key === local.handledItem) return;
      local.handledItem = key;
      local.focusItem = item || null;
      local.pendingTarget = null;
      local.pendingNoScroll = false;
      if (tab === 'announcements' && item) {
        local.openAnn.add(item);
        local.pendingTarget = `ann:${item}`;
      } else if ((tab === 'assignments' || tab === 'discussions' || tab === 'peer-reviews') && item) {
        local.pendingTarget = 'detail-title'; // page is already at the top; just move focus
        local.pendingNoScroll = true;
      } else if (tab === 'assignments' && highlight) {
        local.focusItem = highlight;
        local.aQuery = ''; // make sure the highlighted row isn't filtered out
        local.pendingTarget = `row:assignment:${highlight}`;
      }
    }

    /** Scroll to and focus a deep-linked element once it has rendered. */
    function revealPendingTarget() {
      if (!local.pendingTarget) return;
      const target = /** @type {HTMLElement|null} */ (el.querySelector(`[data-fkey="${CSS.escape(local.pendingTarget)}"]`));
      if (!target) return; // data still loading; try again on the next render
      local.pendingTarget = null;
      if (!local.pendingNoScroll) {
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        (target.closest('tr, details') || target).scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
      }
      target.focus({ preventScroll: true });
    }

    function render() {
      const { data, settings } = appState;
      applyRouteItem();
      // "discussions/:id" and "peer-reviews/:assignmentId" are sub-views without their own tab.
      const subView = ['discussions', 'peer-reviews'].includes(route.params.tab) && !!route.params.item ? route.params.tab : null;
      const tab = subView || (TABS.some(([k]) => k === route.params.tab) ? route.params.tab : 'overview');
      const course = (data.courses || []).find((/** @type {any} */ c) => c.id === courseId);
      if (!course) {
        replace(el, Array.isArray(data.courses)
          ? h('div', { class: 'panel' }, ui.emptyState({ icon: 'book', title: 'Course not found', body: "It may have ended, or you're no longer enrolled.", action: h('a', { class: 'btn btn--sm', href: '#/courses' }, 'All courses') }))
          : h('div', { class: 'skel', style: { height: '160px', borderRadius: '16px' } }));
        return;
      }
      const now = new Date();
      const items = d.workItems(data).filter((i) => i.courseId === course.id);
      const hidden = (settings.hiddenCourses || []).includes(course.id);
      const unreadAnns = (data.announcements || []).filter((/** @type {any} */ a) => a.courseId === course.id && !a.read).length;
      const todo = items.filter((i) => !d.isDone(i) && toDate(i.dueAt) && /** @type {Date} */ (toDate(i.dueAt)).getTime() >= now.getTime()).length;
      const ctx = Object.assign(local, { course, state: appState, items, now, rerender, route });

      /** @type {any} */
      let panel;
      switch (tab) {
        case 'assignments': panel = route.params.item ? Gesso.views.assignmentDetail.render(ctx) : assignmentsTab(ctx); break;
        case 'modules': panel = Gesso.views.courseModules.render(ctx); break;
        case 'files': panel = Gesso.views.courseFiles.render(ctx); break;
        case 'announcements': panel = Gesso.views.courseAnnouncements.render(ctx); break;
        case 'grades': panel = gradesTab(ctx); break;
        case 'discussions': panel = Gesso.views.discussionDetail.render(ctx); break;
        case 'peer-reviews': panel = Gesso.views.peerReviewDetail.render(ctx); break;
        default: panel = overviewTab(ctx);
      }

      replace(el,
        header(course, hidden),
        ui.navTabs(TABS.map(([k, label]) => ({
          href: Gesso.router.href(`/courses/${course.id}${k === 'overview' ? '' : `/${k}`}`),
          label, current: k === tab,
          count: k === 'assignments' ? todo : k === 'announcements' ? unreadAnns : null,
        })), 'Course sections'),
        h('div', { class: 'workspace__panel', role: 'region', 'aria-label': TABS.find(([k]) => k === tab)?.[1] || (tab === 'peer-reviews' ? 'Peer review' : 'Discussion') }, panel),
      );
      revealPendingTarget();
    }

    return {
      el,
      update(/** @type {any} */ state, /** @type {any} */ r) {
        appState = state;
        route = r;
        render();
      },
    };
  }

  // ---------------------------------------------------------------------------

  function header(/** @type {any} */ c, /** @type {boolean} */ hidden) {
    const grade = d.gradeDisplay(c);
    return h('header', { class: 'ws-head', style: { '--grad': Gesso.color.courseGradient(c.color) } },
      c.imageUrl && h('img', { class: 'ws-head__img', src: c.imageUrl, alt: '', referrerpolicy: 'no-referrer' }),
      h('div', { class: 'ws-head__inner' },
        h('div', { class: 'ws-head__text' },
          h('span', { class: 'course-card__code' }, c.code || 'Course'),
          h('h2', { class: 'ws-head__name', title: d.courseTooltip(c) }, d.courseTitle(c)),
          h('p', { class: 'ws-head__sub' }, [c.term, d.courseEnded(c) && 'Ended', hidden && 'Hidden from Gesso'].filter(Boolean).join(' · '))),
        h('div', { class: 'ws-head__side' },
          h('div', { class: 'ws-grade' },
            h('span', { class: 'ws-grade__primary' }, grade.primary),
            grade.secondary && h('span', { class: 'ws-grade__secondary' }, grade.secondary)),
          h('div', { class: 'ws-head__actions' },
            h('button', { class: 'btn btn--glass', type: 'button', onClick: () => Gesso.courseSettings.open(c), 'data-fkey': 'ws-settings' }, icon('settings', { size: 14 }), 'Settings'),
            h('a', { class: 'btn btn--glass', href: c.url }, 'Canvas', icon('external', { size: 13 }))))),
    );
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  function overviewTab(/** @type {any} */ { course, state, items, now }) {
    const upcoming = items
      .filter((/** @type {any} */ i) => !d.isDone(i) && toDate(i.dueAt) && /** @type {Date} */ (toDate(i.dueAt)).getTime() >= now.getTime())
      .sort((/** @type {any} */ a, /** @type {any} */ b) => /** @type {Date} */ (toDate(a.dueAt)).getTime() - /** @type {Date} */ (toDate(b.dueAt)).getTime())
      .slice(0, 6);
    const missing = d.overdue(items, now);
    const latest = d.recentAnnouncements({ ...state.data, announcements: (state.data.announcements || []).filter((/** @type {any} */ a) => a.courseId === course.id) }, 1)[0];
    const assignments = state.data.coursework?.[course.id]?.assignments || [];
    const graded = assignments.filter((/** @type {any} */ a) => a.status === 'graded').length;
    const countable = assignments.filter((/** @type {any} */ a) => !a.omitFromFinal && a.status !== 'excused' && (a.points ?? 0) > 0).length;
    const grade = d.gradeDisplay(course);
    const base = `/courses/${course.id}`;

    return h('div', { class: 'dash-grid' },
      h('div', { class: 'stack' },
        missing.length > 0 && ui.panel({ title: 'Overdue & missing', icon: 'alert', count: missing.length },
          h('div', { class: 'work-list' }, missing.map((/** @type {any} */ i) => ui.workRow(i, course, now, 'date')))),
        ui.panel({ title: 'Up next', icon: 'calendar', subtitle: 'Next deadlines in this course' },
          upcoming.length
            ? h('div', { class: 'work-list' }, upcoming.map((/** @type {any} */ i) => ui.workRow(i, course, now, 'date')))
            : !assignments.length && !items.length
              ? ui.emptyState({ icon: 'inbox', title: 'No assignments', body: d.courseEnded(course, now) ? 'This course has ended and has no assignments in Canvas.' : "This course doesn't have any assignments in Canvas yet." })
              : ui.emptyState({ icon: 'checkCircle', title: 'Nothing coming up', body: d.courseEnded(course, now) ? 'This course has ended.' : 'No upcoming deadlines in this course.' }),
          h('p', { class: 'done-note' }, h('a', { class: 'link', href: Gesso.router.href(`${base}/assignments`) }, 'All assignments'))),
      ),
      h('div', { class: 'stack' },
        ui.panel({ title: 'Grade at a glance', icon: 'chart' },
          h('div', { class: 'glance' },
            h('span', { class: `glance__big grade--${grade.tone}` }, h('span', { class: 'grade__primary' }, grade.primary)),
            h('div', null,
              h('p', { class: 'muted' }, grade.secondary || (grade.score == null ? 'No grades yet' : '')),
              h('p', { class: 'faint' }, countable ? `${graded} of ${countable} graded assignments` : 'No graded assignments yet'),
              course.grade.periodTitle && h('p', { class: 'faint' }, course.grade.periodTitle))),
          h('p', { class: 'done-note' }, h('a', { class: 'link', href: Gesso.router.href(`${base}/grades`) }, 'Grade details'))),
        ui.panel({ title: 'Latest announcement', icon: 'megaphone' },
          latest
            ? h('div', null,
              h('a', { class: ['ann-item', !latest.read && 'ann-item--unread'], href: Gesso.router.href(`${base}/announcements/${latest.id}`) },
                h('span', { class: 'ann-item__title', style: { display: 'block' } }, latest.title),
                h('span', { class: 'ann-item__meta' }, [latest.author, latest.postedAt && relative(/** @type {Date} */ (toDate(latest.postedAt)), now)].filter(Boolean).join(' · ')),
                latest.preview && h('span', { class: 'ann-item__preview' }, latest.preview)))
            : ui.emptyState({ icon: 'megaphone', title: 'No recent announcements' })),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Assignments (timeline sections by default; optionally by assignment group)
  // ---------------------------------------------------------------------------

  /** Screen-reader caption text for a sort. */
  function sortCaption(/** @type {{ key: string, dir: string }} */ sort) {
    return Gesso.query.isTimeline(sort)
      ? 'overdue first, then upcoming by soonest due date, then undated, then past'
      : `sorted by ${sort.key} ${sort.dir === 'asc' ? 'ascending' : 'descending'}`;
  }

  function assignmentsTab(/** @type {any} */ ctx) {
    const { course, state, items, now, rerender } = ctx;
    const saveSort = () => Gesso.prefs.set('courseAssignments', { aSort: ctx.aSort, aGroup: ctx.aGroup });
    const groups = state.data.coursework?.[course.id]?.groups || [];
    const groupById = new Map(groups.map((/** @type {any} */ g) => [g.id, g]));
    const courseById = new Map([[course.id, course]]);
    const shown = Gesso.query.filterItems(items, { ...Gesso.query.EMPTY_FILTERS, query: ctx.aQuery }, courseById, now);

    if (state.data.coursework == null) return h('div', { class: 'panel' }, [0, 1, 2, 3].map(() => h('div', { class: 'skel skel-row' })));
    return h('div', null,
      h('div', { class: 'toolbar' },
        ui.searchField({
          value: ctx.aQuery, placeholder: `Search ${course.code || 'course'} assignments`, label: 'Search assignments', fkey: 'ws-asearch',
          onInput: (v) => { clearTimeout(ctx.aTimer); ctx.aTimer = window.setTimeout(() => { ctx.aQuery = v; rerender(); }, 90); },
        }),
        groups.length > 1 && ui.selectField({
          label: 'Group by', value: ctx.aGroup, options: [['none', 'No grouping'], ['group', 'Assignment group']], fkey: 'ws-agroup',
          onChange: (v) => { ctx.aGroup = v; saveSort(); rerender(); },
        }),
        h('span', { class: 'muted' }, `${shown.length} items`)),
      shown.length
        ? Gesso.assignmentTable.render({
          items: shown, sort: ctx.aSort, groupBy: groups.length > 1 && ctx.aGroup === 'group' ? 'group' : 'none', courseById, groupById, now, hideCourse: true,
          highlightKey: ctx.focusItem ? `assignment:${ctx.focusItem}` : null,
          caption: `${d.courseTitle(course)} assignments, ${sortCaption(ctx.aSort)}`,
          onSort: (key) => {
            ctx.aSort = {
              key,
              dir: ctx.aSort.key === key ? (ctx.aSort.dir === 'asc' ? 'desc' : 'asc') : (key === 'priority' || key === 'grade' || key === 'points' ? 'desc' : 'asc'),
            };
            saveSort();
            rerender();
          },
        })
        : h('div', { class: 'panel' }, ui.emptyState({ icon: 'assignment', title: ctx.aQuery ? 'No matches' : 'No assignments' })),
    );
  }

  // ---------------------------------------------------------------------------
  // Grades: computed grade vs Canvas, what-if, needed score, trend
  // ---------------------------------------------------------------------------

  const gradesTab = (/** @type {any} */ ctx) => Gesso.courseGrades.render(ctx);

  Gesso.views = Gesso.views || {};
  Gesso.views.course = { create };
})();
