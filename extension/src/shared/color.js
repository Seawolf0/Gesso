// @ts-check
/**
 * Color helpers: course colors, generated gradients for courses without an
 * image, and accent-derived tokens.
 */
(() => {
  /** Tasteful fallbacks for courses that have no custom color in Canvas. */
  const FALLBACK_PALETTE = [
    '#7c8cff', '#4fb3a9', '#e0876a', '#c78bd8', '#5aa6e8',
    '#d6a94f', '#6cc17e', '#e07a9a', '#8f9bb3', '#58b8d1',
  ];

  /** @param {string} hex */
  function parseHex(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  /** @param {{r:number,g:number,b:number}} rgb → {h:0-360, s:0-100, l:0-100} */
  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }

  /** Deterministic fallback color for a course id. */
  function fallbackFor(/** @type {string} */ id) {
    let hash = 0;
    for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
  }

  /** Normalize any color Canvas gives us; fall back if missing/invalid. */
  function courseColor(/** @type {string|undefined} */ hex, /** @type {string} */ courseId) {
    return parseHex(hex || '') ? `#${String(hex).replace(/^#/, '').toLowerCase()}` : fallbackFor(courseId);
  }

  /**
   * A calm two-stop gradient derived from a course color. Saturation and
   * lightness are clamped so loud Canvas colors (pure red, neon green) still
   * look composed on a dark UI and keep white text readable.
   */
  function courseGradient(/** @type {string} */ hex) {
    const rgb = parseHex(hex) || parseHex(FALLBACK_PALETTE[0]);
    const { h, s } = rgbToHsl(/** @type {any} */ (rgb));
    const sat = Math.min(Math.max(s, 35), 70);
    const a = `hsl(${h.toFixed(0)} ${sat.toFixed(0)}% 34%)`;
    const b = `hsl(${((h + 38) % 360).toFixed(0)} ${(sat * 0.85).toFixed(0)}% 22%)`;
    return `linear-gradient(135deg, ${a} 0%, ${b} 100%)`;
  }

  /** rgba() string from a hex color. */
  function alpha(/** @type {string} */ hex, /** @type {number} */ a) {
    const rgb = parseHex(hex);
    if (!rgb) return `rgba(139, 156, 255, ${a})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
  }

  /** Relative luminance (WCAG) — used to pick black/white text on an accent. */
  function luminance(/** @type {string} */ hex) {
    const rgb = parseHex(hex);
    if (!rgb) return 0;
    const ch = (/** @type {number} */ v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
  }

  /**
   * Near-black or white text on `hex`, whichever has the higher WCAG contrast
   * ratio. (A fixed luminance cut-off at 0.4 put white on the default
   * periwinkle accent: 2.5:1. Dark text there is 8:1.)
   */
  function readableOn(/** @type {string} */ hex) {
    const L = luminance(hex);
    const dark = (L + 0.05) / (luminance('#0b0d12') + 0.05);
    const light = 1.05 / (L + 0.05);
    return dark >= light ? '#0b0d12' : '#ffffff';
  }

  Gesso.color = { parseHex, rgbToHsl, fallbackFor, courseColor, courseGradient, alpha, luminance, readableOn };
})();
