// @ts-check
/**
 * Dark mode for native Canvas pages. The styles are in
 * native/dark.css (injected by the manifest); this file decides whether they
 * apply, per page type, and extends them into same-origin iframes.
 *
 *   applyEarly()  at document_start, synchronously: read the localStorage
 *                 mirror and set :root[data-gesso-dark] (+ -pdf / -editor) before
 *                 Canvas paints, so there's no light flash.
 *   start(s)      once real settings load: reconcile, rewrite the mirror, follow
 *                 settings changes from any tab live, and watch iframes.
 *
 * Same-origin iframes (the rich content editor is an about:blank iframe) are
 * part of the inverted page, so the media *inside* them needs the inverse
 * filter too: we add a small stylesheet to each such frame. Cross-origin
 * frames can't be touched; dark.css keeps them natural as a whole.
 * (Safari only supports `match_about_blank` from 18.4, so we don't rely on
 * manifest injection into frames.)
 */
(() => {
  /** Page types the user can toggle, in display order. */
  const PAGE_TYPES = /** @type {[string, string][]} */ ([
    ['pages', 'Course home & pages'],
    ['assignments', 'Assignments & syllabus'],
    ['discussions', 'Discussions & announcements'],
    ['quizzes', 'Quizzes'],
    ['modules', 'Modules'],
    ['files', 'Files'],
    ['grades', 'Grades'],
    ['inbox', 'Inbox'],
    ['calendar', 'Calendar'],
    ['other', 'Everything else'],
  ]);

  const COURSE_SECTIONS = /** @type {Record<string, string>} */ ({
    '': 'pages', pages: 'pages', wiki: 'pages',
    assignments: 'assignments',
    discussion_topics: 'discussions', announcements: 'discussions',
    quizzes: 'quizzes', quiz_submissions: 'quizzes',
    modules: 'modules',
    files: 'files',
    grades: 'grades', gradebook: 'grades',
  });

  /** Native Canvas path → page type (defaults to this page; `Gesso.nativeDark.path` is a test hook). */
  function pageType(pathname = Gesso.nativeDark.path()) {
    const p = pathname.replace(/\/+$/, '');
    const course = p.match(/^\/courses\/[^/]+(?:\/([^/]+))?/);
    if (course) return COURSE_SECTIONS[course[1] || ''] || 'other';
    if (/^\/conversations(\/|$)/.test(p)) return 'inbox';
    if (/^\/calendar2?(\/|$)/.test(p)) return 'calendar';
    if (/^\/(files|users\/[^/]+\/files)(\/|$)/.test(p)) return 'files';
    if (/^\/grades(\/|$)/.test(p)) return 'grades';
    return 'other';
  }

  /**
   * Pure: should this page be dark?
   * @param {any} s  settings (or the mirror's subset)
   * @param {string} type
   * @returns {{ on: boolean, pdf: boolean, editor: boolean, type: string }}
   */
  function decide(s, type) {
    const mode = s.nativeDark || 'match';
    const dark = mode === 'on' || (mode === 'match' && s.theme !== 'light');
    return { on: dark && !(s.nativeDarkOff || []).includes(type), pdf: !!s.darkPdfs, editor: s.darkEditor !== false, type };
  }

  /** @type {{ on: boolean, pdf: boolean, editor: boolean, type: string }} */
  let current = { on: false, pdf: false, editor: true, type: 'other' };

  function setRootAttrs(/** @type {Element} */ root) {
    root.toggleAttribute('data-gesso-dark', current.on);
    root.toggleAttribute('data-gesso-dark-pdf', current.on && current.pdf);
    root.toggleAttribute('data-gesso-dark-editor', current.on && current.editor);
  }

  /** document_start: decide from the mirror (defaults = dark, like the default settings). */
  function applyEarly() {
    const mirror = Gesso.settings.readNativeDarkMirror() || { theme: Gesso.settings.readMirror('theme') || 'dark' };
    current = decide(mirror, pageType());
    const root = document.documentElement;
    if (root) { setRootAttrs(root); return; }
    const mo = new MutationObserver(() => {
      if (!document.documentElement) return;
      mo.disconnect();
      setRootAttrs(document.documentElement);
    });
    mo.observe(document, { childList: true });
  }

  // ---------------------------------------------------------------------------
  // Same-origin iframes
  // ---------------------------------------------------------------------------

  /** Inside an inverted same-origin frame: keep its media natural (same M as dark.css). */
  const FRAME_CSS = `
    @media screen and (forced-colors: none) {
      :root[data-gesso-dark-frame] :where(img, picture, video, canvas, embed, object, iframe:not([data-gesso-frame="same"]), svg:has(image), [data-gesso-natural]) {
        filter: contrast(1.08696) invert(1) hue-rotate(180deg);
      }
      :root[data-gesso-dark-frame] :where(picture, object, svg:has(image), [data-gesso-natural]) :where(img, picture, video, canvas, embed, object, iframe, svg, [data-gesso-natural]) { filter: none; }
      :root[data-gesso-dark-frame] img:is(.equation_image, [src*="/equation_images/"], [data-equation-content]) { filter: none; }
    }`;

  const isEditorFrame = (/** @type {HTMLIFrameElement} */ f) => f.classList.contains('tox-edit-area__iframe') || /_ifr$/.test(f.id);

  function handleFrame(/** @type {HTMLIFrameElement} */ frame) {
    /** @type {Document|null} */
    let doc = null;
    try { doc = frame.contentDocument; } catch { doc = null; }
    const same = !!doc?.documentElement;
    if (frame.getAttribute('data-gesso-frame') !== (same ? 'same' : 'cross')) frame.setAttribute('data-gesso-frame', same ? 'same' : 'cross');
    if (!same || !doc) return;
    if (!doc.getElementById('gesso-dark-frame')) {
      const style = doc.createElement('style');
      style.id = 'gesso-dark-frame';
      style.textContent = FRAME_CSS;
      (doc.head || doc.documentElement).append(style);
    }
    // The frame's content is inverted with the page unless the editor is kept light.
    const inverted = current.on && !(isEditorFrame(frame) && !current.editor);
    doc.documentElement.toggleAttribute('data-gesso-dark-frame', inverted);
  }

  /** @type {WeakSet<HTMLIFrameElement>} */
  const watched = new WeakSet();
  function track(/** @type {HTMLIFrameElement} */ frame) {
    if (!watched.has(frame)) {
      watched.add(frame);
      // A frame can change origin when it navigates (e.g. LTI launches start on Canvas).
      frame.addEventListener('load', () => handleFrame(frame));
    }
    handleFrame(frame);
  }

  function refreshFrames() {
    for (const f of document.querySelectorAll('iframe')) track(/** @type {HTMLIFrameElement} */ (f));
  }

  // ---------------------------------------------------------------------------
  // Raster background images (course card/hero images, avatar spans, banners)
  // ---------------------------------------------------------------------------
  // Canvas and InstUI paint many photos as CSS background-images on generated
  // class names, so they're found by *computed* style, not by selector, and
  // marked [data-gesso-natural] for dark.css. Checked at start, at DOMContentLoaded
  // and load (stylesheets may arrive late), and for every element added or
  // restyled later (MutationObserver).

  const NATURAL = 'data-gesso-natural';
  /** Never marked: page structure, and elements dark.css already handles by tag. */
  const SKIP = new Set(['HTML', 'HEAD', 'BODY', 'MAIN', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT',
    'IMG', 'PICTURE', 'VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT', 'svg', 'SVG']);
  /** More visible text than this → a content container with a decorative background: stays with the page. */
  const MAX_TEXT = 60;

  /** Pure: does a computed background-image value draw a raster image? (SVG urls count as icons.) */
  function rasterBackground(/** @type {string|null|undefined} */ value) {
    if (!value || value === 'none') return false;
    const urls = [...value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/g)].map((m) => m[2]);
    return urls.some((u) => !/^data:image\/svg\+xml|\.svg(?:[?#]|$)/i.test(u));
  }

  function shouldBeNatural(/** @type {Element} */ el) {
    if (SKIP.has(el.tagName) || el.id === 'gesso-launcher') return false;
    if (!rasterBackground(getComputedStyle(el).backgroundImage)) return false;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.width < 12 || r.height < 12)) return false; // sprites, bullets
    if ((el.textContent || '').replace(/\s+/g, '').length > MAX_TEXT) return false;
    if (el.querySelector('input, textarea, select, [contenteditable="true"]')) return false;
    // A filter makes an element the containing block of fixed descendants (that's
    // how the launcher vanished): never mark anything that holds fixed/sticky content.
    for (const d of el.querySelectorAll('*')) {
      const pos = getComputedStyle(d).position;
      if (pos === 'fixed' || pos === 'sticky') return false;
    }
    return true;
  }

  function markNatural(/** @type {Element} */ el) {
    const want = current.on && shouldBeNatural(el);
    if (want !== el.hasAttribute(NATURAL)) el.toggleAttribute(NATURAL, want);
  }

  /** Whole subtree, in slices so a big page never blocks the main thread for long. */
  function scanTree(/** @type {Element} */ root) {
    if (!current.on) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const step = () => {
      const t0 = performance.now();
      /** @type {Node|null} */
      let n = walker.currentNode;
      while (n && performance.now() - t0 < 8) {
        markNatural(/** @type {Element} */ (n));
        n = walker.nextNode();
      }
      if (n) setTimeout(step, 0);
    };
    step();
  }

  /** Added subtrees are scanned whole; restyled elements (class/style changes) only themselves. */
  /** @type {Set<Element>} */
  const pendingTrees = new Set();
  /** @type {Set<Element>} */
  const pendingSelf = new Set();
  let flushQueued = false;
  function queue(/** @type {Element} */ el, /** @type {boolean} */ deep) {
    (deep ? pendingTrees : pendingSelf).add(el);
    if (flushQueued) return;
    flushQueued = true;
    // A timer, not requestAnimationFrame: rAF is paused in background tabs, and
    // content that arrives while the tab is hidden must be fixed too.
    setTimeout(() => {
      flushQueued = false;
      const trees = [...pendingTrees];
      const selves = [...pendingSelf].filter((e) => !pendingTrees.has(e));
      pendingTrees.clear();
      pendingSelf.clear();
      for (const e of trees) if (e.isConnected) scanTree(e);
      for (const e of selves) if (e.isConnected) markNatural(e);
    }, 16);
  }

  let observing = false;
  function watchPage() {
    if (observing) return;
    observing = true;
    refreshFrames();
    scanTree(document.documentElement);
    window.addEventListener('load', () => scanTree(document.documentElement), { once: true });
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          if (r.target.nodeType === 1 && current.on) queue(/** @type {Element} */ (r.target), false);
          continue;
        }
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          const el = /** @type {Element} */ (n);
          if (el.tagName === 'IFRAME') track(/** @type {HTMLIFrameElement} */ (el));
          else if (el.firstElementChild) for (const f of el.querySelectorAll('iframe')) track(/** @type {HTMLIFrameElement} */ (f));
          if (current.on) queue(el, true);
        }
      }
    }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  }

  function apply(/** @type {any} */ settings) {
    const wasOn = current.on;
    current = decide(settings, pageType());
    setRootAttrs(document.documentElement);
    refreshFrames();
    if (observing && current.on && !wasOn) scanTree(document.documentElement); // turned on later: find images now
  }

  /** Real settings loaded: reconcile, keep the mirror fresh, follow changes. */
  function start(/** @type {any} */ settings) {
    Gesso.settings.writeNativeDarkMirror(settings);
    apply(settings);
    Gesso.settings.onChange((s) => apply(s));
    // Watch from now on (catches elements as they're parsed), and rescan once the DOM is complete.
    watchPage();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => scanTree(document.documentElement), { once: true });
  }

  /**
   * The launcher's toggle: flip dark mode for this page's type. Turning it on
   * also switches the global mode to "on" if dark wasn't active at all.
   * @returns {Promise<boolean>} whether this page is now dark
   */
  async function toggleThisPageType() {
    const s = await Gesso.settings.load();
    const type = pageType();
    const off = new Set(s.nativeDarkOff || []);
    /** @type {any} */
    const patch = {};
    if (decide(s, type).on) {
      off.add(type);
      patch.nativeDarkOff = [...off];
    } else {
      off.delete(type);
      patch.nativeDarkOff = [...off];
      if (!decide({ ...s, nativeDarkOff: [...off] }, type).on) patch.nativeDark = 'on';
    }
    const next = await Gesso.settings.update(patch);
    apply(next); // this tab right away; other tabs follow via onChange
    return decide(next, type).on;
  }

  const typeLabel = (/** @type {string} */ type) => PAGE_TYPES.find(([k]) => k === type)?.[1] || type;

  Gesso.nativeDark = { path: () => location.pathname, PAGE_TYPES, pageType, decide, applyEarly, start, toggleThisPageType, typeLabel, isOn: () => current.on, FRAME_CSS, rasterBackground };
})();
