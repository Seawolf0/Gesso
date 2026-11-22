// @ts-check
/** Calendar: header, filter sidebar, week grid, month grid, agenda, event dialog. */
(() => {
  const { css } = Gesso.styles;

  Gesso.styles.sheets.push(css`
    /* ======================= header ======================= */
    .cal-head { display: flex; align-items: center; gap: var(--sp-3); flex-wrap: wrap; margin-bottom: var(--sp-4); }
    .cal-head__title {
      margin-right: auto;
      font-family: var(--font-display); font-size: var(--fs-xl); font-weight: 650; letter-spacing: -.01em;
    }
    .cal-head__nav { display: flex; gap: 6px; }
    .btn--current { border-color: color-mix(in srgb, var(--accent) 55%, transparent); color: var(--accent-text); }

    /* Segmented control (links with aria-current) */
    .seg {
      display: inline-flex; gap: 2px; padding: 3px;
      background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-sm);
    }
    .seg__item {
      display: inline-flex; align-items: center; height: 26px; padding: 0 12px;
      border-radius: 6px; font-size: var(--fs-sm); font-weight: 600; color: var(--text-2);
    }
    .seg__item:hover { color: var(--text); }
    .seg__item[aria-current="page"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }

    /* ======================= layout ======================= */
    .cal-layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: var(--gap); align-items: start; }
    .cal-main { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
    .cal-notice {
      display: flex; align-items: center; gap: var(--sp-2);
      padding: var(--sp-2) var(--sp-3); border-radius: var(--r-md);
      background: var(--warn-soft); font-size: var(--fs-sm);
    }
    .cal-notice .btn { margin-left: auto; }
    .cal-loading { font-size: var(--fs-sm); }

    /* ======================= workload heat ======================= */
    /* --heat tints a whole day; --heat-strong marks it (bars, dots, legend). One accent, four steps. */
    .heat-0 { --heat: transparent; --heat-strong: transparent; }
    .heat-1 { --heat: color-mix(in srgb, var(--accent) 7%, transparent);  --heat-strong: color-mix(in srgb, var(--accent) 35%, transparent); }
    .heat-2 { --heat: color-mix(in srgb, var(--accent) 13%, transparent); --heat-strong: color-mix(in srgb, var(--accent) 55%, transparent); }
    .heat-3 { --heat: color-mix(in srgb, var(--accent) 21%, transparent); --heat-strong: color-mix(in srgb, var(--accent) 78%, transparent); }
    .heat-4 { --heat: color-mix(in srgb, var(--accent) 31%, transparent); --heat-strong: var(--accent); }

    /* ======================= sidebar ======================= */
    .cal-side {
      display: flex; flex-direction: column; gap: var(--sp-4);
      padding: var(--sp-4);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg);
    }
    .cal-side__head { display: flex; align-items: center; justify-content: space-between; min-height: 28px; margin-bottom: var(--sp-1); }
    .cal-side__title { font-size: var(--fs-xs); font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3); }
    .cal-side__group > .cal-side__title { margin-bottom: var(--sp-2); }
    .cal-side__list { display: flex; flex-direction: column; gap: 2px; }
    .cal-filter {
      display: flex; align-items: center; gap: var(--sp-2);
      width: 100%; height: 32px; padding: 0 var(--sp-2);
      border-radius: var(--r-sm); text-align: left; font-size: var(--fs-base);
    }
    .cal-filter:hover { background: var(--surface-2); }
    .cal-filter__box {
      width: 16px; height: 16px; flex: none; display: grid; place-items: center;
      border: 1.5px solid var(--c); border-radius: 5px; color: #0b0d12;
    }
    .cal-filter[aria-pressed="true"] .cal-filter__box { background: var(--c); }
    .cal-filter__label { flex: 1; }
    .cal-filter[aria-pressed="false"] .cal-filter__label { color: var(--text-3); }
    .cal-filter__count { font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }
    .cal-legend { display: flex; align-items: center; gap: 4px; font-size: var(--fs-xs); color: var(--text-3); }
    .cal-legend__sw { width: 18px; height: 12px; border-radius: 3px; background: var(--heat-strong); }
    .cal-side__note { font-size: var(--fs-xs); line-height: 1.45; color: var(--text-3); margin-top: var(--sp-2); }
    .cal-side__undated {
      display: flex; align-items: center; gap: var(--sp-2);
      padding: var(--sp-2); border-radius: var(--r-sm);
      background: var(--surface-2); font-size: var(--fs-sm); color: var(--text-2);
    }
    .cal-side__undated:hover { color: var(--text); background: var(--surface-3); }
    .cal-side__undated span { flex: 1; }
    .cal-side__export { width: 100%; }
    .cal-side__export + .cal-side__note { margin-top: calc(-1 * var(--sp-2)); }

    /* Below 1600 px the sidebar becomes one compact band above the calendar, so week columns keep their width. */
    @media (max-width: 1599px) {
      .cal-layout { grid-template-columns: minmax(0, 1fr); }
      .cal-side { flex-direction: row; flex-wrap: wrap; align-items: center; gap: var(--sp-2) var(--sp-5); padding: var(--sp-2) var(--sp-3); }
      .cal-side__group { display: flex; align-items: center; flex-wrap: wrap; gap: 4px var(--sp-3); }
      .cal-side__group:first-child { flex: 1 1 420px; }
      .cal-side__head, .cal-side__group > .cal-side__title { margin: 0; min-height: 0; }
      .cal-side__head { gap: var(--sp-2); }
      .cal-side__list { flex-direction: row; flex-wrap: wrap; gap: 2px var(--sp-1); }
      .cal-filter { width: auto; height: 30px; }
      .cal-filter__label { flex: none; max-width: 160px; }
      .cal-side__note { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; } /* still read by screen readers */
      .cal-side__undated { padding: 4px var(--sp-2); }
      .cal-side__export { width: auto; height: 30px; }
    }
    @media (max-width: 720px) { .cal-side__group:first-child { flex-basis: 100%; } }

    /* ======================= chips (Due lane, month cells) ======================= */
    .cal-chip {
      display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 5px; row-gap: 1px;
      width: 100%; min-width: 0; padding: 4px 6px;
      border-radius: 6px; border-left: 3px solid var(--c);
      background: color-mix(in srgb, var(--c) 15%, var(--surface));
      font-size: var(--fs-sm); line-height: 1.25; text-align: left; color: var(--text);
    }
    .cal-chip:hover { background: color-mix(in srgb, var(--c) 25%, var(--surface)); }
    .cal-chip__icon { display: flex; color: color-mix(in srgb, var(--c) 70%, var(--text)); }
    .cal-chip__time { font-size: var(--fs-xs); font-weight: 600; color: var(--text-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cal-chip__title {
      grid-column: 1 / -1; min-width: 0; font-weight: 550; overflow-wrap: anywhere;
      overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    }
    .cal-chip--compact { padding: 2px 6px; font-size: var(--fs-xs); }
    .cal-chip--compact .cal-chip__title { grid-column: 2; display: block; overflow: clip; white-space: nowrap; text-overflow: ellipsis; }
    .cal-chip--event { background: transparent; border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); border-left: 3px solid var(--c); }
    .cal-chip--done { opacity: .6; }
    .cal-chip--done .cal-chip__title { text-decoration: line-through; text-decoration-color: var(--text-3); }
    .cal-chip--overdue .cal-chip__time { color: var(--danger); }

    /* ======================= week ======================= */
    .cal-week {
      display: grid;
      grid-template-columns: 56px repeat(7, minmax(0, 1fr));
      grid-template-rows: auto auto var(--grid-h);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg);
      overflow: clip;
    }
    .cal-week__corner, .cal-week__lanelabel { border-bottom: 1px solid var(--border); }
    .cal-week__lanelabel {
      padding: var(--sp-2) 8px 0 0; text-align: right;
      font-size: var(--fs-xs); font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3);
    }
    .cal-dayhead {
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      padding: var(--sp-2) 0 6px;
      border-left: 1px solid var(--border); border-bottom: 1px solid var(--border);
      border-radius: 0;
    }
    .cal-dayhead:hover { background: var(--surface-2); }
    .cal-dayhead__wd { font-size: var(--fs-xs); font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3); }
    .cal-dayhead__num {
      width: 32px; height: 32px; display: grid; place-items: center; border-radius: 50%;
      font-size: var(--fs-lg); font-weight: 650; font-variant-numeric: tabular-nums;
    }
    .cal-dayhead--today .cal-dayhead__wd { color: var(--accent-text); }
    .cal-dayhead--today .cal-dayhead__num { background: var(--accent); color: var(--accent-fg); }
    .cal-heatbar { width: 44%; height: 3px; border-radius: 2px; background: var(--heat-strong); }
    .cal-lane {
      display: flex; flex-direction: column; gap: 4px;
      min-width: 0; min-height: 56px; padding: 6px 4px;
      border-left: 1px solid var(--border); border-bottom: 1px solid var(--border);
      background-image: linear-gradient(var(--heat), var(--heat));
    }
    .cal-week__hours { position: relative; }
    .cal-hour {
      position: absolute; right: 8px; transform: translateY(-50%);
      font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    .cal-hour:first-child { transform: none; padding-top: 2px; }
    .cal-col {
      position: relative; min-width: 0;
      border-left: 1px solid var(--border);
      background-image: repeating-linear-gradient(to bottom,
        transparent 0, transparent calc(var(--hour-h) - 1px),
        color-mix(in srgb, var(--border) 70%, transparent) calc(var(--hour-h) - 1px), color-mix(in srgb, var(--border) 70%, transparent) var(--hour-h));
    }
    .cal-col--today { background-color: color-mix(in srgb, var(--accent) 4%, transparent); }
    .cal-block {
      position: absolute; z-index: 1;
      display: flex; flex-direction: column; gap: 1px;
      padding: 4px 6px; overflow: clip;
      border-radius: 6px; border-left: 3px solid var(--c);
      background: color-mix(in srgb, var(--c) 22%, var(--surface));
      font-size: var(--fs-sm); line-height: 1.25; text-align: left; color: var(--text);
    }
    .cal-block:hover, .cal-block:focus-visible { z-index: 2; background: color-mix(in srgb, var(--c) 32%, var(--surface)); }
    .cal-block__title { font-weight: 600; overflow-wrap: break-word; }
    .cal-block__meta { font-size: var(--fs-xs); color: var(--text-2); white-space: nowrap; overflow: clip; text-overflow: ellipsis; }
    /* Short blocks: one line, the title wins the space. Narrow (3+ side by side): title only, smaller. */
    .cal-block--short { flex-direction: row; align-items: center; gap: 6px; padding: 1px 6px; }
    .cal-block--short .cal-block__title { flex: 0 1 auto; white-space: nowrap; overflow: clip; text-overflow: ellipsis; min-width: 0; }
    .cal-block--short .cal-block__meta { flex: 1 1 0; min-width: 0; }
    .cal-block--narrow { padding: 3px 4px; font-size: var(--fs-xs); }
    .cal-block--narrow .cal-block__meta { display: none; }
    /* The "now" line: red, with a dot at the start of today's column. */
    .cal-now { position: absolute; left: 0; right: 0; z-index: 3; height: 0; border-top: 2px solid var(--danger); pointer-events: none; }
    .cal-now::before {
      content: ''; position: absolute; left: -5px; top: -6px;
      width: 10px; height: 10px; border-radius: 50%; background: var(--danger);
    }
    /* Narrow windows: the week scrolls sideways rather than squeezing seven columns. */
    @media (max-width: 720px) {
      .cal-scroll { overflow-x: auto; overflow-y: hidden; }
      .cal-week { min-width: 680px; }
    }

    /* ======================= month ======================= */
    .cal-month { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: clip; }
    .cal-month__wd { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-bottom: 1px solid var(--border); }
    .cal-month__wd span {
      padding: var(--sp-2);
      font-size: var(--fs-xs); font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3);
    }
    .cal-month__grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-auto-rows: minmax(118px, auto); }
    .cal-cell {
      display: flex; flex-direction: column; gap: 4px;
      min-width: 0; padding: 6px;
      border-left: 1px solid var(--border); border-top: 1px solid var(--border);
      background-image: linear-gradient(var(--heat), var(--heat));
    }
    .cal-cell:nth-child(7n + 1) { border-left: 0; }
    .cal-cell:nth-child(-n + 7) { border-top: 0; }
    .cal-cell__num {
      align-self: flex-start; min-width: 26px; height: 26px; padding: 0 6px;
      display: grid; place-items: center; border-radius: var(--r-full);
      font-size: var(--fs-sm); font-weight: 650; font-variant-numeric: tabular-nums;
    }
    .cal-cell__num:hover { background: var(--surface-3); }
    .cal-cell--out .cal-cell__num { color: var(--text-3); }
    .cal-cell--out .cal-cell__items { opacity: .65; }
    .cal-cell--today .cal-cell__num { background: var(--accent); color: var(--accent-fg); }
    .cal-cell__items { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .cal-cell__more { align-self: flex-start; padding: 1px 6px; border-radius: 4px; font-size: var(--fs-xs); font-weight: 600; color: var(--text-2); }
    .cal-cell__more:hover { background: var(--surface-3); color: var(--text); }
    @media (max-width: 720px) { .cal-month__grid { grid-auto-rows: minmax(84px, auto); } .cal-cell { padding: 3px; } }

    /* ======================= agenda ======================= */
    .cal-agenda { display: flex; flex-direction: column; gap: var(--sp-3); }
    .cal-aday { padding: var(--sp-3) var(--sp-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); }
    .cal-aday--today { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); }
    .cal-aday__head { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-2); font-size: var(--fs-md); font-weight: 650; }
    .cal-aday__date { font-size: var(--fs-sm); font-weight: 500; color: var(--text-3); }
    .cal-aday__load { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); font-weight: 550; color: var(--text-2); }
    .cal-heatdot { width: 8px; height: 8px; border-radius: 50%; background: var(--heat-strong); }
    .cal-aday__empty { font-size: var(--fs-sm); }
    .cal-alist { display: flex; flex-direction: column; }
    .cal-arow {
      display: grid; grid-template-columns: 132px 28px minmax(0, 1fr) auto; align-items: center; gap: var(--sp-3);
      padding: var(--sp-2) 0;
      border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    }
    .cal-arow:first-child { border-top: 0; }
    .cal-arow__time { font-size: var(--fs-sm); font-weight: 550; color: var(--text-2); font-variant-numeric: tabular-nums; }
    .cal-arow__time--overdue { color: var(--danger); }
    .cal-arow__icon {
      width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px;
      background: color-mix(in srgb, var(--c) 15%, transparent); color: color-mix(in srgb, var(--c) 75%, var(--text));
    }
    .cal-arow__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .cal-arow__title { align-self: flex-start; font-weight: 560; text-align: left; overflow-wrap: anywhere; }
    a.cal-arow__title:hover, button.cal-arow__title:hover { text-decoration: underline; text-underline-offset: 2px; }
    .cal-arow--done .cal-arow__title { color: var(--text-2); }
    .cal-arow__end { display: flex; align-items: center; gap: var(--sp-2); }
    .cal-arow__meta { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-3); }
    @media (max-width: 720px) {
      .cal-arow { grid-template-columns: 88px minmax(0, 1fr) auto; }
      .cal-arow__icon { display: none; }
    }

    /* ======================= event dialog ======================= */
    .cal-event { display: flex; flex-direction: column; gap: var(--sp-3); }
    .cal-event__row { display: flex; align-items: center; gap: var(--sp-2); color: var(--text-2); }
    .cal-event__row .icon { color: var(--text-3); }
    .cal-event__desc { padding-top: var(--sp-3); border-top: 1px solid var(--border); }
    .cal-event__actions { display: flex; gap: var(--sp-2); }
  `);
})();
