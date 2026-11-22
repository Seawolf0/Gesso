// @ts-check
/**
 * "Submit" dialog: text, website URL and file uploads.
 * Experimental: only offered with Settings → Experimental on. The checks
 * live in data/submit.js. This dialog:
 *   - offers the types the assignment allows (Text / Website URL / Files)
 *   - says plainly what will happen: attempt N (of M), late, group
 *   - files: checks type, emptiness, duplicate names and Files quota before
 *     uploading; shows per-file progress; Cancel stops uploads; failed files
 *     can be retried (uploaded ones aren't re-sent)
 *   - shows each phase (checking → uploading → submitting → confirming)
 *   - only says "Submitted" once the re-read submission matches
 *   - on failure says whether Canvas may have received it, and links to Canvas
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const S = Gesso.submit;

  const PHASE = {
    checking: 'Reading your current submission from Canvas…',
    uploading: 'Uploading files…',
    submitting: 'Submitting to Canvas…',
    confirming: 'Checking that Canvas recorded it…',
  };
  const TYPE_LABEL = /** @type {Record<string, string>} */ ({ online_text_entry: 'Text', online_url: 'Website URL', online_upload: 'Files' });
  const STATUS_LABEL = /** @type {Record<string, string>} */ ({ waiting: 'Waiting', uploading: 'Uploading', done: 'Uploaded', failed: 'Failed', cancelled: 'Cancelled' });

  /**
   * @param {{ course: any, a: any, sub: any, userId: string, nativeUrl: string }} o
   */
  function open({ course, a, sub, userId, nativeUrl }) {
    const el = S.eligibility(a, sub);
    if (!el.ok) { Gesso.overlays.toast(el.reason || 'Can’t submit this here.', { tone: 'danger' }); return; }
    let type = el.types[0];

    // ---- fields ---------------------------------------------------------------
    const text = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'field__input field__input--area', id: 'sub-text', rows: '8', 'aria-describedby': 'sub-text-hint' }));
    const url = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input', type: 'url', id: 'sub-url', placeholder: 'https://…', inputmode: 'url', autocomplete: 'url', spellcheck: 'false' }));
    const comment = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'field__input field__input--area', id: 'sub-comment', rows: '2' }));
    const error = h('div', { class: 'field__error', role: 'alert' });
    const status = h('p', { class: 'sub-status', role: 'status', 'aria-live': 'polite' });
    const submitBtn = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn btn--primary', type: 'submit' }));
    const closeBtn = /** @type {HTMLButtonElement} */ (h('button', { class: 'btn', type: 'button', onClick: () => (controller ? controller.abort() : dlg.close()) }, 'Cancel'));

    const textField = h('div', { class: 'field' },
      h('label', { class: 'field__label', for: 'sub-text' }, 'Your text'), text,
      h('p', { class: 'field__hint', id: 'sub-text-hint' }, 'Plain text; blank lines become paragraphs. For formatting, images or links, submit in Canvas.'));
    const urlField = h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'sub-url' }, 'Website URL'), url);

    // Files
    const allowed = (a.allowedExtensions || []).map((/** @type {string} */ x) => String(x).toLowerCase().replace(/^\./, '')).filter(Boolean);
    const picker = /** @type {HTMLInputElement} */ (h('input', {
      type: 'file', multiple: true, id: 'sub-files', class: 'file-pick', 'aria-describedby': 'sub-files-hint',
      accept: allowed.length ? allowed.map((/** @type {string} */ x) => `.${x}`).join(',') : undefined,
    }));
    /** @type {any[]} */
    let entries = [];
    /** @type {(string|null)[]} */
    let perFile = [];
    const list = h('ul', { class: 'sub-files', 'aria-label': 'Files to submit' });
    const renderList = () => {
      list.replaceChildren(...entries.map((e, i) => h('li', { class: ['sub-file', `sub-file--${e.status}`] },
        h('span', { class: 'sub-file__icon', 'aria-hidden': 'true' }, icon(e.status === 'done' ? 'checkCircle' : e.status === 'failed' ? 'alert' : 'file', { size: 16 })),
        h('span', { class: 'sub-file__main' },
          h('span', { class: 'sub-file__name' }, e.name),
          h('span', { class: 'sub-file__meta' },
            `${S.fmtBytes(e.size)} · ${STATUS_LABEL[e.status]}${e.status === 'uploading' ? ` ${Math.round(e.progress * 100)}%` : ''}`,
            perFile[i] && h('span', { class: 'sub-file__bad' }, ` · ${perFile[i]}`),
            e.status === 'failed' && e.error && h('span', { class: 'sub-file__bad' }, ` · ${e.error}`)),
          (e.status === 'uploading' || e.status === 'done') && h('span', {
            class: 'sub-file__bar', role: 'progressbar', 'aria-label': `Upload of ${e.name}`,
            'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(e.progress * 100)),
            style: { '--p': `${Math.round(e.progress * 100)}%` },
          })),
        h('button', {
          class: 'btn btn--ghost btn--icon btn--sm', type: 'button', 'aria-label': `Remove ${e.name}`, title: 'Remove',
          disabled: busy || e.status === 'done', onClick: () => { entries.splice(i, 1); perFile.splice(i, 1); renderList(); },
        }, icon('x', { size: 14 })))));
    };
    picker.addEventListener('change', () => {
      for (const f of picker.files || []) entries.push(S.entryFor(f));
      picker.value = '';
      perFile = S.checkFiles(entries, a).perFile;
      error.replaceChildren();
      renderList();
    });
    const filesField = h('div', { class: 'field' },
      h('label', { class: 'field__label', for: 'sub-files' }, 'Files'), picker, list,
      h('p', { class: 'field__hint', id: 'sub-files-hint' },
        allowed.length ? `Allowed types: ${allowed.map((/** @type {string} */ x) => `.${x}`).join(', ')}. ` : 'Any file type. ',
        'You can add several files; they’re submitted together as one attempt.'));

    const setType = (/** @type {string} */ t) => {
      type = t;
      textField.hidden = t !== 'online_text_entry';
      urlField.hidden = t !== 'online_url';
      filesField.hidden = t !== 'online_upload';
      error.textContent = '';
      (t === 'online_text_entry' ? text : t === 'online_url' ? url : picker).focus();
    };

    const facts = [
      'Experimental: not yet verified with a real Canvas submission. If in doubt, use "Submit in Canvas instead".',
      `This will be attempt ${el.attempt}${el.attemptsLeft != null ? ` (${el.attemptsLeft} left including this one)` : ''}.`,
      el.late ? 'The due date has passed: Canvas will mark it late.' : null,
      el.group ? 'Group assignment: this submits for your whole group.' : null,
      sub?.submittedAt || a.submission?.submittedAt ? 'It replaces your current submission as the latest attempt (earlier attempts stay in Canvas’s history).' : null,
    ].filter(Boolean);

    const form = h('form', { class: 'form', novalidate: true },
      h('ul', { class: 'sub-facts' }, facts.map((f) => h('li', null, f))),
      el.types.length > 1 && h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Submission type' },
        el.types.map((t) => {
          const input = /** @type {HTMLInputElement} */ (h('input', { type: 'radio', name: 'sub-type', value: t, class: 'seg__input' }));
          input.checked = t === type;
          input.addEventListener('change', () => input.checked && setType(t));
          return h('label', { class: 'seg__opt' }, input, h('span', null, TYPE_LABEL[t]));
        })),
      textField, urlField, filesField,
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'sub-comment' }, 'Comment for your instructor (optional)'), comment),
      error, status,
      h('div', { class: 'form__actions' },
        h('a', { class: 'btn btn--ghost', href: nativeUrl }, 'Submit in Canvas instead', icon('external', { size: 13 })),
        h('span', { style: { flex: '1' } }),
        closeBtn,
        submitBtn));
    const submitLabel = `Submit attempt ${el.attempt} to Canvas`;
    submitBtn.textContent = submitLabel;

    let busy = false;
    /** @type {AbortController|null} */
    let controller = null;
    /** Lock the form while working. Cancel stays live during uploads. */
    const lock = (/** @type {boolean} */ on, /** @type {boolean} */ cancellable = false) => {
      busy = on;
      form.querySelectorAll('input, textarea, button').forEach((x) => { if (x !== closeBtn) x.toggleAttribute('disabled', on); });
      closeBtn.toggleAttribute('disabled', on && !cancellable);
      closeBtn.textContent = on && cancellable ? 'Cancel upload' : 'Cancel';
      renderList();
    };

    const showDone = (/** @type {any} */ after) => {
      const at = after.submitted_at ? new Date(after.submitted_at) : null;
      const files = (after.attachments || []).map((/** @type {any} */ x) => x.display_name || x.filename);
      status.textContent = '';
      form.replaceChildren(
        h('div', { class: 'sub-done' },
          h('span', { class: 'sub-done__icon', 'aria-hidden': 'true' }, icon('checkCircle', { size: 28 })),
          h('p', { class: 'sub-done__title' }, 'Submitted. Canvas recorded it.'),
          h('p', { class: 'muted' }, `Attempt ${after.attempt ?? el.attempt}${at ? `, ${Gesso.time.dueLabel(at)}` : ''}${after.late ? ' (late)' : ''}.`),
          files.length > 0 && h('p', { class: 'muted' }, `Files: ${files.join(', ')}`),
          h('div', { class: 'form__actions' },
            h('a', { class: 'btn btn--ghost', href: nativeUrl }, 'View in Canvas', icon('external', { size: 13 })),
            h('span', { style: { flex: '1' } }),
            h('button', { class: 'btn btn--primary', type: 'button', onClick: () => dlg.close(), 'data-fkey': 'sub-close' }, 'Done'))));
      /** @type {HTMLElement|null} */ (form.querySelector('[data-fkey="sub-close"]'))?.focus();
      Gesso.overlays.toast(`Submitted: ${a.name}`, { tone: 'ok' });
    };

    const showError = (/** @type {any} */ result) => {
      status.textContent = '';
      error.replaceChildren(
        h('p', null, h('strong', null, result.message)),
        result.problems?.length ? h('ul', null, result.problems.map((/** @type {string} */ p) => h('li', null, p))) : null,
        result.cancelled
          ? h('p', null, 'Files that finished uploading stay unused in your Canvas files; they aren’t submitted.')
          : result.posted
            ? h('p', null, 'It may still have reached Canvas. ', h('a', { class: 'link', href: nativeUrl }, 'Check in Canvas'), ' before submitting again.')
            : h('p', null, result.stage === 'upload' ? 'Retry to re-send only the files that failed, or ' : 'Nothing was submitted. Try again, or ', h('a', { class: 'link', href: nativeUrl }, 'submit in Canvas'), '.'));
      submitBtn.textContent = result.stage === 'upload' ? 'Retry failed files' : submitLabel;
      if (result.posted) submitBtn.setAttribute('disabled', '');
    };

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      error.replaceChildren();

      if (type === 'online_upload') {
        for (const x of entries) if (x.status === 'cancelled') { x.status = 'waiting'; x.progress = 0; }
        status.textContent = 'Checking the files…';
        const check = S.checkFiles(entries, a, await S.filesSpace());
        perFile = check.perFile;
        if (!check.ok) { status.textContent = ''; renderList(); error.replaceChildren(...check.problems.map((p) => h('p', null, p))); picker.focus(); return; }
        controller = new AbortController();
        lock(true, true);
        const result = await S.submitFiles({ courseId: course.id, assignmentId: a.id, userId, entries, comment: comment.value }, {
          signal: controller.signal,
          onPhase: (phase) => {
            status.textContent = PHASE[phase];
            if (phase === 'submitting') lock(true, false); // past the point of cancelling
          },
          onUpdate: renderList,
        });
        controller = null;
        lock(false);
        if (result.ok) showDone(result.after); else showError(result);
        return;
      }

      /** @type {any} */
      const input = { courseId: course.id, assignmentId: a.id, userId, type, comment: comment.value };
      if (type === 'online_text_entry') {
        if (!text.value.trim()) { error.textContent = 'Write something to submit.'; text.focus(); return; }
        input.text = text.value;
      } else {
        const n = S.normalizeUrl(url.value);
        if (!n) { error.textContent = 'Enter a full website address, like https://example.com/page.'; url.focus(); return; }
        input.url = url.value;
      }
      lock(true);
      const result = await S.submit(input, (phase) => { status.textContent = PHASE[phase]; });
      lock(false);
      if (result.ok) showDone(result.after); else showError(result);
    });

    const dlg = Gesso.overlays.dialog({ title: `Submit: ${a.name}`, body: form, class: 'dialog--submit' });
    // Escape mid-submit would hide the outcome; during uploads it cancels them instead.
    dlg.el.addEventListener('cancel', (e) => {
      if (!busy) return;
      e.preventDefault();
      controller?.abort();
    });
    setType(type);
    renderList();
  }

  Gesso.submitUi = { open };
})();
