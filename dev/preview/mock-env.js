// Dev-only: fakes the WebExtension `browser` API and the Canvas REST API so
// the real extension code can run in a plain web page (open index.html in
// Safari, or render it headlessly with dev/tools/webkit-run.swift).
// Nothing here ships in the extension.
(() => {
  const params = new URLSearchParams(location.search);

  // ---- browser.* -----------------------------------------------------------
  const store = {};
  const listeners = [];
  if (params.get('theme')) store.settings = { theme: params.get('theme') };
  const storage = {
    async get(keys) {
      const list = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in store) out[k] = structuredClone(store[k]);
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: store[k], newValue: structuredClone(v) };
        store[k] = structuredClone(v);
      }
      listeners.forEach((fn) => fn(changes, 'local'));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete store[k];
    },
  };
  window.browser = {
    runtime: {
      id: 'mock-extension', // tests delete it to simulate a dead extension context
      getManifest: () => ({ version: 'dev', host_permissions: ['https://umd.instructure.com/*'] }),
    },
    storage: { local: storage, onChanged: { addListener: (fn) => listeners.push(fn) } },
  };
  window.__mockStore = store;

  // ---- Canvas API fixtures (dates relative to "now") ------------------------
  const now = Date.now();
  const H = 3600e3;
  const D = 24 * H;
  const at = (ms) => new Date(now + ms).toISOString();
  const eod = (days) => { const d = new Date(now + days * D); d.setHours(23, 59, 0, 0); return d.toISOString(); };

  // ?scale=N (performance work): N× the assignments per course, spread over the term.
  const SCALE = Math.max(1, Number(params.get('scale') || 1));

  // Grade scenarios. `canvas` = what Canvas's computed_* fields say;
  // the numbers are hand-checked against the assignments below (see tests).
  //   101 weighted groups, drop rules, custom scheme the student can read → matches
  //   102 points, drop lowest 1 — Canvas's score ignores the drop → mismatch ("Drop rules")
  //   103 weights add to 90% with an empty group (scaled up), extra credit, excused,
  //       custom scheme the student can't read (401) → matches
  //   104 grading periods (current: "Second half"), pending-review quiz, omitted
  //       assignment, a grade posted 2 h ago Canvas hasn't counted → period mismatch ("Recently posted")
  //   105 nothing graded yet
  const courses = [
    { id: '101', name: 'CSCI110-0101,0102,0103,0104,0105,0106', course_code: 'CSCI110', color: '#4f7cff', weighted: true, standard: '7',
      canvas: { score: 90.65, grade: 'A-', finalScore: 72.35, finalGrade: 'C-' } }, // custom scale (A ≥ 93)
    { id: '102', name: 'Calculus II', course_code: 'CALC220', color: '#e0876a', weighted: false,
      canvas: { score: 70.67, grade: 'C-', finalScore: 65.23, finalGrade: 'D' } }, // 212/300: no drop (should be 77.09)
    { id: '103', name: 'Writing Seminar', course_code: 'WRIT105', color: '#4fb3a9', weighted: true, standard: '8',
      canvas: { score: 94.79, grade: 'A-', finalScore: 29.95, finalGrade: 'F' } }, // its own scale (A ≥ 95), unreadable
    { id: '104', name: 'General Chemistry I', course_code: 'CHEM115', color: '#c78bd8', weighted: false,
      // Canvas hasn't recalculated since "Lab report: Calorimetry" (34/40) was posted 2 h ago:
      canvas: { score: 71.88, grade: 'C-', finalScore: 47.2, finalGrade: 'F' }, // 115/160, 118/250
      period: { id: '9', title: 'Second half', score: 75, grade: 'C', finalScore: 32, finalGrade: 'F' } }, // 45/60, 48/150 (79 with it)
    { id: '105', name: 'Introduction to Psychology', course_code: 'PSYC105', color: '#d6a94f', weighted: false,
      canvas: { score: null, grade: null, finalScore: 0, finalGrade: 'F' } },
    // Robustness: concluded term, totals hidden by the instructor, no assignments at all.
    { id: '106', name: 'HIST210-0101: Summer Seminar', course_code: 'HIST210', color: '#8f9bb3', weighted: false, concluded: true, hideTotals: true,
      term: { name: 'Summer 2026', start_at: '2026-06-01T04:00:00Z', end_at: '2026-08-10T04:00:00Z' },
      canvas: { score: null, grade: null, finalScore: null, finalGrade: null } },
  ];

  const sub = (o) => ({ workflow_state: 'unsubmitted', score: null, grade: null, submitted_at: null, graded_at: null, posted_at: null, late: false, missing: false, excused: false, ...o });
  const A = (id, course, name, due, points, s, extra = {}) => ({
    id, name, due_at: due, points_possible: points, html_url: `/courses/${course}/assignments/${id}`,
    submission_types: ['online_upload'], grading_type: 'points', assignment_group_id: `g${course}`,
    submission: sub(s || {}), ...extra,
  });

  const assignments = {
    101: [
      A('1', '101', 'Project 3: Bank Simulator', at(5 * H), 100),
      A('2', '101', 'Lab 9: Recursion', eod(2), 20),
      A('3', '101', 'Quiz 6', at(-2 * D), 10, { workflow_state: 'graded', score: 9, grade: '9', submitted_at: at(-3 * D), graded_at: at(-3 * H), posted_at: at(-3 * H) }, { submission_types: ['online_quiz'], is_quiz_assignment: true, quiz_id: '55' }),
      A('4', '101', 'Lab 8: Linked Lists', at(-4 * D), 20, { workflow_state: 'submitted', submitted_at: at(-4.2 * D) }),
    ],
    102: [
      A('11', '102', 'Problem Set 10', at(30 * H), 25),
      A('12', '102', 'Problem Set 9', at(-1.5 * D), 25, { missing: true }),
      A('13', '102', 'Midterm 2', at(-9 * D), 100, { workflow_state: 'graded', score: 81, grade: '81', graded_at: at(-1 * D), posted_at: at(-1 * D) }, { submission_types: ['on_paper'] }),
    ],
    103: [
      A('21', '103', 'Essay 3 Draft: Rhetorical Analysis', eod(4), 50),
      A('22', '103', 'Peer review discussion', eod(6), 10, null, { submission_types: ['discussion_topic'] }),
      A('23', '103', 'Reading response 7', at(-1 * D), 10, { workflow_state: 'submitted', submitted_at: at(-1.1 * D), late: true }),
      A('24', '103', 'Policy Brief Draft', at(4 * H), 20, { workflow_state: 'submitted', submitted_at: at(-2 * H) }, { peer_reviews: true, rubric: null }),
      A('25', '103', 'Policy Brief Peer Review', eod(1), 10, null, { submission_types: ['none'] }),
      A('26', '103', 'Policy Brief', eod(5), 100, null),
      A('27', '103', 'Policy Brief Introduction', at(-9 * D), 10, { workflow_state: 'graded', score: 9, grade: '9', posted_at: at(-8 * D), graded_at: at(-8 * D), submitted_at: at(-9 * D) }),
    ],
    104: [
      A('31', '104', 'Lab report: Titration', at(52 * H), 40),
      A('32', '104', 'Pre-lab quiz 11', eod(5), 5, null, { submission_types: ['online_quiz'], is_quiz_assignment: true }),
      A('33', '104', 'Problem set 8', at(-6 * D), 30, { workflow_state: 'graded', score: 18, grade: '18', graded_at: at(-2 * D), posted_at: at(-2 * D), submitted_at: at(-6.1 * D) }),
    ],
    105: [
      A('41', '105', 'Research participation (SONA)', null, 0, null, { submission_types: ['none'] }),
      A('42', '105', 'Chapter 9 quiz', eod(8), 15, null, { submission_types: ['online_quiz'], is_quiz_assignment: true }),
      // Pass/fail, graded "complete" (robustness).
      A('43', '105', 'Syllabus quiz (complete/incomplete)', at(-12 * D), 0, { workflow_state: 'graded', score: 0, grade: 'complete', graded_at: at(-11 * D), posted_at: at(-11 * D), submitted_at: at(-12 * D) }, { grading_type: 'pass_fail' }),
    ],
    106: [],
  };
  // Past graded work for the grade scenarios (posted unless noted).
  const G = (score, daysAgo, extra = {}) => ({ workflow_state: 'graded', score, grade: String(score), submitted_at: at(-(daysAgo + 1) * D), graded_at: at(-daysAgo * D), posted_at: at(-daysAgo * D), ...extra });
  assignments[101].push(
    A('1001', '101', 'Project 1: Shapes', at(-40 * D), 100, G(85, 35)),
    A('1002', '101', 'Project 2: Inventory', at(-20 * D), 100, G(92, 15)),
    A('1003', '101', 'Lab 5: Arrays', at(-30 * D), 20, G(18, 28)),
    A('1004', '101', 'Lab 6: Strings', at(-23 * D), 20, G(20, 21)),
    A('1005', '101', 'Lab 7: Recursion warm-up', at(-16 * D), 20, G(12, 14)),
    A('1006', '101', 'Quiz 4', at(-16 * D), 10, G(6, 16), { submission_types: ['online_quiz'], is_quiz_assignment: true }),
    A('1007', '101', 'Quiz 5', at(-9 * D), 10, G(10, 9), { submission_types: ['online_quiz'], is_quiz_assignment: true }),
    A('1008', '101', 'Midterm 1', at(-18 * D), 100, G(88, 12), { submission_types: ['on_paper'] }),
  );
  assignments[102].push(
    A('1101', '102', 'Problem Set 5', at(-36 * D), 25, G(0, 34)),
    A('1102', '102', 'Problem Set 6', at(-29 * D), 25, G(22, 27)),
    A('1103', '102', 'Problem Set 7', at(-22 * D), 25, G(25, 20)),
    A('1104', '102', 'Problem Set 8', at(-15 * D), 25, G(10, 13)),
    A('1105', '102', 'Midterm 1', at(-30 * D), 100, G(74, 26), { submission_types: ['on_paper'] }),
  );
  assignments[103].push(
    A('1201', '103', 'Essay 2: Narrative', at(-25 * D), 50, G(44, 20)),
    A('1202', '103', 'Reading response 5', at(-15 * D), 10, G(10, 14)),
    A('1203', '103', 'Reading response 6', at(-8 * D), 10, { workflow_state: 'graded', excused: true, score: null, grade: null, posted_at: at(-7 * D) }),
    A('1204', '103', 'Library workshop (extra credit)', at(-12 * D), 0, G(2, 11)),
  );
  assignments[104].push(
    A('1301', '104', 'Exam 1', at(-45 * D), 100, G(70, 40), { submission_types: ['on_paper'] }),
    A('1302', '104', 'Pre-lab quiz 10', at(-3 * D), 5, { workflow_state: 'pending_review', score: 3, grade: '3', submitted_at: at(-3 * D), posted_at: at(-3 * D) }, { submission_types: ['online_quiz'], is_quiz_assignment: true }),
    A('1303', '104', 'Practice exam (not counted)', at(-10 * D), 100, G(40, 9), { omit_from_final_grade: true }),
    A('1304', '104', 'Lab report: Calorimetry', at(-5 * D), 40, { ...G(34, 0), graded_at: at(-2 * H), posted_at: at(-2 * H) }),
    A('1305', '104', 'Problem set 7', at(-13 * D), 30, G(27, 11)),
  );
  // Assignment groups: [id, course, name, weight, rules, position]
  if (SCALE > 1) {
    for (const cid of Object.keys(assignments)) {
      const base = [...assignments[cid]]; // a copy: the loop appends to assignments[cid]
      for (let k = 1; k < SCALE; k++) {
        for (const a of base) {
          const id = `${a.id}${k}${String(k).padStart(3, '0')}`;
          const shift = (k * 3.7 % 60 - 30) * D; // −30…+30 days
          assignments[cid].push({ ...a, id, copyOf: a.id, name: `${a.name} (copy ${k})`, html_url: `/courses/${cid}/assignments/${id}`,
            due_at: a.due_at ? new Date(Date.parse(a.due_at) + shift).toISOString() : null, quiz_id: a.quiz_id ? `${a.quiz_id}${k}` : undefined });
        }
      }
    }
  }

  const GROUPS = [
    ['g101p', '101', 'Projects', 40, {}, 1], ['g101l', '101', 'Labs', 20, { drop_lowest: 1 }, 2],
    ['g101q', '101', 'Quizzes', 15, { drop_lowest: 1 }, 3], ['g101e', '101', 'Exams', 25, {}, 4],
    ['g102h', '102', 'Homework', 30, { drop_lowest: 1 }, 1], ['g102e', '102', 'Exams', 70, {}, 2],
    ['g103e', '103', 'Essays', 50, {}, 1], ['g103r', '103', 'Reading responses', 30, {}, 2], ['g103p', '103', 'Participation', 10, {}, 3],
    ['g104', '104', 'Assignments', 0, {}, 1], ['g104x', '104', 'Exams', 0, {}, 2],
    ['g105', '105', 'Assignments', 100, {}, 1],
  ];
  const GROUP_OF = {
    1: 'g101p', 1001: 'g101p', 1002: 'g101p', 2: 'g101l', 4: 'g101l', 1003: 'g101l', 1004: 'g101l', 1005: 'g101l',
    3: 'g101q', 1006: 'g101q', 1007: 'g101q', 1008: 'g101e',
    11: 'g102h', 12: 'g102h', 1101: 'g102h', 1102: 'g102h', 1103: 'g102h', 1104: 'g102h', 13: 'g102e', 1105: 'g102e',
    21: 'g103e', 24: 'g103e', 26: 'g103e', 27: 'g103e', 1201: 'g103e', 1204: 'g103e', 23: 'g103r', 1202: 'g103r', 1203: 'g103r', 22: 'g103p', 25: 'g103p',
    1301: 'g104x', 1303: 'g104x',
  };
  for (const [cid, list] of Object.entries(assignments)) for (const a of list) a.assignment_group_id = GROUP_OF[a.copyOf || a.id] || `g${cid}`;
  // CHEM115's current grading period ("Second half") starts 30 days ago; undated work belongs to the last period.
  const PERIOD_START = now - 30 * D;
  const inPeriod = (a) => !a.due_at || new Date(a.due_at).getTime() >= PERIOD_START;
  const groupsFor = (cid, periodId) => GROUPS.filter((g) => g[1] === cid).map(([id, , name, weight, rules, position]) => ({
    id, name, group_weight: weight, position, rules,
    assignments: (assignments[cid] || []).filter((a) => a.assignment_group_id === id && (!periodId || inPeriod(a))),
  }));

  const planner = [
    { plannable_type: 'planner_note', plannable_id: '900', plannable_date: at(26 * H), course_id: null, plannable: { id: '900', title: 'Email TA about regrade', todo_date: at(26 * H) }, submissions: false, planner_override: null },
    { plannable_type: 'discussion_topic', plannable_id: '901', plannable_date: eod(3), course_id: '105', html_url: '/courses/105/discussion_topics/901', plannable: { id: '901', title: 'Week 12 reflection (ungraded)', todo_date: eod(3) }, submissions: false, planner_override: null },
    { plannable_type: 'discussion_topic', plannable_id: '902', course_id: '103', html_url: '/courses/103/discussion_topics/902', plannable: { id: '902', title: 'Peer feedback circle (ungraded)', todo_date: '2024-04-18T14:00:00Z' }, submissions: false, planner_override: null },
    { plannable_type: 'assessment_request', plannable_id: '3301', course_id: '103', plannable_date: '2024-04-18T14:00:00Z',
      // Live shape (ELMS, Nov 2026): no /submissions/ segment, no plannable.assignment_id.
      html_url: '/courses/103/assignments/24?reviewee_id=4724',
      plannable: { id: '3301', title: 'Policy Brief Draft', todo_date: '2024-04-18T14:00:00Z', workflow_state: 'assigned' }, submissions: false, planner_override: null },
    { plannable_type: 'assignment', plannable_id: '2', plannable_date: eod(2), course_id: '101', html_url: '/courses/101/assignments/2', plannable: { id: '2', title: 'Lab 9: Recursion', due_at: eod(2) }, submissions: { submitted: false }, planner_override: null },
  ];

  // Calendar events: relative to today so the current week always has some.
  const dayAt = (days, h, m = 0) => { const d = new Date(now + days * D); d.setHours(h, m, 0, 0); return d.toISOString(); };
  const localDate = (days) => { const d = new Date(now + days * D); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const calendarEvents = [
    ...[-2, 0, 2, 5, 7].map((o, i) => ({ id: 7000 + i, title: 'CSCI110 Lecture', start_at: dayAt(o, 10), end_at: dayAt(o, 10, 50), all_day: false, context_code: 'course_101', location_name: 'IRB 0324', workflow_state: 'active', html_url: `/calendar?event_id=${7000 + i}&include_contexts=course_101` })),
    { id: 7010, title: 'CALC220 Office hours', start_at: dayAt(0, 10, 30), end_at: dayAt(0, 11, 30), all_day: false, context_code: 'course_102', location_name: 'Kirwan 1311', location_address: '4176 Campus Dr', description: '<p>Bring <strong>Problem Set 10</strong> questions.<br>Drop-in, no appointment.</p><script>window.__pwnedCal = 1</script>', workflow_state: 'active', html_url: '/calendar?event_id=7010' },
    { id: 7011, title: 'Study group', start_at: dayAt(0, 10, 15), end_at: dayAt(0, 11), all_day: false, context_code: 'user_1', workflow_state: 'active', html_url: '/calendar?event_id=7011' },
    { id: 7012, title: 'CHEM115 Exam 2 review', start_at: dayAt(1, 18), end_at: dayAt(1, 20), all_day: false, context_code: 'course_104', location_name: 'CHM 1407', workflow_state: 'active', html_url: '/calendar?event_id=7012' },
    { id: 7013, title: 'No class: Thanksgiving break', start_at: `${localDate(8)}T05:00:00Z`, end_at: `${localDate(10)}T05:00:00Z`, all_day: true, all_day_date: localDate(8), context_code: 'course_103', workflow_state: 'active', html_url: '/calendar?event_id=7013' },
    { id: 7014, title: 'Deleted event', start_at: dayAt(1, 9), end_at: dayAt(1, 10), all_day: false, context_code: 'course_101', workflow_state: 'deleted', html_url: '/x' },
    { id: 7015, title: 'Early lab check-in', start_at: dayAt(3, 7, 15), end_at: dayAt(3, 8), all_day: false, effective_context_code: 'course_104', context_code: 'course_section_9', workflow_state: 'active', html_url: '/calendar?event_id=7015' },
  ];

  const announcements = [
    { id: '501', title: 'Office hours moved to Thursday', message: '<p>This week only, office hours are <b>Thursday 2–4pm</b> in IRB 1116.</p>', posted_at: at(-5 * H), read_state: 'unread', context_code: 'course_101', html_url: '/courses/101/discussion_topics/501', user_name: 'Prof. Rivera' },
    { id: '502', title: 'Midterm 2 grades posted', message: '<p>Average was 78. Solutions are in Files → Exams.</p>', posted_at: at(-1 * D), read_state: 'unread', context_code: 'course_102', html_url: '/courses/102/discussion_topics/502', user_name: 'Dr. Chen' },
    { id: '503', title: 'Lab safety reminder', message: '<p>Goggles are required for all of next week’s titration lab.</p>', posted_at: at(-3 * D), read_state: 'read', context_code: 'course_104', html_url: '/courses/104/discussion_topics/503', user_name: 'CHEM115 Staff' },
  ];

  const RUBRIC = [
    { id: '_c1', description: 'Correctness', long_description: 'Passes the public and release tests.', points: 60,
      ratings: [{ id: 'r1', description: 'All tests pass', points: 60 }, { id: 'r2', description: 'Most tests pass', points: 40 }, { id: 'r3', description: 'Few tests pass', points: 10 }] },
    { id: '_c2', description: 'Style', long_description: 'Requirements<br/> Naming is consistent.<br/> Comments explain why, not what.', points: 25,
      ratings: [{ id: 'r4', description: 'Excellent &amp; idiomatic', points: 25 }, { id: 'r5', description: 'Adequate', points: 15 }, { id: 'r6', description: 'Needs work', points: 5 }] },
    { id: '_c3', description: 'Design', points: 15,
      ratings: [{ id: 'r7', description: 'Clean decomposition', points: 15 }, { id: 'r8', description: 'Some duplication', points: 8 }] },
  ];

  function mockAssignment(cid, aid) {
    const base = (assignments[cid] || []).find((a) => a.id === aid);
    if (!base) return null;
    const extra = {
      description: `<p>Build a <strong>bank simulator</strong> that supports deposits, withdrawals and transfers. Read the
        <a href="/courses/${cid}/assignments/2">Lab 9 warm-up</a> first, and see the
        <a class="instructure_file_link" href="/courses/${cid}/files/3?wrap=1">project spec (PDF)</a>.</p>
        <p style="color:#000;background:#fff">Interest compounds monthly:
        <img class="equation_image" alt="A = P(1 + r/n)^{nt}" src="/equation_images/A%253DP"></p>
        <h2>Walkthrough video</h2>
        <iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" title="Project walkthrough"></iframe>
        <iframe src="https://tracker.example.com/pixel"></iframe>
        <script>window.__pwnedDetail = true<\/script>
        <ul><li>Use <code>BigDecimal</code> for money.</li><li>Submit a single <code>.zip</code>.</li></ul>`,
      unlock_at: at(-10 * D), lock_at: base.due_at ? new Date(new Date(base.due_at).getTime() + 2 * D).toISOString() : null,
      allowed_attempts: 3, allowed_extensions: ['zip', 'java'], grading_type: 'points',
      rubric: aid === '1' || aid === '13' || aid === '24' ? RUBRIC : null,
      rubric_settings: { points_possible: 100 },
      html_url: `/courses/${cid}/assignments/${aid}`,
    };
    if (aid === '3') Object.assign(extra, { description: '<p>Covers recursion and linked lists. 20 minutes, one attempt.</p>', allowed_attempts: 1, rubric: null });
    // Text/URL submission: two attempts.
    if (aid === '21') Object.assign(extra, { submission_types: ['online_text_entry', 'online_url'], allowed_attempts: 2, description: '<p>Write a 600-word rhetorical analysis. Submit it as text, or as a link to a shared document.</p>', rubric: null });
    if (aid === '41') Object.assign(extra, { submission_types: ['external_tool'], external_tool_tag_attributes: { url: 'https://sona.umd.example/launch', new_tab: false }, description: '' });
    return { ...base, ...extra };
  }

  function mockSubmission(cid, aid) {
    const base = (assignments[cid] || []).find((a) => a.id === aid);
    if (!base) return null;
    const s = { ...base.submission, assignment_id: aid, attempt: base.submission.submitted_at ? 1 : null, submission_history: [], submission_comments: [], rubric_assessment: null };
    const mine = mockSubs[`${cid}:${aid}`];
    if (mine) Object.assign(s, mine);
    if (aid === '13') {
      Object.assign(s, {
        attempt: 2, submission_type: 'online_upload', submitted_at: at(-8 * D), seconds_late: 0,
        attachments: [{ id: 91, display_name: 'midterm2-scan.pdf', size: 1820000, 'content-type': 'application/pdf', url: 'https://umd.instructure.com/files/91/download', preview_url: '/courses/102/assignments/13/submissions/1/previews/91' }],
        submission_history: [
          { attempt: 1, submitted_at: at(-9 * D), score: null, submission_type: 'online_upload' },
          { attempt: 2, submitted_at: at(-8 * D), score: 81, grade: '81', submission_type: 'online_upload' },
        ],
        submission_comments: [
          { id: 1, author_name: 'Dr. Chen', comment: 'Nice work on the series problems.\nWatch your signs in 4(b).', created_at: at(-1 * D), attempt: 2,
            attachments: [{ id: 92, display_name: 'annotated.pdf', size: 920000, 'content-type': 'application/pdf', url: 'https://umd.instructure.com/files/92/download' }] },
          { id: 2, author_name: 'Alex Morgan', comment: 'Thanks! Could I get a regrade on 3?', created_at: at(-20 * H), attempt: 2 },
        ],
        rubric_assessment: { _c1: { points: 40, rating_id: 'r2', comments: 'Two release tests fail.' }, _c2: { points: 25, rating_id: 'r4' }, _c3: { points: 15, rating_id: null } },
      });
    }
    return s;
  }

  function route(url) {
    const p = url.pathname;
    if (p === '/api/v1/users/self') return { id: '1', name: 'Alex Morgan', short_name: 'Alex Morgan' };
    if (p === '/api/v1/users/self/colors') return { custom_colors: Object.fromEntries(courses.map((c) => [`course_${c.id}`, c.color])) };
    if (p === '/api/v1/users/self/dashboard_positions') return { dashboard_positions: Object.fromEntries(courses.map((c, i) => [`course_${c.id}`, i])) };
    if (p === '/api/v1/courses') {
      return courses.map((c) => ({
        id: c.id, name: c.name, course_code: c.course_code, term: c.term || { name: 'Fall 2026', start_at: '2026-08-31T04:00:00Z', end_at: '2026-12-20T04:00:00Z' },
        concluded: !!c.concluded,
        apply_assignment_group_weights: c.weighted, hide_final_grades: !!c.hideTotals, grading_standard_id: c.standard ? Number(c.standard) : null,
        enrollments: [{
          type: 'student',
          computed_current_score: c.canvas.score, computed_current_grade: c.canvas.grade,
          computed_final_score: c.canvas.finalScore, computed_final_grade: c.canvas.finalGrade,
          has_grading_periods: !!c.period,
          ...(c.period ? {
            current_grading_period_id: Number(c.period.id), current_grading_period_title: c.period.title,
            current_period_computed_current_score: c.period.score, current_period_computed_current_grade: c.period.grade,
            current_period_computed_final_score: c.period.finalScore, current_period_computed_final_grade: c.period.finalGrade,
          } : {}),
        }],
      }));
    }
    const ag = p.match(/^\/api\/v1\/courses\/(\d+)\/assignment_groups$/);
    if (ag) {
      const period = url.searchParams.get('grading_period_id');
      window.__gradeRequests = (window.__gradeRequests || []).concat([url.search]);
      if (period && ag[1] !== '104') return { __status: 400, body: { errors: [{ message: 'mock: no grading periods' }] } };
      return groupsFor(ag[1], period);
    }
    const gs = p.match(/^\/api\/v1\/courses\/(\d+)\/grading_standards$/);
    if (gs) {
      if (gs[1] === '103') return { __status: 401, body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] } };
      return [{ id: 7, title: 'CSCI110 scale', context_type: 'Course', points_based: false, scaling_factor: 1,
        grading_scheme: [{ name: 'A', value: 0.93 }, { name: 'A-', value: 0.9 }, { name: 'B+', value: 0.87 }, { name: 'B', value: 0.83 }, { name: 'B-', value: 0.8 },
          { name: 'C+', value: 0.77 }, { name: 'C', value: 0.73 }, { name: 'C-', value: 0.7 }, { name: 'D', value: 0.6 }, { name: 'F', value: 0 }] }];
    }
    if (p === '/api/v1/planner/items') return planner;
    if (p === '/api/v1/calendar_events') {
      window.__calendarRequests = (window.__calendarRequests || []).concat([url.search]);
      const codes = url.searchParams.getAll('context_codes[]');
      if (codes.length > 10) return { __status: 400, body: { errors: [{ message: 'mock: more than 10 context codes' }] } };
      const from = url.searchParams.get('start_date');
      const to = url.searchParams.get('end_date'); // inclusive, yyyy-mm-dd
      const local = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
      return calendarEvents.filter((e) => codes.includes(e.effective_context_code || e.context_code)
        && (e.all_day_date || local(e.start_at)) >= from && (e.all_day_date || local(e.start_at)) <= to);
    }
    if (p === '/api/v1/announcements') {
      const codes = url.searchParams.getAll('context_codes[]');
      return announcements.filter((a) => !codes.length || codes.includes(a.context_code));
    }
    const mod = p.match(/^\/api\/v1\/courses\/(\d+)\/modules$/);
    if (mod) {
      const cid = mod[1];
      const list = assignments[cid] || [];
      return [
        { id: `m${cid}1`, name: 'Week 1 — Getting started', position: 1, state: 'completed', items_count: 3, items: [
          { id: 'i1', type: 'SubHeader', title: 'Read first', indent: 0 },
          { id: 'i2', type: 'Page', title: 'Syllabus & course policies', indent: 1, html_url: `/courses/${cid}/pages/syllabus`, completion_requirement: { type: 'must_view', completed: true } },
          { id: 'i3', type: 'File', title: 'Lecture 1 slides.pdf', indent: 1, html_url: `/courses/${cid}/files/1`, completion_requirement: { type: 'must_view', completed: true } },
        ] },
        { id: `m${cid}2`, name: 'Week 12 — Current unit', position: 2, state: 'started', items_count: list.length + 1, items: [
          ...list.map((a, i) => ({ id: `ia${a.id}`, type: a.is_quiz_assignment ? 'Quiz' : 'Assignment', content_id: a.is_quiz_assignment ? a.quiz_id : a.id, title: a.name, indent: 0, html_url: a.html_url,
            content_details: { due_at: a.due_at, points_possible: a.points_possible },
            completion_requirement: { type: 'must_submit', completed: i % 2 === 1 } })),
          { id: 'ix', type: 'ExternalUrl', title: 'Course textbook (OpenStax)', indent: 0, external_url: 'https://openstax.org/', html_url: '/x' },
        ] },
        { id: `m${cid}3`, name: 'Week 13 — Next unit', position: 3, state: 'locked', unlock_at: at(5 * D), items_count: 40, items: undefined },
      ];
    }
    const prs = p.match(/^\/api\/v1\/courses\/(\d+)\/assignments\/(\d+)\/peer_reviews$/);
    if (prs) return [{ id: 1, assessor_id: '1', user_id: '4724', asset_type: 'Submission', workflow_state: 'assigned', user: { id: '4724', display_name: 'Jordan Lee' } }];
    const topic = p.match(/^\/api\/v1\/courses\/(\d+)\/discussion_topics\/(\d+)$/);
    if (topic) {
      if (topic[2] === '77') return { id: '77', title: 'Policy Brief Draft', assignment_id: '24', html_url: `/courses/${topic[1]}/discussion_topics/77` };
      return { id: topic[2], title: topic[2] === '901' ? 'Week 12 reflection (ungraded)' : 'Peer feedback circle (ungraded)',
        message: '<p>Share one thing you&rsquo;d change about this week&rsquo;s reading.<br/>Reply to two classmates.</p>',
        user_name: 'Dr. Patel', posted_at: at(-3 * D), todo_date: topic[2] === '901' ? eod(3) : '2024-04-18T14:00:00Z',
        discussion_subentry_count: 14, unread_count: 3, read_state: 'read', require_initial_post: true,
        html_url: `/courses/${topic[1]}/discussion_topics/${topic[2]}`, attachments: [{ id: 5, filename: 'Reading+guide.pdf', size: 52000, url: 'https://umd.instructure.com/files/5/download' }] };
    }
    // ---- assignment detail ----
    const subm = p.match(/^\/api\/v1\/courses\/(\d+)\/assignments\/(\d+)\/submissions\/(\d+)$/);
    if (subm) return mockSubmission(subm[1], subm[2]);
    const one = p.match(/^\/api\/v1\/courses\/(\d+)\/assignments\/(\d+)$/);
    if (one) return mockAssignment(one[1], one[2]);
    const modItems = p.match(/^\/api\/v1\/courses\/(\d+)\/modules\/[^/]+\/items$/);
    if (modItems) return [{ id: 'big1', type: 'Page', title: 'Big module item (fetched separately)', indent: 0, html_url: '/x', content_details: { locked_for_user: true } }];
    const folders = p.match(/^\/api\/v1\/courses\/(\d+)\/folders$/);
    if (folders) {
      if (folders[1] === '105') return { __status: 401, body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] } };
      return [
        { id: 'f1', name: 'course files', full_name: 'course files', parent_folder_id: null, files_count: 2, folders_count: 2, position: 1 },
        { id: 'f2', name: 'Lectures', full_name: 'course files/Lectures', parent_folder_id: 'f1', files_count: 3, folders_count: 1, position: 1 },
        { id: 'f3', name: 'Week 12', full_name: 'course files/Lectures/Week 12', parent_folder_id: 'f2', files_count: 2, folders_count: 0, position: 1 },
        { id: 'f4', name: 'Exams', full_name: 'course files/Exams', parent_folder_id: 'f1', files_count: 1, folders_count: 0, position: 2 },
      ];
    }
    const ffiles = p.match(/^\/api\/v1\/folders\/(f\d)\/files$/);
    const mkFile = (id, name, type, size, folder) => ({ id, display_name: name, 'content-type': type, size, folder_id: folder, modified_at: at(-id * D), url: `https://umd.instructure.com/files/${id}/download` });
    if (ffiles) {
      const f = ffiles[1];
      if (f === 'f1') return [mkFile(1, 'Syllabus.pdf', 'application/pdf', 182000, 'f1'), mkFile(2, 'Course schedule.xlsx', 'application/vnd.ms-excel', 24000, 'f1')];
      if (f === 'f2') return [mkFile(3, 'Lecture 10.pdf', 'application/pdf', 2400000, 'f2'), mkFile(4, 'Lecture 11.pdf', 'application/pdf', 3100000, 'f2'), mkFile(5, 'Demo recording.mp4', 'video/mp4', 98000000, 'f2')];
      if (f === 'f3') return [mkFile(6, 'Lecture 12.pdf', 'application/pdf', 2100000, 'f3'), mkFile(7, 'diagram.png', 'image/png', 340000, 'f3')];
      return [{ ...mkFile(8, 'Midterm 2 solutions.pdf', 'application/pdf', 410000, 'f4'), locked_for_user: false }];
    }
    const fsearch = p.match(/^\/api\/v1\/courses\/(\d+)\/files$/);
    if (fsearch) {
      const term = (url.searchParams.get('search_term') || '').toLowerCase();
      return [mkFile(3, 'Lecture 10.pdf', 'application/pdf', 2400000, 'f2'), mkFile(6, 'Lecture 12.pdf', 'application/pdf', 2100000, 'f3'), mkFile(1, 'Syllabus.pdf', 'application/pdf', 182000, 'f1')]
        .filter((f) => f.display_name.toLowerCase().includes(term));
    }
    return null;
  }
  window.__mockWrites = [];

  // XMLHttpRequest for the storage origin (uploads use XHR for progress/cancel).
  // window.__mockUploadDelay = ms per file (progress in 4 ticks; cancellable);
  // window.__mockUploadFailNext = n fails the next n sends with a network error.
  const RealXHR = window.XMLHttpRequest;
  class MockXHR {
    constructor() { this.upload = { onprogress: null }; this.status = 0; this.responseText = ''; this.responseURL = ''; this.withCredentials = false; this._h = new Headers(); this._aborted = false; }
    open(method, url) { this._url = new URL(url); if (this._url.origin !== 'https://mock-uploads.example') { this._real = new RealXHR(); this._real.open(method, url); } }
    getResponseHeader(n) { return this._real ? this._real.getResponseHeader(n) : this._h.get(n); }
    abort() { if (this._real) return this._real.abort(); if (this._done) return; this._aborted = true; this._done = true; this.onabort?.(); }
    async send(body) {
      if (this._real) { Object.assign(this._real, { onload: this.onload, onerror: this.onerror, onabort: this.onabort }); return this._real.send(body); }
      const total = [...body.entries()].pop()[1].size || 1;
      const delay = window.__mockUploadDelay || 0;
      for (let i = 1; i <= 4; i++) {
        if (delay) await new Promise((r) => setTimeout(r, delay / 4));
        if (this._aborted) return;
        this.upload.onprogress?.({ lengthComputable: true, loaded: Math.round(total * i / 4), total });
      }
      if (this._aborted) return;
      if (window.__mockUploadFailNext > 0) { window.__mockUploadFailNext--; this._done = true; this.onerror?.(); return; }
      let res;
      try { res = await storageServer(this._url, { body, credentials: this.withCredentials ? 'include' : 'omit' }); }
      catch { this._done = true; this.onerror?.(); return; }
      if (this._aborted) return;
      this._done = true;
      this.status = res.status; this._h = res.headers; this.responseText = await res.text(); this.responseURL = this._url.href;
      this.onload?.();
    }
  }
  window.XMLHttpRequest = MockXHR;
  const mockSubs = window.__mockSubs = {};

  // ---- Submissions: POST records text/URL like Canvas -------------
  // Canvas sanitizes body HTML; the mock wraps it in a div to prove the check
  // compares text, not markup. window.__mockSubmitBroken = true accepts the
  // POST without recording it (to test the re-fetch check).
  function submissionWrite(p, b) {
    const m = p.match(/^\/api\/v1\/courses\/(\d+)\/assignments\/(\d+)\/submissions$/);
    if (!m) return null;
    const a = mockAssignment(m[1], m[2]);
    const t = b?.submission?.submission_type;
    if (!a || !a.submission_types.includes(t)) return json(400, { errors: [{ message: `mock: submission type ${t} not allowed` }] });
    const prev = mockSubmission(m[1], m[2]);
    let attachments = [];
    if (t === 'online_upload') {
      const ids = (b.submission.file_ids || []).map(String);
      const files = ids.map((id) => mockFiles.files.find((f) => String(f.id) === id && !f.deleted && f.forAssignment === `${m[1]}:${m[2]}`));
      if (!ids.length || files.some((f) => !f)) return json(400, { errors: [{ message: 'mock: unknown file_ids' }] });
      attachments = files.map(fileJson);
      if (window.__mockSubmitWrongFiles) attachments = attachments.slice(0, -1);
    }
    const rec = { workflow_state: 'submitted', submission_type: t, submitted_at: new Date().toISOString(), attempt: (prev.attempt || 0) + 1, attachments,
      body: t === 'online_text_entry' ? `<div class="sanitized">${b.submission.body}</div>` : null,
      url: t === 'online_url' ? (/^https?:/.test(b.submission.url) ? b.submission.url : `http://${b.submission.url}`) : null,
      late: !!(a.due_at && Date.parse(a.due_at) < Date.now()) };
    if (!window.__mockSubmitBroken) mockSubs[`${m[1]}:${m[2]}`] = rec;
    return json(200, { ...prev, ...rec });
  }

  // ---- File uploads: personal Files, 3-step flow ----------
  // window.__mockUploadMode: 'location' (default: 201 + Location → create_success),
  // 'json' (201 with the file JSON), 'opaque' (nothing readable → find by name),
  // 'cors' (the browser blocks the cross-origin POST), 'truncate' (stores fewer bytes).
  const mockFiles = window.__mockFiles = { nextId: 7000, pending: {}, files: [], folders: [] };
  const fileJson = (f) => ({ id: f.id, display_name: f.name, filename: f.name, size: f.bytes.byteLength, 'content-type': f.type, folder_id: f.folderId,
    url: `https://umd.instructure.com/files/${f.id}/download?download_frd=1&verifier=v${f.id}` });
  function uploadsApi(method, p, b, url) {
    let m;
    if (method === 'GET' && p === '/api/v1/users/self/files/quota') return json(200, { quota: 524288000, quota_used: 1200000 });
    if (method === 'POST' && p === '/api/v1/users/self/files') {
      const n = mockFiles.nextId++;
      mockFiles.pending[n] = { name: b.name, size: b.size, type: b.content_type, path: b.parent_folder_path };
      return json(200, { upload_url: `https://mock-uploads.example/upload/${n}`, upload_params: { key: `/users/1/files/${b.name}`, 'x-amz-signature': `sig${n}`, success_action_status: '201' } });
    }
    if (method === 'POST' && (m = p.match(/^\/api\/v1\/courses\/(\d+)\/assignments\/(\d+)\/submissions\/self\/files$/))) {
      const n = mockFiles.nextId++;
      mockFiles.pending[n] = { name: b.name, size: b.size, type: b.content_type, path: 'Submissions', forAssignment: `${m[1]}:${m[2]}` };
      // Shape seen live on ELMS (2026-11-20): token in the URL, filename/content_type params, file_param.
      return json(200, { upload_url: `https://mock-uploads.example/upload/${n}?token=eyJhbGciOiJIUzUxMiJ9.eyJmaWxlIjoiJHtufSJ9.c2lnbmF0dXJlc2lnbmF0dXJl`, upload_params: { filename: b.name, content_type: b.content_type, 'x-amz-signature': `sig${n}` }, file_param: 'file', progress: null });
    }
    if (method === 'GET' && (m = p.match(/^\/api\/v1\/files\/(\d+)\/create_success$/))) {
      const f = mockFiles.files.find((x) => String(x.id) === m[1]);
      return f ? json(200, fileJson(f)) : json(404, { errors: [{ message: 'not found' }] });
    }
    if ((m = p.match(/^\/api\/v1\/files\/(\d+)$/))) {
      const f = mockFiles.files.find((x) => String(x.id) === m[1] && !x.deleted);
      if (!f) return json(404, { errors: [{ message: 'not found' }] });
      if (method === 'DELETE') f.deleted = true;
      return json(200, fileJson(f));
    }
    if (method === 'GET' && (m = p.match(/^\/api\/v1\/users\/self\/folders\/by_path\/(.+)$/))) {
      const folder = mockFiles.folders.find((x) => x.name === decodeURIComponent(m[1]) && !x.deleted);
      return folder ? json(200, [{ id: 'root', name: 'my files' }, folder]) : json(404, { errors: [{ message: 'not found' }] });
    }
    if (method === 'GET' && (m = p.match(/^\/api\/v1\/folders\/(fo\d+)\/files$/))) { // only upload-test folders (course folders are f1…f4)
      return json(200, mockFiles.files.filter((f) => f.folderId === m[1] && !f.deleted).map(fileJson));
    }
    if (method === 'DELETE' && (m = p.match(/^\/api\/v1\/folders\/(fo\d+)$/))) {
      const folder = mockFiles.folders.find((x) => x.id === m[1]);
      if (!folder) return json(404, { errors: [{ message: 'not found' }] });
      if (mockFiles.files.some((f) => f.folderId === folder.id && !f.deleted)) return json(400, { errors: [{ message: 'Can\'t delete a folder with content' }] });
      folder.deleted = true;
      return json(200, folder);
    }
    if (method === 'GET' && (m = p.match(/^\/files\/(\d+)\/download$/))) {
      const f = mockFiles.files.find((x) => String(x.id) === m[1] && !x.deleted);
      return f ? new Response(f.bytes, { status: 200, headers: { 'Content-Type': f.type } }) : new Response('not found', { status: 404 });
    }
    return null;
  }
  /** The storage server (another origin): checks the signed params and that `file` is last. */
  async function storageServer(url, init) {
    const mode = window.__mockUploadMode || 'location';
    if (mode === 'cors') throw new TypeError('Load failed');
    const n = Number(url.pathname.split('/').pop());
    const pend = mockFiles.pending[n];
    const entries = [...init.body.entries()];
    if (!pend || init.credentials !== 'omit' || entries[entries.length - 1][0] !== 'file' || !entries.some(([k, v]) => k === 'x-amz-signature' && v === `sig${n}`)) {
      return new Response('<Error>bad request</Error>', { status: 400 });
    }
    const blob = entries[entries.length - 1][1];
    let bytes = await blob.arrayBuffer();
    if (mode === 'truncate') bytes = bytes.slice(0, Math.max(0, bytes.byteLength - 3));
    let folder = mockFiles.folders.find((x) => x.name === pend.path && !x.deleted);
    if (!folder) { folder = { id: `fo${n}`, name: pend.path }; mockFiles.folders.push(folder); }
    const f = { id: n, name: pend.name, type: pend.type, bytes, folderId: folder.id, forAssignment: pend.forAssignment || null };
    mockFiles.files.push(f);
    delete mockFiles.pending[n];
    if (mode === 'json') return new Response(JSON.stringify(fileJson(f)), { status: 201, headers: { 'Content-Type': 'application/json' } });
    if (mode === 'opaque') return new Response('', { status: 201 });
    return new Response('', { status: 201, headers: { Location: `https://umd.instructure.com/api/v1/files/${n}/create_success?uuid=u${n}` } });
  }

  // ---- Planner overrides + notes: stateful, like Canvas ----------
  // Shapes follow the Planner API docs: override objects report plannable_type
  // as a class name; note objects call the text "description". Set
  // window.__mockPlannerBroken = true to make Canvas accept writes without
  // saving them (to test the read-back check).
  const CLASS = { assignment: 'Assignment', quiz: 'Quizzes::Quiz', discussion_topic: 'DiscussionTopic', wiki_page: 'WikiPage', planner_note: 'PlannerNote', assessment_request: 'AssessmentRequest', calendar_event: 'CalendarEvent' };
  const mockPlanner = window.__mockPlanner = {
    nextId: 5000,
    overrides: [{ id: '4001', plannable_type: 'Assignment', plannable_id: '4', assignment_id: '4', marked_complete: true, dismissed: false, workflow_state: 'active' }],
    notes: [{ id: '900', title: 'Email TA about regrade', description: null, course_id: null, todo_date: at(26 * H), workflow_state: 'active', linked_object_type: null, linked_object_id: null }],
  };
  const titleOf = (type, id) => Object.values(assignments).flat().find((a) => type === 'assignment' ? a.id === String(id) : a.quiz_id === String(id))?.name || `Linked ${type} ${id}`;
  const localMidnight = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).toISOString(); };
  const json = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-Rate-Limit-Remaining': '650.0' } });
  function plannerWrite(method, p, b) {
    const broken = !!window.__mockPlannerBroken;
    let m;
    if (method === 'POST' && p === '/api/v1/planner/overrides') {
      if (mockPlanner.overrides.some((o) => o.workflow_state !== 'deleted' && o.plannable_type === CLASS[b.plannable_type] && o.plannable_id === String(b.plannable_id))) return json(400, { errors: [{ message: 'mock: override exists' }] });
      const o = { id: String(mockPlanner.nextId++), plannable_type: CLASS[b.plannable_type] || b.plannable_type, plannable_id: String(b.plannable_id), assignment_id: b.plannable_type === 'assignment' ? String(b.plannable_id) : null, marked_complete: broken ? false : !!b.marked_complete, dismissed: !!b.dismissed, workflow_state: 'active' };
      mockPlanner.overrides.push(o);
      return json(200, o);
    }
    if ((m = p.match(/^\/api\/v1\/planner\/overrides\/(\w+)$/))) {
      const o = mockPlanner.overrides.find((x) => x.id === m[1]);
      if (!o || o.workflow_state === 'deleted') return json(404, { errors: [{ message: 'not found' }] });
      if (method === 'PUT' && !broken && 'marked_complete' in b) o.marked_complete = !!b.marked_complete;
      if (method === 'DELETE' && !broken) o.workflow_state = 'deleted';
      return json(200, o);
    }
    if (method === 'POST' && p === '/api/v1/planner_notes') {
      if (b.linked_object_type && mockPlanner.notes.some((n) => n.workflow_state !== 'deleted' && n.linked_object_type === b.linked_object_type && n.linked_object_id === String(b.linked_object_id))) return json(400, { errors: [{ message: 'mock: object already linked' }] });
      const n = { id: String(mockPlanner.nextId++), title: b.title || (b.linked_object_type ? titleOf(b.linked_object_type, b.linked_object_id) : ''), description: b.details || null, course_id: b.course_id || null,
        todo_date: localMidnight(b.todo_date), workflow_state: 'active', linked_object_type: b.linked_object_type || null, linked_object_id: b.linked_object_id ? String(b.linked_object_id) : null };
      if (broken) n.todo_date = localMidnight('2020-01-01');
      mockPlanner.notes.push(n);
      return json(200, n);
    }
    if ((m = p.match(/^\/api\/v1\/planner_notes\/(\w+)$/))) {
      const n = mockPlanner.notes.find((x) => x.id === m[1]);
      if (!n || n.workflow_state === 'deleted') return json(404, { errors: [{ message: 'not found' }] });
      if (method === 'PUT' && !broken) {
        if ('title' in b) n.title = b.title;
        if ('details' in b) n.description = b.details || null;
        if ('todo_date' in b) n.todo_date = localMidnight(b.todo_date);
        if ('course_id' in b) n.course_id = b.course_id || null;
      }
      if (method === 'DELETE' && !broken) n.workflow_state = 'deleted';
      return json(200, n);
    }
    return null;
  }
  function plannerRead(p) {
    let m;
    if (p === '/api/v1/planner/overrides') return mockPlanner.overrides.filter((o) => o.workflow_state !== 'deleted');
    if ((m = p.match(/^\/api\/v1\/planner\/overrides\/(\w+)$/))) {
      const o = mockPlanner.overrides.find((x) => x.id === m[1]);
      return o && o.workflow_state !== 'deleted' ? o : null;
    }
    if (p === '/api/v1/planner_notes') return mockPlanner.notes.filter((n) => n.workflow_state !== 'deleted');
    if ((m = p.match(/^\/api\/v1\/planner_notes\/(\w+)$/))) {
      const n = mockPlanner.notes.find((x) => x.id === m[1]);
      return n && n.workflow_state !== 'deleted' ? n : null;
    }
    return undefined;
  }

  const realFetch = window.fetch.bind(window);
  const delay = Number(params.get('latency') || 120);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.origin === 'https://mock-uploads.example') return storageServer(url, init);
    if (url.origin !== 'https://umd.instructure.com') return realFetch(input, init);
    // window.__mockLatency overrides ?latency (tests set 0: offscreen WebKit clamps timers to 1 s after a few seconds).
    const ms = window.__mockLatency ?? delay;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    // ?fail=auth, or set window.__mockFail = 'auth' later to simulate the session expiring mid-visit.
    if (params.get('fail') === 'auth' || window.__mockFail === 'auth') return new Response('{"status":"unauthenticated"}', { status: 401, headers: { 'Content-Type': 'application/json' } });
    const method = (init && init.method) || 'GET';
    if (method !== 'GET') {
      const body = init.body ? JSON.parse(init.body) : null;
      window.__mockWrites.push({ method, path: url.pathname, body, csrf: init.headers?.['X-CSRF-Token'] || null });
      return plannerWrite(method, url.pathname, body || {}) || submissionWrite(url.pathname, body) || uploadsApi(method, url.pathname, body || {}, url) || new Response(null, { status: 204 });
    }
    const up = uploadsApi('GET', url.pathname, null, url);
    if (up) return up;
    const pr = plannerRead(url.pathname);
    const body = pr !== undefined ? pr : route(url);
    if (body && body.__status) return new Response(JSON.stringify(body.body), { status: body.__status, headers: { 'Content-Type': 'application/json' } });
    if (body == null) return new Response('{"errors":[{"message":"not found"}]}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Rate-Limit-Remaining': '650.0' } });
  };
})();
