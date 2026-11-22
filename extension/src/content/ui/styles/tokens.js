// @ts-check
/**
 * Design tokens. Every color, space, radius, and type size used in the UI is
 * defined here as a CSS custom property on the shadow host, so themes and
 * density are just attribute switches:
 *
 *   <div id="gesso-root" data-theme="dark|light" data-density="comfortable|compact">
 *
 * Color tokens come from the theme engine (shared/themes.js). The ones in this
 * sheet are the default theme; the theme in use is set at runtime as inline
 * custom properties on the host (ui/appearance.js).
 *
 * Color tokens: --bg, --bg-elev (sidebar), --surface (panels), --surface-2/-3
 * (raised, chips), --border(-strong), --text, --text-2 (secondary), --text-3
 * (muted), --accent (+ -fg, -soft, -text), --focus, --danger/--warn/--ok/--info
 * (+ -soft), --neutral-soft, --overlay, --shadow(-sm), --skeleton-a/-b,
 * --chart-1…8 (the theme's course/chart palette), --link-deco.
 *
 * Style files are CSS in template strings. `css` is String.raw — it exists so
 * editor plugins (e.g. "es6-string-css") syntax-highlight the blocks.
 */
(() => {
  const css = String.raw;
  Gesso.styles = { css, sheets: /** @type {string[]} */ ([]) };
  const themeCss = Gesso.themes.toCss;

  Gesso.styles.sheets.push(css`
    :host {
      /* ---- spacing (4px scale) ---- */
      --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px; --sp-4: 16px;
      --sp-5: 20px; --sp-6: 24px; --sp-8: 32px; --sp-10: 40px; --sp-12: 48px;

      /* density-dependent */
      --pad-card: 20px;
      --row-pad-y: 10px;
      --gap: 20px;

      /* ---- radii ---- */
      --r-sm: 8px; --r-md: 12px; --r-lg: 16px; --r-xl: 20px; --r-full: 999px;

      /* ---- type ---- */
      --font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
      --font-display: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif;
      --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
      --fs-xs: 11px; --fs-sm: 12px; --fs-base: 13.5px; --fs-md: 15px;
      --fs-lg: 18px; --fs-xl: 22px; --fs-2xl: 30px;

      /* ---- motion ---- */
      --ease: cubic-bezier(.2, .7, .2, 1);
      --dur-fast: 120ms;
      --dur: 180ms;

      /* ---- layout ---- */
      --sidebar-w: 248px;
      --topbar-h: 60px;
      --content-max: 1480px;

      /* ---- colors ----
         The Gesso preset's dark variant, as the fallback before settings load.
         The theme in use is applied on top as inline custom properties on the
         host (ui/appearance.js), from shared/themes.js. */
      ${themeCss(Gesso.themes.resolve({ themeId: 'gesso' }, 'dark'))}
    }

    :host([data-theme="light"]) {
      ${themeCss(Gesso.themes.resolve({ themeId: 'gesso' }, 'light'))}
    }

    :host([data-density="compact"]) {
      --pad-card: 14px;
      --row-pad-y: 6px;
      --gap: 14px;
      --fs-base: 13px;
    }
  `);
})();
