// @ts-check
/**
 * Themes: the built-in presets, the custom theme, and the color engine that
 * turns either into the design tokens every view uses (styles/tokens.js).
 *
 * Shared by the app (content script) and the toolbar popup, so it only uses
 * plain math and strings: no DOM, no storage.
 *
 * A theme has a dark and a light variant; `settings.theme` picks which one
 * shows ("mode"), and native-page dark mode keeps keying off that mode.
 *
 * Each variant is described by a small spec, and `build()` derives the full
 * token set from it:
 *
 *   neutral   hue + chroma of the gray ramp (background → surfaces → borders),
 *             laid out on a fixed lightness ladder in OKLCH, so every theme
 *             has the same visual hierarchy and only the tint changes
 *   accent    the theme's accent; accent-as-text, focus ring and button text
 *             are derived from it and nudged until they meet WCAG AA
 *   status    hues for overdue/danger, warning, done/ok and info
 *   palette   eight course/chart hues at a lightness and chroma that suit the mode
 *   hex       exact values that win over the derived ones (the original Gesso
 *             palette, and colors picked in the custom editor)
 *
 * Derived text and status colors are corrected for contrast. Colors the user
 * picks by hand are kept exactly, and `audit()` reports any pair below AA.
 */
(() => {
  // ---------------------------------------------------------------------------
  // Color math (sRGB ⇄ OKLCH, WCAG contrast)
  // ---------------------------------------------------------------------------

  const HEX = /^#[0-9a-f]{6}$/i;
  const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

  /** @param {string} hex @returns {[number, number, number]|null} 0–255 */
  function rgbOf(hex) {
    if (typeof hex !== 'string' || !HEX.test(hex)) return null;
    const n = parseInt(hex.slice(1), 16);
    return [n >> 16, (n >> 8) & 255, n & 255];
  }
  /** @param {number[]} rgb */
  const hexOf = (rgb) => `#${rgb.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;

  const toLin = (/** @type {number} */ v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const fromLin = (/** @type {number} */ v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

  /** @param {string} hex → { l: 0–1, c: 0–~0.37, h: 0–360 } */
  function oklchOf(hex) {
    const rgb = rgbOf(hex) || [0, 0, 0];
    const [r, g, b] = rgb.map(toLin);
    const l = Math.cbrt(0.4122214708 * r + 0.5363015620 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const c = Math.hypot(A, B);
    let h = (Math.atan2(B, A) * 180) / Math.PI;
    if (h < 0) h += 360;
    return { l: L, c, h };
  }

  /** Linear sRGB for an OKLCH color; may be out of gamut. */
  function linearOf(/** @type {number} */ L, /** @type {number} */ C, /** @type {number} */ H) {
    const a = C * Math.cos((H * Math.PI) / 180);
    const b = C * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }

  /** OKLCH → hex, reducing chroma until the color fits in sRGB (keeps lightness and hue). */
  function oklch(/** @type {number} */ L, /** @type {number} */ C, /** @type {number} */ H) {
    L = clamp(L, 0, 1);
    const fits = (/** @type {number} */ c) => linearOf(L, c, H).every((v) => v >= -0.0005 && v <= 1.0005);
    let c = Math.max(0, C);
    if (!fits(c)) {
      let lo = 0;
      let hi = c;
      for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      c = lo;
    }
    return hexOf(linearOf(L, c, H).map((v) => fromLin(clamp(v, 0, 1))));
  }

  /** WCAG 2 relative luminance (same formula as the accessibility audit). */
  function luminance(/** @type {string} */ hex) {
    const rgb = rgbOf(hex);
    if (!rgb) return 0;
    const ch = (/** @type {number} */ v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
  }
  /** WCAG contrast ratio, 1–21. */
  function contrast(/** @type {string} */ a, /** @type {string} */ b) {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  }
  /** `fg` at `alpha` composited over `bg` (sRGB, like the browser does). */
  function over(/** @type {string} */ fg, /** @type {number} */ alpha, /** @type {string} */ bg) {
    const f = rgbOf(fg) || [0, 0, 0];
    const b = rgbOf(bg) || [0, 0, 0];
    return hexOf(f.map((v, i) => v * alpha + b[i] * (1 - alpha)));
  }
  const mix = (/** @type {string} */ a, /** @type {string} */ b, /** @type {number} */ t) => over(b, t, a);
  function rgba(/** @type {string} */ hex, /** @type {number} */ a) {
    const rgb = rgbOf(hex) || [0, 0, 0];
    return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${+a.toFixed(3)})`;
  }

  /**
   * Move `fg`'s lightness (keeping hue and chroma) until it reaches `min`
   * contrast against every color in `bgs`. It moves away from the backgrounds:
   * lighter on dark ones, darker on light ones.
   */
  function ensure(/** @type {string} */ fg, /** @type {string[]} */ bgs, /** @type {number} */ min) {
    // A little headroom: browsers composite and round slightly differently
    // than this math, and a color derived to exactly 4.50 can measure 4.49.
    const target = min + 0.06;
    const ok = (/** @type {string} */ c) => bgs.every((b) => contrast(c, b) >= target);
    if (ok(fg)) return fg;
    const { l, c, h } = oklchOf(fg);
    const up = luminance(bgs[0]) < 0.18;
    for (let step = 1; step <= 100; step++) {
      const next = oklch(l + (up ? 1 : -1) * step * 0.006, c, h);
      if (ok(next)) return next;
    }
    return up ? '#ffffff' : '#000000';
  }

  /** Near-black or white on `hex`, whichever contrasts more (button text on the accent). */
  function readableOn(/** @type {string} */ hex, /** @type {string} */ dark = '#0b0d12') {
    return contrast(hex, dark) >= contrast(hex, '#ffffff') ? dark : '#ffffff';
  }

  // ---------------------------------------------------------------------------
  // The lightness ladders (OKLCH L) every derived theme sits on
  // ---------------------------------------------------------------------------

  /** @typedef {{ bg: number, bgElev: number, surface: number, surface2: number, surface3: number, border: number, borderStrong: number, text: number, text2: number, text3: number }} Ladder */

  /** @type {Ladder} */
  const DARK_L = { bg: 0.165, bgElev: 0.185, surface: 0.207, surface2: 0.235, surface3: 0.268, border: 0.278, borderStrong: 0.338, text: 0.94, text2: 0.79, text3: 0.68 };
  /** @type {Ladder} */
  const LIGHT_L = { bg: 0.966, bgElev: 0.983, surface: 1, surface2: 0.971, surface3: 0.946, border: 0.917, borderStrong: 0.872, text: 0.215, text2: 0.435, text3: 0.535 };

  // ---------------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} VariantSpec
   * @property {{ h: number, c: number }} neutral
   * @property {number} [textC]              chroma of the text ramp (default: a little under the neutral's)
   * @property {Partial<Ladder>} [ladder]
   * @property {string} accent
   * @property {string} [accentFg]           button text on the accent (default: the higher-contrast of near-black/white)
   * @property {string} [accentText]         accent used as text (default: the accent, nudged to 4.5:1)
   * @property {'none'|'underline'} [linkDeco]
   * @property {{ danger: number, warn: number, ok: number, info: number }} [status]  hues
   * @property {number[]} palette            course/chart hues
   * @property {number} [paletteL]
   * @property {number} [paletteC]
   * @property {Record<string, string>} [hex]  exact token values (win over derived ones)
   */

  /**
   * @typedef {Object} Preset
   * @property {string} id
   * @property {string} name
   * @property {string} description
   * @property {VariantSpec} dark
   * @property {VariantSpec} light
   */

  const STATUS = { danger: 25, warn: 72, ok: 152, info: 250 };

  /** The original palette, kept exactly. */
  const GESSO_DARK_HEX = {
    bg: '#0b0d12', 'bg-elev': '#0f1217', surface: '#14171e', 'surface-2': '#1a1e26', 'surface-3': '#222732',
    border: '#232935', 'border-strong': '#303746', text: '#e9ecf2', 'text-2': '#a9b1bf', 'text-3': '#808a9b',
    danger: '#f87171', warn: '#fbbf24', ok: '#4ade80', info: '#60a5fa',
    'skeleton-a': '#191d25', 'skeleton-b': '#222733',
  };
  const GESSO_LIGHT_HEX = {
    bg: '#f3f4f7', 'bg-elev': '#fbfbfc', surface: '#ffffff', 'surface-2': '#f5f6f8', 'surface-3': '#eceef2',
    border: '#e3e6eb', 'border-strong': '#d3d8e0', text: '#12151b', 'text-2': '#4a5262', 'text-3': '#646d7e',
    danger: '#c62828', warn: '#a15c07', ok: '#157a3a', info: '#1d5fd6',
    'skeleton-a': '#eceef2', 'skeleton-b': '#f6f7f9',
    // The periwinkle as text and focus ring on light surfaces (hsl(230 70% 42%)).
    'accent-text': '#2039b6', focus: '#2039b6',
  };

  /** @type {Preset[]} */
  const PRESETS = [
    {
      id: 'gesso', name: 'Gesso', description: 'Cool graphite with a periwinkle accent. The original.',
      dark: { neutral: { h: 262, c: 0.014 }, accent: '#8b9cff', palette: [272, 188, 42, 318, 245, 85, 148, 0], paletteL: 0.72, paletteC: 0.115, hex: GESSO_DARK_HEX },
      light: { neutral: { h: 262, c: 0.01 }, accent: '#8b9cff', palette: [272, 188, 42, 318, 245, 85, 148, 0], paletteL: 0.6, paletteC: 0.13, hex: GESSO_LIGHT_HEX },
    },
    {
      id: 'linen', name: 'Linen', description: 'Warm stone neutrals with a clay accent.',
      dark: {
        neutral: { h: 55, c: 0.017 }, textC: 0.01, ladder: { bg: 0.168, bgElev: 0.188, surface: 0.21, surface2: 0.238, surface3: 0.27 },
        accent: oklch(0.75, 0.1, 50), status: { danger: 15, warn: 82, ok: 145, info: 240 },
        palette: [45, 82, 135, 175, 218, 262, 320, 10], paletteL: 0.72, paletteC: 0.095,
      },
      light: {
        neutral: { h: 70, c: 0.01 }, textC: 0.012, ladder: { bg: 0.958, bgElev: 0.976, surface: 0.993, surface2: 0.966, surface3: 0.94, border: 0.905, borderStrong: 0.86, text: 0.235 },
        accent: oklch(0.53, 0.13, 46), accentFg: '#ffffff', status: { danger: 15, warn: 72, ok: 148, info: 245 },
        palette: [45, 82, 135, 175, 218, 262, 320, 10], paletteL: 0.6, paletteC: 0.11,
      },
    },
    {
      id: 'harbor', name: 'Harbor', description: 'Deep navy with a clear sky-blue accent.',
      dark: {
        neutral: { h: 258, c: 0.04 }, textC: 0.016, ladder: { bg: 0.175, bgElev: 0.195, surface: 0.218, surface2: 0.248, surface3: 0.282, border: 0.29, borderStrong: 0.355, text3: 0.7 },
        accent: oklch(0.77, 0.115, 245), status: { danger: 22, warn: 78, ok: 160, info: 230 },
        palette: [245, 200, 165, 128, 85, 48, 12, 300], paletteL: 0.74, paletteC: 0.105,
      },
      light: {
        neutral: { h: 252, c: 0.0095 }, textC: 0.03, ladder: { bg: 0.968, text: 0.24 },
        accent: oklch(0.52, 0.17, 258), accentFg: '#ffffff', status: { danger: 24, warn: 70, ok: 158, info: 235 },
        palette: [245, 200, 165, 128, 85, 48, 12, 300], paletteL: 0.58, paletteC: 0.13,
      },
    },
    {
      id: 'paper', name: 'Paper', description: 'Soft paper whites and dark ink, with a teal accent.',
      dark: {
        neutral: { h: 90, c: 0.005 }, textC: 0.016, ladder: { bg: 0.205, bgElev: 0.222, surface: 0.242, surface2: 0.268, surface3: 0.3, border: 0.312, borderStrong: 0.372, text: 0.925, text3: 0.7 },
        accent: oklch(0.78, 0.085, 195), status: { danger: 30, warn: 80, ok: 150, info: 235 },
        palette: [195, 60, 140, 25, 255, 95, 330, 170], paletteL: 0.73, paletteC: 0.08,
      },
      light: {
        neutral: { h: 85, c: 0.016 }, textC: 0.012, ladder: { bg: 0.955, bgElev: 0.968, surface: 0.99, surface2: 0.962, surface3: 0.936, border: 0.898, borderStrong: 0.85, text: 0.24, text2: 0.43, text3: 0.52 },
        accent: oklch(0.48, 0.085, 200), accentFg: '#ffffff', status: { danger: 30, warn: 70, ok: 150, info: 240 },
        palette: [195, 60, 140, 25, 255, 95, 330, 170], paletteL: 0.57, paletteC: 0.095,
      },
    },
    {
      id: 'dusk', name: 'Dusk', description: 'Muted plum shadows with a soft orchid accent.',
      dark: {
        neutral: { h: 318, c: 0.022 }, textC: 0.012, ladder: { bg: 0.168, bgElev: 0.188, surface: 0.21, surface2: 0.24, surface3: 0.274 },
        accent: oklch(0.78, 0.11, 312), status: { danger: 18, warn: 75, ok: 158, info: 255 },
        palette: [312, 350, 30, 75, 160, 200, 250, 280], paletteL: 0.73, paletteC: 0.1,
      },
      light: {
        neutral: { h: 318, c: 0.011 }, textC: 0.02, ladder: { bg: 0.964 },
        accent: oklch(0.5, 0.15, 310), accentFg: '#ffffff', status: { danger: 20, warn: 68, ok: 155, info: 255 },
        palette: [312, 350, 30, 75, 160, 200, 250, 280], paletteL: 0.59, paletteC: 0.12,
      },
    },
    {
      id: 'graphite', name: 'Graphite', description: 'Pure neutral grays. Monochrome, no tint.',
      dark: {
        neutral: { h: 0, c: 0 }, textC: 0, ladder: { bg: 0.155, bgElev: 0.175, surface: 0.198, surface2: 0.228, surface3: 0.262 },
        accent: '#ececec', accentFg: '#111111', linkDeco: 'underline',
        palette: [250, 190, 140, 85, 45, 15, 320, 285], paletteL: 0.74, paletteC: 0.06,
      },
      light: {
        neutral: { h: 0, c: 0 }, textC: 0, ladder: { bg: 0.97 },
        accent: '#18181b', accentFg: '#ffffff', linkDeco: 'underline',
        palette: [250, 190, 140, 85, 45, 15, 320, 285], paletteL: 0.56, paletteC: 0.075,
      },
    },
  ];
  const PRESET_IDS = PRESETS.map((p) => p.id);
  const byId = (/** @type {string} */ id) => PRESETS.find((p) => p.id === id) || PRESETS[0];

  // ---------------------------------------------------------------------------
  // build(): spec → tokens
  // ---------------------------------------------------------------------------

  /** Token names in the order they're written (all are CSS custom properties). */
  const COLOR_TOKENS = ['bg', 'bg-elev', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'text', 'text-2', 'text-3',
    'danger', 'danger-soft', 'warn', 'warn-soft', 'ok', 'ok-soft', 'info', 'info-soft', 'neutral-soft',
    'accent', 'accent-fg', 'accent-soft', 'accent-text', 'focus', 'heat-base', 'overlay', 'skeleton-a', 'skeleton-b',
    'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8'];

  /**
   * @typedef {Record<string, string> & { scheme: 'dark'|'light' }} Tokens
   * Every COLOR_TOKENS name, plus shadow, shadow-sm, link-deco, and `scheme`.
   */

  /**
   * @param {VariantSpec} spec
   * @param {'dark'|'light'} mode
   * @param {{ keep?: Set<string> }} [opts]  keep: tokens chosen by hand (never contrast-corrected)
   * @returns {Tokens}
   */
  function build(spec, mode, opts = {}) {
    const dark = mode === 'dark';
    const keep = opts.keep || new Set();
    const hex = spec.hex || {};
    const L = { ...(dark ? DARK_L : LIGHT_L), ...(spec.ladder || {}) };
    const { h, c } = spec.neutral;
    const tc = spec.textC ?? c * 0.6;
    const n = (/** @type {number} */ l, cc = c) => oklch(l, cc, h);
    /** @type {any} */
    const t = { scheme: mode };
    const set = (/** @type {string} */ k, /** @type {string} */ v) => { t[k] = hex[k] || v; };

    set('bg', n(L.bg));
    set('bg-elev', n(L.bgElev));
    set('surface', n(L.surface));
    set('surface-2', n(L.surface2));
    set('surface-3', n(L.surface3));
    set('border', n(L.border));
    set('border-strong', n(L.borderStrong));
    set('text', n(L.text, tc));
    set('text-2', n(L.text2, tc));
    set('text-3', n(L.text3, tc));

    // Text must read on every surface it sits on (WCAG AA 4.5:1; --text-3 also
    // labels --surface-3 chips at 3:1). Hand-picked text is reported, not changed.
    const fix = (/** @type {string} */ k, /** @type {string[]} */ on, /** @type {number} */ min) => {
      if (!keep.has(k) && !hex[k]) t[k] = ensure(t[k], on.map((b) => t[b]), min);
    };
    fix('text', ['bg', 'surface', 'surface-2', 'surface-3'], 7);
    fix('text-2', ['bg', 'surface', 'surface-2'], 4.5);
    fix('text-3', ['bg', 'surface', 'surface-2'], 4.5);
    if (!keep.has('text-3') && !hex['text-3']) t['text-3'] = ensure(t['text-3'], [t['surface-3']], 3);

    // Status colors: one hue each, tuned to the mode, then corrected so they read
    // on surfaces and on their own soft tint.
    const hues = spec.status || STATUS;
    const softA = dark ? 0.14 : 0.1;
    for (const [name, hue] of Object.entries(hues)) {
      const base = dark
        ? oklch(name === 'warn' ? 0.83 : 0.76, name === 'warn' ? 0.15 : 0.14, hue)
        : oklch(name === 'warn' ? 0.56 : 0.52, name === 'warn' ? 0.13 : 0.16, hue);
      let col = hex[name] || base;
      if (!hex[name]) {
        for (let i = 0; i < 3; i++) col = ensure(col, [t.surface, t.bg, t['surface-2'], over(col, softA, t.surface)], 4.5);
      }
      t[name] = col;
      t[`${name}-soft`] = rgba(col, softA);
    }
    t['neutral-soft'] = rgba(t['text-3'], dark ? 0.16 : 0.11);

    // Accent family.
    const accent = hex.accent || spec.accent;
    t.accent = accent;
    t['accent-fg'] = hex['accent-fg'] || spec.accentFg || readableOn(accent, dark ? n(0.16) : '#0b0d12');
    t['accent-soft'] = rgba(accent, dark ? 0.16 : 0.12);
    t['accent-text'] = hex['accent-text'] || ensure(spec.accentText || accent, [t.surface, t.bg, t['surface-2']], 4.5);
    // Focus rings need 3:1 against what they sit on (WCAG 1.4.11).
    t.focus = hex.focus || ensure(accent, [t.surface, t.bg, t['surface-2']], 3);
    t['link-deco'] = spec.linkDeco || 'none';
    // The calendar's workload heat is tints of this. A neutral accent (near
    // black or white) would make busy days look muddy, so those heat in a mid gray.
    t['heat-base'] = oklchOf(accent).c < 0.03 ? mix(t['text-3'], t.bg, 0.25) : accent;

    // Elevation and loading.
    t.overlay = dark ? rgba(n(0.09, c * 0.6), 0.62) : rgba(n(0.2, c * 0.6), 0.36);
    const shade = rgbOf(n(dark ? 0.05 : 0.24, c * 0.8)) || [0, 0, 0];
    const sh = (/** @type {number} */ a) => `rgba(${shade.join(', ')}, ${a})`;
    t['shadow-sm'] = dark ? `0 1px 2px ${sh(0.3)}` : `0 1px 2px ${sh(0.06)}`;
    t.shadow = dark ? `0 1px 0 rgba(255, 255, 255, .03) inset, 0 10px 30px ${sh(0.3)}` : `0 1px 2px ${sh(0.05)}, 0 8px 24px ${sh(0.07)}`;
    set('skeleton-a', dark ? mix(t.surface, t['surface-2'], 0.6) : t['surface-3']);
    set('skeleton-b', dark ? mix(t['surface-2'], t['surface-3'], 0.7) : mix(t['surface-2'], t.surface, 0.5));

    // Course / chart palette.
    const pl = spec.paletteL ?? (dark ? 0.73 : 0.59);
    const pc = spec.paletteC ?? (dark ? 0.11 : 0.13);
    spec.palette.slice(0, 8).forEach((hue, i) => { t[`chart-${i + 1}`] = hex[`chart-${i + 1}`] || oklch(pl, pc, hue); });
    return /** @type {Tokens} */ (t);
  }

  // ---------------------------------------------------------------------------
  // The custom theme
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} CustomTheme  stored in settings.customTheme
   * @property {string} name
   * @property {string} base                 preset the unset colors come from
   * @property {string} accent               '' = the base preset's accent
   * @property {boolean} tint                tint the neutrals with the accent's hue
   * @property {{ bg?: string, surface?: string, text?: string }} dark
   * @property {{ bg?: string, surface?: string, text?: string }} light
   * @property {'canvas'|'theme'} courseColors
   * @property {Record<string, string>} courses   course id → card color (overrides, local only)
   * @property {null|{ id: string, blur: number, dim: number, samples: number[][] }} image  pixels live in storage key `theme.image`
   */

  /** @returns {CustomTheme} */
  const emptyCustom = (base = 'gesso') => ({ name: 'My theme', base, accent: '', tint: true, dark: {}, light: {}, courseColors: 'theme', courses: {}, image: null });

  /**
   * The custom theme's spec for one mode. Every color is optional: with only an
   * accent picked, the neutrals take a faint tint of its hue and the course
   * palette rotates from it, so one color gives a coherent theme.
   * @param {CustomTheme} ct @param {'dark'|'light'} mode
   * @returns {{ spec: VariantSpec, keep: Set<string>, mode: 'dark'|'light' }}
   */
  function customSpec(ct, mode) {
    const base = byId(ct.base)[mode];
    /** @type {VariantSpec} */
    const spec = { ...base, ladder: { ...(base.ladder || {}) }, hex: {} };
    // The Gesso preset pins its exact original values; a custom theme derives instead.
    const ov = (ct && ct[mode]) || {};
    const keep = new Set();
    let effMode = mode;

    if (ct.accent && HEX.test(ct.accent)) {
      const a = oklchOf(ct.accent);
      spec.accent = ct.accent;
      delete spec.accentFg;
      delete spec.accentText;
      spec.linkDeco = a.c < 0.03 ? 'underline' : 'none';
      if (a.c >= 0.03) {
        const hue = Math.round(a.h);
        spec.palette = [0, 45, 95, 140, 185, 230, 275, 320].map((d) => (hue + d) % 360);
        if (ct.tint !== false) spec.neutral = { h: a.h, c: clamp(base.neutral.c || 0.012, 0.008, 0.02) };
      }
    } else if (byId(ct.base).id === 'gesso') {
      spec.neutral = { ...base.neutral };
    }

    if (ov.bg && HEX.test(ov.bg)) {
      const b = oklchOf(ov.bg);
      effMode = b.l < 0.6 ? 'dark' : 'light';
      const ladder = { ...(effMode === 'dark' ? DARK_L : LIGHT_L) };
      const d = b.l - ladder.bg;
      for (const k of /** @type {(keyof Ladder)[]} */ (['bg', 'bgElev', 'surface', 'surface2', 'surface3', 'border', 'borderStrong'])) {
        ladder[k] = clamp(ladder[k] + d, 0, effMode === 'light' ? 1 : 0.6);
      }
      if (effMode === 'light') {
        // Surfaces sit above the background; near white there's no room, so
        // the background steps down instead of the surfaces stepping up.
        ladder.surface = Math.min(1, Math.max(ladder.surface, b.l + 0.02));
      }
      spec.ladder = ladder;
      spec.neutral = { h: b.h, c: b.c };
      spec.textC = Math.min(b.c, 0.02);
      spec.hex = { ...spec.hex, bg: ov.bg };
      keep.add('bg');
    }
    if (ov.surface && HEX.test(ov.surface)) {
      const s = oklchOf(ov.surface);
      const dir = effMode === 'dark' ? 1 : -1;
      spec.hex = {
        ...spec.hex,
        surface: ov.surface,
        'surface-2': oklch(s.l + dir * 0.028, s.c, s.h),
        'surface-3': oklch(s.l + dir * 0.06, s.c, s.h),
        border: oklch(s.l + dir * 0.072, s.c, s.h),
        'border-strong': oklch(s.l + dir * 0.13, s.c, s.h),
      };
      if (!ov.bg) spec.hex['bg-elev'] = oklch(s.l - dir * 0.02, s.c, s.h);
      keep.add('surface');
    }
    if (ov.text && HEX.test(ov.text)) {
      spec.hex = { ...spec.hex, text: ov.text };
      keep.add('text');
    }
    return { spec, keep, mode: effMode };
  }

  /** Secondary text derived from hand-picked text: mixed toward the surface, then corrected. */
  function deriveSecondaryText(/** @type {any} */ t, /** @type {Set<string>} */ keep) {
    if (!keep.has('text')) return t;
    t['text-2'] = ensure(mix(t.text, t.surface, 0.3), [t.bg, t.surface, t['surface-2']], 4.5);
    t['text-3'] = ensure(mix(t.text, t.surface, 0.45), [t.bg, t.surface, t['surface-2']], 4.5);
    t['text-3'] = ensure(t['text-3'], [t['surface-3']], 3);
    t['neutral-soft'] = rgba(t['text-3'], t.scheme === 'dark' ? 0.16 : 0.11);
    return t;
  }

  // ---------------------------------------------------------------------------
  // resolve(): settings → tokens for the mode that's showing
  // ---------------------------------------------------------------------------

  /**
   * @param {any} settings  { themeId, theme (mode), accent, customTheme }
   * @param {'dark'|'light'} [modeArg]  defaults to settings.theme
   * @returns {Tokens}
   */
  function resolve(settings, modeArg) {
    const mode = modeArg || (settings?.theme === 'light' ? 'light' : 'dark');
    const id = settings?.themeId || 'gesso';
    if (id === 'custom' && settings?.customTheme) {
      const ct = /** @type {CustomTheme} */ (settings.customTheme);
      const { spec, keep, mode: eff } = customSpec(ct, mode);
      return deriveSecondaryText(build(spec, eff, { keep }), keep);
    }
    const preset = byId(id);
    const spec = preset[mode];
    // A user accent (Settings → Appearance) replaces the preset's.
    const accent = settings?.accent;
    if (accent && HEX.test(accent) && accent.toLowerCase() !== spec.accent.toLowerCase()) {
      const a = oklchOf(accent);
      const { accent: _a, 'accent-fg': _f, 'accent-text': _t, focus: _r, ...hex } = spec.hex || {};
      return build({ ...spec, hex, accent, accentFg: undefined, accentText: undefined, linkDeco: a.c < 0.03 ? 'underline' : 'none' }, mode);
    }
    return build(spec, mode);
  }

  /** The id actually showing (a missing custom theme falls back to Gesso). */
  const activeId = (/** @type {any} */ s) => (s?.themeId === 'custom' ? (s.customTheme ? 'custom' : 'gesso') : byId(s?.themeId || 'gesso').id);

  /** CSS declarations for a token set (`--bg: …;` …), for the stylesheet fallback. */
  function toCss(/** @type {Tokens} */ t) {
    const lines = [`color-scheme: ${t.scheme};`];
    for (const k of [...COLOR_TOKENS, 'shadow', 'shadow-sm', 'link-deco']) if (t[k]) lines.push(`--${k}: ${t[k]};`);
    return lines.join(' ');
  }

  // ---------------------------------------------------------------------------
  // audit(): the same contrast pairs as the accessibility audit
  // ---------------------------------------------------------------------------

  const LABEL = /** @type {Record<string, string>} */ ({
    text: 'Text', 'text-2': 'Secondary text', 'text-3': 'Muted text', bg: 'background', surface: 'surface', 'surface-2': 'raised surface',
    'surface-3': 'chip', 'accent-text': 'Links', 'accent-fg': 'Button text', accent: 'accent', focus: 'Focus ring',
    danger: 'Overdue', warn: 'Warning', ok: 'Done', info: 'Info',
  });

  /**
   * Every token pair the accessibility audit checks, with its ratio.
   * @param {Tokens} t
   * @returns {{ fg: string, bg: string, min: number, ratio: number, label: string }[]} the failing pairs
   */
  function audit(t) {
    const solid = (/** @type {string} */ v, /** @type {string} */ under) => {
      const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(v || '');
      return m ? over(hexOf([+m[1], +m[2], +m[3]]), +m[4], under) : v;
    };
    /** @type {[string, string, number, string?][]} */
    const pairs = [
      ...['text', 'text-2', 'text-3'].flatMap((f) => ['bg', 'surface', 'surface-2'].map((b) => /** @type {[string, string, number]} */ ([f, b, 4.5]))),
      ['text-3', 'surface-3', 3],
      ...['accent-text', 'danger', 'warn', 'ok', 'info'].flatMap((f) => ['surface', 'bg'].map((b) => /** @type {[string, string, number]} */ ([f, b, 4.5]))),
      ...['danger', 'warn', 'ok', 'info'].map((f) => /** @type {[string, string, number, string]} */ ([f, `${f}-soft`, 4.5, 'surface'])),
      ['accent-fg', 'accent', 4.5],
      ['focus', 'surface', 3], ['focus', 'bg', 3],
    ];
    const out = [];
    for (const [fg, bg, min, under] of pairs) {
      const b = under ? solid(t[bg], t[under]) : t[bg];
      const ratio = contrast(t[fg], b);
      if (ratio + 1e-9 < min) {
        const where = under ? `${(LABEL[fg] || fg).toLowerCase()} tint` : LABEL[bg] || bg;
        out.push({ fg, bg, min, ratio, label: `${LABEL[fg] || fg} on ${where}` });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Background image: how much dimming keeps text readable
  // ---------------------------------------------------------------------------

  /**
   * The smallest dim (0–1, the theme background laid over the image) at which
   * all text tokens keep 4.5:1 against every sampled region of the image.
   * @param {number[][]} samples  [r, g, b] per region of the (downscaled) image
   * @param {Tokens} t
   */
  function requiredDim(samples, t) {
    if (!Array.isArray(samples) || !samples.length) return 0;
    const pix = samples.map((s) => hexOf(s));
    const fgs = [t.text, t['text-2'], t['text-3']];
    for (let a = 0; a <= 1.0001; a += 0.02) {
      if (pix.every((p) => { const b = over(t.bg, a, p); return fgs.every((f) => contrast(f, b) >= 4.5); })) return Math.min(1, +a.toFixed(2));
    }
    return 1;
  }

  // ---------------------------------------------------------------------------
  // Course colors
  // ---------------------------------------------------------------------------

  /**
   * Course id → color for this theme, or null to keep Canvas's colors.
   * @param {any} settings @param {Tokens} t @param {string[]} orderedIds  courses in dashboard order
   * @returns {Map<string, string>|null}
   */
  function courseColorMap(settings, t, orderedIds) {
    const id = activeId(settings);
    const ct = id === 'custom' ? settings.customTheme : null;
    const mode = ct ? ct.courseColors : settings?.courseColors;
    const overrides = ct?.courses || {};
    const usePalette = mode === 'theme';
    if (!usePalette && !Object.keys(overrides).length) return null;
    const map = new Map();
    orderedIds.forEach((cid, i) => {
      const own = overrides[cid];
      if (own && HEX.test(own)) map.set(cid, own);
      else if (usePalette) map.set(cid, t[`chart-${(i % 8) + 1}`]);
    });
    return map;
  }

  // ---------------------------------------------------------------------------
  // Import / export (a small JSON file)
  // ---------------------------------------------------------------------------

  const FILE_KIND = 'gesso-theme';
  const FILE_VERSION = 1;
  /** Largest theme file accepted, image included. */
  const MAX_FILE_BYTES = 8 * 1024 * 1024;
  /** Largest embedded image (decoded bytes; as base64 it stays under the file limit). */
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const FILE_KEYS = ['kind', 'version', 'name', 'base', 'accent', 'tint', 'dark', 'light', 'courseColors', 'image'];
  const VARIANT_KEYS = ['bg', 'surface', 'text'];
  const IMAGE_KEYS = ['data', 'blur', 'dim'];
  /** Raster images only, embedded as base64. No SVG (it can carry script), no URLs. */
  const DATA_URL = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
  const BLUR_MAX = 40;
  const DIM_MAX = 90;

  /** Plain text for a theme name: no control characters, trimmed, 60 characters at most. */
  // eslint-disable-next-line no-control-regex
  const cleanName = (/** @type {string} */ s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  const isPlain = (/** @type {any} */ v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

  /**
   * Validate a theme file's text. Strict: unknown keys, invalid colors, URLs
   * or oversized content reject the whole file, so nothing half-imports.
   * Per-course colors are never in files (they name this account's courses).
   * @param {string} text
   * @returns {{ ok: true, theme: CustomTheme, image: null|{ data: string, blur: number, dim: number } } | { ok: false, errors: string[] }}
   */
  function parseFile(text) {
    /** @type {string[]} */
    const errors = [];
    if (typeof text !== 'string') return { ok: false, errors: ['Not a text file.'] };
    if (text.length > MAX_FILE_BYTES) return { ok: false, errors: [`The file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`] };
    /** @type {any} */
    let d;
    try { d = JSON.parse(text); } catch { return { ok: false, errors: ['The file isn’t valid JSON.'] }; }
    if (!isPlain(d)) return { ok: false, errors: ['The file isn’t a Gesso theme.'] };
    if (d.kind !== FILE_KIND) return { ok: false, errors: ['The file isn’t a Gesso theme (missing "kind": "gesso-theme").'] };
    if (d.version !== FILE_VERSION) errors.push(`Unsupported version ${JSON.stringify(d.version)} (this Gesso reads version ${FILE_VERSION}).`);
    for (const k of Object.keys(d)) if (!FILE_KEYS.includes(k)) errors.push(`Unknown key "${k.slice(0, 40)}".`);
    const theme = emptyCustom();
    if ('name' in d) {
      if (typeof d.name !== 'string' || !cleanName(d.name)) errors.push('"name" must be a non-empty string.');
      else theme.name = cleanName(d.name);
    }
    if ('base' in d) {
      if (!PRESET_IDS.includes(d.base)) errors.push(`"base" must be one of ${PRESET_IDS.join(', ')}.`);
      else theme.base = d.base;
    }
    if ('accent' in d) {
      if (d.accent !== '' && !(typeof d.accent === 'string' && HEX.test(d.accent))) errors.push('"accent" must be a color like "#4f7cff".');
      else theme.accent = d.accent.toLowerCase();
    }
    if ('tint' in d) {
      if (typeof d.tint !== 'boolean') errors.push('"tint" must be true or false.');
      else theme.tint = d.tint;
    }
    for (const mode of /** @type {const} */ (['dark', 'light'])) {
      if (!(mode in d)) continue;
      if (!isPlain(d[mode])) { errors.push(`"${mode}" must be an object.`); continue; }
      for (const [k, v] of Object.entries(d[mode])) {
        if (!VARIANT_KEYS.includes(k)) errors.push(`Unknown key "${mode}.${k.slice(0, 40)}".`);
        else if (typeof v !== 'string' || !HEX.test(v)) errors.push(`"${mode}.${k}" must be a color like "#14171e".`);
        else /** @type {any} */ (theme[mode])[k] = v.toLowerCase();
      }
    }
    if ('courseColors' in d) {
      if (d.courseColors !== 'canvas' && d.courseColors !== 'theme') errors.push('"courseColors" must be "canvas" or "theme".');
      else theme.courseColors = d.courseColors;
    }
    /** @type {null|{ data: string, blur: number, dim: number }} */
    let image = null;
    if ('image' in d && d.image !== null) {
      const im = d.image;
      if (!isPlain(im)) errors.push('"image" must be an object or null.');
      else {
        for (const k of Object.keys(im)) if (!IMAGE_KEYS.includes(k)) errors.push(`Unknown key "image.${k.slice(0, 40)}".`);
        const m = typeof im.data === 'string' ? DATA_URL.exec(im.data) : null;
        if (!m) errors.push('"image.data" must be an embedded PNG, JPEG or WebP image (data:image/…;base64,…). Web addresses aren’t allowed.');
        else if (Math.floor((m[2].length * 3) / 4) > MAX_IMAGE_BYTES) errors.push(`The image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
        const blur = im.blur ?? 0;
        const dim = im.dim ?? 0;
        if (!Number.isInteger(blur) || blur < 0 || blur > BLUR_MAX) errors.push(`"image.blur" must be a whole number from 0 to ${BLUR_MAX}.`);
        if (!Number.isInteger(dim) || dim < 0 || dim > DIM_MAX) errors.push(`"image.dim" must be a whole number from 0 to ${DIM_MAX}.`);
        if (m) image = { data: im.data, blur, dim };
      }
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, theme, image };
  }

  /**
   * The theme file's text. The image (if any) is embedded, never linked.
   * @param {CustomTheme} ct @param {string|null} imageData  data URL
   */
  function serialize(ct, imageData) {
    /** @type {Record<string, any>} */
    const out = { kind: FILE_KIND, version: FILE_VERSION, name: cleanName(ct.name || 'My theme') || 'My theme', base: byId(ct.base).id, accent: ct.accent || '', tint: ct.tint !== false };
    for (const mode of ['dark', 'light']) {
      const v = /** @type {any} */ (ct)[mode] || {};
      const picked = Object.fromEntries(VARIANT_KEYS.filter((k) => v[k] && HEX.test(v[k])).map((k) => [k, v[k]]));
      out[mode] = picked;
    }
    out.courseColors = ct.courseColors === 'canvas' ? 'canvas' : 'theme';
    out.image = ct.image && imageData ? { data: imageData, blur: ct.image.blur | 0, dim: ct.image.dim | 0 } : null;
    return JSON.stringify(out, null, 2);
  }

  /** A file name for the theme: "my-theme.gesso-theme.json". */
  const fileName = (/** @type {string} */ name) => `${(cleanName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme')}.gesso-theme.json`;

  /** Is `v` a valid stored custom theme? (Settings import and load use this.) */
  function validCustom(/** @type {any} */ v) {
    if (v === null) return true;
    if (!isPlain(v) || typeof v.name !== 'string' || !PRESET_IDS.includes(v.base)) return false;
    if (v.accent !== '' && !HEX.test(v.accent)) return false;
    for (const mode of ['dark', 'light']) {
      if (!isPlain(v[mode])) return false;
      for (const [k, c] of Object.entries(v[mode])) if (!VARIANT_KEYS.includes(k) || !HEX.test(/** @type {string} */ (c))) return false;
    }
    if (!isPlain(v.courses) || !Object.values(v.courses).every((c) => typeof c === 'string' && HEX.test(c))) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // The synchronous paint mirror (no flash of the wrong colors)
  // ---------------------------------------------------------------------------

  /**
   * The tokens the takeover paints before settings load: written to the Canvas
   * page's localStorage (and the popup's) on every apply. Compact on purpose.
   * @param {Tokens} t
   */
  const paintRecord = (t) => JSON.stringify({ v: 1, s: t.scheme, t: Object.fromEntries([...COLOR_TOKENS, 'shadow', 'shadow-sm', 'link-deco'].map((k) => [k, t[k]])) });

  /** @returns {Tokens|null} */
  function readPaintRecord(/** @type {string|null} */ raw) {
    try {
      const p = JSON.parse(raw || 'null');
      if (!p || p.v !== 1 || !isPlain(p.t) || (p.s !== 'dark' && p.s !== 'light')) return null;
      // Only token-shaped values: colors, rgba(), shadows, keywords. Never url().
      const safe = Object.entries(p.t).every(([k, v]) => /^[a-z0-9-]+$/.test(k) && typeof v === 'string' && v.length < 200 && /^[#a-z0-9(),.%\s-]*$/i.test(v) && !/url|expression/i.test(v));
      return safe ? /** @type {Tokens} */ ({ ...p.t, scheme: p.s }) : null;
    } catch {
      return null;
    }
  }

  const api = {
    PRESETS, PRESET_IDS, COLOR_TOKENS, byId, activeId, build, resolve, toCss, audit, requiredDim, courseColorMap,
    emptyCustom, customSpec, validCustom, parseFile, serialize, fileName, cleanName, paintRecord, readPaintRecord,
    BLUR_MAX, DIM_MAX, MAX_FILE_BYTES, MAX_IMAGE_BYTES,
    color: { oklch, oklchOf, contrast, luminance, over, mix, rgba, ensure, readableOn, HEX },
  };
  /** @type {any} */ (globalThis).Gesso = /** @type {any} */ (globalThis).Gesso || {};
  /** @type {any} */ (globalThis).Gesso.themes = api;
})();
