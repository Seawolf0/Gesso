// @ts-check
/**
 * Text, website-URL and file-upload submissions from Gesso.
 * Experimental: Settings → Experimental,
 * off by default, until a live submission is verified. Media and
 * annotations still go to Canvas.
 *
 * File uploads (`submitFiles`): the files are checked first (types the
 * assignment allows, not empty, total within the Files quota). Each one is
 * uploaded through the verified three-step flow (data/upload.js) with
 * progress, cancel, and one automatic retry on network or 5xx failures. Then
 * one submission POST with all `file_ids`, and the same re-read check as
 * text, which also requires the recorded attachments to be exactly the
 * uploaded files. Uploaded files keep their ids, so retrying after a failure
 * only re-sends the ones that failed.
 *
 * Nothing counts as submitted until Canvas shows it:
 *   1. GET my submission first (attempt + submitted_at before), and stop
 *      if that fails, so nothing is POSTed blind.
 *   2. POST the submission.
 *   3. GET it again and require: a submitted_at after the previous one (or a
 *      higher attempt), the submission type we sent, and the same text
 *      (compared as plain text, since Canvas sanitizes HTML) or the same URL
 *      (compared normalized, since Canvas adds http:// when there's no
 *      scheme). One retry after a second, in case of lag.
 *   If the POST worked but step 3 doesn't confirm it, the caller is told
 *   `posted: true`, so the UI can warn "check Canvas before submitting again".
 *
 * Top half pure (unit-tested), bottom half I/O.
 */
