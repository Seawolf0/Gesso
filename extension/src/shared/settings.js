// @ts-check
/**
 * User settings, persisted in browser.storage.local under one key.
 *
 * `mode` and `theme` are also mirrored into the Canvas page's own
 * localStorage so the content script can decide *synchronously* at
 * document_start whether to take over the dashboard, and paint the right
 * background color (browser.storage is async; waiting would let Canvas start
 * rendering first). browser.storage stays the source of truth.
 */
(() => {
  const STORAGE_KEY = 'settings';
  const MIRROR_PREFIX = 'gesso.';

  /**
   * @typedef {Object} Settings
   * @property {'gesso'|'classic'} mode     Whether Gesso replaces the Canvas dashboard.
   * @property {'dark'|'light'} theme      The mode: which variant of the theme shows. Native-page dark mode follows it.
   * @property {string} themeId               A preset id (Gesso.themes.PRESET_IDS) or 'custom'.
   * @property {string} accent                Hex accent replacing the preset's; '' = the theme's own accent.
   * @property {'canvas'|'theme'} courseColors  Course colors: Canvas's, or the theme's palette (presets; the custom theme has its own).
   * @property {boolean} seasonal           "Change with the seasons": show the scheduled seasonal/holiday theme (Gesso.themes.schedule); off by default.
   * @property {boolean} decorations        Small motifs for seasonal and holiday themes (sidebar, previews).
   * @property {any} customTheme         The one custom theme (its image pixels live in storage key `theme.image`).
   * @property {'comfortable'|'compact'} density
   * @property {number} dueSoonDays           What counts as "due soon".
   * @property {'dashboard'|'assignments'|'calendar'|'grades'} defaultView  Opened when Canvas loads without a hash
   * @property {boolean} showLauncher         Floating "Gesso" button on native Canvas pages.
   * @property {string[]} hiddenCourses       Course ids hidden from Gesso (local only; Canvas has no equivalent)
   * @property {Record<string, number>|null} gpaScale   Letter → grade points; null = default 4.0 scale
   * @property {Record<string, number>} courseCredits    Course id → credit hours for the GPA (default 3)
   * @property {string[]} gpaExcluded         Course ids left out of the GPA estimate
   * @property {'match'|'on'|'off'} nativeDark  Dark mode on native Canvas pages: follow the Gesso theme, always, or never
   * @property {string[]} nativeDarkOff       Page types kept light (see Gesso.nativeDark.PAGE_TYPES)
   * @property {boolean} darkPdfs             Also darken PDF / document previews (inverts images inside them too)
   * @property {boolean} darkEditor           Darken the rich content editor (off = it looks like the published page)
   * @property {boolean} experimentalSubmit   Text/URL submission from Gesso. Off until a live submission is verified.
   */

  /** @type {Settings} */
  const DEFAULTS = Object.freeze({
    mode: 'gesso',
    theme: 'dark',
    themeId: 'gesso',
    accent: '',
    courseColors: 'canvas',
    customTheme: null,
    seasonal: false,
    decorations: true,
    density: 'comfortable',
    dueSoonDays: 7,
    defaultView: 'dashboard',
    showLauncher: true,
    hiddenCourses: [],
    gpaScale: null,
    courseCredits: {},
    gpaExcluded: [],
    nativeDark: 'match',
    nativeDarkOff: [],
    darkPdfs: false,
    darkEditor: true,
    experimentalSubmit: false,
  });

  /** @returns {Promise<Settings>} */
  async function load() {
    try {
      const stored = await Gesso.browser.storage.local.get(STORAGE_KEY);
      return normalize(stored[STORAGE_KEY]);
    } catch (err) {
      Gesso.log.warn('Could not read settings, using defaults', err);
      Gesso.health?.noteError(err, 'settings.load');
      return { ...DEFAULTS };
    }
  }

  /**
   * Stored settings over the defaults, with the theme keys checked: a bad
   * theme id or custom theme falls back instead of breaking the page.
   * @param {any} stored
   * @returns {Settings}
   */
  function normalize(stored) {
    const s = { ...DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
    const T = Gesso.themes;
    // Before themes (Gesso 1.1), the periwinkle was stored as the accent even when
    // never changed. Read it as "the theme's accent", so other presets keep theirs.
    if (stored && !('themeId' in stored) && String(s.accent).toLowerCase() === '#8b9cff') s.accent = '';
    if (s.accent !== '' && !/^#[0-9a-f]{6}$/i.test(s.accent)) s.accent = '';
    if (T) {
      if (!T.validCustom(s.customTheme)) s.customTheme = null;
      if (s.themeId !== 'custom' && !T.PRESET_IDS.includes(s.themeId)) s.themeId = 'gesso';
      if (s.themeId === 'custom' && !s.customTheme) s.themeId = 'gesso';
    }
    if (s.courseColors !== 'theme') s.courseColors = 'canvas';
    s.seasonal = s.seasonal === true;
    s.decorations = s.decorations !== false;
    return s;
  }

  /**
   * Merge a partial update into stored settings.
   * @param {Partial<Settings>} patch
   * @returns {Promise<Settings>}
   */
  function update(patch) {
    // Serialized: each update reads what the previous one wrote. Two quick
    // changes (e.g. accent, then density) used to interleave their
    // read-modify-write, and the second write dropped the first change.
    const run = queue.then(() => applyUpdate(patch));
    queue = run.catch(() => {});
    return run;
  }
  /** @type {Promise<any>} */
  let queue = Promise.resolve();

  /** @param {Partial<Settings>} patch */
  async function applyUpdate(patch) {
    const next = { ...(await load()), ...patch };
    await Gesso.browser.storage.local.set({ [STORAGE_KEY]: next });
    if (patch.mode) writeMirror('mode', patch.mode);
    if (patch.theme) writeMirror('theme', patch.theme);
    // Native dark mode decides synchronously at document_start from its own mirror.
    if (['theme', 'nativeDark', 'nativeDarkOff', 'darkPdfs', 'darkEditor'].some((k) => k in patch)) writeNativeDarkMirror(next);
    changed(next);
    return next;
  }

  // ---------------------------------------------------------------------------
  // Change notification
  // ---------------------------------------------------------------------------
  //
  // A tab must never depend on storage.onChanged to see its *own* change: in
  // 1.2 a theme card click was saved but the tab only changed after a reload,
  // because the tab's only update path was that event coming back to it. So:
  //   1. this tab: update()/reset() notify local listeners right after the write
  //   2. other tabs: storage.onChanged, backed up by a BroadcastChannel ping
  //      (no data in it; the receiver re-reads storage, so a page script that
  //      posts on the channel can only trigger a harmless re-read)
  //   3. the toolbar popup (an extension page, outside the Canvas origin's
  //      channel): storage.onChanged, backed up by a runtime message ping
  // Each distinct settings value is delivered once (the event or ping that
  // follows a local notification is dropped), and listeners are isolated: one
  // that throws can't stop the others.

  /** @type {Set<(s: Settings) => void>} */
  const listeners = new Set();
  let lastDelivered = '';
  /** @type {BroadcastChannel|null} */
  let channel = null;
  let wired = false;
  const CHANNEL = 'gesso-settings';

  /** Deliver `s` to every listener in this tab, unless it was just delivered. */
  function deliver(/** @type {any} */ raw) {
    const s = normalize(raw);
    const sig = JSON.stringify(s);
    if (sig === lastDelivered) return;
    lastDelivered = sig;
    for (const fn of [...listeners]) {
      try { fn(s); } catch (err) {
        Gesso.log.error('A settings listener failed', err);
        Gesso.health?.noteError?.(err, 'settings listener');
      }
    }
  }

  /** After this tab wrote settings: tell this tab at once, and ping the others. */
  function changed(/** @type {Settings} */ next) {
    deliver(next);
    try { channel?.postMessage({ t: 'settings' }); } catch { /* channel closed */ }
    // Nobody listening (popup closed) rejects; that's fine.
    try { Promise.resolve(Gesso.browser.runtime?.sendMessage?.({ t: 'gesso:settings' })).catch(() => {}); } catch { /* no runtime */ }
  }

  function wire() {
    if (wired) return;
    wired = true;
    Gesso.browser.storage.onChanged.addListener((/** @type {any} */ changes, /** @type {string} */ area) => {
      if (area === 'local' && changes[STORAGE_KEY]) deliver(changes[STORAGE_KEY].newValue);
    });
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = () => { load().then(deliver).catch(() => {}); };
    } catch { /* no BroadcastChannel here (e.g. an extension page): storage events still work */ }
  }

  /**
   * Called when settings change, in this tab (right after the write) or in
   * another tab. Returns a function that stops listening.
   * @param {(s: Settings) => void} fn
   */
  function onChange(fn) {
    wire();
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /**
   * Synchronous copies of a few settings in the Canvas origin's localStorage
   * (see file comment). Only meaningful in the content script.
   * @param {'mode'|'theme'|'nativeDark'|'paint'} name
   */
  function readMirror(name) {
    try {
      return localStorage.getItem(MIRROR_PREFIX + name);
    } catch {
      return null;
    }
  }

  /** @param {'mode'|'theme'|'nativeDark'|'paint'} name @param {string} value */
  function writeMirror(name, value) {
    try {
      localStorage.setItem(MIRROR_PREFIX + name, value);
    } catch {
      /* not on the Canvas origin (e.g. popup) — nothing to mirror */
    }
  }

  const readModeMirror = () => /** @type {'gesso'|'classic'|null} */ (readMirror('mode'));
  const writeModeMirror = (/** @type {'gesso'|'classic'} */ mode) => writeMirror('mode', mode);

  /**
   * Compact JSON copy of the native-dark settings, read synchronously at
   * document_start on native Canvas pages (content/native/dark-mode.js).
   * @param {Settings} s
   */
  function writeNativeDarkMirror(s) {
    writeMirror('nativeDark', JSON.stringify({ m: s.nativeDark, t: s.theme, off: s.nativeDarkOff || [], pdf: !!s.darkPdfs, ed: s.darkEditor !== false }));
  }

  /** @returns {Partial<Settings>|null} */
  function readNativeDarkMirror() {
    try {
      const v = JSON.parse(readMirror('nativeDark') || 'null');
      if (!v || typeof v !== 'object') return null;
      return { nativeDark: v.m, theme: v.t, nativeDarkOff: Array.isArray(v.off) ? v.off : [], darkPdfs: !!v.pdf, darkEditor: v.ed !== false };
    } catch {
      return null;
    }
  }

  /** Back to defaults, keeping per-course data (hidden courses, credits, GPA exclusions) and the custom theme. */
  function reset() {
    const run = queue.then(applyReset);
    queue = run.catch(() => {});
    return run;
  }

  async function applyReset() {
    const cur = await load();
    const next = { ...DEFAULTS, hiddenCourses: cur.hiddenCourses, courseCredits: cur.courseCredits, gpaExcluded: cur.gpaExcluded, customTheme: cur.customTheme };
    await Gesso.browser.storage.local.set({ [STORAGE_KEY]: next });
    writeMirror('mode', next.mode);
    writeMirror('theme', next.theme);
    writeNativeDarkMirror(next);
    changed(next);
    return next;
  }

  Gesso.settings = { DEFAULTS, load, normalize, update, reset, onChange, readMirror, writeMirror, readModeMirror, writeModeMirror, writeNativeDarkMirror, readNativeDarkMirror };
})();
