// Unit tests for the pure parts of the extension. Run via the preview page:
//   open dev/preview/index.html?test=1 in Safari (results in the console), or
//   dev/tools/test.sh (headless WebKit).
(async () => {
  const results = [];
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (err) { results.push({ name, ok: false, error: String(err && err.message || err) }); }
  };
  const eq = (a, b, msg = '') => {
    const A = JSON.stringify(a), B = JSON.stringify(b);
    if (A !== B) throw new Error(`${msg} expected ${B}, got ${A}`);
  };
  const ok = (v, msg = 'expected truthy') => { if (!v) throw new Error(msg); };

  const { time, color, normalize: N, derive: D, changes: C } = Gesso;
  const client = Gesso.api.client;
  const H = 3600e3, DAY = 24 * H;

  // ---- time ----------------------------------------------------------------
  await test('duration carries minutes into hours', () => {
    eq(time.duration(4 * H + 59.6 * 60e3), '5h');
    eq(time.duration(30 * 60e3), '30m');
    eq(time.duration(10e3), '1m');
    eq(time.duration(2 * DAY + 4 * H), '2d 4h');
    eq(time.duration(-(26 * H)), '1d 2h');
  });
  await test('dayLabel today/tomorrow/yesterday', () => {
    const now = new Date(2026, 10, 18, 9);
    eq(time.dayLabel(new Date(2026, 10, 18, 23), now), 'Today');
    eq(time.dayLabel(new Date(2026, 10, 19, 1), now), 'Tomorrow');
    eq(time.dayLabel(new Date(2026, 10, 17, 1), now), 'Yesterday');
  });

  // ---- color ---------------------------------------------------------------
  await test('courseColor normalizes and falls back deterministically', () => {
    eq(color.courseColor('#ABC', '1'), '#abc');
    eq(color.courseColor('nope', '42'), color.courseColor(undefined, '42'));
    ok(color.courseGradient('#ff0000').startsWith('linear-gradient('));
  });

  await test('readableOn picks the higher-contrast text color', () => {
    eq(color.readableOn('#8b9cff'), '#0b0d12', 'default accent'); // white would be 2.5:1
    eq(color.readableOn('#4f7cff'), '#0b0d12');
    eq(color.readableOn('#1d3a8a'), '#ffffff');
    eq(color.readableOn('#ffffff'), '#0b0d12');
    eq(color.readableOn('#000000'), '#ffffff');
  });

  // ---- api client helpers --------------------------------------------------
  await test('parseLinkHeader extracts rels', () => {
    const l = client.parseLinkHeader('<https://umd.instructure.com/api/v1/x?page=2&per_page=100>; rel="next", <https://umd.instructure.com/api/v1/x?page=1>; rel="first"');
    eq(l.next, 'https://umd.instructure.com/api/v1/x?page=2&per_page=100');
    eq(l.first, 'https://umd.instructure.com/api/v1/x?page=1');
    eq(client.parseLinkHeader(null), {});
  });
  await test('buildUrl repeats array params', () => {
    const u = new URL(client.buildUrl('/api/v1/courses', { 'include[]': ['a', 'b'], x: 1, skip: null }));
    eq(u.searchParams.getAll('include[]'), ['a', 'b']);
    eq(u.searchParams.get('x'), '1');
    eq(u.searchParams.has('skip'), false);
  });

  // getAll / retry tests swap in a scripted fetch.
  const withFetch = async (handler, fn) => {
    const orig = window.fetch;
    window.fetch = handler;
    try { await fn(); } finally { window.fetch = orig; }
  };
  const json = (body, headers = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  await test('getAll follows Link rel=next and strips while(1);', async () => {
    const calls = [];
    await withFetch(async (url) => {
      calls.push(url);
      if (!url.includes('page=2')) return json([1, 2], { Link: '<https://umd.instructure.com/api/v1/t?page=2>; rel="next"' });
      return new Response('while(1);[3]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }, async () => {
      eq(await client.getAll('/api/v1/t'), [1, 2, 3]);
      ok(calls[0].includes('per_page=100'), 'per_page=100 sent');
    });
  });
  await test('getAll refuses cross-origin next links', async () => {
    await withFetch(async () => json([1], { Link: '<https://evil.example/api>; rel="next"' }), async () => {
      let threw = false;
      try { await client.getAll('/api/v1/t2'); } catch { threw = true; }
      ok(threw, 'should throw');
    });
  });
  await test('429 is retried, 401 maps to kind=auth', async () => {
    let n = 0;
    await withFetch(async () => (++n === 1 ? new Response('', { status: 429 }) : json({ ok: 1 })), async () => {
      eq(await client.get('/api/v1/retry'), { ok: 1 });
      eq(n, 2);
    });
    await withFetch(async () => json({ status: 'unauthenticated' }, {}, 401), async () => {
      try { await client.get('/api/v1/auth'); throw new Error('no throw'); }
      catch (e) { eq(e.kind, 'auth'); }
    });
  });

  await test('403 "Rate Limit Exceeded" is treated as throttling; other 403s are not', async () => {
    let n = 0;
    await withFetch(async () => (++n === 1 ? new Response('403 Forbidden (Rate Limit Exceeded)', { status: 403 }) : json({ ok: 2 })), async () => {
      eq(await client.get('/api/v1/retry403'), { ok: 2 });
      eq(n, 2);
    });
    await withFetch(async () => json({ errors: [{ message: 'user not authorized' }] }, {}, 403), async () => {
      try { await client.get('/api/v1/forbidden'); throw new Error('no throw'); }
      catch (e) { eq(e.kind, 'forbidden'); }
    });
  });

  await test('401 "unauthorized" is forbidden, 401 "unauthenticated" is logged out', async () => {
    await withFetch(async () => json({ status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] }, {}, 401), async () => {
      try { await client.get('/api/v1/courses/1/folders'); throw new Error('no throw'); }
      catch (e) { eq(e.kind, 'forbidden'); }
    });
    await withFetch(async () => json({ status: 'unauthenticated', errors: [{ message: 'user authorization required' }] }, {}, 401), async () => {
      try { await client.get('/api/v1/users/self2'); throw new Error('no throw'); }
      catch (e) { eq(e.kind, 'auth'); }
    });
  });

  await test('writes send the URL-decoded _csrf_token as X-CSRF-Token; GETs do not', async () => {
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => 'foo=1; _csrf_token=abc%2Bdef%3D%3D; bar=2' });
    const seen = [];
    try {
      await withFetch(async (url, init) => { seen.push(init); return new Response(null, { status: 204 }); }, async () => {
        await client.write('PUT', '/api/v1/x', { a: 1 });
        await client.get('/api/v1/y');
      });
    } finally {
      delete document.cookie;
      if (desc) Object.defineProperty(Document.prototype, 'cookie', desc);
    }
    eq(seen[0].headers['X-CSRF-Token'], 'abc+def==');
    eq(seen[0].headers['Content-Type'], 'application/json');
    eq(seen[1].headers['X-CSRF-Token'], undefined);
  });

  // ---- normalize -----------------------------------------------------------
  await test('deriveStatus precedence', () => {
    const s = (o) => ({ state: 'unsubmitted', score: null, grade: null, submittedAt: null, late: false, missing: false, excused: false, ...o });
    eq(N.deriveStatus(s({ excused: true, missing: true }), ['online_upload']), 'excused');
    eq(N.deriveStatus(s({ state: 'graded', score: 0, missing: true }), ['online_upload']), 'graded');
    eq(N.deriveStatus(s({ state: 'graded', score: null }), ['online_upload']), 'not_submitted'); // unposted grade, nothing submitted
    eq(N.deriveStatus(s({ missing: true }), ['online_upload']), 'missing');
    eq(N.deriveStatus(s({ submittedAt: 'x', late: true }), ['online_upload']), 'late');
    eq(N.deriveStatus(s({ submittedAt: 'x' }), ['online_upload']), 'submitted');
    eq(N.deriveStatus(null, ['on_paper']), 'none');
    eq(N.deriveStatus(null, ['online_upload']), 'not_submitted');
  });
  await test('course: restricted courses dropped, grading period preferred', () => {
    eq(N.course({ id: 5, access_restricted_by_date: true }, {}, {}), null);
    const c = N.course({
      id: 7, name: 'X', course_code: 'X1', term: { name: 'Default Term' },
      enrollments: [{ type: 'student', has_grading_periods: true, computed_current_score: 70, current_period_computed_current_score: 88, current_period_computed_current_grade: 'B+', current_grading_period_title: 'Q2' }],
    }, { course_7: '#112233' }, { course_7: 3 });
    eq(c.grade.score, 88); eq(c.grade.letter, 'B+'); eq(c.term, null); eq(c.color, '#112233'); eq(c.position, 3);
  });
  await test('plannerItem accepts has_feedback and with_feedback', () => {
    eq(N.plannerItem({ plannable_type: 'quiz', plannable_id: 1, plannable: {}, submissions: { has_feedback: true } }).submission.feedback, true);
    eq(N.plannerItem({ plannable_type: 'quiz', plannable_id: 1, plannable: {}, submissions: { with_feedback: true } }).submission.feedback, true);
    eq(N.plannerItem({ plannable_type: 'planner_note', plannable_id: 2, plannable: { title: 'n' }, html_url: '/api/v1/planner_notes/2' }).url, null);
  });
  await test('textSnippet strips HTML without executing it', () => {
    window.__pwned = false;
    eq(N.textSnippet('<p>Hi <b>there</b></p><img src=x onerror="window.__pwned=true">'), 'Hi there');
    ok(!window.__pwned, 'onerror must not run');
  });

  // ---- derive --------------------------------------------------------------
  const now = new Date();
  const iso = (ms) => new Date(now.getTime() + ms).toISOString();
  const asg = (id, dueMs, status, extra = {}) => ({ id, courseId: 'c1', name: `A${id}`, url: 'u', dueAt: dueMs == null ? null : iso(dueMs), points: 10, status, submission: null, gradePending: false, kind: 'assignment', ...extra });
  const data = {
    courses: [{ id: 'c1', name: 'C', role: 'student' }],
    coursework: {
      c1: { groups: [], assignments: [asg('1', 3 * H, 'not_submitted'), asg('2', 2 * DAY, 'submitted'), asg('3', -DAY, 'missing'), asg('4', -20 * DAY, 'not_submitted'), asg('5', null, 'not_submitted')] },
      gone: { groups: [], assignments: [asg('9', H, 'not_submitted')] },
    },
    planner: [
      { key: 'assignment:1', type: 'assignment', plannableType: 'assignment', id: '1', courseId: 'c1', assignmentId: '1', override: { id: 'o1', done: true } },
      { key: 'note:7', type: 'note', plannableType: 'planner_note', id: '7', courseId: null, title: 'N', date: iso(5 * H), submission: null, override: null },
      { key: 'event:8', type: 'event', plannableType: 'calendar_event', id: '8', courseId: 'c1', title: 'E', date: iso(H) },
    ],
  };
  await test('workItems merges planner done-state, skips events and inactive courses', () => {
    const items = D.workItems(data);
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    eq(byKey['assignment:1'].markedComplete, true);
    ok(byKey['note:7'], 'note included');
    ok(!byKey['event:8'], 'event excluded');
    ok(!byKey['assignment:9'], 'inactive course excluded');
  });
  await test('dueSoon / overdue buckets', () => {
    const items = D.workItems(data);
    const soon = D.dueSoon(items, 7, now);
    eq(soon.todo.map((i) => i.key), ['note:7']);
    eq(soon.done.map((i) => i.key).sort(), ['assignment:1', 'assignment:2']);
    eq(D.overdue(items, now).map((i) => i.key), ['assignment:3']); // 20-day-old unflagged item excluded
  });
  await test('gradeDisplay handles hidden, empty, and non-student', () => {
    eq(D.gradeDisplay({ role: 'student', hideFinalGrades: true, grade: {} }).primary, 'Hidden');
    eq(D.gradeDisplay({ role: 'student', grade: { score: null } }).primary, '—');
    eq(D.gradeDisplay({ role: 'ta', grade: {} }).primary, 'Ta');
    eq(D.gradeDisplay({ role: 'student', grade: { score: 91.25, letter: 'A-' } }).secondary, '91.3%');
  });

  // ---- changes -------------------------------------------------------------
  await test('diffCoursework detects grades, new and changed assignments', () => {
    const before = { c1: { assignments: [asg('1', DAY, 'submitted', { submission: { state: 'submitted', score: null } }), asg('2', DAY, 'not_submitted')] } };
    const after = { c1: { assignments: [
      asg('1', DAY, 'graded', { submission: { state: 'graded', score: 8, grade: '8', gradedAt: iso(-H) } }),
      asg('2', 2 * DAY, 'not_submitted'),
      asg('3', DAY, 'not_submitted'),
    ] }, c2: { assignments: [asg('4', DAY, 'not_submitted')] } };
    const types = C.diffCoursework(before, after).map((e) => e.type).sort();
    eq(types, ['assignment_changed', 'assignment_new', 'grade']); // c2 has no baseline → nothing
  });
  await test('feed merge dedupes, splitFeed respects session and clear', () => {
    const t = Date.now();
    const e = (id, at) => ({ id, type: 'grade', detectedAt: at, at: null });
    const feed = C.mergeFeed([e('a', t - DAY)], [e('a', t), e('b', t)], t);
    eq(feed.map((x) => x.id), ['b', 'a']);
    eq(feed.find((x) => x.id === 'a').detectedAt, t - DAY); // first detection kept
    const split = C.splitFeed(feed, { sessionStart: t - H, clearedAt: 0 });
    eq(split.fresh.map((x) => x.id), ['b']);
    eq(C.splitFeed(feed, { sessionStart: t - H, clearedAt: t }).fresh.length, 0);
  });
  await test('touchVisit starts a new visit after a long gap', () => {
    const t = Date.now();
    const v = C.touchVisit({ sessionStart: t - 2 * H, lastActive: t - H, clearedAt: 5 }, t);
    eq(v.sessionStart, t); eq(v.clearedAt, 5);
    eq(C.touchVisit({ sessionStart: 1, lastActive: t - 60e3 }, t).sessionStart, 1);
  });

  // ---- query (assignment center) -------------------------------------------
  const Q = Gesso.query;
  const wi = (key, o) => ({ key, kind: 'assignment', courseId: 'c1', title: key, url: 'u', dueAt: null, points: 10, status: 'not_submitted', late: false, markedComplete: false, score: null, grade: null, gradingType: 'points', ...o });
  const cmap = new Map([['c1', { id: 'c1', code: 'CSCI110', name: 'OOP I' }], ['c2', { id: 'c2', code: 'CALC220', name: 'Calculus II' }]]);
  await test('priority levels', () => {
    eq(Q.priority(wi('a', { dueAt: iso(5 * H) }), now).level, 'high');
    eq(Q.priority(wi('a', { dueAt: iso(4 * DAY) }), now).level, 'medium');
    eq(Q.priority(wi('a', { dueAt: iso(10 * DAY), points: 100 }), now).level, 'medium');
    eq(Q.priority(wi('a', { dueAt: iso(10 * DAY), points: 10 }), now).level, 'low');
    eq(Q.priority(wi('a', { dueAt: iso(-DAY), status: 'missing' }), now).level, 'high');
    eq(Q.priority(wi('a', { dueAt: iso(5 * H), status: 'submitted' }), now).level, 'none');
    eq(Q.priority(wi('a', { status: 'none' }), now).level, 'none');
  });
  await test('filterItems: search tokens, course, status, kind, range', () => {
    const items = [
      wi('Project 3', { dueAt: iso(H) }),
      wi('Quiz 6', { kind: 'quiz', courseId: 'c2', dueAt: iso(-2 * DAY), status: 'graded' }),
      wi('Reading', { kind: 'page', dueAt: null }),
    ];
    const F = (o) => Q.filterItems(items, { ...Q.EMPTY_FILTERS, ...o }, cmap, now).map((i) => i.key);
    eq(F({ query: 'proj csci' }), ['Project 3']);
    eq(F({ query: 'calculus' }), ['Quiz 6']); // matches course name
    eq(F({ courses: ['c2'] }), ['Quiz 6']);
    eq(F({ statuses: ['graded'] }), ['Quiz 6']);
    eq(F({ kinds: ['other'] }), ['Reading']);
    eq(F({ range: 'week' }), ['Project 3']);
    eq(F({ range: 'overdue' }), []); // graded → done, not overdue
    eq(F({ range: 'past30' }), ['Quiz 6']);
  });
  await test('sortItems keeps missing values last in both directions', () => {
    const items = [wi('a', { points: null }), wi('b', { points: 5 }), wi('c', { points: 20 })];
    eq(Q.sortItems(items, { key: 'points', dir: 'asc' }, cmap, now).map((i) => i.key), ['b', 'c', 'a']);
    eq(Q.sortItems(items, { key: 'points', dir: 'desc' }, cmap, now).map((i) => i.key), ['c', 'b', 'a']);
  });
  await test('groupItems puts undated items in their own final section', () => {
    const items = [wi('a', { dueAt: iso(H) }), wi('b', { dueAt: null, courseId: 'c2' }), wi('c', { dueAt: iso(2 * DAY), courseId: 'c2' })];
    for (const by of ['none', 'day', 'course', 'status']) {
      const g = Q.groupItems(items, by, { courseById: cmap, now });
      eq(g[g.length - 1].key, 'nodue', by);
      eq(g[g.length - 1].items.map((i) => i.key), ['b'], by);
    }
    const byGroup = Q.groupItems([wi('x', { groupId: 'g1' }), wi('y', { groupId: 'g1', dueAt: iso(H) })], 'group', { courseById: cmap, groupById: new Map([['g1', { name: 'HW', position: 1 }]]), now });
    eq(byGroup.map((g) => g.key), ['g1']);
    eq(byGroup[0].items.map((i) => i.key), ['y', 'x']); // dated first
  });
  await test('default due sort is a timeline: overdue → upcoming (soonest first) → undated → past', () => {
    const items = [
      wi('old-done', { dueAt: iso(-20 * DAY), status: 'graded' }),
      wi('far', { dueAt: iso(9 * DAY) }),
      wi('missing-old', { dueAt: iso(-30 * DAY), status: 'missing' }),
      wi('soon', { dueAt: iso(2 * H) }),
      wi('undated', { dueAt: null }),
      wi('late-yesterday', { dueAt: iso(-DAY) }),
      wi('done-early', { dueAt: iso(3 * DAY), status: 'submitted' }),
      wi('recent-done', { dueAt: iso(-2 * DAY), status: 'submitted' }),
      wi('stale-unflagged', { dueAt: iso(-40 * DAY) }), // >14 d, not flagged missing → past, not overdue
    ];
    const secs = Q.timelineSections(items, now);
    eq(secs.map((s) => s.key), ['overdue', 'upcoming', 'nodue', 'past']);
    eq(secs[0].items.map((i) => i.key), ['late-yesterday', 'missing-old']); // most recently due first (dashboard rule)
    eq(secs[1].items.map((i) => i.key), ['soon', 'done-early', 'far']); // soonest first; early submissions stay in place
    eq(secs[2].items.map((i) => i.key), ['undated']);
    eq(secs[3].items.map((i) => i.key), ['recent-done', 'old-done', 'stale-unflagged']); // most recent first
    ok(Q.isTimeline({ key: 'due', dir: 'asc' }) && !Q.isTimeline({ key: 'due', dir: 'desc' }), 'only due-asc is a timeline');
    // Grouping nests inside sections; undated never gets a duplicate "No current due date" day header.
    const lay = Q.layoutItems(items, { key: 'due', dir: 'asc' }, 'day', { courseById: cmap, now });
    eq(lay.map((l) => l.section.key), ['overdue', 'upcoming', 'nodue', 'past']);
    eq(lay[2].groups.map((g) => g.key), ['all']);
    ok(lay[1].groups.length >= 2 && lay[1].groups.every((g) => g.key !== 'nodue'), 'upcoming grouped by day');
    const byGroup = Q.layoutItems([wi('x', { groupId: 'g1' })], { key: 'due', dir: 'asc' }, 'group', { courseById: cmap, groupById: new Map([['g1', { name: 'HW', position: 1 }]]), now });
    eq(byGroup[0].groups.map((g) => g.label), ['HW']);
    // Any other sort is plain: one unsectioned block.
    const plain = Q.layoutItems(items, { key: 'due', dir: 'desc' }, 'none', { courseById: cmap, now });
    eq(plain.length, 1); eq(plain[0].section, null);
    eq(plain[0].groups[0].items[0].key, 'far');
  });
  // ---- calendar ----------------------------------------------------
  const CAL = Gesso.calendar;
  await test('calendar ranges, steps and routes', () => {
    const wed = new Date(2026, 10, 18, 15);
    const w = CAL.viewRange('week', wed);
    eq([time.dayKey(w.start), time.dayKey(w.end)], ['2026-11-15', '2026-11-22']); // Sunday start, end exclusive
    const m = CAL.viewRange('month', wed);
    eq([time.dayKey(m.start), time.dayKey(m.end)], ['2026-11-01', '2026-12-06']); // whole weeks covering November
    eq(CAL.routeFor('week', wed), '/calendar/week/2026-11-15');
    eq(CAL.routeFor('month', CAL.step('month', wed, 1)), '/calendar/month/2026-12');
    eq(CAL.routeFor('agenda', CAL.step('agenda', wed, -1)), '/calendar/agenda/2026-11-04');
    eq(CAL.monthKeys(w.start, w.end), ['2026-11']);
    eq(CAL.monthKeys(new Date(2026, 10, 29), new Date(2026, 11, 6)), ['2026-11', '2026-12']);
    eq(time.dayKey(CAL.monthBounds('2026-02').last), '2026-02-28');
    eq(CAL.parseDay('nope'), null);
    const r = Gesso.router.parse('#/calendar/month/2026-11');
    eq([r.name, r.params.view, r.params.date], ['calendar', 'month', '2026-11']);
    eq(Gesso.router.parse('#/calendar').name, 'calendar');
    eq(Gesso.router.parse('#/calendar/year').name, 'not_found');
  });
  await test('calendar merge: deadlines, notes, events; skips undated, deleted, hidden courses', () => {
    const base = new Date(2026, 10, 18);
    const at = (d, h, m = 0) => new Date(2026, 10, 18 + d, h, m).toISOString();
    const items = [
      wi('a1', { key: 'assignment:1', assignmentId: '1', dueAt: at(1, 23, 59), points: 100 }),
      wi('n1', { key: 'note:9', kind: 'note', courseId: null, dueAt: at(0, 9), points: null, status: 'none' }),
      wi('u1', { key: 'assignment:2', dueAt: null, staleDueAt: '2024-04-18T14:00:00Z' }), // past-term → never on the grid
      wi('d1', { key: 'assignment:3', assignmentId: '3', dueAt: at(1, 12), status: 'graded', points: 50 }),
    ];
    const ev = (o) => Gesso.normalize.calendarEvent({ id: 1, title: 'E', start_at: at(0, 10), end_at: at(0, 11), context_code: 'course_101', workflow_state: 'active', ...o });
    const events = [
      ev({ id: 1 }),
      ev({ id: 2, workflow_state: 'deleted' }),
      ev({ id: 3, context_code: 'course_zzz' }), // a course the user hid
      ev({ id: 4, context_code: 'user_1', all_day: true, all_day_date: time.dayKey(base), start_at: at(0, 5), end_at: at(0, 5) }),
      ev({ id: 5, context_code: 'course_section_9', effective_context_code: 'course_101' }),
      ev({ id: 1 }), // duplicate from an overlapping batch
    ];
    const entries = CAL.mergeEntries({ items, events, courseIds: new Set(['c1', '101']) });
    eq(entries.map((e) => e.key), ['event:4', 'note:9', 'event:1', 'event:5', 'assignment:3', 'assignment:1']); // all-day first, then by time
    const a = entries.find((e) => e.key === 'assignment:1');
    eq([a.source, a.href, a.done], ['deadline', '#/courses/c1/assignments/1', false]);
    eq(entries.find((e) => e.key === 'event:4').courseId, null);
    eq(CAL.sourceKey(entries.find((e) => e.key === 'event:4')), 'personal');
    eq(CAL.undatedCount(items), 1);
    const days = CAL.byDay(entries, base, time.addDays(base, 2));
    eq(days.get('2026-11-18').length, 4);
    eq(days.get('2026-11-19').map((e) => e.key), ['assignment:3', 'assignment:1']);
    // workload: open deadlines weighted by points (done work doesn't count)
    const wl = CAL.workload(days.get('2026-11-19'));
    eq([wl.count, wl.points, wl.score, wl.level], [1, 100, 3, 2]);
    eq(CAL.workload([]).level, 0);
    const heavy = CAL.workload([1, 2, 3].map((n) => ({ source: 'deadline', done: false, points: 100 })));
    eq(heavy.level, 4);
  });
  await test('calendar multi-day all-day events span each day; timed overlaps go side by side', () => {
    const allDay = Gesso.normalize.calendarEvent({ id: 9, title: 'Break', all_day: true, all_day_date: '2026-11-26', start_at: '2026-11-26T05:00:00Z', end_at: '2026-11-28T05:00:00Z', context_code: 'course_101', workflow_state: 'active' });
    const [e] = CAL.mergeEntries({ items: [], events: [allDay], courseIds: new Set(['101']) });
    const days = CAL.byDay([e], new Date(2026, 10, 22), new Date(2026, 10, 29));
    eq([...days].filter(([, l]) => l.length).map(([k]) => k), ['2026-11-26', '2026-11-27']);
    const day = new Date(2026, 10, 18);
    const T = (k, h1, m1, h2, m2) => ({ key: k, start: new Date(2026, 10, 18, h1, m1), end: new Date(2026, 10, 18, h2, m2) });
    const blocks = CAL.layoutDay([T('a', 10, 0, 10, 50), T('b', 10, 15, 11, 0), T('c', 10, 30, 11, 30), T('d', 13, 0, 14, 0), T('e', 11, 0, 11, 30)], day);
    const by = Object.fromEntries(blocks.map((b) => [b.entry.key, [b.col, b.cols]]));
    eq(by.a, [0, 3]); eq(by.b, [1, 3]); eq(by.c, [2, 3]);
    eq(by.e[0], 0); // reuses the first free column inside the same cluster
    eq(by.d, [0, 1]); // separate cluster → full width
    eq(CAL.hourRange(blocks), { from: 8, to: 20 });
    eq(CAL.hourRange([{ startMin: 7 * 60 + 15, endMin: 22 * 60 + 30 }]), { from: 7, to: 23 });
  });
  await test('ics export: escaping, folding, all-day dates, stable UIDs', () => {
    eq(CAL.icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
    const long = `SUMMARY:${'é'.repeat(60)}`;
    const folded = CAL.icsFold(long);
    const enc = new TextEncoder();
    ok(folded.split('\r\n').every((l) => enc.encode(l).length <= 75), 'every line ≤ 75 octets');
    eq(folded.split('\r\n').slice(1).every((l) => l.startsWith(' ')), true);
    eq(folded.replace(/\r\n /g, ''), long); // unfolds back losslessly
    const course = { id: 'c1', code: 'CSCI110', name: 'OOP I', originalName: 'OOP I' };
    const entries = [
      { key: 'assignment:1', source: 'deadline', kind: 'assignment', courseId: 'c1', title: 'Project 3, part A', start: new Date(Date.UTC(2026, 10, 19, 4, 59)), end: null, allDay: false, points: 100, href: '#/courses/c1/assignments/1', done: false, event: null },
      { key: 'event:9', source: 'event', kind: 'event', courseId: null, title: 'Break', start: new Date(2026, 10, 26), end: new Date(2026, 10, 28), allDay: true, points: null, href: null, done: false, event: { location: 'Home; away', address: null, description: '<p>Rest</p>' } },
    ];
    const ics = CAL.toICS(entries, { courseById: new Map([['c1', course]]), origin: 'https://umd.instructure.com', now: new Date(Date.UTC(2026, 10, 18, 12)) });
    ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'), 'header');
    ok(ics.endsWith('END:VCALENDAR\r\n'), 'footer + CRLF');
    ok(!/[^\r]\n/.test(ics), 'CRLF line endings only');
    const flat = ics.replace(/\r\n /g, '');
    ok(flat.includes('UID:assignment-1@gesso'), 'stable UID');
    ok(flat.includes('DTSTART:20261119T045900Z'), 'UTC due time');
    ok(!/UID:assignment-1[\s\S]*?DTEND[\s\S]*?END:VEVENT/.test(flat.split('BEGIN:VEVENT')[1]), 'deadline has no DTEND');
    ok(flat.includes('SUMMARY:CSCI110: Project 3\\, part A'), 'escaped summary');
    ok(flat.includes('URL:https://umd.instructure.com/#/courses/c1/assignments/1'), 'Gesso URL');
    ok(flat.includes('DTSTART;VALUE=DATE:20261126') && flat.includes('DTEND;VALUE=DATE:20261128'), 'all-day exclusive end');
    ok(flat.includes('LOCATION:Home\\; away'), 'location escaped');
    eq((flat.match(/BEGIN:VEVENT/g) || []).length, 2);
  });
  await test('overdue work ignores the date filter in the timeline (other filters still apply)', () => {
    const items = [
      wi('late', { dueAt: iso(-DAY) }), // overdue (unsubmitted, last 14 days)
      wi('flagged', { dueAt: iso(-30 * DAY), status: 'missing', courseId: 'c2' }),
      wi('soon', { dueAt: iso(2 * DAY) }),
      wi('old-done', { dueAt: iso(-3 * DAY), status: 'graded' }), // past but not overdue → still filtered out
    ];
    const f = { ...Q.EMPTY_FILTERS, range: 'week' };
    eq(Q.filterItems(items, f, cmap, now).map((i) => i.key), ['soon']);
    eq(Q.filterItems(items, f, cmap, now, { keepOverdue: true }).map((i) => i.key), ['late', 'flagged', 'soon']);
    eq(Q.filterItems(items, { ...f, courses: ['c1'] }, cmap, now, { keepOverdue: true }).map((i) => i.key), ['late', 'soon']);
    eq(Q.filterItems(items, { ...f, query: 'soon' }, cmap, now, { keepOverdue: true }).map((i) => i.key), ['soon']);
    eq(Q.timelineSections(Q.filterItems(items, f, cmap, now, { keepOverdue: true }), now)[0].key, 'overdue');
  });
  // ---- grades ------------------------------------------------------
  // gInput: engine input from Canvas REST API-shaped fixtures (snake_case, as the API sends them).
  const GR = Gesso.grades;
  const gInput = (subs, assigns, groups, weighted = false) => ({
    applyWeights: weighted,
    groups: groups.map((g, i) => ({ id: String(g.id), name: `G${g.id}`, position: i, weight: g.group_weight ?? 0,
      rules: { dropLowest: g.rules?.drop_lowest || 0, dropHighest: g.rules?.drop_highest || 0, neverDrop: (g.rules?.never_drop || []).map(String) } })),
    assignments: assigns.map((a) => {
      const s = subs.find((x) => String(x.assignment_id) === String(a.id));
      return { id: String(a.id), name: `A${a.id}`, groupId: String(a.groupId ?? groups[0].id), points: a.points_possible ?? null,
        omitFromFinal: !!a.omit_from_final_grade, gradingType: 'points', submissionTypes: ['online_upload'],
        submission: s ? { score: s.score ?? null, excused: !!s.excused, state: s.workflow_state || 'graded', postedAt: s.posted_at === undefined ? '2026-01-01T00:00:00Z' : s.posted_at, postedKnown: s.postedKnown ?? true } : null };
    }),
  });
  const S = (...scores) => scores.map((score, i) => ({ assignment_id: 201 + i, score }));
  const P = (...pts) => pts.map((points_possible, i) => ({ id: 201 + i, points_possible }));
  // Worked examples (written from public sources):
  // the example in Canvas's drop-rule guide, the examples in Kane & Kane's
  // "Dropping Lowest Grades", the weighting guide's example, and hand-computed cases.
  // One group; items are [score, points], score 'EX' = excused, null = no grade yet.
  // Returns [points kept, points possible kept, dropped ids].
  const oneGroup = (items, rules = {}, mode = 'current') => {
    const input = {
      applyWeights: false,
      groups: [{ id: 'g1', name: 'Quizzes', position: 0, weight: 100, rules: { dropLowest: 0, dropHighest: 0, neverDrop: [], ...rules } }],
      assignments: items.map(([score, points], i) => ({
        id: String(i + 1), name: `Q${i + 1}`, groupId: 'g1', points, gradingType: 'points', submissionTypes: ['online_quiz'], omitFromFinal: false,
        submission: {
          score: score === 'EX' ? null : score, excused: score === 'EX', state: score == null || score === 'EX' ? 'unsubmitted' : 'graded',
          postedAt: score == null || score === 'EX' ? null : '2026-09-01T00:00:00Z', postedKnown: true,
        },
      })),
    };
    const g = GR.compute(input, { mode }).groups[0];
    return [g.score, g.possible, g.items.filter((i) => i.dropped).map((i) => i.id)];
  };
  // A course; groups are { weight, items: [[score, points], …] }.
  const courseOf = (groups, weighted) => GR.compute({
    applyWeights: weighted,
    groups: groups.map((g, i) => ({ id: `g${i + 1}`, name: `G${i + 1}`, position: i, weight: g.weight ?? 0, rules: { dropLowest: 0, dropHighest: 0, neverDrop: [] } })),
    assignments: groups.flatMap((g, i) => g.items.map(([score, points], j) => ({
      id: `${i + 1}0${j + 1}`, name: `A${i + 1}.${j + 1}`, groupId: `g${i + 1}`, points, gradingType: 'points', submissionTypes: ['online_upload'], omitFromFinal: false,
      submission: { score, excused: false, state: score == null ? 'unsubmitted' : 'graded', postedAt: score == null ? null : '2026-09-01T00:00:00Z', postedKnown: true },
    }))),
  });
  await test('grades: drop lowest (Canvas guide and Kane & Kane examples)', () => {
    const low1 = { dropLowest: 1 };
    // Canvas guide 660670: 100% of 50, 65% of 100, 50% of 24. The 65% goes (62/74, 84%), not the 50%.
    eq(oneGroup([[50, 50], [65, 100], [12, 24]], low1), [62, 74, ['2']]);
    // Kane & Kane, Beth: the lowest percentage (1/20) is worth few points, so quiz 2 goes (81/120).
    eq(oneGroup([[80, 100], [20, 100], [1, 20]], low1), [81, 120, ['2']]);
    // Carl: drop one → quiz 4 goes; drop two → quizzes 2 and 3 go and quiz 4 stays.
    const carl = [[100, 100], [42, 91], [14, 55], [3, 38]];
    eq(oneGroup(carl, low1), [156, 246, ['4']]);
    eq(oneGroup(carl, { dropLowest: 2 }), [103, 138, ['2', '3']]);
    // Dale: quiz 0 is (20 + c)/40, quiz j is (20 + j − b)/(40 + 2j). A small change in c flips the answer.
    const dale = (c, b) => [[20 + c, 40], ...Array.from({ length: 10 }, (_, k) => [21 + k - b, 42 + 2 * k])];
    eq(oneGroup(dale(4, 1), { dropLowest: 5 }), [159, 320, ['2', '3', '4', '5', '6']]);
    eq(oneGroup(dale(6, 1), { dropLowest: 5 }), [136, 270, ['7', '8', '9', '10', '11']]);
    // c = 11, b = 2: the best four to drop and the best five to drop have nothing in common.
    eq(oneGroup(dale(11, 2), { dropLowest: 4 }), [184, 370, ['2', '3', '4', '5']]);
    eq(oneGroup(dale(11, 2), { dropLowest: 5 }), [136, 270, ['7', '8', '9', '10', '11']]);
    // Never drop: the 30/100 exam stays and pulls the average down, so 40/50 is worth more than 9/10.
    eq(oneGroup([[30, 100], [9, 10], [40, 50]], { dropLowest: 1, neverDrop: ['1'] }), [70, 150, ['2']]);
    eq(oneGroup([[9, 10], [40, 50]], low1), [9, 10, ['2']]); // without the exam, 9/10 stays
    // A 0-point extra-credit score can only help, so it's never the one dropped.
    eq(oneGroup([[9, 10], [6, 10], [2, 0]], low1), [11, 10, ['2']]);
    // No points possible at all: raw scores, the smallest goes.
    eq(oneGroup([[2, 0], [5, 0], [3, 0]], low1), [8, 0, ['1']]);
    // Too few scores: one droppable score always stays (guide: 1 + drops + never-drops needed).
    eq(oneGroup([[8, 10], [4, 10]], { dropLowest: 2 }), [8, 10, ['2']]);
    eq(oneGroup([[6, 10], [8, 10], [4, 10]], { dropLowest: 3, neverDrop: ['1'] }), [14, 20, ['3']]);
    eq(oneGroup([[5, 10], [9, 10], [8, 10], [7, 10], [6, 10]], { dropLowest: 3, neverDrop: ['1'] }), [14, 20, ['3', '4', '5']]); // the guide's 5 scores
    // Current grade: no grade yet = left out. Total (final) grade: 0, so that's the one dropped.
    eq(oneGroup([[8, 10], [9, 10], [null, 10]], low1), [9, 10, ['1']]);
    eq(oneGroup([[8, 10], [9, 10], [null, 10]], low1, 'final'), [17, 20, ['3']]);
    // Excused work isn't a score, so it can't be dropped.
    eq(oneGroup([[8, 10], [9, 10], ['EX', 10]], low1), [9, 10, ['1']]);
    // Ties (equally good choices; the docs are silent, so these follow observed behavior).
    eq(oneGroup([[10, 10], [20, 20], [15, 15]], low1), [30, 30, ['3']]); // one percentage everywhere: the higher id goes
    eq(oneGroup([[10, 10], [20, 20], [5, 10]], { dropLowest: 2 }), [20, 20, ['1', '3']]); // best = the top percentage: more points stays
    eq(oneGroup([[0, 2], [2, 2], [1, 4]], low1), [2, 4, ['3']]); // 2/4 or 3/6, both 50%: fewer points stays
    // Keeping only 0 out of 0 counts as unbounded (observed), so the real score goes.
    eq(oneGroup([[8, 10], [0, 0]], low1), [0, 0, ['1']]);
  });
  await test('grades: drop highest, both rules, and a brute-force check', () => {
    // Drop highest leaves the lowest possible group percentage (guide 660670): 18/20 goes (15/20),
    // not the 100% item (that would leave 23/30).
    eq(oneGroup([[10, 10], [5, 10], [18, 20]], { dropHighest: 1 }), [15, 20, ['3']]);
    eq(oneGroup([[2, 0], [5, 0], [3, 0]], { dropHighest: 1 }), [5, 0, ['2']]); // no points: the largest raw score
    // Both rules: the middle scores remain.
    eq(oneGroup([[10, 10], [9, 10], [7, 10], [5, 10], [2, 10]], { dropLowest: 1, dropHighest: 1 }), [21, 30, ['1', '5']]);
    eq(oneGroup([[2, 10], [10, 10], [9, 10], [7, 10], [5, 10]], { dropLowest: 1, dropHighest: 1, neverDrop: ['1'] }), [18, 30, ['2', '5']]);
    // Too few scores: drop highest drops its full count or nothing (observed).
    eq(oneGroup([[8, 10], [4, 10]], { dropHighest: 2 }), [12, 20, []]);
    eq(oneGroup([[8, 10], [4, 10], [6, 10]], { dropHighest: 2 }), [4, 10, ['1', '3']]);
    eq(oneGroup([[8, 10], [4, 10], [6, 10]], { dropLowest: 1, dropHighest: 2 }), [14, 20, ['2']]); // the 4 goes, then 2 more would leave none
    // A tie inside the range: 2/4 or 3/6, both 50%; drop highest keeps more points.
    eq(oneGroup([[0, 2], [2, 2], [3, 4]], { dropHighest: 1 }), [3, 6, ['2']]);
    // Random groups against brute force: the kept set must give the best (drop lowest) or the
    // worst (drop highest) percentage of every possible choice.
    let seed = 20261121;
    const rnd = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
    const POINTS = [1, 2, 5, 10, 12, 15, 20, 25, 40, 50, 100];
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + rnd(7);
      const items = Array.from({ length: n }, () => { const p = POINTS[rnd(POINTS.length)]; return [rnd(p + 1 + (rnd(5) === 0 ? 3 : 0)), p]; });
      const pinned = rnd(3) === 0 ? [String(1 + rnd(n))] : [];
      const highest = rnd(2) === 1;
      const want = 1 + rnd(3);
      const rules = highest ? { dropHighest: want, neverDrop: pinned } : { dropLowest: want, neverDrop: pinned };
      const [score, possible, gone] = oneGroup(items, rules);
      const free = items.map((_, i) => String(i + 1)).filter((id) => !pinned.includes(id));
      const drop = highest ? (free.length - want >= 1 ? want : 0) : Math.min(want, free.length - 1);
      eq(gone.length, drop, `trial ${trial}: number dropped.`);
      let best = null;
      const choose = (start, left, chosen) => {
        if (left === 0) {
          const kept = items.filter((_, i) => !chosen.includes(String(i + 1)));
          const s = kept.reduce((a, x) => a + x[0], 0);
          const p = kept.reduce((a, x) => a + x[1], 0);
          if (!best || (highest ? s * best[1] < best[0] * p : s * best[1] > best[0] * p)) best = [s, p];
          return;
        }
        for (let i = start; i < free.length; i++) choose(i + 1, left - 1, [...chosen, free[i]]);
      };
      choose(0, drop, []);
      ok(score * best[1] === best[0] * possible, `trial ${trial}: kept ${score}/${possible}, best ${best[0]}/${best[1]} for ${JSON.stringify({ items, rules })}`);
    }
  });
  await test('grades: course totals (weights, empty groups, extra credit, rounding)', () => {
    // Canvas guide 660669: 75% × 20 + 98% × 50 + 87% × 30 = 90.1.
    const A = { weight: 20, items: [[15, 20]] };
    const B = { weight: 50, items: [[49, 50]] };
    const full = courseOf([A, B, { weight: 30, items: [[87, 100]] }], true);
    eq([full.score, full.rounded, full.scaled, full.fullWeight], [90.1, 90.1, false, 100]);
    eq(full.groups.map((g) => g.contribution), [15, 49, 26.1]);
    // Same with nothing graded in the third group: the others are divided by their combined weight (0.70).
    const partial = courseOf([A, B, { weight: 30, items: [[null, 100]] }], true);
    eq([partial.rounded, partial.scaled, partial.fullWeight, partial.groups[2].counted], [91.43, true, 70, false]);
    // Weights over 100% are extra credit, so they're never scaled down (guide 660681).
    const ec = (b, e) => courseOf([{ weight: 60, items: [[80, 100]] }, { weight: 40, items: [[b, 50]] }, { weight: 10, items: [[e, 10]] }], true);
    eq(ec(45, 5).rounded, 89); // 48 + 36 + 5
    eq(ec(45, null).rounded, 84);
    eq(ec(null, null).rounded, 80); // 48 of 60 → 80%
    // A weighted group with no points possible isn't calculated (guide 660681).
    const zeroPts = courseOf([{ weight: 50, items: [[8, 10]] }, { weight: 50, items: [[3, 0]] }], true);
    eq([zeroPts.rounded, zeroPts.groups[1].counted], [80, false]);
    eq(courseOf([{ weight: 0, items: [[8, 10]] }], true).score, null); // every weight 0
    eq(courseOf([{ weight: 40, items: [[null, 10]] }], true).score, null); // nothing graded
    // Total points: 75 of 90. A 0-point extra-credit score adds to earned only (77 of 90).
    const pts = courseOf([{ items: [[45, 50]] }, { items: [[30, 40]] }], false);
    eq([pts.earned, pts.possible, pts.rounded], [75, 90, 83.33]);
    eq(courseOf([{ items: [[45, 50]] }, { items: [[30, 40], [2, 0]] }], false).rounded, 85.56);
    // Decimal weights landing on a half: 70% × 45.5 + 91% × 54.5 = 31.85 + 49.595 = 81.445 → 81.45.
    eq(courseOf([{ weight: 45.5, items: [[7, 10]] }, { weight: 54.5, items: [[91, 100]] }], true).rounded, 81.45);
    // round(): half up, on the decimal a float stands for.
    eq([GR.round(93.82499999999999), GR.round(1.005), GR.round(2.675), GR.round(-2.345), GR.round(12.3456, 3), GR.round(null)],
      [93.83, 1.01, 2.68, -2.35, 12.346, null]);
    // Letters: Canvas's default scheme (guide 661122); each bound is the lowest score for that letter.
    eq(GR.DEFAULT_SCHEME.map(([l]) => l).join(' '), 'A A- B+ B B- C+ C C- D+ D D- F');
    eq([94, 93.99, 70, 69.99, 66.995, 61, 60.99, 0].map((s) => GR.letterFor(s)), ['A', 'A-', 'C-', 'D+', 'D+', 'D-', 'F', 'F']);
  });
  await test('grades: excused, omitted, pending review, unposted, not graded', () => {
    const assigns = P(10, 10, 10, 10, 10, 10).map((a, i) => ({ ...a, ...(i === 2 ? { omit_from_final_grade: true } : {}) }));
    const subs = [
      { assignment_id: 201, score: 8 },
      { assignment_id: 202, score: null, excused: true },
      { assignment_id: 203, score: 0 }, // omitted from final grade
      { assignment_id: 204, score: 5, workflow_state: 'pending_review' },
      { assignment_id: 205, score: 9, posted_at: null }, // not posted → ignored
      { assignment_id: 206, score: 6, posted_at: null, postedKnown: false }, // field absent → counts
    ];
    const input = gInput(subs, assigns, [{ id: 301, group_weight: 100 }]);
    const c = GR.compute(input, { mode: 'current' });
    eq([c.earned, c.possible], [14, 20]); // 8 + 6
    const f = GR.compute(input, { mode: 'final' });
    eq([f.earned, f.possible], [19, 40]); // 8 + 5 (pending counts in final) + 0 (unposted → 0) + 6
    const reasons = Object.fromEntries(c.groups[0].items.map((i) => [i.id, i.reason]));
    eq([reasons['202'], reasons['203'], reasons['204'], reasons['205']], ['excused', 'omitted', 'pending', 'unposted']);
    const ng = gInput([{ assignment_id: 201, score: 5 }], [{ id: 201, points_possible: 10 }], [{ id: 301 }]);
    ng.assignments[0].gradingType = 'not_graded';
    eq(GR.compute(ng).score, null);
  });
  await test('grades: explain() finds the rule behind a mismatch', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const quizzes = gInput(S(9, 4, 10), P(10, 10, 10), [{ id: 301, rules: { drop_lowest: 1 } }]);
    eq(GR.compute(quizzes).rounded, 95); // 19/20 after dropping the 4
    eq(GR.explain(quizzes, 95).status, 'match');
    eq(GR.explain(quizzes, 95.004).status, 'match'); // same 2-decimal score
    const noDrop = GR.explain(quizzes, 76.67, { now }); // 23/30: Canvas didn't drop
    eq([noDrop.status, noDrop.causes.map((c) => c.id)], ['mismatch', ['no-drops']]);
    ok(noDrop.causes[0].detail.includes('drop lowest 1'), 'names the rule');
    // Two rules can explain the same number: both are listed.
    const amb = GR.explain(gInput(S(9, 4, 10, null), P(10, 10, 10, 10), [{ id: 301, rules: { drop_lowest: 1 } }]), 76.67, { now });
    eq(amb.causes.map((c) => c.id), ['no-drops', 'ungraded-zero']);
    // A grade posted an hour ago that Canvas hasn't folded in yet.
    const recent = gInput([{ assignment_id: 201, score: 80, posted_at: '2026-11-01T00:00:00Z' }, { assignment_id: 202, score: 40, posted_at: '2026-11-20T11:00:00Z' }], P(100, 100), [{ id: 301 }]);
    const r = GR.explain(recent, 80, { now });
    eq(r.causes.map((c) => c.id), ['recent-1']);
    ok(r.causes[0].detail.includes('A202'), 'names the item');
    const weird = GR.explain(recent, 12.34, { now });
    eq([weird.status, weird.causes.length], ['mismatch', 0]); // nothing explains it → say so
    ok(weird.checked.includes('Group weighting'), 'lists what was checked');
    eq(GR.explain(recent, null).status, 'no_canvas');
    // Weighted course that Canvas computed as points.
    const w = gInput(S(50, 90), [{ id: 201, points_possible: 100, groupId: 301 }, { id: 202, points_possible: 100, groupId: 302 }], [{ id: 301, group_weight: 80 }, { id: 302, group_weight: 20 }], true);
    eq(GR.compute(w).rounded, 58);
    eq(GR.explain(w, 70).causes.map((c) => c.id), ['weighting']);
  });
  await test('grades: needed score, trend, letters, GPA', () => {
    const input = gInput([{ assignment_id: 201, score: 80 }], P(100, 100), [{ id: 301 }]);
    // Canvas compares the 2-decimal score with the cutoff: 89.995 counts as 90.00.
    const n90 = GR.needed(input, 90, { assignmentId: '202' });
    eq([n90.status, n90.pct, n90.points], ['reachable', 99.99, 99.99]);
    const n85 = GR.needed(input, 85);
    eq([n85.status, n85.pct], ['reachable', 89.99]);
    eq(GR.needed(input, 40).status, 'guaranteed');
    const n99 = GR.needed(input, 99);
    eq([n99.status, n99.pct], ['beyond', 117.99]);
    const w = gInput([{ assignment_id: 201, score: 50 }], [{ id: 201, points_possible: 100, groupId: 301 }, { id: 202, points_possible: 100, groupId: 302 }], [{ id: 301, group_weight: 90 }, { id: 302, group_weight: 10 }], true);
    eq(GR.needed(w, 80).status, 'unreachable'); // 45 + 10 × 300% = 75 at most
    eq(GR.needed(gInput([{ assignment_id: 201, score: 8 }], P(10), [{ id: 301 }]), 90).status, 'none');
    const t = gInput([{ assignment_id: 201, score: 50, posted_at: '2026-10-01T00:00:00Z' }, { assignment_id: 202, score: 100, posted_at: '2026-10-08T00:00:00Z' }], P(100, 100), [{ id: 301 }]);
    eq(GR.trend(t).map((p) => p.score), [50, 75]);
    eq(GR.letterFor(93.995), 'A'); // rounds to 94.00 first
    eq(GR.letterFor(89.99), 'B+');
    eq(GR.letterFor(-5), 'F');
    eq(GR.letterFor(null), null);
    eq(GR.letterFor(90, [['A', 0.9], ['B', 0.8], ['F', 0]]), 'A');
    eq(GR.letterFor(79.99, [['A', 0.9], ['B', 0.8], ['F', 0]]), 'F');
    eq(GR.schemeFromStandard({ grading_scheme: [{ name: 'A', value: 0.9 }, { name: 'F', value: 0 }] }), [['A', 0.9], ['F', 0]]);
    eq(GR.round(88.545), 88.55);
    const g = GR.gpa([{ letter: 'A', credits: 3 }, { letter: 'B+', credits: 4 }, { letter: 'C', credits: 3 }, { letter: 'P', credits: 1 }, { letter: 'B−', credits: 0 }]);
    eq([GR.round(g.gpa), g.credits, g.counted, g.unknown], [3.12, 10, 3, ['P']]);
    eq(GR.gpa([]).gpa, null);
  });
  // ---- native dark mode ----------------------------------------------
  await test('native dark: page types from Canvas paths', () => {
    const T = Gesso.nativeDark.pageType;
    eq(['/courses/1', '/courses/1/pages/syllabus-info', '/courses/1/wiki'].map(T), ['pages', 'pages', 'pages']);
    eq(T('/courses/1/assignments/5'), 'assignments');
    eq(T('/courses/1/assignments/syllabus'), 'assignments');
    eq([T('/courses/1/discussion_topics/9'), T('/courses/1/announcements')], ['discussions', 'discussions']);
    eq([T('/courses/1/quizzes/3/take'), T('/courses/1/modules'), T('/courses/1/files/folder/x'), T('/courses/1/grades')], ['quizzes', 'modules', 'files', 'grades']);
    eq([T('/courses/1/users'), T('/courses/1/external_tools/4')], ['other', 'other']);
    eq([T('/conversations'), T('/calendar'), T('/files'), T('/users/7/files'), T('/grades'), T('/profile/settings'), T('/')], ['inbox', 'calendar', 'files', 'files', 'grades', 'other', 'other']);
  });
  await test('native dark: decide() follows mode, theme and per-type switches', () => {
    const D = (s, t = 'assignments') => Gesso.nativeDark.decide(s, t).on;
    eq(D({ theme: 'dark' }), true); // default: match the Gesso theme
    eq(D({ theme: 'light' }), false);
    eq(D({ theme: 'light', nativeDark: 'on' }), true);
    eq(D({ theme: 'dark', nativeDark: 'off' }), false);
    eq(D({ theme: 'dark', nativeDarkOff: ['assignments'] }), false);
    eq(D({ theme: 'dark', nativeDarkOff: ['assignments'] }, 'pages'), true);
    eq(Gesso.nativeDark.decide({ theme: 'dark', darkPdfs: true }, 'x'), { on: true, pdf: true, editor: true, type: 'x' });
    eq(Gesso.nativeDark.decide({ theme: 'dark', darkEditor: false }, 'x').editor, false);
  });
  await test('native dark: which computed background-images are photos', () => {
    const R = Gesso.nativeDark.rasterBackground;
    eq(R('url("https://umd.instructure.com/images/thumbnails/12/abc")'), true); // course card image
    eq(R('url(https://instructure-uploads.s3.amazonaws.com/account_1/attachments/9/avatar.jpg)'), true);
    eq(R('linear-gradient(rgba(0, 0, 0, 0.5), transparent), url("hero.png")'), true);
    eq(R('url("data:image/png;base64,iVBORw0KGgo=")'), true);
    eq(R('none'), false);
    eq(R(''), false);
    eq(R('linear-gradient(red, blue)'), false); // no image at all
    eq(R('url("/images/svg-icons/svg_icon_arrow.svg")'), false); // SVG = icon/glyph, stays with the page
    eq(R('url("data:image/svg+xml;charset=utf8,%3Csvg%3E%3C/svg%3E")'), false);
  });
  await test('native dark: settings mirror round-trips for the document_start decision', () => {
    Gesso.settings.writeNativeDarkMirror({ ...Gesso.settings.DEFAULTS, theme: 'light', nativeDark: 'on', nativeDarkOff: ['quizzes'], darkPdfs: true, darkEditor: false });
    eq(Gesso.settings.readNativeDarkMirror(), { nativeDark: 'on', theme: 'light', nativeDarkOff: ['quizzes'], darkPdfs: true, darkEditor: false });
    localStorage.setItem('gesso.nativeDark', '{broken');
    eq(Gesso.settings.readNativeDarkMirror(), null); // → applyEarly falls back to the theme mirror
    localStorage.removeItem('gesso.nativeDark');
  });
  await test('prefs v2 migration resets a saved assignment sort once, keeping the rest', () => {
    const v = { assignments: { sort: { key: 'priority', dir: 'desc' }, groupBy: 'course', filters: { range: 'week' } }, courseAssignments: { aSort: { key: 'title', dir: 'asc' } }, 'modules:1': { a: true } };
    eq(Gesso.prefs.migrate(v), true);
    eq(v.assignments, { groupBy: 'course', filters: { range: 'week' } });
    eq([v.courseAssignments, v['modules:1'], v.v], [undefined, { a: true }, Gesso.prefs.VERSION]);
    v.assignments.sort = { key: 'title', dir: 'asc' }; // the user changes it afterwards…
    eq(Gesso.prefs.migrate(v), false); // …and that choice sticks
    eq(v.assignments.sort.key, 'title');
  });

  // ---- course titles -------------------------------------------------------
  await test('cleanCourseName strips section lists, code prefixes, trailing terms', () => {
    const c = Gesso.derive.cleanCourseName;
    eq(c('CSCI110-0101,0102,0103,0104,0105,0106,0107'), 'CSCI110');
    eq(c('CALC150-0111,0112,0113,0121,0122,0123,0…'), 'CALC150');
    eq(c('CSCI110-0101'), 'CSCI110');
    eq(c('SCHL100-0101: Honors Program: Leadership First-Year Colloquium'), 'Honors Program: Leadership First-Year Colloquium');
    eq(c('WRIT105S-0312: Writing Seminar-Fall 2026 jam'), 'Writing Seminar-Fall 2026 jam');
    eq(c('CIVC201S-0101: Civic Leadership and Public Life-Fall 2026'), 'Civic Leadership and Public Life');
    eq(c('Computer Science Undergraduate Advising 2026-2027'), 'Computer Science Undergraduate Advising 2026-2027');
    eq(c('New Science Terp : CMNS Pre-Orientation'), 'New Science Terp : CMNS Pre-Orientation');
  });
  await test('courseTitle: nickname wins; tooltip only when different', () => {
    const raw = 'CSCI110-0101,0102,0103';
    eq(Gesso.derive.courseTitle({ name: raw, originalName: raw }), 'CSCI110');
    eq(Gesso.derive.courseTooltip({ name: raw, originalName: raw }), raw);
    eq(Gesso.derive.courseTitle({ name: 'OOP', originalName: raw }), 'OOP');
    eq(Gesso.derive.courseTooltip({ name: 'Calculus II', originalName: 'Calculus II' }), undefined);
  });

  // ---- deep links & routes -------------------------------------------------
  await test('deeplink.resolve maps native Canvas paths to Gesso routes', () => {
    const R = (p, o = {}) => Gesso.deeplink.resolve(p, o);
    const data = {
      courses: [{ id: '101' }],
      coursework: { 101: { assignments: [{ id: '7', quizId: '55', discussionId: null }, { id: '8', quizId: null, discussionId: '66' }] } },
      announcements: [{ id: '501', courseId: '101' }],
    };
    eq(R('/'), '/');
    eq(R('/calendar'), '/calendar');
    eq(R('/grades'), '/grades');
    eq(R('/courses/101', { data }), '/courses/101');
    eq(R('/courses/101/assignments', { data }), '/courses/101/assignments');
    eq(R('/courses/101/assignments/7/submissions/1', { data }), '/courses/101/assignments/7');
    eq(R('/courses/101/quizzes/55', { data }), '/courses/101/assignments/7');
    eq(R('/courses/101/quizzes/99', { data }), '/courses/101/assignments');
    eq(R('/courses/101/discussion_topics/501', { data }), '/courses/101/announcements/501'); // known announcement
    eq(R('/courses/101/discussion_topics/999', { data, hint: 'announcement' }), '/courses/101/announcements/999');
    eq(R('/courses/101/discussion_topics/66', { data }), '/courses/101/assignments/8'); // graded discussion
    eq(R('/courses/101/discussion_topics/12', { data }), '/courses/101/discussions/12'); // ungraded discussion → summary
    eq(R('/courses/101/announcements', { data }), '/courses/101/announcements');
    eq(R('/courses/101/modules/items/9', { data }), '/courses/101/modules');
    eq(R('/courses/101/files/folder/Lectures/Week%2012', { data, folders: () => [{ id: 'f3', fullName: 'course files/Lectures/Week 12' }] }), '/courses/101/files/f3');
    eq(R('/courses/101/grades', { data }), '/courses/101/grades');
    eq(R('/courses/101/pages/syllabus', { data }), '/courses/101');
    eq(R('/courses/999/assignments', { data }), '/'); // not an active course
    eq(R('/profile/settings', { data }), '/');
  });
  await test('router parses course sub-items and the open route', () => {
    const r = Gesso.router.parse('#/courses/101/announcements/501');
    eq([r.name, r.params.id, r.params.tab, r.params.item], ['course', '101', 'announcements', '501']);
    eq(Gesso.router.parse('#/open?path=/courses/1/assignments/2?reviewee_id=3').query.get('path'), '/courses/1/assignments/2?reviewee_id=3');
    const o = Gesso.router.parse('#/open?path=%2Fcourses%2F1&hint=announcement');
    eq([o.name, o.query.get('path'), o.query.get('hint')], ['open', '/courses/1', 'announcement']);
  });
  await test('foreign elements injected into the Gesso page are hidden', async () => {
    const before = document.adoptedStyleSheets.length;
    Gesso.takeover.hideForeignElements(document.getElementById('host'));
    const widget = document.createElement('div');
    widget.id = 'umd-help-widget';
    document.body.append(widget);
    eq(getComputedStyle(widget).display, 'none');
    eq(getComputedStyle(document.getElementById('host')).display, 'block');
    widget.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.slice(0, before);
  });

  // ---- assignment detail ----------------------------------------
  await test('assignmentDetail: layouts, rubric assessment, history, comments', () => {
    const raw = (o) => ({ id: 5, name: 'X', html_url: '/courses/1/assignments/5', submission_types: ['online_upload'], points_possible: 100, ...o });
    const D = (r, s) => Gesso.normalize.assignmentDetail(raw(r), s, '1');
    eq(D({}, null).layout, 'assignment');
    eq(D({ is_quiz_assignment: true, submission_types: ['online_quiz'] }, null).layout, 'quiz');
    const tool = D({ submission_types: ['external_tool'], external_tool_tag_attributes: { url: 'https://tool.example/x' } }, null);
    eq([tool.layout, tool.toolHost], ['tool', 'tool.example']);
    eq(D({ submission_types: ['discussion_topic'], discussion_topic: { html_url: '/courses/1/discussion_topics/9' } }, null).layout, 'discussion');
    const d = D({ allowed_attempts: -1, rubric: [{ id: '_a', description: 'C', points: 10, ratings: [{ id: 'r', description: 'ok', points: 10 }] }] }, {
      workflow_state: 'graded', score: 9, grade: '9', posted_at: 'x', submitted_at: '2026-11-01T00:00:00Z', attempt: 2,
      submission_history: [{ attempt: 1, submitted_at: 'a' }, { attempt: 2, submitted_at: 'b', score: 9 }, { attempt: null }],
      submission_comments: [{ id: 1, author_name: 'T', comment: 'hi', attachments: [{ id: 3, display_name: 'f.pdf', url: 'u' }] }],
      rubric_assessment: { _a: { points: 8, rating_id: 'r', comments: 'good' } },
      attachments: [{ id: 4, display_name: 'mine.zip', size: 10 }],
    });
    eq(d.status, 'graded');
    eq(d.allowedAttempts, -1);
    eq(d.rubric[0].ratings[0].id, 'r');
    eq(d.submissionDetail.rubricAssessment._a, { points: 8, ratingId: 'r', comments: 'good' });
    eq(d.submissionDetail.history.map((x) => x.attempt), [1, 2]);
    eq(d.submissionDetail.comments[0].attachments[0].name, 'f.pdf');
    eq(d.submissionDetail.attachments[0].name, 'mine.zip');
    eq(Gesso.normalize.assignmentDetail(raw({}), null, '1').submissionDetail, null);
  });
  await test('links: work items and feed events open the Gesso detail view', () => {
    eq(Gesso.derive.itemHref({ assignmentId: '7', courseId: '101', url: 'native' }), '#/courses/101/assignments/7');
    eq(Gesso.derive.itemHref({ assignmentId: null, courseId: '101', url: 'native' }), 'native'); // ungraded quiz / page
    eq(Gesso.derive.itemHref({ assignmentId: null, courseId: null, url: null }), null); // planner note
    const F = Gesso.changes.feedHref;
    eq(F({ type: 'grade', id: 'grade:7:9:9', courseId: '101', url: 'n' }), '#/courses/101/assignments/7'); // old event, no assignmentId
    eq(F({ type: 'assignment_new', id: 'new:8', courseId: '101', assignmentId: '8', url: 'n' }), '#/courses/101/assignments/8');
    eq(F({ type: 'assignment_changed', id: 'changed:9:x:10', courseId: '101', url: 'n' }), '#/courses/101/assignments/9');
    eq(F({ type: 'announcement', id: 'ann:501', courseId: '101', url: 'n' }), '#/courses/101/announcements/501');
    eq(Gesso.deeplink.resolve('/courses/101/assignments/syllabus'), '/courses/101');
  });
  await test('sanitize: click-to-load embeds, Gesso assignment links, equation images', () => {
    const div = document.createElement('div');
    div.append(Gesso.sanitize(
      '<a href="/courses/1/assignments/22">next</a> <a href="/courses/1/files/3?wrap=1">spec</a>'
      + '<iframe src="https://www.youtube.com/embed/abc"></iframe><iframe src="https://evil.example/x"></iframe>'
      + '<img class="equation_image other" src="/equation_images/x" width="120" style="x">'));
    const [a1, a2] = div.querySelectorAll('a');
    eq([a1.getAttribute('href'), a1.hasAttribute('target')], ['#/courses/1/assignments/22', false]);
    eq([a2.getAttribute('href'), a2.getAttribute('target')], ['https://umd.instructure.com/courses/1/files/3?wrap=1', '_blank']);
    ok(!div.querySelector('iframe'), 'no iframe until clicked');
    const btn = div.querySelector('.embed__load');
    ok(btn && btn.textContent.includes('www.youtube.com'), 'allowlisted embed → placeholder');
    ok(div.textContent.includes('Open embedded content (evil.example)'), 'other host → plain link');
    btn.click();
    const frame = div.querySelector('iframe.embed__frame');
    ok(frame && frame.getAttribute('sandbox').includes('allow-scripts'), 'sandboxed iframe after click');
    const img = div.querySelector('img');
    eq([img.getAttribute('class'), img.getAttribute('width'), img.hasAttribute('style')], ['equation_image', '120', false]);
  });

  // ---- dates, text fields, discussions -------------------------
  await test('isStaleDate: before term start (−14 d grace), course start, or >1 year without dates', () => {
    const S = Gesso.derive.isStaleDate;
    const now = new Date('2026-11-18T12:00:00Z');
    const term = { termStart: '2026-08-31T04:00:00Z' };
    eq(S('2024-04-18T14:00:00Z', term, now), true);
    eq(S('2026-08-25T00:00:00Z', term, now), false); // within the grace window
    eq(S('2026-09-15T00:00:00Z', term, now), false);
    eq(S('2026-01-10T00:00:00Z', { startAt: '2026-08-20T00:00:00Z' }, now), true);
    eq(S('2026-01-01T00:00:00Z', {}, now), false); // no term/course dates: within a year is fine
    eq(S('2025-10-01T00:00:00Z', {}, now), true);
    eq(S(null, term, now), false);
  });
  await test('workItems: past-term dates become "no current due date" and keep provenance', () => {
    const data = {
      courses: [{ id: 'c1', name: 'C', role: 'student', termStart: '2026-08-31T04:00:00Z' }],
      coursework: { c1: { groups: [], assignments: [{ id: '24', courseId: 'c1', name: 'Policy Brief Draft', url: 'u', dueAt: '2024-04-18T14:00:00Z', points: 20, status: 'missing', kind: 'discussion', submission: null }] } },
      planner: [{ key: 'discussion:902', type: 'discussion', plannableType: 'discussion_topic', id: '902', courseId: 'c1', title: 'Old', url: 'n',
        date: '2024-04-18T14:00:00Z', dateSource: 'plannable.todo_date', rawDates: { 'plannable.todo_date': '2024-04-18T14:00:00Z' }, submission: null, override: null }],
    };
    const items = Gesso.derive.workItems(data);
    const a = items.find((i) => i.key === 'assignment:24');
    eq([a.dueAt, a.staleDueAt, a.dateSource], [null, '2024-04-18T14:00:00Z', 'assignment.due_at']);
    const p = items.find((i) => i.key === 'discussion:902');
    eq([p.dueAt, p.dateSource], [null, 'planner plannable.todo_date']);
    eq(Gesso.derive.overdue(items, new Date('2026-11-18T12:00:00Z')).length, 0); // never "944 days overdue"
    eq(Gesso.derive.itemHref(p), '#/courses/c1/discussions/902'); // ungraded discussion → Gesso summary
    const g = Gesso.query.groupItems(items, 'day', { courseById: new Map(), now: new Date() });
    eq(g[g.length - 1].label, 'No current due date');
  });
  await test('planner date provenance prefers plannable_date, then todo_date', () => {
    const P = (o) => Gesso.normalize.plannerItem({ plannable_type: 'discussion_topic', plannable_id: 1, plannable: {}, ...o });
    eq(P({ plannable_date: 'A', plannable: { todo_date: 'B', due_at: 'C' } }).dateSource, 'plannable_date');
    const x = P({ plannable: { todo_date: 'B', due_at: 'C' } });
    eq([x.date, x.dateSource, x.rawDates], ['B', 'plannable.todo_date', { 'plannable.todo_date': 'B', 'plannable.due_at': 'C' }]);
  });
  await test('dates outside the current year show the year', () => {
    const old = new Date('2024-04-18T14:00:00Z');
    ok(Gesso.time.dueLabel(old).includes('2024'), 'dueLabel has year');
    ok(Gesso.time.monthDay(old).includes('2024'), 'monthDay has year');
    ok(!Gesso.time.monthDay(new Date()).includes(String(new Date().getFullYear())), 'current year omitted');
    ok(Gesso.time.dayLabel(old, new Date()).includes('2024'), 'dayLabel has year');
  });
  await test('richText renders Canvas markup/entities; plain text keeps newlines; names decode', () => {
    const a = Gesso.ui.richText('Requirements<br/> Uses evidence.<br/> Cites &amp; quotes.');
    eq(a.querySelectorAll('br').length, 2);
    ok(!a.textContent.includes('<br'), 'no literal <br/>');
    ok(a.textContent.includes('Cites & quotes.'), 'entity decoded');
    const b = Gesso.ui.richText('line 1\nline 2 with x < 5');
    eq([b.className.includes('rich--text'), b.textContent], [true, 'line 1\nline 2 with x < 5']);
    eq(Gesso.ui.richText('<img src=x onerror="window.__pw3=1">ok').querySelector('[onerror]'), null);
    eq(Gesso.normalize.fileName({ filename: 'Reading+guide%20v2.pdf' }), 'Reading guide v2.pdf');
    eq(Gesso.normalize.fileName({ display_name: 'Q&amp;A.pdf' }), 'Q&A.pdf');
    eq(Gesso.ui.plainText('a<br/>b &amp; c'), 'ab & c');
  });

  // ---- peer reviews ---------------------------------------------------------
  await test('peer reviews in the LIVE shape (…/assignments/:id?reviewee_id=, no assignment_id) route and date correctly', () => {
    const live = { plannable_type: 'assessment_request', plannable_id: '88', course_id: '9900123', plannable_date: '2024-04-18T14:00:00Z',
      html_url: '/courses/9900123/assignments/6100?reviewee_id=5550001',
      plannable: { id: '88', title: 'Policy Brief Draft', todo_date: '2024-04-18T14:00:00Z', workflow_state: 'assigned' }, submissions: false, planner_override: null };
    const n = Gesso.normalize.plannerItem(live);
    eq([n.review.parentAssignmentId, n.review.parentVia, n.review.revieweeId], ['6100', 'item URL', '5550001']);
    const course = { id: '9900123', role: 'student', termStart: '2026-08-24T04:00:00Z' };
    const cw = { groups: [], assignments: [
      { id: '6100', courseId: '9900123', name: 'Policy Brief Draft', dueAt: '2026-11-18T16:00:00Z', status: 'late', kind: 'assignment' },
      { id: '6101', courseId: '9900123', name: 'Policy Brief Introduction', dueAt: '2026-11-10T04:59:59Z', status: 'graded', kind: 'assignment' },
      { id: '6102', courseId: '9900123', name: 'Policy Brief', dueAt: '2026-11-24T04:59:59Z', status: 'not_submitted', kind: 'assignment' },
      { id: '6103', courseId: '9900123', name: 'Policy Brief Peer Review', dueAt: '2026-11-19T04:59:59Z', status: 'none', kind: 'assignment' }] };
    const data = { user: { id: '1' }, courses: [course], coursework: { 9900123: cw }, planner: [n] };
    const pr = Gesso.derive.workItems(data).find((i) => i.kind === 'peer_review');
    eq(pr.dueAt, '2026-11-19T04:59:59Z');
    eq(pr.dateSource, 'related assignment "Policy Brief Peer Review"');
    eq(Gesso.derive.itemHref(pr), '#/courses/9900123/peer-reviews/6100?request=88&reviewee=5550001');
    ok(pr.resolution.some((l) => l.startsWith('✓ related assignment')), 'trace records the winning step');
    ok(pr.resolution.some((l) => l.startsWith('✗ assignment peer_reviews_assign_at')), 'trace records failed steps');
    // A planner item cached before the `review` field existed still resolves (re-derived from its URL).
    const legacy = { ...n, review: undefined, url: 'https://umd.instructure.com/courses/9900123/assignments/6100?reviewee_id=5550001' };
    eq(Gesso.derive.itemHref(Gesso.derive.workItems({ ...data, planner: [legacy] }).find((i) => i.kind === 'peer_review')), '#/courses/9900123/peer-reviews/6100?request=88&reviewee=5550001');
    // No id anywhere → exact-name match on the planner title ("Draft" counts; "Policy Brief" isn't a match).
    const noId = { ...n, review: undefined, url: 'https://umd.instructure.com/courses/9900123/peer_reviews' };
    const byName = Gesso.derive.workItems({ ...data, planner: [noId] }).find((i) => i.kind === 'peer_review');
    eq([byName.review.parentAssignmentId, byName.review.parentVia], ['6100', 'name match']);
    // Native page: /assignments/:id?reviewee_id= (someone else) → summary; mine → detail.
    eq(Gesso.deeplink.resolve('/courses/9900123/assignments/6100?reviewee_id=5550001', { data }), '/courses/9900123/peer-reviews/6100?reviewee=5550001');
    eq(Gesso.deeplink.resolve('/courses/9900123/assignments/6100?reviewee_id=1', { data }), '/courses/9900123/assignments/6100');
  });
  await test('plannerItem parses peer reviews and never merges them into the assignment', () => {
    const P = (url, o = {}) => Gesso.normalize.plannerItem({ plannable_type: 'assessment_request', plannable_id: 9, html_url: url, plannable: { title: 'Essay', workflow_state: 'assigned', ...o } });
    const a = P('/courses/1/assignments/24/submissions/4724?reviewee_id=4724');
    eq([a.type, a.assignmentId, a.review.parentAssignmentId, a.review.revieweeId, a.review.done], ['peer_review', null, '24', '4724', false]);
    const b = P('/courses/1/assignments/24/anonymous_submissions/xYz', { workflow_state: 'completed' });
    eq([b.review.anonymousId, b.review.revieweeId, b.review.done], ['xYz', null, true]);
  });
  await test('peer-review due date: assign_at > sub-assignment > related assignment > planner; skips stale', () => {
    const course = { id: 'c', termStart: '2026-08-31T04:00:00Z' };
    const p = { review: { parentAssignmentId: '24' }, date: '2024-04-18T14:00:00Z', dateSource: 'plannable_date' };
    const parent = { id: '24', name: 'Policy Brief Draft' };
    const related = { id: '25', name: 'Policy Brief Peer Review', dueAt: '2026-11-19T04:59:59Z' };
    const D = (par, extra = []) => Gesso.derive.peerReviewDue(p, course, { assignments: [par, related, ...extra] });
    eq(D({ ...parent, peerReviewsDueAt: '2026-11-20T04:59:59Z' }).dateSource, 'assignment peer_reviews_assign_at');
    eq(D({ ...parent, peerReviewSubDueAt: '2026-11-21T04:59:59Z' }).dateSource, 'assignment peer-review sub-assignment');
    const r = D(parent);
    eq([r.dueAt, r.dateSource], ['2026-11-19T04:59:59Z', 'related assignment "Policy Brief Peer Review"']);
    // ambiguous related matches → not used → planner date is stale → no current due date
    const amb = D(parent, [{ id: '26', name: 'Policy Brief peer-review (round 2)', dueAt: 'x' }]);
    ok(amb.dueAt === '2026-11-19T04:59:59Z' || amb.dueAt === null, 'round 2 has extra word → not a match');
    const none = Gesso.derive.peerReviewDue(p, course, { assignments: [parent] });
    eq([none.dueAt, none.staleDueAt], [null, '2024-04-18T14:00:00Z']);
    eq(Gesso.derive.relatedPeerReviewAssignment({ id: '1', name: 'Lab Report' }, [{ id: '2', name: 'Essay Peer Review' }]), null);
  });
  await test('peer-review work items are labelled and open the Gesso summary', () => {
    const data = {
      user: { id: '1' },
      courses: [{ id: '103', role: 'student', termStart: '2026-08-31T04:00:00Z' }],
      coursework: { 103: { groups: [], assignments: [
        { id: '24', courseId: '103', name: 'Policy Brief Draft', url: 'u', dueAt: '2026-11-18T16:00:00Z', status: 'submitted', kind: 'assignment' },
        { id: '25', courseId: '103', name: 'Policy Brief Peer Review', url: 'u', dueAt: '2026-11-19T04:59:59Z', status: 'none', kind: 'assignment' }] } },
      planner: [Gesso.normalize.plannerItem({ plannable_type: 'assessment_request', plannable_id: '3301', course_id: '103', plannable_date: '2024-04-18T14:00:00Z',
        html_url: '/courses/103/assignments/24/submissions/4724?reviewee_id=4724', plannable: { title: 'Policy Brief Draft', workflow_state: 'assigned' } })],
    };
    const items = Gesso.derive.workItems(data);
    const pr = items.find((i) => i.kind === 'peer_review');
    eq(pr.title, 'Peer review: Policy Brief Draft');
    eq(pr.dueAt, '2026-11-19T04:59:59Z');
    eq(Gesso.derive.itemHref(pr), '#/courses/103/peer-reviews/24?request=3301&reviewee=4724');
    eq(items.find((i) => i.key === 'assignment:24').status, 'submitted'); // parent untouched
    eq(Gesso.ui.kindIcon('peer_review'), 'peerReview');
    eq(Gesso.deeplink.resolve('/courses/103/assignments/24/submissions/4724', { data }), '/courses/103/peer-reviews/24?reviewee=4724');
    eq(Gesso.deeplink.resolve('/courses/103/assignments/24/submissions/1', { data }), '/courses/103/assignments/24'); // my own submission
    eq(Gesso.deeplink.resolve('/courses/103/assignments/24/anonymous_submissions/aB3', { data }), '/courses/103/peer-reviews/24?anon=aB3');
  });

  // ---- sanitizer -----------------------------------------------------------
  await test('sanitize drops scripts, handlers, styles, javascript: links; converts iframes', () => {
    window.__pwned2 = false;
    const frag = Gesso.sanitize('<p style="color:black" onclick="window.__pwned2=true">Hi <a href="javascript:alert(1)">x</a> <a href="/courses/1">ok</a></p><script>window.__pwned2=true</script><iframe src="https://media.example.org/embed/x"></iframe><img src=x onerror="window.__pwned2=true"><h1>Big</h1>');
    const div = document.createElement('div');
    div.append(frag);
    ok(!div.querySelector('script, iframe, [style], [onclick], [onerror]'), 'dangerous bits removed');
    eq(div.querySelectorAll('a[href^="javascript"]').length, 0);
    eq(div.querySelector('a[href*="/courses/1"]').getAttribute('href'), 'https://umd.instructure.com/courses/1');
    ok(div.textContent.includes('Open embedded content (media.example.org)'), 'non-allowlisted iframe → link');
    ok(!div.querySelector('h1') && div.querySelector('h3'), 'h1 demoted to h3 (content sits under a panel h2)');
    ok(!window.__pwned2, 'nothing executed');
  });

  // ---- cache ---------------------------------------------------------------
  await test('cache round-trips and discards other schemas/origins', async () => {
    const meta = { ...Gesso.cache.emptyMeta(), userId: '1', syncedAt: { all: 123 } };
    await Gesso.cache.save({ courses: [{ id: 'c1' }], planner: [] }, meta);
    let loaded = await Gesso.cache.load();
    eq(loaded.data.courses, [{ id: 'c1' }]);
    eq(loaded.meta.syncedAt.all, 123);
    await browser.storage.local.set({ 'cache.meta': { ...meta, schema: -1 } });
    loaded = await Gesso.cache.load();
    eq(loaded.data, null);
    eq((await browser.storage.local.get('cache.courses'))['cache.courses'], undefined);
  });
  await test('cross-tab lock blocks a second owner', async () => {
    ok(await Gesso.cache.acquireLock(), 'first acquire');
    await browser.storage.local.set({ 'cache.lock': { owner: 'other-tab', at: Date.now() } });
    eq(await Gesso.cache.acquireLock(), false);
    ok(await Gesso.cache.acquireLock(true), 'force wins');
    await Gesso.cache.releaseLock();
  });

  // ---- planner: done / snooze / to-dos ---------------------
  const PL = Gesso.planner;
  await test('planner: override + note normalization (class names, description vs details, snooze marker)', () => {
    eq(['Assignment', 'Quizzes::Quiz', 'DiscussionTopic', 'WikiPage', 'PlannerNote', 'AssessmentRequest', 'sub_assignment', 'PeerReviewSubAssignment'].map(N.plannableType),
      ['assignment', 'quiz', 'discussion_topic', 'wiki_page', 'planner_note', 'assessment_request', 'sub_assignment', 'peer_review_sub_assignment']);
    const o = N.override({ id: 7, plannable_type: 'Quizzes::Quiz', plannable_id: 55, assignment_id: 3, marked_complete: true, dismissed: false, workflow_state: 'active' });
    eq([o.id, o.type, o.plannableId, o.assignmentId, o.done, o.deleted], ['7', 'quiz', '55', '3', true, false]);
    const n = N.plannerNote({ id: 1, title: 'X', description: `${N.SNOOZE_MARK} hidden`, course_id: 101, todo_date: '2026-11-22T05:00:00Z', linked_object_type: 'assignment', linked_object_id: 9 });
    eq([n.snooze, n.linked.type, n.linked.id, n.courseId], [true, 'assignment', '9', '101']);
    eq(N.plannerNote({ id: 2, title: 'Y', details: 'plain' }).snooze, false);
    eq(N.plannerItem({ plannable_type: 'planner_note', plannable_id: '3', plannable: { id: '3', title: 'Z', details: `${N.SNOOZE_MARK} x` } }).snooze, true);
  });
  await test('planner: noteDay reads date-only, midnight-UTC and real instants', () => {
    eq(PL.noteDay('2026-11-22'), '2026-11-22');
    eq(PL.noteDay('2026-11-22T00:00:00Z'), '2026-11-22');
    eq(PL.noteDay(new Date(2026, 10, 22, 0, 0).toISOString()), '2026-11-22');
    eq(PL.noteDay(new Date(2026, 10, 22, 23, 59).toISOString()), '2026-11-22');
    eq(PL.noteDay(null), null);
  });
  await test('planner: override targets and snooze link targets', () => {
    eq(PL.target({ plannable: { type: 'discussion_topic', id: '8' }, assignmentId: '3' }), { type: 'discussion_topic', id: '8' });
    eq(PL.target({ kind: 'quiz', quizId: '55', assignmentId: '3' }), { type: 'quiz', id: '55' });
    eq(PL.target({ kind: 'quiz', quizId: null, assignmentId: '3' }), { type: 'assignment', id: '3' }); // New Quizzes
    eq(PL.target({ kind: 'discussion', discussionId: '77', assignmentId: '24' }), { type: 'discussion_topic', id: '77' });
    eq(PL.target({ kind: 'note' }), null);
    eq(PL.linkTarget({ kind: 'assignment', courseId: '1', assignmentId: '3' }), { type: 'assignment', id: '3' });
    eq(PL.linkTarget({ kind: 'assignment', courseId: '1', assignmentId: '3', plannable: { type: 'sub_assignment', id: '90' } }), { type: 'assignment', id: '3' });
    eq(PL.linkTarget({ kind: 'note', courseId: '1', plannable: { type: 'planner_note', id: '5' } }), null);
    eq(PL.linkTarget({ kind: 'peer_review', courseId: '1', plannable: { type: 'assessment_request', id: '5' } }), null);
    eq(PL.linkTarget({ kind: 'assignment', courseId: null, assignmentId: '3' }), null);
    // An override found by assignment id when the plannable is a quiz.
    const idx = PL.overrideIndex([{ id: '1', type: 'quiz', plannableId: '99', assignmentId: '3', done: true }, { id: '2', type: 'assignment', plannableId: '4', done: true, deleted: true }]);
    eq(PL.overrideFor({ kind: 'quiz', quizId: null, assignmentId: '3' }, idx)?.id, '1');
    eq(PL.overrideFor({ kind: 'assignment', assignmentId: '4' }, idx), null, 'deleted overrides ignored');
  });
  await test('planner: workItems applies overrides, snoozes and notes; dueSoon/overdue skip snoozed', () => {
    const now = new Date();
    const iso = (h) => new Date(now.getTime() + h * H).toISOString();
    const tomorrow = time.dayKey(new Date(now.getTime() + DAY));
    const yesterday = time.dayKey(new Date(now.getTime() - DAY));
    const data = {
      courses: [{ id: '1', name: 'C', termStart: null, startAt: null }],
      coursework: { 1: { groups: [], assignments: [
        { id: 'a1', kind: 'assignment', name: 'Essay', dueAt: iso(5), status: 'not_submitted', submission: null, gradingType: 'points' },
        { id: 'a2', kind: 'assignment', name: 'Lab', dueAt: iso(10), status: 'not_submitted', submission: null, gradingType: 'points' },
        { id: 'a3', kind: 'assignment', name: 'Late lab', dueAt: iso(-20), status: 'not_submitted', submission: null, gradingType: 'points' },
        { id: 'a4', kind: 'assignment', name: 'Old snooze', dueAt: iso(30), status: 'not_submitted', submission: null, gradingType: 'points' },
      ] } },
      planner: [N.plannerItem({ plannable_type: 'planner_note', plannable_id: 's1', plannable: { id: 's1', title: 'Essay', details: `${N.SNOOZE_MARK} x`, todo_date: tomorrow } })],
      overrides: [{ id: 'o1', type: 'assignment', plannableId: 'a2', assignmentId: 'a2', done: true, dismissed: false, deleted: false }],
      notes: [
        { id: 's1', title: 'Essay', details: `${N.SNOOZE_MARK} x`, courseId: '1', todoDate: `${tomorrow}T00:00:00Z`, linked: { type: 'assignment', id: 'a1', url: null }, snooze: true, deleted: false },
        { id: 's2', title: 'Late lab', details: `${N.SNOOZE_MARK} x`, courseId: '1', todoDate: `${tomorrow}T00:00:00Z`, linked: { type: 'assignment', id: 'a3', url: null }, snooze: true, deleted: false },
        { id: 's3', title: 'Old snooze', details: `${N.SNOOZE_MARK} x`, courseId: '1', todoDate: `${yesterday}T00:00:00Z`, linked: { type: 'assignment', id: 'a4', url: null }, snooze: true, deleted: false },
        { id: 'n1', title: 'Buy lab goggles', details: 'size M', courseId: null, todoDate: iso(48), linked: null, snooze: false, deleted: false },
      ],
    };
    const items = D.workItems(data);
    const by = (k) => items.find((i) => i.key === k);
    ok(!by('note:s1'), 'snooze notes are not to-dos');
    eq(by('assignment:a2').markedComplete, true, 'override list marks done');
    eq(by('assignment:a1').snoozedUntil, tomorrow);
    ok(D.isSnoozed(by('assignment:a1'), now) && !D.isSnoozed(by('assignment:a4'), now), 'expired snooze shows again');
    eq([by('note:n1').kind, by('note:n1').details, by('note:n1').plannable.type], ['note', 'size M', 'planner_note']);
    const soon = D.dueSoon(items, 7, now);
    eq(soon.todo.map((i) => i.key).sort(), ['assignment:a4', 'note:n1']);
    eq(soon.snoozed.map((i) => i.key), ['assignment:a1']);
    eq(soon.done.map((i) => i.key), ['assignment:a2']);
    eq(D.overdue(items, now).map((i) => i.key), [], 'snoozed overdue item hidden');
  });
  await test('planner: snoozeChoices are future days, Monday is next week', () => {
    const now = new Date(2026, 10, 23, 9); // a Monday
    const c = Object.fromEntries(PL.snoozeChoices(now));
    eq(c.Tomorrow, '2026-11-24');
    eq(c['Next Monday'], '2026-11-30');
    const fri = PL.snoozeChoices(new Date(2026, 10, 20, 9)).map(([l]) => l);
    eq(fri, ['Tomorrow', 'In 2 days', 'In 3 days', 'In a week'], 'Friday: "Next Monday" = "In 3 days" is dropped');
  });

  // Write flows against the stateful mock (dev/preview/mock-env.js).
  window.__mockLatency = 0;
  await Gesso.sync.refresh({ force: true });
  const findItem = (key) => D.workItems(Gesso.store.get().data).find((i) => i.key === key);
  await test('planner: sync loads overrides and notes; mock override marks Lab 8 done', () => {
    const d = Gesso.store.get().data;
    ok(Array.isArray(d.overrides) && Array.isArray(d.notes), 'datasets loaded');
    eq(findItem('assignment:4').markedComplete, true);
  });
  await test('planner: setDone writes, reads back, and survives a re-sync', async () => {
    window.__mockWrites.length = 0;
    ok(await PL.setDone(findItem('assignment:1'), true), 'confirmed');
    const ov = window.__mockPlanner.overrides.find((o) => o.plannable_id === '1');
    eq([ov.plannable_type, ov.marked_complete], ['Assignment', true]);
    eq(findItem('assignment:1').markedComplete, true);
    ok(window.__mockWrites.some((w) => w.method === 'POST' && w.path === '/api/v1/planner/overrides'), 'POSTed');
    ok(await PL.setDone(findItem('assignment:1'), false), 'undo confirmed');
    eq(window.__mockWrites.filter((w) => w.path.startsWith('/api/v1/planner/overrides')).map((w) => w.method), ['POST', 'PUT'], 'second write updates the same override');
    await Gesso.sync.refresh({ force: true });
    eq(findItem('assignment:1').markedComplete, false);
  });
  await test('planner: a write Canvas does not save is reverted', async () => {
    window.__mockPlannerBroken = true;
    try {
      eq(await PL.setDone(findItem('assignment:2'), true), false);
      eq(findItem('assignment:2').markedComplete, false, 'reverted');
      eq(await PL.snooze(findItem('assignment:2'), time.dayKey(new Date(Date.now() + 2 * DAY))), false);
      eq(findItem('assignment:2').snoozedUntil, null, 'snooze reverted');
    } finally { window.__mockPlannerBroken = false; }
  });
  await test('planner: snooze creates a linked note, moves it, unsnooze deletes it', async () => {
    const d2 = time.dayKey(new Date(Date.now() + 2 * DAY));
    const d5 = time.dayKey(new Date(Date.now() + 5 * DAY));
    // The broken run above left an unsaved linked note in the mock, like a stale snooze in Canvas.
    ok(await PL.snooze(findItem('assignment:11'), d2), 'snoozed');
    const note = window.__mockPlanner.notes.find((n) => n.linked_object_id === '11' && n.workflow_state === 'active');
    eq([note.linked_object_type, note.course_id, note.title], ['assignment', '102', 'Problem Set 10']);
    eq(findItem('assignment:11').snoozedUntil, d2);
    ok(!D.workItems(Gesso.store.get().data).some((i) => i.key === `note:${note.id}`), 'snooze note hidden');
    ok(await PL.snooze(findItem('assignment:11'), d5), 'moved');
    eq(window.__mockPlanner.notes.filter((n) => n.linked_object_id === '11' && n.workflow_state === 'active').length, 1, 'still one note');
    eq(findItem('assignment:11').snoozedUntil, d5);
    ok(await PL.unsnooze(findItem('assignment:11')), 'unsnoozed');
    eq(note.workflow_state, 'deleted');
    eq(findItem('assignment:11').snoozedUntil, null);
  });
  await test('planner: snooze recovers a linked note left outside the synced list', async () => {
    const d3 = time.dayKey(new Date(Date.now() + 3 * DAY));
    // The broken test left a linked note for assignment 2 that the store never learned about.
    const stale = window.__mockPlanner.notes.find((n) => n.linked_object_id === '2' && n.workflow_state === 'active');
    ok(stale, 'stale note exists');
    stale.description = 'My own note about this lab';
    ok(!(await PL.snooze(findItem('assignment:2'), d3)), "the user's own linked note isn't hijacked");
    eq(stale.description, 'My own note about this lab');
    stale.description = `${N.SNOOZE_MARK} old`;
    ok(await PL.snooze(findItem('assignment:2'), d3), 'an old Gesso snooze is moved');
    eq(findItem('assignment:2').snoozedUntil, d3);
    ok(await PL.unsnooze(findItem('assignment:2')), 'cleanup');
  });
  await test('planner: to-dos create, edit (move course out), mark done, delete — each read back', async () => {
    const day = time.dayKey(new Date(Date.now() + DAY));
    const saved = await PL.createTodo({ title: 'Print poster', day, courseId: '101', details: 'A2' });
    ok(saved, 'created');
    let item = findItem(`note:${saved.id}`);
    eq([item.title, item.courseId, item.details], ['Print poster', '101', 'A2']);
    ok(await PL.updateTodo(saved.id, { title: 'Print poster (color)', day, courseId: null, details: '' }), 'edited');
    item = findItem(`note:${saved.id}`);
    eq([item.title, item.courseId], ['Print poster (color)', null]);
    ok(await PL.setDone(item, true), 'done');
    eq(window.__mockPlanner.overrides.find((o) => o.plannable_id === saved.id).plannable_type, 'PlannerNote');
    eq(findItem(`note:${saved.id}`).markedComplete, true);
    ok(await PL.deleteTodo(saved.id), 'deleted');
    ok(!findItem(`note:${saved.id}`), 'gone from lists');
  });
  await test('planner: selfTest passes against a working Canvas and cleans up', async () => {
    const before = window.__mockPlanner.notes.filter((n) => n.workflow_state === 'active').length;
    const r = await PL.selfTest(() => {}, { snoozeItem: findItem('assignment:21') });
    eq(r.steps.filter((st) => !st.ok).map((st) => `${st.label}: ${st.detail}`), []);
    ok(r.ok && r.steps.length === 12, `12 steps (got ${r.steps.length})`);
    eq(window.__mockPlanner.notes.filter((n) => n.workflow_state === 'active').length, before, 'nothing left behind');
  });
  await test('planner: selfTest reports a Canvas that drops writes, and cleans up', async () => {
    window.__mockPlannerBroken = true;
    let r;
    try { r = await PL.selfTest(() => {}); } finally { window.__mockPlannerBroken = false; }
    eq(r.ok, false);
    const bad = r.steps.find((st) => st.ok === false);
    ok(/Read the note back/.test(bad.label) && /todo_date/.test(bad.detail), bad.label + ' ' + bad.detail);
    eq(r.steps[r.steps.length - 1].label, 'Cleanup');
  });

  // ---- palette search, shortcuts, popup summary, settings ----------
  await test('search: fuzzy ranks substrings, word starts and initials', () => {
    const S = Gesso.search;
    ok(S.fuzzy('proj 3', 'Project 3: Bank Simulator') > 0);
    ok(S.fuzzy('bnk', 'Project 3: Bank Simulator') > 0, 'subsequence');
    eq(S.fuzzy('xyz', 'Project 3: Bank Simulator'), -1);
    eq(S.fuzzy('bank zz', 'Project 3: Bank Simulator'), -1, 'every word must match');
    ok(S.fuzzy('lab', 'Lab 9: Recursion') > S.fuzzy('lab', 'Syllabus quiz'), 'word start beats mid-word');
    ok(S.fuzzy('csci', 'CSCI110 Files') > S.fuzzy('csci', 'Notes about the CSCI exam schedule'), 'prefix + shorter wins');
    eq(S.fuzzy('', 'anything'), 0);
  });
  await test('search: index covers actions, views, courses, tabs, work, module pages, files, announcements', () => {
    const now = new Date();
    const state = {
      settings: { ...Gesso.settings.DEFAULTS, theme: 'dark' },
      data: {
        courses: [{ id: '1', name: 'CSCI110-0101', originalName: 'CSCI110-0101', code: 'CSCI110', color: '#4f7cff', position: 0 }],
        coursework: { 1: { groups: [], assignments: [{ id: 'a1', kind: 'assignment', name: 'Project 3: Bank Simulator', dueAt: new Date(now.getTime() + 5 * H).toISOString(), status: 'not_submitted', gradingType: 'points' }] } },
        planner: [], announcements: [{ id: 'n1', courseId: '1', title: 'Office hours moved', postedAt: now.toISOString() }],
      },
    };
    const extras = {
      modules: { 1: [{ id: 'm1', name: 'Week 1', items: [
        { id: 'i1', type: 'Page', title: 'Syllabus & course policies', url: 'https://umd.instructure.com/courses/1/pages/syllabus', contentId: null },
        { id: 'i2', type: 'Assignment', title: 'Project 3: Bank Simulator', url: 'https://umd.instructure.com/courses/1/assignments/a1', contentId: 'a1' },
        { id: 'i3', type: 'SubHeader', title: 'Read first', url: null },
      ] }] },
      files: [{ courseId: '1', folderId: 'f2', file: { id: '9', name: 'Lecture 10.pdf' } }],
    };
    const idx = Gesso.search.buildIndex(state, extras, now);
    const ids = new Set(idx.map((e) => e.id));
    for (const id of ['act:theme', 'act:refresh', 'act:todo', 'view:calendar', 'course:1', 'tab:1:files', 'item:assignment:a1', 'mitem:1:i1', 'module:1:m1', 'file:9', 'ann:n1']) ok(ids.has(id), `missing ${id}`);
    ok(!ids.has('mitem:1:i2'), 'module assignment not listed twice');
    ok(!ids.has('mitem:1:i3'), 'subheaders skipped');
    eq(idx.find((e) => e.id === 'act:theme').title, 'Switch to light theme');
    eq(idx.find((e) => e.id === 'file:9').href, '#/courses/1/files/f2');
    eq(idx.find((e) => e.id === 'item:assignment:a1').href, '#/courses/1/assignments/a1');
    eq(Gesso.search.search(idx, 'syllabus')[0].id, 'mitem:1:i1');
    ok(!Gesso.search.search(idx, 'bank').some((e) => e.id === 'act:theme' || e.id === 'view:dashboard'), 'weak scattered matches dropped when a real match exists');
    eq(Gesso.search.search(idx, 'csci files')[0].id, 'tab:1:files');
    eq(Gesso.search.search(idx, 'calendar')[0].id, 'view:calendar');
    eq(Gesso.search.search(idx, 'dark light')[0].id, 'act:theme', 'keywords match');
    ok(Gesso.search.search(idx, '').slice(0, 8).some((e) => e.id === 'item:assignment:a1'), 'upcoming work near the top of the empty list');
  });
  await test('shortcuts: g-sequences, ? and ⌘K; quiet while typing or in a dialog', () => {
    const I = Gesso.shortcuts.interpret;
    const base = { pendingG: false, editable: false, dialogOpen: false };
    eq(I({ key: 'k', metaKey: true }, base), { type: 'palette' });
    eq(I({ key: 'k', ctrlKey: true }, { ...base, editable: true }), { type: 'palette' }, '⌘K works while typing');
    eq(I({ key: 'g' }, base), { type: 'startG' });
    eq(I({ key: 'a' }, { ...base, pendingG: true }), { type: 'go', path: '/assignments' });
    eq(I({ key: 'c' }, { ...base, pendingG: true }), { type: 'go', path: '/calendar' });
    eq(I({ key: 'g' }, { ...base, pendingG: true }), { type: 'go', path: '/grades' });
    eq(I({ key: 'd' }, { ...base, pendingG: true }), { type: 'go', path: '/' });
    eq(I({ key: 'x' }, { ...base, pendingG: true }), { type: 'cancelG' });
    eq(I({ key: 'a' }, base), null, 'a alone is the calendar\'s');
    eq(I({ key: '?', shiftKey: true }, base), { type: 'help' });
    eq(I({ key: 'g' }, { ...base, editable: true }), null);
    eq(I({ key: '?' }, { ...base, dialogOpen: true }), null);
    const inp = document.createElement('input');
    const cb = document.createElement('input'); cb.type = 'checkbox';
    ok(Gesso.shortcuts.isEditable(inp) && !Gesso.shortcuts.isEditable(cb) && Gesso.shortcuts.isEditable(document.createElement('textarea')), 'isEditable');
  });
  await test('summary: upcoming undone, unsnoozed work, soonest first, absolute URLs', () => {
    const now = new Date();
    const iso = (h) => new Date(now.getTime() + h * H).toISOString();
    const tomorrow = time.dayKey(new Date(now.getTime() + DAY));
    const state = {
      settings: { ...Gesso.settings.DEFAULTS }, hydrated: true, meta: { syncedAt: { all: 123 } }, sync: { error: { kind: 'auth' } },
      data: {
        user: { name: 'A' },
        courses: [{ id: '1', name: 'C', code: 'C101', color: '#123456' }],
        coursework: { 1: { groups: [], assignments: [
          { id: 'b', kind: 'assignment', name: 'B', dueAt: iso(30), status: 'not_submitted', gradingType: 'points', points: 5 },
          { id: 'a', kind: 'assignment', name: 'A', dueAt: iso(3), status: 'not_submitted', gradingType: 'points' },
          { id: 'done', kind: 'assignment', name: 'Done', dueAt: iso(4), status: 'submitted', gradingType: 'points' },
          { id: 'snz', kind: 'assignment', name: 'Snoozed', dueAt: iso(5), status: 'not_submitted', gradingType: 'points' },
          { id: 'far', kind: 'assignment', name: 'Far', dueAt: iso(24 * 20), status: 'not_submitted', gradingType: 'points' },
          { id: 'late', kind: 'assignment', name: 'Late', dueAt: iso(-5), status: 'not_submitted', gradingType: 'points' },
        ] } },
        planner: [],
        notes: [{ id: 's', snooze: true, linked: { type: 'assignment', id: 'snz' }, todoDate: `${tomorrow}T00:00:00Z`, courseId: '1' }],
      },
    };
    const s = Gesso.summary.compute(state, now);
    eq(s.items.map((i) => i.key), ['assignment:a', 'assignment:b']);
    eq(s.items[1], { key: 'assignment:b', title: 'B', kind: 'assignment', course: 'C101', color: '#123456', dueAt: iso(30), points: 5, url: 'https://umd.instructure.com/#/courses/1/assignments/b' });
    eq([s.overdue, s.loggedOut, s.syncedAt, s.user], [1, true, 123, 'A']);
  });
  await test('settings: concurrent updates are serialized (no lost writes)', async () => {
    await Promise.all([Gesso.settings.update({ accent: '#e0876a' }), Gesso.settings.update({ density: 'compact' }), Gesso.settings.update({ dueSoonDays: 14 })]);
    const s = await Gesso.settings.load();
    eq([s.accent, s.density, s.dueSoonDays], ['#e0876a', 'compact', 14]);
    await Gesso.settings.reset();
  });
  await test('settings: defaultView default; reset keeps per-course data', async () => {
    eq(Gesso.settings.DEFAULTS.defaultView, 'dashboard');
    await Gesso.settings.update({ accent: '#e0876a', theme: 'light', hiddenCourses: ['9'], courseCredits: { 9: 4 }, defaultView: 'calendar' });
    const r = await Gesso.settings.reset();
    eq([r.accent, r.theme, r.defaultView, r.hiddenCourses, r.courseCredits], [Gesso.settings.DEFAULTS.accent, 'dark', 'dashboard', ['9'], { 9: 4 }]);
    await Gesso.settings.update({ hiddenCourses: [], courseCredits: {} });
  });
  await test('scoreText: pass/fail, letter grades, points', () => {
    eq(Gesso.ui.scoreText(0, 0, 'complete', 'pass_fail'), 'Complete');
    eq(Gesso.ui.scoreText(0, 0, 'incomplete', 'pass_fail'), 'Incomplete');
    eq(Gesso.ui.scoreText(88, 100, 'B+', 'letter_grade'), 'B+');
    eq(Gesso.ui.scoreText(17.5, 20, '17.5', 'points'), '17.5 / 20');
    eq(Gesso.ui.scoreText(null, 20, null, 'points'), '—');
  });
  await test('derive: courseEnded from concluded flag or past end dates', () => {
    const now = new Date(2026, 10, 20);
    ok(D.courseEnded({ concluded: true }, now));
    ok(D.courseEnded({ termEnd: '2026-08-10T04:00:00Z' }, now));
    ok(!D.courseEnded({ termEnd: '2026-12-20T04:00:00Z', endAt: null }, now));
    ok(D.courseEnded({ termEnd: '2026-12-20T04:00:00Z', endAt: '2026-11-01T00:00:00Z' }, now), 'course end beats term end');
    ok(!D.courseEnded(null, now));
  });

  // ---- text/URL submission ----------------------------------
  const SB = Gesso.submit;
  await test('submit: eligibility (types, locks, attempts, late, group)', () => {
    const now = new Date('2026-11-20T12:00:00Z');
    const a = { layout: 'assignment', submissionTypes: ['online_upload', 'online_text_entry'], allowedAttempts: 2, dueAt: '2026-11-21T04:59:00Z', unlockAt: null, lockAt: null, locked: false, groupAssignment: true, submission: null };
    let e = SB.eligibility(a, null, now);
    eq([e.ok, e.types, e.attempt, e.attemptsLeft, e.late, e.group], [true, ['online_upload', 'online_text_entry'], 1, 2, false, true]);
    e = SB.eligibility(a, { attempt: 1 }, new Date('2026-11-22T00:00:00Z'));
    eq([e.ok, e.attempt, e.attemptsLeft, e.late], [true, 2, 1, true]);
    eq(SB.eligibility(a, { attempt: 2 }, now).reason, 'No attempts left.');
    eq(SB.eligibility({ ...a, allowedAttempts: -1 }, { attempt: 9 }, now).ok, true, 'unlimited');
    eq(SB.eligibility({ ...a, submissionTypes: ['media_recording', 'student_annotation'] }, null, now).ok, false, 'media/annotation stay in Canvas');
    eq(SB.eligibility({ ...a, layout: 'quiz' }, null, now).ok, false);
    eq(SB.eligibility({ ...a, locked: true }, null, now).ok, false);
    eq(SB.eligibility({ ...a, lockAt: '2026-11-20T11:00:00Z' }, null, now).reason, 'This assignment is closed for submissions.');
    eq(SB.eligibility({ ...a, unlockAt: '2026-11-25T00:00:00Z' }, null, now).ok, false);
  });
  await test('submit: text → safe HTML, plain-text comparison, URL normalization', () => {
    eq(SB.textToHtml('Hello <b>world</b> & "you"\n\nSecond\nline'), '<p>Hello &lt;b&gt;world&lt;/b&gt; &amp; &quot;you&quot;</p><p>Second<br>line</p>');
    eq(SB.plainText('<div class="x"><p>Hello &lt;b&gt;</p><p>Second<br>line</p></div>'), 'Hello <b> Second line');
    eq(SB.normalizeUrl('example.com/doc'), 'http://example.com/doc');
    eq(SB.normalizeUrl('HTTPS://Docs.Example.com/'), 'https://docs.example.com');
    eq(SB.normalizeUrl('https://docs.google.com/d/1?usp=sharing'), 'https://docs.google.com/d/1?usp=sharing');
    eq(SB.normalizeUrl('javascript:alert(1)'), null);
    eq(SB.normalizeUrl('notaurl'), null);
    eq(SB.normalizeUrl(''), null);
  });
  await test('submit: confirmRecorded needs a newer submission of the right type and content', () => {
    const before = { attempt: 1, submitted_at: '2026-11-19T10:00:00Z', submission_type: 'online_text_entry', body: '<p>old</p>' };
    const good = { attempt: 2, submitted_at: '2026-11-20T10:00:00Z', submission_type: 'online_text_entry', body: '<div><p>New text</p></div>' };
    eq(SB.confirmRecorded(before, good, { type: 'online_text_entry', text: 'New text' }), { ok: true, problems: [] });
    ok(!SB.confirmRecorded(before, before, { type: 'online_text_entry', text: 'old' }).ok, 'unchanged = not recorded');
    ok(!SB.confirmRecorded(before, good, { type: 'online_text_entry', text: 'Different' }).ok, 'text mismatch');
    ok(!SB.confirmRecorded(null, { ...good, submission_type: 'online_url' }, { type: 'online_text_entry', text: 'New text' }).ok, 'type mismatch');
    eq(SB.confirmRecorded(null, { attempt: 1, submitted_at: '2026-11-20T10:00:00Z', submission_type: 'online_url', url: 'http://example.com/doc' }, { type: 'online_url', url: 'example.com/doc' }).ok, true, 'Canvas adds http://');
    ok(!SB.confirmRecorded(null, { attempt: 1, submitted_at: null, submission_type: 'online_url', url: 'x' }, { type: 'online_url', url: 'x' }).ok, 'no time');
  });
  await test('submit: text then URL against the mock; re-read confirms; store updated; attempts run out', async () => {
    const r1 = await SB.submit({ courseId: '103', assignmentId: '21', userId: '1', type: 'online_text_entry', text: 'My analysis.\n\nSecond paragraph <with> brackets.', comment: 'Thanks!' });
    ok(r1.ok, JSON.stringify(r1));
    eq(r1.after.attempt, 1);
    const w = window.__mockWrites.filter((x) => x.path === '/api/v1/courses/103/assignments/21/submissions').pop();
    eq(w.body, { submission: { submission_type: 'online_text_entry', body: '<p>My analysis.</p><p>Second paragraph &lt;with&gt; brackets.</p>' }, comment: { text_comment: 'Thanks!' } });
    const a21 = Gesso.store.get().data.coursework['103'].assignments.find((x) => x.id === '21');
    eq([a21.status, a21.submission.attempt], ['submitted', 1], 'coursework patched');
    const r2 = await SB.submit({ courseId: '103', assignmentId: '21', userId: '1', type: 'online_url', url: 'docs.example.com/essay' });
    ok(r2.ok && r2.after.attempt === 2 && r2.after.url === 'http://docs.example.com/essay', JSON.stringify(r2));
    const detail = Gesso.normalize.assignmentDetail(await Gesso.api.canvas.getAssignment('103', '21'), await Gesso.api.canvas.getMySubmission('103', '21', '1'), '103');
    eq(SB.eligibility(detail, detail.submissionDetail).reason, 'No attempts left.');
  });
  await test('submit: Canvas dropping the submission is caught (posted, not confirmed); a 400 sends nothing more', async () => {
    window.__mockSubmitBroken = true;
    let r;
    try { r = await SB.submit({ courseId: '101', assignmentId: '2', userId: '1', type: 'online_text_entry', text: 'x' }); } finally { window.__mockSubmitBroken = false; }
    eq([r.ok, r.posted], [false, false], 'type not allowed → 400 before anything recorded');
    ok(/not allowed/.test(r.message), `Canvas's message passed on: ${r.message}`);
    // A real drop: allowed type, POST accepted, nothing recorded.
    delete window.__mockSubs['103:21'];
    window.__mockSubmitBroken = true;
    try { r = await SB.submit({ courseId: '103', assignmentId: '21', userId: '1', type: 'online_text_entry', text: 'lost' }); } finally { window.__mockSubmitBroken = false; }
    eq([r.ok, r.posted], [false, true]);
    ok(r.problems.length > 0, 'problems listed');
  });
  await test('client: Canvas error messages are extracted', () => {
    eq(client.canvasErrorMessage('{"errors":[{"message":"Invalid submission type"}]}'), 'Invalid submission type');
    eq(client.canvasErrorMessage('{"message":"locked"}'), 'locked');
    eq(client.canvasErrorMessage('{"errors":{"url":[{"message":"is invalid"}]}}'), 'is invalid');
    eq(client.canvasErrorMessage('<html>'), '');
  });

  // ---- file upload prototype (personal Files) ---------------
  const UP = Gesso.upload;
  const runUpload = async (mode, file) => {
    window.__mockUploadMode = mode;
    try { return await UP.selfTest(() => {}, { file }); } finally { window.__mockUploadMode = undefined; }
  };
  await test('upload: three-step flow, read back by size/name/folder/bytes, cleaned up (Location answer)', async () => {
    window.__mockWrites.length = 0;
    const r = await runUpload('location');
    eq(r.steps.filter((s) => !s.ok).map((s) => `${s.label}: ${s.detail}`), []);
    ok(r.ok && r.steps.length === 6, `6 steps, got ${r.steps.length}`);
    ok(/Location header → GET/.test(r.steps[1].detail), r.steps[1].detail);
    ok(/identical/.test(r.steps[3].detail), r.steps[3].detail);
    const step1 = window.__mockWrites.find((w) => w.path === '/api/v1/users/self/files');
    eq([step1.body.parent_folder_path, step1.body.on_duplicate, step1.body.content_type], [UP.TEST_FOLDER, 'rename', 'text/plain']);
    ok(window.__mockFiles.files.every((f) => f.deleted), 'file deleted');
    ok(window.__mockFiles.folders.every((f) => f.deleted), 'folder removed');
    ok(!window.__mockWrites.some((w) => /submissions/.test(w.path)), 'nothing submitted anywhere');
  });
  await test('upload: JSON answer and unreadable answer (found by name) both confirm; a picked file uploads too', async () => {
    let r = await runUpload('json');
    ok(r.ok && /response body/.test(r.steps[1].detail), r.steps[1].detail);
    r = await runUpload('opaque', new File([new Uint8Array([1, 2, 3, 4, 5])], 'scan.pdf', { type: 'application/pdf' }));
    ok(r.ok && /found by name/.test(r.steps[1].detail), r.steps[1].detail);
    ok(/scan\.pdf, 5 bytes, application\/pdf/.test(r.steps[2].detail), r.steps[2].detail);
  });
  await test('upload: a CORS block is reported as such; a size mismatch fails the read-back and cleans up', async () => {
    let r = await runUpload('cors');
    eq(r.ok, false);
    ok(/CORS/.test(r.steps.find((s) => s.ok === false).detail), 'says CORS');
    r = await runUpload('truncate');
    eq(r.ok, false);
    const bad = r.steps.find((s) => s.ok === false);
    ok(/Read the file back/.test(bad.label) && /size/.test(bad.detail), `${bad.label}: ${bad.detail}`);
    eq(r.steps[r.steps.length - 1].label, 'Cleanup');
    ok(window.__mockFiles.files.every((f) => f.deleted), 'cleaned up after the failure');
  });

  // ---- redaction + file-upload submission ----------------
  await test('redact: upload tokens, verifiers, signatures, JWTs and upload_params values', () => {
    const R = Gesso.redact.redact;
    const jwt = 'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJ0ZXN0Ijp0cnVlLCJpYXQiOjB9.c3ludGhldGljLXNpZ25hdHVyZS1ub3QtcmVhbA';
    const out = R({
      upload_url: `https://inst-fs-iad-prod.inscloudgate.net/files?token=${jwt}`,
      upload_params: { filename: 'a.txt', content_type: 'text/plain', 'x-amz-signature': 'abc', Policy: 'xyz' },
      body: { id: 12345678, uuid: 'abcd1234', url: 'https://umd.instructure.com/files/9/download?download_frd=1&verifier=abcd1234-0000', preview_url: '/users/1/files/9/file_preview?annotate=0&verifier=abcd1234', size: 101 },
      note: `Authorization: Bearer abc.def-123 and ${jwt}`,
    });
    eq(out.upload_url, 'https://inst-fs-iad-prod.inscloudgate.net/files?token=[redacted]');
    eq(out.upload_params, { filename: 'a.txt', content_type: 'text/plain', 'x-amz-signature': '[redacted]', Policy: '[redacted]' });
    eq(out.body.url, 'https://umd.instructure.com/files/9/download?download_frd=1&verifier=[redacted]');
    eq(out.body.preview_url, '/users/1/files/9/file_preview?annotate=0&verifier=[redacted]');
    eq([out.body.id, out.body.size, out.body.uuid], [12345678, 101, '[redacted]']);
    ok(!out.note.includes('abc.def') && !out.note.includes('eyJ0eXAi'), out.note);
    ok(!JSON.stringify(out).includes('c3ludGhldGlj'), 'no JWT signature left anywhere'); // synthetic token, not a real one
  });
  await test('submit: file checks (types, empty, duplicates, quota) and attachment matching', () => {
    const a = { allowedExtensions: ['zip', 'JAVA'] };
    let c = SB.checkFiles([{ name: 'Main.java', size: 10 }, { name: 'proj.ZIP', size: 20 }], a, { quota: 1000, used: 100 });
    eq([c.ok, c.perFile], [true, [null, null]]);
    c = SB.checkFiles([{ name: 'notes.txt', size: 10 }, { name: 'empty.java', size: 0 }], a);
    eq(c.ok, false);
    ok(/Allowed: \.zip, \.java/.test(c.perFile[0]) && /empty/.test(c.perFile[1]), JSON.stringify(c.perFile));
    ok(!SB.checkFiles([{ name: 'a.zip', size: 5 }, { name: 'a.zip', size: 6 }], a).ok, 'duplicate names');
    ok(/Not enough space/.test(SB.checkFiles([{ name: 'a.zip', size: 950 }], a, { quota: 1000, used: 100 }).problems.join()), 'quota');
    ok(!SB.checkFiles([], a).ok, 'nothing picked');
    eq(SB.checkFiles([{ name: 'x.pdf', size: 3 }], { allowedExtensions: [] }).ok, true, 'any type when unrestricted');
    eq(SB.sameFiles([{ id: 1, display_name: 'a.zip', size: 5 }], [{ id: '1', name: 'a.zip', size: 5 }]), true);
    eq(SB.sameFiles([{ id: 9, display_name: 'a.zip', size: 5 }], [{ id: '1', name: 'a.zip', size: 5 }]), true, 'copied under a new id: name+size');
    eq(SB.sameFiles([{ id: 1, display_name: 'a.zip', size: 5 }], [{ id: '1', name: 'a.zip', size: 5 }, { id: '2', name: 'b.zip', size: 6 }]), false);
    eq(SB.sameFiles([{ id: 9, display_name: 'a.zip', size: 4 }], [{ id: '1', name: 'a.zip', size: 5 }]), false);
  });
  const fileOf = (name, n) => new File([new Uint8Array(n).fill(65)], name, { type: 'application/octet-stream' });
  const subWrites = () => window.__mockWrites.filter((w) => w.path === '/api/v1/courses/101/assignments/1/submissions');
  const slotWrites = () => window.__mockWrites.filter((w) => w.path === '/api/v1/courses/101/assignments/1/submissions/self/files');
  await test('submit files: two files upload with progress, one submission, re-read confirms the files', async () => {
    window.__mockWrites.length = 0;
    const entries = [SB.entryFor(fileOf('Main.java', 300)), SB.entryFor(fileOf('project.zip', 500))];
    const phases = [];
    let progressSeen = 0;
    const r = await SB.submitFiles({ courseId: '101', assignmentId: '1', userId: '1', entries }, { onPhase: (p) => phases.push(p), onUpdate: () => { if (entries.some((e) => e.status === 'uploading' && e.progress > 0 && e.progress < 1)) progressSeen++; } });
    ok(r.ok, JSON.stringify(r));
    eq(phases, ['checking', 'uploading', 'submitting', 'confirming']);
    ok(progressSeen > 0, 'progress reported');
    eq(entries.map((e) => e.status), ['done', 'done']);
    eq(subWrites().length, 1);
    eq(subWrites()[0].body.submission, { submission_type: 'online_upload', file_ids: entries.map((e) => e.id) });
    eq(r.after.attachments.map((x) => x.display_name), ['Main.java', 'project.zip']);
    eq(Gesso.store.get().data.coursework['101'].assignments.find((x) => x.id === '1').status, 'submitted');
  });
  await test('submit files: cancel mid-upload sends no submission', async () => {
    window.__mockWrites.length = 0;
    window.__mockUploadDelay = 400;
    const ctl = new AbortController();
    const entries = [SB.entryFor(fileOf('Main.java', 300)), SB.entryFor(fileOf('Other.java', 300))];
    let r;
    try {
      r = await SB.submitFiles({ courseId: '101', assignmentId: '1', userId: '1', entries }, { signal: ctl.signal, onUpdate: () => { if (entries[0].status === 'uploading' && entries[0].progress > 0) ctl.abort(); } });
    } finally { window.__mockUploadDelay = 0; }
    eq([r.ok, r.cancelled, r.posted], [false, true, false]);
    eq(subWrites().length, 0, 'no submission POST');
    eq(entries.map((e) => e.status), ['cancelled', 'cancelled']);
  });
  await test('submit files: a network blip is retried automatically; a persistent failure lets Retry re-send only that file', async () => {
    window.__mockWrites.length = 0;
    window.__mockUploadFailNext = 1;
    let entries = [SB.entryFor(fileOf('A.java', 100))];
    let r = await SB.submitFiles({ courseId: '101', assignmentId: '1', userId: '1', entries });
    ok(r.ok, `auto-retry: ${JSON.stringify(r)}`);
    eq(slotWrites().length, 2, 'two slot requests (retry gets a fresh token)');

    window.__mockWrites.length = 0;
    entries = [SB.entryFor(fileOf('B.java', 100)), SB.entryFor(fileOf('C.java', 100))];
    window.__mockUploadFailNext = 3; // B fails twice (initial + auto retry); C's first try fails, its retry succeeds
    r = await SB.submitFiles({ courseId: '101', assignmentId: '1', userId: '1', entries });
    eq([r.ok, r.stage, r.posted], [false, 'upload', false]);
    eq(entries.map((e) => e.status), ['failed', 'done']);
    eq(subWrites().length, 0, 'nothing submitted while a file is missing');
    const cId = entries[1].id;
    window.__mockWrites.length = 0;
    r = await SB.submitFiles({ courseId: '101', assignmentId: '1', userId: '1', entries });
    ok(r.ok, JSON.stringify(r));
    eq(slotWrites().length, 1, 'only the failed file re-sent');
    eq(entries[1].id, cId, 'uploaded file kept its id');
    eq(subWrites()[0].body.submission.file_ids, entries.map((e) => e.id));
  });
  await test('submit files: Canvas recording different files is caught (posted, not confirmed)', async () => {
    window.__mockSubmitWrongFiles = true;
    let r;
    try { r = await SB.submitFiles({ courseId: '101', assignmentId: '1', userId: '1', entries: [SB.entryFor(fileOf('X.java', 10)), SB.entryFor(fileOf('Y.java', 10))] }); }
    finally { window.__mockSubmitWrongFiles = false; }
    eq([r.ok, r.posted], [false, true]);
    ok(/different files/.test(r.problems.join(' ')), r.problems.join(' '));
  });

  // ---- themes ----------------------------------------------------------------
  {
    const T = Gesso.themes;
    const HEXRE = /^#[0-9a-f]{6}$/;
    await test('themes: every preset, both modes, has every token and passes the contrast audit', () => {
      const by = (g) => T.PRESETS.filter((p) => p.group === g).map((p) => p.id);
      ok(by('everyday').length >= 4 && by('everyday').length <= 6, 'four to six everyday presets');
      eq(by('season'), ['spring', 'summer', 'autumn', 'winter']);
      eq(by('holiday').sort(), ['christmas', 'halloween', 'july4', 'newyear', 'thanksgiving', 'valentines']);
      for (const p of T.PRESETS) if (p.group !== 'everyday') ok(Gesso.motifs.NAMES.includes(p.motif), `${p.id} has a motif`);
      for (const p of T.PRESETS) {
        ok(p.name && p.description, `${p.id} named`);
        for (const mode of ['dark', 'light']) {
          const t = T.resolve({ themeId: p.id }, mode);
          eq(t.scheme, mode, `${p.id} ${mode} scheme`);
          for (const k of T.COLOR_TOKENS) ok(HEXRE.test(t[k]) || /^rgba\(/.test(t[k]), `${p.id} ${mode} --${k} = ${t[k]}`);
          const fails = T.audit(t);
          eq(fails.map((f) => `${f.label} ${f.ratio.toFixed(2)}`), [], `${p.id} ${mode}`);
        }
      }
    });
    await test('themes: hierarchy goes background → surface → raised, in both modes', () => {
      for (const p of T.PRESETS) {
        for (const mode of ['dark', 'light']) {
          const t = T.resolve({ themeId: p.id }, mode);
          const L = (k) => T.color.oklchOf(t[k]).l;
          const dir = mode === 'dark' ? 1 : -1;
          ok(dir * (L('surface-2') - L('surface')) > 0 && dir * (L('surface-3') - L('surface-2')) > 0, `${p.id} ${mode} raised surfaces step away`);
          ok(mode === 'dark' ? L('surface') > L('bg') : L('surface') >= L('bg'), `${p.id} ${mode} surfaces sit above the background`);
          ok(T.color.contrast(t.text, t.bg) > T.color.contrast(t['text-2'], t.bg) && T.color.contrast(t['text-2'], t.bg) > T.color.contrast(t['text-3'], t.bg), `${p.id} ${mode} text ranks`);
        }
      }
    });
    await test('themes: Gesso keeps its original palette exactly', () => {
      const d = T.resolve({ themeId: 'gesso' }, 'dark');
      const l = T.resolve({ themeId: 'gesso' }, 'light');
      eq([d.bg, d.surface, d.text, d['text-3'], d.accent, d.danger], ['#0b0d12', '#14171e', '#e9ecf2', '#808a9b', '#8b9cff', '#f87171']);
      eq([l.bg, l.surface, l['text-3'], l['accent-text'], l.focus], ['#f3f4f7', '#ffffff', '#646d7e', '#2039b6', '#2039b6']);
      eq(T.resolve({}, 'dark').bg, '#0b0d12', 'no settings = Gesso');
    });
    await test('themes: a chosen accent replaces the preset\'s, with readable derived colors', () => {
      for (const p of T.PRESETS) for (const mode of ['dark', 'light']) for (const accent of ['#e0876a', '#4f7cff', '#6cc17e', '#ffffff', '#111111']) {
        const t = T.resolve({ themeId: p.id, accent }, mode);
        eq(t.accent, accent);
        eq(T.audit(t).map((f) => f.label), [], `${p.id} ${mode} ${accent}`);
      }
      eq(T.resolve({ themeId: 'harbor', accent: '' }, 'dark').accent, T.resolve({ themeId: 'harbor' }, 'dark').accent, "'' = theme accent");
    });
    await test('settings: the old default accent reads as the theme accent; bad theme keys fall back', () => {
      eq(Gesso.settings.normalize({ accent: '#8b9cff', theme: 'light' }).accent, '', 'pre-theme default');
      eq(Gesso.settings.normalize({ accent: '#8b9cff', themeId: 'linen' }).accent, '#8b9cff', 'chosen after themes: kept');
      eq(Gesso.settings.normalize({ themeId: 'neon' }).themeId, 'gesso');
      eq(Gesso.settings.normalize({ themeId: 'custom', customTheme: null }).themeId, 'gesso');
      eq(Gesso.settings.normalize({ themeId: 'custom', customTheme: { name: 'x' } }).customTheme, null, 'invalid custom dropped');
      eq(Gesso.settings.normalize({ courseColors: 'rainbow' }).courseColors, 'canvas');
    });
    await test('custom theme: one accent gives a coherent, readable theme in both modes', () => {
      for (const accent of ['#e0876a', '#2a9d8f', '#c9a227', '#7b2cbf', '#808080']) for (const base of T.PRESET_IDS) {
        const s = { themeId: 'custom', customTheme: { ...T.emptyCustom(base), accent } };
        for (const mode of ['dark', 'light']) {
          const t = T.resolve(s, mode);
          eq(t.accent, accent);
          eq(t.scheme, mode);
          eq(T.audit(t).map((f) => f.label), [], `${base} ${accent} ${mode}`);
        }
      }
      // With tint on, the grays lean toward the accent's hue.
      const t = T.resolve({ themeId: 'custom', customTheme: { ...T.emptyCustom('graphite'), accent: '#2a9d8f' } }, 'dark');
      const h = T.color.oklchOf(t.surface).h;
      ok(Math.abs(h - T.color.oklchOf('#2a9d8f').h) < 25, `surface hue ${h}`);
    });
    await test('custom theme: picked colors are kept exactly; derived text is corrected; low contrast is reported', () => {
      const ct = { ...T.emptyCustom('gesso'), accent: '#4f7cff', dark: { bg: '#101820', surface: '#18222c', text: '#d8e0e8' } };
      const t = T.resolve({ themeId: 'custom', customTheme: ct }, 'dark');
      eq([t.bg, t.surface, t.text], ['#101820', '#18222c', '#d8e0e8']);
      eq(T.audit(t).map((f) => f.label), [], 'secondary text corrected');
      const bad = T.resolve({ themeId: 'custom', customTheme: { ...ct, dark: { bg: '#202020', text: '#555555' } } }, 'dark');
      eq(bad.text, '#555555', 'kept as picked');
      ok(T.audit(bad).some((f) => f.fg === 'text' && f.ratio < 4.5), 'reported');
      // A light background in the "dark" slot makes that variant light.
      eq(T.resolve({ themeId: 'custom', customTheme: { ...ct, dark: { bg: '#f4efe6' } } }, 'dark').scheme, 'light');
    });
    await test('theme file: serialize → parse round-trips; per-course colors stay out', () => {
      const ct = { ...T.emptyCustom('paper'), name: 'Night  Owl\n', accent: '#2a9d8f', dark: { bg: '#101820' }, light: { text: '#202020' }, courses: { c9z: '#ff0000' } };
      const text = T.serialize(ct, null);
      ok(!/c9z|ff0000/.test(text), 'no course ids or course colors in the file');
      const r = T.parseFile(text);
      ok(r.ok, JSON.stringify(r.errors));
      eq([r.theme.name, r.theme.base, r.theme.accent, r.theme.dark, r.theme.light, r.image], ['Night Owl', 'paper', '#2a9d8f', { bg: '#101820' }, { text: '#202020' }, null]);
      eq(T.fileName('Night Owl!'), 'night-owl.gesso-theme.json');
    });
    await test('theme file: rejects unknown keys, bad colors, URLs, SVG, script and oversized files', () => {
      const base = { kind: 'gesso-theme', version: 1, name: 'x' };
      const bad = (o, re) => {
        const r = T.parseFile(typeof o === 'string' ? o : JSON.stringify(o));
        ok(!r.ok, `accepted ${JSON.stringify(o).slice(0, 80)}`);
        ok(re.test(r.errors.join(' ')), r.errors.join(' '));
      };
      bad('not json', /valid JSON/);
      bad([], /isn’t a Gesso theme/);
      bad({ ...base, kind: 'other' }, /isn’t a Gesso theme/);
      bad({ ...base, version: 2 }, /version/);
      bad({ ...base, css: 'body{}' }, /Unknown key "css"/);
      bad({ ...base, dark: { bg: '#101820', onload: 'x' } }, /Unknown key "dark.onload"/);
      bad({ ...base, accent: 'red' }, /accent/);
      bad({ ...base, accent: 'url(https://example.com/x)' }, /accent/);
      bad({ ...base, dark: { bg: 'javascript:alert(1)' } }, /dark.bg/);
      bad({ ...base, base: 'neon' }, /base/);
      bad({ ...base, image: { data: 'https://example.com/a.jpg' } }, /Web addresses/);
      bad({ ...base, image: { data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } }, /PNG, JPEG or WebP/);
      bad({ ...base, image: { data: 'data:image/png;base64,AAAA', blur: 99 } }, /blur/);
      bad({ ...base, image: { data: 'data:image/png;base64,AAAA', src: 'x' } }, /image.src/);
      bad({ ...base, name: 5 }, /name/);
      bad(JSON.stringify({ ...base, name: 'x'.repeat(T.MAX_FILE_BYTES) }), /larger than/);
      const big = 'A'.repeat(Math.ceil(T.MAX_IMAGE_BYTES / 3) * 4 + 4);
      bad({ ...base, image: { data: `data:image/png;base64,${big}` } }, /image is larger/);
    });
    await test('theme file: an embedded image is decoded and re-encoded, then shown', async () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 40;
      const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 64, 40); x.fillStyle = '#000000'; x.fillRect(0, 20, 64, 20);
      const file = JSON.stringify({ kind: 'gesso-theme', version: 1, name: 'Stripes', base: 'graphite', image: { data: c.toDataURL('image/png'), blur: 4, dim: 10 } });
      const r = await Gesso.themeEditor.importText(file, Gesso.store.get().settings, { confirm: false });
      ok(r.ok, JSON.stringify(r));
      const s = await Gesso.settings.load();
      eq([s.themeId, s.customTheme.name, s.customTheme.image.blur, s.customTheme.image.samples.length], ['custom', 'Stripes', 4, 160]);
      const rec = (await browser.storage.local.get(Gesso.appearance.IMAGE_KEY))[Gesso.appearance.IMAGE_KEY];
      ok(rec.id === s.customTheme.image.id && /^data:image\/jpeg;base64,/.test(rec.data) && /^data:image\/jpeg;base64,/.test(rec.thumb), 'stored as JPEG');
      // Black and white halves: the dim must be raised for text to read over both.
      const d = Gesso.appearance.imageDim(s);
      ok(d.required > 0.5 && d.dim === d.required, JSON.stringify(d));
      const broken = JSON.stringify({ kind: 'gesso-theme', version: 1, name: 'Broken', image: { data: 'data:image/png;base64,AAAAAAAA' } });
      const r2 = await Gesso.themeEditor.importText(broken, s, { confirm: false });
      ok(!r2.ok && /couldn’t be read/.test(r2.errors.join(' ')), 'undecodable image rejected');
      document.getElementById('host')?.shadowRoot?.querySelectorAll?.('dialog[open]').forEach((dl) => dl.close());
      await Gesso.settings.reset();
    });
    await test('requiredDim: none for a calm image, more for a busy one', () => {
      const t = T.resolve({ themeId: 'gesso' }, 'dark');
      eq(T.requiredDim([[11, 13, 18], [20, 23, 30]], t), 0);
      ok(T.requiredDim([[255, 255, 255]], t) >= 0.8, 'white behind dark-theme text');
      eq(T.requiredDim([], t), 0);
    });
    await test('course colors: the theme palette recolors courses and keeps Canvas colors aside', () => {
      const courses = [{ id: 'a', color: '#123456', position: 2 }, { id: 'b', color: '#654321', position: 1 }];
      const state = { settings: { themeId: 'harbor', theme: 'dark', courseColors: 'theme' }, data: { courses } };
      const v = Gesso.appearance.view(state);
      const t = T.resolve(state.settings);
      const byId = Object.fromEntries(v.data.courses.map((c) => [c.id, c]));
      eq([byId.b.color, byId.a.color], [t['chart-1'], t['chart-2']], 'dashboard order');
      eq(byId.a.canvasColor, '#123456');
      ok(Gesso.appearance.view(state).data === v.data, 'identity-stable for memos');
      const canvas = { ...state, settings: { ...state.settings, courseColors: 'canvas' } };
      ok(Gesso.appearance.view(canvas) === canvas, 'Canvas colors: state untouched');
      const custom = { settings: { themeId: 'custom', theme: 'dark', customTheme: { ...T.emptyCustom(), courseColors: 'canvas', courses: { a: '#00ff00' } } }, data: { courses } };
      eq(Gesso.appearance.view(custom).data.courses.map((c) => c.color), ['#00ff00', '#654321'], 'per-course override only');
    });
    await test('paint mirror: round-trips tokens and refuses anything but colors', () => {
      const t = T.resolve({ themeId: 'dusk' }, 'light');
      const back = T.readPaintRecord(T.paintRecord(t));
      eq([back.scheme, back.bg, back.accent, back['shadow']], ['light', t.bg, t.accent, t.shadow]);
      eq(T.readPaintRecord(JSON.stringify({ v: 1, s: 'dark', t: { bg: 'url(https://x)' } })), null);
      eq(T.readPaintRecord('{'), null);
    });
  }

  // ---- seasonal schedule -------------------------------------------------------
  {
    const T = Gesso.themes;
    const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h);
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await test('schedule: Thanksgiving is the fourth Thursday of November', () => {
      eq([2024, 2025, 2026, 2027, 2028, 2029, 2030].map((y) => ymd(T.thanksgiving(y))),
        ['2024-11-28', '2025-11-27', '2026-11-26', '2027-11-25', '2028-11-23', '2029-11-22', '2030-11-28']);
      for (let y = 2000; y <= 2100; y++) {
        const t = T.thanksgiving(y);
        ok(t.getDay() === 4 && t.getMonth() === 10 && t.getDate() >= 22 && t.getDate() <= 28, `${y}: ${t}`);
      }
    });
    await test('schedule: window boundaries pick the right theme', () => {
      const cases = [
        [D(2027, 1, 1), 'newyear'], [D(2027, 1, 2), 'newyear'], [D(2027, 1, 3), 'winter'],
        [D(2027, 2, 6), 'winter'], [D(2027, 2, 7), 'valentines'], [D(2027, 2, 14), 'valentines'], [D(2027, 2, 15), 'winter'],
        [D(2028, 2, 29), 'winter'], [D(2027, 3, 1), 'spring'], [D(2027, 5, 31), 'spring'], [D(2027, 6, 1), 'summer'],
        [D(2027, 6, 30), 'summer'], [D(2027, 7, 1), 'july4'], [D(2027, 7, 5), 'july4'], [D(2027, 7, 6), 'summer'],
        [D(2027, 8, 31), 'summer'], [D(2027, 9, 1), 'autumn'], [D(2027, 10, 14), 'autumn'], [D(2027, 10, 15), 'halloween'],
        [D(2027, 10, 31), 'halloween'], [D(2027, 11, 1), 'autumn'],
        [D(2026, 11, 18), 'autumn'], [D(2026, 11, 19), 'thanksgiving'], [D(2026, 11, 26), 'thanksgiving'], [D(2026, 11, 29), 'thanksgiving'],
        [D(2026, 11, 30), 'christmas'], [D(2026, 12, 26), 'christmas'], [D(2026, 12, 27), 'newyear'], [D(2026, 12, 31), 'newyear'],
        [D(2028, 11, 15), 'autumn'], [D(2028, 11, 16), 'thanksgiving'], [D(2028, 11, 26), 'thanksgiving'], [D(2028, 11, 27), 'christmas'],
        [D(2026, 11, 19, 0), 'thanksgiving'], [D(2026, 11, 18, 23), 'autumn'], // whole days, not times
      ];
      for (const [d, id] of cases) eq(T.scheduledFor(d), id, ymd(d));
    });
    await test('schedule: every day of 2025–2031 has exactly one theme, and each holiday shows once a year', () => {
      for (let y = 2025; y <= 2031; y++) {
        const seen = new Map();
        for (let d = D(y, 1, 1); d.getFullYear() === y; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
          const id = T.scheduledFor(d);
          ok(T.PRESET_IDS.includes(id) && T.byId(id).group !== 'everyday', `${ymd(d)} → ${id}`);
          seen.set(id, (seen.get(id) || 0) + 1);
        }
        for (const id of ['valentines', 'july4', 'halloween', 'thanksgiving', 'christmas']) ok(seen.get(id) >= 5 && seen.get(id) <= 31, `${y} ${id} ${seen.get(id)} days`);
        eq(seen.get('newyear'), 7, `${y} New Year's days (Jan 1–2 + Dec 27–31)`);
      }
    });
    await test('schedule: what is showing, until when, and what comes next', () => {
      let s = T.schedule(D(2026, 11, 22));
      eq([s.id, ymd(s.from), ymd(s.until), s.next.id, ymd(s.next.starts)], ['thanksgiving', '2026-11-19', '2026-11-29', 'christmas', '2026-11-30']);
      s = T.schedule(D(2026, 12, 31));
      eq([s.id, ymd(s.from), ymd(s.until), s.next.id, ymd(s.next.starts)], ['newyear', '2026-12-27', '2027-01-02', 'winter', '2027-01-03']);
      s = T.schedule(D(2027, 4, 10));
      eq([s.id, ymd(s.until), s.next.id], ['spring', '2027-05-31', 'summer']);
    });
    await test('seasonal mode: shows the scheduled theme as designed and keeps the chosen one', () => {
      const settings = { seasonal: true, themeId: 'harbor', accent: '#ff0000', theme: 'dark' };
      const t = T.resolve(settings, undefined, D(2026, 12, 25));
      eq(t.bg, T.resolve({ themeId: 'christmas' }, 'dark').bg);
      eq(t.accent, T.resolve({ themeId: 'christmas' }, 'dark').accent, 'a chosen accent waits until seasonal is off');
      eq(T.activeId(settings, D(2026, 10, 20)), 'halloween');
      eq(T.activeId({ ...settings, seasonal: false }), 'harbor');
      const norm = Gesso.settings.normalize({});
      eq([norm.seasonal, norm.decorations], [false, true], 'off by default; decorations on');
      // The paint mirror recomputes for the day it's read.
      const rec = T.paintRecord(T.resolve({ seasonal: true, theme: 'light' }, undefined, D(2026, 10, 20)), { seasonal: true, theme: 'light' });
      eq(T.readPaintRecord(rec, D(2026, 12, 20)).bg, T.resolve({ themeId: 'christmas' }, 'light').bg);
    });
    await test('motifs: every one renders as decorative SVG', () => {
      for (const name of Gesso.motifs.NAMES) {
        const svg = Gesso.motifs.motif(name);
        ok(svg && svg.getAttribute('aria-hidden') === 'true' && svg.childElementCount >= 3, name);
        ok(!svg.querySelector('image, use, foreignObject, script'), `${name}: shapes only`);
      }
      eq(Gesso.motifs.motif('gesso'), null);
    });
  }

  // ---- report --------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  window.__testResults = { passed: results.length - failed.length, failed: failed.length, failures: failed };
  for (const r of results) console[r.ok ? 'log' : 'error'](`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.ok ? '' : ` — ${r.error}`}`);
  console.log(`${results.length - failed.length}/${results.length} passed`);
})();
