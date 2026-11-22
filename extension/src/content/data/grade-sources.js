// @ts-check
/**
 * Per-course grade analysis for the views: picks the right inputs
 * for the score Canvas reports, loads what's needed on demand, and runs the
 * pure engine in data/grades.js.
 *
 * Which Canvas score we compare against (`course.grade`, normalize.course):
 * - courses with an active grading period that has a score → that period's
 *   score. Its assignments come from Canvas itself (assignment_groups with
 *   grading_period_id + scope_assignments_to_student), resource
 *   `gradeperiod:<cid>:<periodId>`, so period membership is Canvas's own.
 * - otherwise → the whole-course score, from synced coursework.
 *
 * Letter scheme (`gradescheme:<cid>`): the course's grading standard when
 * Canvas lets the student read it; else Canvas's default scheme. Either way
 * it's checked against the letter Canvas shows for its own score, and marked
 * unverified when they disagree.
 */
(() => {
  const G = Gesso.grades;
  const PERIOD_TTL = 10 * 60_000;
  const SCHEME_TTL = 24 * 60 * 60_000;

  /** Normalized { groups, assignments } from raw assignment groups. */
  function normalizeGroups(/** @type {any[]} */ raw, /** @type {string} */ courseId) {
    return {
      groups: raw.map((g) => Gesso.normalize.assignmentGroup(g, courseId)),
      assignments: raw.flatMap((g) => (g.assignments || []).map((/** @type {any} */ a) => Gesso.normalize.assignment(a, courseId))),
    };
  }

  /**
   * The engine input for the score Canvas shows.
   * @returns {{ input: any|null, scope: 'period'|'course', loading: boolean, error: any, whole: any|null }}
   *   `whole`: whole-course input (synced), always available when coursework is.
   */
  function inputFor(/** @type {any} */ course, /** @type {any} */ data) {
    const cw = data.coursework?.[course.id];
    const whole = cw ? { groups: cw.groups, assignments: cw.assignments, applyWeights: course.applyWeights } : null;
    const { usePeriod, periodId } = course.grade;
    if (!usePeriod || !periodId) return { input: whole, inputKey: cw || null, scope: 'course', loading: !cw, error: null, whole };
    const res = Gesso.resources.ensure(`gradeperiod:${course.id}:${periodId}`,
      () => Gesso.api.canvas.getPeriodAssignmentGroups(course.id, periodId).then((raw) => normalizeGroups(raw, course.id)),
      { ttl: PERIOD_TTL });
    const input = res.data ? { ...res.data, applyWeights: course.applyWeights } : null;
    return { input, inputKey: res.data || null, scope: 'period', loading: !res.data && !res.error, error: res.data ? null : res.error, whole };
  }

  /**
   * The course's letter scheme.
   * @returns {{ scheme: readonly [string, number][], source: 'course'|'default', verified: boolean|null, loading: boolean }}
   *   verified: does the scheme give Canvas's letter for Canvas's score? (null = nothing to check against)
   */
  function schemeFor(/** @type {any} */ course) {
    let scheme = G.DEFAULT_SCHEME;
    let source = /** @type {'course'|'default'} */ ('default');
    let loading = false;
    if (course.gradingStandardId) {
      const res = Gesso.resources.ensure(`gradescheme:${course.id}`,
        () => Gesso.api.canvas.getGradingStandards(course.id).then((list) => {
          const hit = list.find((/** @type {any} */ s) => String(s.id) === String(course.gradingStandardId));
          return hit ? G.schemeFromStandard(hit) : null;
        }),
        { ttl: SCHEME_TTL });
      if (res.data) { scheme = res.data; source = 'course'; }
      loading = !res.data && !res.error && !res.syncedAt;
    }
    const { score, letter } = course.grade;
    const verified = score != null && letter ? G.letterFor(score, scheme) === letter : null;
    return { scheme, source, verified, loading };
  }

  /**
   * Everything the grade views show for one course.
   * @param {any} course @param {any} data
   * @param {{ now?: Date, whatIf?: Map<string, number>|null }} [opts]
   */
  function analyze(course, data, { now = new Date(), whatIf = null } = {}) {
    const src = inputFor(course, data);
    const scheme = schemeFor(course);
    // Memo (performance): the grade views re-render on every store
    // change, and computing + explaining every course took ~12 ms with large
    // data. Same inputs (by identity) within the same minute → same result.
    // What-if results are never cached.
    const key = [src.inputKey, src.whole && data.coursework?.[course.id], scheme.scheme, course, Math.floor(now.getTime() / 60_000)];
    if (!whatIf || !whatIf.size) {
      const hit = memo.get(course.id);
      if (hit && hit.key.every((/** @type {any} */ k, /** @type {number} */ i) => k === key[i])) return hit.value;
      const value = analyzeNow(course, src, scheme, { now, whatIf: null });
      memo.set(course.id, { key, value });
      return value;
    }
    return analyzeNow(course, src, scheme, { now, whatIf });
  }

  /** @type {Map<string, { key: any[], value: any }>} */
  const memo = new Map();

  function analyzeNow(/** @type {any} */ course, /** @type {any} */ src, /** @type {any} */ scheme, /** @type {{ now: Date, whatIf: Map<string, number>|null }} */ { now, whatIf }) {
    const canvas = {
      score: course.grade.score, letter: course.grade.letter,
      finalScore: course.grade.finalScore, finalLetter: course.grade.finalLetter,
    };
    if (!src.input) return { course, ...src, scheme, canvas, current: null, final: null, whatIf: null, check: null, finalCheck: null, letter: null };

    const current = G.compute(src.input, { mode: 'current' });
    const final = G.compute(src.input, { mode: 'final' });
    const what = whatIf && whatIf.size ? G.compute(src.input, { mode: 'current', whatIf }) : null;

    // Grading periods: the whole-course grade is a useful alternative explanation.
    const extra = [];
    if (src.scope === 'period' && src.whole) {
      const w = G.compute(src.whole, { mode: 'current' }).score;
      extra.push({ id: 'whole-course', rule: 'Grading period', score: w, detail: `Canvas's score matches the whole-course grade (${G.round(w)}%), not just ${course.grade.periodTitle || 'the current grading period'}.` });
    }
    const check = course.hideFinalGrades ? null : G.explain(src.input, canvas.score, { mode: 'current', now, extra });
    const finalCheck = course.hideFinalGrades ? null : G.explain(src.input, canvas.finalScore, { mode: 'final', now });

    // Letter: Canvas's own when it shows one; otherwise from the scheme (estimated).
    const letter = canvas.letter
      ? { value: canvas.letter, estimated: false }
      : (current.score != null || canvas.score != null)
        ? { value: G.letterFor(canvas.score ?? current.score, scheme.scheme), estimated: true }
        : null;

    return { course, ...src, scheme, canvas, current, final, whatIf: what, check, finalCheck, letter };
  }

  Gesso.gradeSources = { inputFor, schemeFor, analyze, normalizeGroups };
})();
