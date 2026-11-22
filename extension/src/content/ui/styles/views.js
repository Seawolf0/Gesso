// @ts-check
/** View styles: toolbar & filters, assignments table, courses, workspace, overlays. */
(() => {
  const { css } = Gesso.styles;

  Gesso.styles.sheets.push(css`
    /* ======================= toolbar, search, selects ======================= */
    .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); }
    .search {
      flex: 1 1 280px; max-width: 520px;
      display: flex; align-items: center; gap: var(--sp-2);
      height: 38px; padding: 0 var(--sp-3);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
      color: var(--text-3);
      transition: border-color var(--dur-fast) var(--ease);
    }
    .search:focus-within { border-color: var(--accent); }
    .search__input {
      flex: 1; min-width: 0; height: 100%;
      background: transparent; border: 0; outline: none;
      font: inherit; color: var(--text);
    }
    .search__input::placeholder { color: var(--text-3); }
    .select { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); color: var(--text-3); }
    .select__input, .date-input {
      height: 38px; padding: 0 var(--sp-3);
      font: inherit; font-size: var(--fs-base); color: var(--text);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
    }
    .select__input:focus-visible, .date-input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    .custom-range { display: inline-flex; align-items: center; gap: var(--sp-2); }

    .filters { display: flex; flex-direction: column; gap: var(--sp-2); margin-bottom: var(--sp-4); }
    .filters__row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .filters__label {
      width: 56px; flex: none;
      font-size: var(--fs-xs); font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3);
    }
    .filters__reset { margin-left: auto; }
    .chip {
      display: inline-flex; align-items: center; gap: 6px;
      height: 28px; padding: 0 10px;
      border-radius: var(--r-full);
      border: 1px solid var(--border);
      background: var(--surface);
      font-size: var(--fs-sm); font-weight: 550; color: var(--text-2);
      transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .chip:hover { border-color: var(--border-strong); color: var(--text); }
    .chip[aria-pressed="true"] { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 55%, transparent); color: var(--text); }
    .chip__count { font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; }
    .acenter__summary { font-size: var(--fs-sm); color: var(--text-3); margin-bottom: var(--sp-3); }

    /* ======================= assignments table ======================= */
    .atable-wrap {
      overflow: clip; /* not a scroll container on desktop: wheel goes to the page, header sticks to the page */
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg);
    }
    .atable { width: 100%; border-collapse: separate; border-spacing: 0; font-size: var(--fs-base); }
    .atable th, .atable td { text-align: left; vertical-align: middle; }
    .atable thead th {
      position: sticky; top: var(--topbar-h); z-index: 2;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 var(--sp-2);
      height: 40px;
      font-size: var(--fs-xs); font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3);
      white-space: nowrap;
    }
    .atable thead th:first-child { padding-left: var(--sp-4); }
    .th-btn { display: inline-flex; align-items: center; gap: 5px; padding: 6px 6px; margin: 0; border-radius: 6px; text-transform: inherit; letter-spacing: inherit; font-weight: inherit; color: inherit; }
    .th-btn:hover { color: var(--text); background: var(--surface-2); }
    .th-btn__icon { opacity: .45; }
    .th-btn--active { color: var(--text); }
    .th-btn--active .th-btn__icon { opacity: 1; color: var(--accent-text); }
    .num { text-align: right !important; }
    .num .th-btn { flex-direction: row-reverse; }

    .group-row th {
      padding: var(--sp-4) var(--sp-4) var(--sp-2);
      background: var(--surface);
      font-size: var(--fs-sm); font-weight: 650; color: var(--text);
      text-transform: none; letter-spacing: 0;
    }
    tbody + tbody .group-row th { border-top: 1px solid var(--border); }
    .group-row__sub { color: var(--text-3); font-weight: 500; margin-left: var(--sp-2); }
    .group-row__count {
      margin-left: var(--sp-2); font-size: var(--fs-xs); font-weight: 650; color: var(--text-2);
      background: var(--surface-3); border-radius: var(--r-full); padding: 1px 7px;
    }

    .arow td { padding: var(--row-pad-y) var(--sp-2); border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent); }
    .group-row + .arow td { border-top-color: transparent; }
    /* Timeline sections (default due sort): a quieter band above the day/course groups. */
    .section-row th {
      padding: var(--sp-2) var(--sp-4);
      background: var(--surface-2);
      font-size: var(--fs-xs); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-2);
    }
    tbody + tbody.section .section-row th { border-top: 1px solid var(--border); }
    .section--overdue .section-row__label { color: var(--danger); }
    .section-row__count {
      margin-left: var(--sp-2); font-weight: 650; color: var(--text-2); letter-spacing: 0;
      background: var(--surface-3); border-radius: var(--r-full); padding: 1px 7px;
    }
    tbody.section + tbody .group-row th { border-top: 0; }
    tbody.section + tbody .group-row + .arow td, tbody.section + tbody > .arow:first-child td { border-top-color: transparent; }
    .arow td:first-child { padding-left: var(--sp-4); box-shadow: inset 3px 0 0 var(--c); }
    .arow[data-href] { cursor: pointer; }
    .arow:hover td { background: var(--surface-2); }
    .arow--done .atitle__link { color: var(--text-2); }
    /* Deep-linked row (e.g. from the native-page launcher): accent wash that settles. */
    .arow--highlight td { background: var(--accent-soft); animation: row-flash 1.6s var(--ease) 1; }
    .arow--highlight td:first-child { box-shadow: inset 3px 0 0 var(--accent); }
    @keyframes row-flash { 0%, 30% { background: color-mix(in srgb, var(--accent) 32%, transparent); } }
    .atitle { display: flex; align-items: center; gap: var(--sp-3); min-width: 260px; }
    .atitle__icon {
      width: 28px; height: 28px; border-radius: 8px; flex: none;
      display: grid; place-items: center;
      background: color-mix(in srgb, var(--c) 15%, transparent);
      color: color-mix(in srgb, var(--c) 75%, var(--text));
    }
    .atitle__main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .atitle__link { font-weight: 560; color: var(--text); }
    a.atitle__link:hover { text-decoration: underline; text-underline-offset: 2px; }
    .atitle__tags { display: flex; gap: 4px; flex-wrap: wrap; }
    .acourse { display: inline-flex; align-items: center; gap: 7px; max-width: 160px; color: var(--text-2); }
    .adue { white-space: nowrap; }
    .adue__rel { display: block; font-weight: 560; }
    .adue__rel--overdue, .adue__rel--critical { color: var(--danger); }
    .adue__rel--high { color: var(--warn); }
    .adue__abs { display: block; font-size: var(--fs-sm); color: var(--text-3); }
    .agrade { font-weight: 600; }
    .agrade__pct { display: block; font-size: var(--fs-sm); color: var(--text-3); }
    .atable td.num { padding-right: var(--sp-4); }
    .atable th.num { padding-right: var(--sp-4); }
    @media (max-width: 900px) { .col-points, .col-priority { display: none; } }
    /* Narrow windows: the table may be wider than the screen → sideways scroll only. */
    @media (max-width: 720px) { .atable-wrap { overflow-x: auto; overflow-y: hidden; } .atable thead th { position: static; } }
    @media (max-width: 720px) { .col-course { display: none; } }

    /* ======================= courses page ======================= */
    .course-card--dim { opacity: .6; }
    .course-card__stats { display: flex; gap: 6px; font-size: var(--fs-sm); color: var(--text-2); margin-top: 6px; flex-wrap: wrap; }
    .text-danger { color: var(--danger); }
    .manage-list { display: flex; flex-direction: column; gap: 6px; }
    .manage-row {
      display: flex; align-items: center; gap: var(--sp-4);
      padding: var(--sp-3) var(--sp-4);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-md);
    }
    .manage-row--hidden { opacity: .6; }
    .manage-row__swatch { width: 40px; height: 40px; border-radius: 10px; flex: none; }
    .manage-row__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .manage-row__name { font-weight: 600; overflow: clip; text-overflow: ellipsis; white-space: nowrap; }
    .manage-row__actions { display: flex; align-items: center; gap: 2px; }
    .hidden-courses { margin-top: var(--sp-8); }
    .hidden-courses > summary { cursor: pointer; color: var(--text-2); font-weight: 600; margin-bottom: var(--sp-4); }

    /* ======================= workspace ======================= */
    .ws-head {
      position: relative; overflow: clip;
      border-radius: var(--r-xl);
      background: var(--grad);
      color: #fff;
      margin-bottom: var(--sp-4);
    }
    .ws-head__img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; opacity: .35; }
    .ws-head::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, rgba(0,0,0,.35), rgba(0,0,0,.05)); pointer-events: none; }
    .ws-head__inner {
      position: relative; z-index: 1;
      display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-6); flex-wrap: wrap;
      padding: var(--sp-8) var(--sp-8) var(--sp-6);
    }
    .ws-head__text .course-card__code { display: inline-block; margin-bottom: var(--sp-3); }
    .ws-head__name { font-family: var(--font-display); font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -.02em; line-height: 1.15; }
    .ws-head__sub { margin-top: 6px; color: rgba(255,255,255,.78); }
    .ws-head__side { display: flex; flex-direction: column; align-items: flex-end; gap: var(--sp-3); }
    .ws-grade { display: flex; align-items: baseline; gap: var(--sp-2); }
    .ws-grade__primary { font-size: 34px; font-weight: 750; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
    .ws-grade__secondary { color: rgba(255,255,255,.8); font-variant-numeric: tabular-nums; }
    .ws-head__actions { display: flex; gap: var(--sp-2); }
    @media (max-width: 860px) {
      .ws-head__inner { padding: var(--sp-6) var(--sp-5) var(--sp-5); }
      .ws-head__side { align-items: flex-start; }
    }
    .btn--glass { background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.18); color: #fff; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
    .btn--glass:hover { background: rgba(255,255,255,.22); border-color: rgba(255,255,255,.3); }

    /* Tab bar wraps instead of scrolling; the active underline is an inset
       shadow so nothing overhangs the row (overhang + overflow = scrollable). */
    .tabs {
      display: flex; flex-wrap: wrap; gap: 2px;
      box-shadow: inset 0 -1px 0 var(--border);
      margin-bottom: var(--gap);
    }
    .tabs__tab {
      display: inline-flex; align-items: center; gap: 6px;
      padding: var(--sp-3) var(--sp-4);
      color: var(--text-2); font-weight: 560; white-space: nowrap;
      box-shadow: inset 0 -2px 0 transparent;
      transition: color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease);
    }
    .tabs__tab:hover { color: var(--text); }
    .tabs__tab[aria-current="page"] { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
    .tabs__count { font-size: var(--fs-xs); font-weight: 650; background: var(--surface-3); color: var(--text-2); border-radius: var(--r-full); padding: 1px 7px; }

    .glance { display: flex; align-items: center; gap: var(--sp-5); }
    .glance__big .grade__primary { font-size: 40px; }
    .glance p + p { margin-top: 2px; }

    /* ---- modules ---- */
    .modules, .anns { display: flex; flex-direction: column; gap: var(--sp-3); }
    .modules__bar { display: flex; align-items: center; gap: var(--sp-2); }
    .module, .ann { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg); overflow: clip; }
    .module__head, .ann__head {
      display: flex; align-items: center; gap: var(--sp-3);
      padding: var(--sp-4) var(--sp-5);
      cursor: pointer; list-style: none;
    }
    .module__head::-webkit-details-marker, .ann__head::-webkit-details-marker { display: none; }
    .module__head:hover, .ann__head:hover { background: var(--surface-2); }
    .module__chev { color: var(--text-3); transform: rotate(-90deg); transition: transform var(--dur) var(--ease); }
    details[open] > summary .module__chev { transform: none; }
    .module__name { flex: 1; min-width: 0; font-weight: 650; font-size: var(--fs-md); }
    .module__progress { display: inline-flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); color: var(--text-3); }
    .meter { width: 72px; height: 6px; border-radius: 3px; background: var(--surface-3); overflow: clip; }
    .meter__fill { display: block; height: 100%; background: var(--ok); border-radius: 3px; }
    .module__note { padding: 0 var(--sp-5) var(--sp-4); color: var(--text-3); font-size: var(--fs-sm); }
    .mitems { border-top: 1px solid var(--border); padding: var(--sp-2) 0; }
    .mitem {
      display: flex; align-items: center; gap: var(--sp-3);
      padding: 8px var(--sp-5) 8px calc(var(--sp-5) + var(--indent, 0) * 24px);
    }
    .mitem:hover { background: var(--surface-2); }
    .mitem--header {
      font-size: var(--fs-xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3);
      padding-top: var(--sp-4);
    }
    .mitem--header:hover { background: none; }
    .mitem--locked { opacity: .6; }
    .mitem__icon { color: var(--text-3); display: grid; place-items: center; width: 20px; }
    .mitem__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .mitem__title { font-weight: 520; display: inline-flex; align-items: center; gap: 4px; }
    a.mitem__title:hover { color: var(--accent-text); }
    .mitem__ext { color: var(--text-3); }
    .mitem__meta { font-size: var(--fs-sm); color: var(--text-3); }
    .mitem__req { display: inline-flex; align-items: center; gap: 5px; font-size: var(--fs-xs); color: var(--text-3); white-space: nowrap; }
    .mitem__req--done { color: var(--ok); }
    @media (max-width: 640px) { .mitem__req-label { display: none; } }

    /* ---- files ---- */
    .files { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr); gap: var(--gap); align-items: start; }
    @media (max-width: 860px) { .files { grid-template-columns: minmax(0, 1fr); } }
    .files__tree { padding: var(--sp-3) var(--sp-2); max-height: 70vh; overflow: auto; }
    .tree ul { margin: 0; }
    .tnode { display: flex; align-items: center; gap: 2px; padding-left: calc(var(--depth) * 14px); border-radius: var(--r-sm); }
    .tnode--selected { background: var(--surface-3); }
    .tnode__toggle { width: 22px; height: 28px; display: grid; place-items: center; color: var(--text-3); flex: none; }
    .tnode__btn { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px; height: 30px; padding-right: var(--sp-2); text-align: left; color: var(--text-2); border-radius: var(--r-sm); }
    .tnode--selected .tnode__btn { color: var(--text); font-weight: 600; }
    .tnode__btn .icon { color: var(--text-3); flex: none; }
    .rot90 { transform: rotate(90deg); }
    .files__pane .search { max-width: none; margin-bottom: var(--sp-4); }
    .crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-bottom: var(--sp-3); color: var(--text-3); font-size: var(--fs-sm); }
    .crumbs__btn { color: var(--text-2); padding: 2px 4px; border-radius: 4px; }
    .crumbs__btn:hover { color: var(--text); background: var(--surface-2); }
    .crumbs__current { color: var(--text); font-weight: 600; padding: 2px 4px; }
    .flist { display: flex; flex-direction: column; }
    .frow {
      display: grid; grid-template-columns: 24px minmax(0, 1fr) 80px 70px 32px; align-items: center; gap: var(--sp-3);
      padding: 7px var(--sp-2); border-radius: var(--r-sm);
    }
    .frow:hover { background: var(--surface-2); }
    .frow__icon { color: var(--text-3); display: grid; place-items: center; }
    .frow__main { min-width: 0; display: flex; flex-direction: column; }
    .frow__name { font-weight: 520; overflow: clip; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
    a.frow__name:hover, .frow__folder:hover { color: var(--accent-text); }
    .frow__loc { font-size: var(--fs-xs); color: var(--text-3); }
    .frow__size, .frow__date { font-size: var(--fs-sm); color: var(--text-3); text-align: right; }
    .frow--locked { opacity: .6; }
    @media (max-width: 560px) { .frow { grid-template-columns: 24px minmax(0, 1fr) 32px; } .frow__size, .frow__date { display: none; } }

    /* ---- announcements ---- */
    .ann__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .ann__title { font-weight: 600; }
    .ann--unread .ann__title { font-weight: 750; }
    .ann__meta { font-size: var(--fs-sm); color: var(--text-3); }
    .ann__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
    .ann__body { padding: 0 var(--sp-5) var(--sp-5) calc(var(--sp-5) + 28px); }

    /* sanitized rich text */
    .prose { color: var(--text); line-height: 1.6; overflow-wrap: anywhere; margin-bottom: var(--sp-4); }
    .prose > * + * { margin-top: .75em; }
    .prose a { color: var(--accent-text); text-decoration: underline; text-underline-offset: 2px; }
    .prose ul, .prose ol { padding-left: 1.4em; }
    .prose ul { list-style: disc; } .prose ol { list-style: decimal; }
    .prose h3, .prose h4, .prose h5, .prose h6 { font-weight: 700; font-size: var(--fs-md); }
    .prose img { border-radius: var(--r-sm); height: auto; }
    .prose blockquote { border-left: 3px solid var(--border-strong); padding-left: var(--sp-3); color: var(--text-2); }
    .prose pre, .prose code { font-family: var(--font-mono); font-size: .92em; background: var(--surface-2); border-radius: 6px; }
    .prose code { padding: 1px 5px; }
    .prose pre { padding: var(--sp-3); overflow-x: auto; overflow-y: hidden; }
    .prose table { border-collapse: collapse; display: block; overflow-x: auto; overflow-y: hidden; }
    .prose td, .prose th { border: 1px solid var(--border); padding: 6px 10px; }
    .prose hr { border: 0; border-top: 1px solid var(--border); }
    .embed-link { display: inline-flex; padding: var(--sp-2) var(--sp-3); border: 1px dashed var(--border-strong); border-radius: var(--r-sm); }

    /* ---- grades tab ---- */
    .gsum { font-weight: 650; white-space: nowrap; }
    .gtable { width: 100%; border-collapse: collapse; font-size: var(--fs-base); }
    .gtable th { text-align: left; font-size: var(--fs-xs); font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); padding: 0 var(--sp-2) var(--sp-2); }
    .gtable td { padding: 8px var(--sp-2); border-top: 1px solid var(--border); }
    .gtable__muted td { opacity: .55; }
    .link-plain:hover { color: var(--accent-text); text-decoration: underline; text-underline-offset: 2px; }

    /* ======================= overlays ======================= */
    .toasts {
      position: fixed; right: var(--sp-6); bottom: calc(var(--sp-6) + env(safe-area-inset-bottom, 0px)); z-index: 50;
      display: flex; flex-direction: column; gap: var(--sp-2); max-width: min(420px, calc(100vw - 32px));
    }
    .toast {
      display: flex; align-items: center; gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-2) var(--sp-3) var(--sp-4);
      background: var(--surface-2); border: 1px solid var(--border-strong); border-radius: var(--r-md);
      box-shadow: var(--shadow);
      animation: fade-in var(--dur) var(--ease) both;
    }
    .toast__text { flex: 1; }
    .toast--ok > .icon { color: var(--ok); }
    .toast--danger > .icon { color: var(--danger); }
    .toast--info > .icon { color: var(--accent-text); }

    .dialog {
      width: min(560px, calc(100vw - 32px));
      padding: 0; border: 1px solid var(--border-strong); border-radius: var(--r-lg);
      background: var(--surface); color: var(--text);
      box-shadow: 0 24px 80px rgba(0,0,0,.45);
    }
    .dialog--narrow { width: min(480px, calc(100vw - 32px)); }
    .dialog::backdrop { background: var(--overlay); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
    .dialog__head { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-4) 0 var(--sp-6); }
    .dialog__title { font-size: var(--fs-lg); font-weight: 700; }
    .dialog__body { padding: var(--sp-4) var(--sp-6) var(--sp-6); }

    .form { display: flex; flex-direction: column; gap: var(--sp-5); }
    .field { display: flex; flex-direction: column; gap: 6px; }
    .field__label, .check__label { font-weight: 600; }
    .field__input {
      height: 38px; padding: 0 var(--sp-3);
      font: inherit; color: var(--text);
      background: var(--bg); border: 1px solid var(--border-strong); border-radius: var(--r-sm);
    }
    .field__input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    .field__hint { font-size: var(--fs-sm); color: var(--text-3); }
    .field__error { color: var(--danger); font-size: var(--fs-sm); }
    .field__error:empty { display: none; }
    .color-row { display: flex; align-items: center; gap: var(--sp-4); }
    .swatch-preview { width: 52px; height: 52px; border-radius: 12px; flex: none; }
    .swatches { display: flex; flex-wrap: wrap; gap: 8px; }
    .swatch { width: 26px; height: 26px; border-radius: 50%; background: var(--c); border: 2px solid transparent; box-shadow: inset 0 0 0 2px var(--surface); }
    .swatch[aria-checked="true"] { border-color: var(--text); }
    .swatch-custom { width: 30px; height: 30px; padding: 0; border: 1px solid var(--border-strong); border-radius: 50%; background: none; cursor: pointer; }
    .check { display: flex; align-items: flex-start; gap: var(--sp-3); cursor: pointer; }
    .check input { margin-top: 3px; accent-color: var(--accent); width: 16px; height: 16px; }
    .check > span { display: flex; flex-direction: column; gap: 2px; }
    .form__actions { display: flex; align-items: center; gap: var(--sp-2); }

    /* ======================= planner: done / snooze / to-dos ======================= */
    .row-actions { display: inline-flex; align-items: center; gap: 2px; flex: none; }
    .done-btn {
      width: 30px; height: 30px; display: grid; place-items: center; flex: none;
      border: 0; border-radius: 50%; background: transparent; color: var(--text-3); cursor: pointer;
      transition: color var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease);
    }
    .done-btn:hover:not(:disabled) { color: var(--ok); background: var(--surface-3); }
    .done-btn--on { color: var(--ok); }
    .done-btn:disabled { cursor: default; opacity: .7; }
    .done-btn:focus-visible { border-radius: 50%; }
    .snooze-btn--on { color: var(--accent-text); }
    .snooze-choices { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: var(--sp-2); }
    .snooze-choice { height: auto; padding: var(--sp-2) var(--sp-3); flex-direction: column; align-items: flex-start; gap: 2px; }
    .snooze-choice .faint { font-size: var(--fs-sm); }
    .snooze-date { display: flex; gap: var(--sp-2); }
    .snooze-date .field__input { flex: 1; min-width: 0; }
    .todo-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr); gap: var(--sp-3); }
    @media (max-width: 520px) { .todo-row { grid-template-columns: 1fr; } }
    .field__input--area { height: auto; padding: var(--sp-2) var(--sp-3); resize: vertical; min-height: 72px; line-height: 1.45; }
    select.field__input { padding-right: var(--sp-2); }
    .atitle .row-actions { margin-left: auto; padding-left: var(--sp-2); }
    .adetail__planner { display: inline-flex; gap: var(--sp-2); }
    .selftest { list-style: none; margin: var(--sp-3) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
    .selftest li { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: var(--sp-2); align-items: start; }
    .selftest .icon { margin-top: 2px; }
    .selftest__ok { color: var(--ok); }
    .selftest__bad { color: var(--danger); }
    .selftest__warn { color: var(--warn); }
    .render-error__actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); justify-content: center; margin-top: var(--sp-3); }
    .file-pick { font: inherit; color: var(--text-2); max-width: 320px; }
    .selftest__run { color: var(--text-3); }
    .selftest__detail { display: block; font-size: var(--fs-sm); color: var(--text-3); overflow-wrap: anywhere; }
    .selftest-controls { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-3); }

    /* ======================= command palette + shortcuts ======================= */
    .palette {
      width: min(640px, calc(100vw - 32px)); max-height: min(560px, calc(100vh - 120px));
      margin: 12vh auto auto; padding: 0; overflow: hidden;
      border: 1px solid var(--border-strong); border-radius: var(--r-lg);
      background: var(--surface); color: var(--text); box-shadow: 0 24px 80px rgba(0,0,0,.45);
      flex-direction: column;
    }
    .palette[open] { display: flex; }
    .palette::backdrop { background: var(--overlay); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); }
    .palette__search { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-bottom: 1px solid var(--border); color: var(--text-3); }
    .palette__input { flex: 1; min-width: 0; height: 36px; border: 0; background: none; color: var(--text); font: inherit; font-size: var(--fs-md); }
    .palette__input:focus-visible { outline: none; }
    .palette__input::placeholder { color: var(--text-3); }
    .palette__list { list-style: none; margin: 0; padding: var(--sp-2); overflow-y: auto; flex: 1; min-height: 0; overscroll-behavior: contain; }
    .palette__opt {
      display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: var(--sp-3);
      padding: 7px var(--sp-3); border-radius: var(--r-md); cursor: pointer;
    }
    .palette__opt[aria-selected="true"] { background: var(--accent-soft); }
    .palette__opt[aria-selected="true"] .palette__kind { color: var(--accent-text); }
    .palette__icon {
      width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center;
      background: color-mix(in srgb, var(--c, var(--text-3)) 16%, transparent);
      color: color-mix(in srgb, var(--c, var(--text-2)) 75%, var(--text));
    }
    .palette__text { min-width: 0; display: flex; align-items: baseline; gap: var(--sp-2); }
    .palette__title { font-weight: 560; overflow: clip; text-overflow: ellipsis; white-space: nowrap; flex: 0 1 auto; min-width: 0; }
    .palette__sub { font-size: var(--fs-sm); color: var(--text-3); overflow: clip; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; min-width: 0; }
    .palette__kind { font-size: var(--fs-xs); color: var(--text-3); white-space: nowrap; }
    .palette__empty { padding: var(--sp-6) var(--sp-3); text-align: center; color: var(--text-3); }
    .palette__foot { display: flex; align-items: center; gap: var(--sp-4); padding: var(--sp-2) var(--sp-4); border-top: 1px solid var(--border); font-size: var(--fs-xs); color: var(--text-3); }
    .palette__foot .kbd { margin-right: 2px; }
    .palette__spacer { flex: 1; }
    .palette__status { margin: 0; }
    @media (max-width: 640px) { .palette__foot > span:not(.palette__spacer) { display: none; } .palette__sub { display: none; } }
    .keys { display: flex; flex-direction: column; gap: var(--sp-5); }
    .keys dl { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .keys__row { display: grid; grid-template-columns: 110px minmax(0, 1fr); align-items: center; gap: var(--sp-3); }
    .keys__row dt { display: flex; gap: 4px; }
    .keys__row dd { margin: 0; color: var(--text-2); }
    .keys--here .set-legend { color: var(--accent-text); }

    /* ======================= settings (incl. native dark mode) ======================= */
    .settings-page { display: flex; flex-direction: column; gap: var(--gap); max-width: 760px; }
    .set-row { margin-bottom: var(--sp-4); }
    .set-group { border: 0; margin: 0 0 var(--sp-4); padding: 0; min-width: 0; }
    .set-group:disabled { opacity: .5; }
    .set-legend { padding: 0; margin-bottom: var(--sp-2); font-size: var(--fs-xs); font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3); }
    .set-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 4px var(--sp-4); }
    .set-check { display: flex; align-items: flex-start; gap: var(--sp-2); padding: 6px 0; cursor: pointer; }
    .set-check input { width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--accent); flex: none; }
    .set-hint { display: block; font-size: var(--fs-sm); color: var(--text-3); }
    .set-note { font-size: var(--fs-sm); }
    .set-line { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-5); padding: var(--sp-3) 0; border-top: 1px solid var(--border); }
    .set-line:first-child { border-top: 0; padding-top: 0; }
    .set-line__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 420px; }
    .set-line__label { font-weight: 600; }
    .set-line__control { position: relative; flex: none; display: flex; align-items: center; gap: var(--sp-2); }
    .set-line__control .select__label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    @media (max-width: 640px) { .set-line { flex-direction: column; align-items: flex-start; } }
    .seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-full); }
    .seg__opt { position: relative; }
    .seg__input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
    .seg__opt span { display: block; padding: 5px var(--sp-4); border-radius: var(--r-full); color: var(--text-3); font-size: var(--fs-sm); font-weight: 600; }
    .seg__input:checked + span { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
    .seg__input:focus-visible + span { outline: 2px solid var(--focus); outline-offset: 1px; }
    .switch input { width: 18px; height: 18px; accent-color: var(--accent); cursor: pointer; }
    .swatch-custom::-webkit-color-swatch-wrapper { padding: 3px; }
    .swatch-custom::-webkit-color-swatch { border: 0; border-radius: 50%; }
    .swatch-custom-wrap { display: inline-grid; place-items: center; border-radius: 50%; border: 2px solid transparent; }
    .swatch-custom-wrap--on { border-color: var(--text); }
    .set-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sp-2); }
    .set-list__row { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: var(--sp-3); }
  `);
})();
