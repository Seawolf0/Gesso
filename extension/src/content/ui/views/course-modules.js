// @ts-check
/**
 * Course workspace → Modules tab: collapsible modules with completion state.
 * Completed modules start collapsed; open/closed state is remembered.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const canvas = Gesso.api.canvas;
  const { toDate, dueLabel } = Gesso.time;

  const TYPE_ICON = /** @type {Record<string,string>} */ ({
    Assignment: 'assignment', Quiz: 'quiz', Discussion: 'discussion', Page: 'page',
    File: 'file', ExternalUrl: 'link', ExternalTool: 'tool',
  });

  const STATE_PILL = /** @type {Record<string, [string, any]>} */ ({
    completed: ['Completed', 'ok'], started: ['In progress', 'accent'], unlocked: ['Not started', null], locked: ['Locked', null],
  });

  function requirementLabel(/** @type {any} */ r) {
    switch (r.type) {
      case 'must_view': return 'View';
      case 'must_submit': return 'Submit';
      case 'must_contribute': return 'Contribute';
      case 'must_mark_done': return 'Mark done';
      case 'min_score': return `Score at least ${r.minScore}`;
      case 'min_percentage': return `Score at least ${r.minScore}%`;
      default: return 'Complete';
    }
  }

  /**
   * Module items backed by an assignment open in Gesso's detail view:
   * Assignment items via content_id; quizzes/discussions when synced
   * coursework links them to an assignment. Everything else opens in Canvas.
   * @param {any} it @param {string} courseId @param {any[]} assignments
   */
  function gessoHref(it, courseId, assignments) {
    if (it.type === 'Assignment' && it.contentId) return Gesso.derive.assignmentHref(courseId, it.contentId);
    if (it.type === 'Quiz' && it.contentId) {
      const a = assignments.find((x) => x.quizId === it.contentId);
      if (a) return Gesso.derive.assignmentHref(courseId, a.id);
    }
    if (it.type === 'Discussion' && it.contentId) {
      const a = assignments.find((x) => x.discussionId === it.contentId);
      if (a) return Gesso.derive.assignmentHref(courseId, a.id);
    }
    return null;
  }

  function itemRow(/** @type {any} */ it, /** @type {string} */ courseId, /** @type {any[]} */ assignments) {
    if (it.type === 'SubHeader') {
      return h('li', { class: 'mitem mitem--header', style: { '--indent': String(it.indent) } }, it.title);
    }
    const due = toDate(it.dueAt);
    const inGesso = gessoHref(it, courseId, assignments);
    const href = inGesso || it.url;
    const newTab = !inGesso && it.newTab;
    const title = href && !it.locked
      ? h('a', { class: 'mitem__title', href, target: newTab ? '_blank' : undefined, rel: newTab ? 'noopener noreferrer' : undefined, 'data-fkey': `mitem:${it.id}` },
        it.title, newTab && icon('external', { size: 12, class: 'mitem__ext' }))
      : h('span', { class: 'mitem__title' }, it.title);
    return h('li', { class: ['mitem', it.locked && 'mitem--locked'], style: { '--indent': String(it.indent) } },
      h('span', { class: 'mitem__icon', 'aria-hidden': 'true' }, icon(it.locked ? 'lock' : TYPE_ICON[it.type] || 'page', { size: 14 })),
      h('span', { class: 'mitem__main' },
        title,
        (due || it.points != null) && h('span', { class: 'mitem__meta' },
          [due && `Due ${dueLabel(due)}`, it.points != null && `${it.points} pts`].filter(Boolean).join(' · '))),
      it.requirement && h('span', {
        class: ['mitem__req', it.requirement.done && 'mitem__req--done'],
        title: `${requirementLabel(it.requirement)}${it.requirement.done ? ' — done' : ''}`,
      },
        icon(it.requirement.done ? 'checkCircle' : 'circle', { size: 15 }),
        h('span', { class: 'mitem__req-label' }, requirementLabel(it.requirement)),
        h('span', { class: 'sr-only' }, it.requirement.done ? '(completed)' : '(not completed)')),
    );
  }

  /** @param {{ course: any, state: any, rerender: () => void }} ctx */
  function render({ course, state, rerender }) {
    const assignments = state.data.coursework?.[course.id]?.assignments || [];
    const key = `modules:${course.id}`;
    const fetcher = () => canvas.getModules(course.id).then((ms) => ms.map(Gesso.normalize.module));
    const res = Gesso.resources.ensure(key, fetcher);
    const pending = ui.resourceState(res, { onRetry: () => Gesso.resources.load(key, fetcher) });
    if (pending) return h('div', { class: 'panel' }, pending);
    /** @type {any[]} */
    const modules = res.data;
    if (!modules.length) {
      return h('div', { class: 'panel' }, ui.emptyState({ icon: 'book', title: 'No modules', body: "This course doesn't use modules (or hasn't published any)." }));
    }

    const prefKey = `modules.open.${course.id}`;
    /** @type {Record<string, boolean>} */
    const openMap = { ...Gesso.prefs.get(prefKey, {}) };
    const isOpen = (/** @type {any} */ m) => openMap[m.id] ?? m.state !== 'completed';
    const setAll = (/** @type {boolean} */ open) => {
      for (const m of modules) openMap[m.id] = open;
      Gesso.prefs.set(prefKey, openMap);
      rerender();
    };
    const completed = modules.filter((m) => m.state === 'completed').length;
    const tracked = modules.some((m) => m.state);

    return h('div', { class: 'modules' },
      h('div', { class: 'modules__bar' },
        h('span', { class: 'muted' }, tracked ? `${completed} of ${modules.length} modules complete` : `${modules.length} modules`),
        h('span', { style: { flex: '1' } }),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => setAll(true), 'data-fkey': 'mod-expand' }, 'Expand all'),
        h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: () => setAll(false), 'data-fkey': 'mod-collapse' }, 'Collapse all')),
      modules.map((m) => {
        const req = m.items.filter((/** @type {any} */ i) => i.requirement);
        const done = req.filter((/** @type {any} */ i) => i.requirement.done).length;
        const [stateLabel, tone] = STATE_PILL[m.state] || [null, null];
        const details = /** @type {HTMLDetailsElement} */ (h('details', { class: 'module', open: isOpen(m) },
          h('summary', { class: 'module__head', 'data-fkey': `mod:${m.id}` },
            icon('chevronDown', { size: 16, class: 'module__chev' }),
            h('span', { class: 'module__name' }, m.name),
            req.length > 0 && h('span', { class: 'module__progress', 'aria-label': `${done} of ${req.length} requirements complete` },
              h('span', { class: 'meter' }, h('span', { class: 'meter__fill', style: { width: `${(done / req.length) * 100}%` } })),
              h('span', { class: 'tabular' }, `${done}/${req.length}`)),
            stateLabel && ui.pill(stateLabel, tone, m.state === 'locked' ? 'lock' : undefined)),
          m.state === 'locked' && m.unlockAt && h('p', { class: 'module__note' }, `Unlocks ${dueLabel(/** @type {Date} */ (toDate(m.unlockAt)))}`),
          m.items.length
            ? h('ul', { class: 'mitems' }, m.items.map((/** @type {any} */ it) => itemRow(it, course.id, assignments)))
            : h('p', { class: 'module__note' }, 'No items.'),
        ));
        details.addEventListener('toggle', () => {
          openMap[m.id] = details.open;
          Gesso.prefs.set(prefKey, openMap);
        });
        return details;
      }),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.courseModules = { render };
})();
