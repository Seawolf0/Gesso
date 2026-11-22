// @ts-check
/**
 * #/grades — every course's grade, cross-checked against Canvas.
 *
 *   - GPA estimate (the one hero number), credit-weighted, on an editable scale.
 *   - One tile per course: Gesso's computed score + meter, Canvas's
 *     score, and a match / mismatch verdict naming the rule behind any
 *     difference. Tiles link to the course's Grades tab for the full story.
 *   - The GPA table: letter, where it comes from, grade points, editable
 *     credits, and whether the course counts.
 *
 * Settings used (storage `settings`): gpaScale, courseCredits, gpaExcluded.
 * Stateless view: rebuilt on each store change; inputs keep focus via data-fkey.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const G = Gesso.grades;

  const DEFAULT_CREDITS = 3;
  const fmtPct = (/** @type {number|null} */ n) => (n == null ? '—' : `${G.round(n)}%`);

  function render(/** @type {any} */ state) {
    const { data, settings } = state;
    if (!Array.isArray(data.courses) || data.coursework == null) {
      return h('div', { class: 'grades-page fade-in' }, h('div', { class: 'panel' }, [0, 1, 2, 3].map(() => h('div', { class: 'skel skel-row' }))));
    }
    const courses = Gesso.derive.visibleCourses(data, settings.hiddenCourses || []).filter((c) => c.role === 'student');
    if (!courses.length) {
      return h('div', { class: 'grades-page fade-in' }, h('div', { class: 'panel' }, ui.emptyState({ icon: 'chart', title: 'No student courses', body: 'Grades appear for courses where you are enrolled as a student.' })));
    }
    const analyses = courses.map((c) => Gesso.gradeSources.analyze(c, data));
    const scale = settings.gpaScale || G.DEFAULT_GPA_SCALE;
    const credits = settings.courseCredits || {};
    const excluded = new Set(settings.gpaExcluded || []);
    const rows = analyses.map((a) => ({
      a,
      letter: a.letter?.value || null,
      estimated: !!a.letter?.estimated,
      credits: credits[a.course.id] ?? DEFAULT_CREDITS,
      included: !excluded.has(a.course.id),
    }));
    const gpa = G.gpa(rows.filter((r) => r.included).map((r) => ({ letter: r.letter, credits: r.credits })), scale);
    const checks = analyses.map((a) => a.check?.status).filter((s) => s === 'match' || s === 'mismatch');
    const matches = checks.filter((s) => s === 'match').length;

    return h('div', { class: 'grades-page fade-in' },
      h('section', { class: 'panel ghero', 'aria-labelledby': 'gpa-h' },
        h('div', null,
          h('h2', { class: 'ghero__label', id: 'gpa-h' }, 'GPA estimate'),
          h('p', { class: 'ghero__value' }, gpa.gpa == null ? '—' : (Math.round(gpa.gpa * 100) / 100).toFixed(2), h('span', { class: 'ghero__of' }, ' / 4.0')),
          h('p', { class: 'muted' }, gpa.counted
            ? `From ${gpa.counted} course${gpa.counted === 1 ? '' : 's'} · ${gpa.credits} credit${gpa.credits === 1 ? '' : 's'} · current grades`
            : 'No letter grades to count yet.'),
          gpa.unknown.length > 0 && h('p', { class: 'faint' }, `Not on your GPA scale, so not counted: ${[...new Set(gpa.unknown)].join(', ')}.`)),
        h('div', { class: 'ghero__side' },
          checks.length > 0 && h('p', { class: ['ghero__check', matches === checks.length ? 'ghero__check--ok' : 'ghero__check--warn'] },
            icon(matches === checks.length ? 'checkCircle' : 'alert', { size: 16 }),
            matches === checks.length ? `All ${checks.length} match Canvas` : `${checks.length - matches} of ${checks.length} differ from Canvas`),
          h('button', { class: 'btn btn--sm', type: 'button', onClick: () => editScale(settings), 'data-fkey': 'gpa-scale' }, icon('settings', { size: 13 }), 'GPA scale'))),
      h('div', { class: 'gtiles' }, analyses.map((a) => courseTile(a))),
      gpaTable(rows, scale, settings),
    );
  }

  /** One course: Gesso score + meter, Canvas score, verdict. */
  function courseTile(/** @type {any} */ a) {
    const c = a.course;
    const href = Gesso.router.href(`/courses/${c.id}/grades`);
    const title = Gesso.derive.courseTitle(c);
    const scope = a.scope === 'period' ? (c.grade.periodTitle || 'Current grading period') : null;
    const trend = a.input ? G.trend(a.input).map((p) => p.score) : [];
    let body;
    if (!a.input) {
      body = a.error
        ? h('p', { class: 'faint' }, 'Couldn’t load this grading period.')
        : h('div', { class: 'skel skel-row' });
    } else {
      const ours = a.current.score;
      const ourLetter = a.check?.status === 'match' && a.canvas.letter ? a.canvas.letter : (ours != null ? G.letterFor(ours, a.scheme.scheme) : null);
      body = [
        h('div', { class: 'gtile__main' },
          h('p', { class: 'gtile__value' }, fmtPct(ours), ourLetter && h('span', { class: 'gtile__letter' }, ourLetter)),
          Gesso.charts.sparkline(trend)),
        Gesso.charts.meter({ value: ours, label: `${title}: ${fmtPct(ours)}` }),
        h('p', { class: 'gtile__canvas' },
          h('span', { class: 'faint' }, 'Canvas'),
          c.hideFinalGrades ? h('span', null, 'Hidden') : h('span', { class: 'tabular' }, fmtPct(a.canvas.score), a.canvas.letter ? ` · ${a.canvas.letter}` : '')),
        tileVerdict(a),
      ];
    }
    return h('article', { class: 'panel gtile', style: { '--c': c.color } },
      h('header', { class: 'gtile__head' },
        h('span', { class: 'dot', 'aria-hidden': 'true' }),
        h('a', { class: 'gtile__title', href, title: Gesso.derive.courseTooltip(c) || undefined, 'data-fkey': `gtile:${c.id}` }, c.code || title),
        // A course named only by its code ("CSCI110-0101,…" → "CSCI110") would show the code twice.
        h('span', { class: 'gtile__sub truncate' }, scope || (title !== c.code ? title : c.term || ''))),
      body);
  }

  function tileVerdict(/** @type {any} */ a) {
    const ch = a.check;
    if (!ch) return h('p', { class: 'gtile__verdict gtile__verdict--info' }, icon('eyeOff', { size: 14 }), 'Canvas hides the total');
    if (ch.status === 'match') return h('p', { class: 'gtile__verdict gtile__verdict--ok' }, icon('checkCircle', { size: 14 }), 'Matches Canvas');
    if (ch.status === 'no_grades') return h('p', { class: 'gtile__verdict gtile__verdict--info' }, icon('clock', { size: 14 }), 'No grades yet');
    if (ch.status === 'no_canvas') return h('p', { class: 'gtile__verdict gtile__verdict--info' }, icon('clock', { size: 14 }), 'Canvas has no score yet');
    const cause = ch.causes[0];
    return h('div', { class: 'gtile__verdict gtile__verdict--warn' },
      icon('alert', { size: 14 }),
      h('div', null,
        h('p', null, h('strong', null, ch.diff == null ? 'Differs from Canvas' : `Differs by ${Math.abs(G.round(ch.diff) ?? 0)}`),
          cause ? ` · ${cause.rule}` : ' · cause unclear'),
        h('p', { class: 'gtile__why' }, cause ? cause.detail : 'No single Canvas rule explains it. See the course’s Grades tab.'),
        h('a', { class: 'link', href: Gesso.router.href(`/courses/${a.course.id}/grades`) }, 'Details')));
  }

  /** Letter, source, points, credits, included — the GPA's working. */
  function gpaTable(/** @type {any[]} */ rows, /** @type {Record<string, number>} */ scale, /** @type {any} */ settings) {
    const table = new Map(Object.entries(scale).map(([k, v]) => [G.letterKey(k), v]));
    const setCredits = (/** @type {string} */ id, /** @type {string} */ v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 30) return;
      Gesso.settings.update({ courseCredits: { ...(settings.courseCredits || {}), [id]: n } });
    };
    const setIncluded = (/** @type {string} */ id, /** @type {boolean} */ on) => {
      const ex = new Set(settings.gpaExcluded || []);
      if (on) ex.delete(id); else ex.add(id);
      Gesso.settings.update({ gpaExcluded: [...ex] });
    };
    return ui.panel({ title: 'GPA working', icon: 'grade', subtitle: 'Credits are yours to set: Canvas doesn’t know them. Default 3.' },
      h('div', { class: 'gtable-wrap' }, h('table', { class: 'gtable' },
        h('caption', { class: 'sr-only' }, 'How the GPA estimate is calculated'),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Course'), h('th', { scope: 'col' }, 'Letter'), h('th', { scope: 'col' }, 'From'),
          h('th', { scope: 'col', class: 'num' }, 'Points'), h('th', { scope: 'col', class: 'num' }, 'Credits'), h('th', { scope: 'col' }, 'In GPA'))),
        h('tbody', null, rows.map((r) => {
          const c = r.a.course;
          const pts = r.letter != null ? table.get(G.letterKey(r.letter)) : undefined;
          const credit = /** @type {HTMLInputElement} */ (h('input', {
            class: 'gcredit', type: 'number', min: '0', max: '30', step: '0.5', inputmode: 'decimal',
            'aria-label': `Credits for ${c.code || c.name}`, 'data-fkey': `credits:${c.id}`,
          }));
          credit.value = String(r.credits);
          credit.addEventListener('change', () => setCredits(c.id, credit.value));
          const inc = /** @type {HTMLInputElement} */ (h('input', { type: 'checkbox', 'aria-label': `Count ${c.code || c.name} in the GPA`, 'data-fkey': `ingpa:${c.id}` }));
          inc.checked = r.included;
          inc.addEventListener('change', () => setIncluded(c.id, inc.checked));
          return h('tr', { class: r.included ? '' : 'gtable__muted', style: { '--c': c.color } },
            h('th', { scope: 'row' }, h('span', { class: 'acourse' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { class: 'truncate' }, c.code || c.name))),
            h('td', null, r.letter || h('span', { class: 'faint' }, '—')),
            h('td', { class: 'faint' }, r.letter == null ? (c.hideFinalGrades ? 'Hidden by instructor' : 'No grade yet') : r.estimated ? 'Estimated (no Canvas letter)' : 'Canvas'),
            h('td', { class: 'num tabular' }, pts == null ? (r.letter ? h('span', { class: 'faint', title: 'Not on your GPA scale' }, 'not on scale') : '—') : pts.toFixed(2)),
            h('td', { class: 'num' }, credit),
            h('td', null, h('label', { class: 'gcheck' }, inc, h('span', { class: 'sr-only' }, 'Count in GPA'))));
        })))));
  }

  /** Edit the letter → points scale (stored in settings; reset = default). */
  function editScale(/** @type {any} */ settings) {
    const scale = { ...(settings.gpaScale || G.DEFAULT_GPA_SCALE) };
    const letters = Object.keys(G.DEFAULT_GPA_SCALE);
    for (const k of Object.keys(scale)) if (!letters.includes(k)) letters.push(k);
    const inputs = letters.map((l) => {
      const inp = /** @type {HTMLInputElement} */ (h('input', { class: 'gcredit', type: 'number', min: '0', max: '5', step: '0.01', 'aria-label': `Grade points for ${l}` }));
      inp.value = scale[l] != null ? String(scale[l]) : '';
      return /** @type {[string, HTMLInputElement]} */ ([l, inp]);
    });
    const dlg = Gesso.overlays.dialog({
      title: 'GPA scale',
      body: h('div', { class: 'gscale' },
        h('p', { class: 'muted' }, 'Grade points per letter. Letters left empty don’t count toward the GPA.'),
        h('div', { class: 'gscale__grid' }, inputs.map(([l, inp]) => h('label', { class: 'gscale__row' }, h('span', null, l), inp))),
        h('div', { class: 'gscale__actions' },
          h('button', { class: 'btn btn--ghost', type: 'button', onClick: () => { Gesso.settings.update({ gpaScale: null }); dlg.close(); } }, 'Reset to default'),
          h('button', {
            class: 'btn btn--primary', type: 'button',
            onClick: () => {
              /** @type {Record<string, number>} */
              const next = {};
              for (const [l, inp] of inputs) { const n = Number(inp.value); if (inp.value.trim() !== '' && Number.isFinite(n)) next[l] = n; }
              Gesso.settings.update({ gpaScale: next });
              dlg.close();
            },
          }, 'Save'))),
    });
  }

  Gesso.views = Gesso.views || {};
  Gesso.views.grades = { render, editScale };
})();
