// @ts-check
/** Grades: meters, sparkline, line chart, stat tiles, verdicts, overview tiles, GPA. */
(() => {
  const { css } = Gesso.styles;

  Gesso.styles.sheets.push(css`
    /* ======================= chart pieces ======================= */
    /* Meter: accent fill on a lighter step of the same hue. */
    .meter {
      position: relative; display: block; height: 6px; width: 100%; overflow: clip;
      border-radius: var(--r-full); background: color-mix(in srgb, var(--accent) 16%, transparent);
    }
    .meter__fill { position: absolute; inset: 0 auto 0 0; border-radius: var(--r-full); background: var(--accent); }

    .spark { position: relative; display: inline-block; width: 72px; height: 24px; flex: none; }
    .spark__svg { width: 100%; height: 100%; display: block; overflow: visible; }
    .spark__line { fill: none; stroke: var(--text-3); stroke-width: 1.5px; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
    .spark__dot {
      position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%;
      background: var(--accent); box-shadow: 0 0 0 2px var(--surface);
    }

    /* Line chart: SVG stretches; dots, labels and tooltip are HTML in % so nothing distorts. */
    .lc { margin: 0; }
    .lc__frame { padding: 10px 44px 10px 34px; }
    .lc__plot { position: relative; height: 220px; border-radius: var(--r-sm); outline-offset: 6px; }
    .lc__svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
    .lc__grid { stroke: var(--border); stroke-width: 1px; vector-effect: non-scaling-stroke; }
    .lc__ref { stroke: var(--border-strong); stroke-width: 1px; vector-effect: non-scaling-stroke; }
    .lc__line { fill: none; stroke: var(--c); stroke-width: 2px; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
    .lc__tick, .lc__reflabel, .lc__endlabel {
      position: absolute; transform: translateY(-50%);
      font-size: var(--fs-xs); color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none;
    }
    .lc__tick { right: calc(100% + 8px); }
    .lc__reflabel { left: calc(100% + 8px); font-weight: 650; }
    .lc__endlabel { left: calc(100% + 8px); margin-top: -14px; color: var(--text); font-weight: 650; }
    .lc__dot {
      position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%;
      background: var(--c); box-shadow: 0 0 0 2px var(--surface); pointer-events: none;
    }
    .lc__dot--focus { width: 12px; height: 12px; margin: -6px 0 0 -6px; z-index: 2; }
    .lc__cross { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px solid var(--text-3); pointer-events: none; }
    .lc__tip {
      position: absolute; top: 0; z-index: 3; transform: translateX(10px);
      display: flex; flex-direction: column; gap: 1px; min-width: 120px; max-width: 260px;
      padding: 6px 10px; border-radius: var(--r-sm);
      background: var(--bg-elev); border: 1px solid var(--border-strong); box-shadow: var(--shadow);
      font-size: var(--fs-sm); pointer-events: none;
    }
    .lc__tip--left { transform: translateX(calc(-100% - 10px)); }
    .lc__tipval { font-weight: 700; color: var(--text); font-size: var(--fs-md); }
    .lc__tiplabel { color: var(--text-2); }
    .lc__tipnote { color: var(--text-3); overflow-wrap: anywhere; }
    .lc__axis { display: flex; justify-content: space-between; padding: 0 44px 0 34px; font-size: var(--fs-xs); color: var(--text-3); }
    .lc__foot { display: flex; justify-content: flex-end; margin-top: var(--sp-2); }
    .lc__table { margin-top: var(--sp-2); }

    /* ======================= course Grades tab ======================= */
    .gstats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--sp-4); margin-bottom: var(--sp-4); }
    .gstat { display: flex; flex-direction: column; gap: 6px; padding: var(--sp-3) var(--sp-4); border: 1px solid var(--border); border-radius: var(--r-md); background: var(--surface-2); }
    .gstat--whatif { border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
    .gstat__label { font-size: var(--fs-xs); font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3); }
    .gstat__value { display: flex; align-items: baseline; gap: var(--sp-2); font-size: 28px; font-weight: 650; letter-spacing: -.01em; }
    .gstat__letter { font-size: var(--fs-lg); color: var(--text-2); }
    .gstat__est { font-size: var(--fs-xs); font-weight: 600; color: var(--text-3); }
    .gstat__sub { font-size: var(--fs-sm); color: var(--text-3); }

    .gverdict { display: flex; align-items: flex-start; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-radius: var(--r-md); }
    .gverdict > .icon { margin-top: 2px; }
    .gverdict--ok { background: var(--ok-soft); }
    .gverdict--ok > .icon { color: var(--ok); }
    .gverdict--warn { background: var(--warn-soft); }
    .gverdict--warn > .icon { color: var(--warn); }
    .gverdict--info { background: var(--neutral-soft); }
    .gverdict--info > .icon { color: var(--text-3); }
    .gverdict__title { font-weight: 650; }
    .gverdict__body { margin-top: 4px; color: var(--text-2); }
    .gcauses { margin: 6px 0 0; padding-left: 18px; list-style: disc; color: var(--text-2); display: flex; flex-direction: column; gap: 4px; }
    .gcauses strong { color: var(--text); }

    .gfinal { display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-3); margin-top: var(--sp-3); font-size: var(--fs-sm); color: var(--text-2); }
    .gfinal__label { color: var(--text-3); }
    .ghow { margin-top: var(--sp-3); font-size: var(--fs-sm); color: var(--text-2); }
    .ghow summary { cursor: pointer; font-weight: 600; color: var(--text); width: max-content; border-radius: 4px; }
    .ghow ul { margin: var(--sp-2) 0; padding-left: 18px; list-style: disc; display: flex; flex-direction: column; gap: 4px; }

    .grades-tools { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: var(--gap); }
    .gtool__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sp-2); margin-top: var(--sp-3); }
    .gtool__result { margin-top: var(--sp-3); }
    .gtool__note { margin-top: var(--sp-2); font-size: var(--fs-sm); }

    .gtable-wrap { min-width: 0; }
    .gtable th[scope="row"] { text-transform: none; letter-spacing: 0; font-size: var(--fs-base); font-weight: 600; color: var(--text); padding: 8px var(--sp-2); border-top: 1px solid var(--border); }
    .gtable tfoot th, .gtable tfoot td { border-top: 1px solid var(--border-strong); }
    .gtable__muted th[scope="row"] { opacity: .55; }
    .gcats__rule { display: block; font-size: var(--fs-sm); font-weight: 500; color: var(--text-3); }
    .gcats__meter { width: 32%; }
    .gcats__bar { display: grid; grid-template-columns: minmax(60px, 1fr) 64px; align-items: center; gap: var(--sp-2); }
    .gcats__bar .tabular { text-align: right; }

    .wi { display: inline-flex; align-items: center; justify-content: flex-end; gap: 6px; }
    .wi-input {
      width: 64px; height: 28px; padding: 0 8px; text-align: right;
      border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elev); color: var(--text);
      font: inherit; font-variant-numeric: tabular-nums;
    }
    .wi-input::placeholder { color: var(--text-3); }
    .wi-input--set { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); background: var(--accent-soft); }
    .wi-input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }

    /* ======================= #/grades overview ======================= */
    .grades-page { display: flex; flex-direction: column; gap: var(--gap); }
    .ghero { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: var(--sp-4); }
    .ghero__label { font-size: var(--fs-xs); font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--text-3); }
    .ghero__value { font-size: 56px; font-weight: 650; letter-spacing: -.02em; line-height: 1.1; margin: 4px 0; }
    .ghero__of { font-size: var(--fs-lg); font-weight: 550; color: var(--text-3); letter-spacing: 0; }
    .ghero__side { display: flex; flex-direction: column; align-items: flex-end; gap: var(--sp-3); }
    .ghero__check { display: inline-flex; align-items: center; gap: var(--sp-2); font-weight: 600; }
    .ghero__check--ok .icon { color: var(--ok); }
    .ghero__check--warn .icon { color: var(--warn); }

    .gtiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--gap); }
    .gtile { display: flex; flex-direction: column; gap: var(--sp-3); box-shadow: inset 0 3px 0 var(--c); }
    .gtile__head { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
    .gtile__head .dot { background: var(--c); }
    .gtile__title { font-weight: 700; }
    .gtile__title:hover { text-decoration: underline; text-underline-offset: 2px; }
    .gtile__sub { color: var(--text-3); font-size: var(--fs-sm); }
    .gtile__main { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--sp-3); }
    .gtile__value { display: flex; align-items: baseline; gap: var(--sp-2); font-size: 30px; font-weight: 650; letter-spacing: -.01em; }
    .gtile__letter { font-size: var(--fs-lg); color: var(--text-2); }
    .gtile__canvas { display: flex; justify-content: space-between; font-size: var(--fs-sm); }
    .gtile__verdict { display: flex; align-items: flex-start; gap: var(--sp-2); font-size: var(--fs-sm); padding: var(--sp-2) var(--sp-3); border-radius: var(--r-sm); }
    .gtile__verdict > .icon { margin-top: 2px; flex: none; }
    .gtile__verdict--ok { background: var(--ok-soft); }
    .gtile__verdict--ok > .icon { color: var(--ok); }
    .gtile__verdict--warn { background: var(--warn-soft); }
    .gtile__verdict--warn > .icon { color: var(--warn); }
    .gtile__verdict--info { background: var(--neutral-soft); color: var(--text-2); }
    .gtile__why { color: var(--text-2); margin: 2px 0 4px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }

    .gcredit {
      width: 72px; height: 30px; padding: 0 8px; text-align: right;
      border: 1px solid var(--border); border-radius: 6px; background: var(--bg-elev); color: var(--text); font: inherit;
    }
    .gcredit:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
    .gcheck { display: inline-flex; align-items: center; min-height: 30px; }
    .gcheck input { width: 16px; height: 16px; accent-color: var(--accent); }

    .gscale { display: flex; flex-direction: column; gap: var(--sp-3); }
    .gscale__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: var(--sp-2) var(--sp-4); }
    .gscale__row { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-2); font-weight: 600; }
    .gscale__actions { display: flex; justify-content: flex-end; gap: var(--sp-2); }

    @media (max-width: 720px) {
      .lc__frame { padding-right: 36px; }
      .gcats__meter { width: auto; }
      .ghero__side { align-items: flex-start; }
    }
  `);
})();
