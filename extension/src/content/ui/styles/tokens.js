// @ts-check
/**
 * Design tokens. Every color, space, radius, and type size used in the UI is
 * defined here as a CSS custom property on the shadow host, so themes and
 * density are just attribute switches:
 *
 *   <div id="gesso-root" data-theme="dark|light" data-density="comfortable|compact">
 *
 * The accent color is set at runtime (app.js → applyAppearance) because it's
 * user-configurable.
 *
 * Style files are CSS in template strings. `css` is String.raw — it exists so
 * editor plugins (e.g. "es6-string-css") syntax-highlight the blocks.
 */
(() => {
  const css = String.raw;
  Gesso.styles = { css, sheets: /** @type {string[]} */ ([]) };

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

      /* focus ring color; app.js sets it per theme (light uses the darker accent-text) */
      --focus: #8b9cff;

      /* ---- dark palette (default) ---- */
      color-scheme: dark;
      --bg: #0b0d12;
      --bg-elev: #0f1217;
      --surface: #14171e;
      --surface-2: #1a1e26;
      --surface-3: #222732;
      --border: #232935;
      --border-strong: #303746;
      --text: #e9ecf2;
      --text-2: #a9b1bf;
      --text-3: #808a9b;
      --overlay: rgba(4, 6, 10, .6);

      --danger: #f87171;  --danger-soft: rgba(248, 113, 113, .14);
      --warn: #fbbf24;    --warn-soft: rgba(251, 191, 36, .13);
      --ok: #4ade80;      --ok-soft: rgba(74, 222, 128, .12);
      --info: #60a5fa;    --info-soft: rgba(96, 165, 250, .13);
      --neutral-soft: rgba(148, 160, 180, .12);

      --shadow-sm: 0 1px 2px rgba(0, 0, 0, .3);
      --shadow: 0 1px 0 rgba(255, 255, 255, .03) inset, 0 10px 30px rgba(0, 0, 0, .28);
      --skeleton-a: #191d25;
      --skeleton-b: #222733;
    }

    :host([data-theme="light"]) {
      color-scheme: light;
      --bg: #f3f4f7;
      --bg-elev: #fbfbfc;
      --surface: #ffffff;
      --surface-2: #f5f6f8;
      --surface-3: #eceef2;
      --border: #e3e6eb;
      --border-strong: #d3d8e0;
      --text: #12151b;
      --text-2: #4a5262;
      --text-3: #646d7e; /* 4.5:1+ on --bg (was #687182: 4.47:1) */
      --overlay: rgba(15, 18, 25, .35);

      --danger: #c62828;  --danger-soft: rgba(220, 38, 38, .09);
      --warn: #a15c07;    --warn-soft: rgba(217, 119, 6, .11);
      --ok: #157a3a;      --ok-soft: rgba(22, 163, 74, .10);
      --info: #1d5fd6;    --info-soft: rgba(37, 99, 235, .09);
      --neutral-soft: rgba(90, 100, 120, .09);

      --shadow-sm: 0 1px 2px rgba(16, 24, 40, .06);
      --shadow: 0 1px 2px rgba(16, 24, 40, .05), 0 8px 24px rgba(16, 24, 40, .06);
      --skeleton-a: #eceef2;
      --skeleton-b: #f6f7f9;
    }

    :host([data-density="compact"]) {
      --pad-card: 14px;
      --row-pad-y: 6px;
      --gap: 14px;
      --fs-base: 13px;
    }
  `);
})();
