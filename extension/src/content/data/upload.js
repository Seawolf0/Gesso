// @ts-check
/**
 * File uploads, prototype. **Personal Files
 * only.** Nothing here submits to an assignment.
 *
 * Canvas's three-step upload (File Uploads API, checked 2026-11-20):
 *   1. POST /api/v1/users/self/files { name, size, content_type,
 *      parent_folder_path, on_duplicate } → { upload_url, upload_params }.
 *      The signature is valid for 30 minutes.
 *   2. POST multipart to upload_url: every upload_params field unchanged,
 *      then `file` LAST. No Authorization header. upload_url "might be …
 *      the same domain, or a Amazon S3 bucket, or some other URL". The answer
 *      is a 3XX to a Canvas `Location`, or a 201 whose `Location` gives the
 *      file JSON.
 *   3. GET that Location with the normal session → the file JSON.
 *
 * The open question this prototype answers: can the content script do
 * step 2 cross-origin from umd.instructure.com (CORS), and can it read
 * enough of the answer (body or Location) to finish step 3? Every way the
 * answer can come back is handled, in order:
 *   a. the body is the file JSON (has `id`)
 *   b. a readable Location header, or a `location` in the body → GET it
 *   c. neither readable → find the file by name in the target folder
 * Whatever path worked is reported, so the real feature can rely on it.
 *
 * Live result (ELMS, 2026-11-20): upload host
 * inst-fs-iad-prod.inscloudgate.net. The direct POST from the page works
 * (CORS allowed), and the 201 body is the file JSON (path a). Step 1 also
 * returns `file_param: "file"`, which is used as the field name.
 *
 * Transport is XMLHttpRequest, not fetch: fetch can't report upload
 * progress, and progress plus cancel are needed for assignment uploads.
 * Same CORS rules; the #/debug test uses this same path.
 *
 * `sendAndConfirm` is the reusable core. `uploadToMyFiles` (the prototype)
 * and `uploadForSubmission` (assignments, data/submit.js) only differ in
 * step 1. `selfTest` drives the prototype for #/debug and reads everything
 * back: the file JSON, its size/type/folder, and the bytes themselves when
 * the download is readable. Then it cleans up.
 */
