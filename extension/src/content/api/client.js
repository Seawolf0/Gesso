// @ts-check
/**
 * Low-level Canvas REST client. Runs in the content script, so requests are
 * same-origin and authenticated by the existing Canvas session cookie.
 *
 * Responsibilities:
 *  - URL building (array params as `key[]=a&key[]=b`)
 *  - Pagination: follows the `Link: <…>; rel="next"` header (URLs are opaque)
 *  - Throttling: a small request queue whose concurrency adapts to
 *    `X-Rate-Limit-Remaining`; 429 → exponential backoff + retry
 *  - CSRF: write requests send `X-CSRF-Token` from the `_csrf_token` cookie
 *  - Errors normalized into `CanvasApiError` with a `kind` the UI can branch on
 *
 * Docs: https://canvas.instructure.com/doc/api/file.pagination.html
 *       https://canvas.instructure.com/doc/api/file.throttling.html
 */
(() => {
  const { canvasOrigin, api: cfg } = Gesso.config;

  /**
   * `Accept: application/json` stops Canvas from prefixing JSON with `while(1);`.
   * The `+canvas-string-ids` variant returns every id as a string so large
   * (sharded) ids never lose precision as JS numbers.
   */
  const ACCEPT = 'application/json+canvas-string-ids, application/json';

  /** @typedef {'auth'|'forbidden'|'not_found'|'rate_limit'|'network'|'timeout'|'http'|'parse'} ErrorKind */

  class CanvasApiError extends Error {
    /**
     * @param {string} message
     * @param {{ kind: ErrorKind, status?: number, url?: string }} info
     */
    constructor(message, { kind, status = 0, url = '' }) {
      super(message);
      this.name = 'CanvasApiError';
      this.kind = kind;
      this.status = status;
      this.url = url;
    }
  }

  // ---------------------------------------------------------------------------
  // Request queue / throttle
  // ---------------------------------------------------------------------------

  /** @type {Array<() => void>} */
  const waiting = [];
  let active = 0;
  let concurrency = cfg.maxConcurrent;
  /** Extra delay between request starts when the bucket is nearly empty. */
  let spacingMs = 0;
  let lastStart = 0;
  /** Latest observed X-Rate-Limit-Remaining (for debugging / UI). */
  let lastRemaining = /** @type {number|null} */ (null);

  /** Run `task` when a slot is free. */
  function schedule(/** @type {() => Promise<any>} */ task) {
    return new Promise((resolve, reject) => {
      const start = async () => {
        active++;
        const wait = Math.max(0, lastStart + spacingMs - Date.now());
        if (wait) await sleep(wait);
        lastStart = Date.now();
        try {
          resolve(await task());
        } catch (err) {
          reject(err);
        } finally {
          active--;
          pump();
        }
      };
      waiting.push(start);
      pump();
    });
  }

  function pump() {
    while (active < concurrency && waiting.length) {
      const next = /** @type {() => void} */ (waiting.shift());
      next();
    }
  }

  /** Adapt concurrency/spacing to the remaining quota Canvas reports. */
  function observeRateLimit(/** @type {Headers} */ headers) {
    const raw = headers.get('X-Rate-Limit-Remaining');
    if (raw == null) return; // header only present when throttling applies
    const remaining = parseFloat(raw);
    if (Number.isNaN(remaining)) return;
    lastRemaining = remaining;
    if (remaining < cfg.criticalWaterMark) {
      concurrency = 1;
      spacingMs = 1500;
    } else if (remaining < cfg.lowWaterMark) {
      concurrency = 1;
      spacingMs = 250;
    } else {
      concurrency = cfg.maxConcurrent;
      spacingMs = 0;
    }
  }

  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Build an absolute API URL. Params ending in `[]` may be arrays.
   * @param {string} path  e.g. "/api/v1/courses"
   * @param {Record<string, string|number|boolean|Array<string|number>|undefined|null>} [params]
   */
  function buildUrl(path, params = {}) {
    const url = new URL(path, canvasOrigin);
    for (const [key, value] of Object.entries(params)) {
      if (value == null) continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
      else url.searchParams.append(key, String(value));
    }
    return url.toString();
  }

  /** Parse an RFC 5988 Link header into { next: url, … }. */
  function parseLinkHeader(/** @type {string|null} */ header) {
    /** @type {Record<string, string>} */
    const links = {};
    if (!header) return links;
    for (const part of header.split(',')) {
      const m = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/i);
      if (m) links[m[2].trim().toLowerCase()] = m[1];
    }
    return links;
  }

  /** The CSRF token Canvas expects on non-GET requests (cookie is URL-encoded). */
  function csrfToken() {
    const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  /** Never follow pagination links off the Canvas origin. */
  function assertSameOrigin(/** @type {string} */ url) {
    if (new URL(url).origin !== canvasOrigin) {
      throw new CanvasApiError(`Refusing cross-origin request: ${url}`, { kind: 'http', url });
    }
  }

  // ---------------------------------------------------------------------------
  // Core request
  // ---------------------------------------------------------------------------

  /**
   * One HTTP request with retries. Returns { data, headers }.
   * @param {string} url absolute URL
   * @param {{ method?: string, body?: any }} [opts]
   */
  async function request(url, { method = 'GET', body } = {}) {
    assertSameOrigin(url);
    /** @type {Record<string,string>} */
    const headers = { Accept: ACCEPT };
    if (method !== 'GET') {
      const token = csrfToken();
      if (token) headers['X-CSRF-Token'] = token;
      if (body !== undefined) headers['Content-Type'] = 'application/json';
    }

    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        // The timeout starts when the request leaves the queue, not while it waits.
        res = await schedule(async () => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
          try {
            return await fetch(url, {
              method,
              headers,
              body: body === undefined ? undefined : JSON.stringify(body),
              credentials: 'include',
              cache: 'no-store',
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(timer);
          }
        });
      } catch (err) {
        const timedOut = /** @type {any} */ (err)?.name === 'AbortError';
        if (attempt < 1) { await sleep(800); continue; } // one retry for flaky networks
        throw new CanvasApiError(timedOut ? 'Canvas took too long to respond.' : 'Network error — are you offline?', {
          kind: timedOut ? 'timeout' : 'network', url,
        });
      }
      observeRateLimit(res.headers);

      // Throttled. Canvas documents 429; older instances used 403 + "Rate Limit Exceeded".
      const throttled = res.status === 429 || (res.status === 403 && (await peekText(res)).includes('Rate Limit Exceeded'));
      if (throttled) {
        if (attempt >= cfg.maxRetries) {
          throw new CanvasApiError('Canvas is rate-limiting requests. Try again in a minute.', { kind: 'rate_limit', status: res.status, url });
        }
        concurrency = 1;
        await sleep(1000 * 2 ** attempt + Math.random() * 400);
        continue;
      }

      if (res.status === 401) {
        // Canvas uses 401 for two different things: no session
        // ({"status":"unauthenticated"}) and "you may not see this"
        // ({"status":"unauthorized"}, e.g. a course with Files turned off).
        const body = await peekText(res);
        if (/"status"\s*:\s*"unauthorized"|not authorized/i.test(body)) {
          throw new CanvasApiError("You don't have access to this in Canvas.", { kind: 'forbidden', status: 401, url });
        }
        throw new CanvasApiError("You're logged out of Canvas.", { kind: 'auth', status: 401, url });
      }
      if (res.status === 403) throw new CanvasApiError('Canvas denied access to this resource.', { kind: 'forbidden', status: 403, url });
      if (res.status === 404) throw new CanvasApiError('Not found.', { kind: 'not_found', status: 404, url });
      if (res.status >= 500 && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      if (!res.ok) {
        // Canvas usually explains a 400/422 ({"errors":[{"message":…}]} or {"message":…}); pass that on.
        const detail = canvasErrorMessage(await peekText(res));
        throw new CanvasApiError(`Canvas returned HTTP ${res.status}${detail ? `: ${detail}` : '.'}`, { kind: 'http', status: res.status, url });
      }

      // A login redirect lands on an HTML page with 200 — treat as logged out.
      const type = res.headers.get('Content-Type') || '';
      if (res.redirected && !type.includes('json')) {
        throw new CanvasApiError("You're logged out of Canvas.", { kind: 'auth', status: res.status, url });
      }
      if (res.status === 204) return { data: null, headers: res.headers };

      const text = await res.text();
      try {
        return { data: text ? JSON.parse(text.replace(/^while\(1\);/, '')) : null, headers: res.headers };
      } catch {
        throw new CanvasApiError('Canvas sent a response we could not read.', { kind: 'parse', status: res.status, url });
      }
    }
  }

  /** The human-readable message in a Canvas error body, if any (max 200 chars). */
  function canvasErrorMessage(/** @type {string} */ text) {
    try {
      const j = JSON.parse(text.replace(/^while\(1\);/, ''));
      const errs = j?.errors;
      const msg = typeof j?.message === 'string' ? j.message
        : Array.isArray(errs) ? errs.map((/** @type {any} */ e) => e?.message).filter(Boolean).join('; ')
          : errs && typeof errs === 'object' ? Object.values(errs).flat().map((/** @type {any} */ e) => e?.message || e).filter((x) => typeof x === 'string').join('; ')
            : '';
      return msg ? String(msg).slice(0, 200) : '';
    } catch {
      return '';
    }
  }

  /** Read a response body without consuming the original (for 403 sniffing). */
  async function peekText(/** @type {Response} */ res) {
    try { return await res.clone().text(); } catch { return ''; }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** In-flight GET de-duplication: identical concurrent GETs share one request. */
  const inflight = new Map();

  /** GET a single (non-paginated) resource. */
  function get(/** @type {string} */ path, /** @type {any} */ params) {
    const url = buildUrl(path, params);
    if (inflight.has(url)) return inflight.get(url);
    const p = request(url).then((r) => r.data).finally(() => inflight.delete(url));
    inflight.set(url, p);
    return p;
  }

  /**
   * GET every page of a paginated collection and return one array.
   * `per_page` defaults to config (100); Canvas may silently cap it lower,
   * which is fine because we always follow `rel="next"`.
   */
  async function getAll(/** @type {string} */ path, /** @type {any} */ params = {}) {
    let url = buildUrl(path, { per_page: cfg.perPage, ...params });
    const out = [];
    for (let page = 0; url && page < cfg.maxPages; page++) {
      const { data, headers } = await request(url);
      if (Array.isArray(data)) out.push(...data);
      else if (data) out.push(data);
      url = parseLinkHeader(headers.get('Link')).next || '';
    }
    return out;
  }

  /** POST/PUT/DELETE with CSRF. `body` is sent as JSON. */
  function write(/** @type {'POST'|'PUT'|'DELETE'} */ method, /** @type {string} */ path, /** @type {any} */ body) {
    return request(buildUrl(path), { method, body }).then((r) => r.data);
  }

  Gesso.api = Gesso.api || {};
  Gesso.api.client = {
    CanvasApiError, buildUrl, parseLinkHeader, csrfToken, canvasErrorMessage,
    get, getAll, write,
    /** Diagnostics for the UI / console. */
    stats: () => ({ active, queued: waiting.length, concurrency, spacingMs, lastRemaining }),
  };
})();
