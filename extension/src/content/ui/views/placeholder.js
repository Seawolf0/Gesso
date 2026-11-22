// @ts-check
/**
 * Stand-ins for views built in later phases. Each one still links to the
 * matching native Canvas page so nothing is a dead end.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const { panel } = Gesso.ui;
  const origin = Gesso.config.canvasOrigin;

  const PLANNED = /** @type {Record<string, { title: string, phase: number, blurb: string, native: [string, string][] }>} */ ({
  });

  function nativeLink(/** @type {string} */ label, /** @type {string} */ path) {
    return h('a', { class: 'btn', href: `${origin}${path}` }, label, icon('external', { size: 14 }));
  }

  /** Generic "coming in phase N" view. */
  function render(/** @type {string} */ name) {
    const p = PLANNED[name];
    if (!p) {
      return h('div', { class: 'placeholder fade-in' },
        h('h1', null, 'Page not found'),
        h('p', null, "That view doesn't exist."),
        h('a', { class: 'btn btn--primary', href: '#/' }, 'Back to dashboard'),
      );
    }
    return h('div', { class: 'placeholder fade-in' },
      h('h1', null, p.title),
      h('p', null, `${p.blurb} Coming in Phase ${p.phase}.`),
      p.native.length > 0 && panel({ title: 'Meanwhile, in classic Canvas' },
        h('div', { class: 'quick-links' }, p.native.map(([label, path]) => nativeLink(label, path)))),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.placeholder = { render };
})();
