// @ts-check
/**
 * Calendar: week, month, and agenda views of every deadline,
 * planner note, and Canvas calendar event, color-coded by course, with a
 * workload heatmap, per-course filters, a "now" line, and .ics export.
 *
 * Routes (each view has its own URL; prev/next/today are plain links):
 *   #/calendar                       default view (last one used) around today
 *   #/calendar/week/2026-11-15       week starting that Sunday
 *   #/calendar/month/2026-11
 *   #/calendar/agenda/2026-11-18     14 days from that date
 *
 * Keyboard (when focus isn't in a text field or dialog): ← / → previous /
 * next, t today, w / m / a switch views. Every entry is a link or button.
 *
 * Deadlines sit in a "Due" lane at the top of each week-view day, not in the
 * hour grid: most are 11:59 PM and would pile up unreadably at the bottom.
 * The grid holds timed events only.
 *
 * Stateful view: filters, the now-line timer, and focus survive refreshes.
 * Calendar events load on demand per month (`calendar:<yyyy-mm>` resources).
 */
(() => {
  const { h, replace } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const C = Gesso.calendar;
  const { MINUTE, toDate, startOfDay, addDays, dayKey, dayLabel, fmt, shortDate } = Gesso.time;

  const PX_PER_HOUR = 48;
  const EVENTS_TTL = 10 * 60_000;
  const MONTH_CELL_MAX = 3;
  const HEAT_WORDS = ['', 'light', 'moderate', 'busy', 'heavy'];
  const VIEW_LABELS = /** @type {Record<string, [string, string]>} */ ({ week: ['Week', 'w'], month: ['Month', 'm'], agenda: ['Agenda', 'a'] });

  const rangeFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const monthFmt = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
  const hourFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
  const dayNumFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric' });

  /** "11:59 PM" */
  const timeText = (/** @type {Date} */ d) => fmt.time.format(d);

  /** @param {{ route: any }} ctx */
  function create({ route }) {
    const saved = Gesso.prefs.get('calendar', { view: 'week', hidden: [] });
    const local = {
      defaultView: /** @type {any} */ (C.VIEWS.includes(saved.view) ? saved.view : 'week'),
      hidden: new Set(/** @type {string[]} */ (saved.hidden || [])),
      exporting: false,
    };
    /** @type {any} */
    let appState = null;
    let currentRoute = route;
    let wasConnected = false;

    const el = h('div', { class: 'cal fade-in' });

    // ---- keyboard shortcuts -------------------------------------------------
    function onKey(/** @type {KeyboardEvent} */ e) {
      if (!el.isConnected) { if (wasConnected) window.removeEventListener('keydown', onKey); return; }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = /** @type {HTMLElement} */ (e.composedPath()[0]);
      if (target?.closest?.('input, textarea, select, [contenteditable], dialog')) return;
      if (el.getRootNode() instanceof ShadowRoot && /** @type {ShadowRoot} */ (el.getRootNode()).querySelector('dialog[open]')) return;
      const { view, anchor } = resolve(currentRoute);
      /** @type {string|null} */
      let path = null;
      if (e.key === 'ArrowLeft') path = C.routeFor(view, C.step(view, anchor, -1));
      else if (e.key === 'ArrowRight') path = C.routeFor(view, C.step(view, anchor, 1));
      else if (e.key === 't') path = C.routeFor(view, new Date());
      else if (e.key === 'w' || e.key === 'm' || e.key === 'a') path = C.routeFor(e.key === 'w' ? 'week' : e.key === 'm' ? 'month' : 'agenda', anchor);
      if (!path) return;
      e.preventDefault();
      Gesso.router.go(path);
    }
    window.addEventListener('keydown', onKey);

    // Keep the "now" line (and "today") current.
    const timer = window.setInterval(() => {
      if (el.isConnected) { wasConnected = true; render(); } else if (wasConnected) window.clearInterval(timer);
    }, 60_000);

    /** View + anchor date from the route (bare #/calendar → default view, today). */
    function resolve(/** @type {any} */ r) {
      const view = /** @type {any} */ (C.VIEWS.includes(r.params.view) ? r.params.view : local.defaultView);
      const anchor = startOfDay(C.parseDay(r.params.date) || new Date());
      return { view, anchor };
    }

    function savePrefs() {
      Gesso.prefs.set('calendar', { view: local.defaultView, hidden: [...local.hidden] });
    }

    function toggleSource(/** @type {string} */ key) {
      local.hidden.has(key) ? local.hidden.delete(key) : local.hidden.add(key);
      savePrefs();
      render();
    }

    function showAll() {
      local.hidden.clear();
      savePrefs();
      render();
    }

    // ---- data -----------------------------------------------------------------

    /** Context codes for events: visible courses + the personal calendar. */
    function contextCodes(/** @type {any[]} */ courses, /** @type {any} */ user) {
      return [...courses.map((c) => `course_${c.id}`), ...(user?.id ? [`user_${user.id}`] : [])];
    }

    /**
     * Ensure each month touched by the range is loaded; returns the merged
     * events plus a load status.
     */
    function loadEvents(/** @type {Date} */ start, /** @type {Date} */ end, /** @type {string[]} */ codes) {
      const events = [];
      let loading = false;
      /** @type {string[]} */
      const failed = [];
      for (const mk of C.monthKeys(start, end)) {
        const { start: first, last } = C.monthBounds(mk);
        const res = Gesso.resources.ensure(`calendar:${mk}`,
          () => Gesso.api.canvas.getCalendarEvents(codes, first, last).then((list) => list.map(Gesso.normalize.calendarEvent)),
          { ttl: EVENTS_TTL });
        if (res.data) events.push(...res.data);
        else if (res.error) failed.push(mk);
        else loading = true;
      }
      return { events, loading, failed };
    }

    function retryEvents(/** @type {string[]} */ months) {
      for (const mk of months) Gesso.resources.invalidate(`calendar:${mk}`);
      render();
    }

    // ---- render ---------------------------------------------------------------

    function render() {
      if (!appState) return;
      if (el.isConnected) wasConnected = true;
      const { data, settings } = appState;
      const now = new Date();
      const { view, anchor } = resolve(currentRoute);
      const range = C.viewRange(view, anchor);
      local.lastAnchor = anchor; // "Add to-do" defaults to this day when it's in the future

      if (!Array.isArray(data.courses) || data.coursework == null) {
        replace(el, header(view, anchor, range, now),
          h('div', { class: 'panel' }, [0, 1, 2, 3, 4].map(() => h('div', { class: 'skel skel-row' }))));
        return;
      }

      const courses = Gesso.derive.visibleCourses(data, settings.hiddenCourses || []);
      const courseById = new Map(courses.map((c) => [c.id, c]));
      const items = Gesso.derive.workItems(data, settings.hiddenCourses || []);
      const ev = loadEvents(range.start, range.end, contextCodes(courses, data.user));
      const all = C.mergeEntries({ items, events: ev.events, courseIds: new Set(courseById.keys()) });

      // Counts per source over the visible range (before filtering, so they don't vanish when toggled off).
      /** @type {Record<string, number>} */
      const counts = {};
      for (const e of all) {
        const inRange = e.end ? e.start < range.end && e.end > range.start : e.start >= range.start && e.start < range.end;
        if (inRange) counts[C.sourceKey(e)] = (counts[C.sourceKey(e)] || 0) + 1;
      }
      const shown = all.filter((e) => !local.hidden.has(C.sourceKey(e)));
      const days = C.byDay(shown, range.start, range.end);
      const ctx = { view, anchor, range, now, courseById, days };

      let body;
      if (view === 'month') body = monthView(ctx);
      else if (view === 'agenda') body = agendaView(ctx);
      else body = weekView(ctx);

      replace(el,
        header(view, anchor, range, now),
        h('div', { class: 'cal-layout' },
          sidebar({ courses, counts, undated: C.undatedCount(items), courseById, items, codes: contextCodes(courses, data.user) }),
          h('div', { class: 'cal-main' },
            ev.failed.length > 0 && h('div', { class: 'cal-notice', role: 'status' },
              icon('wifiOff', { size: 14 }),
              h('span', null, "Couldn't load Canvas calendar events. Deadlines are still shown."),
              h('button', { class: 'btn btn--sm', type: 'button', onClick: () => retryEvents(ev.failed), 'data-fkey': 'cal-retry' }, 'Retry')),
            ev.loading && h('p', { class: 'cal-loading faint', role: 'status' }, 'Loading calendar events…'),
            body)),
      );
    }

    /** Title, prev / today / next, and the view switch. */
    function header(/** @type {string} */ view, /** @type {Date} */ anchor, /** @type {{ start: Date, end: Date }} */ range, /** @type {Date} */ now) {
      const v = /** @type {any} */ (view);
      const title = view === 'month' ? monthFmt.format(anchor) : rangeFmt.formatRange(range.start, addDays(range.end, -1));
      const showingToday = now >= range.start && now < range.end;
      const prevPath = C.routeFor(v, C.step(v, anchor, -1));
      const nextPath = C.routeFor(v, C.step(v, anchor, 1));
      const unit = view === 'month' ? 'month' : view === 'agenda' ? `${C.AGENDA_DAYS} days` : 'week';
      return h('div', { class: 'cal-head' },
        h('h2', { class: 'cal-head__title', 'aria-live': 'polite' }, title),
        h('div', { class: 'cal-head__nav' },
          h('a', { class: 'btn btn--icon', href: Gesso.router.href(prevPath), 'aria-label': `Previous ${unit}`, title: `Previous ${unit} (←)`, 'data-fkey': 'cal-prev' }, icon('arrowLeft', { size: 15 })),
          h('a', { class: ['btn', showingToday && 'btn--current'], href: Gesso.router.href(C.routeFor(v, now)), title: 'Today (t)', 'data-fkey': 'cal-today' }, 'Today'),
          h('a', { class: 'btn btn--icon', href: Gesso.router.href(nextPath), 'aria-label': `Next ${unit}`, title: `Next ${unit} (→)`, 'data-fkey': 'cal-next' }, icon('chevronRight', { size: 16 }))),
        h('nav', { class: 'seg', 'aria-label': 'Calendar view' },
          C.VIEWS.map((name) => h('a', {
            class: 'seg__item', href: Gesso.router.href(C.routeFor(name, anchor)),
            'aria-current': name === view ? 'page' : undefined, title: `${VIEW_LABELS[name][0]} (${VIEW_LABELS[name][1]})`, 'data-fkey': `cal-view:${name}`,
          }, VIEW_LABELS[name][0]))),
      );
    }

    /** Course filter toggles with counts, the heat legend, undated count, export. */
    function sidebar(/** @type {any} */ { courses, counts, undated, courseById, items, codes }) {
      const toggle = (/** @type {string} */ key, /** @type {string} */ label, /** @type {string} */ color, /** @type {string} */ title) => {
        const on = !local.hidden.has(key);
        return h('button', {
          class: 'cal-filter', type: 'button', 'aria-pressed': String(on), title, onClick: () => toggleSource(key), 'data-fkey': `cal-filter:${key}`,
          style: { '--c': color },
        },
          h('span', { class: 'cal-filter__box', 'aria-hidden': 'true' }, on && icon('check', { size: 11 })),
          h('span', { class: 'cal-filter__label truncate' }, label),
          h('span', { class: 'cal-filter__count' }, String(counts[key] || 0)));
      };
      return h('aside', { class: 'cal-side', 'aria-label': 'Calendar filters' },
        h('section', { class: 'cal-side__group', 'aria-labelledby': 'cal-courses-h' },
          h('div', { class: 'cal-side__head' },
            h('h3', { class: 'cal-side__title', id: 'cal-courses-h' }, 'Calendars'),
            local.hidden.size > 0 && h('button', { class: 'btn btn--ghost btn--sm', type: 'button', onClick: showAll, 'data-fkey': 'cal-showall' }, 'Show all')),
          h('div', { class: 'cal-side__list' },
            courses.map((/** @type {any} */ c) => toggle(c.id, c.code || Gesso.derive.courseTitle(c), c.color, Gesso.derive.courseTitle(c))),
            // Hidden when there's nothing personal in range, unless it's switched off (so it can be switched back on).
            (counts.personal > 0 || local.hidden.has('personal')) && toggle('personal', 'Personal', 'var(--text-3)', 'Planner notes and personal calendar events'))),
        h('section', { class: 'cal-side__group', 'aria-labelledby': 'cal-heat-h' },
          h('h3', { class: 'cal-side__title', id: 'cal-heat-h' }, 'Workload'),
          h('div', { class: 'cal-legend', 'aria-hidden': 'true' },
            h('span', null, 'Light'), [1, 2, 3, 4].map((n) => h('span', { class: `cal-legend__sw heat-${n}` })), h('span', null, 'Heavy')),
          h('p', { class: 'cal-side__note' }, 'Days shade by open deadlines, weighted by points.')),
        undated > 0 && h('a', { class: 'cal-side__undated', href: Gesso.router.href('/assignments'), 'data-fkey': 'cal-undated' },
          icon('clock', { size: 14 }), h('span', null, `${undated} with no current due date`), icon('chevronRight', { size: 14 })),
        h('button', {
          class: 'btn cal-side__export', type: 'button', 'data-fkey': 'cal-add-todo',
          onClick: () => Gesso.plannerUi.openTodo(undefined, { day: dayKey(local.lastAnchor && local.lastAnchor > new Date() ? local.lastAnchor : new Date()) }),
        }, icon('note', { size: 14 }), 'Add to-do'),
        h('button', {
          class: 'btn cal-side__export', type: 'button', disabled: local.exporting, 'data-fkey': 'cal-export',
          title: 'Download this term\'s deadlines and events for the shown calendars as an .ics file',
          onClick: () => exportIcs({ courses, courseById, items, codes }),
        }, icon('download', { size: 14 }), local.exporting ? 'Exporting…' : 'Export .ics'),
        h('p', { class: 'cal-side__note' }, 'Exports the shown calendars for this term as a file Apple Calendar or Google Calendar can import.'),
      );
    }

    // ---- week -----------------------------------------------------------------

    function weekView(/** @type {any} */ { range, now, courseById, days }) {
      const dayList = C.daysIn(range.start, range.end);
      const todayKey = dayKey(now);
      const perDay = dayList.map((d) => {
        const list = days.get(dayKey(d)) || [];
        const timed = list.filter((/** @type {any} */ e) => e.source === 'event' && !e.allDay);
        const lane = list.filter((/** @type {any} */ e) => !(e.source === 'event' && !e.allDay));
        return { d, list, lane, blocks: C.layoutDay(timed, d), load: C.workload(list) };
      });
      const nowMin = (now.getTime() - startOfDay(now).getTime()) / MINUTE;
      const nowInWeek = now >= range.start && now < range.end;
      const hours = C.hourRange(perDay.flatMap((p) => p.blocks), nowInWeek ? nowMin : null);
      const gridH = (hours.to - hours.from) * PX_PER_HOUR;
      const hourMarks = [];
      for (let hr = hours.from; hr < hours.to; hr++) hourMarks.push(hr);

      return h('div', { class: 'cal-scroll' }, h('div', { class: 'cal-week', style: { '--grid-h': `${gridH}px`, '--hour-h': `${PX_PER_HOUR}px` } },
        // Day headers
        h('div', { class: 'cal-week__corner' }),
        perDay.map(({ d, load }) => h('a', {
          class: ['cal-dayhead', dayKey(d) === todayKey && 'cal-dayhead--today'], href: Gesso.router.href(C.routeFor('agenda', d)),
          'aria-label': `${fmt.longDate.format(d)}${load.count ? `, ${load.count} due` : ''}. Open in agenda.`, 'data-fkey': `cal-dh:${dayKey(d)}`,
        },
          h('span', { class: 'cal-dayhead__wd' }, fmt.weekdayShort.format(d)),
          h('span', { class: 'cal-dayhead__num' }, dayNumFmt.format(d)),
          h('span', { class: `cal-heatbar heat-${load.level}`, 'aria-hidden': 'true' }))),
        // Due lane: deadlines, notes, all-day events
        h('div', { class: 'cal-week__lanelabel' }, 'Due'),
        perDay.map(({ d, lane, load }) => h('div', {
          class: ['cal-lane', `heat-${load.level}`, dayKey(d) === todayKey && 'cal-lane--today'],
          role: 'group', 'aria-label': `${dayLabel(d, now)}: ${lane.length ? `${lane.length} item${lane.length === 1 ? '' : 's'}` : 'nothing due'}${load.level ? `, ${HEAT_WORDS[load.level]} workload` : ''}`,
        }, lane.map((/** @type {any} */ e) => chip(e, d, courseById, now)))),
        // Hour grid
        h('div', { class: 'cal-week__hours', 'aria-hidden': 'true' },
          hourMarks.map((hr) => h('span', { class: 'cal-hour', style: { top: `${(hr - hours.from) * PX_PER_HOUR}px` } },
            hr === 0 ? '' : hourFmt.format(new Date(2000, 0, 1, hr))))),
        perDay.map(({ d, blocks }) => h('div', {
          class: ['cal-col', dayKey(d) === todayKey && 'cal-col--today'], role: 'group',
          'aria-label': `${dayLabel(d, now)}: ${blocks.length ? `${blocks.length} event${blocks.length === 1 ? '' : 's'}` : 'no events'}`,
        },
          blocks.map((b) => eventBlock(b, d, hours.from, courseById)),
          dayKey(d) === todayKey && nowInWeek && h('div', { class: 'cal-now', style: { top: `${(nowMin - hours.from * 60) / 60 * PX_PER_HOUR}px` } },
            h('span', { class: 'sr-only' }, `Now, ${timeText(now)}`)))),
      ));
    }

    /** A timed event placed in the hour grid. */
    function eventBlock(/** @type {any} */ b, /** @type {Date} */ day, /** @type {number} */ fromHour, /** @type {Map<string, any>} */ courseById) {
      const e = b.entry;
      const course = e.courseId ? courseById.get(e.courseId) : null;
      const top = (b.startMin - fromHour * 60) / 60 * PX_PER_HOUR;
      const height = Math.max(18, (b.endMin - b.startMin) / 60 * PX_PER_HOUR - 2);
      const when = e.end ? `${timeText(e.start)} – ${timeText(e.end)}` : timeText(e.start);
      return h('button', {
        class: ['cal-block', height < 32 && 'cal-block--short', b.cols >= 3 && 'cal-block--narrow'], type: 'button',
        style: {
          top: `${top}px`, height: `${height}px`,
          left: `calc(${(b.col / b.cols) * 100}% + 2px)`, width: `calc(${100 / b.cols}% - 4px)`,
          '--c': course?.color || 'var(--text-3)',
        },
        'aria-label': `${e.title}, ${when}${course ? `, ${course.code || course.name}` : ''}${e.event?.location ? `, ${e.event.location}` : ''}`,
        onClick: () => openEvent(e, courseById), 'data-fkey': `cal:${e.key}:${dayKey(day)}`,
      },
        h('span', { class: 'cal-block__title' }, e.title),
        h('span', { class: 'cal-block__meta' }, [when, e.event?.location].filter(Boolean).join(' · ')));
    }

    /** A compact entry: Due lane, month cells. */
    function chip(/** @type {any} */ e, /** @type {Date} */ day, /** @type {Map<string, any>} */ courseById, /** @type {Date} */ now, compact = false) {
      const course = e.courseId ? courseById.get(e.courseId) : null;
      const overdue = e.source === 'deadline' && !e.done && e.start < now;
      const time = e.allDay ? 'All day' : timeText(e.start);
      const label = [
        e.title,
        e.source === 'event' ? (e.allDay ? 'all day' : `at ${time}`) : `due ${time}`,
        course ? course.code || course.name : 'Personal',
        e.points != null ? `${e.points} points` : '',
        e.done ? 'done' : overdue ? (e.status === 'missing' ? 'missing' : 'overdue') : '',
      ].filter(Boolean).join(', ');
      const props = {
        class: ['cal-chip', compact && 'cal-chip--compact', e.done && 'cal-chip--done', overdue && 'cal-chip--overdue', e.source === 'event' && 'cal-chip--event'],
        style: { '--c': course?.color || 'var(--text-3)' },
        'aria-label': label, title: label, 'data-fkey': `cal:${e.key}:${dayKey(day)}`,
      };
      const inner = [
        h('span', { class: 'cal-chip__icon', 'aria-hidden': 'true' },
          icon(e.done ? 'check' : e.source === 'event' ? 'calendar' : ui.kindIcon(e.kind), { size: 12 })),
        !compact && h('span', { class: 'cal-chip__time' }, time),
        h('span', { class: 'cal-chip__title' }, e.title),
      ];
      if (e.source === 'event') return h('button', { ...props, type: 'button', onClick: () => openEvent(e, courseById) }, inner);
      if (e.href) return h('a', { ...props, href: e.href }, inner);
      // To-dos (planner notes) have no page: open the editor (was an inert focusable span).
      if (e.source === 'note' && e.item) return h('button', { ...props, type: 'button', onClick: () => Gesso.plannerUi.openTodo(e.item) }, inner);
      return h('span', props, inner);
    }

    // ---- month ----------------------------------------------------------------

    function monthView(/** @type {any} */ { anchor, range, now, courseById, days }) {
      const month = anchor.getMonth();
      const todayKey = dayKey(now);
      const weekdays = C.daysIn(range.start, addDays(range.start, 7));
      return h('div', { class: 'cal-month' },
        h('div', { class: 'cal-month__wd', 'aria-hidden': 'true' }, weekdays.map((d) => h('span', null, fmt.weekdayShort.format(d)))),
        h('div', { class: 'cal-month__grid' },
          C.daysIn(range.start, range.end).map((d) => {
            const list = days.get(dayKey(d)) || [];
            const load = C.workload(list);
            const extra = list.length - MONTH_CELL_MAX;
            return h('div', {
              class: ['cal-cell', `heat-${load.level}`, d.getMonth() !== month && 'cal-cell--out', dayKey(d) === todayKey && 'cal-cell--today'],
              role: 'group', 'aria-label': `${fmt.longDate.format(d)}: ${list.length ? `${list.length} item${list.length === 1 ? '' : 's'}` : 'nothing'}${load.level ? `, ${HEAT_WORDS[load.level]} workload` : ''}`,
            },
              h('a', { class: 'cal-cell__num', href: Gesso.router.href(C.routeFor('agenda', d)), 'aria-label': `${fmt.longDate.format(d)}, open in agenda`, 'data-fkey': `cal-day:${dayKey(d)}` },
                dayNumFmt.format(d)),
              h('div', { class: 'cal-cell__items' },
                list.slice(0, extra > 0 ? MONTH_CELL_MAX - 1 : MONTH_CELL_MAX).map((/** @type {any} */ e) => chip(e, d, courseById, now, true)),
                extra > 0 && h('a', { class: 'cal-cell__more', href: Gesso.router.href(C.routeFor('agenda', d)), 'data-fkey': `cal-more:${dayKey(d)}` },
                  `+${extra + 1} more`)));
          })));
    }

    // ---- agenda ---------------------------------------------------------------

    function agendaView(/** @type {any} */ { range, now, courseById, days }) {
      const todayKey = dayKey(now);
      const groups = C.daysIn(range.start, range.end)
        .map((d) => ({ d, list: days.get(dayKey(d)) || [] }))
        .filter(({ d, list }) => list.length || dayKey(d) === todayKey);
      if (!groups.some((g) => g.list.length)) {
        return h('div', { class: 'panel' }, ui.emptyState({ icon: 'calendar', title: 'Nothing scheduled', body: 'No deadlines or events in these two weeks for the calendars shown.' }));
      }
      return h('div', { class: 'cal-agenda' }, groups.map(({ d, list }) => {
        const load = C.workload(list);
        const label = dayLabel(d, now);
        const full = shortDate(d);
        return h('section', { class: ['cal-aday', dayKey(d) === todayKey && 'cal-aday--today'], 'aria-label': full },
          h('h3', { class: 'cal-aday__head' },
            h('span', { class: 'cal-aday__label' }, label),
            label !== full && h('span', { class: 'cal-aday__date' }, full),
            load.count > 0 && h('span', { class: 'cal-aday__load' },
              h('span', { class: `cal-heatdot heat-${load.level}`, 'aria-hidden': 'true' }),
              `${load.count} due${load.points ? ` · ${load.points} pts` : ''}`)),
          list.length
            ? h('ul', { class: 'cal-alist' }, list.map((/** @type {any} */ e) => agendaRow(e, d, courseById, now)))
            : h('p', { class: 'cal-aday__empty faint' }, 'Nothing today.'));
      }));
    }

    function agendaRow(/** @type {any} */ e, /** @type {Date} */ day, /** @type {Map<string, any>} */ courseById, /** @type {Date} */ now) {
      const course = e.courseId ? courseById.get(e.courseId) : null;
      const overdue = e.source === 'deadline' && !e.done && e.start < now;
      const time = e.allDay ? 'All day'
        : e.end ? `${timeText(e.start)} – ${timeText(e.end)}`
          : timeText(e.start);
      const titleProps = { class: 'cal-arow__title', 'data-fkey': `cal:${e.key}:${dayKey(day)}` };
      return h('li', { class: ['cal-arow', e.done && 'cal-arow--done'], style: { '--c': course?.color || 'var(--text-3)' } },
        h('span', { class: ['cal-arow__time', overdue && 'cal-arow__time--overdue'] },
          e.source === 'event' ? time : e.allDay ? time : `Due ${time}`),
        h('span', { class: 'cal-arow__icon', 'aria-hidden': 'true' }, icon(e.source === 'event' ? 'calendar' : ui.kindIcon(e.kind), { size: 14 })),
        h('span', { class: 'cal-arow__main' },
          e.source === 'event'
            ? h('button', { ...titleProps, type: 'button', onClick: () => openEvent(e, courseById) }, e.title)
            : e.href ? h('a', { ...titleProps, href: e.href }, e.title)
              : e.source === 'note' && e.item ? h('button', { ...titleProps, type: 'button', onClick: () => Gesso.plannerUi.openTodo(e.item) }, e.title)
                : h('span', titleProps, e.title),
          h('span', { class: 'cal-arow__meta' },
            h('span', { class: 'dot', 'aria-hidden': 'true' }),
            h('span', { class: 'truncate' }, [
              course ? course.code || course.name : 'Personal',
              e.points != null ? `${e.points} pts` : '',
              e.event?.location || '',
            ].filter(Boolean).join(' · ')))),
        h('span', { class: 'cal-arow__end' },
          e.status && e.source !== 'event' && e.status !== 'none' && ui.statusPill(e.status),
          // Mark done from the agenda (planner override, read back).
          e.source !== 'event' && e.item && Gesso.plannerUi.doneButton(e.item)));
    }

    // ---- event details --------------------------------------------------------

    function openEvent(/** @type {any} */ e, /** @type {Map<string, any>} */ courseById) {
      const ev = e.event;
      const course = e.courseId ? courseById.get(e.courseId) : null;
      const when = e.allDay
        ? (e.end && C.daysIn(e.start, e.end).length > 1
          ? `${shortDate(e.start)} – ${shortDate(addDays(e.end, -1))} · All day`
          : `${shortDate(e.start)} · All day`)
        : `${shortDate(e.start)} · ${e.end ? `${timeText(e.start)} – ${timeText(e.end)}` : timeText(e.start)}`;
      Gesso.overlays.dialog({
        title: e.title,
        class: 'cal-dialog',
        body: h('div', { class: 'cal-event' },
          h('p', { class: 'cal-event__row' }, icon('clock', { size: 15 }), h('span', null, when)),
          h('p', { class: 'cal-event__row', style: { '--c': course?.color || 'var(--text-3)' } },
            h('span', { class: 'dot', 'aria-hidden': 'true' }),
            h('span', null, course ? `${course.code ? `${course.code} · ` : ''}${Gesso.derive.courseTitle(course)}` : 'Personal calendar')),
          ev?.location && h('p', { class: 'cal-event__row' }, icon('pin', { size: 15 }),
            h('span', null, [ev.location, ev.address].filter(Boolean).join(', '))),
          ev?.description && h('div', { class: 'cal-event__desc' }, ui.richText(ev.description, { tag: 'div' })),
          h('div', { class: 'cal-event__actions' },
            ev?.url && h('a', { class: 'btn', href: ev.url, target: '_blank', rel: 'noopener' }, 'Open in Canvas', icon('external', { size: 13 })))),
      });
    }

    // ---- export ---------------------------------------------------------------

    /**
     * Export the shown calendars for the current term: every dated deadline
     * and note, plus calendar events fetched for the term (or −30…+120 days
     * when Canvas gives no term dates), capped at a year either way.
     */
    async function exportIcs(/** @type {any} */ { courses, courseById, items, codes }) {
      if (local.exporting) return;
      local.exporting = true;
      render();
      const now = new Date();
      const starts = courses.map((/** @type {any} */ c) => toDate(c.termStart || c.startAt)).filter(Boolean);
      const ends = courses.map((/** @type {any} */ c) => toDate(c.termEnd || c.endAt)).filter(Boolean);
      let from = starts.length ? new Date(Math.min(...starts.map((/** @type {Date} */ d) => d.getTime()))) : addDays(now, -30);
      let to = ends.length ? new Date(Math.max(...ends.map((/** @type {Date} */ d) => d.getTime()))) : addDays(now, 120);
      if (from < addDays(now, -365)) from = addDays(now, -365);
      if (to > addDays(now, 365)) to = addDays(now, 365);
      if (to <= from) to = addDays(from, 120);

      let events = [];
      let eventsFailed = false;
      try {
        events = (await Gesso.api.canvas.getCalendarEvents(codes, startOfDay(from), startOfDay(to))).map(Gesso.normalize.calendarEvent);
      } catch (err) {
        Gesso.log.warn('Export: loading calendar events failed', err);
        eventsFailed = true;
      }
      const entries = C.mergeEntries({ items, events, courseIds: new Set(courseById.keys()) })
        .filter((e) => !local.hidden.has(C.sourceKey(e)));
      try {
        const text = C.toICS(entries, { courseById, origin: Gesso.config.canvasOrigin, now, name: 'Canvas' });
        download(text, `canvas-calendar-${dayKey(now)}.ics`);
        Gesso.overlays.toast(eventsFailed
          ? `Exported ${entries.length} deadlines. Canvas calendar events couldn't be loaded, so they're not included.`
          : `Exported ${entries.length} items (${rangeFmt.formatRange(from, to)}).`, { tone: eventsFailed ? 'danger' : 'ok' });
      } catch (err) {
        Gesso.log.error('Export failed', err);
        Gesso.overlays.toast("Couldn't create the calendar file.", { tone: 'danger' });
      } finally {
        local.exporting = false;
        render();
      }
    }

    /** Save text as a file via a blob URL + <a download>. */
    function download(/** @type {string} */ text, /** @type {string} */ filename) {
      const blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = /** @type {HTMLAnchorElement} */ (h('a', { href: url, download: filename, hidden: true }));
      el.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      Gesso.diagnostics = { ...(Gesso.diagnostics || {}), lastIcs: { filename, bytes: blob.size, text } };
    }

    return {
      el,
      update(/** @type {any} */ state, /** @type {any} */ r) {
        appState = state;
        if (r) {
          currentRoute = r;
          if (C.VIEWS.includes(r.params.view) && r.params.view !== local.defaultView) {
            local.defaultView = r.params.view; // the last view used becomes the default for #/calendar
            savePrefs();
          }
        }
        render();
      },
    };
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.calendar = { create };
})();