(() => {
  const TEST_FOLDER = 'Gesso upload test';

  class UploadError extends Error {
    /** @param {string} message @param {{ stage: string, raw?: any }} info */
    constructor(message, { stage, raw }) {
      super(message);
      this.name = 'UploadError';
      this.stage = stage;
      this.raw = raw;
    }
  }

  /** SHA-256 of a Blob/ArrayBuffer as hex (crypto.subtle; the page is https). */
  async function sha256(/** @type {Blob|ArrayBuffer} */ data) {
    const buf = data instanceof Blob ? await data.arrayBuffer() : data;
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Multipart POST with progress and cancel (XMLHttpRequest).
   * Resolves for any HTTP status; rejects with stage 'upload' on a network or
   * CORS failure, and with name 'AbortError' when `signal` aborts.
   * @param {string} url @param {FormData} form
   * @param {{ withCredentials: boolean, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal }} o
   * @returns {Promise<{ status: number, text: string, location: string|null, finalUrl: string, redirected: boolean }>}
   */
  function postMultipart(url, form, { withCredentials, onProgress, signal }) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); return; }
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.withCredentials = withCredentials;
      if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
      const onAbort = () => xhr.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const done = () => signal?.removeEventListener('abort', onAbort);
      xhr.onload = () => {
        done();
        resolve({ status: xhr.status, text: xhr.responseText || '', location: xhr.getResponseHeader('Location'), finalUrl: xhr.responseURL || url, redirected: !!xhr.responseURL && xhr.responseURL !== url });
      };
      xhr.onerror = () => { done(); reject(Object.assign(new Error('Load failed'), { kind: 'network' })); };
      xhr.ontimeout = () => { done(); reject(Object.assign(new Error('Timed out'), { kind: 'timeout' })); };
      xhr.onabort = () => { done(); reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' })); };
      xhr.send(form);
    });
  }

  /**
   * Run steps 2 and 3 for a step-1 answer. Returns the file JSON and how it
   * was obtained.
   * @param {{ upload_url: string, upload_params: Record<string, string>, file_param?: string }} slot
   * @param {Blob} blob @param {string} name
   * @param {{ findByName?: () => Promise<any|null>, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal }} [opts]
   */
  async function sendAndConfirm(slot, blob, name, { findByName, onProgress, signal } = {}) {
    if (!slot?.upload_url || typeof slot.upload_params !== 'object') {
      throw new UploadError('Canvas returned no upload_url / upload_params.', { stage: 'prepare', raw: slot });
    }
    const form = new FormData();
    for (const [k, v] of Object.entries(slot.upload_params)) form.append(k, v == null ? '' : String(v));
    form.append(slot.file_param || 'file', blob, name); // must be last

    const sameOrigin = new URL(slot.upload_url, Gesso.config.canvasOrigin).origin === Gesso.config.canvasOrigin;
    let res;
    try {
      // The docs: no access token on this request. Same-origin storage (rare) still gets the session cookie.
      res = await postMultipart(slot.upload_url, form, { withCredentials: sameOrigin, onProgress, signal });
    } catch (err) {
      if (/** @type {any} */ (err)?.name === 'AbortError') throw err;
      const host = (() => { try { return new URL(slot.upload_url).host; } catch { return 'the storage server'; } })();
      throw new UploadError(`The browser couldn't send the file to ${host}: ${/** @type {any} */ (err).message}. Most likely a network problem, or the storage server doesn't allow uploads from this page (CORS).`, { stage: 'upload', raw: { transient: true } });
    }
    const { location, text } = res;
    /** @type {any} */
    let body = null;
    try { body = text ? JSON.parse(text.replace(/^while\(1\);/, '')) : null; } catch { /* not JSON */ }
    const info = { status: res.status, transport: 'XMLHttpRequest', redirected: res.redirected, finalUrl: res.finalUrl, location, body: body ?? (text ? text.slice(0, 300) : null) };
    if (res.status < 200 || res.status >= 300) throw new UploadError(`The storage server answered HTTP ${res.status}.`, { stage: 'upload', raw: { ...info, transient: res.status >= 500 } });

    // a. The answer is the file JSON already (a followed redirect to create_success, or a JSON 201).
    if (body && body.id != null && (body.display_name || body.filename)) return { file: body, via: res.redirected ? 'followed redirect → file JSON' : 'response body', upload: info };
    // b. A Location we can read → confirm with the session.
    const confirmUrl = location || body?.location || null;
    if (confirmUrl) {
      try {
        const u = new URL(confirmUrl, Gesso.config.canvasOrigin);
        if (u.origin === Gesso.config.canvasOrigin) {
          const file = await Gesso.api.client.get(u.pathname + u.search);
          return { file, via: location ? 'Location header → GET' : 'body.location → GET', upload: info };
        }
      } catch (err) {
        throw new UploadError(`Uploaded, but confirming at ${confirmUrl} failed: ${/** @type {any} */ (err).message}`, { stage: 'confirm', raw: info });
      }
    }
    // c. Nothing readable: look for the file where it should be.
    const found = findByName ? await findByName() : null;
    if (found) return { file: found, via: 'found by name in the folder (answer unreadable)', upload: info };
    throw new UploadError('The upload was sent, but the answer gave no way to confirm it and the file isn’t in the folder.', { stage: 'confirm', raw: info });
  }

  /**
   * Upload `blob` to your personal Files, in `folderPath`.
   * @param {Blob} blob @param {string} name @param {{ folderPath?: string }} [opts]
   */
  async function uploadToMyFiles(blob, name, { folderPath = TEST_FOLDER } = {}) {
    const client = Gesso.api.client;
    const slot = await client.write('POST', '/api/v1/users/self/files', {
      name, size: blob.size, content_type: blob.type || 'application/octet-stream',
      parent_folder_path: folderPath, on_duplicate: 'rename',
    });
    const findByName = async () => {
      const folder = await folderByPath(folderPath);
      if (!folder) return null;
      const files = await client.getAll(`/api/v1/folders/${encodeURIComponent(folder.id)}/files`, { search_term: name.slice(0, 50) });
      return files.find((/** @type {any} */ f) => f.display_name === name || f.filename === name) || null;
    };
    return { slot, ...(await sendAndConfirm(slot, blob, name, { findByName })) };
  }

  /**
   * Upload one file for an assignment submission (step 1 at
   * …/assignments/:aid/submissions/self/files, File Uploads API). The file
   * isn't submitted until data/submit.js POSTs its id. Canvas keeps such
   * uploads with the user's submission files.
   * @param {string} courseId @param {string} assignmentId @param {File|Blob} blob @param {string} name
   * @param {{ onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal }} [opts]
   */
  async function uploadForSubmission(courseId, assignmentId, blob, name, { onProgress, signal } = {}) {
    const slot = await Gesso.api.client.write('POST', `/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submissions/self/files`, {
      name, size: blob.size, content_type: blob.type || 'application/octet-stream',
    });
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
    return { slot, ...(await sendAndConfirm(slot, blob, name, { onProgress, signal })) };
  }

  /** The folder at `path` in your personal Files (null if missing). */
  async function folderByPath(/** @type {string} */ path) {
    try {
      const chain = await Gesso.api.client.getAll(`/api/v1/users/self/folders/by_path/${path.split('/').map(encodeURIComponent).join('/')}`);
      return chain[chain.length - 1] || null;
    } catch (err) {
      if (/** @type {any} */ (err)?.kind === 'not_found') return null;
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // #/debug self-test
  // ---------------------------------------------------------------------------

  /**
   * Upload one file to personal Files, read everything back, then delete it.
   * @param {(steps: any[]) => void} onProgress
   * @param {{ file?: File|null }} [opts]  a file the user picked; default: a small generated text file
   */
  async function selfTest(onProgress, { file = null } = {}) {
    const client = Gesso.api.client;
    /** @type {{ label: string, ok: boolean|null, detail: string, raw?: any, warn?: boolean }[]} */
    const steps = [];
    const step = async (/** @type {string} */ label, /** @type {() => Promise<{ detail: string, raw?: any, warn?: boolean }>} */ fn) => {
      const s = /** @type {any} */ ({ label, ok: null, detail: 'running…' });
      steps.push(s);
      onProgress([...steps]);
      try { Object.assign(s, await fn(), { ok: true }); }
      catch (err) { Object.assign(s, { ok: false, detail: /** @type {any} */ (err).message, raw: /** @type {any} */ (err).raw }); throw err; }
      finally { onProgress([...steps]); }
    };

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blob = file || new Blob([`Gesso upload test, ${new Date().toString()}\nSafe to delete.\n`], { type: 'text/plain' });
    const name = file ? `${stamp} ${file.name}` : `gesso-upload-test-${stamp}.txt`;
    const localHash = await sha256(blob);
    /** @type {any} */ let uploaded = null;
    /** @type {any} */ let folder = null;

    try {
      await step('Check your Files quota (GET users/self/files/quota)', async () => {
        const q = await client.get('/api/v1/users/self/files/quota');
        const free = (q.quota ?? 0) - (q.quota_used ?? 0);
        if (q.quota != null && free < blob.size) throw new Error(`Not enough space: ${free} bytes free, the file is ${blob.size}.`);
        return { detail: q.quota != null ? `${Math.round((q.quota_used || 0) / 1e6)} MB of ${Math.round(q.quota / 1e6)} MB used` : 'quota not reported', raw: q };
      });
      await step(`Upload "${name}" (${blob.size} bytes) to Files › ${TEST_FOLDER}`, async () => {
        uploaded = await uploadToMyFiles(blob, name);
        return { detail: `file id ${uploaded.file.id}; upload host ${new URL(uploaded.slot.upload_url).host}; confirmed via: ${uploaded.via}`, raw: { step1: uploaded.slot, step2: uploaded.upload, step3: uploaded.file } };
      });
      await step('Read the file back (GET files/:id)', async () => {
        const f = await client.get(`/api/v1/files/${encodeURIComponent(uploaded.file.id)}`);
        folder = await folderByPath(TEST_FOLDER);
        const problems = [];
        if (f.size !== blob.size) problems.push(`size ${f.size}, expected ${blob.size}`);
        if (f.display_name !== name && f.filename !== name) problems.push(`name ${JSON.stringify(f.display_name)}, expected ${JSON.stringify(name)}`);
        if (folder && String(f.folder_id) !== String(folder.id)) problems.push(`folder ${f.folder_id}, expected ${folder.id} (${TEST_FOLDER})`);
        if (problems.length) throw new Error(`Canvas has a different file: ${problems.join('; ')}.`);
        return { detail: `${f.display_name}, ${f.size} bytes, ${f['content-type'] || 'no type'}, in ${TEST_FOLDER}`, raw: f };
      });
      await step('Download it and compare the bytes (SHA-256)', async () => {
        try {
          const res = await fetch(uploaded.file.url || `${Gesso.config.canvasOrigin}/files/${uploaded.file.id}/download?download_frd=1`, { credentials: 'include', cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const remote = await sha256(await res.arrayBuffer());
          if (remote !== localHash) throw Object.assign(new Error(`The downloaded file differs (SHA-256 ${remote.slice(0, 12)}…, expected ${localHash.slice(0, 12)}…).`), { fatal: true });
          return { detail: `identical (SHA-256 ${localHash.slice(0, 16)}…)` };
        } catch (err) {
          if (/** @type {any} */ (err).fatal) throw err;
          // Downloads redirect to a storage host; reading it may be blocked (CORS). That isn't an upload failure.
          return { detail: `skipped: couldn't read the download (${/** @type {any} */ (err).message}). Size and name were confirmed above.`, warn: true };
        }
      });
      await step('Delete the test file and confirm it is gone', async () => {
        await client.write('DELETE', `/api/v1/files/${encodeURIComponent(uploaded.file.id)}`);
        let after = null;
        try { after = await client.get(`/api/v1/files/${encodeURIComponent(uploaded.file.id)}`); } catch (err) { if (/** @type {any} */ (err).kind !== 'not_found' && /** @type {any} */ (err).kind !== 'forbidden') throw err; }
        if (after && after.workflow_state !== 'deleted' && !after.deleted) throw new Error('Canvas still lists the file after DELETE.');
        uploaded = { ...uploaded, deleted: true };
        return { detail: after ? 'marked deleted' : 'gone (404)', raw: after };
      });
      await step(`Remove the empty "${TEST_FOLDER}" folder`, async () => {
        const f = folder || await folderByPath(TEST_FOLDER);
        if (!f) return { detail: 'no folder left' };
        try {
          await client.write('DELETE', `/api/v1/folders/${encodeURIComponent(f.id)}`);
          return { detail: 'removed' };
        } catch (err) {
          return { detail: `left in place (${/** @type {any} */ (err).message}). It's empty; delete it from Files if you like.`, warn: true };
        }
      });
      return { ok: true, steps };
    } catch {
      if (uploaded?.file?.id && !uploaded.deleted) {
        try { await client.write('DELETE', `/api/v1/files/${encodeURIComponent(uploaded.file.id)}`); steps.push({ label: 'Cleanup', ok: true, detail: 'Deleted the uploaded test file.' }); }
        catch { steps.push({ label: 'Cleanup', ok: false, detail: `Couldn't delete "${name}". Remove it from Files › ${TEST_FOLDER}.` }); }
        onProgress([...steps]);
      }
      return { ok: false, steps };
    }
  }

  Gesso.upload = { TEST_FOLDER, postMultipart, sendAndConfirm, uploadToMyFiles, uploadForSubmission, folderByPath, selfTest, sha256, UploadError };
})();
