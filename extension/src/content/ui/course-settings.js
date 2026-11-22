// @ts-check
/**
 * Per-course settings: nickname, color, hidden, and dashboard order.
 *
 * Nickname, color, and order are saved to Canvas itself (course_nicknames,
 * users/self/colors, dashboard_positions), so they also apply in Canvas and
 * the Canvas mobile apps. "Hidden" is local to the extension because Canvas
 * has no per-user equivalent (un-favoriting changes Canvas's own course list).
 * Writes are optimistic: the UI updates immediately and reverts on failure.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const canvas = Gesso.api.canvas;
  const { store } = Gesso;

  const SWATCHES = ['#4f7cff', '#7c8cff', '#a77bf3', '#e07a9a', '#e0876a', '#d6a94f', '#6cc17e', '#4fb3a9', '#58b8d1', '#8f9bb3'];

  /** Replace one course in the store (and cache) with a patched copy. */
  function patchCourse(/** @type {string} */ id, /** @type {any} */ patch) {
    const courses = (store.get().data.courses || []).map((/** @type {any} */ c) => (c.id === id ? { ...c, ...patch } : c));
    store.set({ data: { courses } });
    Gesso.cache.save({ courses }, store.get().meta);
  }

  async function setHidden(/** @type {string} */ id, /** @type {boolean} */ hide) {
    const current = new Set(store.get().settings.hiddenCourses || []);
    hide ? current.add(id) : current.delete(id);
    await Gesso.settings.update({ hiddenCourses: [...current] });
  }

  /**
   * Move a course up/down in dashboard order and save the order to Canvas.
   * Debounced so several quick moves become one request.
   */
  let orderTimer = 0;
  /** @type {any[]|null} */
  let orderBefore = null;
  function move(/** @type {string} */ id, /** @type {-1|1} */ delta) {
    const list = Gesso.derive.sortedCourses(store.get().data);
    const from = list.findIndex((c) => c.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= list.length) return;
    orderBefore ||= store.get().data.courses;
    [list[from], list[to]] = [list[to], list[from]];
    const positions = Object.fromEntries(list.map((c, i) => [c.id, i]));
    const courses = (store.get().data.courses || []).map((/** @type {any} */ c) => ({ ...c, position: positions[c.id] }));
    store.set({ data: { courses } });

    clearTimeout(orderTimer);
    orderTimer = window.setTimeout(async () => {
      const before = orderBefore;
      orderBefore = null;
      try {
        await canvas.setDashboardPositions(Object.fromEntries(list.map((c, i) => [`course_${c.id}`, i])));
        Gesso.cache.save({ courses: store.get().data.courses }, store.get().meta);
      } catch (err) {
        store.set({ data: { courses: before } });
        Gesso.overlays.toast(`Couldn't save course order to Canvas: ${/** @type {any} */ (err).message}`, { tone: 'danger' });
      }
    }, 700);
  }

  /** Open the settings dialog for one course. */
  function open(/** @type {any} */ shown) {
    // Views may pass a course recolored by the theme; this dialog edits Canvas's own color.
    const course = (store.get().data.courses || []).find((/** @type {any} */ c) => c.id === shown.id) || shown;
    const themed = !!shown.canvasColor;
    const hidden = (store.get().settings.hiddenCourses || []).includes(course.id);
    const hasNickname = course.originalName && course.name !== course.originalName;
    let color = course.color;

    const nickname = /** @type {HTMLInputElement} */ (h('input', {
      class: 'field__input', type: 'text', maxlength: '59', placeholder: course.originalName || course.name, id: 'cs-nick',
    }));
    nickname.value = hasNickname ? course.name : '';

    const preview = h('span', { class: 'swatch-preview', style: { background: Gesso.color.courseGradient(color) } });
    const custom = /** @type {HTMLInputElement} */ (h('input', { type: 'color', class: 'swatch-custom', 'aria-label': 'Custom color' }));
    custom.value = color;
    const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Course color' });
    const renderSwatches = () => swatches.replaceChildren(...SWATCHES.map((s) => h('button', {
      type: 'button', class: 'swatch', role: 'radio', 'aria-checked': String(s === color), 'aria-label': s,
      style: { '--c': s }, onClick: () => pick(s),
    })), custom);
    const pick = (/** @type {string} */ s) => {
      color = s;
      custom.value = s;
      preview.style.setProperty('background', Gesso.color.courseGradient(s));
      renderSwatches();
    };
    custom.addEventListener('input', () => pick(custom.value));
    renderSwatches();

    const hide = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', id: 'cs-hide' }));
    hide.checked = hidden;
    const error = h('p', { class: 'field__error', role: 'alert' });
    const save = h('button', { class: 'btn btn--primary', type: 'submit' }, 'Save');

    const form = h('form', { class: 'form' },
      h('div', { class: 'field' },
        h('label', { class: 'field__label', for: 'cs-nick' }, 'Nickname'),
        nickname,
        h('p', { class: 'field__hint' }, 'Saved to Canvas. Leave empty to use the official name.')),
      h('div', { class: 'field' },
        h('span', { class: 'field__label' }, 'Color'),
        h('div', { class: 'color-row' }, preview, swatches),
        h('p', { class: 'field__hint' }, themed
          ? 'Saved to Canvas. Your theme shows courses in its own colors; change that in Settings → Appearance.'
          : 'Saved to Canvas; also used for the generated card gradient.')),
      h('label', { class: 'check' }, hide,
        h('span', null, h('span', { class: 'check__label' }, 'Hide this course'),
          h('span', { class: 'field__hint' }, 'Removes it from the dashboard, sidebar, and assignment center. Only affects Gesso.'))),
      error,
      h('div', { class: 'form__actions' },
        h('a', { class: 'btn btn--ghost', href: course.url }, 'Open in Canvas', icon('external', { size: 13 })),
        h('span', { style: { flex: '1' } }),
        h('button', { class: 'btn', type: 'button', onClick: () => dlg.close() }, 'Cancel'),
        save),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.setAttribute('disabled', '');
      error.textContent = '';
      const nick = nickname.value.trim();
      const before = { name: course.name, color: course.color };
      try {
        if (nick !== (hasNickname ? course.name : '')) {
          if (nick) await canvas.setNickname(course.id, nick);
          else if (hasNickname) await canvas.clearNickname(course.id);
          patchCourse(course.id, { name: nick || course.originalName || course.name });
        }
        if (color.toLowerCase() !== course.color.toLowerCase()) {
          await canvas.setCourseColor(course.id, color);
          patchCourse(course.id, { color });
        }
        if (hide.checked !== hidden) await setHidden(course.id, hide.checked);
        dlg.close();
        Gesso.overlays.toast('Course settings saved', { tone: 'ok' });
      } catch (err) {
        patchCourse(course.id, before);
        error.textContent = `Couldn't save to Canvas: ${/** @type {any} */ (err).message}`;
        save.removeAttribute('disabled');
      }
    });

    const dlg = Gesso.overlays.dialog({ title: course.code ? `${course.code} settings` : 'Course settings', body: form, class: 'dialog--narrow' });
    nickname.focus();
  }

  Gesso.courseSettings = { open, move, setHidden };
})();
