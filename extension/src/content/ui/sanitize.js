// @ts-check
/**
 * Allowlist HTML sanitizer for Canvas rich content (announcement bodies).
 *
 * Canvas HTML is authored by instructors and can contain anything, so it is
 * never assigned to innerHTML. Instead: parse inertly with DOMParser (no
 * scripts run, no resources load), then rebuild a clean copy element by
 * element, keeping only safe tags and attributes.
 *
 *  - Inline styles are dropped: RCE colors (black text, white backgrounds)
 *    would fight the dark theme.
 *  - Links are made absolute and open in a new tab — except links to Canvas
 *    assignments, which are rewritten to Gesso's own detail view.
 *  - Iframes from well-known media hosts (and Canvas itself) become a
 *    click-to-load placeholder: nothing third-party loads until you ask, and
 *    then in a sandboxed iframe. Other iframes become a plain link.
 *  - Canvas equation images keep a marker class so dark mode can invert them.
 *  - Unknown tags are unwrapped (their text is kept).
 */
(() => {
  const { canvasOrigin } = Gesso.config;

  const KEEP = new Set([
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'span', 'div', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'hr', 'sub', 'sup',
    'figure', 'figcaption', 'small', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  ]);
  const DROP = new Set(['script', 'style', 'noscript', 'template', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'math', 'link', 'meta', 'base']);
  /**
   * Headings are demoted so content can't outrank the app's own headings.
   * Rich content always sits under a panel's h2, so it starts at h3
   * (h1 → h4 skipped a level for screen-reader heading navigation).
   */
  const DEMOTE = /** @type {Record<string,string>} */ ({ h1: 'h3', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6', h6: 'h6' });

  /** Allow http(s)/mailto and Canvas-relative URLs only. */
  function safeUrl(/** @type {string|null} */ value, { images = false } = {}) {
    if (!value) return null;
    try {
      const u = new URL(value, canvasOrigin);
      if (u.protocol === 'https:' || u.protocol === 'http:') return u.toString();
      if (!images && u.protocol === 'mailto:') return u.toString();
    } catch { /* invalid */ }
    return null;
  }

  /** Hosts whose embeds may be loaded (on click) inside Gesso. */
  const EMBED_HOSTS = [
    /(^|\.)youtube(-nocookie)?\.com$/, /^player\.vimeo\.com$/, /(^|\.)kaltura\.com$/,
    /(^|\.)panopto\.com$/, /^docs\.google\.com$/, /^drive\.google\.com$/,
  ];

  function embeddable(/** @type {string} */ src) {
    const u = new URL(src);
    return u.protocol === 'https:' && (u.origin === canvasOrigin || EMBED_HOSTS.some((re) => re.test(u.hostname)));
  }

  /** Same-origin links to an assignment → Gesso route (opens in the same tab). */
  function gessoHref(/** @type {string} */ href) {
    const u = new URL(href);
    if (u.origin !== canvasOrigin) return null;
    const m = u.pathname.match(/^\/courses\/(\d+)\/assignments\/(\d+)\/?$/);
    return m ? `#/courses/${m[1]}/assignments/${m[2]}` : null;
  }

  /** Click-to-load embed: a button that swaps itself for a sandboxed iframe. */
  function embedPlaceholder(/** @type {string} */ src, /** @type {Element} */ original) {
    const host = new URL(src).hostname;
    const wrap = document.createElement('div');
    wrap.className = 'embed';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'embed__load';
    btn.textContent = `Load embedded content · ${host}`;
    const link = document.createElement('a');
    link.href = src; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.className = 'embed__open';
    link.textContent = 'Open in new tab';
    btn.addEventListener('click', () => {
      const frame = document.createElement('iframe');
      frame.src = src;
      frame.className = 'embed__frame';
      frame.title = original.getAttribute('title') || `Embedded content from ${host}`;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation allow-forms');
      frame.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media');
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      frame.setAttribute('allowfullscreen', '');
      btn.replaceWith(frame);
      frame.focus();
    });
    wrap.append(btn, link);
    return wrap;
  }

  /** @param {Node} node @param {Node} out */
  function copy(node, out) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        out.appendChild(document.createTextNode(child.textContent || ''));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = /** @type {Element} */ (child);
      const tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) continue;

      if (tag === 'iframe') {
        const src = safeUrl(el.getAttribute('src'));
        if (src && embeddable(src)) {
          out.appendChild(embedPlaceholder(src, el));
        } else if (src) {
          const a = document.createElement('a');
          a.href = src; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.className = 'embed-link';
          a.textContent = `Open embedded content (${new URL(src).hostname})`;
          out.appendChild(a);
        }
        continue;
      }
      if (!KEEP.has(tag)) { copy(el, out); continue; } // unwrap

      const clean = document.createElement(DEMOTE[tag] || tag);
      if (tag === 'a') {
        const href = safeUrl(el.getAttribute('href'));
        const inGesso = href && !href.startsWith('mailto:') ? gessoHref(href) : null;
        if (inGesso) {
          clean.setAttribute('href', inGesso);
        } else if (href) {
          clean.setAttribute('href', href);
          clean.setAttribute('target', '_blank');
          clean.setAttribute('rel', 'noopener noreferrer');
        }
      } else if (tag === 'img') {
        const src = safeUrl(el.getAttribute('src'), { images: true });
        if (!src) continue;
        clean.setAttribute('src', src);
        clean.setAttribute('alt', el.getAttribute('alt') || '');
        clean.setAttribute('loading', 'lazy');
        clean.setAttribute('referrerpolicy', 'no-referrer');
        if (el.classList.contains('equation_image')) clean.setAttribute('class', 'equation_image');
        const w = el.getAttribute('width');
        if (w && /^\d{1,4}$/.test(w)) clean.setAttribute('width', w);
      } else if (tag === 'td' || tag === 'th') {
        for (const attr of ['colspan', 'rowspan']) {
          const v = el.getAttribute(attr);
          if (v && /^\d{1,2}$/.test(v)) clean.setAttribute(attr, v);
        }
      }
      copy(el, clean);
      out.appendChild(clean);
    }
  }

  /**
   * @param {string} html  untrusted HTML
   * @returns {DocumentFragment}
   */
  function sanitize(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    const frag = document.createDocumentFragment();
    copy(doc.body, frag);
    return frag;
  }

  Gesso.sanitize = sanitize;
})();
