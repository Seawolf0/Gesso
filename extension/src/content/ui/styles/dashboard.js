// @ts-check
/** Dashboard view styles. */
(() => {
  const { css } = Gesso.styles;

  Gesso.styles.sheets.push(css`
    .dash { display: flex; flex-direction: column; gap: var(--sp-8); }

    /* ---------- header ---------- */
    .dash-head { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-6); flex-wrap: wrap; }
    .greet__title {
      font-family: var(--font-display);
      font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -.025em; line-height: 1.15;
    }
    .greet__sub { color: var(--text-2); font-size: var(--fs-md); margin-top: var(--sp-2); }
    .date-chip {
      display: flex; align-items: center; gap: var(--sp-3);
      padding: 6px 14px 6px 6px;
      border: 1px solid var(--border); border-radius: var(--r-full);
      background: var(--surface);
    }
    .date-chip__day {
      width: 40px; height: 40px; border-radius: 50%;
      display: grid; place-items: center;
      background: var(--surface-3);
      font-weight: 700; font-size: var(--fs-md);
    }
    .date-chip__weekday { font-weight: 650; }
    .date-chip__month { font-size: var(--fs-sm); color: var(--text-3); }

    /* ---------- stat tiles ---------- */
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--gap); }
    .stat {
      display: flex; align-items: center; gap: var(--sp-4);
      padding: var(--sp-4) var(--sp-5);
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--r-lg);
    }
    .stat__icon {
      width: 40px; height: 40px; border-radius: 12px; flex: none;
      display: grid; place-items: center;
      background: var(--neutral-soft); color: var(--text-2);
    }
    .stat--danger .stat__icon { background: var(--danger-soft); color: var(--danger); }
    .stat--warn   .stat__icon { background: var(--warn-soft);   color: var(--warn); }
    .stat--accent .stat__icon { background: var(--accent-soft); color: var(--accent-text); }
    .stat--ok     .stat__icon { background: var(--ok-soft);     color: var(--ok); }
    .stat__value { font-size: var(--fs-xl); font-weight: 700; letter-spacing: -.02em; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .stat__label { font-size: var(--fs-sm); color: var(--text-3); }

    /* ---------- section heading ---------- */
    .section-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--sp-3); margin-bottom: var(--sp-4); }
    .section-head h2 { font-family: var(--font-display); font-size: var(--fs-lg); font-weight: 680; letter-spacing: -.015em; }
    .section-head .faint { font-size: var(--fs-sm); }

    /* ---------- course cards ---------- */
    .course-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: var(--gap); }
    .course-card {
      display: flex; flex-direction: column;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-lg);
      overflow: clip;
      transition: border-color var(--dur) var(--ease), transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
    }
    .course-card:hover { border-color: var(--border-strong); transform: translateY(-2px); box-shadow: var(--shadow); }
    .course-card:focus-visible { outline-offset: 3px; border-radius: var(--r-lg); }
    .course-card__banner {
      position: relative; height: 84px;
      background: var(--grad);
      display: flex; align-items: flex-end; justify-content: space-between;
      padding: var(--sp-3);
    }
    .course-card__banner img {
      position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover;
    }
    .course-card__banner::after {
      content: ""; position: absolute; inset: 0;
      background: linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,.45) 100%);
    }
    .course-card__code {
      position: relative; z-index: 1;
      font-size: var(--fs-xs); font-weight: 650; color: #fff;
      padding: 3px 9px; border-radius: var(--r-full);
      background: rgba(0, 0, 0, .32);
      backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
      max-width: 70%;
    }
    .course-card__fav { position: relative; z-index: 1; color: #fff; opacity: .85; }
    .course-card__body { padding: var(--sp-3) var(--sp-4) var(--sp-4); display: flex; flex-direction: column; gap: 2px; flex: 1; }
    .course-card__name {
      font-weight: 620; font-size: var(--fs-base); line-height: 1.35;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      min-height: 2.7em;
    }
    .course-card__term { font-size: var(--fs-sm); color: var(--text-3); }
    .course-card__foot {
      display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3);
      margin-top: var(--sp-3); padding-top: var(--sp-3);
      border-top: 1px solid var(--border);
    }
    .grade { display: flex; align-items: baseline; gap: 6px; }
    .grade__primary { font-size: var(--fs-lg); font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
    .grade__secondary { font-size: var(--fs-sm); color: var(--text-3); font-variant-numeric: tabular-nums; }
    .grade--good .grade__primary { color: var(--ok); }
    .grade--warn .grade__primary { color: var(--warn); }
    .grade--bad  .grade__primary { color: var(--danger); }
    .grade--none .grade__primary { color: var(--text-3); }
    .next-due { display: flex; align-items: center; gap: 5px; font-size: var(--fs-sm); color: var(--text-2); min-width: 0; }
    .next-due .icon { color: var(--text-3); }

    /* ---------- main 2-column grid ---------- */
    .dash-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.65fr) minmax(300px, 1fr);
      gap: var(--gap);
      align-items: start;
    }
    .stack { display: flex; flex-direction: column; gap: var(--gap); min-width: 0; }
    @media (max-width: 1180px) { .dash-grid { grid-template-columns: minmax(0, 1fr); } }

    /* ---------- work rows (due soon / overdue) ---------- */
    .day-group + .day-group { margin-top: var(--sp-4); }
    .day-group__label {
      display: flex; align-items: baseline; gap: var(--sp-2);
      font-size: var(--fs-sm); font-weight: 650; color: var(--text-2);
      padding: 0 var(--sp-2) var(--sp-1);
    }
    .day-group__label .faint { font-weight: 500; }
    .work-list { display: flex; flex-direction: column; gap: 2px; }
    .work-row {
      display: grid;
      grid-template-columns: 3px 30px minmax(0, 1fr) auto;
      align-items: center; gap: var(--sp-3);
      padding: var(--row-pad-y) var(--sp-2);
      border-radius: var(--r-md);
      transition: background var(--dur-fast) var(--ease);
    }
    .work-row { position: relative; }
    .work-row:hover { background: var(--surface-2); }
    /* The title link covers the whole row; the row shows its focus ring. */
    .work-row__link { display: block; color: inherit; text-decoration: none; text-align: left; width: 100%; padding: 0; border: 0; background: none; font: inherit; cursor: pointer; }
    .work-row__link::after { content: ""; position: absolute; inset: 0; border-radius: var(--r-md); }
    .work-row__link:focus-visible { outline: none; }
    .work-row:has(.work-row__link:focus-visible) { outline: 2px solid var(--focus); outline-offset: 0; }
    .work-row__right { position: relative; z-index: 1; }
    .work-row--done .work-row__title { color: var(--text-3); text-decoration: line-through; text-decoration-color: var(--text-3); }
    .work-row__bar { align-self: stretch; border-radius: 2px; background: var(--c); min-height: 30px; }
    .work-row__icon {
      width: 30px; height: 30px; border-radius: 9px;
      display: grid; place-items: center;
      background: color-mix(in srgb, var(--c) 16%, transparent);
      color: color-mix(in srgb, var(--c) 75%, var(--text));
    }
    .work-row__main { min-width: 0; }
    .work-row__title { font-weight: 560; overflow: clip; text-overflow: ellipsis; white-space: nowrap; }
    .work-row__meta {
      display: flex; align-items: center; gap: 6px;
      font-size: var(--fs-sm); color: var(--text-3);
      overflow: clip; white-space: nowrap;
    }
    .work-row__meta > * { overflow: clip; text-overflow: ellipsis; }
    .work-row__meta .sep { flex: none; }
    .work-row__right { display: flex; align-items: center; gap: var(--sp-2); }
    .done-note { font-size: var(--fs-sm); color: var(--text-3); padding: var(--sp-3) var(--sp-2) 0; display: flex; align-items: center; gap: 6px; }
    .done-note .icon { color: var(--ok); }

    /* ---------- feed ---------- */
    .feed { display: flex; flex-direction: column; gap: 2px; }
    .feed__divider {
      font-size: var(--fs-xs); font-weight: 650; letter-spacing: .06em; text-transform: uppercase;
      color: var(--text-3); padding: var(--sp-3) var(--sp-2) var(--sp-1);
    }
    .feed-item {
      display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: var(--sp-3); align-items: center;
      padding: 8px var(--sp-2); border-radius: var(--r-md);
      transition: background var(--dur-fast) var(--ease);
    }
    a.feed-item:hover { background: var(--surface-2); }
    .feed-item--old { opacity: .7; }
    .feed-item__icon {
      width: 30px; height: 30px; border-radius: 50%;
      display: grid; place-items: center;
      background: var(--neutral-soft); color: var(--text-2);
    }
    .feed-item__icon--grade { background: var(--ok-soft); color: var(--ok); }
    .feed-item__icon--announcement { background: var(--accent-soft); color: var(--accent-text); }
    .feed-item__icon--assignment_new { background: var(--info-soft); color: var(--info); }
    .feed-item__icon--assignment_changed { background: var(--warn-soft); color: var(--warn); }
    .feed-item__title { font-weight: 550; overflow: clip; text-overflow: ellipsis; white-space: nowrap; }
    .feed-item__meta { font-size: var(--fs-sm); color: var(--text-3); overflow: clip; text-overflow: ellipsis; white-space: nowrap; }
    .feed-item__value { font-size: var(--fs-sm); font-weight: 650; font-variant-numeric: tabular-nums; color: var(--text-2); }

    /* ---------- announcements ---------- */
    .ann-list { display: flex; flex-direction: column; gap: 2px; }
    .ann-item {
      display: block; padding: 10px var(--sp-2) 10px var(--sp-5);
      border-radius: var(--r-md); position: relative;
      transition: background var(--dur-fast) var(--ease);
    }
    .ann-item:hover { background: var(--surface-2); }
    .ann-item__title { font-weight: 550; overflow: clip; text-overflow: ellipsis; white-space: nowrap; }
    .ann-item--unread .ann-item__title { font-weight: 700; color: var(--text); }
    .ann-item--unread::before {
      content: ""; position: absolute; left: 8px; top: 17px;
      width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
    }
    .ann-item__meta { display: flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text-3); margin-top: 1px; }
    .ann-item__preview {
      font-size: var(--fs-sm); color: var(--text-2); margin-top: 4px;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }

    /* ---------- skeleton layout ---------- */
    .skel-card { height: 180px; border-radius: var(--r-lg); }
    .skel-row { height: 44px; margin-bottom: 6px; }
    .skel-line { height: 12px; margin: 6px 0; }
  `);
})();
