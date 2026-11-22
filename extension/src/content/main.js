// @ts-check
/**
 * Content-script entry point (last file in manifest content_scripts).
 * Runs at document_start on every top-level Canvas page.
 *
 *   Dashboard route + Gesso mode → stop Canvas, mount the Gesso app.
 *   Anything else                 → leave Canvas alone, add the launcher.
 */
(() => {
  const bootAt = performance.now();

  if (window.top !== window.self) return; // never inside iframes
  if (location.origin !== Gesso.config.canvasOrigin) return;

  if (Gesso.takeover.shouldTakeOver()) {
    /** @type {{ host: HTMLElement, shadow: ShadowRoot }} */
    let mounted;
    try {
      mounted = Gesso.takeover.mount();
    } catch (err) {
      // Couldn't even build the document — fall back to classic for this load.
      Gesso.log.error('Takeover failed', err);
      location.replace(`${Gesso.config.canvasOrigin}/?gesso=classic`);
      return;
    }
    Gesso.app.start(mounted, { bootAt }).catch((/** @type {any} */ err) => Gesso.app.renderFatal(mounted.shadow, err));
    // Never blank: if this copy mounted but hasn't painted in 10 s (e.g. a
    // copy injected by an extension rebuild that stalls), reload once, then show
    // the startup error screen (Reload / Open Classic Canvas).
    setTimeout(() => {
      const sh = mounted.shadow;
      if (sh.querySelector('.app') || sh.querySelector('.fatal')) return;
      const KEY = 'gesso.startupReloadAt';
      let last = 0;
      try { last = Number(sessionStorage.getItem(KEY) || 0); } catch { /* ignore */ }
      if (Date.now() - last > 2 * 60_000) {
        try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ }
        Gesso.health?.record?.('nothing painted 10 s after Gesso mounted', 'reloading the page (once)');
        location.reload();
      } else {
        Gesso.health?.record?.('nothing painted 10 s after Gesso mounted, again', 'startup error screen');
        Gesso.app.renderFatal(sh, new Error('Gesso didn’t finish starting (twice in a row).'));
      }
    }, 10_000);
    return;
  }

  // Native Canvas page (or the classic dashboard).
  const onDashboard = Gesso.takeover.isDashboardRoute();
  Gesso.nativeDark.applyEarly(); // synchronous: before Canvas paints
  Gesso.settings.load().then((settings) => {
    // The localStorage mirror can be missing/stale (e.g. cleared site data).
    if (onDashboard && !Gesso.takeover.isBypassed() && settings.mode === 'gesso') {
      Gesso.settings.writeModeMirror('gesso');
      location.reload();
      return;
    }
    Gesso.settings.writeModeMirror(settings.mode);
    Gesso.settings.writeMirror('theme', settings.theme);
    Gesso.nativeDark.start(settings);
    if (settings.showLauncher) Gesso.launcher.mountWhenReady({ onDashboard });
    // Settings → "Gesso button on Canvas pages" applies to open tabs right away.
    Gesso.settings.onChange((s) => (s.showLauncher ? Gesso.launcher.mountWhenReady({ onDashboard }) : Gesso.launcher.unmount()));
  });
})();
