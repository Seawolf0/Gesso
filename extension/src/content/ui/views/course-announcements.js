// @ts-check
/**
 * Course workspace → Announcements tab: the past year of announcements.
 * Opening an unread one marks it read in Canvas too (PUT …/read).
 * Bodies are rendered through Gesso.sanitize, never as raw HTML.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const canvas = Gesso.api.canvas;
  const { store } = Gesso;
  const { toDate, dueLabel } = Gesso.time;

  /** Mark read in Canvas, then reflect it everywhere we show this announcement. */
  async function markRead(/** @type {string} */ courseId, /** @type {any} */ a) {
    const key = `announcements:${courseId}`;
    const setRead = (/** @type {boolean} */ read) => {
      Gesso.resources.mutate(key, (list) => list.map((/** @type {any} */ x) => (x.id === a.id ? { ...x, read } : x)));
      const anns = store.get().data.announcements;
      if (anns) store.set({ data: { announcements: anns.map((/** @type {any} */ x) => (x.id === a.id ? { ...x, read } : x)) } });
    };
    setRead(true);
    try {
      await canvas.markTopicRead(courseId, a.id);
      Gesso.cache.save({ announcements: store.get().data.announcements }, store.get().meta);
    } catch (err) {
      setRead(false);
      Gesso.overlays.toast(`Couldn't mark as read in Canvas: ${/** @type {any} */ (err).message}`, { tone: 'danger' });
    }
  }

  /** Keep the URL in sync with the open announcement (no history entry, no re-route). */
  function syncUrl(/** @type {string} */ courseId, /** @type {string|null} */ annId) {
    const path = `/courses/${courseId}/announcements${annId ? `/${annId}` : ''}`;
    if (location.hash !== `#${path}`) history.replaceState(null, '', `#${path}`);
  }

  /** @param {{ course: any, openAnn: Set<string>, focusItem: string|null, rerender: () => void, markedFocus?: string }} ctx */
  function render(ctx) {
    const { course, openAnn, rerender } = ctx;
    const key = `announcements:${course.id}`;
    const fetcher = () => canvas.getCourseAnnouncements(course.id).then((l) => l.map(Gesso.normalize.announcementFull));
    const res = Gesso.resources.ensure(key, fetcher, { ttl: 5 * 60_000 });
    const pending = ui.resourceState(res, { onRetry: () => Gesso.resources.load(key, fetcher) });
    if (pending) return h('div', { class: 'panel' }, pending);

    const list = [...res.data].sort((a, b) => (toDate(b.postedAt)?.getTime() ?? 0) - (toDate(a.postedAt)?.getTime() ?? 0));

    // Deep link (/announcements/:id): opened by the workspace; mark it read once.
    if (ctx.focusItem && ctx.markedFocus !== ctx.focusItem) {
      const target = list.find((a) => a.id === ctx.focusItem);
      if (target) {
        ctx.markedFocus = ctx.focusItem;
        if (!target.read) markRead(course.id, target);
      }
    }
    const unread = list.filter((a) => !a.read).length;
    return h('div', { class: 'anns' },
      h('div', { class: 'modules__bar' },
        h('span', { class: 'muted' }, `${list.length} ${list.length === 1 ? 'announcement' : 'announcements'} in the past year${unread ? ` · ${unread} unread` : ''}`),
        h('span', { style: { flex: '1' } }),
        h('a', { class: 'btn btn--ghost btn--sm', href: `${course.url}/announcements` }, 'Open in Canvas', icon('external', { size: 12 }))),
      list.length === 0
        ? h('div', { class: 'panel' }, ui.emptyState({ icon: 'megaphone', title: 'No announcements', body: 'Nothing posted in the past year.' }))
        : list.map((a) => {
          const open = openAnn.has(a.id);
          const posted = toDate(a.postedAt);
          const details = /** @type {HTMLDetailsElement} */ (h('details', { class: ['ann', !a.read && 'ann--unread'], open },
            h('summary', { class: 'ann__head', 'data-fkey': `ann:${a.id}` },
              icon('chevronDown', { size: 16, class: 'module__chev' }),
              h('span', { class: 'ann__titles' },
                h('span', { class: 'ann__title' }, !a.read && h('span', { class: 'sr-only' }, 'Unread: '), a.title),
                h('span', { class: 'ann__meta' }, [a.author, posted && dueLabel(posted)].filter(Boolean).join(' · '))),
              !a.read && h('span', { class: 'ann__dot', 'aria-hidden': 'true' })),
            open && h('div', { class: 'ann__body' },
              h('div', { class: 'prose' }, Gesso.sanitize(a.html)),
              h('a', { class: 'link', href: a.url }, 'Open in Canvas', h('span', { class: 'faint' }, ' (replies, attachments)'))),
          ));
          details.addEventListener('toggle', () => {
            // A <details> created with `open` also fires "toggle"; only react to real changes.
            if (details.open === openAnn.has(a.id)) return;
            if (details.open) {
              openAnn.add(a.id);
              if (!a.read) markRead(course.id, a);
              syncUrl(course.id, a.id);
            } else {
              openAnn.delete(a.id);
              syncUrl(course.id, [...openAnn].pop() || null);
            }
            rerender();
          });
          return details;
        }),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.courseAnnouncements = { render };
})();
