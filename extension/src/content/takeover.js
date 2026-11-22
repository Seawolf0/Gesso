// @ts-check
/**
 * Dashboard takeover.
 *
 * On the Canvas dashboard route ("/") we stop Canvas's own page load with
 * window.stop() at document_start, then build a minimal document hosting our
 * shadow root. Why stop rather than hide?
 *  - Canvas's dashboard ships megabytes of JS and fires its own API calls;
 *    hidden, it would still compete for the main thread (slowing our first
 *    paint) and for the same per-user API rate-limit bucket.
 *  - Nothing of Canvas's dashboard is needed — every other Canvas page is
 *    left completely untouched.
 *
 * Escape hatches: `/?gesso=classic` skips the takeover for one load, and the
 * sidebar's "Classic Canvas" button switches modes persistently.
 */
(() => {
  function isDashboardRoute(loc = location) {
    return loc.pathname === '/' || loc.pathname === '';
  }

  function isBypassed(loc = location) {
    return new URLSearchParams(loc.search).get('gesso') === 'classic';
  }

  /** Decided synchronously at document_start (uses the localStorage mirror). */
  function shouldTakeOver() {
    return isDashboardRoute() && !isBypassed() && Gesso.settings.readModeMirror() !== 'classic';
  }

  /**
   * Stop Canvas, reset the document, and create the shadow root host.
   * @returns {{ host: HTMLElement, shadow: ShadowRoot }}
   */
  function mount() {
    window.stop();

    let html = document.documentElement;
    if (!html) {
      html = document.createElement('html');
      document.appendChild(html);
    }
    // Drop whatever Canvas's parser had inserted before we stopped it.
    html.replaceChildren();
    for (const attr of [...html.attributes]) html.removeAttribute(attr.name);
    html.setAttribute('lang', navigator.language || 'en');

    const light = Gesso.settings.readMirror('theme') === 'light';
    html.style.setProperty('background', light ? '#f3f4f7' : '#0b0d12');
    html.style.setProperty('color-scheme', light ? 'light' : 'dark');

    const head = document.createElement('head');
    const viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    const scheme = document.createElement('meta');
    scheme.name = 'color-scheme';
    scheme.content = 'dark light';
    const title = document.createElement('title');
    title.textContent = 'Dashboard · Gesso';
    head.append(viewport, scheme, title);

    const body = document.createElement('body');
    body.style.setProperty('margin', '0');
    const host = document.createElement('div');
    host.id = 'gesso-root';
    Gesso.own.add(host); // registered before it's in the page, so no observer ever sees it as foreign
    host.setAttribute('data-theme', light ? 'light' : 'dark');
    // The last theme's exact colors, so the first frame isn't the default theme.
    Gesso.appearance.paintFromMirror(host);
    body.append(host);
    html.append(head, body);

    const shadow = host.attachShadow({ mode: 'open' });
    // An older copy's guard sheet (extension rebuilt/updated) would hide this copy's root: start clean.
    try { document.adoptedStyleSheets = []; } catch { /* ignore */ }
    hideForeignElements(host);
    return { host, shadow };
  }

  /**
   * Scripts Canvas/UMD started before window.stop() (help/onboarding widgets,
   * analytics badges) can still inject elements into our page later — e.g.
   * a floating "?" button. Hide anything that isn't ours, and log what it was.
   * Uses a constructed stylesheet (not a <style> tag) so a page CSP can't block it.
   */
  /** @type {CSSStyleSheet|null} */
  let guardSheet = null;

  /**
   * (Re)install the guard stylesheet; document.open() and similar drop
   * adopted sheets. It pre-hides everything in <body> that doesn't
   * carry THIS copy's token, so it never hides our own root. It used to match
   * `#gesso-root`, which every copy (and any page script) shares.
   */
  function ensureGuard(/** @type {HTMLElement} */ host) {
    try {
      if (!guardSheet) {
        guardSheet = new CSSStyleSheet();
        guardSheet.replaceSync(`
          html > :not(head):not(body),
          body > :not([${Gesso.own.attr}="${Gesso.own.token}"]) { display: none !important; }
        `);
      }
      if (!Gesso.own.has(host)) Gesso.own.add(host);
      if (!document.adoptedStyleSheets.includes(guardSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, guardSheet];
    } catch (err) {
      Gesso.log.warn('Could not install foreign-element guard', err);
    }
  }

  /** Remove this copy's guard (when standing down for a newer copy). */
  function removeGuard() {
    try { if (guardSheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== guardSheet); } catch { /* ignore */ }
  }

  function hideForeignElements(/** @type {HTMLElement} */ host) {
    ensureGuard(host);
    const seen = new WeakSet();
    const report = (/** @type {Node} */ n) => {
      // Never touch our own nodes: the WeakSet can't be forged by a page script copying an id or attribute.
      if (!(n instanceof Element) || Gesso.own.has(n) || n.tagName === 'HEAD' || seen.has(n)) return;
      // A new <body> means a script replaced the page under us; health.js puts Gesso back.
      if (n.tagName === 'BODY') { Gesso.log.warn('A Canvas/UMD script replaced <body>; Gesso will be remounted.'); return; }
      seen.add(n);
      const desc = `<${n.tagName.toLowerCase()}${n.id ? ` id="${n.id}"` : ''}${n.className && typeof n.className === 'string' ? ` class="${n.className.slice(0, 80)}"` : ''}>`;
      // Inline too: a foreign node that copied our token attribute escapes the stylesheet, not this.
      if (n instanceof HTMLElement && n.parentElement === document.body) n.style.setProperty('display', 'none', 'important');
      Gesso.log.info(`Hid an element injected by a Canvas/UMD script: ${desc}`);
    };
    new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach(report);
    }).observe(document.documentElement, { childList: true });
    // Follow <body> when it's replaced, so injected nodes in the new one are still reported.
    let bodyObserver = /** @type {MutationObserver|null} */ (null);
    const watchBody = () => {
      bodyObserver?.disconnect();
      bodyObserver = new MutationObserver((records) => {
        for (const r of records) r.addedNodes.forEach(report);
      });
      if (document.body) bodyObserver.observe(document.body, { childList: true });
    };
    watchBody();
    new MutationObserver(() => watchBody()).observe(document.documentElement, { childList: true });
  }

  /**
   * Full reload at `path` on this origin. (Assigning a URL that differs only
   * by its #hash would not reload, so set the URL first, then reload.)
   */
  function reloadAt(/** @type {string} */ path) {
    history.replaceState(null, '', path);
    location.reload();
  }

  /** Leave Gesso for classic Canvas, without risking a reload loop. */
  function switchToClassic() {
    Gesso.settings.writeModeMirror('classic');
    // If the mirror can't be written (site data blocked), the bypass param
    // still guarantees classic Canvas for this load.
    reloadAt(Gesso.settings.readModeMirror() === 'classic' ? '/' : '/?gesso=classic');
  }

  Gesso.takeover = { isDashboardRoute, isBypassed, shouldTakeOver, mount, reloadAt, switchToClassic, hideForeignElements, ensureGuard, removeGuard };
})();
