// @ts-check
/**
 * Assignment-center query engine: priority, filtering, full-text search,
 * sorting, and grouping over WorkItems (see derive.js). Pure functions.
 */
(() => {
  const { HOUR, DAY, toDate, startOfDay, addDays, dayKey, dayLabel, fmt } = Gesso.time;
  const { isDone } = Gesso.derive;

  // ---------------------------------------------------------------------------
  // Priority
  // ---------------------------------------------------------------------------

  /**
   * A simple, explainable priority:
   *   High   — overdue (recent or flagged missing), or due within 48 h
   *   Medium — due within 7 days, or within 14 days and worth ≥ 50 points
   *   Low    — everything else still to do
   *   —      — done (submitted / graded / excused / marked done)
   * @returns {{ level: 'high'|'medium'|'low'|'none', rank: number, label: string }}
   */
  function priority(/** @type {any} */ item, now = new Date()) {
    const none = { level: /** @type {const} */ ('none'), rank: 0, label: '—' };
    const high = { level: /** @type {const} */ ('high'), rank: 3, label: 'High' };
    const medium = { level: /** @type {const} */ ('medium'), rank: 2, label: 'Medium' };
    const low = { level: /** @type {const} */ ('low'), rank: 1, label: 'Low' };
    if (isDone(item)) return none;
    const due = toDate(item.dueAt);
    if (!due) return item.status === 'none' ? none : low; // e.g. "participation" items with nothing to submit
    const hours = (due.getTime() - now.getTime()) / HOUR;
    if (hours < 0) return item.status === 'missing' || hours > -14 * 24 ? high : low;
    if (hours < 48) return high;
    if (hours < 24 * 7 || (hours < 24 * 14 && (item.points ?? 0) >= 50)) return medium;
    return low;
  }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------

  /** The kinds the type filter understands; pages, notes and peer reviews count as "other". */
  const KIND_FILTER = /** @type {Record<string, string>} */ ({ assignment: 'assignment', quiz: 'quiz', discussion: 'discussion' });
  const kindGroup = (/** @type {string} */ kind) => KIND_FILTER[kind] || 'other';

  /**
   * @typedef {Object} Filters
   * @property {string} query
   * @property {string[]} courses    empty = all
   * @property {string[]} statuses   empty = all
   * @property {string[]} kinds      empty = all ('assignment'|'quiz'|'discussion'|'other')
   * @property {'all'|'overdue'|'today'|'week'|'month'|'past30'|'custom'} range
   * @property {string} from         yyyy-mm-dd (custom range)
   * @property {string} to           yyyy-mm-dd (custom range)
   */

  /** @type {Filters} */
  const EMPTY_FILTERS = Object.freeze({ query: '', courses: [], statuses: [], kinds: [], range: 'all', from: '', to: '' });

  /** [start, end) in ms for a range preset, or null for "all". */
  function rangeBounds(/** @type {Filters} */ f, now = new Date()) {
    const today = startOfDay(now);
    switch (f.range) {
      case 'overdue': return [-Infinity, now.getTime()];
      case 'today': return [today.getTime(), addDays(today, 1).getTime()];
      case 'week': return [now.getTime(), addDays(today, 8).getTime()];
      case 'month': return [now.getTime(), addDays(today, 31).getTime()];
      case 'past30': return [addDays(today, -30).getTime(), now.getTime()];
      case 'custom': {
        const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : -Infinity;
        const to = f.to ? addDays(new Date(`${f.to}T00:00:00`), 1).getTime() : Infinity;
        return [from, to];
      }
      default: return null;
    }
  }

  /** Lowercase, accent-insensitive text for search. */
  const fold = (/** @type {string} */ s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /**
   * @param {any[]} items
   * @param {Filters} f
   * @param {Map<string, any>} courseById
   * @param {Date} [now]
   * @param {{ keepOverdue?: boolean }} [opts]
   *   `keepOverdue`: overdue work (derive.overdue — the timeline's "Overdue &
   *   missing" section) ignores the date filter, so e.g. "Next 7 days" can
   *   never hide it. Every other filter still applies.
   */
  function filterItems(items, f, courseById, now = new Date(), { keepOverdue = false } = {}) {
    const tokens = fold(f.query || '').split(/\s+/).filter(Boolean);
    const courses = new Set(f.courses);
    const statuses = new Set(f.statuses);
    const kinds = new Set(f.kinds);
    const bounds = rangeBounds(f, now);
    const overdue = keepOverdue && bounds ? new Set(Gesso.derive.overdue(items, now)) : null;
    return items.filter((i) => {
      if (courses.size && !courses.has(i.courseId ?? 'personal')) return false;
      if (statuses.size && !statuses.has(i.status)) return false;
      if (kinds.size && !kinds.has(kindGroup(i.kind))) return false;
      if (bounds && !overdue?.has(i)) {
        const t = toDate(i.dueAt)?.getTime();
        if (t == null || t < bounds[0] || t >= bounds[1]) return false;
        if (f.range === 'overdue' && isDone(i)) return false;
      }
      if (tokens.length) {
        const c = courseById.get(i.courseId);
        const hay = fold(`${i.title} ${c?.code || ''} ${c?.name || ''} ${c ? Gesso.derive.courseTitle(c) : ''} ${i.kind}`);
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Sorting
  // ---------------------------------------------------------------------------

  const STATUS_ORDER = ['missing', 'not_submitted', 'late', 'submitted', 'graded', 'excused', 'none'];

  /** Percentage for grade sorting; null when ungraded. */
  function gradePct(/** @type {any} */ i) {
    if (i.score == null || !i.points) return null;
    return i.score / i.points;
  }

  /**
   * @param {any[]} items
   * @param {{ key: 'title'|'course'|'due'|'points'|'status'|'grade'|'priority', dir: 'asc'|'desc' }} sort
   * @param {Map<string, any>} courseById
   */
  function sortItems(items, sort, courseById, now = new Date()) {
    const dir = sort.dir === 'desc' ? -1 : 1;
    const due = (/** @type {any} */ i) => toDate(i.dueAt)?.getTime() ?? null;
    /** @type {(i: any) => any} */
    const key = {
      title: (/** @type {any} */ i) => i.title.toLowerCase(),
      course: (/** @type {any} */ i) => (courseById.get(i.courseId)?.code || courseById.get(i.courseId)?.name || 'zzz').toLowerCase(),
      due,
      points: (/** @type {any} */ i) => i.points,
      status: (/** @type {any} */ i) => STATUS_ORDER.indexOf(i.status),
      grade: gradePct,
      priority: (/** @type {any} */ i) => priority(i, now).rank,
    }[sort.key] || due;

    return [...items].sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      // Missing values always sort last, whatever the direction.
      if (ka == null && kb != null) return 1;
      if (kb == null && ka != null) return -1;
      if (ka != null && kb != null && ka !== kb) return (ka < kb ? -1 : 1) * dir;
      // Tie-break: soonest due first, then title.
      const da = due(a) ?? Infinity;
      const db = due(b) ?? Infinity;
      return da - db || a.title.localeCompare(b.title);
    });
  }

  // ---------------------------------------------------------------------------
  // Grouping
  // ---------------------------------------------------------------------------

  const STATUS_LABELS = /** @type {Record<string,string>} */ ({
    missing: 'Missing', not_submitted: 'Not submitted', late: 'Submitted late', submitted: 'Submitted',
    graded: 'Graded', excused: 'Excused', none: 'No submission needed',
  });

  /**
   * Split (already sorted) items into labelled sections. Items without a due
   * date go in their own final "No due date" section — except when grouping
   * by assignment group (course workspace), where they stay in their group
   * after the dated items, like Canvas's own assignments page.
   * @param {any[]} items
   * @param {'none'|'day'|'course'|'status'|'group'} by
   * @param {{ courseById: Map<string, any>, groupById?: Map<string, any>, now?: Date, undatedSection?: boolean }} ctx
   *   `undatedSection: false` groups undated items like any other (used inside
   *   the timeline's own "No current due date" section).
   * @returns {{ key: string, label: string, sublabel?: string, items: any[] }[]}
   */
  function groupItems(items, by, { courseById, groupById, now = new Date(), undatedSection = true }) {
    const dated = items.filter((i) => toDate(i.dueAt));
    const undated = items.filter((i) => !toDate(i.dueAt));
    /** @type {Map<string, { key: string, label: string, sublabel?: string, items: any[] }>} */
    const groups = new Map();
    const push = (/** @type {string} */ key, /** @type {string} */ label, /** @type {any} */ item, /** @type {string} */ sublabel = '') => {
      if (!groups.has(key)) groups.set(key, { key, label, sublabel, items: [] });
      /** @type {any} */ (groups.get(key)).items.push(item);
    };

    const source = by === 'group' || !undatedSection ? items : dated;
    for (const i of source) {
      if (by === 'none') push('all', 'All', i);
      else if (by === 'day') {
        const d = /** @type {Date} */ (toDate(i.dueAt));
        const label = dayLabel(d, now);
        const full = Gesso.time.shortDate(d);
        push(dayKey(d), label, i, label === full ? '' : full); // no "Mon, Nov 9 · Mon, Nov 9"
      } else if (by === 'course') {
        const c = courseById.get(i.courseId);
        push(i.courseId || 'personal', c ? c.code || Gesso.derive.courseTitle(c) : 'Personal', i, c && c.code ? Gesso.derive.courseTitle(c) : '');
      } else if (by === 'status') {
        push(i.status, STATUS_LABELS[i.status] || i.status, i);
      } else if (by === 'group') {
        const g = groupById?.get(i.groupId);
        push(i.groupId || 'other', g ? g.name : 'Other', i, g?.weight ? `${g.weight}% of grade` : '');
      }
    }

    let out = [...groups.values()];
    if (by === 'status') out.sort((a, b) => STATUS_ORDER.indexOf(a.key) - STATUS_ORDER.indexOf(b.key));
    if (by === 'group') out.sort((a, b) => (groupById?.get(a.key)?.position ?? 999) - (groupById?.get(b.key)?.position ?? 999));
    if (by === 'group') {
      out = out.map((g) => ({ ...g, items: [...g.items.filter((i) => toDate(i.dueAt)), ...g.items.filter((i) => !toDate(i.dueAt))] }));
    } else if (undated.length && undatedSection) {
      out.push({ key: 'nodue', label: 'No current due date', items: undated });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Timeline sections (the default "Due ↑" order)
  // ---------------------------------------------------------------------------

  /**
   * The default sort — due date ascending — is a timeline rather than plain
   * chronology, like Canvas's own "show by date" assignments page:
   *   1. Overdue & missing — derive.overdue's rule (what the dashboard shows):
   *      flagged missing, or unsubmitted and due in the last 14 days.
   *      Most recently due first.
   *   2. Upcoming — due from now on (done or not), soonest first.
   *   3. No current due date — undated or past-term dates, by title.
   *   4. Past — everything else already due (completed, or old and not
   *      flagged), most recent first.
   * Any other sort (including due descending) is plain, without sections.
   */
  const isTimeline = (/** @type {{ key: string, dir: string }} */ sort) => sort.key === 'due' && sort.dir === 'asc';

  const SECTION_LABELS = /** @type {Record<string, string>} */ ({
    overdue: 'Overdue & missing', upcoming: 'Upcoming', nodue: 'No current due date', past: 'Past',
  });

  /**
   * @param {any[]} items
   * @returns {{ key: 'overdue'|'upcoming'|'nodue'|'past', label: string, items: any[] }[]} non-empty sections, in order
   */
  function timelineSections(items, now = new Date()) {
    const overdue = Gesso.derive.overdue(items, now);
    const isOverdue = new Set(overdue);
    const due = (/** @type {any} */ i) => /** @type {number} */ (toDate(i.dueAt)?.getTime());
    /** @type {any[]} */ const upcoming = [];
    /** @type {any[]} */ const undated = [];
    /** @type {any[]} */ const past = [];
    for (const i of items) {
      if (isOverdue.has(i)) continue;
      const t = toDate(i.dueAt)?.getTime();
      if (t == null) undated.push(i);
      else if (t >= now.getTime()) upcoming.push(i);
      else past.push(i);
    }
    upcoming.sort((a, b) => due(a) - due(b) || a.title.localeCompare(b.title));
    past.sort((a, b) => due(b) - due(a) || a.title.localeCompare(b.title));
    undated.sort((a, b) => a.title.localeCompare(b.title));
    const sections = /** @type {const} */ ([['overdue', overdue], ['upcoming', upcoming], ['nodue', undated], ['past', past]]);
    return sections
      .filter(([, list]) => list.length)
      .map(([key, list]) => ({ key, label: SECTION_LABELS[key], items: list }));
  }

  /**
   * Everything the table needs, in render order: optional timeline sections,
   * each holding the groups for `groupBy`.
   * @param {any[]} items
   * @param {{ key: any, dir: 'asc'|'desc' }} sort
   * @param {'none'|'day'|'course'|'status'|'group'} groupBy
   * @param {{ courseById: Map<string, any>, groupById?: Map<string, any>, now?: Date }} ctx
   * @returns {{ section: { key: string, label: string, count: number }|null, groups: { key: string, label: string, sublabel?: string, items: any[] }[] }[]}
   */
  function layoutItems(items, sort, groupBy, ctx) {
    const now = ctx.now || new Date();
    if (!isTimeline(sort)) {
      return [{ section: null, groups: groupItems(sortItems(items, sort, ctx.courseById, now), groupBy, { ...ctx, now }) }];
    }
    return timelineSections(items, now).map((s) => ({
      section: { key: s.key, label: s.label, count: s.items.length },
      // Undated items can't be grouped by day; inside their section a day header would only repeat it.
      groups: groupItems(s.items, s.key === 'nodue' && groupBy === 'day' ? 'none' : groupBy, { ...ctx, now, undatedSection: false }),
    }));
  }

  Gesso.query = { priority, kindGroup, EMPTY_FILTERS, rangeBounds, filterItems, sortItems, groupItems, isTimeline, timelineSections, layoutItems, STATUS_LABELS, STATUS_ORDER, DAY };
})();
