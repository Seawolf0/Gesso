// @ts-check
/**
 * Settings → Appearance: the theme gallery (a live mini preview of each
 * theme), mode, accent, course colors, density, and the custom theme editor.
 *
 * The settings view is stateless (rebuilt on every store change), so every
 * control writes settings right away. Colors and sliders preview live while
 * they move (Gesso.appearance.preview, nothing written) and save on change.
 *
 * Custom theme files are validated by Gesso.themes.parseFile. An embedded
 * image is decoded and re-encoded here (a JPEG made from its pixels), so
 * nothing but plain pixels reaches storage. Images never come from the web.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const T = Gesso.themes;
  const A = Gesso.appearance;

  const ACCENTS = /** @type {[string, string][]} */ ([
    ['#8b9cff', 'Periwinkle'], ['#4f7cff', 'Blue'], ['#58b8d1', 'Cyan'], ['#4fb3a9', 'Teal'], ['#6cc17e', 'Green'],
    ['#d6a94f', 'Gold'], ['#e0876a', 'Coral'], ['#e07a9a', 'Pink'], ['#a77bf3', 'Violet'],
  ]);
  /** Longest side of the stored background image, and of its thumbnail. */
  const IMAGE_MAX = 2400;
  const THUMB_MAX = 480;
  /** Largest image file accepted from the file picker (it's downscaled before saving). */
  const PICK_MAX_BYTES = 30 * 1024 * 1024;

  const update = (/** @type {any} */ patch) => Gesso.settings.update(patch);
  /** A toast, when the app is mounted (tests call importText without it). */
  const notify = (/** @type {string} */ msg, /** @type {string} */ tone) => { if (Gesso.overlays.root()) Gesso.overlays.toast(msg, { tone }); };
  /** A dialog, when the app is mounted. */
  const dialog = (/** @type {any} */ opts) => (Gesso.overlays.root() ? Gesso.overlays.dialog(opts) : { close() {}, el: null });
  const modeOf = (/** @type {any} */ s) => (s.theme === 'light' ? 'light' : 'dark');

  // ---------------------------------------------------------------------------
  // Mini preview: a tiny dashboard drawn in a theme's tokens
  // ---------------------------------------------------------------------------

  /**
   * @param {any} t  tokens (Gesso.themes.resolve)
   * @param {{ size?: 'sm'|'lg', thumb?: boolean, label?: string }} [opts]
   */
  function miniPreview(t, opts = {}) {
    const vars = /** @type {Record<string, string>} */ ({});
    for (const k of ['bg', 'bg-elev', 'surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'text', 'text-2', 'text-3',
      'accent', 'accent-fg', 'accent-soft', 'danger', 'danger-soft', 'warn', 'warn-soft', 'ok', 'ok-soft', 'chart-1', 'chart-2', 'chart-3', 'chart-4']) vars[`--p-${k}`] = t[k];
    const bar = (/** @type {string} */ cls, /** @type {string} */ w) => h('span', { class: `tp__bar ${cls}`, style: { width: w } });
    const row = (/** @type {number} */ i, /** @type {string} */ tone, /** @type {string} */ w) => h('span', { class: 'tp__row' },
      h('span', { class: 'tp__course', style: { background: `var(--p-chart-${i})` } }),
      h('span', { class: 'tp__rowtext' }, bar('tp__bar--t2', w), bar('tp__bar--t3 tp__bar--thin', '45%')),
      h('span', { class: `tp__pill tp__pill--${tone}` }));
    return h('span', { class: ['tp', opts.size === 'lg' && 'tp--lg'], style: vars, 'aria-hidden': 'true' },
      opts.thumb && h('canvas', { class: 'tp__img', 'data-thumb': '' }),
      opts.thumb && h('span', { class: 'tp__dim' }),
      h('span', { class: 'tp__side' },
        h('span', { class: 'tp__brand' }),
        h('span', { class: 'tp__nav tp__nav--on' }, h('span', { class: 'tp__navicon' }), bar('tp__bar--t1', '58%')),
        h('span', { class: 'tp__nav' }, bar('tp__bar--t3', '66%')),
        h('span', { class: 'tp__nav' }, bar('tp__bar--t3', '48%')),
        h('span', { class: 'tp__nav tp__nav--course' }, h('span', { class: 'tp__dot', style: { background: 'var(--p-chart-1)' } }), bar('tp__bar--t3', '44%')),
        h('span', { class: 'tp__nav tp__nav--course' }, h('span', { class: 'tp__dot', style: { background: 'var(--p-chart-2)' } }), bar('tp__bar--t3', '52%')),
        h('span', { class: 'tp__nav tp__nav--course' }, h('span', { class: 'tp__dot', style: { background: 'var(--p-chart-3)' } }), bar('tp__bar--t3', '38%'))),
      h('span', { class: 'tp__main' },
        h('span', { class: 'tp__top' }, bar('tp__bar--t1 tp__bar--title', '34%'), h('span', { class: 'tp__search' })),
        h('span', { class: 'tp__stats' },
          ['warn', 'accent', 'danger'].map((tone) => h('span', { class: 'tp__stat' },
            h('span', { class: `tp__staticon tp__staticon--${tone}` }),
            h('span', { class: 'tp__stattext' }, bar('tp__bar--t1 tp__bar--num', '40%'), bar('tp__bar--t3 tp__bar--thin', '70%'))))),
        h('span', { class: 'tp__panel' },
          h('span', { class: 'tp__panelhead' }, bar('tp__bar--t1', '30%'), h('span', { class: 'tp__btn' }, bar('tp__bar--fg', '60%'))),
          row(1, 'danger', '62%'), row(2, 'warn', '48%'), row(4, 'ok', '56%'))));
  }

  /** Draw the stored thumbnail into every `[data-thumb]` canvas under `root` (after render). */
  let thumbCache = /** @type {{ id: string, bmp: ImageBitmap|null }|null} */ (null);
  async function paintThumbs(/** @type {Element} */ root, /** @type {string} */ id) {
    if (!thumbCache || thumbCache.id !== id) {
      const rec = await A.loadImage();
      const blob = rec && rec.id === id ? A.blobOf(rec.thumb || rec.data) : null;
      let bmp = null;
      try { bmp = blob ? await createImageBitmap(blob) : null; } catch { bmp = null; }
      thumbCache = { id, bmp };
    }
    const bmp = thumbCache.bmp;
    if (!bmp) return;
    for (const c of /** @type {NodeListOf<HTMLCanvasElement>} */ (root.querySelectorAll('canvas[data-thumb]'))) {
      const w = (c.width = Math.max(1, c.clientWidth * 2 || 320));
      const ht = (c.height = Math.max(1, c.clientHeight * 2 || 200));
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      const scale = Math.max(w / bmp.width, ht / bmp.height);
      ctx.drawImage(bmp, (w - bmp.width * scale) / 2, (ht - bmp.height * scale) / 2, bmp.width * scale, bmp.height * scale);
    }
  }

  /** Once the panel is in the page, fill its thumbnails and set their dim. */
  function afterMount(/** @type {HTMLElement} */ el, /** @type {any} */ s) {
    const img = s.customTheme?.image;
    if (!img) return;
    const d = A.imageDim({ ...s, themeId: 'custom' });
    for (const dim of /** @type {NodeListOf<HTMLElement>} */ (el.querySelectorAll('.tp__dim'))) dim.style.setProperty('opacity', String(d ? d.dim : 0.5));
    queueMicrotask(() => paintThumbs(el, img.id));
  }

  // ---------------------------------------------------------------------------
  // Appearance panel
  // ---------------------------------------------------------------------------

  /** One theme card: a radio with a live preview, name and description. */
  function card(/** @type {string} */ id, /** @type {string} */ name, /** @type {string} */ desc, /** @type {any} */ tokens, /** @type {boolean} */ selected, /** @type {() => void} */ onPick, /** @type {any} */ extra = {}) {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'set-theme-id', value: id, class: 'tcard__input', 'data-fkey': `theme:${id}`, 'aria-describedby': `tcard-desc-${id}` }));
    input.checked = selected;
    input.addEventListener('change', () => input.checked && onPick());
    return h('label', { class: ['tcard', selected && 'tcard--on', extra.create && 'tcard--create'] },
      input,
      extra.create
        ? h('span', { class: 'tcard__new', 'aria-hidden': 'true' }, h('span', { class: 'tcard__plus' }, icon('pencil', { size: 16 })), 'Build from the current theme')
        : miniPreview(tokens, { thumb: !!extra.thumb }),
      h('span', { class: 'tcard__meta' },
        h('span', { class: 'tcard__name' }, name, selected && h('span', { class: 'tcard__check', 'aria-hidden': 'true' }, icon('check', { size: 11 }))),
        h('span', { class: 'tcard__desc', id: `tcard-desc-${id}` }, desc)));
  }

  function gallery(/** @type {any} */ s) {
    const mode = modeOf(s);
    const active = T.activeId(s);
    const cards = T.PRESETS.map((p) => card(p.id, p.name, p.description, T.resolve({ themeId: p.id }, mode), active === p.id,
      () => update({ themeId: p.id })));
    const ct = s.customTheme;
    cards.push(ct
      ? card('custom', ct.name || 'Custom', 'Your own theme. Edit it below.', T.resolve({ ...s, themeId: 'custom' }, mode), active === 'custom',
        () => update({ themeId: 'custom' }), { thumb: !!ct.image })
      : card('custom', 'Custom', 'Pick one color, or all of them.', null, false, () => createCustom(s), { create: true }));
    return h('div', { class: 'tgallery', role: 'radiogroup', 'aria-label': 'Theme' }, cards);
  }

  /** A new custom theme from the theme showing now (its preset and accent). */
  function createCustom(/** @type {any} */ s) {
    const base = T.activeId(s) === 'custom' ? 'gesso' : T.activeId(s);
    const ct = T.emptyCustom(base);
    ct.name = `My ${T.byId(base).name}`;
    ct.accent = s.accent || '';
    ct.courseColors = s.courseColors === 'theme' ? 'theme' : 'canvas';
    update({ themeId: 'custom', customTheme: ct }).then(() => {
      const root = /** @type {any} */ (Gesso.overlays.root()?.getRootNode());
      const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => root?.querySelector?.('#set-custom')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }), 60);
    });
  }

  function segmented(/** @type {string} */ name, /** @type {string} */ label, /** @type {string} */ value, /** @type {[string, string][]} */ options, /** @type {(v: string) => void} */ onChange) {
    return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label },
      options.map(([v, l]) => {
        const input = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name, value: v, class: 'seg__input', 'data-fkey': `${name}:${v}` }));
        input.checked = v === value;
        input.addEventListener('change', () => input.checked && onChange(v));
        return h('label', { class: 'seg__opt' }, input, h('span', null, l));
      }));
  }

  const row = (/** @type {string} */ label, /** @type {string|null} */ hint, /** @type {any} */ control, /** @type {string} */ cls = '') =>
    h('div', { class: ['set-line', cls] },
      h('div', { class: 'set-line__text' }, h('span', { class: 'set-line__label' }, label), hint && h('span', { class: 'set-hint' }, hint)),
      h('div', { class: 'set-line__control' }, control));

  function accentPicker(/** @type {any} */ s) {
    const current = (s.accent || '').toLowerCase();
    const themeAccent = T.resolve({ themeId: T.activeId(s) }, modeOf(s)).accent;
    const custom = /** @type {HTMLInputElement} */ (h('input', { type: 'color', class: 'swatch-custom', 'aria-label': 'Custom accent color', 'data-fkey': 'set-accent-custom' }));
    custom.value = current || themeAccent;
    custom.addEventListener('input', () => A.preview({ accent: custom.value }));
    custom.addEventListener('change', () => update({ accent: custom.value }));
    const known = !current || ACCENTS.some(([hex]) => hex === current);
    return h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Accent color' },
      h('button', {
        type: 'button', class: 'swatch swatch--theme', role: 'radio', 'aria-checked': String(!current), 'aria-label': 'Theme accent', title: 'The theme’s own accent',
        style: { '--c': themeAccent }, 'data-fkey': 'set-accent:theme', onClick: () => update({ accent: '' }),
      }),
      h('span', { class: 'swatches__sep', 'aria-hidden': 'true' }),
      ACCENTS.map(([hex, name]) => h('button', {
        type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(hex === current), 'aria-label': name, title: name,
        style: { '--c': hex }, 'data-fkey': `set-accent:${hex}`, onClick: () => update({ accent: hex }),
      })),
      h('span', { class: ['swatch-custom-wrap', !known && 'swatch-custom-wrap--on'], title: 'Custom color' }, custom));
  }

  /** The theme's eight course colors, as a strip. */
  const paletteStrip = (/** @type {any} */ t) => h('span', { class: 'pstrip', 'aria-hidden': 'true' },
    [1, 2, 3, 4, 5, 6, 7, 8].map((i) => h('span', { class: 'pstrip__c', style: { background: t[`chart-${i}`] } })));

  /** @param {any} state */
  function appearancePanel(state) {
    const s = state.settings;
    const custom = T.activeId(s) === 'custom';
    const t = T.resolve(s);
    const el = ui.panel({
      title: 'Appearance', icon: 'sparkles', id: 'set-appearance',
      actions: h('button', { class: 'btn btn--sm', type: 'button', 'data-fkey': 'set-theme-import', onClick: () => importTheme(s) }, icon('upload', { size: 13 }), 'Import theme…'),
    },
      h('div', { class: 'set-block' },
        h('div', { class: 'set-block__head' },
          h('span', { class: 'set-line__label' }, 'Theme'),
          h('span', { class: 'set-hint' }, 'Every theme has a dark and a light version. Canvas pages follow the mode when their dark mode is “Match”.')),
        gallery(s)),
      row('Mode', null, segmented('set-theme', 'Mode', modeOf(s), [['dark', 'Dark'], ['light', 'Light']], (v) => update({ theme: v }))),
      !custom && row('Accent color', 'Buttons, links, highlights and the selected item. The first swatch is the theme’s own.', accentPicker(s)),
      !custom && row('Course colors', s.courseColors === 'theme' ? 'Courses use the theme’s palette, in dashboard order.' : 'The colors set in Canvas (course settings).',
        h('div', { class: 'set-inline' },
          s.courseColors === 'theme' && paletteStrip(t),
          segmented('set-course-colors', 'Course colors', s.courseColors === 'theme' ? 'theme' : 'canvas', [['canvas', 'Canvas'], ['theme', 'Theme palette']], (v) => update({ courseColors: v })))),
      row('Density', 'Compact fits more rows on screen.',
        segmented('set-density', 'Density', s.density, [['comfortable', 'Comfortable'], ['compact', 'Compact']], (v) => update({ density: v }))));
    afterMount(el, s);
    return el;
  }

  // ---------------------------------------------------------------------------
  // Custom theme editor
  // ---------------------------------------------------------------------------

  /** Save the custom theme (and preview nothing any more). */
  const saveCustom = (/** @type {any} */ ct) => update({ customTheme: ct, themeId: 'custom' });

  /**
   * A color control: swatch picker, the hex value, and "Auto" when the color
   * is derived. Moves preview live; release saves.
   * @param {{ label: string, hint: string, fkey: string, value: string|undefined, auto: string, onPreview: (v: string) => void, onSave: (v: string|undefined) => void }} o
   */
  function colorControl(o) {
    const id = `ced-${o.fkey}`;
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'color', class: 'ced-color__well', id, 'data-fkey': `ced:${o.fkey}` }));
    input.value = o.value || o.auto;
    const hex = h('span', { class: 'ced-color__hex tabular' }, (o.value || o.auto).toUpperCase());
    input.addEventListener('input', () => { hex.textContent = input.value.toUpperCase(); o.onPreview(input.value); });
    input.addEventListener('change', () => o.onSave(input.value));
    return h('div', { class: 'ced-color' },
      h('div', { class: 'ced-color__text' },
        h('label', { class: 'ced-color__label', for: id }, o.label),
        h('span', { class: 'set-hint' }, o.hint)),
      h('div', { class: 'ced-color__control' },
        o.value
          ? h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-fkey': `ced-auto:${o.fkey}`, title: 'Derive this color from the others again', onClick: () => o.onSave(undefined) }, 'Use auto')
          : h('span', { class: 'ced-auto' }, 'Auto'),
        hex,
        h('span', { class: 'ced-color__wellwrap' }, input)));
  }

  /** Contrast findings for one mode of the custom theme. */
  function findings(/** @type {any} */ s, /** @type {'dark'|'light'} */ mode) {
    return T.audit(T.resolve({ ...s, themeId: 'custom' }, mode));
  }

  function contrastReport(/** @type {any} */ s) {
    const res = /** @type {const} */ (['dark', 'light']).map((m) => /** @type {[string, any[]]} */ ([m, findings(s, m)]));
    const total = res.reduce((n, [, f]) => n + f.length, 0);
    if (!total) {
      return h('div', { class: 'ced-check ced-check--ok', role: 'status' },
        icon('checkCircle', { size: 16 }),
        h('div', null, h('p', { class: 'ced-check__title' }, 'Readable in both modes'), h('p', { class: 'set-hint' }, 'All text meets WCAG AA (4.5:1) on every surface.')));
    }
    return h('div', { class: 'ced-check ced-check--warn', role: 'status' },
      icon('alert', { size: 16 }),
      h('div', null,
        h('p', { class: 'ced-check__title' }, `${total} contrast ${total === 1 ? 'issue' : 'issues'}`),
        h('ul', { class: 'ced-check__list' }, res.flatMap(([m, f]) => f.map((x) => h('li', null,
          h('span', null, `${m === 'dark' ? 'Dark' : 'Light'}: ${x.label}`),
          h('span', { class: 'ced-check__ratio tabular' }, `${x.ratio.toFixed(2)}:1`, h('span', { class: 'faint' }, ` (needs ${x.min}:1)`)))))),
        h('p', { class: 'set-hint' }, 'Text below 4.5:1 is hard to read. Try a darker or lighter text color, or “Use auto”.')));
  }

  /** @param {any} state */
  function customPanel(state) {
    const s = state.settings;
    const ct = /** @type {any} */ (s.customTheme);
    if (!ct || T.activeId(s) !== 'custom') return null;
    const mode = modeOf(s);
    const derived = T.resolve({ ...s, customTheme: { ...ct, [mode]: {} } });
    const set = (/** @type {any} */ patch) => ({ ...ct, ...patch });
    const setMode = (/** @type {string} */ key, /** @type {string|undefined} */ v) => {
      const next = { ...(ct[mode] || {}) };
      if (v) next[key] = v.toLowerCase(); else delete next[key];
      return set({ [mode]: next });
    };
    const modeName = mode === 'dark' ? 'dark' : 'light';

    const name = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input', type: 'text', id: 'ced-name', maxlength: '60', 'data-fkey': 'ced-name' }));
    name.value = ct.name || '';
    name.addEventListener('change', () => { const v = T.cleanName(name.value); if (v && v !== ct.name) saveCustom(set({ name: v })); });

    const tint = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', 'data-fkey': 'ced-tint' }));
    tint.checked = ct.tint !== false;
    tint.disabled = !ct.accent || !!(ct[mode] || {}).bg;
    tint.addEventListener('change', () => saveCustom(set({ tint: tint.checked })));

    const colors = h('fieldset', { class: 'ced-group' },
      h('legend', { class: 'ced-group__title' }, 'Colors'),
      h('div', { class: 'ced-group__head' },
        h('p', { class: 'set-hint' }, `The accent is shared. Background, surface and text are set per mode; you’re editing ${modeName}.`),
        segmented('ced-mode', 'Mode being edited', mode, [['dark', 'Dark'], ['light', 'Light']], (v) => update({ theme: v }))),
      colorControl({
        label: 'Accent', hint: 'The one color to pick. Buttons, links, highlights; the grays and course palette take their cue from it.', fkey: 'accent',
        value: ct.accent || undefined, auto: T.resolve({ themeId: ct.base }, mode).accent,
        onPreview: (v) => A.preview({ customTheme: set({ accent: v }) }), onSave: (v) => saveCustom(set({ accent: v ? v.toLowerCase() : '' })),
      }),
      colorControl({
        label: 'Background', hint: 'The page behind everything.', fkey: 'bg', value: ct[mode]?.bg, auto: derived.bg,
        onPreview: (v) => A.preview({ customTheme: setMode('bg', v) }), onSave: (v) => saveCustom(setMode('bg', v)),
      }),
      colorControl({
        label: 'Surface', hint: 'Panels and cards. Raised surfaces and borders follow it.', fkey: 'surface', value: ct[mode]?.surface, auto: derived.surface,
        onPreview: (v) => A.preview({ customTheme: setMode('surface', v) }), onSave: (v) => saveCustom(setMode('surface', v)),
      }),
      colorControl({
        label: 'Text', hint: 'Secondary and muted text are mixed from it, and kept readable.', fkey: 'text', value: ct[mode]?.text, auto: derived.text,
        onPreview: (v) => A.preview({ customTheme: setMode('text', v) }), onSave: (v) => saveCustom(setMode('text', v)),
      }),
      h('label', { class: 'set-check ced-tint' }, tint,
        h('span', null, 'Tint the grays with the accent', h('span', { class: 'set-hint' }, 'A faint wash of the accent’s hue in backgrounds and surfaces. Off keeps the starting theme’s grays.'))));

    const el = ui.panel({
      title: 'Custom theme', icon: 'pencil', id: 'set-custom',
      subtitle: 'Start from a theme and pick one color; everything else follows. Changes apply as you make them.',
      actions: h('div', { class: 'ced-actions' },
        h('button', { class: 'btn btn--sm', type: 'button', 'data-fkey': 'ced-export', onClick: () => exportTheme(ct) }, icon('download', { size: 13 }), 'Export'),
        h('button', { class: 'btn btn--sm', type: 'button', 'data-fkey': 'ced-reset', onClick: () => confirmReset(ct) }, 'Reset to default')),
    },
      h('div', { class: 'ced' },
        h('div', { class: 'ced__controls' },
          h('div', { class: 'ced-basics' },
            h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'ced-name' }, 'Name'), name),
            h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'ced-base' }, 'Start from'), baseSelect(ct, (v) => saveCustom(set({ base: v })))),
          ),
          colors,
          courseGroup(state, ct),
          imageGroup(s, ct)),
        h('aside', { class: 'ced__aside', 'aria-label': 'Preview and contrast' },
          h('div', { class: 'ced-previews' },
            /** @type {const} */ (['dark', 'light']).map((m) => h('figure', { class: ['ced-preview', m === mode && 'ced-preview--on'] },
              miniPreview(T.resolve({ ...s, themeId: 'custom' }, m), { size: 'lg', thumb: !!ct.image }),
              h('figcaption', null, m === 'dark' ? 'Dark' : 'Light', m === mode && h('span', { class: 'faint' }, ' · showing')))),
          ),
          contrastReport(s))));
    afterMount(el, s);
    return el;
  }

  /** The preset a custom theme starts from (its unset colors come from there). */
  function baseSelect(/** @type {any} */ ct, /** @type {(v: string) => void} */ onChange) {
    const sel = /** @type {HTMLSelectElement} */ (h('select', { class: 'field__input ced-select', id: 'ced-base', 'data-fkey': 'ced-base' },
      T.PRESETS.map((p) => h('option', { value: p.id, selected: p.id === ct.base }, p.name))));
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }

  /** Course colors: Canvas's or the palette, plus a color per course (kept on this Mac). */
  function courseGroup(/** @type {any} */ state, /** @type {any} */ ct) {
    const courses = Gesso.derive.sortedCourses(state.data).filter((/** @type {any} */ c) => !(state.settings.hiddenCourses || []).includes(c.id));
    const overrides = ct.courses || {};
    const setCourse = (/** @type {string} */ id, /** @type {string|undefined} */ v) => {
      const next = { ...overrides };
      if (v) next[id] = v.toLowerCase(); else delete next[id];
      saveCustom({ ...ct, courses: next });
    };
    return h('fieldset', { class: 'ced-group' },
      h('legend', { class: 'ced-group__title' }, 'Course colors'),
      h('div', { class: 'ced-group__head' },
        h('p', { class: 'set-hint' }, 'Cards, dots, calendar blocks and charts. A color set here stays on this Mac; it doesn’t change Canvas.'),
        segmented('ced-course-colors', 'Course colors', ct.courseColors === 'canvas' ? 'canvas' : 'theme', [['canvas', 'Canvas'], ['theme', 'Theme palette']],
          (v) => saveCustom({ ...ct, courseColors: v }))),
      courses.length
        ? h('ul', { class: 'ced-courses' }, courses.map((/** @type {any} */ c) => {
          const own = overrides[c.id];
          const shown = own || c.color;
          const input = /** @type {HTMLInputElement} */ (h('input', { type: 'color', class: 'ced-color__well', 'aria-label': `Color for ${Gesso.derive.courseTitle(c)}`, 'data-fkey': `ced-course:${c.id}` }));
          input.value = shown;
          input.addEventListener('change', () => setCourse(c.id, input.value));
          return h('li', { class: 'ced-course' },
            h('span', { class: 'ced-course__chip', style: { background: Gesso.color.courseGradient(shown) }, 'aria-hidden': 'true' }),
            h('span', { class: 'ced-course__name truncate' }, c.code || Gesso.derive.courseTitle(c),
              c.code && Gesso.derive.courseTitle(c) !== c.code && h('span', { class: 'faint' }, ` ${Gesso.derive.courseTitle(c)}`)),
            own && h('button', { type: 'button', class: 'btn btn--ghost btn--sm', 'data-fkey': `ced-course-reset:${c.id}`, onClick: () => setCourse(c.id, undefined) }, 'Reset'),
            h('span', { class: 'ced-color__wellwrap' }, input));
        }))
        : h('p', { class: 'faint' }, 'Your courses appear here after the first sync.'));
  }

  /** Background image: pick, blur, dim (raised automatically when text would be unreadable). */
  function imageGroup(/** @type {any} */ s, /** @type {any} */ ct) {
    const img = ct.image;
    const file = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true }));
    file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) pickImage(f, ct); });
    const choose = h('button', { class: 'btn', type: 'button', 'data-fkey': 'ced-image', onClick: () => file.click() }, icon('image', { size: 14 }), img ? 'Replace image…' : 'Choose image…');
    if (!img) {
      return h('fieldset', { class: 'ced-group' },
        h('legend', { class: 'ced-group__title' }, 'Background image'),
        h('p', { class: 'set-hint' }, 'Optional. A photo from this Mac behind the app, blurred and dimmed by the theme background so text stays readable. It’s stored on this Mac, never loaded from the web.'),
        h('div', { class: 'ced-image__row' }, choose, file));
    }
    const d = A.imageDim(s);
    const slider = (/** @type {string} */ key, /** @type {string} */ label, /** @type {number} */ max, /** @type {string} */ unit) => {
      const id = `ced-${key}`;
      const input = /** @type {HTMLInputElement} */ (h('input', { type: 'range', min: '0', max: String(max), step: '1', id, class: 'ced-range', 'data-fkey': id }));
      input.value = String(img[key] | 0);
      const out = h('output', { class: 'ced-range__out tabular', for: id }, `${img[key] | 0}${unit}`);
      const next = () => ({ ...ct, image: { ...img, [key]: Number(input.value) } });
      input.addEventListener('input', () => { out.textContent = `${input.value}${unit}`; A.preview({ customTheme: next() }); });
      input.addEventListener('change', () => saveCustom(next()));
      return h('div', { class: 'ced-slider' }, h('label', { class: 'ced-color__label', for: id }, label), input, out);
    };
    const raised = d && d.required > d.chosen + 0.005;
    return h('fieldset', { class: 'ced-group' },
      h('legend', { class: 'ced-group__title' }, 'Background image'),
      h('div', { class: 'ced-image' },
        h('canvas', { class: 'ced-image__thumb', 'data-thumb': '', 'aria-hidden': 'true' }),
        h('div', { class: 'ced-image__controls' },
          slider('blur', 'Blur', T.BLUR_MAX, ' px'),
          slider('dim', 'Dim', T.DIM_MAX, '%'),
          raised && h('p', { class: 'ced-note', role: 'status' }, icon('eye', { size: 13 }),
            `Dimmed to ${Math.round(d.dim * 100)}% in ${modeOf(s)} mode so text stays readable (at least 4.5:1) over this image.`))),
      h('div', { class: 'ced-image__row' }, choose, file,
        h('button', { class: 'btn btn--ghost', type: 'button', 'data-fkey': 'ced-image-remove', onClick: () => removeImage(ct) }, 'Remove')));
  }

  // ---------------------------------------------------------------------------
  // Images: decode → downscale → JPEG; samples for the readability check
  // ---------------------------------------------------------------------------

  const blobToDataUrl = (/** @type {Blob} */ blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  /** @param {HTMLCanvasElement} c @param {number} q */
  const jpegOf = (c, q) => new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', q));

  /**
   * Any image Blob → the stored record. Re-encoding drops metadata and
   * anything that isn't pixels.
   * @param {Blob} blob
   * @returns {Promise<{ rec: { id: string, data: string, thumb: string }, samples: number[][], bitmap: ImageBitmap }>}
   */
  async function processImage(blob) {
    const src = await createImageBitmap(blob);
    const draw = (/** @type {number} */ max) => {
      const k = Math.min(1, max / Math.max(src.width, src.height));
      const c = /** @type {HTMLCanvasElement} */ (document.createElement('canvas'));
      c.width = Math.max(1, Math.round(src.width * k));
      c.height = Math.max(1, Math.round(src.height * k));
      const ctx = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, c.width, c.height);
      return c;
    };
    const full = draw(IMAGE_MAX);
    const thumb = draw(THUMB_MAX);
    // 16×10 regions, each the average of its pixels (the browser's downscale).
    const grid = document.createElement('canvas');
    grid.width = 16; grid.height = 10;
    const gctx = /** @type {CanvasRenderingContext2D} */ (grid.getContext('2d'));
    gctx.imageSmoothingQuality = 'high';
    gctx.drawImage(thumb, 0, 0, 16, 10);
    const px = gctx.getImageData(0, 0, 16, 10).data;
    const samples = [];
    for (let i = 0; i < px.length; i += 4) samples.push([px[i], px[i + 1], px[i + 2]]);
    const data = await blobToDataUrl(await jpegOf(full, 0.86));
    const thumbData = await blobToDataUrl(await jpegOf(thumb, 0.8));
    const bitmap = await createImageBitmap(full);
    src.close?.();
    const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    return { rec: { id, data, thumb: thumbData }, samples, bitmap };
  }

  /** Store an image and point the custom theme at it. */
  async function storeImage(/** @type {any} */ ct, /** @type {Blob} */ blob, /** @type {{ blur?: number, dim?: number }} */ opts = {}) {
    const { rec, samples, bitmap } = await processImage(blob);
    A.offerImage(rec.id, bitmap);
    await Gesso.browser.storage.local.set({ [A.IMAGE_KEY]: rec });
    const prev = ct.image || {};
    return { ...ct, image: { id: rec.id, blur: opts.blur ?? prev.blur ?? 16, dim: opts.dim ?? prev.dim ?? 35, samples } };
  }

  async function pickImage(/** @type {File} */ f, /** @type {any} */ ct) {
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { notify('Choose a PNG, JPEG or WebP image.', 'danger'); return; }
    if (f.size > PICK_MAX_BYTES) { notify(`That image is over ${PICK_MAX_BYTES / 1024 / 1024} MB.`, 'danger'); return; }
    try {
      await saveCustom(await storeImage(ct, f));
    } catch (err) {
      Gesso.log.warn('Background image failed', err);
      notify('That image couldn’t be read.', 'danger');
    }
  }

  async function removeImage(/** @type {any} */ ct) {
    await saveCustom({ ...ct, image: null });
    await Gesso.browser.storage.local.remove(A.IMAGE_KEY).catch(() => {});
  }

  // ---------------------------------------------------------------------------
  // Reset, import, export
  // ---------------------------------------------------------------------------

  function confirmReset(/** @type {any} */ ct) {
    const dlg = dialog({
      title: 'Reset the custom theme?', class: 'dialog--narrow',
      body: h('div', { class: 'form' },
        h('p', null, `Colors, course colors and the background image go back to ${T.byId(ct.base).name}’s defaults. The name stays.`),
        h('div', { class: 'form__actions' },
          h('span', { style: { flex: '1' } }),
          h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel'),
          h('button', {
            class: 'btn btn--primary', type: 'button', onClick: async () => {
              const fresh = { ...T.emptyCustom(ct.base), name: ct.name };
              await saveCustom(fresh);
              await Gesso.browser.storage.local.remove(A.IMAGE_KEY).catch(() => {});
              dlg.close();
              notify('Custom theme reset', 'ok');
            },
          }, 'Reset'))),
    });
  }

  async function exportTheme(/** @type {any} */ ct) {
    const rec = ct.image ? await A.loadImage() : null;
    const text = T.serialize(ct, rec && rec.id === ct.image?.id ? rec.data : null);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = /** @type {HTMLAnchorElement} */ (h('a', { href: url, download: T.fileName(ct.name), hidden: true }));
    (Gesso.overlays.root?.() || document.body).append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    Gesso.diagnostics = { ...(Gesso.diagnostics || {}), lastThemeExport: { name: T.fileName(ct.name), bytes: blob.size, text } };
    notify(`Exported “${ct.name}”`, 'ok');
  }

  function importTheme(/** @type {any} */ s) {
    const file = /** @type {HTMLInputElement} */ (h('input', { type: 'file', accept: '.json,application/json', hidden: true }));
    file.addEventListener('change', async () => {
      const f = file.files?.[0];
      file.remove();
      if (!f) return;
      if (f.size > T.MAX_FILE_BYTES) { showImportErrors([`The file is larger than ${T.MAX_FILE_BYTES / 1024 / 1024} MB.`]); return; }
      await importText(await f.text(), s);
    });
    (Gesso.overlays.root?.() || document.body).append(file);
    file.click();
  }

  /**
   * Validate and install a theme file's text (also used by tests).
   * @param {string} text @param {any} s  current settings
   * @param {{ confirm?: boolean }} [opts]  false skips the "replace?" question
   * @returns {Promise<{ ok: boolean, errors?: string[] }>}
   */
  async function importText(text, s, opts = {}) {
    const parsed = T.parseFile(text);
    if (!parsed.ok) { showImportErrors(parsed.errors); return { ok: false, errors: parsed.errors }; }
    let ct = { ...parsed.theme, courses: s.customTheme?.courses || {} };
    if (parsed.image) {
      try {
        const blob = A.blobOf(parsed.image.data);
        if (!blob) throw new Error('bad image');
        ct = await storeImage(ct, blob, { blur: parsed.image.blur, dim: parsed.image.dim });
      } catch (err) {
        const errors = ['The embedded image couldn’t be read as a picture.'];
        showImportErrors(errors);
        return { ok: false, errors };
      }
    }
    const install = async () => {
      await saveCustom(ct);
      if (!ct.image) await Gesso.browser.storage.local.remove(A.IMAGE_KEY).catch(() => {});
      notify(`Imported “${ct.name}”`, 'ok');
    };
    if (s.customTheme && opts.confirm !== false) {
      const dlg = dialog({
        title: 'Replace your custom theme?', class: 'dialog--narrow',
        body: h('div', { class: 'form' },
          h('p', null, `“${ct.name}” replaces “${s.customTheme.name}”. Export yours first if you want to keep it.`),
          h('div', { class: 'form__actions' },
            h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => exportTheme(s.customTheme) }, icon('download', { size: 13 }), 'Export mine'),
            h('span', { style: { flex: '1' } }),
            h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel'),
            h('button', { class: 'btn btn--primary', type: 'button', onClick: async () => { await install(); dlg.close(); } }, 'Replace'))),
      });
    } else {
      await install();
    }
    return { ok: true };
  }

  function showImportErrors(/** @type {string[]} */ errors) {
    const dlg = dialog({
      title: 'This theme can’t be imported', class: 'dialog--narrow',
      body: h('div', { class: 'form' },
        h('ul', { class: 'ced-errors' }, errors.slice(0, 8).map((e) => h('li', null, e))),
        errors.length > 8 && h('p', { class: 'faint' }, `…and ${errors.length - 8} more.`),
        h('p', { class: 'muted' }, 'Gesso themes are .json files exported from Settings → Appearance. Only known keys, colors like “#14171e”, and an embedded image are allowed.'),
        h('div', { class: 'form__actions' }, h('span', { style: { flex: '1' } }), h('button', { class: 'btn btn--primary', type: 'button', onClick: () => dlg.close() }, 'OK'))),
    });
  }

  Gesso.themeEditor = { appearancePanel, customPanel, miniPreview, importText, processImage };
})();
