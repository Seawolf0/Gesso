// @ts-check
/**
 * Keeps Gesso alive and never blank.
 *
 * Live bugs (user):
 *  - 2026-11-21: after idling, the page went blank (our dark <html>
 *    background, no UI, no error). Something replaced <body> under us.
 *  - 2026-11-21: the first fix "remounted" and logged success, but the
 *    page stayed blank. The log line was "now in <body>: <div#gesso-root>",
 *    and that list is taken *before* our root is put back and excludes it.
 *    So the new <body> already held a SECOND Gesso root. Only
 *    takeover.mount() makes that id: a second copy of the content script ran
 *    (Safari injects the rebuilt extension into open tabs after ⌘B). The new
 *    copy wiped the page; the old copy, whose extension context was dead,
 *    appended its stale root next to the new one and called it a success.
 *
 * Rules now:
 *  1. **A newer copy wins.** If another Gesso root is in the page, this copy
 *     stands down: observers, timers, sync and rendering stop. It checks the
 *     newer copy actually shows something a few seconds later, and reloads
 *     once if it doesn't.
 *  2. **A dead extension context never remounts.** If the page was replaced
 *     and the runtime is gone, it reloads once (fresh scripts), otherwise
 *     shows the "updated or restarted" card.
 *  3. **Success means visible.** After a remount (and at startup) the result
 *     is verified after layout. The root, <body> and <html> must not be
 *     display:none, visibility:hidden or opacity 0. The root must have a
 *     nonzero size, the shadow root must have styles, and the app frame must
 *     be styled (display: grid). The current view must have content with
 *     height, and the middle of the window must hit the root. Failures are
 *     logged by name, then one automatic reload (2-minute cooldown), then the
 *     error card. "Verified visible" is logged only when every check passed.
 *
 * Also: health checks on return (visibilitychange, pageshow incl.
 * back/forward cache, focus, online, resume), a dead-extension card, an
 * inline-styled error card (works without our stylesheet), and a persistent
 * log shown in #/debug → Recovery log.
 */
