// @ts-check
/**
 * Diagnostics page: umd.instructure.com/#/debug
 *  - load-timing breakdown of this page load
 *  - "Where does this date come from?": search work items and see which
 *    Canvas field each date came from (assignment due_at vs planner fields)
 *  - every item whose date was set aside as a past-term leftover
 *  - file upload test: personal Files only, read back, deleted
 *  - planner write test: writes a throwaway note + override to
 *    Canvas, reads each back, deletes them; optionally snoozes and unsnoozes
 *    one item the user picks
 *  - Gesso.debug.scrollAudit(): lists elements that can actually scroll
 *    (used by the dev harness to keep buttons/rows from becoming scrollers)
 */
(() => {
  const { h } = Gesso.dom;
  const ui = Gesso.ui;
  const { toDate, dueLabel } = Gesso.time;

  let query = '';

  /**
   * Everything raw shown here goes through the redactor: upload tokens,
   * download verifiers and signatures are replaced, so the page is safe to
   * screenshot or copy.
   */
  const show = (/** @type {any} */ v) => JSON.stringify(Gesso.redact.redact(v), null, 2);
  /** Raw planner records fetched on demand (not cached, never persisted). */
  let raw = /** @type {{ loading: boolean, items: any[]|null, error: string|null }} */ ({ loading: false, items: null, error: null });

  /** Planner write test state (Gesso.planner.selfTest). */
  let writeTest = /** @type {{ running: boolean, steps: any[], ok: boolean|null, snoozeKey: string }} */ ({ running: false, steps: [], ok: null, snoozeKey: '' });

  async function runWriteTest(/** @type {any} */ snoozeItem, /** @type {() => void} */ rerender) {
    writeTest = { ...writeTest, running: true, steps: [], ok: null };
    rerender();
    const result = await Gesso.planner.selfTest((steps) => { writeTest = { ...writeTest, steps }; rerender(); }, { snoozeItem });
    writeTest = { ...writeTest, running: false, ok: result.ok, steps: result.steps };
    Gesso.log.info(`Planner write test ${result.ok ? 'passed' : 'FAILED'}`, Gesso.redact.redact(result.steps));
    rerender();
  }

  function writeTestPanel(/** @type {any[]} */ items, /** @type {Map<string, any>} */ courseById, /** @type {() => void} */ rerender) {
    const P = Gesso.planner;
    const now = new Date();
    const candidates = items.filter((i) => P.linkTarget(i) && !Gesso.derive.isDone(i) && !P.isSnoozed(i, now) && i.dueAt && Gesso.time.toDate(i.dueAt).getTime() > now.getTime())
      .sort((a, b) => a.title.localeCompare(b.title));
    const snoozeItem = candidates.find((i) => i.key === writeTest.snoozeKey) || null;
    const statusIcon = (/** @type {boolean|null} */ ok) => ok == null
      ? h('span', { class: 'selftest__run' }, Gesso.icons.icon('clock', { size: 16 }))
      : h('span', { class: ok ? 'selftest__ok' : 'selftest__bad' }, Gesso.icons.icon(ok ? 'checkCircle' : 'alert', { size: 16 }));
    return ui.panel({
      title: 'Planner write test', icon: 'checkCircle',
      subtitle: 'Mark done, snooze and to-dos are saved to Canvas. This checks Canvas really stores them.',
    },
      h('p', { class: 'set-note' },
        'Creates a throwaway planner note dated today ("Gesso write test …"), edits it, marks it done and not done, and deletes it. ',
        'After every write it reads the object back from Canvas and compares. Nothing else is touched unless you pick an item below.'),
      h('div', { class: 'selftest-controls', style: { marginTop: '12px' } },
        ui.selectField({
          label: 'Also snooze one item (optional)', value: writeTest.snoozeKey, fkey: 'wt-snooze',
          options: [['', 'No, only the throwaway note'], ...candidates.map((i) => /** @type {[string, string]} */ ([i.key, `${courseById.get(i.courseId)?.code || ''} ${i.title}`.trim()]))],
          onChange: (v) => { writeTest = { ...writeTest, snoozeKey: v }; rerender(); },
        }),
        h('button', { class: 'btn btn--primary', type: 'button', disabled: writeTest.running, 'data-fkey': 'wt-run', onClick: () => runWriteTest(snoozeItem, rerender) },
          writeTest.running ? 'Running…' : 'Run write test')),
      snoozeItem && h('p', { class: 'field__hint', style: { marginTop: '8px' } },
        `Snoozes "${snoozeItem.title}" until tomorrow, reads the linked note back, then unsnoozes it and confirms it's gone. The item itself isn't changed.`),
      writeTest.steps.length > 0 && h('ol', { class: 'selftest', 'aria-live': 'polite' }, writeTest.steps.map((st) =>
        h('li', null, statusIcon(st.ok),
          h('div', null,
            h('span', null, st.label),
            h('span', { class: 'selftest__detail' }, st.detail),
            st.raw && h('details', null, h('summary', { class: 'faint' }, 'Canvas response'), h('pre', { class: 'debug-pre' }, show(st.raw))))))),
      writeTest.ok != null && h('p', { class: writeTest.ok ? 'selftest__ok' : 'selftest__bad', style: { marginTop: '12px', fontWeight: '600' } },
        writeTest.ok ? 'Passed: Canvas saved every write and returned it on read-back.' : 'Failed: see the red step. Please send a screenshot of this panel.'),
    );
  }

  /** File upload prototype state (Gesso.upload.selfTest). */
  let uploadTest = /** @type {{ running: boolean, steps: any[], ok: boolean|null, file: File|null }} */ ({ running: false, steps: [], ok: null, file: null });

  async function runUploadTest(/** @type {() => void} */ rerender) {
    uploadTest = { ...uploadTest, running: true, steps: [], ok: null };
    rerender();
    const result = await Gesso.upload.selfTest((steps) => { uploadTest = { ...uploadTest, steps }; rerender(); }, { file: uploadTest.file });
    uploadTest = { ...uploadTest, running: false, ok: result.ok, steps: result.steps };
    Gesso.log.info(`File upload test ${result.ok ? 'passed' : 'FAILED'}`, Gesso.redact.redact(result.steps));
    rerender();
  }

  function stepList(/** @type {any[]} */ steps) {
    const statusIcon = (/** @type {any} */ st) => st.ok == null
      ? h('span', { class: 'selftest__run' }, Gesso.icons.icon('clock', { size: 16 }))
      : h('span', { class: st.ok ? (st.warn ? 'selftest__warn' : 'selftest__ok') : 'selftest__bad' }, Gesso.icons.icon(st.ok ? (st.warn ? 'alert' : 'checkCircle') : 'alert', { size: 16 }));
    return h('ol', { class: 'selftest', 'aria-live': 'polite' }, steps.map((st) =>
      h('li', null, statusIcon(st),
        h('div', null,
          h('span', null, st.label),
          h('span', { class: 'selftest__detail' }, st.detail),
          st.raw && h('details', null, h('summary', { class: 'faint' }, 'Canvas response'), h('pre', { class: 'debug-pre' }, show(st.raw)))))));
  }

  function uploadTestPanel(/** @type {() => void} */ rerender) {
    const input = /** @type {HTMLInputElement} */ (h('input', { type: 'file', class: 'file-pick', id: 'up-file', 'data-fkey': 'up-file' }));
    input.addEventListener('change', () => { uploadTest = { ...uploadTest, file: input.files?.[0] || null }; rerender(); });
    return ui.panel({
      title: 'File upload test (prototype)', icon: 'upload',
      subtitle: `Uploads to your personal Files only (folder "${Gesso.upload.TEST_FOLDER}"), never to an assignment`,
    },
      h('p', { class: 'faint set-note' }, 'Upload tokens, download verifiers and signatures are shown as [redacted].'),
      h('p', { class: 'set-note' },
        'Runs Canvas’s three-step upload from this page: ask Canvas for an upload slot, send the file to the storage server, confirm with Canvas. ',
        'Then it reads the file back (name, size, folder, and the bytes if the download is readable) and deletes it. ',
        'This checks whether uploads can work from Gesso before anything is built for assignments.'),
      h('div', { class: 'selftest-controls', style: { marginTop: '12px' } },
        h('div', { class: 'field' },
          h('label', { class: 'field__label', for: 'up-file' }, 'File (optional)'),
          input,
          h('span', { class: 'field__hint' }, uploadTest.file ? `Will upload "${uploadTest.file.name}" (${ui.fileSize(uploadTest.file.size)}).` : 'Default: a small generated text file.')),
        h('button', { class: 'btn btn--primary', type: 'button', disabled: uploadTest.running, 'data-fkey': 'up-run', onClick: () => runUploadTest(rerender) },
          uploadTest.running ? 'Running…' : 'Run upload test')),
      uploadTest.steps.length > 0 && stepList(uploadTest.steps),
      uploadTest.ok != null && h('p', { class: uploadTest.ok ? 'selftest__ok' : 'selftest__bad', style: { marginTop: '12px', fontWeight: '600' } },
        uploadTest.ok ? 'Passed: the upload worked from this page and Canvas has the file you sent.' : 'Failed: see the red step. Please send a screenshot of this panel (expand "Canvas response").'));
  }

  /** Fetch the raw planner items (same window as the sync) to inspect their exact shape. */
  async function loadRaw(/** @type {() => void} */ rerender) {
    raw = { loading: true, items: null, error: null };
    rerender();
    try {
      const { addDays, startOfDay } = Gesso.time;
      const cfg = Gesso.config.sync;
      const today = startOfDay(new Date());
      const items = await Gesso.api.canvas.getPlannerItems(addDays(today, -cfg.plannerPastDays), addDays(today, cfg.plannerFutureDays));
      raw = { loading: false, items, error: null };
    } catch (err) {
      raw = { loading: false, items: null, error: /** @type {any} */ (err).message };
    }
    rerender();
  }

  /** What health.js noticed and did (kept across reloads, last 20). */
  function recoveryPanel(/** @type {() => void} */ rerender) {
    const list = Gesso.health?.events() || [];
    return ui.panel({
      title: 'Recovery log', icon: 'refresh', count: list.length || null,
      subtitle: 'When the page was replaced, the app disappeared, the extension restarted… and what Gesso did about it',
      actions: list.length > 0 && h('button', { class: 'btn btn--sm', type: 'button', 'data-fkey': 'health-clear', onClick: () => { Gesso.health.clearEvents(); rerender(); } }, 'Clear'),
    },
      list.length
        ? h('ol', { class: 'selftest' }, [...list].reverse().map((e) => h('li', null,
          h('span', { class: 'selftest__warn' }, Gesso.icons.icon('alert', { size: 16 })),
          h('div', null,
            h('span', null, e.cause),
            h('span', { class: 'selftest__detail' }, `${new Date(e.at).toLocaleString()} · ${e.action} · tab ${e.visibility}`)))))
        : h('p', { class: 'faint' }, 'Nothing so far. If the page ever goes blank or recovers by itself, the cause shows up here (and in the console, prefixed [Gesso]).'));
  }

  /** Recent render durations per route (app.js keeps the last 50). */
  function renderTimes() {
    const list = Gesso.diagnostics?.renders || [];
    if (!list.length) return null;
    /** @type {Record<string, number[]>} */
    const by = {};
    for (const r of list) (by[r.route] ||= []).push(r.ms);
    const rows = Object.entries(by).map(([route, ms]) => {
      const s = [...ms].sort((a, b) => a - b);
      return `${route.padEnd(14)} renders ${String(s.length).padStart(2)}  median ${s[Math.floor(s.length / 2)]} ms  max ${s[s.length - 1]} ms`;
    });
    return h('div', null, h('p', { class: 'faint', style: { margin: '12px 0 4px' } }, 'Render times this session (recent):'), h('pre', { class: 'debug-pre' }, rows.join('\n')));
  }

  /** Elements under `root` that the user could scroll right now. */
  function scrollAudit(/** @type {ParentNode} */ root) {
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      const canX = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
      const canY = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
      if (canX || canY) {
        out.push({
          el: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('class') ? `.${String(el.getAttribute('class')).trim().split(/\s+/).join('.')}` : ''}`,
          axis: `${canX ? 'x' : ''}${canY ? 'y' : ''}`,
        });
      }
    }
    return out;
  }

  function render(/** @type {any} */ state, /** @type {any} */ actions) {
    const { data } = state;
    const items = Gesso.derive.workItems(data);
    const courseById = new Map((data.courses || []).map((/** @type {any} */ c) => [c.id, c]));
    const q = query.trim().toLowerCase();
    const matches = q ? items.filter((i) => i.title.toLowerCase().includes(q)) : [];
    const stale = items.filter((i) => i.staleDueAt);
    const fmt = (/** @type {string|null} */ iso) => (iso ? dueLabel(/** @type {Date} */ (toDate(iso))) : '—');

    // The resolution trace (peer reviews) gets its own full-width row under the item.
    const table = (/** @type {any[]} */ list) => h('div', { class: 'table-scroll' }, h('table', { class: 'gtable debug-table' },
      h('thead', null, h('tr', null, ['Item', 'Course', 'Kind', 'Shown due', 'Past-term date', 'Date source', 'Raw Canvas date fields', 'Opens'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, list.flatMap((i) => [h('tr', null,
        h('td', null, i.title),
        h('td', null, courseById.get(i.courseId)?.code || '—'),
        h('td', null, `${i.kind} · ${i.status}`),
        h('td', { class: 'nowrap' }, fmt(i.dueAt)),
        h('td', { class: 'nowrap' }, fmt(i.staleDueAt)),
        h('td', null, i.dateSource || '— (resync needed)'),
        h('td', null, h('code', null, JSON.stringify(i.rawDates || {}))),
        h('td', null, h('code', null, Gesso.derive.itemHref(i) || '—'))),
        i.resolution && h('tr', { class: 'debug-trace-row' }, h('td', { colspan: '8' },
          h('span', { class: 'faint' }, 'Peer-review resolution:'),
          h('ol', { class: 'debug-trace' }, i.resolution.map((/** @type {string} */ line) => h('li', null, line)))))]))));

    const rawMatches = (raw.items || []).filter((/** @type {any} */ r) =>
      (q && JSON.stringify(r.plannable || {}).toLowerCase().includes(q)) || r.plannable_type === 'assessment_request');

    const timing = Gesso.diagnostics?.loadTiming;
    return h('div', { class: 'stack fade-in' },
      ui.panel({ title: 'Load timing', icon: 'clock', subtitle: 'This page load (ms)' },
        timing ? h('pre', { class: 'debug-pre' }, JSON.stringify(timing, null, 2)) : h('p', { class: 'faint' }, 'Open the dashboard with a full reload to record timing.'),
        renderTimes()),
      recoveryPanel(actions.rerender),
      ui.panel({ title: 'Where does this date come from?', icon: 'search', subtitle: 'Type part of an item name' },
        ui.searchField({ value: query, placeholder: 'e.g. Policy Brief', label: 'Find item', fkey: 'debug-q', onInput: (v) => { query = v; actions.rerender(); } }),
        q && (matches.length ? table(matches) : h('p', { class: 'faint', style: { marginTop: '12px' } }, 'No matching items.'))),
      ui.panel({
        title: 'Raw planner records', icon: 'fileText',
        subtitle: 'Exactly what Canvas returns for peer reviews (assessment_request) and items matching the search above',
        actions: h('button', { class: 'btn btn--sm', type: 'button', onClick: () => loadRaw(actions.rerender), disabled: raw.loading, 'data-fkey': 'debug-raw' }, raw.loading ? 'Loading…' : 'Fetch from Canvas'),
      },
        raw.error && h('p', { class: 'text-danger' }, raw.error),
        raw.items && (rawMatches.length
          ? rawMatches.map((/** @type {any} */ r) => h('pre', { class: 'debug-pre debug-raw' }, show(r)))
          : h('p', { class: 'faint' }, `No matching records among ${raw.items.length} planner items.`))),
      writeTestPanel(items, courseById, actions.rerender),
      uploadTestPanel(actions.rerender),
      ui.panel({ title: 'Dates set aside as past-term leftovers', icon: 'calendar', count: stale.length,
        subtitle: 'Due dates from before the course started; shown as "No current due date"' },
        stale.length ? table(stale) : h('p', { class: 'faint' }, 'None.')),
    );
  }

  Gesso.debug = { scrollAudit };
  Gesso.views = Gesso.views || {};
  Gesso.views.debug = { render };
})();
