// @ts-check
/**
 * Grade engine.
 * Pure functions, no DOM.
 *
 * Accuracy is the point: the course grade is computed the way Canvas
 * documents its grade calculation, then compared with the score Canvas
 * reports to the student (`computed_current_score`). When they differ,
 * `explain()` re-runs the calculation with one rule changed at a time and
 * reports which change reproduces Canvas's number.
 *
 * Written from public sources only:
 * - Canvas guides, community.instructure.com/en/kb/articles/<id>:
 *   660670 assignment group rules (drops), 660669 weighting, 660681 extra
 *   credit, 660848 excused, 660677 excluded from the final grade, 660843
 *   posting policies, 662757 and 661305 current vs. total grade, 661122 the
 *   default grading scheme.
 * - Canvas REST API docs: Submissions, Enrollments, Assignment Groups,
 *   Grading Standards.
 * - D. M. Kane and J. M. Kane, "Dropping Lowest Grades", Mathematics
 *   Magazine 79(3), 2006 (the drop-rule method).
 *
 * The rules in short:
 * - Only gradeable work counts: not "not graded" assignments, not ones
 *   excluded from the final grade, and only grades posted to the student.
 * - Current grade: work without a visible grade is left out, and so is a
 *   quiz still pending review. Total ("final") grade: work without a visible
 *   grade counts as 0.
 * - Excused work is left out of everything, drop rules included.
 * - Drop rules keep the scores that give the best (drop lowest) or worst
 *   (drop highest) group percentage, judged on points rather than on each
 *   item's percentage. At least one droppable score always stays.
 * - Weighted courses: Σ group percentage × weight over the groups that have
 *   points possible, divided by their combined weight when that is under
 *   100% (never scaled down: weights over 100% are extra credit).
 * - Points courses: total earned ÷ total possible.
 * - The course score is rounded half up to 2 decimals. The arithmetic is
 *   exact decimal arithmetic, so float error can't push a score across a
 *   rounding boundary.
 */
