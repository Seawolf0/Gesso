// @ts-check
/**
 * Floating "Gesso" button on native Canvas pages (assignments, quizzes,
 * discussions…), in its own shadow root so it can't clash with Canvas CSS.
 * On the classic dashboard it offers to switch the dashboard back.
 */
(() => {
  const css = String.raw;

  const STYLE = css`
    /* The host itself is the fixed element (see mount()): a filter on the host,
       which dark mode applies, would otherwise become the containing block of
       a fixed child and push it off-screen. */
    :host { all: initial; position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display: block; }
    .launcher {
      display: inline-flex; align-items: center; gap: 8px;
      height: 36px; padding: 0 14px 0 10px;
      border-radius: 999px; border: 1px solid rgba(255,255,255,.08);
      background: rgba(17, 20, 26, .88); color: #e9ecf2;
      font: 600 13px/1 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
      box-shadow: 0 8px 28px rgba(0,0,0,.28);
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      cursor: pointer; opacity: .78;
      transition: opacity .15s ease, transform .15s ease;
    }
    .launcher:hover, .launcher:focus-visible { opacity: 1; transform: translateY(-1px); }
    .launcher:focus-visible { outline: 2px solid #8b9cff; outline-offset: 2px; }
    .bar { display: inline-flex; gap: 8px; }
    .dark {
      width: 36px; height: 36px; border-radius: 999px; display: grid; place-items: center;
      border: 1px solid rgba(255,255,255,.08); background: rgba(17, 20, 26, .88); color: #e9ecf2;
      box-shadow: 0 8px 28px rgba(0,0,0,.28); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
      cursor: pointer; opacity: .78; transition: opacity .15s ease, transform .15s ease;
    }
    .dark:hover, .dark:focus-visible { opacity: 1; transform: translateY(-1px); }
    .dark:focus-visible { outline: 2px solid #8b9cff; outline-offset: 2px; }
    .dark[aria-pressed="true"] { color: #8b9cff; }
    @media print { .bar { display: none; } }
    @media (prefers-reduced-motion: reduce) { .dark { transition: none; } }
    .mark { width: 20px; height: 20px; border-radius: 6px; display: grid; place-items: center; background: #8b9cff; color: #0b0d12; }
    svg { display: block; }
    @media print { .launcher { display: none; } }
    @media (prefers-reduced-motion: reduce) { .launcher { transition: none; } }
  `;

  const GRID = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg>';

  const MOON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z"/></svg>';
  const SUN = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  /** @param {{ onDashboard: boolean }} opts */
  function mount({ onDashboard }) {
    if (document.getElementById('gesso-launcher')) return;
    const host = document.createElement('div');
    host.id = 'gesso-launcher';
    Gesso.own.add(host); // ours
    // Fixed positioning lives on the host (inline, so no page stylesheet can
    // override it), never on a descendant: dark mode puts a filter on this host,
    // and a filtered ancestor captures position:fixed children (a bug found in testing).
    for (const [k, v] of [['position', 'fixed'], ['right', '18px'], ['bottom', '18px'], ['z-index', '2147483000'], ['display', 'block']]) {
      host.style.setProperty(k, v, 'important');
    }
    const shadow = host.attachShadow({ mode: 'open' });

    if ('adoptedStyleSheets' in shadow) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      shadow.adoptedStyleSheets = [sheet];
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'launcher';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.append(new DOMParser().parseFromString(GRID, 'image/svg+xml').documentElement);
    button.append(mark, document.createTextNode(onDashboard ? 'Use Gesso dashboard' : 'Gesso'));
    button.title = onDashboard ? 'Switch the Canvas dashboard to Gesso' : 'Open this page in Gesso';
    button.addEventListener('click', async () => {
      await Gesso.settings.update({ mode: 'gesso' });
      if (onDashboard) Gesso.takeover.reloadAt('/#/');
      else location.href = `${Gesso.config.canvasOrigin}/#${gessoRouteForThisPage()}`;
    });
    if (onDashboard) {
      shadow.append(button);
    } else {
      // Dark mode for this kind of page: one click flips it, per page type.
      const dark = document.createElement('button');
      dark.type = 'button';
      dark.className = 'dark';
      const label = () => {
        const on = Gesso.nativeDark.isOn();
        const type = Gesso.nativeDark.typeLabel(Gesso.nativeDark.pageType());
        dark.setAttribute('aria-pressed', String(on));
        dark.setAttribute('aria-label', `Dark mode on ${type} pages`);
        dark.title = `${on ? 'Turn off' : 'Turn on'} dark mode on ${type} pages`;
        dark.replaceChildren(new DOMParser().parseFromString(on ? MOON : SUN, 'image/svg+xml').documentElement);
      };
      label();
      dark.addEventListener('click', async () => { await Gesso.nativeDark.toggleThisPageType(); label(); });
      Gesso.settings.onChange(() => setTimeout(label, 0));
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.append(dark, button);
      shadow.append(bar);
    }
    document.body.append(host);
  }

  /**
   * Deep link to the Gesso view matching this native page. Gesso
   * resolves it with its synced data (ui/deeplink.js), e.g. a quiz URL →
   * the assignment it belongs to.
   */
  function gessoRouteForThisPage() {
    // Include the query: peer-review pages are …/assignments/:id?reviewee_id=…
    const params = new URLSearchParams({ path: location.pathname + location.search });
    // Announcements and discussions share /discussion_topics/:id URLs; Canvas's
    // breadcrumb ("… › Announcements › …") tells them apart.
    const crumb = document.querySelector('#breadcrumbs a[href$="/announcements"], nav[aria-label*="readcrumb"] a[href$="/announcements"]');
    if (crumb || /\/announcements(\/|$)/.test(location.pathname)) params.set('hint', 'announcement');
    return `/open?${params}`;
  }

  /** Mount once <body> exists. */
  function mountWhenReady(/** @type {{ onDashboard: boolean }} */ opts) {
    if (document.body) mount(opts);
    else document.addEventListener('DOMContentLoaded', () => mount(opts), { once: true });
  }

  /** Remove the launcher (Settings → launcher off, live in open tabs). */
  function unmount() {
    document.getElementById('gesso-launcher')?.remove();
  }

  Gesso.launcher = { mountWhenReady, unmount };
})();
