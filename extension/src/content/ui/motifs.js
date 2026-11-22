// @ts-check
/**
 * Decorations for the seasonal and holiday themes: one small line-art motif
 * each, drawn from simple geometry (original, no imagery from anywhere).
 *
 * Shown only in empty space (the sidebar below the course list, and the
 * theme previews), never over content, never animated, always aria-hidden.
 * Settings → Appearance → "Seasonal decorations" turns them off.
 *
 * Shapes are [tag, attributes, layer]. Layers: 'l' line (muted text color),
 * 'a' accent fill, 'b' the theme's second decoration color (--motif-b: the
 * sun's gold in Summer, the gold star in Christmas), 'al' accent line,
 * 'w' a faint accent wash.
 */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const r2 = (/** @type {number} */ v) => Math.round(v * 100) / 100;
  /** Point at `deg` on a circle. */
  const pt = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ r, /** @type {number} */ deg) =>
    [r2(cx + r * Math.cos((deg * Math.PI) / 180)), r2(cy + r * Math.sin((deg * Math.PI) / 180))];
  /** An n-pointed star path. */
  const star = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ R, /** @type {number} */ r, n = 5, rot = -90) =>
    `M${Array.from({ length: n * 2 }, (_, i) => pt(cx, cy, i % 2 ? r : R, rot + (i * 180) / n).join(' ')).join(' L')}Z`;
  /** A short line from radius a to radius b at an angle. */
  const ray = (/** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ deg) => {
    const [x1, y1] = pt(cx, cy, a, deg);
    const [x2, y2] = pt(cx, cy, b, deg);
    return /** @type {Shape} */ (['line', { x1, y1, x2, y2 }, 'l']);
  };
  /** @typedef {[string, Record<string, string|number>, string]} Shape */

  /** @type {Record<string, () => Shape[]>} */
  const MOTIFS = {
    // A sprig with two leaves and a five-petal blossom.
    spring: () => [
      ['path', { d: 'M16 56 C25 46 30 35 33 20' }, 'l'],
      ['path', { d: 'M24 45 C15 44 11 37 13 31 C21 33 25 39 24 45Z' }, 'l'],
      ['path', { d: 'M29.5 33 C37 30 41 24 41 18 C33 20 29.5 26 29.5 33Z' }, 'l'],
      ...[0, 72, 144, 216, 288].map((d) => { const [cx, cy] = pt(34, 14, 4.6, d - 90); return /** @type {Shape} */ (['circle', { cx, cy, r: 3.3 }, 'a']); }),
      ['circle', { cx: 34, cy: 14, r: 1.6 }, 'l'],
    ],
    // The sun over two waves.
    summer: () => [
      ['circle', { cx: 32, cy: 26, r: 8.5 }, 'b'],
      ...[-90, -45, 0, 45, 90, 135, 180, 225].map((d) => ray(32, 26, 12.5, 16.5, d)),
      ['path', { d: 'M8 46 q6 -4 12 0 t12 0 t12 0 t12 0' }, 'l'],
      ['path', { d: 'M14 53 q6 -4 12 0 t12 0 t12 0' }, 'l'],
    ],
    // A leaf with its veins, and a smaller one falling.
    autumn: () => [
      ['path', { d: 'M30 8 C45 16 50 33 30 52 C11 33 15 16 30 8Z', transform: 'rotate(-18 30 30)' }, 'w'],
      ['path', { d: 'M30 8 C45 16 50 33 30 52 C11 33 15 16 30 8Z', transform: 'rotate(-18 30 30)' }, 'al'],
      ['path', { d: 'M30 12 L30 58 M30 24 l-7 -5 M30 32 l8 -6 M30 40 l-8 -5', transform: 'rotate(-18 30 30)' }, 'l'],
      ['path', { d: 'M50 44 C55 47 56 52 52 56 C48 53 47 48 50 44Z M50 44 L52 56' }, 'l'],
    ],
    // A six-armed snowflake.
    winter: () => [
      ...[0, 60, 120, 180, 240, 300].flatMap((d) => [
        ray(32, 32, 3, 22, d),
        /** @type {Shape} */ (['path', { d: (() => { const [x, y] = pt(32, 32, 12, d); const [a1, b1] = pt(x, y, 5, d + 140); const [a2, b2] = pt(x, y, 5, d - 140); return `M${a1} ${b1} L${x} ${y} L${a2} ${b2}`; })() }, 'l']),
        /** @type {Shape} */ (['path', { d: (() => { const [x, y] = pt(32, 32, 18, d); const [a1, b1] = pt(x, y, 3.5, d + 140); const [a2, b2] = pt(x, y, 3.5, d - 140); return `M${a1} ${b1} L${x} ${y} L${a2} ${b2}`; })() }, 'l']),
      ]),
      ['path', { d: star(32, 32, 3.2, 3.2, 6, 0) }, 'a'],
    ],
    // A crescent moon and three small stars.
    halloween: () => [
      ['path', { d: 'M38 10 A22 22 0 1 0 54 42 A17 17 0 1 1 38 10Z' }, 'w'],
      ['path', { d: 'M38 10 A22 22 0 1 0 54 42 A17 17 0 1 1 38 10Z' }, 'al'],
      ['path', { d: star(50, 14, 3.4, 1.2, 4, 0) }, 'a'],
      ['path', { d: star(56, 26, 2.2, 0.8, 4, 0) }, 'a'],
      ['path', { d: star(12, 52, 2.6, 0.9, 4, 0) }, 'l'],
    ],
    // A stalk of wheat.
    thanksgiving: () => [
      ['path', { d: 'M31 60 C31 42 32 28 33.5 8' }, 'l'],
      ...[[14, 1], [21, -1], [27, 1], [34, -1], [40, 1]].map(([y, side]) => /** @type {Shape} */ (['ellipse', { cx: 33 + side * 4, cy: y, rx: 2.4, ry: 5, transform: `rotate(${side * 32} ${33 + side * 4} ${y})` }, 'a'])),
      ['ellipse', { cx: 34, cy: 8, rx: 2, ry: 4.4 }, 'a'],
      ['path', { d: 'M31.5 50 C24 47 19.5 41 19 35' }, 'l'],
    ],
    // An evergreen sprig: needles in pairs along a gently curved branch, a
    // small side twig, and three berries.
    christmas: () => {
      /** Needles along the quadratic curve p0 → p2 (control c), shorter toward the tip. */
      const needles = (/** @type {number[]} */ p0, /** @type {number[]} */ c, /** @type {number[]} */ p2, /** @type {number} */ n, /** @type {number} */ len) => {
        /** @type {Shape[]} */ const out = [];
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 1);
          const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t ** 2 * p2[0];
          const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t ** 2 * p2[1];
          const dx = 2 * (1 - t) * (c[0] - p0[0]) + 2 * t * (p2[0] - c[0]);
          const dy = 2 * (1 - t) * (c[1] - p0[1]) + 2 * t * (p2[1] - c[1]);
          const dir = (Math.atan2(dy, dx) * 180) / Math.PI;
          const l = len * (1 - t * 0.45);
          for (const side of [-1, 1]) {
            const [x2, y2] = pt(x, y, l, dir + side * 38);
            out.push(['line', { x1: r2(x), y1: r2(y), x2, y2 }, 'l']);
          }
        }
        return out;
      };
      return [
        ['path', { d: 'M12 56 Q26 36 52 12' }, 'l'],
        ...needles([12, 56], [26, 36], [52, 12], 9, 7.5),
        ['path', { d: 'M29 33 Q38 34 46 40' }, 'l'],
        ...needles([29, 33], [38, 34], [46, 40], 4, 5.5),
        ['circle', { cx: 19, cy: 52, r: 3 }, 'a'],
        ['circle', { cx: 24.5, cy: 54.5, r: 3 }, 'a'],
        ['circle', { cx: 19.5, cy: 58, r: 3 }, 'a'],
        ['path', { d: star(50, 52, 3, 1.1, 4, 0) }, 'b'],
      ];
    },
    // A starburst with a few sparks.
    newyear: () => [
      ...Array.from({ length: 12 }, (_, i) => ray(32, 30, 6, i % 2 ? 15 : 20, i * 30 - 90)),
      ...Array.from({ length: 6 }, (_, i) => { const [cx, cy] = pt(32, 30, 23.5, i * 60 - 90); return /** @type {Shape} */ (['circle', { cx, cy, r: 1.6 }, 'a']); }),
      ['path', { d: star(52, 52, 3.2, 1.1, 4, 0) }, 'a'],
      ['path', { d: star(12, 54, 2.4, 0.8, 4, 0) }, 'l'],
    ],
    // A heart, and a small one beside it.
    valentines: () => [
      ['path', { d: 'M30 52 C13 41 8 31 12 23 C16 15 26 15 30 23 C34 15 44 15 48 23 C52 31 47 41 30 52Z' }, 'w'],
      ['path', { d: 'M30 52 C13 41 8 31 12 23 C16 15 26 15 30 23 C34 15 44 15 48 23 C52 31 47 41 30 52Z' }, 'al'],
      ['path', { d: 'M51 13 C46.5 10 45.5 7 47 5.2 C48.3 3.8 50.2 4.2 51 5.8 C51.8 4.2 53.7 3.8 55 5.2 C56.5 7 55.5 10 51 13Z' }, 'a'],
    ],
    // One outlined star and three small solid ones.
    july4: () => [
      ['path', { d: star(28, 34, 17, 7) }, 'l'],
      ['path', { d: star(50, 14, 5.5, 2.3) }, 'a'],
      ['path', { d: star(54, 34, 3.6, 1.5) }, 'a'],
      ['path', { d: star(42, 52, 4.2, 1.8) }, 'a'],
    ],
  };

  /**
   * The motif as an SVG element, or null for themes without one.
   * @param {string|undefined} name @param {{ size?: number, class?: string }} [opts]
   * @returns {SVGSVGElement|null}
   */
  function motif(name, opts = {}) {
    const shapes = name && MOTIFS[name] ? MOTIFS[name]() : null;
    if (!shapes) return null;
    const svg = /** @type {SVGSVGElement} */ (document.createElementNS(NS, 'svg'));
    const size = String(opts.size || 84);
    for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', width: size, height: size, 'aria-hidden': 'true', focusable: 'false', class: `motif ${opts.class || ''}`.trim(), 'data-motif': name })) svg.setAttribute(k, v);
    for (const [tag, attrs, layer] of shapes) {
      const el = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
      el.setAttribute('class', `m-${layer}`);
      svg.append(el);
    }
    return svg;
  }

  Gesso.motifs = { motif, NAMES: Object.keys(MOTIFS) };
})();
