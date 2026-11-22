// @ts-check
/**
 * Mark done, snooze and personal to-dos, stored in Canvas itself:
 *
 *   done      a planner override (`marked_complete`) on the item. It's the
 *             same checkbox as Canvas's planner and the mobile apps.
 *   snooze    Canvas has no snooze. A snooze is a planner note *linked* to
 *             the item (linked_object_type/id), dated the day the item comes
 *             back, with details starting with SNOOZE_MARK. Gesso hides
 *             the item until that day. Canvas's planner shows the note on that
 *             day as a reminder that links to the item. Unsnooze deletes it.
 *   to-dos    plain planner notes (title, date, optional course, details).
 *
 * Every write is **read back** from Canvas before the UI treats it as saved:
 * POST/PUT, then GET the same object and compare the fields that matter.
 * A mismatch or error reverts the optimistic change and shows a toast.
 *
 * The top half is pure (targets, matching, dates) and unit-tested. The bottom
 * half does the I/O.
 */
(() => {
  const { store } = Gesso;
  const { toDate, startOfDay, dayKey, addDays } = Gesso.time;

  // ---------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------

  /** Object types a planner note may link to (Planner API, POST planner_notes). */
  const LINKABLE = new Set(['assignment', 'quiz', 'discussion_topic', 'wiki_page', 'announcement']);

  /**
   * The planner object Canvas tracks "done" on, for a WorkItem.
   * Prefer the planner's own record (exact type + id). Without one (an
   * assignment outside the planner window) use what Canvas's planner would
   * use: a classic quiz's quiz id, a graded discussion's topic id, otherwise
   * the assignment id.
   * @returns {{ type: string, id: string }|null}
   */
  function target(/** @type {any} */ item) {
    if (item.plannable?.type && item.plannable?.id) return { type: item.plannable.type, id: String(item.plannable.id) };
    if (item.kind === 'quiz' && item.quizId) return { type: 'quiz', id: item.quizId };
    if (item.kind === 'discussion' && item.discussionId) return { type: 'discussion_topic', id: item.discussionId };
    if (item.assignmentId) return { type: 'assignment', id: item.assignmentId };
    return null;
  }

  /**
   * What a snooze note links to, or null when the item can't be snoozed:
   * notes and peer reviews (a peer review links to the classmate's work, not
   * a linkable object), and anything without a course.
   * @returns {{ type: string, id: string }|null}
   */
  function linkTarget(/** @type {any} */ item) {
    if (!item.courseId || item.kind === 'note' || item.kind === 'peer_review') return null;
    const t = target(item);
    if (!t) return null;
    if (LINKABLE.has(t.type)) return t;
    // Checkpoints (sub_assignment) can't be linked; their assignment can.
    if (t.type === 'sub_assignment' && item.assignmentId) return { type: 'assignment', id: item.assignmentId };
    return null;
  }

  const keyOf = (/** @type {{ type: string, id: string }} */ t) => `${t.type}:${t.id}`;

  /** Live overrides by `${type}:${plannableId}`, plus `assignment_id:${id}` as a fallback. */
  function overrideIndex(/** @type {any[]|null|undefined} */ overrides) {
    /** @type {Map<string, any>} */
    const map = new Map();
    for (const o of overrides || []) {
      if (o.deleted) continue;
      map.set(`${o.type}:${o.plannableId}`, o);
      if (o.assignmentId && !map.has(`assignment_id:${o.assignmentId}`)) map.set(`assignment_id:${o.assignmentId}`, o);
    }
    return map;
  }

  /** The override for an item: exact plannable first, then by assignment id. */
  function overrideFor(/** @type {any} */ item, /** @type {Map<string, any>} */ index) {
    const t = target(item);
    return (t && index.get(keyOf(t))) || (item.assignmentId && index.get(`assignment_id:${item.assignmentId}`)) || null;
  }

  /** Live snooze notes by the `${type}:${id}` they link to. */
  function snoozeIndex(/** @type {any[]|null|undefined} */ notes) {
    /** @type {Map<string, any>} */
    const map = new Map();
    for (const n of notes || []) if (n.snooze && n.linked && !n.deleted) map.set(keyOf(n.linked), n);
    return map;
  }

  function snoozeFor(/** @type {any} */ item, /** @type {Map<string, any>} */ index) {
    const t = linkTarget(item);
    return (t && index.get(keyOf(t))) || null;
  }

  /**
   * The calendar day of a note's todo_date (yyyy-mm-dd). We send a plain
   * date; Canvas stores a time. Midnight UTC means "a date with no time"
   * (take the UTC date, or the day shifts west of Greenwich); any other time
   * is a real moment in the user's time zone.
   */
  function noteDay(/** @type {string|null|undefined} */ iso) {
    if (!iso) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    if (/T00:00(:00(\.0+)?)?(Z|\+00:00)$/.test(iso)) return iso.slice(0, 10);
    const d = toDate(iso);
    return d ? dayKey(d) : null;
  }

  /** Local midnight at the start of a yyyy-mm-dd day. */
  function dayStart(/** @type {string} */ day) {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /** Is the item hidden by a snooze right now? */
  function isSnoozed(/** @type {any} */ item, now = new Date()) {
    return !!item.snoozedUntil && now.getTime() < dayStart(item.snoozedUntil).getTime();
  }

  /** Quick snooze choices relative to `now`: [label, yyyy-mm-dd]. */
  function snoozeChoices(now = new Date()) {
    const today = startOfDay(now);
    const monday = addDays(today, ((8 - today.getDay()) % 7) || 7);
    const all = /** @type {[string, string][]} */ ([
      ['Tomorrow', dayKey(addDays(today, 1))],
      ['In 2 days', dayKey(addDays(today, 2))],
      ['In 3 days', dayKey(addDays(today, 3))],
      ['Next Monday', dayKey(monday)],
      ['In a week', dayKey(addDays(today, 7))],
    ]);
    // Drop a choice that lands on the same day as an earlier one (e.g. on a Friday, "In 3 days" = "Next Monday").
    const seen = new Set();
    return all.filter(([, day]) => !seen.has(day) && seen.add(day));
  }

  // ---------------------------------------------------------------------------
  // Read-back checks
  // ---------------------------------------------------------------------------

  class NotSavedError extends Error {
    constructor(/** @type {string} */ message) {
      super(message);
      this.name = 'NotSavedError';
    }
  }

  /**
   * Compare what Canvas returned with what we asked for.
   * @param {string} what  e.g. "override 123"
   * @param {[string, any, any][]} checks  [field, actual, expected]
   */
  function expectSaved(what, checks) {
    const bad = checks.filter(([, actual, expected]) => actual !== expected);
    if (bad.length) {
      throw new NotSavedError(`Canvas didn't save ${what}: ${bad.map(([f, a, e]) => `${f} is ${JSON.stringify(a)}, expected ${JSON.stringify(e)}`).join('; ')}.`);
    }
  }

  /** GET an object that should be gone. Not found, or workflow_state "deleted", passes. */
  async function expectGone(/** @type {string} */ what, /** @type {() => Promise<any>} */ fetcher) {
    try {
      const raw = await fetcher();
      if (raw && raw.workflow_state !== 'deleted' && !raw.deleted_at) throw new NotSavedError(`Canvas still has ${what} (workflow_state ${JSON.stringify(raw.workflow_state)}).`);
      return raw;
    } catch (err) {
      if (/** @type {any} */ (err)?.kind === 'not_found') return null;
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Store + cache
  // ---------------------------------------------------------------------------

  function saveDatasets(/** @type {Record<string, any>} */ datasets) {
    store.set({ data: datasets });
    Gesso.cache.save(datasets, store.get().meta);
  }

  /** Replace (or add) one override in the store; `null` removes the one with `removeId`. */
  function putOverride(/** @type {any|null} */ o, /** @type {string|null} */ removeId = null) {
    const list = (store.get().data.overrides || []).filter((/** @type {any} */ x) =>
      x.id !== removeId && !(o && (x.id === o.id || (x.type === o.type && x.plannableId === o.plannableId))));
    saveDatasets({ overrides: o ? [...list, o] : list });
  }

  /** Replace (or add) one note in the store; `null` removes the one with `removeId`. */
  function putNote(/** @type {any|null} */ n, /** @type {string|null} */ removeId = null) {
    const list = (store.get().data.notes || []).filter((/** @type {any} */ x) => x.id !== removeId && x.id !== n?.id);
    // A note also lives in the planner dataset (from planner/items); keep it in step.
    const planner = (store.get().data.planner || []).filter((/** @type {any} */ p) => !(p.type === 'note' && (p.id === removeId || p.id === n?.id)));
    saveDatasets({ notes: n ? [...list, n] : list, planner });
  }

  /** Run an optimistic write: apply, run, and on any failure revert + toast. */
  async function optimistic(/** @type {() => void} */ apply, /** @type {() => void} */ revert, /** @type {() => Promise<void>} */ run, /** @type {string} */ failLabel) {
    apply();
    try {
      await run();
      return true;
    } catch (err) {
      revert();
      Gesso.log.error(failLabel, err);
      Gesso.overlays?.toast(`${failLabel}: ${/** @type {any} */ (err).message}`, { tone: 'danger' });
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Mark done
  // ---------------------------------------------------------------------------

  /**
   * Write `marked_complete` for an item, then read the override back.
   * @returns {Promise<boolean>} true when Canvas confirmed it
   */
  async function setDone(/** @type {any} */ item, /** @type {boolean} */ done) {
    const canvas = Gesso.api.canvas;
    const t = target(item);
    if (!t) {
      Gesso.overlays?.toast("Canvas can't track done for this item.", { tone: 'danger' });
      return false;
    }
    const before = store.get().data.overrides || [];
    let existing = overrideFor(item, overrideIndex(before));
    const placeholder = { id: existing?.id || `pending:${keyOf(t)}`, type: t.type, plannableId: t.id, assignmentId: item.assignmentId || null, done, dismissed: !!existing?.dismissed, deleted: false };

    return optimistic(
      () => putOverride(placeholder),
      () => saveDatasets({ overrides: before }),
      async () => {
        // The list may be missing or stale (sync failed, another device): ask Canvas before creating a duplicate.
        if (!existing) existing = overrideFor(item, overrideIndex((await canvas.getPlannerOverrides()).map(Gesso.normalize.override)));
        const res = existing
          ? await canvas.updatePlannerOverride(existing.id, { marked_complete: done })
          : await canvas.createPlannerOverride({ plannable_type: t.type, plannable_id: t.id, marked_complete: done });
        const id = String(res?.id ?? existing?.id ?? '');
        if (!id) throw new NotSavedError('Canvas returned no override id.');
        const saved = Gesso.normalize.override(await canvas.getPlannerOverride(id));
        expectSaved(`override ${id}`, [['marked_complete', saved.done, done], ['deleted', saved.deleted, false]]);
        if (!existing) expectSaved(`override ${id}`, [['plannable', keyOf({ type: saved.type, id: saved.plannableId }), keyOf(t)]]);
        putOverride(saved, placeholder.id);
      },
      done ? "Couldn't mark done in Canvas" : "Couldn't mark not done in Canvas",
    );
  }

  // ---------------------------------------------------------------------------
  // Snooze
  // ---------------------------------------------------------------------------

  const SNOOZE_DETAILS = `${Gesso.normalize.SNOOZE_MARK} Hidden in Gesso until this date. Delete this note to unsnooze.`;

  /**
   * Snooze an item until `day` (yyyy-mm-dd): create or move its linked note,
   * then read the note back.
   */
  async function snooze(/** @type {any} */ item, /** @type {string} */ day) {
    const canvas = Gesso.api.canvas;
    const link = linkTarget(item);
    if (!link) {
      Gesso.overlays?.toast("This item can't be snoozed (Canvas can't link a note to it).", { tone: 'danger' });
      return false;
    }
    const before = store.get().data.notes || [];
    let existing = snoozeFor(item, snoozeIndex(before));
    const placeholder = { id: existing?.id || `pending:${keyOf(link)}`, title: item.title, details: SNOOZE_DETAILS, courseId: item.courseId, todoDate: day, linked: { ...link, url: null }, snooze: true, deleted: false };

    return optimistic(
      () => putNote(placeholder),
      () => saveDatasets({ notes: before }),
      async () => {
        let res;
        if (existing) {
          res = await canvas.updatePlannerNote(existing.id, { todo_date: day });
        } else {
          try {
            res = await canvas.createPlannerNote({
              todo_date: day, course_id: item.courseId, details: SNOOZE_DETAILS,
              linked_object_type: link.type, linked_object_id: link.id, // title omitted → Canvas uses the item's
            });
          } catch (err) {
            // Only one note may link to an object. An older snooze outside the synced range? Find it and move it.
            if (/** @type {any} */ (err)?.kind !== 'http') throw err;
            const found = await findLinkedNote(link);
            if (!found) throw err;
            if (!found.snooze) throw new Error(`This item already has a planner note in Canvas ("${found.title}"), and Canvas allows only one.`);
            existing = found;
            res = await canvas.updatePlannerNote(found.id, { todo_date: day });
          }
        }
        const id = String(res?.id ?? existing?.id ?? '');
        if (!id) throw new NotSavedError('Canvas returned no note id.');
        const saved = Gesso.normalize.plannerNote(await canvas.getPlannerNote(id));
        expectSaved(`note ${id}`, [
          ['todo_date', noteDay(saved.todoDate), day],
          ['linked object', saved.linked && keyOf(saved.linked), keyOf(link)],
          ['snooze marker', saved.snooze, true],
          ['deleted', saved.deleted, false],
        ]);
        putNote(saved, placeholder.id);
      },
      "Couldn't snooze in Canvas",
    );
  }

  /** Search notes in a wide range for one linked to `link`. */
  async function findLinkedNote(/** @type {{ type: string, id: string }} */ link) {
    const s = store.get();
    const today = startOfDay(new Date());
    const codes = [`user_${s.data.user?.id}`, ...(s.data.courses || []).map((/** @type {any} */ c) => `course_${c.id}`)];
    const notes = (await Gesso.api.canvas.getPlannerNotes(addDays(today, -730), addDays(today, 730), codes)).map(Gesso.normalize.plannerNote);
    return notes.find((n) => n.linked && keyOf(n.linked) === keyOf(link) && !n.deleted) || null;
  }

  /** Remove an item's snooze: delete its note, then confirm Canvas no longer has it. */
  async function unsnooze(/** @type {any} */ item) {
    const canvas = Gesso.api.canvas;
    const before = store.get().data.notes || [];
    const existing = snoozeFor(item, snoozeIndex(before));
    if (!existing) return true;
    return optimistic(
      () => putNote(null, existing.id),
      () => saveDatasets({ notes: before }),
      async () => {
        if (existing.id.startsWith('pending:')) throw new Error('The snooze is still being saved. Try again in a moment.');
        await canvas.deletePlannerNote(existing.id);
        await expectGone(`note ${existing.id}`, () => canvas.getPlannerNote(existing.id));
      },
      "Couldn't unsnooze in Canvas",
    );
  }

  // ---------------------------------------------------------------------------
  // Personal to-dos (planner notes)
  // ---------------------------------------------------------------------------

  /**
   * Create a to-do, then read it back.
   * @param {{ title: string, day: string, courseId?: string|null, details?: string }} o
   * @returns {Promise<any|null>} the saved note, or null on failure
   */
  async function createTodo({ title, day, courseId = null, details = '' }) {
    const canvas = Gesso.api.canvas;
    const before = store.get().data.notes || [];
    const placeholder = { id: `pending:${Date.now()}`, title, details: details || null, courseId, todoDate: day, linked: null, snooze: false, deleted: false };
    /** @type {any} */
    let saved = null;
    const ok = await optimistic(
      () => putNote(placeholder),
      () => saveDatasets({ notes: before }),
      async () => {
        /** @type {any} */
        const body = { title, todo_date: day, details };
        if (courseId) body.course_id = courseId;
        const res = await canvas.createPlannerNote(body);
        if (res?.id == null) throw new NotSavedError('Canvas returned no note id.');
        saved = Gesso.normalize.plannerNote(await canvas.getPlannerNote(String(res.id)));
        expectSaved(`note ${saved.id}`, [
          ['title', saved.title, title], ['todo_date', noteDay(saved.todoDate), day],
          ['course', saved.courseId, courseId || null], ['deleted', saved.deleted, false],
        ]);
        putNote(saved, placeholder.id);
      },
      "Couldn't add the to-do in Canvas",
    );
    return ok ? saved : null;
  }

  /**
   * Edit a to-do, then read it back.
   * @param {string} id
   * @param {{ title: string, day: string, courseId?: string|null, details?: string }} o
   */
  async function updateTodo(id, { title, day, courseId = null, details = '' }) {
    const canvas = Gesso.api.canvas;
    const before = store.get().data.notes || [];
    const beforePlanner = store.get().data.planner || [];
    const old = before.find((/** @type {any} */ n) => n.id === id) || noteFromPlanner(id);
    const next = { ...(old || { id, linked: null, snooze: false, deleted: false }), title, details: details || null, courseId, todoDate: day };
    return optimistic(
      () => putNote(next),
      () => saveDatasets({ notes: before, planner: beforePlanner }),
      async () => {
        // An empty course_id takes the note out of its course (Planner API).
        await canvas.updatePlannerNote(id, { title, todo_date: day, details, course_id: courseId || '' });
        const saved = Gesso.normalize.plannerNote(await canvas.getPlannerNote(id));
        expectSaved(`note ${id}`, [
          ['title', saved.title, title], ['todo_date', noteDay(saved.todoDate), day],
          ['course', saved.courseId, courseId || null], ['deleted', saved.deleted, false],
        ]);
        putNote(saved);
      },
      "Couldn't save the to-do in Canvas",
    );
  }

  /** Delete a to-do, then confirm Canvas no longer has it. */
  async function deleteTodo(/** @type {string} */ id) {
    const canvas = Gesso.api.canvas;
    const before = store.get().data.notes || [];
    const beforePlanner = store.get().data.planner || [];
    return optimistic(
      () => putNote(null, id),
      () => saveDatasets({ notes: before, planner: beforePlanner }),
      async () => {
        await canvas.deletePlannerNote(id);
        await expectGone(`note ${id}`, () => canvas.getPlannerNote(id));
      },
      "Couldn't delete the to-do in Canvas",
    );
  }

  /** A note known only from planner/items, as a PlannerNote. */
  function noteFromPlanner(/** @type {string} */ id) {
    const p = (store.get().data.planner || []).find((/** @type {any} */ x) => x.type === 'note' && x.id === id);
    return p ? { id, title: p.title, details: p.details, courseId: p.courseId, todoDate: p.date, linked: null, snooze: !!p.snooze, deleted: false } : null;
  }

  // ---------------------------------------------------------------------------
  // Write-and-read-back self-test (#/debug). Touches only a throwaway note it
  // creates and deletes; optionally snoozes one item the user picks and
  // unsnoozes it again.
  // ---------------------------------------------------------------------------

  /**
   * @typedef {{ label: string, ok: boolean|null, detail: string, raw?: any }} TestStep
   * @param {(steps: TestStep[]) => void} onProgress
   * @param {{ snoozeItem?: any }} [opts]
   */
  async function selfTest(onProgress, { snoozeItem } = {}) {
    const canvas = Gesso.api.canvas;
    /** @type {TestStep[]} */
    const steps = [];
    const step = async (/** @type {string} */ label, /** @type {() => Promise<{ detail: string, raw?: any }>} */ fn) => {
      const s = /** @type {TestStep} */ ({ label, ok: null, detail: 'running…' });
      steps.push(s);
      onProgress([...steps]);
      try {
        Object.assign(s, await fn(), { ok: true });
      } catch (err) {
        Object.assign(s, { ok: false, detail: /** @type {any} */ (err).message, raw: /** @type {any} */ (err).raw });
        throw err;
      } finally {
        onProgress([...steps]);
      }
    };

    const today = dayKey(new Date());
    const tomorrow = dayKey(addDays(startOfDay(new Date()), 1));
    const title = `Gesso write test ${new Date().toLocaleTimeString()}`;
    /** @type {string|null} */ let noteId = null;
    /** @type {string|null} */ let overrideId = null;
    /** @type {string|null} */ let snoozeId = null;

    try {
      await step('Create a planner note (POST planner_notes)', async () => {
        const res = await canvas.createPlannerNote({ title, todo_date: today, details: 'Created by the Gesso #/debug write test. It deletes itself; safe to delete.' });
        noteId = String(res.id);
        return { detail: `id ${noteId}`, raw: res };
      });
      await step('Read the note back (GET planner_notes/:id)', async () => {
        const raw = await canvas.getPlannerNote(/** @type {string} */ (noteId));
        const n = Gesso.normalize.plannerNote(raw);
        expectSaved(`note ${noteId}`, [['title', n.title, title], ['todo_date', noteDay(n.todoDate), today]]);
        return { detail: `title and date match (todo_date ${raw.todo_date})`, raw };
      });
      await step('Edit the note and read it back (PUT)', async () => {
        await canvas.updatePlannerNote(/** @type {string} */ (noteId), { title: `${title} (edited)`, todo_date: tomorrow });
        const raw = await canvas.getPlannerNote(/** @type {string} */ (noteId));
        const n = Gesso.normalize.plannerNote(raw);
        expectSaved(`note ${noteId}`, [['title', n.title, `${title} (edited)`], ['todo_date', noteDay(n.todoDate), tomorrow]]);
        return { detail: 'new title and date saved', raw };
      });
      await step('Mark the note done (POST planner/overrides)', async () => {
        const res = await canvas.createPlannerOverride({ plannable_type: 'planner_note', plannable_id: /** @type {string} */ (noteId), marked_complete: true });
        overrideId = String(res.id);
        return { detail: `override id ${overrideId}`, raw: res };
      });
      await step('Read the override back (GET planner/overrides/:id)', async () => {
        const raw = await canvas.getPlannerOverride(/** @type {string} */ (overrideId));
        const o = Gesso.normalize.override(raw);
        expectSaved(`override ${overrideId}`, [['marked_complete', o.done, true], ['plannable', `${o.type}:${o.plannableId}`, `planner_note:${noteId}`]]);
        return { detail: `marked_complete true on planner_note ${noteId} (Canvas says plannable_type ${JSON.stringify(raw.plannable_type)})`, raw };
      });
      await step('Mark it not done and read it back (PUT)', async () => {
        await canvas.updatePlannerOverride(/** @type {string} */ (overrideId), { marked_complete: false });
        const raw = await canvas.getPlannerOverride(/** @type {string} */ (overrideId));
        expectSaved(`override ${overrideId}`, [['marked_complete', Gesso.normalize.override(raw).done, false]]);
        return { detail: 'marked_complete false', raw };
      });
      await step('The planner list shows the override', async () => {
        const list = (await canvas.getPlannerOverrides()).map(Gesso.normalize.override);
        const o = list.find((x) => x.id === overrideId);
        if (!o) throw new NotSavedError(`override ${overrideId} is missing from GET planner/overrides (${list.length} listed).`);
        return { detail: `found among ${list.length} overrides` };
      });

      if (snoozeItem) {
        const link = linkTarget(snoozeItem);
        await step(`Snooze "${snoozeItem.title}" until tomorrow (linked note)`, async () => {
          if (!link) throw new Error('This item can\'t be snoozed.');
          if (snoozeFor(snoozeItem, snoozeIndex(store.get().data.notes))) throw new Error('This item is already snoozed; pick another or unsnooze it first.');
          const res = await canvas.createPlannerNote({ todo_date: tomorrow, course_id: snoozeItem.courseId, details: SNOOZE_DETAILS, linked_object_type: link.type, linked_object_id: link.id });
          snoozeId = String(res.id);
          return { detail: `note id ${snoozeId}`, raw: res };
        });
        await step('Read the snooze note back', async () => {
          const raw = await canvas.getPlannerNote(/** @type {string} */ (snoozeId));
          const n = Gesso.normalize.plannerNote(raw);
          expectSaved(`note ${snoozeId}`, [['todo_date', noteDay(n.todoDate), tomorrow], ['linked object', n.linked && keyOf(n.linked), keyOf(/** @type {any} */ (link))], ['snooze marker', n.snooze, true]]);
          return { detail: `linked to ${keyOf(/** @type {any} */ (link))}, title ${JSON.stringify(n.title)}`, raw };
        });
        await step('Unsnooze (DELETE) and confirm it is gone', async () => {
          await canvas.deletePlannerNote(/** @type {string} */ (snoozeId));
          const raw = await expectGone(`note ${snoozeId}`, () => canvas.getPlannerNote(/** @type {string} */ (snoozeId)));
          snoozeId = null;
          return { detail: raw ? 'workflow_state "deleted"' : '404 Not Found', raw };
        });
      }

      await step('Delete the override and confirm it is gone', async () => {
        await canvas.deletePlannerOverride(/** @type {string} */ (overrideId));
        const raw = await expectGone(`override ${overrideId}`, () => canvas.getPlannerOverride(/** @type {string} */ (overrideId)));
        overrideId = null;
        return { detail: raw ? 'workflow_state "deleted"' : '404 Not Found', raw };
      });
      await step('Delete the note and confirm it is gone', async () => {
        await canvas.deletePlannerNote(/** @type {string} */ (noteId));
        const raw = await expectGone(`note ${noteId}`, () => canvas.getPlannerNote(/** @type {string} */ (noteId)));
        noteId = null;
        return { detail: raw ? 'workflow_state "deleted"' : '404 Not Found', raw };
      });
      return { ok: true, steps };
    } catch {
      // Best-effort cleanup of whatever the test created.
      /** @type {string[]} */
      const left = [];
      for (const [id, del, what] of /** @type {[string|null, (id: string) => Promise<any>, string][]} */ ([
        [snoozeId, canvas.deletePlannerNote, 'snooze note'], [overrideId, canvas.deletePlannerOverride, 'override'], [noteId, canvas.deletePlannerNote, 'test note'],
      ])) {
        if (!id) continue;
        try { await del(id); } catch { left.push(`${what} ${id}`); }
      }
      steps.push({ label: 'Cleanup', ok: !left.length, detail: left.length ? `Couldn't delete: ${left.join(', ')}. Delete them in Canvas's planner.` : 'Removed what the test created.' });
      onProgress([...steps]);
      return { ok: false, steps };
    }
  }

  Gesso.planner = {
    // pure
    target, linkTarget, overrideIndex, overrideFor, snoozeIndex, snoozeFor, noteDay, dayStart, isSnoozed, snoozeChoices, expectSaved,
    // writes
    setDone, snooze, unsnooze, createTodo, updateTodo, deleteTodo, selfTest,
    NotSavedError,
  };
})();
