// @ts-check
/** Assignment detail view + rich-content extras (embeds, equations). */
(() => {
  const { css } = Gesso.styles;

  Gesso.styles.sheets.push(css`
    .adetail { display: flex; flex-direction: column; gap: var(--gap); }
    .adetail__crumbs { display: flex; align-items: center; gap: var(--sp-2); font-size: var(--fs-sm); color: var(--text-3); min-width: 0; }
    .adetail__crumbs .btn { margin-right: var(--sp-2); }

    .adetail__head {
      display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--sp-4);
      border-left: 3px solid var(--c);
    }
    .adetail__kind {
      width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center;
      background: color-mix(in srgb, var(--c) 16%, transparent);
      color: color-mix(in srgb, var(--c) 75%, var(--text));
    }
    .adetail__title { font-family: var(--font-display); font-size: var(--fs-xl); font-weight: 700; letter-spacing: -.015em; line-height: 1.2; }
    .adetail__title:focus { outline: none; }
    .adetail__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: 6px; color: var(--text-2); font-size: var(--fs-sm); }
    .adetail__actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; justify-content: flex-end; }
    .adetail__actions [aria-disabled="true"] { opacity: .55; cursor: not-allowed; }
    @media (max-width: 860px) {
      .adetail__head { grid-template-columns: auto minmax(0, 1fr); }
      .adetail__actions { grid-column: 1 / -1; justify-content: flex-start; }
    }

    .adetail__grid {
      display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(280px, 1fr);
      gap: var(--gap); align-items: start;
    }
    @media (max-width: 1100px) { .adetail__grid { grid-template-columns: minmax(0, 1fr); } }

    /* ---- callout (quiz / external tool) ---- */
    .callout {
      display: flex; align-items: center; gap: var(--sp-4); flex-wrap: wrap;
      padding: var(--sp-5);
      border-radius: var(--r-lg);
      background: var(--accent-soft);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
    }
    .callout__icon { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--surface); color: var(--accent-text); flex: none; }
    .callout__text { flex: 1; min-width: 220px; }
    .callout__title { font-weight: 700; font-size: var(--fs-md); }
    .callout__body { color: var(--text-2); margin-top: 2px; }

    /* ---- key/value lists ---- */
    .kvs { display: flex; flex-direction: column; gap: var(--sp-3); margin: 0; }
    .kv { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: var(--sp-3); }
    .kv dt { color: var(--text-3); font-size: var(--fs-sm); padding-top: 1px; }
    .kv dd { margin: 0; overflow-wrap: anywhere; }

    /* ---- my submission ---- */
    .mysub { display: flex; flex-direction: column; gap: var(--sp-2); }
    .mysub__status { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2); }
    .mysub__grade { display: flex; align-items: baseline; gap: var(--sp-2); margin-top: var(--sp-1); }
    .mysub__score { font-size: var(--fs-xl); font-weight: 750; letter-spacing: -.01em; }
    .mysub__content { display: flex; flex-direction: column; gap: var(--sp-2); margin-top: var(--sp-2); padding-top: var(--sp-3); border-top: 1px solid var(--border); }
    .mysub__text > summary { cursor: pointer; color: var(--accent-text); font-weight: 550; }
    .mysub__text .prose { margin-top: var(--sp-2); padding: var(--sp-3); background: var(--surface-2); border-radius: var(--r-sm); }
    .mysub__url { overflow-wrap: anywhere; }
    .text-warn { color: var(--warn); }
    .flist--compact .frow { grid-template-columns: 22px minmax(0, 1fr) 64px 30px; padding: 5px 4px; }

    /* ---- rubric ---- */
    .table-scroll { overflow: clip; }
    @media (max-width: 720px) { .table-scroll { overflow-x: auto; overflow-y: hidden; } }
    .rubric { width: 100%; border-collapse: collapse; font-size: var(--fs-base); }
    .rubric th, .rubric td { text-align: left; vertical-align: top; padding: var(--sp-3) var(--sp-2); border-top: 1px solid var(--border); }
    .rubric thead th { border-top: 0; padding-top: 0; font-size: var(--fs-xs); font-weight: 650; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); }
    .rubric__crit { width: 30%; font-weight: 500; }
    .rubric__crit-title { display: block; font-weight: 600; }
    .rubric__crit-long { display: block; font-size: var(--fs-sm); color: var(--text-3); margin-top: 2px; }
    /* richText(): plain text keeps its newlines; sanitized HTML flows normally. */
    .rich--text { white-space: pre-line; }
    .rich--html { white-space: normal; }
    .rich--html > p { margin: 0 0 .4em; }
    .rubric__rating-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .rating {
      display: flex; flex-direction: column; gap: 2px;
      padding: 6px 10px; min-width: 96px; max-width: 220px;
      border: 1px solid var(--border); border-radius: var(--r-sm);
      font-size: var(--fs-sm); color: var(--text-2);
    }
    .rating--selected { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
    .rating__pts { font-weight: 650; color: var(--text); }
    .rubric__comment { display: flex; gap: 6px; align-items: flex-start; margin-top: var(--sp-2); font-size: var(--fs-sm); color: var(--text-2); }
    .rubric__comment .icon { margin-top: 3px; color: var(--text-3); }
    .rubric__pts { white-space: nowrap; font-weight: 600; }

    /* ---- comments ---- */
    .comments { display: flex; flex-direction: column; gap: var(--sp-4); }
    .comment { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: var(--sp-3); }
    .comment__meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; font-size: var(--fs-sm); color: var(--text-3); }
    .comment__author { color: var(--text); font-weight: 650; font-size: var(--fs-base); }
    .comment__text { margin-top: 4px; overflow-wrap: anywhere; line-height: 1.55; }

    /* ---- past attempts ---- */
    .attempts { display: flex; flex-direction: column; }
    .attempt { display: flex; align-items: center; gap: var(--sp-2); padding: 7px 0; border-top: 1px solid var(--border); font-size: var(--fs-sm); }
    .attempt:first-child { border-top: 0; }
    .attempt__n { font-weight: 600; }
    .attempt__score { margin-left: auto; font-weight: 650; }

    .debug-pre { font-family: var(--font-mono); font-size: var(--fs-sm); white-space: pre-wrap; color: var(--text-2); margin: 0; overflow-wrap: anywhere; }
    .debug-raw { padding: var(--sp-3); background: var(--surface-2); border-radius: var(--r-sm); margin-top: var(--sp-2); user-select: text; }
    .debug-trace { list-style: decimal; padding-left: 1.4em; margin-top: 4px; font-size: var(--fs-sm); color: var(--text-2); }
    .debug-table td { overflow-wrap: anywhere; vertical-align: top; }
    .debug-table code { font-size: var(--fs-xs); }
    .debug-trace-row td { border-top: 0; padding-top: 0; }
    .debug-trace li + li { margin-top: 2px; }

    /* ---- rich content extras ---- */
    .prose--tight { line-height: 1.5; margin-bottom: 0; }
    .embed { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-3); }
    .embed__load {
      display: inline-flex; align-items: center; gap: var(--sp-2);
      padding: var(--sp-3) var(--sp-4);
      border: 1px dashed var(--border-strong); border-radius: var(--r-md);
      background: var(--surface-2); color: var(--text); font-weight: 550;
    }
    .embed__load::before { content: "▶"; color: var(--accent-text); font-size: 11px; }
    .embed__load:hover { border-color: var(--accent); }
    .embed__open { font-size: var(--fs-sm); color: var(--text-3); }
    .embed__frame { width: 100%; aspect-ratio: 16 / 9; border: 0; border-radius: var(--r-md); background: #000; }
    /* Canvas equation images are black-on-transparent; make them readable on dark. */
    :host(:not([data-theme="light"])) .prose img.equation_image { filter: invert(1) hue-rotate(180deg); }
  
    /* ---------- submit here ---------- */
    .dialog--submit { width: min(620px, calc(100vw - 32px)); }
    .dialog--submit .seg { align-self: flex-start; }
    .sub-facts { margin: 0; padding-left: 18px; color: var(--text-2); display: flex; flex-direction: column; gap: 4px; }
    .sub-status { margin: 0; color: var(--text-2); }
    .sub-status:empty { display: none; }
    .field__error ul { margin: 6px 0; padding-left: 18px; }
    .field__error p { margin: 4px 0; }
    .sub-files { list-style: none; margin: var(--sp-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .sub-files:empty { display: none; }
    .sub-file { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: var(--sp-2); padding: 6px var(--sp-2); border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--surface-2); }
    .sub-file__icon { color: var(--text-3); display: grid; place-items: center; }
    .sub-file--done .sub-file__icon { color: var(--ok); }
    .sub-file--failed .sub-file__icon, .sub-file__bad { color: var(--danger); }
    .sub-file__main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    .sub-file__name { font-weight: 560; overflow: clip; text-overflow: ellipsis; white-space: nowrap; }
    .sub-file__meta { font-size: var(--fs-sm); color: var(--text-3); overflow-wrap: anywhere; }
    .sub-file__bar { display: block; height: 4px; border-radius: 2px; background: var(--surface-3); overflow: hidden; position: relative; }
    .sub-file__bar::after { content: ""; position: absolute; inset: 0 auto 0 0; width: var(--p, 0%); background: var(--accent); transition: width var(--dur-fast) linear; }
    .sub-file--done .sub-file__bar::after { background: var(--ok); }
    @media (prefers-reduced-motion: reduce) { .sub-file__bar::after { transition: none; } }
    .sub-done { display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--sp-2); padding: var(--sp-4) 0 0; }
    .sub-done__icon { color: var(--ok); }
    .sub-done__title { font-size: var(--fs-md); font-weight: 650; }
    .sub-done .form__actions { width: 100%; margin-top: var(--sp-4); }
  `);
})();
