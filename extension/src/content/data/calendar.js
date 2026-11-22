// @ts-check
/**
 * Calendar model. Pure functions: visible ranges and navigation,
 * the merge of deadlines + planner notes + Canvas calendar events into one
 * entry list, per-day workload for the heatmap, side-by-side layout of
 * overlapping timed events, and RFC 5545 (.ics) export.
 *
 * Rules carried over from the rest of the app:
 * - Deadlines come from `Gesso.derive.workItems`, so past-term dates are already
 *   nulled, and peer reviews already carry their resolved due date.
 *   Items without a current date never go on the grid.
 * - Entries link through `Gesso.derive.itemHref` (Gesso detail views).
 * - Weeks start on Sunday, matching Canvas's own calendar.
 */
(() => {
  const { HOUR, MINUTE, toDate, startOfDay, addDays, dayKey } = Gesso.time;
  const { isDone, itemHref } = Gesso.derive;

  /** @typedef {'week'|'month'|'agenda'} CalView */
  const VIEWS = /** @type {CalView[]} */ (['week', 'month', 'agenda']);
  const AGENDA_DAYS = 14;

  /**
   * One thing on the calendar.
   * @typedef {Object} CalEntry
   * @property {string} key
   * @property {'deadline'|'note'|'event'} source
   * @property {string} kind              work-item kind, or 'event'
   * @property {string|null} courseId     null = personal
   * @property {string} title
   * @property {Date} start               due time for deadlines
   * @property {Date|null} end            timed events only
   * @property {boolean} allDay
   * @property {number|null} points
   * @property {string|null} href         where clicking goes (Gesso route or Canvas URL)
   * @property {boolean} done
   * @property {string|null} status
   * @property {any} item                 the WorkItem (deadlines/notes)
   * @property {any} event                the normalized CalendarEvent (events)
   */

  // ---------------------------------------------------------------------------
  // Ranges and navigation
  // ---------------------------------------------------------------------------

  /** Sunday 00:00 of the week containing `d`. */
  function weekStart(/** @type {Date} */ d) {
    const x = startOfDay(d);
    x.setDate(x.getDate() - x.getDay());
    return x;
  }

  /** "2026-11-18" or "2026-11" → local Date, or null when malformed. */
  function parseDay(/** @type {string|null|undefined} */ s) {
    const m = String(s || '').match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const monthKey = (/** @type {Date} */ d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

  /**
   * Days shown by a view: [start, end) at local midnights.
   * Month = whole weeks covering the month.
   * @returns {{ start: Date, end: Date }}
   */
  function viewRange(/** @type {CalView} */ view, /** @type {Date} */ anchor) {
    if (view === 'month') {
      const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
      return { start: weekStart(first), end: addDays(weekStart(last), 7) };
    }
    if (view === 'agenda') {
      const start = startOfDay(anchor);
      return { start, end: addDays(start, AGENDA_DAYS) };
    }
    const start = weekStart(anchor);
    return { start, end: addDays(start, 7) };
  }

  /** The anchor one page earlier (-1) or later (+1). */
  function step(/** @type {CalView} */ view, /** @type {Date} */ anchor, /** @type {number} */ dir) {
    if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
    return addDays(anchor, (view === 'agenda' ? AGENDA_DAYS : 7) * dir);
  }

  /** Canonical route path for a view + anchor (every view has its own URL). */
  function routeFor(/** @type {CalView} */ view, /** @type {Date} */ anchor) {
    if (view === 'month') return `/calendar/month/${monthKey(anchor)}`;
    if (view === 'agenda') return `/calendar/agenda/${dayKey(startOfDay(anchor))}`;
    return `/calendar/week/${dayKey(weekStart(anchor))}`;
  }

  /** Calendar months ("2026-11") touched by [start, end). Events are fetched per month. */
  function monthKeys(/** @type {Date} */ start, /** @type {Date} */ end) {
    const keys = [];
    for (let d = new Date(start.getFullYear(), start.getMonth(), 1); d < end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) keys.push(monthKey(d));
    return keys;
  }

  /** First and last day (inclusive, as the API expects) of a month key. */
  function monthBounds(/** @type {string} */ key) {
    const first = /** @type {Date} */ (parseDay(key));
    return { start: first, last: new Date(first.getFullYear(), first.getMonth() + 1, 0) };
  }

  /** Each local day in [start, end). */
  function daysIn(/** @type {Date} */ start, /** @type {Date} */ end) {
    const days = [];
    for (let d = startOfDay(start); d < end; d = addDays(d, 1)) days.push(d);
    return days;
  }

  // ---------------------------------------------------------------------------
  // Merge
  // ---------------------------------------------------------------------------

  /**
   * Deadlines + planner notes (from workItems) + calendar events → entries.
   * Undated work (including past-term dates) is left out; count it with
   * `undatedCount`. Events from courses the user hid are left out.
   * @param {{ items: any[], events: any[], courseIds: Set<string> }} o
   * @returns {CalEntry[]}
   */
  function mergeEntries({ items, events, courseIds }) {
    /** @type {CalEntry[]} */
    const out = [];
    for (const i of items) {
      const start = toDate(i.dueAt);
      if (!start) continue;
      out.push({
        key: i.key,
        source: i.kind === 'note' ? 'note' : 'deadline',
        kind: i.kind,
        courseId: i.courseId || null,
        title: i.title,
        start,
        end: null,
        allDay: false,
        points: i.points ?? null,
        href: itemHref(i),
        done: isDone(i),
        status: i.status,
        item: i,
        event: null,
      });
    }
    const seen = new Set();
    for (const e of events) {
      if (e.deleted || e.hidden || seen.has(e.key)) continue;
      if (e.courseId && !courseIds.has(e.courseId)) continue;
      if (!e.courseId && !e.personal) continue; // group/account calendars aren't requested
      seen.add(e.key);
      let start = toDate(e.start);
      let end = toDate(e.end);
      if (e.allDay) {
        // all_day_date is the local calendar date; end_at may span several days.
        start = parseDay(e.allDayDate) || (start && startOfDay(start));
        if (!start) continue;
        const lastDay = end && end > start ? startOfDay(new Date(end.getTime() - 1)) : start;
        end = addDays(lastDay < start ? start : lastDay, 1);
      }
      if (!start) continue;
      out.push({
        key: e.key,
        source: 'event',
        kind: 'event',
        courseId: e.courseId,
        title: e.title,
        start,
        end: end && end > start ? end : null,
        allDay: e.allDay,
        points: null,
        href: e.url,
        done: false,
        status: null,
        item: null,
        event: e,
      });
    }
    return out.sort(compareEntries);
  }

  /** All-day first, then by time, then title. */
  function compareEntries(/** @type {CalEntry} */ a, /** @type {CalEntry} */ b) {
    return Number(b.allDay) - Number(a.allDay) || a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title);
  }

  /** Filter key for the sidebar toggles. */
  const sourceKey = (/** @type {CalEntry} */ e) => e.courseId || 'personal';

  /** Work items that have no current due date (undated or past-term) and aren't done. */
  function undatedCount(/** @type {any[]} */ items) {
    return items.filter((i) => !i.dueAt && !isDone(i) && i.kind !== 'note').length;
  }

  /** Does `e` fall on (or span into) the local day starting at `day`? */
  function onDay(/** @type {CalEntry} */ e, /** @type {Date} */ day) {
    const s = day.getTime();
    const t = addDays(day, 1).getTime();
    const start = e.start.getTime();
    if (!e.end) return start >= s && start < t;
    return start < t && e.end.getTime() > s;
  }

  /**
   * Entries per day key for [start, end), each list sorted.
   * @returns {Map<string, CalEntry[]>}
   */
  function byDay(/** @type {CalEntry[]} */ entries, /** @type {Date} */ start, /** @type {Date} */ end) {
    /** @type {Map<string, CalEntry[]>} */
    const map = new Map();
    for (const d of daysIn(start, end)) map.set(dayKey(d), []);
    for (const e of entries) {
      // First and last local day the entry touches (an end at midnight doesn't touch the next day).
      const first = startOfDay(e.start);
      const last = e.end ? startOfDay(new Date(Math.max(e.start.getTime(), e.end.getTime() - 1))) : first;
      for (let d = first < start ? startOfDay(start) : first; d <= last && d < end; d = addDays(d, 1)) {
        map.get(dayKey(d))?.push(e);
      }
    }
    for (const list of map.values()) list.sort(compareEntries);
    return map;
  }

  // ---------------------------------------------------------------------------
  // Workload heatmap
  // ---------------------------------------------------------------------------

  /**
   * How heavy a day is: open deadlines, weighted by points. A 10-point
   * reading is 1.2, a 100-point project 3 (points capped at 200 → 5).
   * Done work and personal notes don't count; events don't either.
   *   level 0: nothing · 1: < 2 · 2: < 4 · 3: < 7 · 4: 7+
   * @returns {{ count: number, points: number, score: number, level: 0|1|2|3|4 }}
   */
  function workload(/** @type {CalEntry[]} */ dayEntries) {
    let count = 0;
    let points = 0;
    let score = 0;
    for (const e of dayEntries) {
      if (e.source !== 'deadline' || e.done) continue;
      const p = Math.max(0, e.points ?? 0);
      count += 1;
      points += p;
      score += 1 + Math.min(p, 200) / 50;
    }
    const level = /** @type {0|1|2|3|4} */ (score === 0 ? 0 : score < 2 ? 1 : score < 4 ? 2 : score < 7 ? 3 : 4);
    return { count, points, score: Math.round(score * 10) / 10, level };
  }

  // ---------------------------------------------------------------------------
  // Week grid layout
  // ---------------------------------------------------------------------------

  const MIN_BLOCK_MIN = 30; // short events still get a readable block

  /**
   * Place a day's timed events: overlapping events share the width side by
   * side. Minutes are relative to the day's midnight and clipped to the day.
   * @returns {{ entry: CalEntry, startMin: number, endMin: number, col: number, cols: number }[]}
   */
  function layoutDay(/** @type {CalEntry[]} */ timed, /** @type {Date} */ day) {
    const dayStart = day.getTime();
    const blocks = timed.map((entry) => {
      const s = Math.max(0, (entry.start.getTime() - dayStart) / MINUTE);
      const rawEnd = entry.end ? (entry.end.getTime() - dayStart) / MINUTE : s;
      const e = Math.min(24 * 60, Math.max(rawEnd, s + MIN_BLOCK_MIN));
      return { entry, startMin: s, endMin: e, col: 0, cols: 1 };
    }).sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

    /** @type {typeof blocks} */
    let cluster = [];
    /** @type {number[]} column → end minute */
    let colEnds = [];
    let clusterEnd = -1;
    const finish = () => { for (const b of cluster) b.cols = colEnds.length; cluster = []; colEnds = []; };
    for (const b of blocks) {
      if (b.startMin >= clusterEnd) finish();
      let col = colEnds.findIndex((end) => end <= b.startMin);
      if (col < 0) { col = colEnds.length; colEnds.push(b.endMin); } else colEnds[col] = b.endMin;
      b.col = col;
      cluster.push(b);
      clusterEnd = Math.max(clusterEnd, b.endMin);
    }
    finish();
    return blocks;
  }

  /**
   * Hours to draw: 8:00–20:00, widened to fit every timed event (and "now",
   * when it's in view) so nothing needs an inner scroll area.
   * @returns {{ from: number, to: number }}
   */
  function hourRange(/** @type {{ startMin: number, endMin: number }[]} */ blocks, /** @type {number|null} */ nowMin = null) {
    let from = 8;
    let to = 20;
    for (const b of blocks) {
      from = Math.min(from, Math.floor(b.startMin / 60));
      to = Math.max(to, Math.ceil(b.endMin / 60));
    }
    if (nowMin != null) {
      from = Math.min(from, Math.floor(nowMin / 60));
      to = Math.max(to, Math.ceil((nowMin + 1) / 60));
    }
    return { from: Math.max(0, from), to: Math.min(24, to) };
  }

  // ---------------------------------------------------------------------------
  // .ics export (RFC 5545)
  // ---------------------------------------------------------------------------

  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  /** 20261118T235900Z */
  const icsUtc = (/** @type {Date} */ d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  /** 20261118 (local calendar date) */
  const icsDate = (/** @type {Date} */ d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

  /** TEXT escaping (§3.3.11): backslash, semicolon, comma, newline. */
  function icsEscape(/** @type {string} */ s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
  }

  /**
   * Fold a content line at 75 octets (§3.1): continuation lines start with a
   * space. Splits between code points, never inside a UTF-8 sequence.
   */
  function icsFold(/** @type {string} */ line) {
    const enc = new TextEncoder();
    const parts = [];
    let cur = '';
    let bytes = 0;
    for (const ch of line) {
      const n = enc.encode(ch).length;
      const limit = parts.length ? 74 : 75; // the leading space counts on continuation lines
      if (bytes + n > limit) { parts.push(cur); cur = ''; bytes = 0; }
      cur += ch;
      bytes += n;
    }
    parts.push(cur);
    return parts.join('\r\n ');
  }

  /**
   * Build an .ics file.
   * - Deadlines: DTSTART at the due time with no DTEND, which RFC 5545 defines
   *   as an event that "ends on the same calendar date and time of day".
   * - Timed events: DTSTART/DTEND in UTC. All-day: VALUE=DATE, DTEND exclusive.
   * - UID is stable (`<key>@gesso`), so re-importing updates instead
   *   of duplicating in most calendar apps.
   * @param {CalEntry[]} entries
   * @param {{ courseById: Map<string, any>, origin: string, now?: Date, name?: string }} o
   */
  function toICS(entries, { courseById, origin, now = new Date(), name = 'Canvas' }) {
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gesso//Calendar export//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(name)}`,
    ];
    const stamp = icsUtc(now);
    for (const e of entries) {
      const course = e.courseId ? courseById.get(e.courseId) : null;
      const code = course ? course.code || Gesso.derive.courseTitle(course) : '';
      const url = e.href ? new URL(e.href, `${origin}/`).toString() : null;
      const desc = [];
      if (e.source === 'deadline') desc.push(['Due', e.points != null ? `${e.points} points` : '', e.done ? 'done' : ''].filter(Boolean).join(' · '));
      if (course) desc.push(`${code} — ${Gesso.derive.courseTitle(course)}`);
      if (e.event?.description) desc.push(Gesso.normalize.textSnippet(e.event.description, 2000));
      if (url) desc.push(url);

      lines.push('BEGIN:VEVENT', `UID:${e.key.replace(/[^A-Za-z0-9._-]/g, '-')}@gesso`, `DTSTAMP:${stamp}`);
      if (e.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(e.end || addDays(e.start, 1))}`);
      } else {
        lines.push(`DTSTART:${icsUtc(e.start)}`);
        if (e.end) lines.push(`DTEND:${icsUtc(e.end)}`);
      }
      lines.push(`SUMMARY:${icsEscape(code && e.source !== 'note' ? `${code}: ${e.title}` : e.title)}`);
      if (desc.length) lines.push(`DESCRIPTION:${icsEscape(desc.join('\n'))}`);
      if (e.event?.location) lines.push(`LOCATION:${icsEscape([e.event.location, e.event.address].filter(Boolean).join(', '))}`);
      if (url) lines.push(`URL:${url}`);
      if (code) lines.push(`CATEGORIES:${icsEscape(code)}`);
      lines.push('TRANSP:TRANSPARENT', 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(icsFold).join('\r\n')}\r\n`;
  }

  Gesso.calendar = {
    VIEWS, AGENDA_DAYS, HOUR,
    weekStart, parseDay, monthKey, viewRange, step, routeFor, monthKeys, monthBounds, daysIn,
    mergeEntries, compareEntries, sourceKey, undatedCount, onDay, byDay, workload,
    layoutDay, hourRange, icsEscape, icsFold, toICS,
  };
})();