(() => {
  const LOG_KEY = 'gesso.health';
  const RELOAD_KEY = 'gesso.healthReloadAt';
  const DEAD_RELOAD_KEY = 'gesso.healthDeadReloadAt';
  const MAX_REMOUNTS_PER_MIN = 5;
  const RELOAD_COOLDOWN_MS = 2 * 60_000;
  const NEWER_COPY_GRACE_MS = 4000;

  /**
   * @typedef {{ host: HTMLElement, shadow: ShadowRoot, isHealthy: () => boolean, rerender: () => void, onStale: () => void, isStale: () => boolean, onRetire?: () => void }} HealthCtx
   */
  /** @type {HealthCtx|null} */
  let ctx = null;
  let retired = false;
  /** @type {MutationObserver[]} */
  let observers = [];
  /** @type {number[]} */
  let remounts = [];
  let cardShown = '';
  let interval = 0;
  /** @type {Array<() => void>} */
  const unlisten = [];

  // ---------------------------------------------------------------------------
  // Log
  // ---------------------------------------------------------------------------

  function record(/** @type {string} */ cause, /** @type {string} */ action, /** @type {any} */ extra = undefined) {
    const ev = { at: new Date().toISOString(), cause, action, title: document.title, visibility: document.visibilityState };
    Gesso.log.warn(`Health: ${cause} → ${action}`, extra ?? '');
    try {
      const list = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
      list.push(ev);
      localStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-20)));
    } catch { /* storage blocked: console only */ }
    return ev;
  }
  function events() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '[]'); } catch { return []; } }
  function clearEvents() { try { localStorage.removeItem(LOG_KEY); } catch { /* ignore */ } }

  const describe = (/** @type {Element|null} */ n) => (!n ? 'nothing'
    : `<${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ''}${n.className && typeof n.className === 'string' ? `.${n.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}>`);

  // ---------------------------------------------------------------------------
  // Extension context
  // ---------------------------------------------------------------------------

  const STALE_CONTEXT = /extension context invalidated|invalid call to runtime|extension (?:was )?(?:reloaded|unloaded|disabled)|cannot access a chrome|runtime\.id|no such extension|context invalidated/i;

  function extensionAlive() {
    try {
      const rt = Gesso.browser?.runtime;
      if (!rt || !rt.id) return false;
      return !!rt.getManifest?.();
    } catch {
      return false;
    }
  }

  const EXTENSION_CARD = { kind: 'extension', title: 'The extension was updated or restarted', body: 'Reload to continue. Nothing you did was lost: everything is saved in Canvas.' };

  /** From catch blocks and global error handlers: show the card when the context is dead. */
  function noteError(/** @type {any} */ err, /** @type {string} */ where) {
    if (retired) return true;
    const msg = String(err?.message || err || '');
    if (STALE_CONTEXT.test(msg) || !extensionAlive()) {
      record(`extension context unavailable (${where}: ${msg.slice(0, 120) || 'runtime gone'})`, 'asked to reload');
      showCard(EXTENSION_CARD);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Card (never blank)
  // ---------------------------------------------------------------------------

  /**
   * A fixed card over the app. Inline styles only, so it renders even if the
   * app's stylesheet or shell is gone.
   * @param {{ kind: string, title: string, body: string, detail?: string }} o
   */
  function showCard({ kind, title, body, detail }) {
    if (!ctx || retired) return;
    const root = ctx.shadow;
    if (cardShown === kind && root.querySelector('[data-health-card]')) return;
    root.querySelector('[data-health-card]')?.remove();
    // An open modal <dialog> sits in the top layer above any fixed element and makes the rest inert: close it first.
    root.querySelectorAll('dialog[open]').forEach((d) => /** @type {HTMLDialogElement} */ (d).close());
    cardShown = kind;
    const dark = (ctx.host.getAttribute('data-theme') || 'dark') !== 'light';
    const css = (/** @type {HTMLElement} */ el, /** @type {Record<string,string>} */ styles) => { for (const [k, v] of Object.entries(styles)) el.style.setProperty(k, v); return el; };
    const el = (/** @type {string} */ tag, /** @type {Record<string,string>} */ styles = {}, /** @type {string} */ text = '') => { const n = document.createElement(tag); if (text) n.textContent = text; return css(n, styles); };

    const wrap = el('div', { position: 'fixed', inset: '0', 'z-index': '2147483000', display: 'grid', 'place-items': 'center', padding: '16px',
      background: dark ? 'rgba(4,6,10,.72)' : 'rgba(15,18,25,.35)', 'font-family': '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' });
    wrap.setAttribute('data-health-card', kind);
    Gesso.own.add(wrap);
    const card = el('div', { 'max-width': '480px', width: '100%', padding: '24px', 'border-radius': '16px', background: dark ? '#14171e' : '#ffffff',
      color: dark ? '#e9ecf2' : '#12151b', border: `1px solid ${dark ? '#303746' : '#d3d8e0'}`, 'box-shadow': '0 24px 80px rgba(0,0,0,.45)' });
    card.setAttribute('role', 'alertdialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'health-title');
    card.setAttribute('aria-describedby', 'health-body');
    const h = el('h2', { margin: '0 0 8px', 'font-size': '18px', 'font-weight': '700' }, title);
    h.id = 'health-title';
    const p = el('p', { margin: '0 0 6px', 'line-height': '1.45', color: dark ? '#a9b1bf' : '#4a5262' }, body);
    p.id = 'health-body';
    card.append(h, p);
    if (detail) card.append(el('p', { margin: '0 0 6px', 'font-size': '12px', color: dark ? '#808a9b' : '#646d7e', 'overflow-wrap': 'anywhere' }, detail));
    const row = el('div', { display: 'flex', gap: '8px', 'margin-top': '16px', 'flex-wrap': 'wrap', 'align-items': 'center' });
    const reload = /** @type {HTMLButtonElement} */ (el('button', { height: '36px', padding: '0 16px', 'border-radius': '8px', border: '0', background: '#8b9cff', color: '#0b0d12', font: 'inherit', 'font-weight': '650', cursor: 'pointer' }, 'Reload'));
    reload.type = 'button';
    reload.setAttribute('data-health-reload', '');
    reload.addEventListener('click', () => api.reload('card: Reload'));
    const classic = /** @type {HTMLAnchorElement} */ (el('a', { padding: '0 8px', color: dark ? '#8b9cff' : '#4a57c8', 'font-weight': '600' }, 'Open Classic Canvas'));
    classic.href = `${Gesso.config.canvasOrigin}/?gesso=classic`;
    row.append(reload, classic);
    card.append(row);
    wrap.append(card);
    root.append(wrap);
    reload.focus();
  }

  function hideCard() {
    ctx?.shadow.querySelector('[data-health-card]')?.remove();
    cardShown = '';
  }

  const RENDER_CARD = { kind: 'render', title: 'Gesso couldn’t redraw this page', body: 'Reload to start it again, or use classic Canvas for now.' };

  /**
   * One automatic reload per 2 minutes; within that, the card instead (so a
   * page that's broken after a reload doesn't loop).
   * @param {string} why  @param {{ kind: string, title: string, body: string, detail?: string }} card
   */
  function reloadOrCard(why, card) {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* ignore */ }
    if (Date.now() - last > RELOAD_COOLDOWN_MS) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
      record(why, 'reloading the page (once)');
      api.reload(why);
      return 'reload';
    }
    record(why, 'card shown (already reloaded in the last 2 minutes)');
    showCard({ ...card, detail: card.detail || why });
    return 'card';
  }

  // ---------------------------------------------------------------------------
  // Verification: is Gesso actually visible?
  // ---------------------------------------------------------------------------

  /**
   * Everything that would make `host` not show the app, by name. An empty
   * list means visible.
   * @param {HTMLElement} host
   * @returns {string[]}
   */
  function visibilityProblems(host) {
    const problems = [];
    if (!host.isConnected) return ['the root isn’t in the page'];
    if (host.parentElement !== document.body) problems.push(`the root is under ${describe(host.parentElement)}, not <body>`);
    for (const [node, label] of /** @type {[Element|null, string][]} */ ([[document.documentElement, '<html>'], [document.body, '<body>'], [host, 'the root']])) {
      if (!node) { problems.push(`${label} is missing`); continue; }
      const cs = getComputedStyle(node);
      if (cs.display === 'none') problems.push(`${label} is display:none`);
      if (cs.visibility === 'hidden') problems.push(`${label} is visibility:hidden`);
      if (Number(cs.opacity) === 0) problems.push(`${label} has opacity 0`);
    }
    const r = host.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) problems.push(`the root is ${Math.round(r.width)}×${Math.round(r.height)} px`);
    const sh = host.shadowRoot;
    if (!sh) return [...problems, 'the root has no shadow root'];
    const sheets = /** @type {any} */ (sh).adoptedStyleSheets?.length || 0;
    if (!sheets && !sh.querySelector('style')) problems.push('the shadow root has no styles');
    const app = sh.querySelector('.app');
    if (!app) problems.push('the app frame is missing');
    else {
      if (getComputedStyle(app).display !== 'grid') problems.push('the app’s styles aren’t applied');
      const main = sh.querySelector('main');
      if (!main || !main.childElementCount) problems.push('the current view has no content');
      else if (main.getBoundingClientRect().height < 1) problems.push('the current view has no height');
    }
    if (!problems.length && innerWidth > 0 && innerHeight > 0) {
      const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      if (hit !== host && !(hit && host.contains(hit))) problems.push(`the middle of the window shows ${describe(hit)}`);
    }
    return problems;
  }

  /**
   * Let the remount settle. Not requestAnimationFrame: it never fires in a
   * hidden tab (where the page is most likely replaced), and the checks
   * below force layout themselves (getComputedStyle / getBoundingClientRect).
   */
  const afterLayout = () => new Promise((r) => setTimeout(r, 80));

  /**
   * Verify `host` shows the app; on failure, reload once or show the card.
   * @param {HTMLElement} host @param {string} what
   * @returns {Promise<boolean>}
   */
  async function verify(host, what) {
    await afterLayout();
    if (retired) return true; // stood down meanwhile: the newer copy is checked separately
    const problems = visibilityProblems(host);
    if (!problems.length) {
      record(what, 'verified visible');
      return true;
    }
    reloadOrCard(`${what}: verification failed (${problems.join('; ')})`, RENDER_CARD);
    return false;
  }

  // ---------------------------------------------------------------------------
  // Watchdog: keep the root in the page
  // ---------------------------------------------------------------------------

  /**
   * Another Gesso root in the page from a newer copy of the content script?
   * A genuine copy's root has its own shadow root and its own copy token
   * (Gesso.own). An element that merely copies our id, or our token, is a
   * foreign injection (the hider deals with it), not a reason to stand down.
   */
  function otherRoot() {
    if (!ctx) return null;
    const host = ctx.host;
    return [...document.querySelectorAll(`#${CSS.escape(host.id)}`)].find((n) => n !== host
      && !!/** @type {HTMLElement} */ (n).shadowRoot
      && !!n.getAttribute(Gesso.own.attr) && n.getAttribute(Gesso.own.attr) !== Gesso.own.token) || null;
  }

  /** This copy stops everything and leaves the page to the newer copy. */
  function retire(/** @type {Element} */ other, /** @type {string} */ trigger) {
    if (retired || !ctx) return;
    retired = true;
    observers.forEach((o) => o.disconnect());
    observers = [];
    clearInterval(interval);
    unlisten.splice(0).forEach((f) => f());
    if (ctx.host.isConnected) ctx.host.remove();
    Gesso.takeover?.removeGuard?.(); // this copy's guard would hide the newer copy's root
    try { ctx.onRetire?.(); } catch { /* best effort */ }
    record(`a newer copy of Gesso took over the page (${trigger}; extension likely rebuilt or updated)`, 'this copy stood down');
    // The newer copy should be showing something shortly. If not, reload once.
    setTimeout(() => {
      if (!other.isConnected) return; // replaced again: whoever is there now is in charge
      const problems = visibilityProblems(/** @type {HTMLElement} */ (other));
      if (problems.length) reloadOrCardRetired(`the newer copy isn’t showing anything after ${NEWER_COPY_GRACE_MS / 1000} s (${problems.join('; ')})`);
      else record('the newer copy is showing Gesso', 'verified visible');
    }, NEWER_COPY_GRACE_MS);
  }

  /** A retired copy can't show cards in its own (detached) root; it can still reload once. */
  function reloadOrCardRetired(/** @type {string} */ why) {
    let last = 0;
    try { last = Number(sessionStorage.getItem(RELOAD_KEY) || 0); } catch { /* ignore */ }
    if (Date.now() - last > RELOAD_COOLDOWN_MS) {
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
      record(why, 'reloading the page (once)');
      api.reload(why);
    } else {
      record(why, 'left to the newer copy (already reloaded in the last 2 minutes)');
    }
  }

  /**
   * Put the root back if it left the page, then verify it's visible.
   * @returns {boolean} false if it didn't (or shouldn't) remount
   */
  function ensureMounted(/** @type {string} */ trigger) {
    if (!ctx || retired) return true;
    const { host } = ctx;
    if (host.isConnected && host.parentElement === document.body) return true;

    // 1. A newer copy wins.
    const other = otherRoot();
    if (other) { retire(other, trigger); return false; }

    const what = !document.documentElement ? 'the whole document was cleared'
      : !document.body ? '<body> was removed'
        : host.isConnected ? `the root was moved under <${host.parentElement?.tagName.toLowerCase()}>`
          : document.body.dataset.gessoBody !== '1' ? '<body> was replaced' : 'the root was removed from <body>';
    const foreign = document.body ? [...document.body.children].filter((c) => c !== host).map(describe).slice(0, 3).join(', ') : '';
    const cause = `${what} (${trigger})${foreign ? `; now in <body>: ${foreign}` : ''}`;

    // 2. A dead extension context never remounts: reload, which brings fresh,
    //    live scripts (so it can't loop like a broken render could). Only a
    //    10 s guard against rapid repeats; inside it, attach the root just to
    //    show the card (a card in a detached root would never be seen).
    if (!extensionAlive()) {
      let last = 0;
      try { last = Number(sessionStorage.getItem(DEAD_RELOAD_KEY) || 0); } catch { /* ignore */ }
      if (Date.now() - last > 10_000) {
        try { sessionStorage.setItem(DEAD_RELOAD_KEY, String(Date.now())); } catch { /* ignore */ }
        record(`${cause}, and the extension context is gone`, 'not remounting; reloading the page');
        api.reload('dead extension context after the page was replaced');
      } else {
        record(`${cause}, and the extension context is gone (reloaded seconds ago)`, 'showing the “updated or restarted” card');
        (document.body || document.documentElement)?.append(host);
        showCard(EXTENSION_CARD);
      }
      watch(); // keep observing whatever <body> is current
      return false;
    }

    const now = Date.now();
    remounts = remounts.filter((t) => now - t < 60_000);
    if (remounts.length >= MAX_REMOUNTS_PER_MIN) {
      record(`${cause}; ${remounts.length} remounts in a minute`, 'stopped remounting');
      reloadOrCard('the page keeps being replaced', { kind: 'loop', title: 'Canvas keeps replacing this page', body: 'Something on the page keeps removing Gesso. Reload, or use classic Canvas for now.', detail: `Last: ${cause}` });
      return false;
    }
    remounts.push(now);

    let html = document.documentElement;
    if (!html) { html = document.createElement('html'); document.appendChild(html); }
    if (!document.head) html.prepend(document.createElement('head'));
    if (!document.querySelector('head > title')) { const t = document.createElement('title'); t.textContent = 'Gesso'; document.head.append(t); }
    let body = document.body;
    if (!body) { body = document.createElement('body'); html.append(body); }
    body.style.setProperty('margin', '0');
    body.dataset.gessoBody = '1';
    const light = host.getAttribute('data-theme') === 'light';
    html.style.setProperty('background', light ? '#f3f4f7' : '#0b0d12');
    html.style.setProperty('color-scheme', light ? 'light' : 'dark');
    Gesso.own.add(host); // ours before the observers see it in the new <body>
    body.append(host);
    Gesso.takeover?.ensureGuard?.(host);
    watch(); // the <html>/<body> we observed may be new elements now
    // The same root came back with its shadow DOM and state; only redraw if the view is actually broken.
    if (!ctx.isHealthy()) { try { ctx.rerender(); } catch (err) { Gesso.log.error('Re-render after remount failed', err); } }
    record(cause, 'root reattached; verifying it’s visible');
    // 3. Success means visible.
    verify(host, `remount after: ${what}`);
    return true;
  }

  function watch() {
    observers.forEach((o) => o.disconnect());
    observers = [];
    const detached = () => !!ctx && !retired && (!ctx.host.isConnected || ctx.host.parentElement !== document.body);
    const check = (/** @type {string} */ t) => () => { if (detached()) queueMicrotask(() => ensureMounted(t)); };
    const add = (/** @type {Node|null} */ node, /** @type {string} */ label) => {
      if (!node) return;
      const o = new MutationObserver(check(label));
      o.observe(node, { childList: true });
      observers.push(o);
    };
    add(document, 'document changed');
    add(document.documentElement, '<html> children changed');
    add(document.body, '<body> children changed');
  }

  // ---------------------------------------------------------------------------
  // Returning to the tab
  // ---------------------------------------------------------------------------

  function onReturn(/** @type {string} */ reason) {
    if (!ctx || retired) return;
    const other = otherRoot();
    if (other) { retire(other, reason); return; }
    if (!extensionAlive()) { noteError(new Error('runtime unavailable'), reason); return; }
    if (cardShown === 'extension') hideCard();
    if (!ensureMounted(reason)) return;
    if (!ctx.isHealthy()) {
      record(`app frame or view missing on ${reason}`, 're-rendering');
      try { ctx.rerender(); } catch (err) { Gesso.log.error('Re-render failed', err); }
      if (!ctx.isHealthy()) {
        reloadOrCard(`app still missing after re-render (${reason})`, RENDER_CARD);
        return;
      }
    }
    if (ctx.isStale()) ctx.onStale();
  }

  // ---------------------------------------------------------------------------
  // Install
  // ---------------------------------------------------------------------------

  /** @param {HealthCtx} c */
  function install(c) {
    ctx = c;
    retired = false;
    if (document.body) document.body.dataset.gessoBody = '1';
    watch();
    unlisten.splice(0).forEach((f) => f());
    const on = (/** @type {EventTarget} */ t, /** @type {string} */ type, /** @type {(e: any) => void} */ fn) => { t.addEventListener(type, fn); unlisten.push(() => t.removeEventListener(type, fn)); };
    const visible = () => document.visibilityState !== 'hidden';
    on(document, 'visibilitychange', () => { if (visible()) onReturn('visibilitychange'); });
    on(window, 'pageshow', (e) => onReturn(e.persisted ? 'pageshow (back/forward cache)' : 'pageshow'));
    on(window, 'pagehide', (e) => Gesso.log.info(`pagehide${e.persisted ? ' (may be cached)' : ''}`));
    on(window, 'focus', () => onReturn('focus'));
    on(window, 'online', () => onReturn('online'));
    on(document, 'resume', () => onReturn('resume'));
    on(document, 'freeze', () => Gesso.log.info('Page frozen by the browser'));
    on(window, 'unhandledrejection', (e) => { if (STALE_CONTEXT.test(String(e.reason?.message || e.reason || ''))) noteError(e.reason, 'unhandled rejection'); });
    on(window, 'error', (e) => { if (STALE_CONTEXT.test(String(e.message || ''))) noteError(e.error || e.message, 'error event'); });
    clearInterval(interval);
    interval = window.setInterval(() => {
      if (!ctx || retired) return;
      const other = otherRoot();
      if (other) { retire(other, 'periodic check'); return; }
      if (!ctx.host.isConnected || ctx.host.parentElement !== document.body) ensureMounted('periodic check');
    }, 3000);
  }

  /**
   * Startup counts too (called by app.js after the first paint): if it isn't
   * visible, reload once, then the card. A healthy start resets the cooldown.
   */
  async function verifyStartup() {
    if (!ctx) return;
    await afterLayout();
    if (!ctx || retired) return;
    const problems = visibilityProblems(ctx.host);
    if (problems.length) reloadOrCard(`not visible after startup (${problems.join('; ')})`, RENDER_CARD);
    else { try { sessionStorage.removeItem(RELOAD_KEY); } catch { /* ignore */ } }
  }

  const api = {
    install, ensureMounted, onReturn, noteError, extensionAlive, showCard, hideCard, record, events, clearEvents, visibilityProblems, verifyStartup,
    isRetired: () => retired,
    /** Replaceable in tests (location.reload can't be stubbed). */
    reload: (/** @type {string} */ why) => { Gesso.log.warn(`Reloading: ${why}`); location.reload(); },
    /** For tests: forget remount/reload history; optionally undo a stand-down. */
    _reset: (/** @type {{ unretire?: boolean }} */ { unretire = false } = {}) => {
      remounts = [];
      cardShown = '';
      try { sessionStorage.removeItem(RELOAD_KEY); sessionStorage.removeItem(DEAD_RELOAD_KEY); } catch { /* ignore */ }
      if (unretire && retired && ctx) { const c = ctx; retired = false; install(c); }
      else if (!retired) watch();
    },
  };
  Gesso.health = api;
})();
