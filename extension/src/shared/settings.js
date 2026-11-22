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
   * @property {'dark'|'light'} theme
   * @property {string} accent                Hex accent color.
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
    accent: '#8b9cff',
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
      return { ...DEFAULTS, ...(stored[STORAGE_KEY] || {}) };
    } catch (err) {
      Gesso.log.warn('Could not read settings, using defaults', err);
      Gesso.health?.noteError(err, 'settings.load');
      return { ...DEFAULTS };
    }
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
    return next;
  }

  /** @param {(s: Settings) => void} fn  Called when settings change in any tab. */
  function onChange(fn) {
    Gesso.browser.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[STORAGE_KEY]) {
        fn({ ...DEFAULTS, ...(changes[STORAGE_KEY].newValue || {}) });
      }
    });
  }

  /**
   * Synchronous copies of a few settings in the Canvas origin's localStorage
   * (see file comment). Only meaningful in the content script.
   * @param {'mode'|'theme'|'nativeDark'} name
   */
  function readMirror(name) {
    try {
      return localStorage.getItem(MIRROR_PREFIX + name);
    } catch {
      return null;
    }
  }

  /** @param {'mode'|'theme'|'nativeDark'} name @param {string} value */
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

  /** Back to defaults, keeping per-course data (hidden courses, credits, GPA exclusions). */
  function reset() {
    const run = queue.then(applyReset);
    queue = run.catch(() => {});
    return run;
  }

  async function applyReset() {
    const cur = await load();
    const next = { ...DEFAULTS, hiddenCourses: cur.hiddenCourses, courseCredits: cur.courseCredits, gpaExcluded: cur.gpaExcluded };
    await Gesso.browser.storage.local.set({ [STORAGE_KEY]: next });
    writeMirror('mode', next.mode);
    writeMirror('theme', next.theme);
    writeNativeDarkMirror(next);
    return next;
  }

  Gesso.settings = { DEFAULTS, load, update, reset, onChange, readMirror, writeMirror, readModeMirror, writeModeMirror, writeNativeDarkMirror, readNativeDarkMirror };
})();
