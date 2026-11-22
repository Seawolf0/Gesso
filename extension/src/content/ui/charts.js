// @ts-check
/**
 * Small, dependency-free chart pieces: meter, sparkline, and a
 * single-series line chart with a crosshair tooltip, keyboard stepping, and
 * a table view.
 *
 * Responsive without measuring: the SVG stretches to its box
 * (preserveAspectRatio="none") and keeps 2 px lines with
 * `vector-effect: non-scaling-stroke`; dots, labels, the crosshair and the
 * tooltip are HTML positioned in percentages, so they never distort.
 * Colors come from CSS (course color via `--c`), never from attributes.
 */
(() => {
  const { h } = Gesso.dom;
  const NS = 'http://www.w3.org/2000/svg';

  /** SVG element builder (attributes only — no inline styles). */
  function svg(/** @type {string} */ tag, /** @type {Record<string, any>} */ attrs = {}, /** @type {Element[]} */ ...children) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, String(v));
    for (const c of children) if (c) el.appendChild(c);
    return el;
  }

  const pct = (/** @type {number} */ n) => `${Math.round(n * 1000) / 1000}%`;

  /**
   * A ratio against a limit: same-hue track, filled to `value / max`.
   * @param {{ value: number|null, max?: number, label: string, tone?: string }} o
   */
  function meter({ value, max = 100, label, tone }) {
    const ratio = value == null ? 0 : Math.max(0, Math.min(1, value / max));
    return h('div', {
      class: ['meter', tone && `meter--${tone}`], role: 'meter', 'aria-label': label,
      'aria-valuemin': '0', 'aria-valuemax': String(max), 'aria-valuenow': value == null ? undefined : String(Math.round(value * 100) / 100),
    }, h('span', { class: 'meter__fill', style: { width: pct(ratio * 100) } }));
  }

  /**
   * A tiny trend (decorative; the value it leads to is printed beside it).
   * @param {number[]} values
   */
  function sparkline(values) {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const W = 100;
    const H = 24;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * W, H - 2 - ((v - min) / span) * (H - 4)]);
    const last = pts[pts.length - 1];
    return h('span', { class: 'spark', 'aria-hidden': 'true' },
      svg('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'spark__svg' },
        svg('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'spark__line' })),
      h('span', { class: 'spark__dot', style: { left: pct((last[0] / W) * 100), top: pct((last[1] / H) * 100) } }));
  }

  /**
   * Single-series line chart over time.
   * @param {{
   *   points: { t: Date, y: number, note?: string }[],
   *   label: string,                       // accessible name, e.g. "CSCI110 grade over time"
   *   format: (y: number) => string,       // value formatter
   *   formatT: (t: Date) => string,        // x formatter
   *   refLines?: { y: number, label: string }[],
   *   color?: string,
   *   tableHead?: [string, string, string],
   * }} o
   */
  function lineChart({ points, label, format, formatT, refLines = [], color, tableHead = ['Date', 'Value', 'Note'] }) {
    const ys = points.map((p) => p.y);
    // y domain: clean tens around the data, 0–100 at most unless the data goes past it.
    const lo = Math.max(0, Math.floor((Math.min(...ys) - 5) / 10) * 10);
    const hi = Math.max(lo + 10, Math.min(Math.max(100, Math.ceil(Math.max(...ys) / 10) * 10), Math.ceil((Math.max(...ys) + 5) / 10) * 10));
    const step = hi - lo <= 30 ? 5 : 10;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
    const t0 = points[0].t.getTime();
    const t1 = points[points.length - 1].t.getTime();
    const X = (/** @type {Date} */ t) => (t1 === t0 ? 50 : ((t.getTime() - t0) / (t1 - t0)) * 100);
    const Y = (/** @type {number} */ v) => 100 - ((v - lo) / (hi - lo)) * 100;

    const plot = h('div', {
      class: 'lc__plot', tabindex: '0', role: 'group',
      'aria-label': `${label}. ${points.length} points, from ${format(points[0].y)} to ${format(points[points.length - 1].y)}. Use the left and right arrow keys to step through them.`,
    });
    const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
    const cross = h('span', { class: 'lc__cross', hidden: true });
    const focusDot = h('span', { class: 'lc__dot lc__dot--focus', hidden: true });
    const tip = h('div', { class: 'lc__tip', hidden: true });

    const sv = svg('svg', { class: 'lc__svg', viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true' },
      ...ticks.map((v) => svg('line', { x1: 0, x2: 100, y1: Y(v), y2: Y(v), class: 'lc__grid' })),
      ...refLines.filter((r) => r.y > lo && r.y < hi).map((r) => svg('line', { x1: 0, x2: 100, y1: Y(r.y), y2: Y(r.y), class: 'lc__ref' })),
      svg('polyline', { class: 'lc__line', points: points.map((p) => `${X(p.t)},${Y(p.y)}`).join(' ') }));

    const last = points[points.length - 1];
    plot.append(
      sv,
      ...ticks.map((v) => h('span', { class: 'lc__tick', style: { top: pct(Y(v)) }, 'aria-hidden': 'true' }, String(v))),
      // Reference labels share the right margin with the end label: skip any that would collide with it.
      ...refLines.filter((r) => r.y > lo && r.y < hi && Math.abs(Y(r.y) - (Y(last.y) - 6)) > 9)
        .map((r) => h('span', { class: 'lc__reflabel', style: { top: pct(Y(r.y)) }, 'aria-hidden': 'true' }, r.label)),
      cross,
      h('span', { class: 'lc__dot lc__dot--end', style: { left: pct(X(last.t)), top: pct(Y(last.y)) }, 'aria-hidden': 'true' }),
      h('span', { class: 'lc__endlabel', style: { top: pct(Y(last.y)) }, 'aria-hidden': 'true' }, format(last.y)),
      focusDot,
      tip,
    );

    let active = -1;
    function show(/** @type {number} */ i, announce = false) {
      active = i;
      const p = points[i];
      const x = X(p.t);
      const y = Y(p.y);
      cross.hidden = false;
      cross.style.setProperty('left', pct(x));
      focusDot.hidden = false;
      focusDot.style.setProperty('left', pct(x));
      focusDot.style.setProperty('top', pct(y));
      tip.hidden = false;
      tip.replaceChildren(
        h('span', { class: 'lc__tipval' }, format(p.y)),
        h('span', { class: 'lc__tiplabel' }, formatT(p.t)),
        p.note ? h('span', { class: 'lc__tipnote' }, p.note) : null);
      tip.classList.toggle('lc__tip--left', x > 60);
      tip.style.setProperty('left', pct(x));
      if (announce) live.textContent = `${formatT(p.t)}: ${format(p.y)}${p.note ? `, ${p.note}` : ''}`;
    }
    function hide() {
      active = -1;
      cross.hidden = true;
      focusDot.hidden = true;
      tip.hidden = true;
    }
    /** Nearest point by x: the crosshair finds the X, the reader never has to hit the 2px line. */
    plot.addEventListener('pointermove', (e) => {
      const r = plot.getBoundingClientRect();
      const xp = ((e.clientX - r.left) / r.width) * 100;
      let best = 0;
      for (let i = 1; i < points.length; i++) if (Math.abs(X(points[i].t) - xp) < Math.abs(X(points[best].t) - xp)) best = i;
      show(best);
    });
    plot.addEventListener('pointerleave', () => { if (!plot.matches(':focus')) hide(); });
    plot.addEventListener('focus', () => show(active < 0 ? points.length - 1 : active, true));
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', (e) => {
      const k = /** @type {KeyboardEvent} */ (e).key;
      if (k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'Home' && k !== 'End') return;
      e.preventDefault();
      e.stopPropagation(); // don't page the calendar etc.
      const n = points.length - 1;
      const i = k === 'Home' ? 0 : k === 'End' ? n : Math.max(0, Math.min(n, (active < 0 ? n : active) + (k === 'ArrowLeft' ? -1 : 1)));
      show(i, true);
    });

    // Table view: the accessible twin, one click away.
    const table = h('table', { class: 'gtable lc__table', hidden: true },
      h('caption', { class: 'sr-only' }, label),
      h('thead', null, h('tr', null, tableHead.map((t, i) => h('th', { scope: 'col', class: i === 1 ? 'num' : undefined }, t)))),
      h('tbody', null, points.map((p) => h('tr', null,
        h('td', { class: 'nowrap' }, formatT(p.t)),
        h('td', { class: 'num tabular' }, format(p.y)),
        h('td', { class: 'faint' }, p.note || '')))));
    const toggle = h('button', { class: 'btn btn--ghost btn--sm', type: 'button', 'aria-expanded': 'false', 'data-fkey': `lc-table:${label}` }, 'Show table');
    toggle.addEventListener('click', () => {
      const showTable = table.hidden;
      table.hidden = !showTable;
      toggle.textContent = showTable ? 'Hide table' : 'Show table';
      toggle.setAttribute('aria-expanded', String(showTable));
    });

    return h('figure', { class: 'lc', style: { '--c': color || 'var(--accent)' } },
      h('div', { class: 'lc__frame' }, plot),
      h('div', { class: 'lc__axis', 'aria-hidden': 'true' },
        h('span', null, formatT(points[0].t)), points.length > 1 && h('span', null, formatT(last.t))),
      h('figcaption', { class: 'lc__foot' }, toggle),
      live,
      table);
  }

  Gesso.charts = { svg, meter, sparkline, lineChart };
})();
