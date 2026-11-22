// @ts-check
/**
 * Small reusable UI pieces. Each returns a DOM node.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const { toDate, relative, dueLabel, duration } = Gesso.time;

  /**
   * Card container with a header.
   * @param {{ title: string, icon?: string, subtitle?: any, count?: number|null, actions?: any, id?: string, class?: string }} opts
   * @param {...any} children
   */
  function panel({ title, icon: iconName, subtitle, count, actions, id, class: cls }, ...children) {
    const headingId = id ? `${id}-title` : undefined;
    return h('section', { class: ['panel', cls], id, 'aria-labelledby': headingId },
      h('header', { class: 'panel__head' },
        h('div', null,
          h('h2', { class: 'panel__title', id: headingId },
            iconName && icon(iconName, { size: 16 }),
            title,
            count != null && count > 0 && h('span', { class: 'panel__count' }, String(count)),
          ),
          subtitle && h('p', { class: 'panel__subtitle' }, subtitle),
        ),
        actions,
      ),
      children,
    );
  }

  /** @param {string} text @param {'danger'|'warn'|'ok'|'info'|'accent'|null} [tone] @param {string} [iconName] */
  function pill(text, tone, iconName) {
    return h('span', { class: ['pill', tone && `pill--${tone}`] }, iconName && icon(iconName, { size: 12 }), text);
  }

  const STATUS = /** @type {Record<string, [string, any]>} */ ({
    not_submitted: ['Not submitted', null],
    submitted: ['Submitted', 'info'],
    graded: ['Graded', 'ok'],
    late: ['Late', 'warn'],
    missing: ['Missing', 'danger'],
    excused: ['Excused', null],
    none: ['No submission', null],
  });

  function statusPill(/** @type {string} */ status) {
    const [label, tone] = STATUS[status] || [status, null];
    return pill(label, tone);
  }

  /** Icon name for an item kind. */
  function kindIcon(/** @type {string} */ kind) {
    return { quiz: 'quiz', discussion: 'discussion', page: 'page', note: 'note', peer_review: 'peerReview' }[kind] || 'assignment';
  }

  /** Countdown / overdue pill coloured by urgency. */
  function countdownPill(/** @type {string|null} */ dueAt, /** @type {string} */ urgency, now = new Date()) {
    const due = toDate(dueAt);
    if (!due) return pill('No due date');
    const ms = due.getTime() - now.getTime();
    const tone = { overdue: 'danger', critical: 'danger', high: 'warn', medium: 'accent' }[urgency] || null;
    const text = ms < 0 ? `${duration(ms)} late` : duration(ms);
    return h('span', { class: ['pill', tone && `pill--${tone}`, 'tabular'], title: dueLabel(due) },
      icon(ms < 0 ? 'alert' : 'clock', { size: 12 }), text);
  }

  /** <time> with relative text and the absolute date as a tooltip. */
  function timeAgo(/** @type {string|number|null} */ value, now = new Date()) {
    const d = toDate(value);
    if (!d) return h('span', null, '');
    return h('time', { datetime: d.toISOString(), title: dueLabel(d) }, relative(d, now));
  }

  /**
   * @param {{ icon?: string, title: string, body?: any, action?: any }} opts
   */
  function emptyState({ icon: iconName = 'inbox', title, body, action }) {
    return h('div', { class: 'empty' },
      icon(iconName, { size: 28 }),
      h('p', { class: 'empty__title' }, title),
      body && h('p', { class: 'empty__body' }, body),
      action,
    );
  }

  /**
   * Error banner tailored to the error kind.
   * @param {{ kind: string, message: string }} error
   * @param {{ onRetry: () => void, hasCache: boolean, syncedAt?: number|null }} opts
   */
  function errorBanner(error, { onRetry, hasCache, syncedAt }) {
    const cached = hasCache && syncedAt ? ` Showing data from ${relative(new Date(syncedAt))}.` : '';
    if (error.kind === 'auth') {
      return h('div', { class: 'banner banner--danger', role: 'alert' },
        icon('logout', { size: 20 }),
        h('div', { class: 'banner__text' },
          h('p', { class: 'banner__title' }, "You're logged out of Canvas"),
          h('p', { class: 'banner__body' }, `Log in, then come back and refresh.${cached}`),
        ),
        h('a', { class: 'btn btn--primary', href: `${Gesso.config.canvasOrigin}/login` }, 'Log in'),
        h('button', { class: 'btn', type: 'button', onClick: onRetry }, 'Refresh'),
      );
    }
    const titles = /** @type {Record<string,string>} */ ({
      network: "Can't reach Canvas",
      timeout: 'Canvas is slow to respond',
      rate_limit: 'Canvas is rate-limiting requests',
    });
    return h('div', { class: ['banner', hasCache ? 'banner--warn' : 'banner--danger'], role: 'alert' },
      icon(error.kind === 'network' ? 'wifiOff' : 'alert', { size: 20 }),
      h('div', { class: 'banner__text' },
        h('p', { class: 'banner__title' }, titles[error.kind] || "Couldn't sync with Canvas"),
        h('p', { class: 'banner__body' }, `${error.message}${cached}`),
      ),
      h('button', { class: 'btn', type: 'button', onClick: onRetry }, 'Try again'),
    );
  }

  /** Initials avatar, or the Canvas avatar image if the user set one. */
  function avatar(/** @type {any} */ user) {
    const name = user?.name || '';
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((/** @type {string} */ s) => s[0]).join('').toUpperCase();
    return h('span', { class: 'avatar', 'aria-hidden': 'true' },
      user?.avatarUrl ? h('img', { src: user.avatarUrl, alt: '', referrerpolicy: 'no-referrer' }) : initials || '·');
  }

  /** Points/score text: "18 / 20", "A-", "—". */
  function scoreText(/** @type {number|null} */ score, /** @type {number|null} */ points, /** @type {string|null} */ grade, /** @type {string} */ gradingType = 'points') {
    if (score == null && !grade) return '—';
    // Pass/fail comes back as "complete"/"incomplete"; capitalize for display.
    if (gradingType !== 'points' && grade) return grade === 'complete' ? 'Complete' : grade === 'incomplete' ? 'Incomplete' : grade;
    if (score != null && points) return `${round(score)} / ${round(points)}`;
    return grade || String(round(/** @type {number} */ (score)));
  }

  const round = (/** @type {number} */ n) => Math.round(n * 100) / 100;

  // ---------------------------------------------------------------------------
  // Shared by dashboard / courses / workspace
  // ---------------------------------------------------------------------------

  /**
   * Course card with gradient (or image) banner, grade, and next deadline.
   * @param {any} c  Course
   * @param {any} next  next WorkItem or undefined
   * @param {Date} now
   * @param {{ extra?: any, dim?: boolean }} [opts]
   */
  function courseCard(c, next, now, { extra, dim } = {}) {
    const { fmt, dayLabel, dayDiff } = Gesso.time;
    const grade = Gesso.derive.gradeDisplay(c);
    const due = toDate(next?.dueAt);
    return h('a', {
      class: ['course-card', dim && 'course-card--dim'], href: Gesso.router.href(`/courses/${c.id}`), 'data-fkey': `course:${c.id}`,
      title: Gesso.derive.courseTooltip(c),
      'aria-label': `${Gesso.derive.courseTitle(c)}. Grade ${grade.primary}${grade.secondary ? ` (${grade.secondary})` : ''}.`,
    },
      h('div', { class: 'course-card__banner', style: { '--grad': Gesso.color.courseGradient(c.color) } },
        c.imageUrl && h('img', { src: c.imageUrl, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
        h('span', { class: 'course-card__code truncate' }, c.code || 'Course'),
      ),
      h('div', { class: 'course-card__body' },
        h('span', { class: 'course-card__name' }, Gesso.derive.courseTitle(c)),
        h('span', { class: 'course-card__term' }, [c.term, Gesso.derive.courseEnded(c, now) && 'Ended'].filter(Boolean).join(' · ') || ' '),
        extra,
        h('div', { class: 'course-card__foot' },
          h('span', { class: `grade grade--${grade.tone}`, title: c.hideFinalGrades ? grade.secondary : undefined },
            h('span', { class: 'grade__primary' }, grade.primary),
            grade.secondary && !c.hideFinalGrades && h('span', { class: 'grade__secondary' }, grade.secondary)),
          next && due
            ? h('span', { class: 'next-due', title: `Next: ${next.title}` }, icon('clock', { size: 13 }),
              h('span', { class: 'truncate' }, dayDiff(now, due) <= 1 ? dayLabel(due, now) : Gesso.time.monthDay(due)))
            : h('span', { class: 'next-due faint' }, 'Nothing due'),
        ),
      ),
    );
  }

  /**
   * Compact row for a WorkItem (dashboard lists, workspace overview).
   * @param {any} item @param {any} course @param {Date} now
   * @param {'time'|'date'} when  just the time (when grouped by day) or day + time
   */
  function workRow(item, course, now, when) {
    const { fmt, dayLabel } = Gesso.time;
    const due = toDate(item.dueAt);
    const urgency = Gesso.derive.urgency(item, now);
    const href = Gesso.derive.itemHref(item);
    const whenText = due ? (when === 'time' ? fmt.time.format(due) : `${dayLabel(due, now)}, ${fmt.time.format(due)}`) : '';
    const snoozed = Gesso.plannerUi?.snoozeLabel(item, now);
    // The title is the row's link (stretched over the whole row in CSS), so
    // the done/snooze buttons can sit inside the row without nesting
    // interactive elements. Notes have no page: their title opens the editor.
    const title = href
      ? h('a', { class: 'work-row__title work-row__link', href, 'data-fkey': item.key }, item.title)
      : item.kind === 'note' && Gesso.plannerUi
        ? h('button', { class: 'work-row__title work-row__link', type: 'button', 'data-fkey': item.key, onClick: () => Gesso.plannerUi.openTodo(item) }, item.title)
        : h('span', { class: 'work-row__title' }, item.title);
    return h('div', {
      class: ['work-row', Gesso.derive.isDone(item) && 'work-row--done'],
      style: { '--c': course?.color || 'var(--text-3)' },
    },
      h('span', { class: 'work-row__bar', 'aria-hidden': 'true' }),
      h('span', { class: 'work-row__icon', 'aria-hidden': 'true' }, icon(kindIcon(item.kind), { size: 15 })),
      h('span', { class: 'work-row__main' },
        title,
        h('span', { class: 'work-row__meta' },
          h('span', null, course ? course.code || course.name : 'Personal'),
          whenText && h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'),
          whenText && h('span', null, whenText),
          item.points != null && h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'),
          item.points != null && h('span', null, `${item.points} pts`),
        ),
      ),
      h('span', { class: 'work-row__right' },
        item.status === 'missing' && statusPill('missing'),
        snoozed && pill(snoozed, null, 'clock'),
        countdownPill(item.dueAt, urgency, now),
        Gesso.plannerUi?.rowActions(item),
      ),
    );
  }

  /**
   * Toggle chip for filters.
   * @param {{ label: string, pressed: boolean, onClick: () => void, color?: string, fkey: string, count?: number }} o
   */
  function chip({ label, pressed, onClick, color, fkey, count }) {
    return h('button', { class: 'chip', type: 'button', 'aria-pressed': String(pressed), onClick, 'data-fkey': fkey },
      color && h('span', { class: 'dot', style: { '--c': color }, 'aria-hidden': 'true' }),
      label,
      count != null && h('span', { class: 'chip__count' }, String(count)));
  }

  /**
   * Search input with icon. `onInput` receives the value.
   * @param {{ value: string, placeholder: string, label: string, fkey: string, onInput: (v: string) => void }} o
   */
  function searchField({ value, placeholder, label, fkey, onInput }) {
    const input = /** @type {HTMLInputElement} */ (h('input', {
      type: 'search', class: 'search__input', placeholder, 'aria-label': label, 'data-fkey': fkey,
      autocomplete: 'off', spellcheck: 'false',
    }));
    input.value = value;
    input.addEventListener('input', () => onInput(input.value));
    return h('label', { class: 'search' }, icon('search', { size: 15 }), input);
  }

  /**
   * Labelled native <select>.
   * @param {{ label: string, value: string, options: [string, string][], onChange: (v: string) => void, fkey: string }} o
   */
  function selectField({ label, value, options, onChange, fkey }) {
    const sel = /** @type {HTMLSelectElement} */ (h('select', { class: 'select__input', 'data-fkey': fkey },
      options.map(([v, l]) => h('option', { value: v, selected: v === value }, l))));
    sel.addEventListener('change', () => onChange(sel.value));
    return h('label', { class: 'select' }, h('span', { class: 'select__label' }, label), sel);
  }

  /**
   * Navigation tabs (links, so back/forward work).
   * @param {{ href: string, label: string, current: boolean, count?: number|null }[]} tabs
   * @param {string} label
   */
  function navTabs(tabs, label) {
    return h('nav', { class: 'tabs', 'aria-label': label },
      tabs.map((t) => h('a', { class: 'tabs__tab', href: t.href, 'aria-current': t.current ? 'page' : undefined, 'data-fkey': `tab:${t.label}` },
        t.label, t.count ? h('span', { class: 'tabs__count' }, String(t.count)) : null)));
  }

  /**
   * Canvas "plain text" fields (rubric descriptions, ratings, comments) often
   * contain markup like "<br/>" or entities like "&amp;". Render those through
   * the sanitizer; render real plain text as text with its line breaks kept.
   * @param {string|null|undefined} text
   * @param {{ tag?: string, class?: string }} [opts]
   */
  function richText(text, { tag = 'span', class: cls } = {}) {
    const s = String(text ?? '');
    const looksLikeHtml = /<\/?[a-z][^>]*>|&(?:#\d+|#x[0-9a-f]+|[a-z]+);/i.test(s);
    return looksLikeHtml
      ? h(tag, { class: ['rich rich--html', cls] }, Gesso.sanitize(s))
      : h(tag, { class: ['rich rich--text', cls] }, s);
  }

  /** Plain-text version of possibly-HTML Canvas text (for tooltips/aria). */
  const plainText = (/** @type {string|null|undefined} */ text) => Gesso.normalize.textSnippet(String(text ?? ''), 600);

  /** "2.4 MB" */
  function fileSize(/** @type {number} */ bytes) {
    if (!bytes) return '—';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n < 10 && i ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  }

  /** Inline loading / error / empty wrapper for on-demand resources. */
  function resourceState(/** @type {any} */ res, /** @type {{ empty?: any, rows?: number, onRetry?: () => void }} */ { empty, rows = 4, onRetry } = {}) {
    if (res.data) return null;
    if (res.error) {
      const forbidden = res.error.kind === 'forbidden' || res.error.kind === 'not_found';
      return emptyState({
        icon: forbidden ? 'alert' : 'wifiOff',
        title: forbidden ? 'Not available' : "Couldn't load this",
        body: forbidden ? 'Your instructor may have turned this off for the course.' : res.error.message,
        action: !forbidden && onRetry && h('button', { class: 'btn btn--sm', type: 'button', onClick: onRetry }, 'Try again'),
      });
    }
    return h('div', { 'aria-busy': 'true' }, Array.from({ length: rows }, () => h('div', { class: 'skel skel-row' })), empty && null);
  }

  Gesso.ui = {
    panel, pill, statusPill, kindIcon, countdownPill, timeAgo, emptyState, errorBanner, avatar, scoreText,
    courseCard, workRow, chip, searchField, selectField, navTabs, fileSize, resourceState, richText, plainText,
  };
})();
