// @ts-check
/**
 * Themes: the switch cross-fade, the custom theme's background image, and
 * Settings → Appearance (theme gallery with mini previews, custom editor).
 */
(() => {
  const { css } = Gesso.styles;

  Gesso.styles.sheets.push(css`
    /* ======================= theme switch ======================= */
    /* ui/appearance.js sets [data-theme-anim] for a moment when the theme
       changes, so colors cross-fade instead of jumping. */
    :host([data-theme-anim]) { transition: background-color 320ms var(--ease); }
    :host([data-theme-anim]) *, :host([data-theme-anim]) *::before, :host([data-theme-anim]) *::after {
      transition: background-color 320ms var(--ease), border-color 320ms var(--ease), color 320ms var(--ease),
        fill 320ms var(--ease), stroke 320ms var(--ease), box-shadow 320ms var(--ease), outline-color 320ms var(--ease) !important;
    }

    /* ======================= background image ======================= */
    :host { isolation: isolate; }
    .backdrop { position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none; }
    .backdrop__img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; opacity: 0; transition: opacity 400ms var(--ease); }
    .backdrop[data-ready] .backdrop__img { opacity: 1; }
    .backdrop__dim { position: absolute; inset: 0; transition: background-color 320ms var(--ease), opacity 320ms var(--ease); }
    :host([data-backdrop]) .sidebar {
      background: color-mix(in srgb, var(--bg-elev) 78%, transparent);
      backdrop-filter: blur(20px) saturate(1.2); -webkit-backdrop-filter: blur(20px) saturate(1.2);
    }
    :host([data-backdrop]) .topbar { background: color-mix(in srgb, var(--bg) 70%, transparent); }

    /* ======================= appearance panel ======================= */
    .set-block { padding-bottom: var(--sp-4); }
    .set-block__head { display: flex; flex-direction: column; gap: 2px; max-width: 560px; }
    .set-inline { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--sp-3); }
    .swatches__sep { width: 1px; height: 18px; align-self: center; background: var(--border-strong); margin: 0 2px; }
    .swatch--theme { position: relative; }
    .swatch--theme::after {
      content: ""; position: absolute; inset: 6px; border-radius: 50%;
      border: 1.5px solid color-mix(in srgb, var(--surface) 85%, transparent);
    }
    .pstrip { display: inline-flex; height: 14px; border-radius: var(--r-full); overflow: clip; box-shadow: 0 0 0 1px var(--border); }
    .pstrip__c { width: 11px; }

    /* ---------- theme gallery ---------- */
    .tgallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: var(--sp-3); margin-top: var(--sp-4); }
    .tcard {
      position: relative; display: flex; flex-direction: column; gap: var(--sp-2);
      padding: 6px; border-radius: var(--r-md); cursor: pointer;
      background: var(--surface); border: 1px solid var(--border);
      transition: border-color var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease), transform var(--dur) var(--ease);
    }
    .tcard:hover { border-color: var(--border-strong); }
    .tcard:hover .tp { transform: translateY(-1px); }
    .tcard--on, .tcard--on:hover { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), 0 6px 20px var(--accent-soft); }
    .tcard__input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
    .tcard:has(.tcard__input:focus-visible) { outline: 2px solid var(--focus); outline-offset: 3px; }
    .tcard__meta { display: flex; flex-direction: column; gap: 1px; padding: 0 6px 5px; min-width: 0; }
    .tcard__name { display: flex; align-items: center; gap: 6px; font-weight: 640; letter-spacing: -.005em; }
    .tcard__check {
      width: 16px; height: 16px; border-radius: 50%; flex: none; display: grid; place-items: center;
      background: var(--accent); color: var(--accent-fg);
    }
    .tcard__desc { font-size: var(--fs-xs); line-height: 1.4; color: var(--text-3); }
    .tcard__new {
      aspect-ratio: 16 / 11; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--sp-2);
      border: 1.5px dashed var(--border-strong); border-radius: 10px; padding: var(--sp-3);
      color: var(--text-2); font-size: var(--fs-sm); font-weight: 550; text-align: center;
      transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .tcard--create:hover .tcard__new { border-color: var(--accent); color: var(--text); }
    .tcard__plus { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-text); }

    /* ---------- mini preview (a tiny dashboard in a theme's colors) ----------
       Sized in em: font-size scales the whole thing. Colors come from --p-*. */
    .tp {
      position: relative; isolation: isolate; overflow: clip;
      display: grid; grid-template-columns: 27% minmax(0, 1fr);
      aspect-ratio: 16 / 11; font-size: 7.5px;
      background: var(--p-bg); border-radius: 9px; box-shadow: inset 0 0 0 1px var(--p-border);
      transition: transform var(--dur) var(--ease);
    }
    .tp--lg { font-size: 10.5px; border-radius: 12px; }
    .tp__img, .tp__dim { position: absolute; inset: 0; width: 100%; height: 100%; z-index: -1; display: block; }
    .tp__dim { background: var(--p-bg); opacity: .5; }
    .tp:has(.tp__img) { background: var(--p-bg); }
    .tp:has(.tp__img) .tp__side { background: color-mix(in srgb, var(--p-bg-elev) 78%, transparent); }
    .tp__side {
      display: flex; flex-direction: column; gap: .5em; min-width: 0;
      padding: 1.1em .8em; background: var(--p-bg-elev); box-shadow: inset -1px 0 0 var(--p-border);
    }
    .tp__brand { width: 1.7em; height: 1.7em; border-radius: .5em; background: var(--p-accent); margin: 0 0 .7em .35em; }
    .tp__nav { display: flex; align-items: center; gap: .5em; height: 1.55em; padding: 0 .5em; border-radius: .45em; }
    .tp__nav--on { background: var(--p-surface-3); }
    .tp__nav--course { height: 1.3em; }
    .tp__nav:nth-child(5) { margin-top: .7em; }
    .tp__navicon { width: .8em; height: .8em; border-radius: .22em; flex: none; background: var(--p-accent); }
    .tp__dot { width: .65em; height: .65em; border-radius: 50%; flex: none; }
    .tp__bar { display: block; height: .5em; border-radius: 1em; flex: none; }
    .tp__bar--t1 { background: var(--p-text); }
    .tp__bar--t2 { background: var(--p-text-2); }
    .tp__bar--t3 { background: var(--p-text-3); opacity: .75; }
    .tp__bar--thin { height: .38em; }
    .tp__bar--title { height: .72em; }
    .tp__bar--num { height: .85em; }
    .tp__bar--fg { background: var(--p-accent-fg); height: .4em; }
    .tp__main { display: flex; flex-direction: column; gap: .85em; min-width: 0; padding: 1.1em 1.25em; }
    .tp__top { display: flex; align-items: center; justify-content: space-between; gap: 1em; }
    .tp__search { width: 32%; height: 1.45em; border-radius: 1em; background: var(--p-surface-2); box-shadow: inset 0 0 0 1px var(--p-border); }
    .tp__stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .65em; }
    .tp__stat {
      display: flex; align-items: center; gap: .5em; min-width: 0; padding: .65em .6em;
      background: var(--p-surface); border-radius: .6em; box-shadow: inset 0 0 0 1px var(--p-border);
    }
    .tp__staticon { width: 1.5em; height: 1.5em; border-radius: .42em; flex: none; }
    .tp__staticon--warn { background: radial-gradient(circle, var(--p-warn) 0 26%, var(--p-warn-soft) 29%); }
    .tp__staticon--accent { background: radial-gradient(circle, var(--p-accent) 0 26%, var(--p-accent-soft) 29%); }
    .tp__staticon--danger { background: radial-gradient(circle, var(--p-danger) 0 26%, var(--p-danger-soft) 29%); }
    .tp__stattext { display: flex; flex-direction: column; gap: .35em; flex: 1; min-width: 0; }
    .tp__panel {
      flex: 1; min-height: 0; display: flex; flex-direction: column; gap: .55em;
      padding: .8em .9em; background: var(--p-surface); border-radius: .7em; box-shadow: inset 0 0 0 1px var(--p-border);
    }
    .tp__panelhead { display: flex; align-items: center; justify-content: space-between; margin-bottom: .15em; }
    .tp__btn { display: grid; place-items: center; width: 4.6em; height: 1.55em; border-radius: .45em; background: var(--p-accent); }
    .tp__row { display: flex; align-items: center; gap: .6em; }
    .tp__course { width: .3em; height: 1.75em; border-radius: .2em; flex: none; }
    .tp__rowtext { display: flex; flex-direction: column; gap: .35em; flex: 1; min-width: 0; }
    .tp__pill { width: 2.8em; height: 1.25em; border-radius: 1em; flex: none; }
    .tp__pill--danger { background: linear-gradient(var(--p-danger), var(--p-danger)) center / 52% .32em no-repeat, var(--p-danger-soft); }
    .tp__pill--warn { background: linear-gradient(var(--p-warn), var(--p-warn)) center / 52% .32em no-repeat, var(--p-warn-soft); }
    .tp__pill--ok { background: linear-gradient(var(--p-ok), var(--p-ok)) center / 52% .32em no-repeat, var(--p-ok-soft); }

    /* ======================= custom theme editor ======================= */
    .ced-actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; justify-content: flex-end; }
    .ced { display: grid; grid-template-columns: minmax(0, 1fr) 272px; gap: var(--sp-8); align-items: start; }
    .ced__controls { display: flex; flex-direction: column; gap: var(--sp-6); min-width: 0; }
    .ced__aside { position: sticky; top: calc(var(--topbar-h) + var(--sp-4)); display: flex; flex-direction: column; gap: var(--sp-4); }
    @media (max-width: 1180px) {
      .ced { grid-template-columns: minmax(0, 1fr); gap: var(--sp-6); }
      .ced__aside { position: static; order: -1; }
      .ced-previews { flex-direction: row; }
      .ced-preview { flex: 1; min-width: 0; }
    }
    .ced-basics { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: var(--sp-4); align-items: end; }
    .ced-select { appearance: auto; -webkit-appearance: menulist; cursor: pointer; }
    .seg__opt span { white-space: nowrap; }
    @media (max-width: 640px) { .ced-basics { grid-template-columns: minmax(0, 1fr); } }

    .ced-group { border: 0; margin: 0; padding: 0; min-width: 0; }
    .ced-group__title {
      float: left; width: 100%; padding: 0 0 var(--sp-1);
      font-family: var(--font-display); font-size: var(--fs-md); font-weight: 650; letter-spacing: -.01em;
    }
    .ced-group__title + * { clear: both; }
    .ced-group__head { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); margin-bottom: var(--sp-2); }
    .ced-group__head .set-hint { max-width: 420px; }
    @media (max-width: 640px) { .ced-group__head { flex-direction: column; align-items: flex-start; } }

    .ced-color { display: flex; align-items: center; justify-content: space-between; gap: var(--sp-4); padding: var(--sp-3) 0; border-top: 1px solid var(--border); }
    .ced-color__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; max-width: 400px; }
    .ced-color__label { font-weight: 600; }
    .ced-color__control { display: flex; align-items: center; gap: var(--sp-2); flex: none; }
    .ced-color__hex { min-width: 62px; text-align: right; font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--text-2); }
    .ced-auto {
      font-size: var(--fs-xs); font-weight: 650; letter-spacing: .02em; color: var(--text-2);
      padding: 2px 8px; border-radius: var(--r-full); background: var(--neutral-soft);
    }
    .ced-color__wellwrap { display: inline-grid; }
    .ced-color__well {
      width: 38px; height: 28px; padding: 0; cursor: pointer;
      border: 1px solid var(--border-strong); border-radius: var(--r-sm); background: var(--surface-2);
    }
    .ced-color__well::-webkit-color-swatch-wrapper { padding: 3px; }
    .ced-color__well::-webkit-color-swatch { border: 0; border-radius: 5px; }
    .ced-tint { padding-top: var(--sp-3); border-top: 1px solid var(--border); }

    .ced-courses { display: flex; flex-direction: column; }
    .ced-course { display: flex; align-items: center; gap: var(--sp-3); padding: 7px 0; border-top: 1px solid var(--border); }
    .ced-course__chip { width: 30px; height: 20px; border-radius: 6px; flex: none; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .08); }
    .ced-course__name { flex: 1; font-weight: 560; }

    .ced-image { display: grid; grid-template-columns: 168px minmax(0, 1fr); gap: var(--sp-5); align-items: center; margin: var(--sp-2) 0 var(--sp-4); }
    .ced-image__thumb { display: block; width: 168px; aspect-ratio: 16 / 10; border-radius: var(--r-sm); background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--border); }
    .ced-image__controls { display: flex; flex-direction: column; gap: var(--sp-3); min-width: 0; }
    .ced-image__row { display: flex; gap: var(--sp-2); margin-top: var(--sp-2); }
    @media (max-width: 640px) { .ced-image { grid-template-columns: minmax(0, 1fr); } }
    .ced-slider { display: grid; grid-template-columns: 44px minmax(0, 1fr) 52px; align-items: center; gap: var(--sp-3); }
    .ced-range { width: 100%; margin: 0; accent-color: var(--accent); }
    .ced-range__out { text-align: right; font-size: var(--fs-sm); color: var(--text-2); }
    .ced-note { display: flex; align-items: flex-start; gap: 6px; font-size: var(--fs-sm); color: var(--text-2); }
    .ced-note .icon { color: var(--info); margin-top: 2px; }

    .ced-previews { display: flex; flex-direction: column; gap: var(--sp-3); }
    .ced-preview { margin: 0; display: flex; flex-direction: column; gap: 6px; }
    .ced-preview figcaption { font-size: var(--fs-xs); font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--text-3); }
    .ced-preview--on .tp { box-shadow: inset 0 0 0 1px var(--p-border), 0 0 0 2px var(--accent); }

    .ced-check { display: flex; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); border-radius: var(--r-md); border: 1px solid var(--border); background: var(--surface-2); }
    .ced-check > .icon { margin-top: 1px; }
    .ced-check--ok > .icon { color: var(--ok); }
    .ced-check--warn { border-color: color-mix(in srgb, var(--warn) 35%, var(--border)); background: var(--warn-soft); }
    .ced-check--warn > .icon { color: var(--warn); }
    .ced-check__title { font-weight: 650; margin-bottom: 2px; }
    .ced-check__list { display: flex; flex-direction: column; gap: 4px; margin: var(--sp-2) 0; font-size: var(--fs-sm); }
    .ced-check__list li { display: flex; justify-content: space-between; gap: var(--sp-3); }
    .ced-check__ratio { white-space: nowrap; font-weight: 600; }
    .ced-errors { list-style: disc; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }

    /* ---------- reduced motion: no cross-fade, no lift ---------- */
    @media (prefers-reduced-motion: reduce) {
      :host([data-theme-anim]), :host([data-theme-anim]) *, :host([data-theme-anim]) *::before, :host([data-theme-anim]) *::after { transition: none !important; }
      .tcard:hover .tp { transform: none; }
    }
  `);
})();