(() => {
  const SUPPORTED = /** @type {const} */ (['online_text_entry', 'online_url', 'online_upload']);

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  /**
   * Can this assignment take a text/URL submission from Gesso right now?
   * @param {any} a  assignment detail (normalize.assignmentDetail)
   * @param {any} sub  submission detail, or null
   * @returns {{ ok: boolean, types: string[], reason: string|null, attempt: number, attemptsLeft: number|null, late: boolean, group: boolean }}
   */
  function eligibility(a, sub, now = new Date()) {
    const types = (a?.submissionTypes || []).filter((/** @type {string} */ t) => /** @type {readonly string[]} */ (SUPPORTED).includes(t));
    const used = sub?.attempt ?? a?.submission?.attempt ?? 0;
    const limited = a?.allowedAttempts != null && a.allowedAttempts > 0;
    const base = { types, attempt: used + 1, attemptsLeft: limited ? Math.max(0, a.allowedAttempts - used) : null,
      late: !!(a?.dueAt && Date.parse(a.dueAt) < now.getTime()), group: !!a?.groupAssignment };
    const no = (/** @type {string} */ reason) => ({ ...base, ok: false, reason });
    if (!a || a.layout !== 'assignment') return no('Only regular assignments can be submitted here.');
    if (!types.length) return no('This assignment takes a kind of submission Gesso can’t send (media or annotation).');
    if (a.locked) return no('This assignment is locked.');
    if (a.unlockAt && Date.parse(a.unlockAt) > now.getTime()) return no('This assignment isn’t open yet.');
    if (a.lockAt && Date.parse(a.lockAt) <= now.getTime()) return no('This assignment is closed for submissions.');
    if (limited && used >= a.allowedAttempts) return no('No attempts left.');
    return { ...base, ok: true, reason: null };
  }

  const ESC = /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' });
  /** Plain text → a safe HTML snippet: blank lines make paragraphs, single newlines <br>. */
  function textToHtml(/** @type {string} */ text) {
    return String(text).trim().split(/\n\s*\n/).map((p) =>
      `<p>${p.replace(/[&<>"']/g, (c) => ESC[c]).replace(/\n/g, '<br>')}</p>`).join('');
  }

  /** Visible text of an HTML snippet, whitespace collapsed (for comparing what Canvas stored). */
  function plainText(/** @type {string|null|undefined} */ html) {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(`<body>${html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '</p>\n')}</body>`, 'text/html');
    return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** A URL as Canvas will store it: http(s) only, no scheme → http, host lowercased, no lone trailing slash. */
  function normalizeUrl(/** @type {string} */ raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `http://${s}`;
    let u;
    try { u = new URL(withScheme); } catch { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null;
    const href = u.href;
    return u.pathname === '/' && !u.search && !u.hash ? href.replace(/\/$/, '') : href;
  }

  /** Lowercased extension without the dot ('' if none). */
  const extOf = (/** @type {string} */ name) => { const m = /\.([^./\\]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; };

  /**
   * Check files before anything is uploaded.
   * @param {{ name: string, size: number }[]} files
   * @param {{ allowedExtensions?: string[] }} a
   * @param {{ quota?: number|null, used?: number|null }} [space]
   * @returns {{ ok: boolean, problems: string[], perFile: (string|null)[] }}
   */
  function checkFiles(files, a, space = {}) {
    const allowed = (a.allowedExtensions || []).map((x) => String(x).toLowerCase().replace(/^\./, '')).filter(Boolean);
    const perFile = files.map((f) => {
      if (!f.size) return 'This file is empty.';
      if (allowed.length && !allowed.includes(extOf(f.name))) return `Not an allowed type. Allowed: ${allowed.map((x) => `.${x}`).join(', ')}.`;
      return null;
    });
    const problems = [];
    if (!files.length) problems.push('Choose at least one file.');
    if (perFile.some(Boolean)) problems.push('Some files can’t be submitted (see the list).');
    const names = files.map((f) => f.name);
    if (new Set(names).size !== names.length) problems.push('Two files have the same name. Rename one first.');
    const total = files.reduce((n, f) => n + (f.size || 0), 0);
    if (space.quota != null && space.used != null && space.used + total > space.quota) {
      problems.push(`Not enough space in your Canvas files: ${fmtBytes(space.quota - space.used)} free, these files total ${fmtBytes(total)}.`);
    }
    return { ok: problems.length === 0, problems, perFile };
  }
  const fmtBytes = (/** @type {number} */ n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} bytes`);

  /**
   * Are the recorded attachments exactly the uploaded files? By id, or (if
   * Canvas copied them under new ids) by name and size.
   * @param {any[]} attachments @param {{ id: string, name: string, size: number }[]} sent
   */
  function sameFiles(attachments, sent) {
    const att = (attachments || []).map((x) => ({ id: String(x.id), name: x.display_name || x.filename, size: x.size }));
    if (att.length !== sent.length) return false;
    const ids = new Set(att.map((x) => x.id));
    if (sent.every((f) => ids.has(String(f.id)))) return true;
    const key = (/** @type {{ name: string, size: number }} */ x) => `${x.name}\u0000${x.size}`;
    const left = att.map(key).sort();
    return sent.map(key).sort().every((k, i) => k === left[i]);
  }

  /**
   * Did Canvas record what we sent?
   * @param {any} before  raw submission before the POST (or null)
   * @param {any} after   raw submission after
   * @param {{ type: string, text?: string, url?: string, files?: { id: string, name: string, size: number }[] }} sent
   * @returns {{ ok: boolean, problems: string[] }}
   */
  function confirmRecorded(before, after, sent) {
    const problems = [];
    if (!after?.submitted_at) problems.push('Canvas shows no submission time.');
    else {
      const newer = !before?.submitted_at || Date.parse(after.submitted_at) > Date.parse(before.submitted_at);
      const nextAttempt = (after.attempt ?? 0) > (before?.attempt ?? 0);
      if (!newer && !nextAttempt) problems.push(`Canvas still shows the previous submission (attempt ${before?.attempt ?? 0}, ${before?.submitted_at}).`);
    }
    if (after?.submission_type !== sent.type) problems.push(`Canvas recorded type ${JSON.stringify(after?.submission_type ?? null)}, not ${sent.type}.`);
    if (sent.type === 'online_text_entry' && plainText(after?.body) !== plainText(textToHtml(sent.text || ''))) {
      problems.push('The text Canvas stored doesn’t match what was sent.');
    }
    if (sent.type === 'online_url' && normalizeUrl(after?.url || '') !== normalizeUrl(sent.url || '')) {
      problems.push(`Canvas stored the URL ${JSON.stringify(after?.url ?? null)}.`);
    }
    if (sent.type === 'online_upload' && !sameFiles(after?.attachments, sent.files || [])) {
      const got = (after?.attachments || []).map((/** @type {any} */ x) => x.display_name || x.filename).join(', ') || 'none';
      problems.push(`Canvas shows different files on the submission (${got}).`);
    }
    return { ok: problems.length === 0, problems };
  }

  // ---------------------------------------------------------------------------
  // I/O
  // ---------------------------------------------------------------------------

  const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Submit text or a URL, then confirm Canvas recorded it.
   * @param {{ courseId: string, assignmentId: string, userId: string, type: 'online_text_entry'|'online_url', text?: string, url?: string, comment?: string }} o
   * @param {(phase: 'checking'|'submitting'|'confirming') => void} [onPhase]
   * @returns {Promise<{ ok: true, after: any } | { ok: false, posted: boolean, message: string, problems?: string[] }>}
   */
  async function submit(o, onPhase = () => {}) {
    const canvas = Gesso.api.canvas;
    const { courseId, assignmentId: aid, userId, type } = o;
    /** @type {any} */
    let before;
    onPhase('checking');
    try {
      before = await canvas.getMySubmission(courseId, aid, userId);
    } catch (err) {
      return { ok: false, posted: false, message: `Couldn’t read your current submission from Canvas, so nothing was sent: ${/** @type {any} */ (err).message}` };
    }

    /** @type {any} */
    const body = { submission: type === 'online_text_entry' ? { submission_type: type, body: textToHtml(o.text || '') } : { submission_type: type, url: normalizeUrl(o.url || '') || o.url } };
    if (o.comment && o.comment.trim()) body.comment = { text_comment: o.comment.trim() };

    onPhase('submitting');
    try {
      await canvas.submitAssignment(courseId, aid, body);
    } catch (err) {
      return { ok: false, posted: false, message: `Canvas didn’t accept the submission: ${/** @type {any} */ (err).message}` };
    }

    onPhase('confirming');
    /** @type {any} */
    let after = null;
    let check = { ok: false, problems: /** @type {string[]} */ ([]) };
    for (let i = 0; i < 2 && !check.ok; i++) {
      if (i) await sleep(1200);
      try {
        after = await canvas.getMySubmission(courseId, aid, userId);
        check = confirmRecorded(before, after, { type, text: o.text, url: o.url });
      } catch (err) {
        check = { ok: false, problems: [`Couldn’t re-read the submission: ${/** @type {any} */ (err).message}`] };
      }
    }
    if (!check.ok) return { ok: false, posted: true, message: 'Canvas accepted the request, but the submission it shows doesn’t confirm it.', problems: check.problems };

    applyToStore(courseId, aid, after);
    return { ok: true, after };
  }

  /**
   * @typedef {{ file: File|Blob, name: string, size: number, status: 'waiting'|'uploading'|'done'|'failed'|'cancelled', progress: number, id: string|null, error: string|null }} FileEntry
   */

  /** A list entry per picked file. */
  const entryFor = (/** @type {File} */ f) => /** @type {FileEntry} */ ({ file: f, name: f.name, size: f.size, status: 'waiting', progress: 0, id: null, error: null });

  /**
   * Upload the files that aren't uploaded yet, then submit them all and
   * confirm. `entries` are updated in place (call again to retry: done files
   * are skipped). Returns the same result shape as `submit`, plus
   * `stage: 'upload'` when some files failed (nothing submitted) and
   * `cancelled` on cancel.
   * @param {{ courseId: string, assignmentId: string, userId: string, entries: FileEntry[], comment?: string }} o
   * @param {{ onPhase?: (phase: 'checking'|'uploading'|'submitting'|'confirming') => void, onUpdate?: () => void, signal?: AbortSignal }} [hooks]
   * @returns {Promise<{ ok: true, after: any } | { ok: false, posted: boolean, message: string, problems?: string[], stage?: string, cancelled?: boolean }>}
   */
  async function submitFiles(o, { onPhase = () => {}, onUpdate = () => {}, signal } = {}) {
    const canvas = Gesso.api.canvas;
    const { courseId, assignmentId: aid, userId, entries } = o;
    const cancelled = () => ({ ok: /** @type {false} */ (false), posted: false, cancelled: true, message: 'Cancelled. Nothing was submitted.' });

    onPhase('checking');
    /** @type {any} */
    let before;
    try {
      before = await canvas.getMySubmission(courseId, aid, userId);
    } catch (err) {
      return { ok: false, posted: false, message: `Couldn’t read your current submission from Canvas, so nothing was sent: ${/** @type {any} */ (err).message}` };
    }

    onPhase('uploading');
    for (const e of entries) {
      if (e.status === 'done' && e.id) continue;
      if (signal?.aborted) break;
      for (let attempt = 0; attempt < 2; attempt++) {
        e.status = 'uploading'; e.progress = 0; e.error = null; onUpdate();
        try {
          const r = await Gesso.upload.uploadForSubmission(courseId, aid, e.file, e.name, {
            signal, onProgress: (loaded, total) => { e.progress = total ? loaded / total : 0; onUpdate(); },
          });
          if (Number(r.file.size) !== e.size) throw new Error(`Canvas stored ${r.file.size} bytes, the file has ${e.size}.`);
          e.id = String(r.file.id); e.status = 'done'; e.progress = 1; onUpdate();
          break;
        } catch (err) {
          const x = /** @type {any} */ (err);
          if (x?.name === 'AbortError') { e.status = 'cancelled'; e.progress = 0; onUpdate(); break; }
          const transient = x?.raw?.transient || x?.kind === 'network' || x?.kind === 'timeout' || (x?.status >= 500);
          e.status = 'failed'; e.error = x?.message || String(err); onUpdate();
          if (!transient || attempt === 1) break;
          await sleep(1500); // one automatic retry for network/5xx
        }
      }
    }
    if (signal?.aborted) {
      for (const e of entries) if (e.status === 'uploading' || e.status === 'waiting') { e.status = 'cancelled'; e.progress = 0; }
      onUpdate();
      return cancelled();
    }
    const failed = entries.filter((e) => e.status !== 'done' || !e.id);
    if (failed.length) {
      return { ok: false, posted: false, stage: 'upload', message: `${failed.length} of ${entries.length} file${entries.length === 1 ? '' : 's'} didn’t upload. Nothing was submitted.`, problems: failed.map((e) => `${e.name}: ${e.error || 'not uploaded'}`) };
    }

    /** @type {any} */
    const body = { submission: { submission_type: 'online_upload', file_ids: entries.map((e) => e.id) } };
    if (o.comment && o.comment.trim()) body.comment = { text_comment: o.comment.trim() };
    onPhase('submitting');
    try {
      await canvas.submitAssignment(courseId, aid, body);
    } catch (err) {
      return { ok: false, posted: false, message: `Canvas didn’t accept the submission: ${/** @type {any} */ (err).message}` };
    }

    onPhase('confirming');
    const sent = { type: 'online_upload', files: entries.map((e) => ({ id: /** @type {string} */ (e.id), name: e.name, size: e.size })) };
    /** @type {any} */
    let after = null;
    let check = { ok: false, problems: /** @type {string[]} */ ([]) };
    for (let i = 0; i < 2 && !check.ok; i++) {
      if (i) await sleep(1200);
      try {
        after = await canvas.getMySubmission(courseId, aid, userId);
        check = confirmRecorded(before, after, sent);
      } catch (err) {
        check = { ok: false, problems: [`Couldn’t re-read the submission: ${/** @type {any} */ (err).message}`] };
      }
    }
    if (!check.ok) return { ok: false, posted: true, message: 'Canvas accepted the request, but the submission it shows doesn’t confirm it.', problems: check.problems };
    applyToStore(courseId, aid, after);
    return { ok: true, after };
  }

  /** Free space in the user's Canvas files, or nulls if Canvas won't say. */
  async function filesSpace() {
    try {
      const q = await Gesso.api.client.get('/api/v1/users/self/files/quota');
      return { quota: q?.quota ?? null, used: q?.quota_used ?? null };
    } catch {
      return { quota: null, used: null };
    }
  }

  /** Show the new submission everywhere: the detail view refetches; the synced summary updates now. */
  function applyToStore(/** @type {string} */ courseId, /** @type {string} */ aid, /** @type {any} */ raw) {
    Gesso.resources.invalidate(`assignment:${courseId}:${aid}`);
    const s = Gesso.store.get();
    const cw = s.data.coursework?.[courseId];
    if (!cw) return;
    const N = Gesso.normalize;
    const assignments = cw.assignments.map((/** @type {any} */ a) => {
      if (a.id !== aid) return a;
      const submission = N.submission(raw);
      return { ...a, submission, status: N.deriveStatus(submission, a.submissionTypes) };
    });
    const coursework = { ...s.data.coursework, [courseId]: { ...cw, assignments } };
    Gesso.store.set({ data: { coursework } });
    Gesso.cache.save({ coursework }, s.meta);
  }

  Gesso.submit = { SUPPORTED, eligibility, textToHtml, plainText, normalizeUrl, confirmRecorded, submit, extOf, checkFiles, sameFiles, entryFor, submitFiles, filesSpace, fmtBytes };
})();
