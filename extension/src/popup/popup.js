// @ts-check
/**
 * Toolbar popup. Reads two storage keys and renders; no network
 * (only the Canvas tab talks to Canvas):
 *   popup.summary  written by the Canvas tab after each sync (content/data/summary.js)
 *   settings       for the theme (shared/themes.js; loaded before this file)
 *   theme.image    the custom theme's background image (its thumbnail), if any
 *
 * Links open in an existing Gesso tab when there is one (a Canvas tab at
 * "/"), otherwise in a new tab. Native Canvas tabs are never navigated away.
 */
(() => {
  const api = /** @type {any} */ (globalThis).browser || /** @type {any} */ (globalThis).chrome;
  const app = /** @type {HTMLElement} */ (document.getElementById('app'));
  const HOUR = 3_600_000;

  /** Tiny element builder: text is always inserted as text. */
  function h(/** @type {string} */ tag, /** @type {any} */ props, /** @type {any[]} */ ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style.setProperty(p, String(val));
      else el.setAttribute(k, String(v));
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** The four-square mark, built with DOM calls (no innerHTML). */
  function gridIcon() {
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of Object.entries({ width: '14', height: '14', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'aria-hidden': 'true', class: 'svg' })) svg.setAttribute(k, v);
    for (const [x, y] of [[3.5, 3.5], [13.5, 3.5], [3.5, 13.5], [13.5, 13.5]]) {
      const r = document.createElementNS(SVG_NS, 'rect');
      for (const [k, v] of Object.entries({ x, y, width: 7, height: 7, rx: 1.5 })) r.setAttribute(k, String(v));
      svg.append(r);
    }
    return svg;
  }

  // ---- formatting -----------------------------------------------------------

  const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const startOfDay = (/** @type {Date} */ d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

  function whenText(/** @type {Date} */ due, /** @type {Date} */ now) {
    const days = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / (24 * HOUR));
    const day = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : fmtDay.format(due);
    return `${day}, ${fmtTime.format(due)}`;
  }

  function countdown(/** @type {Date} */ due, /** @type {Date} */ now) {
    const ms = due.getTime() - now.getTime();
    const hrs = ms / HOUR;
    const text = hrs < 1 ? `${Math.max(1, Math.round(ms / 60000))}m` : hrs < 48 ? `${Math.round(hrs)}h` : `${Math.round(hrs / 24)}d`;
    return { text, tone: hrs < 24 ? 'critical' : hrs < 48 ? 'high' : '' };
  }

  function ago(/** @type {number} */ t, /** @type {number} */ now) {
    const m = Math.round((now - t) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const hr = Math.round(m / 60);
    return hr < 48 ? `${hr}h ago` : `${Math.round(hr / 24)}d ago`;
  }

  // ---- theme ---------------------------------------------------------------

  const T = /** @type {any} */ (globalThis).Gesso.themes;
  /** The last theme applied, kept in the popup's own localStorage so the next open paints it at once. */
  const PAINT_KEY = 'gesso.popupPaint';
  const THUMB = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

  /** Tokens → custom properties. The popup's page color is the app's sidebar tone (--bg-elev). */
  function paint(/** @type {any} */ t) {
    const root = document.documentElement;
    root.setAttribute('data-theme', t.scheme);
    root.style.setProperty('color-scheme', t.scheme);
    for (const k of ['surface', 'surface-2', 'surface-3', 'border', 'border-strong', 'text', 'text-2', 'text-3',
      'danger', 'danger-soft', 'warn', 'warn-soft', 'accent', 'accent-fg', 'accent-text', 'focus']) root.style.setProperty(`--${k}`, t[k]);
    root.style.setProperty('--bg', t['bg-elev']);
  }
  try { const cached = T.readPaintRecord(localStorage.getItem(PAINT_KEY)); if (cached) paint(cached); } catch { /* no cache yet */ }

  /** Settings as the app reads them (Gesso.settings.normalize, minus what the popup doesn't use). */
  function themeSettings(/** @type {any} */ raw) {
    const s = { ...(raw || {}) };
    if (raw && !('themeId' in raw) && String(s.accent).toLowerCase() === '#8b9cff') s.accent = '';
    if (s.themeId === 'custom' && !T.validCustom(s.customTheme ?? null)) s.themeId = 'gesso';
    return s;
  }

  /** @param {any} settings @param {any} image  storage `theme.image` */
  function applyTheme(settings, image) {
    const s = themeSettings(settings);
    const t = T.resolve(s);
    paint(t);
    try { localStorage.setItem(PAINT_KEY, T.paintRecord(t, s)); } catch { /* fine */ }
    // The custom theme's image, dimmed exactly as in the app.
    const img = T.activeId(s) === 'custom' ? s.customTheme?.image : null;
    const thumb = img && image && image.id === img.id ? image.thumb : null;
    if (thumb && THUMB.test(thumb)) {
      const dim = Math.max((img.dim || 0) / 100, T.requiredDim(img.samples, t));
      const veil = T.color.rgba(t['bg-elev'], Math.max(dim, 0.3));
      document.body.style.setProperty('background', `linear-gradient(${veil}, ${veil}), url("${thumb}") center / cover no-repeat`);
      document.body.style.setProperty('background-color', t['bg-elev']);
    } else {
      document.body.style.removeProperty('background');
      document.body.style.removeProperty('background-color');
    }
  }

  // ---- navigation -----------------------------------------------------------

  /** Open `url` in the Gesso tab if one exists, else a new tab; then close the popup. */
  async function openUrl(/** @type {string} */ url) {
    try {
      const origin = new URL(url).origin;
      const tabs = await api.tabs.query({ url: `${origin}/*` });
      const existing = (tabs || []).find((/** @type {any} */ t) => { try { return new URL(t.url).pathname === '/'; } catch { return false; } });
      if (existing) {
        await api.tabs.update(existing.id, { url, active: true });
        try { await api.windows.update(existing.windowId, { focused: true }); } catch { /* not supported: fine */ }
      } else {
        await api.tabs.create({ url });
      }
    } catch {
      await api.tabs.create({ url });
    }
    window.close();
  }

  const link = (/** @type {string} */ url, /** @type {any} */ props, /** @type {any[]} */ ...children) =>
    h('a', { href: url, ...props, onClick: (/** @type {MouseEvent} */ e) => { e.preventDefault(); openUrl(url); } }, ...children);

  // ---- render ---------------------------------------------------------------

  /** @param {any} summary @param {any} settings @param {string} origin @param {any} [image] */
  function render(summary, settings, origin, image) {
    const now = new Date();
    applyTheme(settings, image);

    const home = `${origin}/`;
    const items = (summary?.items || []).filter((/** @type {any} */ i) => Date.parse(i.dueAt) >= now.getTime());
    const in48 = items.filter((/** @type {any} */ i) => Date.parse(i.dueAt) < now.getTime() + 48 * HOUR).length;
    const next = items.slice(0, 5);
    const stale = summary?.syncedAt && now.getTime() - summary.syncedAt > 6 * HOUR;

    const head = h('header', { class: 'head' },
      h('span', { class: 'mark', 'aria-hidden': 'true' }, gridIcon()),
      h('div', { class: 'head__text' },
        h('div', { class: 'head__title' }, 'Gesso'),
        h('div', { class: 'head__sub' }, summary?.user || new URL(origin).host)),
      link(home, { class: 'btn btn--primary' }, 'Open'));

    if (!summary) {
      app.replaceChildren(head, h('div', { class: 'empty' },
        h('strong', null, 'Nothing loaded yet'),
        'Open Canvas once while logged in. Gesso saves your upcoming work here.'),
      footer(origin, null));
      return;
    }

    const notes = [];
    if (summary.loggedOut) notes.push(h('p', { class: 'note note--warn' }, h('strong', null, "You're logged out of Canvas"), 'Log in on Canvas to refresh. This list is from the last sync.'));
    else if (stale) notes.push(h('p', { class: 'note' }, h('strong', null, `Last synced ${ago(summary.syncedAt, now.getTime())}`), 'Open Canvas to refresh.'));

    const stats = h('div', { class: 'summary' },
      link(`${origin}/#/assignments`, { class: `stat${in48 ? ' stat--warn' : ''}`, 'aria-label': `${in48} due in the next 48 hours. Open Assignments` },
        h('span', { class: 'stat__n' }, String(in48)), h('span', { class: 'stat__l' }, 'Due in', h('br', null), '48 hours')),
      link(`${origin}/#/assignments?range=overdue`, { class: `stat${summary.overdue ? ' stat--danger' : ''}`, 'aria-label': `${summary.overdue} overdue. Open overdue work` },
        h('span', { class: 'stat__n' }, String(summary.overdue || 0)), h('span', { class: 'stat__l' }, 'Overdue')));

    const list = next.length
      ? [h('div', { class: 'label', id: 'next-label' }, 'Next up'),
        h('ul', { class: 'list', 'aria-labelledby': 'next-label' }, next.map((/** @type {any} */ i) => {
          const due = new Date(i.dueAt);
          const cd = countdown(due, now);
          return h('li', null, link(i.url || home, { class: 'item', style: { '--c': i.color || 'var(--text-3)' } },
            h('span', { class: 'item__bar', 'aria-hidden': 'true' }),
            h('span', { class: 'item__main' },
              h('span', { class: 'item__title', style: { display: 'block' } }, i.title),
              h('span', { class: 'item__meta', style: { display: 'block' } }, `${i.course} · ${whenText(due, now)}${i.points != null ? ` · ${i.points} pts` : ''}`)),
            h('span', { class: `pill${cd.tone ? ` pill--${cd.tone}` : ''}`, 'aria-label': `due in ${cd.text}` }, cd.text)));
        }))]
      : [h('div', { class: 'empty' }, h('strong', null, 'Nothing due in the next two weeks'), 'Enjoy it. Done and snoozed items are left out.')];

    app.replaceChildren(head, ...notes, stats, ...list, footer(origin, summary));
  }

  function footer(/** @type {string} */ origin, /** @type {any} */ summary) {
    return h('footer', { class: 'foot' },
      link(`${origin}/#/assignments`, { class: 'foot__link' }, 'Assignments'),
      link(`${origin}/#/calendar`, { class: 'foot__link' }, 'Calendar'),
      link(`${origin}/#/grades`, { class: 'foot__link' }, 'Grades'),
      h('span', { class: 'foot__spacer' }),
      summary?.syncedAt && h('span', { class: 'foot__sync', title: new Date(summary.syncedAt).toLocaleString() }, `Synced ${ago(summary.syncedAt, Date.now())}`));
  }

  async function load() {
    const pattern = (api.runtime.getManifest().host_permissions || [])[0] || 'https://umd.instructure.com/*';
    const origin = pattern.replace(/\/\*$/, '');
    const got = await api.storage.local.get(['popup.summary', 'settings']);
    const image = got.settings?.themeId === 'custom' && got.settings?.customTheme?.image ? (await api.storage.local.get('theme.image'))['theme.image'] : null;
    render(got['popup.summary'] || null, got.settings || null, got['popup.summary']?.origin || origin, image);
  }

  load();
  // A sync finishing while the popup is open updates it in place.
  api.storage.onChanged.addListener((/** @type {any} */ changes, /** @type {string} */ area) => {
    if (area === 'local' && (changes['popup.summary'] || changes.settings || changes['theme.image'])) load();
  });
  // Backup for the storage event: a Canvas tab that changed settings pings the popup.
  api.runtime.onMessage?.addListener((/** @type {any} */ msg) => { if (msg && msg.t === 'gesso:settings') load(); });
  // Exposed for the dev preview.
  /** @type {any} */ (window).__popup = { render, countdown, whenText };
})();
