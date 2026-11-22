// @ts-check
/**
 * Course workspace → Grades tab.
 *
 *   1. Your grade: Gesso's computed score next to Canvas's, a match /
 *      mismatch verdict with the rule that explains any difference, the
 *      final-score check, and "how this is calculated".
 *   2. What-if mode and the needed-score calculator.
 *   3. Categories (assignment groups): weight, score, meter, drops, share.
 *   4. Trend: the current grade after each grade was posted.
 *   5. Assignments by group, with why each one does or doesn't count, and
 *      what-if inputs when what-if mode is on.
 *
 * Nothing here writes to Canvas. What-if scores live in the workspace's
 * `local` state (this tab's ctx) and vanish on reload.
 */
(() => {
  const { h } = Gesso.dom;
  const { icon } = Gesso.icons;
  const ui = Gesso.ui;
  const G = Gesso.grades;
  const { toDate, dueLabel, monthDay } = Gesso.time;

  const fmtPct = (/** @type {number|null} */ n) => (n == null ? '—' : `${G.round(n)}%`);
  const fmtPts = (/** @type {number|null} */ n) => (n == null ? '—' : String(G.round(n)));

  /** Why an item does or doesn't count, as a pill. */
  const REASON = /** @type {Record<string, [string, any, string]>} */ ({
    excused: ['Excused', null, 'Excused: left out of the grade entirely.'],
    omitted: ['Not counted', null, 'Set to not count toward the final grade.'],
    pending: ['Pending review', 'info', 'Partly graded (e.g. a quiz with essay questions). Canvas leaves it out of the current grade until it is fully graded.'],
    unposted: ['Not posted', 'info', "Graded but not posted yet, so it doesn't count for you yet."],
    ungraded: ['No grade yet', null, 'Not graded yet: left out of the current grade, counted as 0 in the final grade.'],
    not_graded: ['Ungraded', null, '“Not graded” assignment: never part of the grade.'],
    whatif: ['What-if', 'accent', 'Your what-if score (only on this page).'],
  });

  /** @param {any} ctx  the workspace's `local` object + per-render fields */
  function render(ctx) {
    const { course, state, now } = ctx;
    if (course.role !== 'student') {
      return h('div', { class: 'panel' }, ui.emptyState({ icon: 'chart', title: 'No grades here', body: `You're enrolled as ${course.role}; grades are calculated for student enrollments.` }));
    }
    ctx.gWhatIf ||= new Map();
    const whatIf = ctx.gWhatIfOn && ctx.gWhatIf.size ? ctx.gWhatIf : null;
    const a = Gesso.gradeSources.analyze(course, state.data, { now, whatIf });

    if (!a.input) {
      if (a.error) {
        return h('div', { class: 'panel' }, ui.emptyState({
          icon: 'wifiOff', title: "Couldn't load this grading period",
          body: `Canvas didn't return the assignments for ${course.grade.periodTitle || 'the current grading period'}.`,
          action: h('button', { class: 'btn btn--sm', type: 'button', onClick: () => { Gesso.resources.invalidate(`gradeperiod:${course.id}:${course.grade.periodId}`); ctx.rerender(); } }, 'Retry'),
        }));
      }
      return h('div', { class: 'stack' }, h('div', { class: 'panel' }, [0, 1, 2].map(() => h('div', { class: 'skel skel-row' }))));
    }

    return h('div', { class: 'stack grades' },
      checkPanel(a, ctx),
      h('div', { class: 'grades-tools' }, whatIfPanel(a, ctx), neededPanel(a, ctx)),
      categoriesPanel(a, ctx),
      trendPanel(a),
      assignmentsPanel(a, ctx),
    );
  }

  // ---------------------------------------------------------------------------
  // 1. Your grade + cross-check
  // ---------------------------------------------------------------------------

  /** The letter for Gesso's score: Canvas's when the scores agree, else from the scheme. */
  function ourLetter(/** @type {any} */ a, /** @type {number|null} */ score) {
    if (score == null) return null;
    if (a.canvas.letter && a.check?.status === 'match' && score === a.current.score) return { value: a.canvas.letter, estimated: false };
    return { value: G.letterFor(score, a.scheme.scheme), estimated: a.scheme.verified !== true };
  }

  function statTile(/** @type {string} */ label, /** @type {number|null} */ score, /** @type {any} */ letter, /** @type {string} */ sub, /** @type {string|null} */ cls = null) {
    return h('div', { class: ['gstat', cls] },
      h('p', { class: 'gstat__label' }, label),
      h('p', { class: 'gstat__value' },
        h('span', null, fmtPct(score)),
        letter?.value && h('span', { class: 'gstat__letter' }, letter.value, letter.estimated && h('span', { class: 'gstat__est', title: 'Estimated from a grading scale, not Canvas’s own letter' }, ' est.'))),
      Gesso.charts.meter({ value: score, label: `${label}: ${fmtPct(score)}` }),
      sub && h('p', { class: 'gstat__sub' }, sub));
  }

  function verdict(/** @type {any} */ check, /** @type {any} */ course, { compact = false } = {}) {
    if (!check) {
      return h('div', { class: 'gverdict gverdict--info' }, icon('eyeOff', { size: 16 }),
        h('div', null, h('p', { class: 'gverdict__title' }, 'Canvas hides the course total here'),
          !compact && h('p', { class: 'gverdict__body' }, 'Your instructor turned off totals for students, so there is nothing to compare with. Gesso’s number uses only the scores you can see.')));
    }
    if (check.status === 'match') {
      return h('div', { class: 'gverdict gverdict--ok' }, icon('checkCircle', { size: 16 }),
        h('p', { class: 'gverdict__title' }, 'Matches Canvas'));
    }
    if (check.status === 'no_grades') {
      return h('div', { class: 'gverdict gverdict--info' }, icon('clock', { size: 16 }), h('p', { class: 'gverdict__title' }, 'No grades yet'));
    }
    if (check.status === 'no_canvas') {
      return h('div', { class: 'gverdict gverdict--info' }, icon('clock', { size: 16 }),
        h('div', null, h('p', { class: 'gverdict__title' }, 'Canvas hasn’t calculated a score yet'),
          !compact && h('p', { class: 'gverdict__body' }, 'Canvas shows no score for this course, but some of your work is graded. Canvas usually catches up within minutes.')));
    }
    const diff = check.diff;
    const head = check.ours == null
      ? 'Gesso has no score, but Canvas does'
      : `Differs from Canvas by ${Math.abs(G.round(diff) ?? 0)} point${Math.abs(diff) === 1 ? '' : 's'} (${diff > 0 ? 'Gesso higher' : 'Canvas higher'})`;
    return h('div', { class: 'gverdict gverdict--warn' }, icon('alert', { size: 16 }),
      h('div', null,
        h('p', { class: 'gverdict__title' }, head),
        compact
          ? (check.causes[0] && h('p', { class: 'gverdict__body' }, h('strong', null, `${check.causes[0].rule}. `), check.causes[0].detail))
          : check.causes.length
            ? [
              h('p', { class: 'gverdict__body' }, check.causes.length > 1
                ? (check.combined ? 'Canvas’s number is explained by these rules together:' : 'Each of these rules alone would explain Canvas’s number:')
                : (check.combined ? 'Canvas’s number is explained by these rules together:' : 'Which rule explains it:')),
              h('ul', { class: 'gcauses' }, check.causes.map((/** @type {any} */ c) => h('li', null, h('strong', null, c.rule), ' ', c.detail))),
            ]
            : [
              h('p', { class: 'gverdict__body' }, 'No single rule explains the difference. Gesso re-ran Canvas’s calculation with each of these changed, and none gave Canvas’s number: ',
                check.checked.join(', '), '.'),
              h('p', { class: 'gverdict__body' }, 'Likely causes Gesso can’t see: a grade changed since the last sync (try Refresh), or Canvas still recalculating. If it stays, compare with Canvas’s Grades page.'),
            ]));
  }

  function checkPanel(/** @type {any} */ a, /** @type {any} */ ctx) {
    const { course } = a;
    const scope = a.scope === 'period'
      ? `${course.grade.periodTitle || 'Current grading period'} (grading period)`
      : 'Whole course';
    const how = a.current.weighted ? 'weighted by assignment group' : 'total points';
    const ours = a.current.score;
    const tiles = [
      statTile('Gesso', ours, ourLetter(a, ours), a.current.weighted ? `Weighted${a.current.scaled ? `, scaled from ${a.current.fullWeight}%` : ''}` : `${fmtPts(a.current.earned)} / ${fmtPts(a.current.possible)} pts`),
      statTile('Canvas', a.canvas.score, a.canvas.letter ? { value: a.canvas.letter, estimated: false } : null, course.hideFinalGrades ? 'Hidden by instructor' : 'Canvas’s own calculation'),
    ];
    if (a.whatIf) {
      const delta = a.whatIf.score != null && ours != null ? G.round(a.whatIf.score - ours) : null;
      tiles.push(statTile('What-if', a.whatIf.score, ourLetter(a, a.whatIf.score), delta == null ? '' : `${delta >= 0 ? '+' : ''}${delta} vs. now`, 'gstat--whatif'));
    }
    const fc = a.finalCheck;
    return ui.panel({ title: 'Your grade', icon: 'chart', subtitle: `${scope} · ${how}`, id: 'grade-check' },
      h('div', { class: 'gstats' }, tiles),
      verdict(a.check, course),
      fc && fc.status !== 'no_grades' && h('div', { class: 'gfinal' },
        h('span', { class: 'gfinal__label' }, 'Counting ungraded work as 0'),
        h('span', { class: 'tabular' }, `Gesso ${fmtPct(a.final.score)} · Canvas ${fmtPct(a.canvas.finalScore)}`),
        fc.status === 'match'
          ? ui.pill('Matches', 'ok', 'check')
          : fc.status === 'mismatch' ? h('span', { class: 'pill pill--warn', title: fc.causes[0]?.detail || 'No single rule explains it' }, icon('alert', { size: 12 }), fc.causes[0] ? fc.causes[0].rule : 'Differs') : null),
      howItWorks(a));
  }

  function howItWorks(/** @type {any} */ a) {
    const r = a.current;
    const items = [];
    items.push(a.scope === 'period'
      ? `Only assignments in ${a.course.grade.periodTitle || 'the current grading period'} count; Canvas decides which those are (by each assignment's due date for you).`
      : 'All assignments in the course count.');
    if (r.weighted) {
      items.push(`Groups are weighted: ${r.groups.map((/** @type {any} */ g) => `${g.name} ${g.weight}%`).join(', ')}.`);
      if (r.scaled) items.push(`Only ${r.fullWeight}% of the weight has graded work so far, so it's scaled up to 100%, as Canvas does.`);
      const empty = r.groups.filter((/** @type {any} */ g) => !g.counted);
      if (empty.length) items.push(`Not counted yet (no graded work): ${empty.map((/** @type {any} */ g) => g.name).join(', ')}.`);
    } else {
      items.push(`Total points: ${fmtPts(r.earned)} of ${fmtPts(r.possible)} graded points.`);
    }
    for (const g of r.groups) {
      const dropped = g.items.filter((/** @type {any} */ i) => i.dropped);
      if (dropped.length) {
        items.push(`${g.name} drops ${[g.rules.dropLowest && `the lowest ${g.rules.dropLowest}`, g.rules.dropHighest && `the highest ${g.rules.dropHighest}`].filter(Boolean).join(' and ')}: ${dropped.map((/** @type {any} */ i) => `${i.name} (${fmtPts(i.score)}/${fmtPts(i.points)})`).join(', ')}. Canvas picks the scores whose removal helps your grade most, not simply the lowest percentages.`);
      }
    }
    const count = (/** @type {string} */ reason) => r.groups.reduce((n, /** @type {any} */ g) => n + g.items.filter((/** @type {any} */ i) => i.reason === reason).length, 0);
    const left = [['excused', 'excused'], ['pending', 'pending review'], ['unposted', 'not posted'], ['omitted', 'set to not count'], ['ungraded', 'not graded yet']]
      .map(([k, label]) => [count(k), label]).filter(([n]) => n).map(([n, label]) => `${n} ${label}`);
    if (left.length) items.push(`Left out of the current grade: ${left.join(', ')}.`);
    const sch = a.scheme;
    items.push(sch.source === 'course'
      ? `Letters use this course's grading scale${sch.verified === false ? ', which doesn’t give Canvas’s letter for Canvas’s score, so treat Gesso letters as estimates' : ''}.`
      : sch.verified === false
        ? 'This course uses its own letter scale, which Canvas doesn’t share with students. Canvas’s letter is shown; Gesso letters use Canvas’s default scale and are estimates.'
        : 'Letters use Canvas’s default scale (A 94, A− 90, B+ 87, …).');
    return h('details', { class: 'ghow' },
      h('summary', { 'data-fkey': 'grades-how' }, 'How this is calculated'),
      h('ul', null, items.map((t) => h('li', null, t))),
      h('p', { class: 'faint' }, 'Rules follow Canvas’s published grading guides; drop rules use the method from Kane & Kane, “Dropping Lowest Grades”.'));
  }

  // ---------------------------------------------------------------------------
  // 2. What-if and needed score
  // ---------------------------------------------------------------------------

  function whatIfPanel(/** @type {any} */ a, /** @type {any} */ ctx) {
    const on = !!ctx.gWhatIfOn;
    const n = ctx.gWhatIf.size;
    return ui.panel({ title: 'What-if', icon: 'sparkles', class: 'gtool' },
      h('p', { class: 'muted' }, on
        ? 'Type scores in the assignment list below. They stay on this page: nothing is sent to Canvas.'
        : 'Try scores on upcoming or graded work and see your grade change, with Canvas’s weights and drop rules applied.'),
      h('div', { class: 'gtool__row' },
        h('button', {
          class: ['btn', on && 'btn--primary'], type: 'button', 'aria-pressed': String(on), 'data-fkey': 'whatif-toggle',
          onClick: () => { ctx.gWhatIfOn = !on; ctx.rerender(); },
        }, icon(on ? 'check' : 'pencil', { size: 14 }), on ? 'What-if mode on' : 'Try what-if scores'),
        on && n > 0 && h('button', {
          class: 'btn btn--ghost', type: 'button', 'data-fkey': 'whatif-reset',
          onClick: () => { ctx.gWhatIf.clear(); ctx.rerender(); },
        }, `Reset ${n} score${n === 1 ? '' : 's'}`)),
      on && a.whatIf && h('p', { class: 'gtool__result', role: 'status' },
        'What-if grade ', h('strong', null, fmtPct(a.whatIf.score)),
        ourLetter(a, a.whatIf.score)?.value && ` (${ourLetter(a, a.whatIf.score)?.value})`,
        a.current.score != null && a.whatIf.score != null && ` · ${G.round(a.whatIf.score - a.current.score) >= 0 ? '+' : ''}${G.round(a.whatIf.score - a.current.score)} vs. now`));
  }

  function neededPanel(/** @type {any} */ a, /** @type {any} */ ctx) {
    const cut = G.cutoffs(a.scheme.scheme).filter((c) => c.min > 0);
    const cur = a.current.score ?? 0;
    if (ctx.gTarget == null || !cut.some((c) => c.min === ctx.gTarget)) {
      // Default: the next letter up, or the top letter when already above it.
      const above = [...cut].reverse().find((c) => c.min > cur);
      ctx.gTarget = (above || cut[0])?.min ?? 90;
    }
    const remaining = G.remainingWork(a.input, ctx.gWhatIfOn ? ctx.gWhatIf : null);
    if (ctx.gNeedFor !== 'all' && !remaining.some((x) => x.id === ctx.gNeedFor)) ctx.gNeedFor = 'all';
    const whatIf = ctx.gWhatIfOn && ctx.gWhatIf.size ? ctx.gWhatIf : null;
    const res = G.needed(a.input, ctx.gTarget, { assignmentId: ctx.gNeedFor === 'all' ? null : ctx.gNeedFor, whatIf });
    const target = cut.find((c) => c.min === ctx.gTarget);
    const tLabel = target ? `${target.letter} (${target.min}%)` : `${ctx.gTarget}%`;
    const one = ctx.gNeedFor !== 'all' ? remaining.find((x) => x.id === ctx.gNeedFor) : null;

    let text;
    if (res.status === 'none') text = 'Nothing left to grade that Canvas knows about.';
    else if (res.status === 'guaranteed') text = one ? `You keep at least ${tLabel} even with 0 on ${one.name}.` : `You keep at least ${tLabel} even with 0 on everything left.`;
    else if (res.status === 'unreachable') text = `Not reachable: even full marks${one ? ` on ${one.name}` : ' on everything left'} gives ${fmtPct(res.best)}.`;
    else if (one) text = [`Score at least `, h('strong', null, `${res.points} / ${one.points}`), ` (${res.pct}%) on ${one.name} for ${tLabel}.`, res.status === 'beyond' ? ' That’s more than full marks.' : ''];
    else text = [`Average at least `, h('strong', null, `${res.pct}%`), ` on the ${res.items.length} remaining item${res.items.length === 1 ? '' : 's'} for ${tLabel}.`, res.status === 'beyond' ? ' That’s more than full marks.' : ''];

    return ui.panel({ title: 'What do I need?', icon: 'grade', class: 'gtool' },
      h('div', { class: 'gtool__row' },
        ui.selectField({
          label: 'For', value: String(ctx.gTarget), fkey: 'need-target',
          options: cut.map((c) => [String(c.min), `${c.letter} (${c.min}%)`]),
          onChange: (v) => { ctx.gTarget = Number(v); ctx.rerender(); },
        }),
        ui.selectField({
          label: 'On', value: ctx.gNeedFor, fkey: 'need-for',
          options: [['all', `All remaining work (${remaining.length})`], ...remaining.map((x) => /** @type {[string, string]} */ ([x.id, `${x.name} (${x.points} pts)`]))],
          onChange: (v) => { ctx.gNeedFor = v; ctx.rerender(); },
        })),
      h('p', { class: 'gtool__result', role: 'status' }, text),
      h('p', { class: 'faint gtool__note' }, one
        ? 'Other ungraded work stays out, as in Canvas’s current grade. Weights and drop rules apply.'
        : 'Assumes the same percentage on every ungraded item. Weights and drop rules apply.',
      whatIf ? ' Includes your what-if scores.' : ''));
  }

  // ---------------------------------------------------------------------------
  // 3. Categories
  // ---------------------------------------------------------------------------

  function categoriesPanel(/** @type {any} */ a, /** @type {any} */ ctx) {
    const r = a.whatIf || a.current;
    return ui.panel({ title: 'Categories', icon: 'grid', subtitle: a.whatIf ? 'With your what-if scores' : (r.weighted ? 'Assignment groups and their weights' : 'Assignment groups (total points)') },
      h('div', { class: 'gtable-wrap' }, h('table', { class: 'gtable gcats' },
        h('caption', { class: 'sr-only' }, 'Grade by assignment group'),
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Group'),
          r.weighted && h('th', { scope: 'col', class: 'num' }, 'Weight'),
          h('th', { scope: 'col', class: 'num' }, 'Points'),
          h('th', { scope: 'col', class: 'gcats__meter' }, 'Grade'),
          h('th', { scope: 'col', class: 'num' }, r.weighted ? 'Adds to grade' : 'Share of grade'))),
        h('tbody', null, r.groups.map((/** @type {any} */ g) => {
          const dropped = g.items.filter((/** @type {any} */ i) => i.dropped).length;
          return h('tr', { class: !g.counted ? 'gtable__muted' : '' },
            h('th', { scope: 'row' }, g.name,
              (g.rules.dropLowest || g.rules.dropHighest) ? h('span', { class: 'gcats__rule' }, [g.rules.dropLowest && `drop lowest ${g.rules.dropLowest}`, g.rules.dropHighest && `drop highest ${g.rules.dropHighest}`].filter(Boolean).join(', '), dropped ? ` · ${dropped} dropped` : '') : null),
            r.weighted && h('td', { class: 'num tabular' }, `${g.weight}%`),
            h('td', { class: 'num tabular' }, g.possible ? `${fmtPts(g.score)} / ${fmtPts(g.possible)}` : '—'),
            h('td', { class: 'gcats__meter' },
              g.pct == null
                ? h('span', { class: 'faint' }, r.weighted ? 'No graded work · not counted' : 'No graded work')
                : h('div', { class: 'gcats__bar' }, Gesso.charts.meter({ value: Math.min(g.pct, 100), label: `${g.name}: ${fmtPct(g.pct)}` }), h('span', { class: 'tabular' }, fmtPct(g.pct)))),
            h('td', { class: 'num tabular' }, g.contribution == null ? '—' : r.weighted ? `${G.round(g.contribution)} pts` : fmtPct(g.contribution)));
        })),
        h('tfoot', null, h('tr', null,
          h('th', { scope: 'row' }, 'Course'),
          r.weighted && h('td', { class: 'num tabular' }, `${r.fullWeight}%${r.scaled ? ' → 100%' : ''}`),
          h('td', { class: 'num tabular' }, r.weighted ? '' : `${fmtPts(r.earned)} / ${fmtPts(r.possible)}`),
          h('td', null),
          h('td', { class: 'num tabular' }, h('strong', null, fmtPct(r.score))))))));
  }

  // ---------------------------------------------------------------------------
  // 4. Trend
  // ---------------------------------------------------------------------------

  function trendPanel(/** @type {any} */ a) {
    const pts = G.trend(a.input);
    const main = G.cutoffs(a.scheme.scheme).filter((c) => /^[A-D]$/.test(c.letter) && c.min > 0);
    return ui.panel({ title: 'Trend', icon: 'chart', subtitle: 'Your current grade after each grade was posted' },
      pts.length < 2
        ? h('p', { class: 'muted' }, pts.length ? `Only one graded item so far (${fmtPct(pts[0].score)}).` : 'No graded work yet.')
        : Gesso.charts.lineChart({
          points: pts.map((p) => ({ t: p.t, y: p.score, note: `after ${p.added.join(', ')}` })),
          label: `${a.course.code || Gesso.derive.courseTitle(a.course)} grade over time`,
          format: (y) => fmtPct(y),
          formatT: (t) => monthDay(t),
          refLines: main.map((c) => ({ y: c.min, label: c.letter })),
          color: a.course.color,
          tableHead: ['Date', 'Grade', 'Grades added'],
        }));
  }

  // ---------------------------------------------------------------------------
  // 5. Assignments
  // ---------------------------------------------------------------------------

  function assignmentsPanel(/** @type {any} */ a, /** @type {any} */ ctx) {
    const r = a.whatIf || a.current;
    const byId = new Map(a.input.assignments.map((/** @type {any} */ x) => [x.id, x]));
    const editing = !!ctx.gWhatIfOn;
    return h('div', { class: 'stack' }, r.groups.map((/** @type {any} */ g) => ui.panel({
      title: g.name,
      subtitle: [r.weighted && `${g.weight}% of grade`, g.pct != null && fmtPct(g.pct), `${g.items.filter((/** @type {any} */ i) => i.counted && !i.dropped).length} counted`].filter(Boolean).join(' · '),
    },
    g.items.length
      ? h('div', { class: 'gtable-wrap' }, h('table', { class: 'gtable' },
        h('thead', null, h('tr', null,
          h('th', { scope: 'col' }, 'Assignment'), h('th', { scope: 'col' }, 'Due'), h('th', { scope: 'col' }, 'Counts?'),
          h('th', { scope: 'col', class: 'num' }, editing ? 'What-if score' : 'Score'), h('th', { scope: 'col', class: 'num' }, '%'))),
        h('tbody', null, g.items.map((/** @type {any} */ it) => {
          const asg = byId.get(it.id);
          const due = toDate(asg?.dueAt);
          const real = asg?.submission;
          const reason = it.dropped ? ['Dropped', null, 'Dropped by the group’s drop rule (the choice that helps your grade most).'] : REASON[it.reason];
          const shown = it.score; // counted score (actual or what-if); null when it doesn't count
          return h('tr', { class: !it.counted || it.dropped ? 'gtable__muted' : '' },
            h('td', null, h('a', { class: 'link-plain', href: Gesso.derive.assignmentHref(a.course.id, it.id) }, it.name)),
            h('td', { class: 'faint nowrap' }, due ? dueLabel(due) : '—'),
            h('td', null, reason ? h('span', { class: `pill${reason[1] ? ` pill--${reason[1]}` : ''}`, title: reason[2] }, reason[0]) : h('span', { class: 'faint' }, 'Yes')),
            h('td', { class: 'num tabular' }, editing && it.reason !== 'omitted' && it.reason !== 'not_graded'
              ? whatIfInput(it, real, ctx)
              : real?.score != null || shown != null ? `${fmtPts(shown ?? real?.score ?? null)} / ${fmtPts(it.points)}` : `— / ${fmtPts(it.points)}`),
            h('td', { class: 'num tabular faint' }, (shown ?? null) != null && it.points ? fmtPct((shown / it.points) * 100) : '—'));
        }))))
      : h('p', { class: 'faint' }, 'No assignments in this group.'))));
  }

  function whatIfInput(/** @type {any} */ it, /** @type {any} */ real, /** @type {any} */ ctx) {
    const has = ctx.gWhatIf.has(it.id);
    const input = /** @type {HTMLInputElement} */ (h('input', {
      class: ['wi-input', has && 'wi-input--set'], inputmode: 'decimal', autocomplete: 'off',
      placeholder: real?.score != null ? String(real.score) : '—',
      'aria-label': `What-if score for ${it.name}, out of ${it.points ?? 0}`,
      'data-fkey': `wi:${it.id}`,
    }));
    input.value = has ? String(ctx.gWhatIf.get(it.id)) : '';
    input.addEventListener('input', () => {
      clearTimeout(ctx.gTimer);
      ctx.gTimer = window.setTimeout(() => {
        const v = input.value.trim();
        const n = Number(v.replace(',', '.'));
        if (v === '' || !Number.isFinite(n)) ctx.gWhatIf.delete(it.id); else ctx.gWhatIf.set(it.id, n);
        ctx.rerender();
      }, 150);
    });
    return h('span', { class: 'wi' }, input, h('span', { class: 'faint' }, `/ ${fmtPts(it.points)}`));
  }

  Gesso.courseGrades = { render };
})();
