// @ts-check
/** Reset + shared component styles (buttons, pills, panels, skeletons, banners). */
(() => {
  const { css } = Gesso.styles;

  Gesso.styles.sheets.push(css`
    /* ---------- reset (scoped to our shadow root) ---------- */
    :host {
      all: initial;
      display: block;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      font-size: var(--fs-base);
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    *, *::before, *::after { box-sizing: border-box; }
    h1, h2, h3, h4, p, ul, ol, figure { margin: 0; padding: 0; }
    ul, ol { list-style: none; }
    a { color: inherit; text-decoration: none; }
    button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
    img { display: block; max-width: 100%; }
    .icon { flex: none; display: block; }
    [hidden] { display: none !important; }

    /* ---------- focus: always visible for keyboard users ---------- */
    :focus { outline: none; }
    :focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
      border-radius: var(--r-sm);
    }

    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }

    /* ---------- buttons ---------- */
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: var(--sp-2);
      height: 34px; padding: 0 var(--sp-3);
      border-radius: var(--r-sm);
      font-size: var(--fs-base); font-weight: 550;
      color: var(--text);
      background: var(--surface-2);
      border: 1px solid var(--border);
      transition: background var(--dur-fast) var(--ease), border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
      white-space: nowrap;
    }
    .btn:hover { background: var(--surface-3); border-color: var(--border-strong); }
    .btn:disabled { opacity: .55; cursor: default; }
    .btn--primary { background: var(--accent); border-color: transparent; color: var(--accent-fg); }
    .btn--primary:hover { background: var(--accent); filter: brightness(1.08); }
    .btn--ghost { background: transparent; border-color: transparent; color: var(--text-2); }
    .btn--ghost:hover { background: var(--surface-2); color: var(--text); border-color: transparent; }
    .btn--icon { width: 34px; padding: 0; }
    .btn--sm { height: 28px; font-size: var(--fs-sm); padding: 0 var(--sp-2); }

    /* --link-deco: themes whose accent is a neutral (Graphite) underline links so they still read as links. */
    .link { color: var(--accent-text); font-weight: 550; text-decoration: var(--link-deco, none); text-underline-offset: 2px; text-decoration-thickness: 1px; }
    .link:hover { text-decoration: underline; text-underline-offset: 2px; }

    /* ---------- pills ---------- */
    .pill {
      display: inline-flex; align-items: center; gap: 5px;
      height: 22px; padding: 0 8px;
      border-radius: var(--r-full);
      font-size: var(--fs-xs); font-weight: 600; letter-spacing: .01em;
      white-space: nowrap;
      background: var(--neutral-soft); color: var(--text-2);
    }
    .pill--danger { background: var(--danger-soft); color: var(--danger); }
    .pill--warn   { background: var(--warn-soft);   color: var(--warn); }
    .pill--ok     { background: var(--ok-soft);     color: var(--ok); }
    .pill--info   { background: var(--info-soft);   color: var(--info); }
    .pill--accent { background: var(--accent-soft); color: var(--accent-text); }
    .pill .icon { width: 12px; height: 12px; }

    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--c, var(--accent)); }

    /* ---------- panels ---------- */
    .panel {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-lg);
      padding: var(--pad-card);
      min-width: 0;
    }
    .panel__head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: var(--sp-3);
      margin-bottom: var(--sp-4);
    }
    .panel__title {
      display: flex; align-items: center; gap: var(--sp-2);
      font-family: var(--font-display);
      font-size: var(--fs-md); font-weight: 650; letter-spacing: -.01em;
    }
    .panel__title .icon { color: var(--text-3); }
    .panel__subtitle { color: var(--text-3); font-size: var(--fs-sm); margin-top: 2px; }
    .panel__count {
      font-size: var(--fs-xs); font-weight: 650; color: var(--text-2);
      background: var(--surface-3); border-radius: var(--r-full); padding: 1px 7px;
    }

    /* ---------- empty / error states ---------- */
    .empty {
      display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
      gap: var(--sp-2); padding: var(--sp-8) var(--sp-4);
      color: var(--text-3);
    }
    .empty .icon { color: var(--text-3); opacity: .8; margin-bottom: var(--sp-1); }
    .empty__title { color: var(--text-2); font-weight: 600; font-size: var(--fs-base); }
    .empty__body { font-size: var(--fs-sm); max-width: 36ch; }

    .banner {
      display: flex; align-items: center; gap: var(--sp-3);
      padding: var(--sp-3) var(--sp-4);
      border-radius: var(--r-md);
      border: 1px solid var(--border);
      background: var(--surface);
      margin-bottom: var(--gap);
    }
    .banner__text { flex: 1; min-width: 0; }
    .banner__title { font-weight: 650; }
    .banner__body { color: var(--text-2); font-size: var(--fs-sm); }
    .banner--danger { border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); background: var(--danger-soft); }
    .banner--danger > .icon { color: var(--danger); }
    .banner--warn { border-color: color-mix(in srgb, var(--warn) 35%, var(--border)); background: var(--warn-soft); }
    .banner--warn > .icon { color: var(--warn); }

    /* ---------- skeletons ---------- */
    .skel {
      border-radius: var(--r-sm);
      background: linear-gradient(90deg, var(--skeleton-a) 0%, var(--skeleton-b) 50%, var(--skeleton-a) 100%);
      background-size: 200% 100%;
      animation: skel 1.4s ease-in-out infinite;
    }
    @keyframes skel { from { background-position: 100% 0; } to { background-position: -100% 0; } }

    /* ---------- misc ---------- */
    .muted { color: var(--text-2); }
    .faint { color: var(--text-3); }
    .nowrap { white-space: nowrap; }
    /* overflow: clip (not hidden): clipped boxes must never become scrollable,
       even programmatically (focus would shift their content). */
    .truncate { overflow: clip; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .tabular { font-variant-numeric: tabular-nums; }
    .spin { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .fade-in { animation: fade-in var(--dur) var(--ease) both; }
    @keyframes fade-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

    /* ---------- reduced motion ---------- */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
      .skel { animation: none; }
    }
  `);
})();
