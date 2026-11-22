// @ts-check
/**
 * Date helpers. All display uses the browser's local time zone and locale.
 * Dates travel through the app as ISO strings (what Canvas returns) and are
 * turned into Date objects only at the edges.
 */
(() => {
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const fmt = {
    weekdayShort: new Intl.DateTimeFormat(undefined, { weekday: 'short' }),
    weekdayLong: new Intl.DateTimeFormat(undefined, { weekday: 'long' }),
    monthDay: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
    longDate: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    shortDate: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
    full: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    // Variants with the year, used automatically for dates outside the current year.
    monthDayY: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    shortDateY: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
    fullY: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
  };

  const thisYear = (/** @type {Date} */ d) => d.getFullYear() === new Date().getFullYear();

  /** "Nov 20" — or "Apr 18, 2024" when not in the current year. Use instead of fmt.monthDay. */
  const monthDay = (/** @type {Date} */ d) => (thisYear(d) ? fmt.monthDay : fmt.monthDayY).format(d);
  /** "Fri, Nov 20" — or "Thu, Apr 18, 2024". Use instead of fmt.shortDate. */
  const shortDate = (/** @type {Date} */ d) => (thisYear(d) ? fmt.shortDate : fmt.shortDateY).format(d);

  /** @param {string|number|Date|null|undefined} value */
  function toDate(value) {
    if (value == null || value === '') return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** @param {Date} d */
  function startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  /** @param {Date} d @param {number} n */
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }

  /** Calendar-day difference (b - a), ignoring time of day and DST. */
  function dayDiff(/** @type {Date} */ a, /** @type {Date} */ b) {
    return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY);
  }

  /** Stable key for grouping by local day, e.g. "2026-11-18". */
  function dayKey(/** @type {Date} */ d) {
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  /** "Today", "Tomorrow", "Yesterday", or "Fri, Nov 20". */
  function dayLabel(/** @type {Date} */ d, now = new Date()) {
    const diff = dayDiff(now, d);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    if (diff > 1 && diff < 7) return fmt.weekdayLong.format(d);
    return shortDate(d);
  }

  /** Compact duration: "38m", "5h 12m", "2d 4h". */
  function duration(/** @type {number} */ ms) {
    // Round to whole minutes first so carries are right ("5h", never "4h 60m").
    const totalMin = Math.max(1, Math.round(Math.abs(ms) / MINUTE));
    if (totalMin < 60) return `${totalMin}m`;
    if (totalMin < 24 * 60) {
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return m ? `${h}h ${m}m` : `${h}h`;
    }
    const totalHours = Math.round(totalMin / 60);
    const d = Math.floor(totalHours / 24);
    const h = totalHours % 24;
    return h ? `${d}d ${h}h` : `${d}d`;
  }

  /** "in 5h 12m" / "3d ago" / "just now". */
  function relative(/** @type {Date} */ d, now = new Date()) {
    const ms = d.getTime() - now.getTime();
    if (Math.abs(ms) < MINUTE) return 'just now';
    return ms > 0 ? `in ${duration(ms)}` : `${duration(ms)} ago`;
  }

  /** "Good morning" / "Good afternoon" / "Good evening". */
  function greeting(now = new Date()) {
    const h = now.getHours();
    if (h < 5) return 'Good evening';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  /** Absolute due label: "Fri, Nov 20, 11:59 PM" (with the year if not this year). */
  function dueLabel(/** @type {Date} */ d) {
    return (thisYear(d) ? fmt.full : fmt.fullY).format(d);
  }

  /** yyyy-mm-dd in local time (what Canvas expects for date-only params). */
  function isoDate(/** @type {Date} */ d) {
    return dayKey(d);
  }

  Gesso.time = {
    MINUTE, HOUR, DAY,
    fmt, monthDay, shortDate, toDate, startOfDay, addDays, dayDiff, dayKey, dayLabel,
    duration, relative, greeting, dueLabel, isoDate,
  };
})();
