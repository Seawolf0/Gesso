// @ts-check
/** App frame: sidebar, top bar, content area, and placeholder views. */
(() => {
  const { css } = Gesso.styles;

  Gesso.styles.sheets.push(css`
    .app {
      display: grid;
      grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
      min-height: 100vh;
    }

    /* ---------- sidebar ---------- */
    .sidebar {
      position: sticky; top: 0;
      height: 100vh;
      display: flex; flex-direction: column;
      padding: var(--sp-4) var(--sp-3);
      background: var(--bg-elev);
      border-right: 1px solid var(--border);
      overflow-y: auto;  /* real scroll area, only when the sidebar is taller than the window */
      overflow-x: hidden; /* overflow-y:auto would otherwise make the x axis scrollable too */
      scrollbar-width: thin;
    }
    .brand {
      display: flex; align-items: center; gap: var(--sp-3);
      padding: var(--sp-2) var(--sp-2) var(--sp-5);
    }
    .brand__mark {
      width: 32px; height: 32px; border-radius: 10px; flex: none;
      display: grid; place-items: center;
      background: var(--accent); color: var(--accent-fg);
      box-shadow: 0 6px 18px var(--accent-soft);
    }
    .brand__name { font-family: var(--font-display); font-weight: 700; font-size: var(--fs-md); letter-spacing: -.01em; }
    .brand__sub { font-size: var(--fs-xs); color: var(--text-3); }

    .nav { display: flex; flex-direction: column; gap: 2px; }
    .nav__label {
      font-size: var(--fs-xs); font-weight: 650; letter-spacing: .06em; text-transform: uppercase;
      color: var(--text-3);
      padding: var(--sp-5) var(--sp-3) var(--sp-2);
    }
    .nav__item {
      display: flex; align-items: center; gap: var(--sp-3);
      height: 36px; padding: 0 var(--sp-3);
      border-radius: var(--r-sm);
      color: var(--text-2); font-weight: 550;
      transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .nav__item:hover { background: var(--surface-2); color: var(--text); }
    .nav__item[aria-current="page"] { background: var(--surface-3); color: var(--text); }
    .nav__item[aria-current="page"] .icon { color: var(--accent-text); }
    .nav__item .nav__meta { margin-left: auto; font-size: var(--fs-xs); color: var(--text-3); }
    .nav__course { height: 32px; font-weight: 500; }
    .nav__course .dot { margin: 0 3px; }
    .nav__spacer { flex: 1; min-height: var(--sp-6); }

    /* ---------- main column ---------- */
    .main { min-width: 0; display: flex; flex-direction: column; }

    .topbar {
      position: sticky; top: 0; z-index: 10;
      height: var(--topbar-h);
      display: flex; align-items: center; gap: var(--sp-3);
      padding: 0 var(--sp-8);
      background: color-mix(in srgb, var(--bg) 82%, transparent);
      backdrop-filter: saturate(1.4) blur(14px);
      -webkit-backdrop-filter: saturate(1.4) blur(14px);
      border-bottom: 1px solid var(--border);
    }
    .topbar__title { font-weight: 650; font-size: var(--fs-md); }
    .topbar__spacer { flex: 1; }
    .sync-status {
      display: flex; align-items: center; gap: var(--sp-2);
      font-size: var(--fs-sm); color: var(--text-3);
    }
    .sync-status--error { color: var(--danger); }
    .sync-status__result { display: inline-flex; align-items: center; gap: 5px; color: var(--ok); font-weight: 600; }
    .sync-status__result .icon { color: var(--ok); }

    .skip-link {
      position: fixed; top: 8px; left: 8px; z-index: 100;
      padding: 8px 14px; border-radius: var(--r-sm);
      background: var(--surface); color: var(--text); border: 2px solid var(--focus); font: inherit; font-weight: 600;
      transform: translateY(-200%);
    }
    .skip-link:focus { transform: none; } /* any focus: it's only reachable by keyboard */
    .search-trigger {
      display: inline-flex; align-items: center; gap: var(--sp-2);
      height: 32px; padding: 0 6px 0 var(--sp-3); min-width: 200px;
      background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--r-full);
      color: var(--text-3); font: inherit; font-size: var(--fs-sm); cursor: pointer;
      transition: border-color var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .search-trigger:hover { border-color: var(--border-strong); color: var(--text-2); }
    .search-trigger__text { flex: 1; text-align: left; }
    .kbd {
      display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px;
      font: 600 11px/1 var(--font, inherit); font-family: inherit; color: var(--text-2);
      background: var(--surface-3); border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: 5px;
    }

    .theme-toggle {
      display: inline-flex; padding: 3px; gap: 2px;
      background: var(--surface-2); border: 1px solid var(--border);
      border-radius: var(--r-full);
    }
    .theme-toggle button {
      width: 30px; height: 26px; border-radius: var(--r-full);
      display: grid; place-items: center; color: var(--text-3);
      transition: background var(--dur-fast) var(--ease), color var(--dur-fast) var(--ease);
    }
    .theme-toggle button[aria-pressed="true"] { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }

    .user-chip { display: flex; align-items: center; gap: var(--sp-2); padding-left: var(--sp-2); }
    .avatar {
      width: 32px; height: 32px; border-radius: 50%; flex: none; overflow: clip;
      display: grid; place-items: center;
      background: var(--surface-3); color: var(--text-2);
      font-size: var(--fs-sm); font-weight: 650;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }

    .content {
      width: 100%; max-width: var(--content-max);
      margin: 0 auto;
      padding: var(--sp-8) var(--sp-8) var(--sp-12);
    }
    /* The content area receives focus on navigation (so screen readers and
       Tab start in the new view); it is not itself interactive, so no ring. */
    .content:focus, .content:focus-visible { outline: none; }

    /* ---------- placeholder views ---------- */
    .placeholder { max-width: 720px; }
    .placeholder h1 { font-family: var(--font-display); font-size: var(--fs-xl); font-weight: 700; letter-spacing: -.02em; margin-bottom: var(--sp-2); }
    .placeholder p { color: var(--text-2); margin-bottom: var(--sp-5); }
    .placeholder .panel + .panel { margin-top: var(--gap); }
    .quick-links { display: flex; flex-wrap: wrap; gap: var(--sp-2); }

    /* ---------- fatal ---------- */
    .fatal { max-width: 560px; margin: 15vh auto; padding: var(--sp-8); }
    .fatal h1 { font-size: var(--fs-xl); margin-bottom: var(--sp-3); }
    .fatal pre { white-space: pre-wrap; font-family: var(--font-mono); font-size: var(--fs-sm); color: var(--text-3); margin: var(--sp-4) 0; }

    /* ---------- responsive: collapse sidebar to an icon rail ---------- */
    @media (max-width: 1080px) {
      :host { --sidebar-w: 68px; }
      .sidebar { padding: var(--sp-4) var(--sp-2); align-items: center; }
      .brand { padding: var(--sp-1) 0 var(--sp-5); }
      .brand__text, .nav__label, .nav__text, .nav__meta { display: none; }
      .nav__item { width: 44px; height: 40px; justify-content: center; padding: 0; }
      .nav__course { height: 32px; }
      .topbar, .content { padding-left: var(--sp-5); padding-right: var(--sp-5); }
      .user-chip__name { display: none; }
    }
    @media (max-width: 900px) {
      .search-trigger { min-width: 0; }
      .search-trigger__text, .search-trigger .kbd { display: none; }
    }
    @media (max-width: 640px) {
      .sync-status__text { display: none; }
      .content { padding-top: var(--sp-5); }
    }
  `);
})();
