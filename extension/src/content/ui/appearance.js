// @ts-check
/**
 * Applies the theme to the app: settings → tokens (shared/themes.js) → inline
 * custom properties on the shadow host. Also:
 *
 *   - a short cross-fade when the theme changes (skipped with Reduce Motion)
 *   - the paint mirror: the resolved tokens go to the Canvas page's
 *     localStorage, so the takeover paints the right colors before settings
 *     load (no flash of the default theme)
 *   - themed course colors: views get a state whose courses carry the
 *     theme's color (the Canvas color stays in `canvasColor`)
 *   - the custom theme's background image, drawn into a <canvas> from the
 *     pixels in storage (a page CSP that blocks data: images can't stop a
 *     canvas), dimmed by the theme background until text keeps 4.5:1
 *   - live preview for the custom editor: `preview(patch)` applies unsaved
 *     settings without writing them
 */
(() => {
  const T = Gesso.themes;
  const { h } = Gesso.dom;

  /** Storage key for the custom theme's image: { id, data, thumb } (data URLs, JPEG). */
  const IMAGE_KEY = 'theme.image';
  const TOKEN_KEYS = [...T.COLOR_TOKENS, 'shadow', 'shadow-sm', 'link-deco'];
  const FADE_MS = 320;

  /** @type {HTMLElement|null} */
  let host = null;
  /** @type {any} */
  let saved = null;
  /** @type {any} */
  let previewPatch = null;
  /** @type {any} */
  let tokens = null;
  let lastSig = '';
  let fadeTimer = 0;

  const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  /** Settings as shown: saved, plus any unsaved preview from the editor. */
  const effective = () => (previewPatch ? { ...saved, ...previewPatch } : saved);

  /**
   * Apply `settings` to the host. Called on start and on every settings change.
   * @param {HTMLElement} el @param {any} settings @param {{ animate?: boolean }} [opts]
   */
  function apply(el, settings, opts = {}) {
    host = el;
    saved = settings;
    previewPatch = null;
    paint({ animate: opts.animate !== false, mirror: true });
  }

  /**
   * Show unsaved settings (the custom editor while a color or slider moves).
   * `null` returns to the saved settings. Never animated, never mirrored.
   * @param {any} patch
   */
  function preview(patch) {
    if (!host || !saved) return;
    previewPatch = patch;
    paint({ animate: false, mirror: false });
  }

  function paint(/** @type {{ animate: boolean, mirror: boolean }} */ { animate, mirror }) {
    if (!host || !saved) return;
    const s = effective();
    const t = T.resolve(s);
    tokens = t;
    const sig = TOKEN_KEYS.map((k) => t[k]).join('|');
    const changed = sig !== lastSig;

    if (changed && animate && lastSig && !reducedMotion()) {
      host.setAttribute('data-theme-anim', '');
      clearTimeout(fadeTimer);
      fadeTimer = window.setTimeout(() => host?.removeAttribute('data-theme-anim'), FADE_MS + 60);
    }
    lastSig = sig;

    host.setAttribute('data-theme', t.scheme);
    host.setAttribute('data-theme-id', T.activeId(s));
    host.setAttribute('data-density', s.density === 'compact' ? 'compact' : 'comfortable');
    for (const k of TOKEN_KEYS) host.style.setProperty(`--${k}`, t[k]);
    host.style.setProperty('color-scheme', t.scheme);

    // Page background behind the shadow host (no white flash on overscroll).
    document.documentElement.style.setProperty('background', t.bg);
    document.documentElement.style.setProperty('color-scheme', t.scheme);

    backdrop.update(s, t);

    if (mirror) {
      Gesso.settings.writeMirror('theme', s.theme === 'light' ? 'light' : 'dark');
      Gesso.settings.writeMirror('paint', T.paintRecord(t));
    }
  }

  /**
   * Paint from the mirror before settings load (takeover, document_start).
   * @param {HTMLElement} el
   * @returns {boolean} whether a mirror was found
   */
  function paintFromMirror(el) {
    const t = T.readPaintRecord(Gesso.settings.readMirror('paint'));
    if (!t) return false;
    el.setAttribute('data-theme', t.scheme);
    for (const k of TOKEN_KEYS) if (t[k]) el.style.setProperty(`--${k}`, t[k]);
    el.style.setProperty('color-scheme', t.scheme);
    document.documentElement.style.setProperty('background', t.bg);
    document.documentElement.style.setProperty('color-scheme', t.scheme);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Course colors
  // ---------------------------------------------------------------------------

  /** @type {{ list: any, key: string, out: any }} */
  let coursesMemo = { list: null, key: '', out: null };
  /** @type {{ data: any, courses: any, out: any }} */
  let dataMemo = { data: null, courses: null, out: null };

  /** Courses with the theme's colors (identity-stable while nothing changes, for the views' memos). */
  function themedCourses(/** @type {any[]|null} */ list, /** @type {any} */ settings) {
    if (!Array.isArray(list) || !list.length) return list;
    const s = previewPatch ? { ...settings, ...previewPatch } : settings;
    const t = tokens || T.resolve(s);
    const ordered = Gesso.derive.sortedCourses({ courses: list }).map((/** @type {any} */ c) => c.id);
    const map = T.courseColorMap(s, t, ordered);
    const key = map ? [...map].join(',') : '';
    if (coursesMemo.list === list && coursesMemo.key === key) return coursesMemo.out;
    const out = map ? list.map((c) => (map.has(c.id) && map.get(c.id) !== c.color ? { ...c, color: map.get(c.id), canvasColor: c.color } : c)) : list;
    coursesMemo = { list, key, out };
    return out;
  }

  /**
   * The store state as views should see it: same object when course colors
   * aren't themed, otherwise a shallow copy with themed `data.courses`.
   * @param {any} state
   */
  function view(state) {
    const courses = themedCourses(state?.data?.courses, state?.settings);
    if (!state || courses === state.data.courses) return state;
    if (dataMemo.data !== state.data || dataMemo.courses !== courses) dataMemo = { data: state.data, courses, out: { ...state.data, courses } };
    return { ...state, data: dataMemo.out };
  }

  // ---------------------------------------------------------------------------
  // Background image (custom theme)
  // ---------------------------------------------------------------------------

  /** data: URL → Blob, for createImageBitmap. */
  function blobOf(/** @type {string} */ dataUrl) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl || '');
    if (!m) return null;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] });
  }

  /** The background-image record { id, data, thumb } from storage. */
  async function loadImage() {
    try {
      const got = await Gesso.browser.storage.local.get(IMAGE_KEY);
      const rec = got[IMAGE_KEY];
      return rec && typeof rec.id === 'string' && typeof rec.data === 'string' ? rec : null;
    } catch {
      return null;
    }
  }

  /**
   * Effective dim for the custom theme's image: what the user chose, raised if
   * needed so every text token keeps 4.5:1 over the brightest/darkest region.
   * @param {any} settings @returns {{ dim: number, chosen: number, required: number }|null} 0–1
   */
  function imageDim(settings) {
    const s = settings || effective();
    const img = T.activeId(s) === 'custom' ? s.customTheme?.image : null;
    if (!img) return null;
    const t = T.resolve(s);
    const required = T.requiredDim(img.samples, t);
    const chosen = (img.dim || 0) / 100;
    return { dim: Math.max(chosen, required), chosen, required };
  }

  const backdrop = (() => {
    /** @type {HTMLElement|null} */ let el = null;
    /** @type {HTMLCanvasElement|null} */ let canvas = null;
    /** @type {HTMLElement|null} */ let dimEl = null;
    /** @type {ImageBitmap|null} */ let bitmap = null;
    let bitmapId = '';
    let wantId = '';
    let resizeBound = false;
    /** id → bitmap handed over by the editor (no round trip through storage). */
    const pending = new Map();

    function ensureEl() {
      const root = host?.shadowRoot;
      if (!root) return false;
      if (!el) {
        canvas = /** @type {HTMLCanvasElement} */ (h('canvas', { class: 'backdrop__img' }));
        dimEl = h('div', { class: 'backdrop__dim' });
        el = h('div', { class: 'backdrop', 'aria-hidden': 'true' }, canvas, dimEl);
      }
      if (!el.isConnected) root.prepend(el);
      return true;
    }

    function draw() {
      if (!canvas || !bitmap) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(innerWidth * dpr));
      const ht = Math.max(1, Math.round(innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== ht) { canvas.width = w; canvas.height = ht; }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const scale = Math.max(w / bitmap.width, ht / bitmap.height);
      const dw = bitmap.width * scale;
      const dh = bitmap.height * scale;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, w, ht);
      ctx.drawImage(bitmap, (w - dw) / 2, (ht - dh) / 2, dw, dh);
    }

    async function load(/** @type {string} */ id) {
      wantId = id;
      let bmp = pending.get(id) || null;
      if (!bmp) {
        const rec = await loadImage();
        const blob = rec && rec.id === id ? blobOf(rec.data) : null;
        try { bmp = blob ? await createImageBitmap(blob) : null; } catch { bmp = null; }
      }
      if (wantId !== id) return; // superseded while decoding
      bitmap = bmp;
      bitmapId = bmp ? id : '';
      draw();
      if (el) el.toggleAttribute('data-ready', !!bmp);
    }

    /** @param {any} s @param {any} t */
    function update(s, t) {
      const img = T.activeId(s) === 'custom' ? s.customTheme?.image : null;
      if (!img) {
        host?.removeAttribute('data-backdrop');
        if (el) el.hidden = true;
        wantId = '';
        return;
      }
      if (!ensureEl() || !canvas || !dimEl || !el) return;
      el.hidden = false;
      host?.setAttribute('data-backdrop', '');
      const blur = Math.max(0, Math.min(T.BLUR_MAX, img.blur | 0));
      // Blur samples beyond the edge as transparent; overscan hides the soft rim.
      canvas.style.setProperty('filter', blur ? `blur(${blur}px)` : 'none');
      canvas.style.setProperty('inset', blur ? `${-blur * 2}px` : '0');
      canvas.style.setProperty('width', blur ? `calc(100% + ${blur * 4}px)` : '100%');
      canvas.style.setProperty('height', blur ? `calc(100% + ${blur * 4}px)` : '100%');
      const d = imageDim(s);
      dimEl.style.setProperty('background', t.bg);
      dimEl.style.setProperty('opacity', String(d ? d.dim : 0.5));
      if (bitmapId !== img.id && wantId !== img.id) load(img.id);
      if (!resizeBound) {
        resizeBound = true;
        let raf = 0;
        addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); });
      }
    }

    return {
      update,
      /** The editor decoded a new image: use it right away. */
      offer(/** @type {string} */ id, /** @type {ImageBitmap} */ bmp) { pending.clear(); pending.set(id, bmp); },
    };
  })();

  Gesso.appearance = {
    IMAGE_KEY, apply, preview, paintFromMirror, view, themedCourses, imageDim, loadImage, blobOf,
    offerImage: backdrop.offer,
    /** The tokens showing now (after any preview). */
    tokens: () => tokens,
    /** The saved settings last applied. */
    saved: () => saved,
  };
})();