(() => {
  const { toDate, HOUR } = Gesso.time;

  // ---------------------------------------------------------------------------
  // Exact decimals
  // ---------------------------------------------------------------------------
  // Scores, points and weights are decimals. Doing the course math on exact
  // fractions (BigInt numerator and denominator) keeps 81.445 as 81.445, so
  // it rounds to 81.45, where binary floats can land on 81.44499999999999.

  /** @typedef {{ n: bigint, d: bigint }} Frac  numerator / denominator, d > 0 */

  const ZERO = /** @type {Frac} */ ({ n: 0n, d: 1n });
  const HUNDRED = /** @type {Frac} */ ({ n: 100n, d: 1n });
  const pow10 = (/** @type {number} */ k) => 10n ** BigInt(k);
  const gcd = (/** @type {bigint} */ a, /** @type {bigint} */ b) => {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y) [x, y] = [y, x % y];
    return x;
  };

  /**
   * The exact decimal a JS number stands for: 0.1 → 1/10, and float noise is
   * removed first (10 decimals), so 1.6099999999999999 → 161/100. The
   * denominator is a power of ten. Non-finite numbers count as 0 (they never
   * reach the engine).
   */
  function exact(/** @type {number} */ x) {
    const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/.exec(String(clean(x)));
    if (!m) return ZERO;
    const decimals = m[3] || '';
    const digits = BigInt(m[2] + decimals);
    const exp = Number(m[4] || 0) - decimals.length;
    const n = m[1] ? -digits : digits;
    return exp >= 0 ? { n: n * pow10(exp), d: 1n } : { n, d: pow10(-exp) };
  }

  /** a/b in lowest terms with a positive denominator. */
  function fraction(/** @type {bigint} */ n, /** @type {bigint} */ d) {
    const g = gcd(n, d) || 1n;
    return d < 0n ? { n: -n / g, d: -d / g } : { n: n / g, d: d / g };
  }
  const plus = (/** @type {Frac} */ a, /** @type {Frac} */ b) => {
    if (a.d === b.d) return { n: a.n + b.n, d: a.d };
    const g = gcd(a.d, b.d);
    return fraction(a.n * (b.d / g) + b.n * (a.d / g), (a.d / g) * b.d);
  };
  const times = (/** @type {Frac} */ a, /** @type {Frac} */ b) => fraction(a.n * b.n, a.d * b.d);
  const over = (/** @type {Frac} */ a, /** @type {Frac} */ b) => fraction(a.n * b.d, a.d * b.n); // b ≠ 0
  const total = (/** @type {Frac[]} */ xs) => xs.reduce(plus, ZERO);
  const positive = (/** @type {Frac} */ a) => a.n > 0n;
  const below = (/** @type {Frac} */ a, /** @type {Frac} */ b) => a.n * b.d < b.n * a.d;

  /** Rounded to `digits` decimals, halves away from zero, as text ("81.45"). */
  function fixed(/** @type {Frac} */ a, /** @type {number} */ digits) {
    const neg = a.n < 0n;
    const scaled = (neg ? -a.n : a.n) * pow10(digits);
    let q = scaled / a.d;
    if ((scaled % a.d) * 2n >= a.d) q += 1n;
    const s = q.toString().padStart(digits + 1, '0');
    const text = digits ? `${s.slice(0, -digits)}.${s.slice(-digits)}` : s;
    return neg && q !== 0n ? `-${text}` : text;
  }

  /** The float the views get (15 decimals is far below anything shown). */
  const toNumber = (/** @type {Frac} */ a) => Number(fixed(a, 15));

  // ---------------------------------------------------------------------------
  // Number helpers (exported)
  // ---------------------------------------------------------------------------

  /** Remove binary float noise from a computed number (0.1 + 0.2 → 0.3). */
  const clean = (/** @type {number} */ x) => (Number.isFinite(x) ? Number(x.toFixed(10)) : x);

  /**
   * Round half up (halves away from zero) to `digits` decimals. The number is
   * cleaned first, so a float that prints as 93.82499999999999 because of
   * binary noise rounds as 93.825 → 93.83. null stays null.
   */
  function round(/** @type {number|null|undefined} */ x, digits = 2) {
    if (x == null || !Number.isFinite(x)) return null;
    return Number(fixed(exact(x), digits)); // exact() cleans first
  }

  /**
   * Same displayed score? Canvas reports 2 decimals, so our unrounded score
   * matches when it is within half a hundredth of Canvas's number. Either
   * rounding direction at an exact half is accepted, plus float slack.
   */
  function sameScore(/** @type {number|null} */ a, /** @type {number|null} */ b) {
    if (a == null || b == null) return a == null && b == null;
    return Math.abs(a - b) <= 0.005 + 1e-6;
  }

  // ---------------------------------------------------------------------------
  // Drop rules
  // ---------------------------------------------------------------------------

  /**
   * @typedef {{ aid: string, score: number, total: number }} DropEntry
   * @typedef {{ dropLowest?: number, dropHighest?: number, neverDrop?: string[] }} DropRules
   */

  /** Assignment ids in numeric order (Canvas ids are digit strings; anything else compares as text). */
  function compareIds(/** @type {string} */ x, /** @type {string} */ y) {
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
      const a = x.replace(/^0+(?=\d)/, '');
      const b = y.replace(/^0+(?=\d)/, '');
      return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
    }
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const byAid = (/** @type {DropEntry} */ a, /** @type {DropEntry} */ b) => compareIds(a.aid, b.aid);
  const count = (/** @type {number|undefined} */ n) => Math.max(0, Math.floor(Number(n) || 0));

  /**
   * The entries that stay after a group's drop rules (input order).
   *
   * Canvas's guide (660670): drop lowest removes the scores whose removal
   * gives "the best possible score for that group", drop highest the ones
   * that give "the lowest possible score for that group", and the choice is
   * "based on the impact to the total points", so it isn't always the lowest
   * percentage. Never-drop assignments stay, but they're part of the group
   * percentage, so they still affect which others are dropped. A group needs
   * "at least one score, plus the number of dropped scores and the number of
   * assignments that should not be dropped" for every drop to happen, and
   * one droppable score always stays. With both rules, the lowest are dropped
   * first, then the highest of what's left (the guide: "calculates a
   * student's grade based upon the remaining middle scores").
   *
   * The guide doesn't say what happens with fewer scores than that. Observed
   * behavior (outputs of an earlier engine that matched
   * Canvas on every live course, compared as a black box): drop lowest drops
   * as many as it can while one stays; drop highest drops its full count or
   * nothing.
   * @param {DropEntry[]} entries
   * @param {DropRules} rules
   * @returns {DropEntry[]}
   */
  function dropAssignments(entries, rules = {}) {
    const wantLow = count(rules.dropLowest);
    const wantHigh = count(rules.dropHighest);
    if (!wantLow && !wantHigh) return [...entries];
    const never = new Set((rules.neverDrop || []).map(String));
    const pinned = entries.filter((e) => never.has(String(e.aid)));
    let free = entries.filter((e) => !never.has(String(e.aid)));
    const low = Math.min(wantLow, Math.max(0, free.length - 1));
    if (low) free = keepBest(free, pinned, free.length - low, 1);
    if (wantHigh && free.length - wantHigh >= 1) free = keepBest(free, pinned, free.length - wantHigh, -1);
    const kept = new Set([...free, ...pinned]);
    return entries.filter((e) => kept.has(e));
  }

  /**
   * Keep `keep` of the droppable entries so that the group percentage (the
   * never-drop entries included) is as high as possible (dir 1) or as low as
   * possible (dir −1). Minimizing is maximizing with every score negated.
   *
   * Method (Kane & Kane): for a candidate percentage q, the best set is the
   * `keep` entries with the largest score − q·points, and the best
   * percentage is the q where that set's Σ(score − q·points) is 0. Their
   * faster algorithm is Newton's method on that function: take any set's
   * percentage as q, pick the best set for q, take its percentage, and stop
   * when the best set for q adds nothing (Σ = 0). Each step raises q, so it
   * ends after a few steps. Everything is in integers (all values scaled to
   * a common power of ten), so there is no rounding error.
   *
   * Special cases (the paper assumes every item has points):
   * - No entry has points (e.g. an extra-credit group): the group's value is
   *   its raw score total, and, as the paper notes for raw scores, the best
   *   set is simply the largest scores.
   * - A selection with no points possible counts as an unboundedly high
   *   percentage (unless its total is negative): drop lowest keeps it when it
   *   can, drop highest never does. That holds even for 0 out of 0. Observed
   *   behavior; the docs are silent.
   * Ties, where two choices give exactly the same group percentage (the
   * paper: both are equally good, and its bisection lands on one of them).
   * The docs are silent; these rules reproduce where the paper's bisection
   * lands, as observed:
   * - every entry has the same percentage (e.g. all perfect scores): the
   *   higher assignment id is dropped;
   * - the best percentage is the highest single percentage (drop lowest; for
   *   drop highest, the lowest): the entry with more points possible stays,
   *   e.g. 20/20 over 10/10 when a 5/10 is dropped too;
   * - otherwise, drop lowest keeps the entry with fewer points possible and
   *   drop highest the one with more;
   * - then the lower id stays.
   * Without points, scores line up from lowest to highest (equal scores by
   * id); drop lowest takes from the start, drop highest from the end.
   */
  function keepBest(/** @type {DropEntry[]} */ free, /** @type {DropEntry[]} */ pinned, /** @type {number} */ keep, /** @type {1|-1} */ dir) {
    const parts = [...free, ...pinned].map((e) => ({ e, s: exact(e.score), t: exact(e.total || 0) }));
    const scale = parts.reduce((d, p) => [d, p.s.d, p.t.d].reduce((x, y) => (y > x ? y : x)), 1n);
    const toInt = (/** @type {Frac} */ f) => f.n * (scale / f.d); // both powers of ten: exact
    const items = parts.map((p) => ({ e: p.e, m: BigInt(dir) * toInt(p.s), n: toInt(p.t) }));
    /** @typedef {typeof items[number]} Item */
    const F = items.slice(0, free.length);
    const C = items.slice(free.length);
    const sumM = (/** @type {Item[]} */ xs) => xs.reduce((a, x) => a + x.m, 0n);
    const sumN = (/** @type {Item[]} */ xs) => xs.reduce((a, x) => a + x.n, 0n);
    // The paper's search range is [lowest, highest] item percentage. Same
    // percentage everywhere (the range is a single point)?
    const pointed = items.filter((x) => x.n > 0n);
    const onePercentage = pointed.length === items.length && pointed.every((x) => x.m * pointed[0].n === pointed[0].m * x.n);
    const highest = pointed.reduce((a, x) => (a && a.m * x.n >= x.m * a.n ? a : x), /** @type {Item|null} */ (null));
    /**
     * The `keep` items with the largest key. Ties: see above. The tie rule is
     * where the paper's bisection ends up: at the top of its range it can
     * only come from below (more points possible wins); inside the range it
     * finishes just above the optimum (for drop lowest the entry with fewer
     * points possible wins, for drop highest the one with more).
     * @param {Item[]} xs @param {bigint} A @param {bigint} B  the percentage q = A/B behind the key
     */
    const topAt = (xs, A, B) => {
      const atTop = !!highest && A * highest.n === highest.m * B;
      const morePoints = atTop || dir === -1;
      return xs
        .map((x) => ({ x, k: x.m * B - A * x.n }))
        .sort((a, b) => {
          if (a.k !== b.k) return a.k > b.k ? -1 : 1;
          if (!onePercentage && a.x.n !== b.x.n) return (a.x.n > b.x.n) === morePoints ? -1 : 1;
          return byAid(a.x.e, b.x.e);
        })
        .slice(0, keep)
        .map((y) => y.x);
    };
    /** The `keep` items with the largest key (no percentage involved); ties keep the lower id. */
    const top = (/** @type {Item[]} */ xs, /** @type {(x: Item) => bigint} */ key) => xs
      .map((x) => ({ x, k: key(x) }))
      .sort((a, b) => (a.k !== b.k ? (a.k > b.k ? -1 : 1) : byAid(a.x.e, b.x.e)))
      .slice(0, keep)
      .map((y) => y.x);
    const entriesOf = (/** @type {Item[]} */ xs) => xs.map((x) => x.e);

    const cm = sumM(C);
    const cn = sumN(C);
    if (cn === 0n && !F.some((x) => x.n > 0n)) {
      // Lowest to highest real score, equal scores by id; keep the end the rule doesn't drop.
      const line = [...F].sort((a, b) => {
        const d = BigInt(dir) * (a.m - b.m);
        return d < 0n ? -1 : d > 0n ? 1 : byAid(a.e, b.e);
      });
      return entriesOf(dir === 1 ? line.slice(line.length - keep) : line.slice(0, keep));
    }
    if (cn === 0n) {
      const zeros = F.filter((x) => x.n === 0n);
      if (zeros.length >= keep) {
        const best = top(zeros, (x) => x.m);
        const sum = cm + sumM(best); // dir·(real total)
        if (dir === 1 ? sum >= 0n : sum > 0n) return entriesOf(best);
      }
    }
    // Start from the set with the most points possible (its percentage is defined).
    let cur = top(F, (x) => x.n);
    for (let step = 0; step < 100; step++) {
      const A = cm + sumM(cur);
      const B = cn + sumN(cur); // q = A / B, B > 0
      const next = topAt(F, A, B);
      const nm = cm + sumM(next);
      const nn = cn + sumN(next);
      // Σ(score − q·points) over the best set for q, times B: 0 means q is the best percentage.
      if (nm * B - A * nn <= 0n) return entriesOf(nn > 0n ? next : cur);
      cur = next;
    }
    return entriesOf(cur);
  }

  /**
   * A naive alternative (for diagnosis only): drop the lowest / highest
   * percentages one by one. Canvas does *not* do this.
   */
  function dropNaive(/** @type {DropEntry[]} */ entries, /** @type {DropRules} */ rules = {}) {
    const never = new Set(rules.neverDrop || []);
    const cantDrop = entries.filter((e) => never.has(e.aid));
    const pct = (/** @type {DropEntry} */ e) => (e.total ? e.score / e.total : Infinity);
    let droppable = entries.filter((e) => !never.has(e.aid)).sort((a, b) => pct(a) - pct(b) || byAid(a, b));
    const low = Math.min(rules.dropLowest || 0, Math.max(0, droppable.length - 1));
    droppable = droppable.slice(low);
    const high = low + (rules.dropHighest || 0) >= entries.length - cantDrop.length ? 0 : (rules.dropHighest || 0);
    droppable = droppable.slice(0, droppable.length - high);
    return [...droppable, ...cantDrop];
  }

  // ---------------------------------------------------------------------------
  // Course grade
  // ---------------------------------------------------------------------------

  /**
   * Input: one course's synced coursework (normalize.assignmentGroup /
   * normalize.assignment shapes).
   * @typedef {{ groups: any[], assignments: any[], applyWeights: boolean }} GradeInput
   *
   * Rule switches. The defaults are Canvas's documented behavior; `explain()`
   * flips them one at a time.
   * @typedef {Object} Rules
   * @property {'canvas'|'none'|'naive'} drops
   * @property {boolean} countPending     count pending-review quiz scores in the current grade
   * @property {boolean} countUnposted    count scores without posted_at
   * @property {boolean} countOmitted     count "omit from final grade" assignments
   * @property {boolean} excusedAsZero
   * @property {'percent'|'points'|null} weighting   null = the course's setting
   * @property {boolean} rescale          scale weights that add up to < 100
   * @property {Set<string>|null} excludeIds  leave these assignments' grades out (e.g. "Canvas hasn't recalculated")
   */
  /** @type {Rules} */
  const CANVAS_RULES = Object.freeze({
    drops: 'canvas',
    countPending: false,
    countUnposted: false,
    countOmitted: false,
    excusedAsZero: false,
    weighting: null,
    rescale: true,
    excludeIds: null,
  });

  /** "Not graded" assignments are never part of a grade. */
  const isNotGraded = (/** @type {any} */ a) =>
    a.gradingType === 'not_graded' || (a.submissionTypes?.length > 0 && a.submissionTypes.every((/** @type {string} */ t) => t === 'not_graded'));

  /** When the student could first see a grade (for trends and "recent"). */
  function gradeTime(/** @type {any} */ a) {
    const s = a.submission;
    return toDate(s?.postedAt) || toDate(s?.gradedAt) || toDate(s?.submittedAt) || toDate(a.dueAt);
  }

  /**
   * How one assignment takes part in a calculation.
   * - Never: "not graded" assignments; ones excluded from the final grade
   *   (guide 660677).
   * - A what-if score always counts (a hypothetical the student typed).
   * - Excused: left out ("Excused assignments have no impact on a user's
   *   grade", Submissions API; guide 660848).
   * - No visible grade (no score, or a score not yet posted to the student,
   *   guide 660843): left out of the current grade, 0 in the total grade
   *   (guides 662757, 661305).
   * - Pending review (a quiz partly graded): left out of the current grade
   *   until fully graded; the total grade counts the score so far.
   * @param {any} a  normalized assignment
   * @param {'current'|'final'} mode
   * @param {Rules} rules
   * @param {Map<string, number>|null} whatIf
   * @returns {{ counted: boolean, score: number|null, reason: string }}
   *   reason: graded | whatif | ungraded | pending | unposted | excused | omitted | not_graded | recent | zeroed (final: no visible grade → 0)
   */
  function classify(a, mode, rules, whatIf) {
    const says = (/** @type {boolean} */ counted, /** @type {number|null} */ score, /** @type {string} */ reason) => ({ counted, score, reason });
    if (isNotGraded(a)) return says(false, null, 'not_graded');
    if (a.omitFromFinal && !rules.countOmitted) return says(false, null, 'omitted');
    if (whatIf && whatIf.has(a.id)) return says(true, /** @type {number} */ (whatIf.get(a.id)), 'whatif');
    if (rules.excludeIds && rules.excludeIds.has(a.id)) return says(false, null, 'recent');
    const s = a.submission || {};
    if (s.excused) return rules.excusedAsZero ? says(true, 0, 'excused') : says(false, null, 'excused');
    const final = mode === 'final';
    const invisible = (/** @type {string} */ reason) => (final ? says(true, 0, 'zeroed') : says(false, null, reason));
    if (s.score == null) return invisible('ungraded');
    // The posted rule only applies when Canvas sent posted_at at all.
    if (!s.postedAt && s.postedKnown !== false && !rules.countUnposted) return invisible('unposted');
    if (s.state === 'pending_review' && !final && !rules.countPending) return says(false, null, 'pending');
    return says(true, s.score, 'graded');
  }

  /**
   * @typedef {Object} GroupResult
   * @property {string} id
   * @property {string} name
   * @property {number} weight
   * @property {DropRules} rules
   * @property {number} score       points kept
   * @property {number} possible    points possible kept
   * @property {number|null} pct
   * @property {boolean} counted    part of the total (weighted: has points possible)
   * @property {number|null} contribution  percentage points of the course score
   * @property {{ id: string, name: string, points: number|null, score: number|null, counted: boolean, dropped: boolean, reason: string }[]} items
   */

  /**
   * Compute a course grade.
   *
   * Weighted (guide 660669): each group's percentage is its points earned ÷
   * points possible; the course score is Σ percentage × weight. Groups with
   * nothing graded are "removed from the equation" and the rest "divided by
   * their combined weight". Weights may total over 100% for extra credit
   * (guides 660669, 660681), so the division only ever scales up. A group with
   * no points possible isn't calculated (660681). Points: Σ earned ÷ Σ possible.
   * @param {GradeInput} input
   * @param {{ mode?: 'current'|'final', whatIf?: Map<string, number>|null, rules?: Partial<Rules> }} [opts]
   * @returns {{ score: number|null, rounded: number|null, weighted: boolean, fullWeight: number, scaled: boolean,
   *   earned: number, possible: number, groups: GroupResult[], dropped: string[] }}
   */
  function compute(input, { mode = 'current', whatIf = null, rules: changes = {} } = {}) {
    /** @type {Rules} */
    const rules = { ...CANVAS_RULES, ...changes };
    const weighted = rules.weighting ? rules.weighting === 'percent' : !!input.applyWeights;

    /** @type {Map<string, any[]>} */
    const byGroup = new Map();
    for (const a of input.assignments) {
      const key = String(a.groupId);
      const list = byGroup.get(key);
      if (list) list.push(a); else byGroup.set(key, [a]);
    }
    const groups = input.groups
      .map((g, i) => ({ g, i }))
      .sort((x, y) => (Number(x.g.position) || 0) - (Number(y.g.position) || 0) || x.i - y.i)
      .map((x) => x.g);

    /** @type {string[]} */
    const dropped = [];
    const tallies = groups.map((g) => {
      const looks = (byGroup.get(String(g.id)) || []).map((a) => ({ a, c: classify(a, mode, rules, whatIf) }));
      /** @type {DropEntry[]} */
      const entries = looks.filter((x) => x.c.counted)
        .map((x) => ({ aid: String(x.a.id), score: /** @type {number} */ (x.c.score), total: Number(x.a.points) || 0 }));
      const groupRules = g.rules || {};
      const kept = rules.drops === 'none' ? entries
        : rules.drops === 'naive' ? dropNaive(entries, groupRules)
          : dropAssignments(entries, groupRules);
      const keptIds = new Set(kept.map((e) => e.aid));
      const items = looks.map(({ a, c }) => {
        const isDropped = c.counted && !keptIds.has(String(a.id));
        if (isDropped) dropped.push(String(a.id));
        return { id: String(a.id), name: a.name, points: a.points ?? null, score: c.counted ? c.score : null, counted: c.counted, dropped: isDropped, reason: c.reason };
      });
      return {
        g, items,
        earned: total(kept.map((e) => exact(e.score))),
        possible: total(kept.map((e) => exact(e.total))),
        weight: exact(Number(g.weight) || 0),
      };
    });

    /** @type {Frac|null} */
    let score = null;
    let scaled = false;
    let fullWeight = 0;
    /** @type {Map<object, Frac>} */
    const share = new Map(); // tally → percentage points of the course score
    const earnedAll = total(tallies.map((t) => t.earned));
    const possibleAll = total(tallies.map((t) => t.possible));

    if (weighted) {
      const live = tallies.filter((t) => positive(t.possible));
      const weightSum = total(live.map((t) => t.weight));
      fullWeight = toNumber(weightSum);
      if (live.length && positive(weightSum)) {
        scaled = rules.rescale && below(weightSum, HUNDRED);
        const divisor = scaled ? weightSum : HUNDRED;
        for (const t of live) share.set(t, over(times(times(over(t.earned, t.possible), t.weight), HUNDRED), divisor));
        score = total([...share.values()]);
      } else {
        for (const t of live) share.set(t, ZERO); // no weight: these groups add nothing
      }
    } else if (positive(possibleAll)) {
      for (const t of tallies) share.set(t, over(times(t.earned, HUNDRED), possibleAll));
      score = over(times(earnedAll, HUNDRED), possibleAll);
    }

    /** @type {GroupResult[]} */
    const out = tallies.map((t) => {
      const c = share.get(t);
      return {
        id: String(t.g.id),
        name: t.g.name,
        weight: Number(t.g.weight) || 0,
        rules: t.g.rules || { dropLowest: 0, dropHighest: 0, neverDrop: [] },
        score: toNumber(t.earned),
        possible: toNumber(t.possible),
        pct: positive(t.possible) ? toNumber(over(times(t.earned, HUNDRED), t.possible)) : null,
        counted: weighted ? positive(t.possible) : true, // points: every group is part of the total
        contribution: c ? toNumber(c) : null,
        items: t.items,
      };
    });

    return {
      score: score ? toNumber(score) : null,
      rounded: score ? Number(fixed(score, 2)) : null,
      weighted,
      fullWeight,
      scaled,
      earned: toNumber(earnedAll),
      possible: toNumber(possibleAll),
      groups: out,
      dropped,
    };
  }

  /**
   * @typedef {{ id: string, rule: string, detail: string, score: number|null }} Cause
   * @typedef {{ status: 'match'|'mismatch'|'no_canvas'|'no_grades', ours: number|null, canvas: number|null, diff: number|null,
   *   causes: Cause[], combined: boolean, checked: string[] }} Explanation
   */

  const plural = (/** @type {number} */ n, /** @type {string} */ word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const names = (/** @type {any[]} */ list, max = 3) => {
    const shown = list.slice(0, max).map((a) => `“${a.name}”`).join(', ');
    return list.length > max ? `${shown} and ${list.length - max} more` : shown;
  };

  /**
   * Candidate rule changes for this course, each with a plain-language
   * reason. Only candidates that could change the number are returned.
   * @param {GradeInput} input
   * @param {'current'|'final'} mode
   * @param {ReturnType<typeof compute>} base
   * @param {Date} now
   */
  function candidates(input, mode, base, now) {
    const A = input.assignments;
    const sub = (/** @type {any} */ a) => a.submission || {};
    /** @type {{ id: string, rules?: Partial<Rules>, mode?: 'current'|'final', rule: string, detail: string }[]} */
    const out = [];

    const droppingGroups = base.groups.filter((g) => g.items.some((i) => i.dropped));
    if (droppingGroups.length) {
      const desc = droppingGroups.map((g) => `${g.name} (${[g.rules.dropLowest && `drop lowest ${g.rules.dropLowest}`, g.rules.dropHighest && `drop highest ${g.rules.dropHighest}`].filter(Boolean).join(', ')})`).join('; ');
      out.push({
        id: 'no-drops', rules: { drops: 'none' }, rule: 'Drop rules',
        detail: `Canvas's score matches the grade with no scores dropped, but ${desc} should drop ${plural(base.dropped.length, 'score')}. Canvas may not have recalculated since the rule was added or changed.`,
      });
      out.push({
        id: 'naive-drops', rules: { drops: 'naive' }, rule: 'Drop rules',
        detail: `Canvas's score matches dropping the lowest percentages one by one in ${droppingGroups.map((g) => g.name).join(', ')}, not the best-grade method Canvas documents. Compare which items Canvas marks as dropped on its Grades page.`,
      });
    }
    const pending = A.filter((a) => sub(a).state === 'pending_review' && sub(a).score != null && !a.omitFromFinal);
    if (mode === 'current' && pending.length) {
      out.push({
        id: 'pending', rules: { countPending: true }, rule: 'Pending review',
        detail: `Canvas's score matches counting the partial score of ${names(pending)}, which ${pending.length === 1 ? 'is' : 'are'} still pending review. Canvas normally leaves pending quizzes out of the current grade until they're fully graded.`,
      });
    }
    const unposted = A.filter((a) => sub(a).score != null && sub(a).postedKnown !== false && !sub(a).postedAt);
    if (unposted.length) {
      out.push({
        id: 'unposted', rules: { countUnposted: true }, rule: 'Posted grades',
        detail: `Canvas's score matches counting ${names(unposted)}, whose grade${unposted.length === 1 ? ' has' : 's have'} no "posted" date. Gesso only counts posted grades, as Canvas does for students.`,
      });
    }
    const omitted = A.filter((a) => a.omitFromFinal && sub(a).score != null);
    if (omitted.length) {
      out.push({
        id: 'omitted', rules: { countOmitted: true }, rule: 'Not counted toward the final grade',
        detail: `Canvas's score matches counting ${names(omitted)}, which ${omitted.length === 1 ? 'is' : 'are'} set to not count toward the final grade. The setting may have changed after Canvas last recalculated.`,
      });
    }
    const excused = A.filter((a) => sub(a).excused && !a.omitFromFinal && !isNotGraded(a));
    if (excused.length) {
      out.push({
        id: 'excused', rules: { excusedAsZero: true }, rule: 'Excused work',
        detail: `Canvas's score matches counting ${names(excused)} as 0 instead of excused. The excusal may be newer than Canvas's last recalculation.`,
      });
    }
    if (mode === 'current' && base.groups.some((g) => g.items.some((i) => i.reason === 'ungraded' || i.reason === 'unposted'))) {
      out.push({
        id: 'ungraded-zero', mode: 'final', rule: 'Ungraded work',
        detail: "Canvas's score matches counting work without a grade as 0. That usually means grades you can't see yet (for example, automatic zeros from a missing-submission policy that haven't been posted).",
      });
    }
    if (input.groups.length) {
      const other = base.weighted ? 'points' : 'percent';
      out.push({
        id: 'weighting', rules: { weighting: other }, rule: 'Group weighting',
        detail: base.weighted
          ? "Canvas's score matches a total-points calculation, but the course is set to weight assignment groups. The setting may have changed after Canvas last recalculated."
          : "Canvas's score matches weighting the assignment groups, but the course is set to total points. The setting may have changed after Canvas last recalculated.",
      });
    }
    if (base.weighted && base.scaled) {
      out.push({
        id: 'no-rescale', rules: { rescale: false }, rule: 'Group weights',
        detail: `Canvas's score matches leaving the counted weights at ${base.fullWeight}% instead of scaling them up to 100%.`,
      });
    }
    // Grades that showed up recently: Canvas recalculates scores in the background.
    const recent = A
      .filter((a) => sub(a).score != null && sub(a).postedAt)
      .map((a) => ({ a, t: /** @type {Date} */ (gradeTime(a)) }))
      .filter(({ t }) => t && now.getTime() - t.getTime() < 48 * HOUR && now.getTime() >= t.getTime())
      .sort((x, y) => y.t.getTime() - x.t.getTime());
    for (let k = 1; k <= Math.min(3, recent.length); k++) {
      const list = recent.slice(0, k).map((x) => x.a);
      out.push({
        id: `recent-${k}`, rules: { excludeIds: new Set(list.map((a) => a.id)) }, rule: 'Recently posted grades',
        detail: `Canvas's score matches leaving out the ${k === 1 ? 'most recent grade' : `${k} most recent grades`} (${names(list)}). Canvas recalculates in the background and may not have caught up yet. Refresh in a few minutes.`,
      });
    }
    return out;
  }

  /**
   * Compare our computed score with Canvas's and explain any difference.
   * @param {GradeInput} input
   * @param {number|null} canvasScore
   * @param {{ mode?: 'current'|'final', now?: Date, extra?: { id: string, rule: string, detail: string, score: number|null }[] }} [opts]
   *   `extra`: caller-computed alternatives (e.g. whole course vs. grading period).
   * @returns {Explanation}
   */
  function explain(input, canvasScore, { mode = 'current', now = new Date(), extra = [] } = {}) {
    const base = compute(input, { mode });
    const ours = base.score;
    const result = (/** @type {Explanation['status']} */ status, /** @type {Cause[]} */ causes = [], combined = false, checked = /** @type {string[]} */ ([])) =>
      ({ status, ours, canvas: canvasScore, diff: ours != null && canvasScore != null ? clean(ours - canvasScore) : null, causes, combined, checked });
    if (canvasScore == null) return result(ours == null ? 'no_grades' : 'no_canvas');
    if (sameScore(ours, canvasScore)) return result('match');

    const cands = candidates(input, mode, base, now);
    const run = (/** @type {any[]} */ list) => {
      const merged = list.reduce((acc, c) => ({ ...acc, ...(c.rules || {}) }), {});
      const m = list.find((c) => c.mode)?.mode || mode;
      return compute(input, { mode: m, rules: merged }).score;
    };
    const checked = [...new Set([...cands.map((c) => c.rule), ...extra.map((e) => e.rule)])];
    /** @type {Cause[]} */
    const singles = [
      ...cands.map((c) => ({ id: c.id, rule: c.rule, detail: c.detail, score: run([c]) })),
      ...extra,
    ].filter((c) => sameScore(c.score, canvasScore));
    // Prefer the first match per id family (e.g. recent-1 over recent-2).
    const seen = new Set();
    const uniq = singles.filter((c) => { const fam = c.id.replace(/-\d+$/, ''); if (seen.has(fam)) return false; seen.add(fam); return true; });
    if (uniq.length) return result('mismatch', uniq, false, checked);

    // No single rule: try pairs (cheap — a handful of candidates).
    /** @type {Cause[]} */
    const pairs = [];
    for (let i = 0; i < cands.length && pairs.length < 3; i++) {
      for (let j = i + 1; j < cands.length && pairs.length < 3; j++) {
        const a = cands[i];
        const b = cands[j];
        if (a.id.split('-')[0] === b.id.split('-')[0] || (a.rules?.drops && b.rules?.drops) || (a.mode && b.mode)) continue;
        const s = run([a, b]);
        if (sameScore(s, canvasScore)) pairs.push({ id: `${a.id}+${b.id}`, rule: `${a.rule} + ${b.rule}`, detail: `${a.detail} ${b.detail}`, score: s });
      }
    }
    return result('mismatch', pairs, pairs.length > 0, checked);
  }

  // ---------------------------------------------------------------------------
  // Trend, needed score
  // ---------------------------------------------------------------------------

  /**
   * The current grade over time: recomputed after each grade became visible
   * (posted date, else graded / submitted / due date).
   * @returns {{ t: Date, score: number, added: string[] }[]}
   */
  function trend(/** @type {GradeInput} */ input) {
    const graded = input.assignments
      .filter((a) => classify(a, 'current', CANVAS_RULES, null).counted)
      .map((a) => ({ a, t: gradeTime(a) }))
      .filter((x) => x.t)
      .sort((x, y) => /** @type {Date} */ (x.t).getTime() - /** @type {Date} */ (y.t).getTime());
    /** @type {{ t: Date, score: number, added: string[] }[]} */
    const points = [];
    for (let i = 0; i < graded.length; i++) {
      const t = /** @type {Date} */ (graded[i].t);
      // Grades visible at the same moment form one point.
      if (i + 1 < graded.length && /** @type {Date} */ (graded[i + 1].t).getTime() === t.getTime()) continue;
      const later = new Set(graded.slice(i + 1).map((x) => x.a.id));
      const score = compute(input, { mode: 'current', rules: { excludeIds: later } }).score;
      const added = graded.filter((x) => /** @type {Date} */ (x.t).getTime() === t.getTime()).map((x) => x.a.name);
      if (score != null) points.push({ t, score, added });
    }
    return points;
  }

  /** Work that still has no grade and could change the score. */
  function remainingWork(/** @type {GradeInput} */ input, /** @type {Map<string, number>|null} */ whatIf = null) {
    return input.assignments.filter((a) => {
      if (whatIf?.has(a.id) || !(a.points > 0)) return false;
      return classify(a, 'current', CANVAS_RULES, null).reason === 'ungraded';
    });
  }

  /**
   * What's needed to reach `target` (a percentage):
   * - one assignment: the score on it, everything else as it stands;
   * - all remaining work: one percentage earned on every ungraded item.
   * Drop rules and weights apply, so the answer matches Canvas's math.
   * @param {GradeInput} input
   * @param {number} target
   * @param {{ assignmentId?: string|null, whatIf?: Map<string, number>|null }} [opts]
   * @returns {{ status: 'none'|'guaranteed'|'reachable'|'beyond'|'unreachable', pct: number|null, points: number|null, best: number|null, items: any[] }}
   */
  function needed(input, target, { assignmentId = null, whatIf = null } = {}) {
    const items = assignmentId
      ? input.assignments.filter((a) => a.id === assignmentId)
      : remainingWork(input, whatIf);
    if (!items.length) return { status: 'none', pct: null, points: null, best: null, items };
    const f = (/** @type {number} */ p) => {
      const m = new Map(whatIf || []);
      for (const a of items) m.set(a.id, p * (a.points ?? 0));
      return compute(input, { mode: 'current', whatIf: m }).score;
    };
    // Canvas compares the 2-decimal score with the cutoff.
    const reaches = (/** @type {number} */ p) => { const s = f(p); return s != null && (round(s) ?? -1) >= target; };
    const best = f(1);
    if (reaches(0)) return { status: 'guaranteed', pct: 0, points: 0, best, items };
    const CEILING = 3; // up to 300%: beyond that, call it unreachable
    if (!reaches(CEILING)) return { status: 'unreachable', pct: null, points: null, best, items };
    let lo = 0;
    let hi = CEILING;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (reaches(mid)) hi = mid; else lo = mid;
    }
    const pts = assignmentId ? hi * (items[0].points ?? 0) : null;
    return {
      status: hi <= 1 + 1e-9 ? 'reachable' : 'beyond',
      // Round up (2 decimals) so the stated amount really is enough. Canvas
      // compares the *rounded* score with the cutoff, so e.g. 99.99/100 can
      // already reach a 90.00 cutoff.
      pct: Math.ceil(hi * 10000 - 1e-6) / 100,
      points: pts != null ? Math.ceil(pts * 100 - 1e-6) / 100 : null,
      best, items,
    };
  }

  // ---------------------------------------------------------------------------
  // Letters and GPA
  // ---------------------------------------------------------------------------

  /**
   * The Default Canvas Grading Scheme. Source: the screenshot in Canvas's
   * guide 661122 ("How do I use grading schemes in a course?") shows A 94
   * through D+ 67; the rest (D 64, D- 61, F 0) is from Yale's Canvas guide,
   * which reproduces the same default scheme in full. Values are lower bounds
   * as fractions, the way the Grading Standards API sends them.
   */
  const DEFAULT_SCHEME = Object.freeze(/** @type {[string, number][]} */ ([
    ['A', 0.94], ['A-', 0.9], ['B+', 0.87], ['B', 0.84], ['B-', 0.8], ['C+', 0.77],
    ['C', 0.74], ['C-', 0.7], ['D+', 0.67], ['D', 0.64], ['D-', 0.61], ['F', 0],
  ]));

  /**
   * The letter for a score: the highest grade whose lower bound the score
   * reaches (a grading scheme value is "the lower bound of the range",
   * Grading Standards API); below every bound, the lowest grade. The score is
   * taken to 2 decimals first, like the scores Canvas reports. Schemes have
   * at most two decimals of a percent, so the comparison is done exactly, in
   * hundredths of a percent.
   * @param {number|null} score @param {readonly [string, number][]} scheme
   */
  function letterFor(score, scheme = DEFAULT_SCHEME) {
    if (score == null || !Number.isFinite(score) || !scheme.length) return null;
    const at = Math.round(/** @type {number} */ (round(score)) * 100);
    const steps = [...scheme].sort((a, b) => b[1] - a[1]);
    const hit = steps.find(([, value]) => at >= Math.round(value * 10000));
    return (hit || steps[steps.length - 1])[0];
  }

  /** A grading_standards API record → [name, value][] (or null). */
  function schemeFromStandard(/** @type {any} */ raw) {
    const rows = Array.isArray(raw?.grading_scheme) ? raw.grading_scheme : null;
    if (!rows || raw.points_based) return null; // points-based schemes need scaling; use Canvas's letter instead
    return rows.map((/** @type {any} */ r) => /** @type {[string, number]} */ ([String(r.name), Number(r.value)])).filter(([, v]) => Number.isFinite(v));
  }

  /** Letter cutoffs as percentages, highest first: [{ letter, min }]. */
  const cutoffs = (/** @type {readonly [string, number][]} */ scheme) =>
    [...scheme].sort((a, b) => b[1] - a[1]).map(([letter, v]) => ({ letter, min: /** @type {number} */ (round(v * 100, 2)) }));

  /** A common 4.0 scale with +/− (UMD's). Editable in the GPA panel. */
  const DEFAULT_GPA_SCALE = Object.freeze(/** @type {Record<string, number>} */ ({
    'A+': 4.0, A: 4.0, 'A-': 3.7, 'B+': 3.3, B: 3.0, 'B-': 2.7, 'C+': 2.3, C: 2.0, 'C-': 1.7, 'D+': 1.3, D: 1.0, 'D-': 0.7, F: 0,
  }));

  /** Normalize a letter for scale lookup ("B−" → "B-", trim, upper). */
  const letterKey = (/** @type {string} */ l) => String(l).trim().replace(/[−–]/g, '-').toUpperCase();

  /**
   * Credit-weighted GPA.
   * @param {{ letter: string|null, credits: number }[]} rows
   * @param {Record<string, number>} scale
   * @returns {{ gpa: number|null, credits: number, counted: number, unknown: string[] }}
   */
  function gpa(rows, scale = DEFAULT_GPA_SCALE) {
    const table = new Map(Object.entries(scale).map(([k, v]) => [letterKey(k), Number(v)]));
    let points = 0;
    let credits = 0;
    let counted = 0;
    /** @type {string[]} */
    const unknown = [];
    for (const r of rows) {
      if (!r.letter || !(r.credits > 0)) continue;
      const v = table.get(letterKey(r.letter));
      if (v == null || !Number.isFinite(v)) { unknown.push(r.letter); continue; }
      points += v * r.credits;
      credits += r.credits;
      counted += 1;
    }
    return { gpa: credits > 0 ? clean(points / credits) : null, credits, counted, unknown };
  }

  Gesso.grades = {
    round, clean, sameScore, dropAssignments, dropNaive, CANVAS_RULES, classify, isNotGraded, gradeTime,
    compute, explain, trend, remainingWork, needed,
    DEFAULT_SCHEME, letterFor, schemeFromStandard, cutoffs, DEFAULT_GPA_SCALE, letterKey, gpa,
  };
})();
