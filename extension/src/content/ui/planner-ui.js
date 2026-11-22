// @ts-check
/**
 * Controls for mark done / snooze / personal to-dos. The
 * writes, and reading them back from Canvas, live in data/planner.js; this
 * file only builds buttons and dialogs.
 *
 *   rowActions(item)    snooze + done buttons for a work row or table row
 *   doneButton(item)    the check button alone
 *   snoozeLabel(item)   "Snoozed until Mon" pill text, or null
 *   openSnooze(item)    dialog: quick choices, a date, or unsnooze
 *   openTodo(note?)     dialog: add or edit a personal to-do
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const { store } = Gesso;
  const P = Gesso.planner;
  const { dayLabel, dayKey } = Gesso.time;

  /** Keys with a write in flight, so a double click doesn't send two. */
  const pending = new Set();

  /** Done because Canvas has a submission (not a checkbox the user can clear). */
  const doneBySubmission = (/** @type {any} */ item) => Gesso.derive.isDone({ ...item, markedComplete: false });

  /** "Mon, Nov 23" style label for a yyyy-mm-dd day. */
  const dayText = (/** @type {string} */ day) => dayLabel(P.dayStart(day));

  function snoozeLabel(/** @type {any} */ item, now = new Date()) {
    return P.isSnoozed(item, now) ? `Snoozed until ${dayText(item.snoozedUntil)}` : null;
  }

  /**
   * After a row disappears (marked done, snoozed), keep keyboard focus nearby:
   * the next row's done button, else the previous one's.
   */
  function keepFocusNear(/** @type {HTMLElement} */ btn) {
    const row = btn.closest('.work-row, tr');
    const list = row?.parentElement;
    if (!row || !list) return;
    const rows = [...list.children];
    const i = rows.indexOf(row);
    const keys = [...rows.slice(i + 1), ...rows.slice(0, i).reverse()]
      .map((r) => r.querySelector('[data-fkey^="done:"]')?.getAttribute('data-fkey'))
      .filter(Boolean);
    const root = /** @type {ShadowRoot|Document} */ (btn.getRootNode());
    setTimeout(() => {
      if (btn.isConnected && root.activeElement === btn) return;
      for (const k of keys) {
        const el = /** @type {HTMLElement|null} */ (root.querySelector(`[data-fkey="${CSS.escape(/** @type {string} */ (k))}"]`));
        if (el) { el.focus({ preventScroll: true }); return; }
      }
    }, 0);
  }

  async function guarded(/** @type {string} */ key, /** @type {() => Promise<any>} */ fn) {
    if (pending.has(key)) return false;
    pending.add(key);
    try { return await fn(); } finally { pending.delete(key); }
  }

  /** Mark done / not done, with an Undo toast. */
  async function toggleDone(/** @type {any} */ item, /** @type {HTMLElement} */ btn) {
    const done = !item.markedComplete;
    if (done) keepFocusNear(btn);
    const ok = await guarded(`done:${item.key}`, () => P.setDone(item, done));
    if (ok && done) {
      Gesso.overlays.toast(`Marked done in Canvas: ${item.title}`, {
        tone: 'ok',
        action: { label: 'Undo', onClick: () => guarded(`done:${item.key}`, () => P.setDone({ ...item, markedComplete: true }, false)) },
      });
    }
  }

  function doneButton(/** @type {any} */ item) {
    if (!P.target(item)) return null;
    const bySubmission = doneBySubmission(item);
    const pressed = bySubmission || !!item.markedComplete;
    const label = bySubmission ? `${item.title}: done (submitted in Canvas)` : pressed ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`;
    return h('button', {
      class: ['done-btn', pressed && 'done-btn--on'], type: 'button',
      'aria-pressed': String(pressed), 'aria-label': label, title: bySubmission ? 'Submitted in Canvas' : pressed ? 'Marked done in Canvas (click to undo)' : 'Mark done (saved to Canvas)',
      disabled: bySubmission, 'data-fkey': `done:${item.key}`,
      onClick: (/** @type {MouseEvent} */ e) => { e.preventDefault(); e.stopPropagation(); toggleDone(item, /** @type {HTMLElement} */ (e.currentTarget)); },
    }, icon(pressed ? 'checkCircle' : 'circle', { size: 18 }));
  }

  function snoozeButton(/** @type {any} */ item) {
    if (!P.linkTarget(item) || doneBySubmission(item)) return null;
    const snoozed = P.isSnoozed(item);
    return h('button', {
      class: ['btn', 'btn--ghost', 'btn--icon', 'btn--sm', 'snooze-btn', snoozed && 'snooze-btn--on'], type: 'button',
      'aria-label': snoozed ? `${item.title}: snoozed until ${dayText(item.snoozedUntil)}. Change or unsnooze` : `Snooze "${item.title}"`,
      title: snoozed ? `Snoozed until ${dayText(item.snoozedUntil)}` : 'Snooze (saved to Canvas)',
      'data-fkey': `snooze:${item.key}`,
      onClick: (/** @type {MouseEvent} */ e) => { e.preventDefault(); e.stopPropagation(); openSnooze(item); },
    }, icon('clock', { size: 15 }));
  }

  function rowActions(/** @type {any} */ item) {
    const s = snoozeButton(item);
    const d = doneButton(item);
    return (s || d) ? h('span', { class: 'row-actions' }, s, d) : null;
  }

  /** Labelled buttons for a detail view header: "Mark done" and "Snooze". */
  function detailActions(/** @type {any} */ item) {
    if (!item || !P.target(item)) return null;
    const bySubmission = doneBySubmission(item);
    const snoozed = P.isSnoozed(item);
    return h('span', { class: 'adetail__planner' },
      !bySubmission && h('button', {
        class: 'btn', type: 'button', 'aria-pressed': String(!!item.markedComplete), 'data-fkey': `done:${item.key}`,
        onClick: (/** @type {MouseEvent} */ e) => toggleDone(item, /** @type {HTMLElement} */ (e.currentTarget)),
      }, icon(item.markedComplete ? 'checkCircle' : 'circle', { size: 15 }), item.markedComplete ? 'Marked done' : 'Mark done'),
      P.linkTarget(item) && !bySubmission && h('button', {
        class: 'btn', type: 'button', 'data-fkey': `snooze:${item.key}`, onClick: () => openSnooze(item),
      }, icon('clock', { size: 15 }), snoozed ? `Snoozed until ${dayText(item.snoozedUntil)}` : 'Snooze'));
  }

  // ---------------------------------------------------------------------------
  // Snooze dialog
  // ---------------------------------------------------------------------------

  function openSnooze(/** @type {any} */ item) {
    const snoozed = P.isSnoozed(item);
    const today = dayKey(new Date());
    const error = h('p', { class: 'field__error', role: 'alert' });
    const date = /** @type {HTMLInputElement} */ (h('input', { type: 'date', class: 'field__input', id: 'snz-date', min: dayKey(Gesso.time.addDays(new Date(), 1)) }));
    date.value = snoozed ? item.snoozedUntil : '';

    const run = async (/** @type {() => Promise<boolean>} */ fn, /** @type {string} */ okText) => {
      error.textContent = '';
      dlg.el.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', ''));
      const ok = await guarded(`snooze:${item.key}`, fn);
      if (ok) {
        dlg.close();
        Gesso.overlays.toast(okText, { tone: 'ok' });
      } else {
        dlg.el.querySelectorAll('button').forEach((b) => b.removeAttribute('disabled'));
        error.textContent = "Canvas didn't confirm the change. Nothing was saved.";
      }
    };
    const snoozeTo = (/** @type {string} */ day) => run(() => P.snooze(item, day), `Snoozed until ${dayText(day)}. Saved to Canvas.`);

    const form = h('form', { class: 'form' },
      h('p', { class: 'muted' }, item.title),
      h('div', { class: 'snooze-choices' },
        P.snoozeChoices().map(([label, day]) => h('button', { class: 'btn snooze-choice', type: 'button', onClick: () => snoozeTo(day) },
          h('span', null, label), h('span', { class: 'faint' }, Gesso.time.shortDate(P.dayStart(day)))))),
      h('div', { class: 'field' },
        h('label', { class: 'field__label', for: 'snz-date' }, 'Or pick a day'),
        h('div', { class: 'snooze-date' }, date, h('button', { class: 'btn btn--primary', type: 'submit' }, 'Snooze'))),
      h('p', { class: 'field__hint' },
        "Canvas has no snooze, so this saves a planner note linked to the item on that day. Gesso hides the item until then; Canvas's planner shows the note as a reminder."),
      error,
      snoozed && h('div', { class: 'form__actions' },
        h('button', { class: 'btn', type: 'button', onClick: () => run(() => P.unsnooze(item), 'Unsnoozed. Saved to Canvas.') }, 'Unsnooze')),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!date.value || date.value <= today) { error.textContent = 'Pick a day after today.'; date.focus(); return; }
      snoozeTo(date.value);
    });
    const dlg = Gesso.overlays.dialog({ title: snoozed ? `Snoozed until ${dayText(item.snoozedUntil)}` : 'Snooze until…', body: form, class: 'dialog--narrow' });
    /** @type {HTMLElement|null} */ (form.querySelector('.snooze-choice'))?.focus();
  }

  // ---------------------------------------------------------------------------
  // To-do dialog (planner notes)
  // ---------------------------------------------------------------------------

  /**
   * Add (no item) or edit (a WorkItem of kind 'note') a personal to-do.
   * @param {any} [item]
   * @param {{ day?: string }} [opts]  date for a new to-do (default today)
   */
  function openTodo(item, { day } = {}) {
    const editing = !!item;
    const noteId = item?.plannable?.id || (item ? String(item.key).replace(/^note:/, '') : null);
    const state = store.get();
    const courses = Gesso.derive.visibleCourses(state.data, state.settings.hiddenCourses);

    const title = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input', type: 'text', id: 'todo-title', required: true, maxlength: '255' }));
    title.value = item?.title || '';
    const date = /** @type {HTMLInputElement} */ (h('input', { class: 'field__input', type: 'date', id: 'todo-date', required: true }));
    const r = item?.rawDates || {};
    date.value = item ? (P.noteDay(r.todo_date || r['plannable.todo_date'] || r.plannable_date || item.dueAt || item.staleDueAt) || '') : day || dayKey(new Date());
    const course = /** @type {HTMLSelectElement} */ (h('select', { class: 'field__input', id: 'todo-course' },
      h('option', { value: '' }, 'Personal (no course)'),
      courses.map((/** @type {any} */ c) => h('option', { value: c.id, selected: c.id === item?.courseId }, c.code ? `${c.code} — ${Gesso.derive.courseTitle(c)}` : Gesso.derive.courseTitle(c)))));
    const details = /** @type {HTMLTextAreaElement} */ (h('textarea', { class: 'field__input field__input--area', id: 'todo-details', rows: '3' }));
    details.value = item?.details || '';
    const error = h('p', { class: 'field__error', role: 'alert' });
    const save = h('button', { class: 'btn btn--primary', type: 'submit' }, editing ? 'Save' : 'Add to-do');

    const busy = (/** @type {boolean} */ on) => form.querySelectorAll('button').forEach((b) => (on ? b.setAttribute('disabled', '') : b.removeAttribute('disabled')));

    const form = h('form', { class: 'form' },
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'todo-title' }, 'Title'), title),
      h('div', { class: 'todo-row' },
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'todo-date' }, 'Date'), date),
        h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'todo-course' }, 'Course'), course)),
      h('div', { class: 'field' }, h('label', { class: 'field__label', for: 'todo-details' }, 'Notes'), details),
      h('p', { class: 'field__hint' }, "Saved to Canvas as a planner note, so it also shows in Canvas's planner and the mobile app."),
      error,
      h('div', { class: 'form__actions' },
        editing && h('button', { class: 'btn btn--ghost', type: 'button', onClick: async () => {
          busy(true);
          const ok = await guarded(`todo:${noteId}`, () => P.deleteTodo(/** @type {string} */ (noteId)));
          if (ok) { dlg.close(); Gesso.overlays.toast('To-do deleted from Canvas', { tone: 'ok' }); } else { busy(false); error.textContent = "Canvas didn't confirm the delete."; }
        } }, 'Delete'),
        h('span', { style: { flex: '1' } }),
        h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel'),
        save),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.textContent = '';
      const t = title.value.trim();
      if (!t) { error.textContent = 'Give the to-do a title.'; title.focus(); return; }
      if (!date.value) { error.textContent = 'Pick a date.'; date.focus(); return; }
      const input = { title: t, day: date.value, courseId: course.value || null, details: details.value.trim() };
      busy(true);
      const ok = editing
        ? await guarded(`todo:${noteId}`, () => P.updateTodo(/** @type {string} */ (noteId), input))
        : !!(await guarded('todo:new', () => P.createTodo(input)));
      if (ok) {
        dlg.close();
        Gesso.overlays.toast(editing ? 'To-do saved to Canvas' : 'To-do added to Canvas', { tone: 'ok' });
      } else {
        busy(false);
        error.textContent = "Canvas didn't confirm it. Nothing was saved.";
      }
    });

    const dlg = Gesso.overlays.dialog({ title: editing ? 'Edit to-do' : 'New to-do', body: form, class: 'dialog--narrow' });
    title.focus();
  }

  Gesso.plannerUi = { rowActions, detailActions, doneButton, snoozeButton, snoozeLabel, openSnooze, openTodo };
})();
