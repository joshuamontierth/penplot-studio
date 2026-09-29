// Unit tests for js/core/svg.js (PP.SVG): path parsing and flattening, transforms, lengths, import and export.
import { describe, expect, it } from 'vitest';

const S = window.PP.SVG;
const G = window.PP.Geo;
const PX = 25.4 / 96;

/** Element-wise toBeCloseTo for flat coordinate arrays and matrices. */
function expectCoords(actual, expected, digits = 9) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual[i], `index ${i}`).toBeCloseTo(v, digits));
}

function expectPolys(actual, expected, digits = 9) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((p, i) => expectCoords(actual[i], p, digits));
}

const points = (p) => {
  const out = [];
  for (let j = 0; j < p.length; j += 2) out.push([p[j], p[j + 1]]);
  return out;
};

const maxSegment = (p) => {
  let m = 0;
  for (let j = 2; j < p.length; j += 2) m = Math.max(m, Math.hypot(p[j] - p[j - 2], p[j + 1] - p[j - 1]));
  return m;
};

/** A 100 x 100 mm document where one user unit is one millimetre. */
const doc = (body, attrs = 'width="100mm" height="100mm" viewBox="0 0 100 100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;

const polysOf = (res) => res.groups.flatMap((g) => g.polys);

describe('parsePathData', () => {
  it('parses absolute M, L, H, V and Z', () => {
    expect(S.parsePathData('M10 20 L30 40 H50 V60 Z')).toEqual([
      { c: 'M', x: 10, y: 20 },
      { c: 'L', x: 30, y: 40 },
      { c: 'L', x: 50, y: 40 },
      { c: 'L', x: 50, y: 60 },
      { c: 'Z' },
    ]);
  });

  it('resolves relative m, l, h, v against the current point and z against the subpath start', () => {
    expect(S.parsePathData('m10 20 l5 5 h10 v-5 z l0 5 z m5 5 l1 0')).toEqual([
      { c: 'M', x: 10, y: 20 },
      { c: 'L', x: 15, y: 25 },
      { c: 'L', x: 25, y: 25 },
      { c: 'L', x: 25, y: 20 },
      { c: 'Z' },
      { c: 'L', x: 10, y: 25 },
      { c: 'Z' },
      { c: 'M', x: 15, y: 25 },
      { c: 'L', x: 16, y: 25 },
    ]);
  });

  it('repeats the previous command for extra coordinates (M and m continue as lineto)', () => {
    expect(S.parsePathData('M0 0 10 0 10 10')).toEqual([
      { c: 'M', x: 0, y: 0 },
      { c: 'L', x: 10, y: 0 },
      { c: 'L', x: 10, y: 10 },
    ]);
    expect(S.parsePathData('m1 1 2 2 H5 10 v1 2')).toEqual([
      { c: 'M', x: 1, y: 1 },
      { c: 'L', x: 3, y: 3 },
      { c: 'L', x: 5, y: 3 },
      { c: 'L', x: 10, y: 3 },
      { c: 'L', x: 10, y: 4 },
      { c: 'L', x: 10, y: 6 },
    ]);
    const c = S.parsePathData('M0 0 c1 1 2 2 3 3 1 1 2 2 3 3');
    expect(c[2]).toEqual({ c: 'C', x1: 4, y1: 4, x2: 5, y2: 5, x: 6, y: 6 });
  });

  it('parses C/c and reflects the previous control point for S/s', () => {
    expect(S.parsePathData('M10 10 c1 2 3 4 5 6')[1]).toEqual({ c: 'C', x1: 11, y1: 12, x2: 13, y2: 14, x: 15, y: 16 });
    const abs = S.parsePathData('M0 0 C0 10 10 10 10 0 S20 -10 20 0');
    const rel = S.parsePathData('M0 0 c0 10 10 10 10 0 s10 -10 10 0');
    const reflected = { c: 'C', x1: 10, y1: -10, x2: 20, y2: -10, x: 20, y: 0 };
    expect(abs[2]).toEqual(reflected);
    expect(rel[2]).toEqual(reflected);
    // without a preceding curve the first control point is the current point
    expect(S.parsePathData('M3 4 S5 6 7 8')[1]).toEqual({ c: 'C', x1: 3, y1: 4, x2: 5, y2: 6, x: 7, y: 8 });
  });

  it('parses Q/q and reflects the control point for chained T/t', () => {
    const abs = S.parsePathData('M0 0 Q5 10 10 0 T20 0 T30 0');
    expect(abs.slice(1)).toEqual([
      { c: 'Q', x1: 5, y1: 10, x: 10, y: 0 },
      { c: 'Q', x1: 15, y1: -10, x: 20, y: 0 },
      { c: 'Q', x1: 25, y1: 10, x: 30, y: 0 },
    ]);
    expect(S.parsePathData('M0 0 q5 10 10 0 t10 0 t10 0')).toEqual(abs);
    expect(S.parsePathData('M0 0 L10 0 T20 0')[2]).toEqual({ c: 'Q', x1: 10, y1: 0, x: 20, y: 0 });
  });

  it('parses arcs, including relative endpoints and packed flags', () => {
    expect(S.parsePathData('M0 0 A5 6 30 0 1 10 0')[1]).toEqual({
      c: 'A',
      rx: 5,
      ry: 6,
      rot: 30,
      large: 0,
      sweep: 1,
      x0: 0,
      y0: 0,
      x: 10,
      y: 0,
    });
    expect(S.parsePathData('M10 10 a5 5 0 1 0 10 0')[1]).toEqual({
      c: 'A',
      rx: 5,
      ry: 5,
      rot: 0,
      large: 1,
      sweep: 0,
      x0: 10,
      y0: 10,
      x: 20,
      y: 10,
    });
    expect(S.parsePathData('M0 0a5 5 0 1110 0')[1]).toEqual({
      c: 'A',
      rx: 5,
      ry: 5,
      rot: 0,
      large: 1,
      sweep: 1,
      x0: 0,
      y0: 0,
      x: 10,
      y: 0,
    });
  });

  it('reads compact number syntax and mixed separators', () => {
    expect(S.parsePathData('M-.5.5L1e1-2')).toEqual([
      { c: 'M', x: -0.5, y: 0.5 },
      { c: 'L', x: 10, y: -2 },
    ]);
    expect(S.parsePathData('M0 0l.5.5.5.5').slice(1)).toEqual([
      { c: 'L', x: 0.5, y: 0.5 },
      { c: 'L', x: 1, y: 1 },
    ]);
    expect(S.parsePathData('M1,2\nL3,4\tl5 6')).toEqual([
      { c: 'M', x: 1, y: 2 },
      { c: 'L', x: 3, y: 4 },
      { c: 'L', x: 8, y: 10 },
    ]);
  });

  it('returns no commands for empty input and never throws on garbage', () => {
    expect(S.parsePathData('')).toEqual([]);
    expect(S.parsePathData(null)).toEqual([]);
    for (const d of ['M0 0 L NaN 5 L10 10', 'M 5', 'L', 'hello world', 'M0 0 A 1 2', 'M0 0 C1 2 3', '1 2 3 4']) {
      const cmds = S.parsePathData(d);
      const nums = cmds.flatMap((cmd) =>
        Object.entries(cmd)
          .filter(([k]) => k !== 'c')
          .map(([, v]) => v),
      );
      expect(nums.every(Number.isFinite)).toBe(true);
    }
    const nan = S.parsePathData('M0 0 L NaN 5 L10 10');
    expect(nan[0]).toEqual({ c: 'M', x: 0, y: 0 });
    expect(nan.at(-1)).toEqual({ c: 'L', x: 10, y: 10 });
  });
});

describe('flattenPath', () => {
  it('flattens lines into one polyline per subpath and closes Z', () => {
    expect(S.flattenPath('M0 0 L10 0 L10 10')).toEqual([[0, 0, 10, 0, 10, 10]]);
    expect(S.flattenPath('M0 0 L1 0 M5 5 L6 5')).toEqual([
      [0, 0, 1, 0],
      [5, 5, 6, 5],
    ]);
    expect(S.flattenPath('M0 0 L10 0 L10 10 Z')).toEqual([[0, 0, 10, 0, 10, 10, 0, 0]]);
    expect(S.flattenPath('M5 5')).toEqual([]); // a lone moveto draws nothing
    expect(S.flattenPath('L10 0')).toEqual([[0, 0, 10, 0]]); // implicit start at the origin
    expect(
      S.flattenPath([
        { c: 'M', x: 0, y: 0 },
        { c: 'L', x: 3, y: 4 },
      ]),
    ).toEqual([[0, 0, 3, 4]]); // pre-parsed
  });

  it('turns a circle made of two arcs into points at the exact radius', () => {
    const [p] = S.flattenPath('M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0 Z');
    expect(G.isClosed(p)).toBe(true);
    for (const [x, y] of points(p)) expect(Math.hypot(x, y)).toBeCloseTo(10, 9);
    expect(maxSegment(p)).toBeLessThanOrEqual(0.35);
    expect(G.polyLength(p)).toBeCloseTo(20 * Math.PI, 2);
  });

  it('picks the arc center from the sweep flag', () => {
    const [cw] = S.flattenPath('M10 0 A10 10 0 0 1 0 10');
    const [ccw] = S.flattenPath('M10 0 A10 10 0 0 0 0 10');
    for (const [x, y] of points(cw)) expect(Math.hypot(x, y)).toBeCloseTo(10, 9);
    for (const [x, y] of points(ccw)) expect(Math.hypot(x - 10, y - 10)).toBeCloseTo(10, 9);
    expectCoords(cw.slice(-2), [0, 10]);
    expectCoords(ccw.slice(-2), [0, 10]);
  });

  it('scales up radii that are too small and draws zero-radius arcs as lines', () => {
    const [p] = S.flattenPath('M0 0 A1 1 0 0 1 10 0');
    for (const [x, y] of points(p)) expect(Math.hypot(x - 5, y)).toBeCloseTo(5, 9);
    expectCoords(p.slice(-2), [10, 0]);
    expect(S.flattenPath('M0 0 A0 5 0 0 1 10 0')).toEqual([[0, 0, 10, 0]]);
  });

  it('honours the arc x-axis rotation', () => {
    const [p] = S.flattenPath('M0 10 A10 5 90 1 1 0 -10 A10 5 90 1 1 0 10');
    for (const [x, y] of points(p)) expect((x / 5) ** 2 + (y / 10) ** 2).toBeCloseTo(1, 9);
    expectCoords(Object.values(G.bbox([p])), [-5, -10, 5, 10], 6);
  });

  it('samples cubic and quadratic Beziers from endpoint to endpoint', () => {
    const [c] = S.flattenPath('M0 0 C0 10 10 10 10 0');
    expectCoords(c.slice(0, 2), [0, 0]);
    expectCoords(c.slice(-2), [10, 0]);
    expect(G.bbox([c]).maxY).toBeCloseTo(7.5, 9);
    expect(maxSegment(c)).toBeLessThanOrEqual(0.35);
    const [q] = S.flattenPath('M0 0 Q5 10 10 0');
    expectCoords(q.slice(-2), [10, 0]);
    expect(G.bbox([q]).maxY).toBeCloseTo(5, 9);
  });

  it('applies the matrix and measures the segment length in output units', () => {
    expect(S.flattenPath('M0 0 L10 0', [2, 0, 0, 2, 1, 1])).toEqual([[1, 1, 21, 1]]);
    const circle = 'M10 0 A10 10 0 1 1 -10 0 A10 10 0 1 1 10 0 Z';
    const [small] = S.flattenPath(circle, [0.1, 0, 0, 0.1, 0, 0]);
    for (const [x, y] of points(small)) expect(Math.hypot(x, y)).toBeCloseTo(1, 9);
    expect(maxSegment(small)).toBeLessThanOrEqual(0.35);
    const [coarse] = S.flattenPath(circle, null, 2);
    const [fine] = S.flattenPath(circle);
    expect(maxSegment(coarse)).toBeLessThanOrEqual(2);
    expect(coarse.length).toBeLessThan(fine.length / 4);
  });
});

describe('parseTransform', () => {
  it('parses translate, scale and matrix', () => {
    expect(S.parseTransform('translate(10 20)')).toEqual([1, 0, 0, 1, 10, 20]);
    expect(S.parseTransform('translate(5)')).toEqual([1, 0, 0, 1, 5, 0]);
    expect(S.parseTransform('translate( 1 , 2 )')).toEqual([1, 0, 0, 1, 1, 2]);
    expect(S.parseTransform('translate(1e1,-2.5E-1)')).toEqual([1, 0, 0, 1, 10, -0.25]);
    expect(S.parseTransform('scale(2)')).toEqual([2, 0, 0, 2, 0, 0]);
    expect(S.parseTransform('scale(2,3)')).toEqual([2, 0, 0, 3, 0, 0]);
    expect(S.parseTransform('matrix(1 2 3 4 5 6)')).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('parses rotate (optionally about a point) and skews', () => {
    expectCoords(S.parseTransform('rotate(90)'), [0, 1, -1, 0, 0, 0]);
    const m = S.parseTransform('rotate(90 10 10)');
    expectCoords(G.apply(m, 10, 10), [10, 10]);
    expectCoords(G.apply(m, 20, 10), [10, 20]);
    expectCoords(S.parseTransform('skewX(45)'), [1, 0, 1, 1, 0, 0]);
    expectCoords(S.parseTransform('skewY(45)'), [1, 1, 0, 1, 0, 0]);
  });

  it('composes chains so the rightmost transform applies first', () => {
    expect(S.parseTransform('translate(10,0) scale(2)')).toEqual([2, 0, 0, 2, 10, 0]);
    expect(S.parseTransform('scale(2) translate(10,0)')).toEqual([2, 0, 0, 2, 20, 0]);
    // (1,1) -> scale (2,3) -> rotate (-3,2) -> translate (2,7)
    expectCoords(G.apply(S.parseTransform('translate(5 5) rotate(90) scale(2 3)'), 1, 1), [2, 7]);
  });

  it('returns a fresh identity for empty input and ignores unknown functions and incomplete matrices', () => {
    expect(S.parseTransform('')).toEqual([1, 0, 0, 1, 0, 0]);
    expect(S.parseTransform(null)).not.toBe(G.IDENTITY);
    expect(S.parseTransform('foo(3) translate(3,4)')).toEqual([1, 0, 0, 1, 3, 4]);
    expect(S.parseTransform('matrix(1 2 3)')).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('splits numbers on a sign without whitespace, like browsers (translate(10-5) = 10, -5)', () => {
    expect(S.parseTransform('translate(10-5)')).toEqual([1, 0, 0, 1, 10, -5]);
    expect(S.parseTransform('matrix(1 0 0 1-2.5.5)')).toEqual([1, 0, 0, 1, -2.5, 0.5]);
  });

  it('treats scale() and a matrix with bad numbers as identity', () => {
    expect(S.parseTransform('scale()')).toEqual(G.IDENTITY);
    expect(S.parseTransform('matrix(1,0,0,1,NaN,0)')).toEqual(G.IDENTITY);
  });
});

describe('parseLength', () => {
  it('converts absolute units to mm', () => {
    expect(S.parseLength('10mm')).toBe(10);
    expect(S.parseLength('2.5cm')).toBe(25);
    expect(S.parseLength('1in')).toBe(25.4);
    expect(S.parseLength('96px')).toBeCloseTo(25.4, 12);
    expect(S.parseLength('96')).toBeCloseTo(25.4, 12); // unitless means px
    expect(S.parseLength(96)).toBeCloseTo(25.4, 12);
    expect(S.parseLength('72pt')).toBeCloseTo(25.4, 12);
    expect(S.parseLength('6pc')).toBeCloseTo(25.4, 12);
    expect(S.parseLength('4Q')).toBe(1);
    expect(S.parseLength(' 10 MM ')).toBe(10);
    expect(S.parseLength('1e1mm')).toBe(10);
    expect(S.parseLength('-5mm')).toBe(-5);
  });

  it('returns null for relative units and invalid values', () => {
    for (const v of ['50%', '2em', '', null, undefined, 'abc', '10 mm extra', 'mm']) {
      expect(S.parseLength(v), String(v)).toBeNull();
    }
  });
});

describe('importSVG', () => {
  it('maps viewBox units to the mm size and flips Y up', () => {
    const r = S.importSVG(doc('<path d="M0 0 L100 50 L100 0"/>', 'width="100mm" height="50mm" viewBox="0 0 100 50"'));
    expectPolys(polysOf(r), [[0, 0, 100, -50, 100, 0]]);
    expect(r.warnings).toEqual([]);
  });

  it('scales a viewBox to the physical size, honouring its origin and other units', () => {
    const half = S.importSVG(doc('<path d="M0 0 L200 100"/>', 'width="100mm" height="50mm" viewBox="0 0 200 100"'));
    expect(G.bboxSize(G.bbox(polysOf(half)))).toEqual({ w: 100, h: 50 });
    const offset = S.importSVG(doc('<path d="M10 10 L110 60"/>', 'width="10cm" height="5cm" viewBox="10 10 100 50"'));
    expectPolys(polysOf(offset), [[0, 0, 100, -50]]);
    const inches = S.importSVG(
      doc('<path d="M400 200"/><path d="M0 0 L400 200"/>', 'width="4in" viewBox="0 0 400 200"'),
    );
    expectPolys(polysOf(inches), [[0, 0, 101.6, -50.8]]);
  });

  it('treats user units as px without a viewBox', () => {
    expectPolys(polysOf(S.importSVG(doc('<path d="M0 0 L96 48"/>', 'width="100mm"'))), [[0, 0, 25.4, -12.7]]);
    expectPolys(polysOf(S.importSVG(doc('<line x1="0" y1="0" x2="10" y2="0"/>', ''))), [[0, 0, 10 * PX, 0]]);
  });

  it('applies nested group and element transforms', () => {
    const body =
      '<g transform="translate(10,0)"><g transform="scale(2)">' +
      '<path d="M0 0 L10 0" transform="translate(0 5)"/></g></g>';
    expectPolys(polysOf(S.importSVG(doc(body))), [[10, -10, 30, -10]]);
  });

  it('expands <use> via href, xlink:href and symbols, adding the x/y offset', () => {
    const body =
      '<defs><path id="seg" d="M0 0 L10 0"/><symbol id="sym"><path d="M0 0 L0 10"/></symbol></defs>' +
      '<use href="#seg" x="5" y="1"/>' +
      '<use xlink:href="#seg" x="20" y="2" transform="translate(0 10)"/>' +
      '<use href="#sym" x="50"/>' +
      '<use href="#missing"/><use href="http://example.com/a.svg#seg"/>';
    expectPolys(polysOf(S.importSVG(doc(body))), [
      [5, -1, 15, -1],
      [20, -12, 30, -12],
      [50, 0, 50, -10],
    ]);
  });

  it('skips defs, metadata, text, images and hidden or unpainted shapes', () => {
    const body =
      '<defs><path d="M0 0 L50 50"/></defs><metadata><path d="M0 0 L5 0"/></metadata>' +
      '<text x="0" y="10">hello</text><image href="x.png" width="10" height="10"/>' +
      '<path d="M0 0 L1 0" display="none"/><g style="display: none"><path d="M0 0 L2 0"/></g>' +
      '<path d="M0 0 L3 0" visibility="hidden"/><path d="M0 0 L4 0" fill="none" stroke="none"/>' +
      '<path d="M0 0 L6 0" stroke="#000"/>';
    const r = S.importSVG(doc(body));
    expectPolys(polysOf(r), [[0, 0, 6, 0]]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes('<text>'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('raster'))).toBe(true);
  });

  it('converts basic shapes to polylines', () => {
    const one = (el) => polysOf(S.importSVG(doc(el)));
    expectPolys(one('<rect x="10" y="10" width="30" height="20"/>'), [[10, -10, 40, -10, 40, -30, 10, -30, 10, -10]]);
    const [rounded] = one('<rect x="10" y="10" width="30" height="20" rx="5"/>');
    expect(G.isClosed(rounded)).toBe(true);
    expectCoords(Object.values(G.bbox([rounded])), [10, -30, 40, -10]);
    expect(one('<rect width="-5" height="10"/>')).toEqual([]);
    const [circle] = one('<circle cx="50" cy="50" r="20"/>');
    for (const [x, y] of points(circle)) expect(Math.hypot(x - 50, y + 50)).toBeCloseTo(20, 9);
    expectCoords(Object.values(G.bboxSize(G.bbox(one('<ellipse cx="50" cy="50" rx="20" ry="10"/>')))), [40, 20]);
    expect(one('<circle r="0"/>')).toEqual([]);
    expectPolys(one('<line x1="0" y1="0" x2="10" y2="5"/>'), [[0, 0, 10, -5]]);
    expectPolys(one('<polyline points="0,0 10,0 10,10"/>'), [[0, 0, 10, 0, 10, -10]]);
    expectPolys(one('<polygon points="0,0 10,0 10,10"/>'), [[0, 0, 10, 0, 10, -10, 0, 0]]);
    expectPolys(one('<polyline points="0,0 10,0 10"/>'), [[0, 0, 10, 0]]); // odd coordinate dropped
  });

  it('marks shapes painted only by fill as filled', () => {
    expect(S.importSVG(doc('<path d="M0 0 L10 0 L10 10 Z"/>')).groups[0].filled).toBe(true);
    expect(S.importSVG(doc('<path d="M0 0 L10 0" fill="none" stroke="#123"/>')).groups[0].filled).toBe(false);
  });

  it('tolerates broken path data without throwing', () => {
    const r = S.importSVG(doc('<path d="M0 0 L NaN 5 L10 10"/><path d=""/><path/><path d="M 5"/>'));
    for (const p of polysOf(r)) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    expect(S.importSVG(doc('<path d=""/><path/>')).groups).toEqual([]);
    let deep = '<path d="M0 0 L1 0"/>';
    for (let i = 0; i < 100; i++) deep = `<g>${deep}</g>`;
    expect(() => S.importSVG(doc(deep))).not.toThrow();
  });

  it('rejects malformed XML and non-SVG documents', () => {
    expect(() => S.importSVG('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"')).toThrow(/Could not parse/);
    expect(() => S.importSVG('<html xmlns="http://www.w3.org/1999/xhtml"/>')).toThrow(/Not an SVG/);
  });

  it('splits polyline points on a minus sign without whitespace', () => {
    expectPolys(polysOf(S.importSVG(doc('<polyline points="0,0 10-5"/>'))), [[0, 0, 10, 5]]);
  });

  it('draws a self-referencing group only once (circular <use> is ignored, like browsers)', () => {
    const r = S.importSVG(doc('<g id="loop"><path d="M0 0 L10 0"/><use href="#loop" y="1"/><use href="#loop"/></g>'));
    expect(polysOf(r)).toHaveLength(1);
  });

  it('terminates on mutually recursive <use> references', () => {
    const body =
      '<defs><g id="a"><path d="M0 0 L1 0"/><use href="#b"/></g><g id="b"><path d="M0 1 L1 1"/><use href="#a"/></g></defs>' +
      '<use href="#a"/>';
    // a, then b inside it; the reference back to a is circular and skipped
    expect(polysOf(S.importSVG(doc(body)))).toHaveLength(2);
  });

  it('stops a runaway <use> fan-out at the element budget with a warning', () => {
    // 20 levels that each use the next level twice = 2^20 leaf paths without the budget
    let body = '<defs><path id="l20" d="M0 0 L1 0"/>';
    for (let i = 19; i >= 0; i--) body += `<g id="l${i}"><use href="#l${i + 1}"/><use href="#l${i + 1}"/></g>`;
    body += '</defs><use href="#l0"/>';
    const r = S.importSVG(doc(body));
    expect(r.warnings.join(' ')).toMatch(/too complex/);
    expect(polysOf(r).length).toBeLessThan(200000);
  });
});

describe('exportSVG', () => {
  it('writes mm-sized documents with Y flipped into SVG coordinates and escaped layer names', () => {
    const layer = { name: 'Pen 1', color: '#ff0000', width: 0.5, polys: [[0, 0, 10, 0, 10, 5.25]] };
    const out = S.exportSVG([layer], 200, 100);
    expect(out).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="200mm" height="100mm" viewBox="0 0 200 100">',
        '  <g id="Pen 1" fill="none" stroke="#ff0000" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round">',
        '    <path d="M0 100L10 100L10 94.75"/>',
        '  </g>',
        '</svg>',
      ].join('\n'),
    );
    const esc = S.exportSVG([{ name: 'a<b>&"c"', color: '#000000', polys: [] }], 10, 10);
    expect(esc).toContain('id="a&lt;b&gt;&amp;&quot;c&quot;"');
    expect(esc).toContain('stroke-width="0.4"'); // default width
  });

  it('round-trips through importSVG (import is Y-up with the origin at the top edge)', () => {
    const layers = [
      {
        name: 'A',
        color: '#ff0000',
        polys: [
          [12.5, 30.125, 100, 7.75, 150.001, 99.999],
          [0, 0, 200, 150],
        ],
      },
      { name: 'B', color: '#0000ff', polys: [[50, 50, 60, 60]] },
    ];
    const back = G.translate(polysOf(S.importSVG(S.exportSVG(layers, 200, 150))), 0, 150);
    expectPolys(
      back,
      layers.flatMap((L) => L.polys),
      6,
    );
  });
});
