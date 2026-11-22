// @ts-check
/**
 * Course workspace → Files tab: folder tree on the left, folder contents on
 * the right, and course-wide search (Canvas server-side search_term).
 *
 * Folders are fetched once (flat list → tree); files load per folder when
 * opened. The selected folder comes from the URL (set by the workspace). Many courses hide the Files tab from students — that case shows a
 * friendly empty state (files are usually still linked from Modules).
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const canvas = Gesso.api.canvas;
  const { toDate, fmt } = Gesso.time;
  const N = Gesso.normalize;

  /**
   * Per-workspace UI state (lives on the workspace instance).
   * @typedef {{ folderId: string|null, query: string, expanded: Set<string>, timer?: number }} FilesState
   */

  function fileIcon(/** @type {any} */ f) {
    const t = `${f.mimeClass} ${f.contentType}`;
    if (/pdf|doc|text|ppt|xls/.test(t)) return 'fileText';
    if (/image/.test(t)) return 'image';
    if (/video|audio/.test(t)) return 'video';
    return 'file';
  }

  function fileRow(/** @type {any} */ f, /** @type {string} */ location = '') {
    const updated = toDate(f.updatedAt);
    return h('li', { class: ['frow', f.locked && 'frow--locked'] },
      h('span', { class: 'frow__icon', 'aria-hidden': 'true' }, icon(f.locked ? 'lock' : fileIcon(f), { size: 16 })),
      h('span', { class: 'frow__main' },
        f.locked
          ? h('span', { class: 'frow__name' }, f.name)
          : h('a', { class: 'frow__name', href: f.previewUrl, 'data-fkey': `file:${f.id}` }, f.name),
        location && h('span', { class: 'frow__loc' }, location)),
      h('span', { class: 'frow__size tabular' }, ui.fileSize(f.size)),
      h('span', { class: 'frow__date' }, updated ? Gesso.time.monthDay(updated) : ''),
      !f.locked && f.downloadUrl
        ? h('a', { class: 'btn btn--ghost btn--icon btn--sm', href: f.downloadUrl, 'aria-label': `Download ${f.name}`, title: 'Download' }, icon('download', { size: 15 }))
        : h('span', { class: 'frow__spacer' }),
    );
  }

  /**
   * @param {{ course: any, files: FilesState, rerender: () => void }} ctx
   */
  function render({ course, files: st, rerender }) {
    const key = `folders:${course.id}`;
    const fetcher = () => canvas.getFolders(course.id).then((fs) => fs.map(N.folder).filter(Boolean));
    const res = Gesso.resources.ensure(key, fetcher);
    if (res.error && (res.error.kind === 'forbidden' || res.error.kind === 'not_found') && !res.data) {
      return h('div', { class: 'panel' }, ui.emptyState({
        icon: 'folder', title: 'Files are hidden in this course',
        body: 'Your instructor turned off the Files page. Files are usually still linked from Modules.',
        action: h('a', { class: 'btn btn--sm', href: Gesso.router.href(`/courses/${course.id}/modules`) }, 'Go to Modules'),
      }));
    }
    const pending = ui.resourceState(res, { onRetry: () => Gesso.resources.load(key, fetcher) });
    if (pending) return h('div', { class: 'panel' }, pending);

    /** @type {any[]} */
    const folders = res.data;
    const byId = new Map(folders.map((f) => [f.id, f]));
    /** @type {Map<string|null, any[]>} */
    const children = new Map();
    for (const f of folders) {
      const list = children.get(f.parentId) || [];
      list.push(f);
      children.set(f.parentId, list);
    }
    for (const list of children.values()) list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    const roots = (children.get(null) || []).concat(folders.filter((f) => f.parentId && !byId.has(f.parentId)));
    if (!roots.length) {
      return h('div', { class: 'panel' }, ui.emptyState({ icon: 'folder', title: 'No files', body: 'This course has no files you can see.' }));
    }

    const selectedId = st.folderId && byId.has(st.folderId) ? st.folderId : roots[0].id;
    // Always show the path to the selected folder expanded.
    const path = [];
    for (let f = byId.get(selectedId); f; f = f.parentId ? byId.get(f.parentId) : null) path.unshift(f);
    for (const f of path) st.expanded.add(f.id);

    // The open folder is part of the URL (#/courses/:id/files/:folderId) so
    // back/forward steps through folders and reload returns to the same one.
    const select = (/** @type {string} */ id) => {
      st.query = '';
      Gesso.router.go(`/courses/${course.id}/files${id === roots[0].id ? '' : `/${id}`}`);
    };
    const toggleExpand = (/** @type {string} */ id) => { st.expanded.has(id) ? st.expanded.delete(id) : st.expanded.add(id); rerender(); };

    /** Recursive tree node. */
    const node = (/** @type {any} */ f, depth = 0) => {
      const kids = children.get(f.id) || [];
      const open = st.expanded.has(f.id);
      const label = depth === 0 && f.name === 'course files' ? 'All files' : f.name;
      return h('li', { role: 'treeitem', 'aria-expanded': kids.length ? String(open) : undefined, 'aria-selected': String(f.id === selectedId) },
        h('div', { class: ['tnode', f.id === selectedId && 'tnode--selected'], style: { '--depth': String(depth) } },
          kids.length
            ? h('button', { class: 'tnode__toggle', type: 'button', 'aria-label': `${open ? 'Collapse' : 'Expand'} ${label}`, onClick: () => toggleExpand(f.id), 'data-fkey': `tt:${f.id}` },
              icon('chevronRight', { size: 13, class: open ? 'rot90' : '' }))
            : h('span', { class: 'tnode__toggle' }),
          h('button', { class: 'tnode__btn', type: 'button', onClick: () => select(f.id), 'data-fkey': `tn:${f.id}` },
            icon(f.id === selectedId ? 'folderOpen' : 'folder', { size: 15 }),
            h('span', { class: 'truncate' }, label),
            f.locked && icon('lock', { size: 12 }))),
        open && kids.length > 0 && h('ul', { role: 'group' }, kids.map((k) => node(k, depth + 1))));
    };

    // ---- right pane ----------------------------------------------------------
    let pane;
    const query = st.query.trim();
    if (query.length >= 2) {
      const sKey = `filesearch:${course.id}:${query.toLowerCase()}`;
      const sFetch = () => canvas.searchFiles(course.id, query).then((fs) => fs.map((/** @type {any} */ x) => N.file(x, course.id)));
      const sres = Gesso.resources.ensure(sKey, sFetch, { persist: false, ttl: 2 * 60_000 });
      const sp = ui.resourceState(sres, { rows: 3 });
      pane = sp || (sres.data.length
        ? h('ul', { class: 'flist' }, sres.data.map((/** @type {any} */ f) => fileRow(f, byId.get(f.folderId)?.fullName.replace(/^course files\/?/, '') || '')))
        : ui.emptyState({ icon: 'search', title: 'No files match', body: `Nothing named like "${query}".` }));
    } else {
      const folder = byId.get(selectedId);
      const fKey = `files:${selectedId}`;
      const fFetch = () => canvas.getFolderFiles(selectedId).then((fs) => fs.map((/** @type {any} */ x) => N.file(x, course.id)));
      const fres = Gesso.resources.ensure(fKey, fFetch);
      const subfolders = children.get(selectedId) || [];
      const fp = ui.resourceState(fres, { rows: 3, onRetry: () => Gesso.resources.load(fKey, fFetch) });
      pane = h('div', null,
        h('nav', { class: 'crumbs', 'aria-label': 'Folder path' }, path.map((f, i) => [
          i > 0 && icon('chevronRight', { size: 12 }),
          i < path.length - 1
            ? h('button', { class: 'crumbs__btn', type: 'button', onClick: () => select(f.id) }, i === 0 && f.name === 'course files' ? 'All files' : f.name)
            : h('span', { class: 'crumbs__current', 'aria-current': 'location' }, i === 0 && f.name === 'course files' ? 'All files' : f.name),
        ])),
        h('ul', { class: 'flist' },
          subfolders.map((f) => h('li', { class: 'frow' },
            h('span', { class: 'frow__icon', 'aria-hidden': 'true' }, icon('folder', { size: 16 })),
            h('span', { class: 'frow__main' }, h('button', { class: 'frow__name frow__folder', type: 'button', onClick: () => select(f.id), 'data-fkey': `sub:${f.id}` }, f.name)),
            h('span', { class: 'frow__size faint' }, `${f.filesCount + f.foldersCount} ${f.filesCount + f.foldersCount === 1 ? 'item' : 'items'}`),
            h('span', { class: 'frow__date' }), h('span', { class: 'frow__spacer' }))),
          fp ? h('li', null, fp) : fres.data.map((/** @type {any} */ f) => fileRow(f))),
        !fp && !subfolders.length && !fres.data.length && ui.emptyState({ icon: 'folder', title: 'Empty folder', body: folder?.locked ? 'This folder is locked.' : '' }),
      );
    }

    const search = ui.searchField({
      value: st.query, placeholder: 'Search all files in this course', label: 'Search files', fkey: 'files-search',
      onInput: (v) => {
        clearTimeout(st.timer);
        st.timer = window.setTimeout(() => { st.query = v; rerender(); }, 250);
      },
    });

    return h('div', { class: 'files' },
      h('div', { class: 'files__tree panel' },
        h('ul', { role: 'tree', 'aria-label': 'Folders', class: 'tree' }, roots.map((r) => node(r)))),
      h('div', { class: 'files__pane panel' }, search, pane),
    );
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.courseFiles = { render };
})();
