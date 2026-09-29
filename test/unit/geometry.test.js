// Unit tests for js/core/geometry.js (PP.Geo): flat [x0, y0, x1, y1, ...] polylines in mm, Y up.
import { describe, expect, it } from 'vitest';

const G = window.PP.Geo;

/** Element-wise toBeCloseTo for flat coordinate arrays (also used for matrices). */
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

const SQUARE = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
const HOLE = [3, 3, 7, 3, 7, 7, 3, 7, 3, 3];
const RECT = { minX: 0, minY: 0, maxX: 10, maxY: 10 };

describe('bounding boxes', () => {
  it('covers every finite point and returns null when nothing is finite', () => {
    expect(
      G.bbox([
        [0, 0, 10, 5],
        [-3, 2, 4, 8],
      ]),
    ).toEqual({ minX: -3, minY: 0, maxX: 10, maxY: 8 });
    const p = [1, 1, NaN, 50, Infinity, 2, 3, -Infinity, 4, 4];
    expect(G.bbox([p])).toEqual({ minX: 1, minY: 1, maxX: 4, maxY: 4 });
    expect(G.bbox([])).toBeNull();
    expect(G.bbox([[NaN, NaN, Infinity, 0]])).toBeNull();
  });

  it('unions, sizes and centers boxes, tolerating null', () => {
    const a = { minX: 0, minY: 0, maxX: 2, maxY: 2 };
    const b = { minX: -1, minY: 1, maxX: 1, maxY: 5 };
    expect(G.bboxUnion(a, b)).toEqual({ minX: -1, minY: 0, maxX: 2, maxY: 5 });
    expect(G.bboxUnion(null, b)).toEqual(b);
    expect(G.bboxUnion(null, b)).not.toBe(b);
    expect(G.bboxUnion(null, null)).toBeNull();
    expect(G.bboxSize(b)).toEqual({ w: 2, h: 4 });
    expect(G.bboxCenter(b)).toEqual({ x: 0, y: 3 });
    expect(G.bboxSize(null)).toEqual({ w: 0, h: 0 });
    expect(G.bboxCenter(null)).toEqual({ x: 0, y: 0 });
  });
});

describe('affine transforms', () => {
  it('matTRS scales, then rotates, then translates', () => {
    const m = G.matTRS(10, 20, 90, 2, 3);
    expectCoords(m, [0, 2, -3, 0, 10, 20]);
    expectCoords(G.apply(m, 1, 0), [10, 22]);
    expectCoords(G.apply(m, 0, 1), [7, 20]);
  });

  it('matMul applies the right-hand matrix first', () => {
    const T = [1, 0, 0, 1, 5, 0],
      S = [2, 0, 0, 2, 0, 0];
    expect(G.matMul(T, S)).toEqual([2, 0, 0, 2, 5, 0]);
    expect(G.matMul(S, T)).toEqual([2, 0, 0, 2, 10, 0]);
    const m1 = G.matTRS(3, -2, 30, 1.5, 0.5),
      m2 = [1, 0.2, -0.3, 1, 4, 5];
    expectCoords(G.apply(G.matMul(m1, m2), 7, -3), G.apply(m1, ...G.apply(m2, 7, -3)));
  });

  it('matInv inverts, and falls back to a fresh identity for singular matrices', () => {
    const m = G.matTRS(12, -4, 37, 2, 0.5);
    expectCoords(G.matMul(m, G.matInv(m)), G.IDENTITY);
    expectCoords(G.matMul(G.matInv(m), m), G.IDENTITY);
    const inv = G.matInv([1, 2, 2, 4, 3, 3]);
    expect(inv).toEqual([1, 0, 0, 1, 0, 0]);
    expect(inv).not.toBe(G.IDENTITY);
  });

  it('transformPoly, transform and translate map every point without mutating input', () => {
    const p = [0, 0, 1, 2];
    expect(G.transformPoly(p, [2, 0, 0, 3, 1, 1])).toEqual([1, 1, 3, 7]);
    expect(G.transform([p, [1, 1, 1, 1]], [0, 1, -1, 0, 0, 0])).toEqual([
      [0, 0, -2, 1],
      [-1, 1, -1, 1],
    ]);
    expect(G.translate([p], 5, -1)).toEqual([[5, -1, 6, 1]]);
    expect(p).toEqual([0, 0, 1, 2]);
  });

  it('center moves the bbox center to the origin and reports the old center', () => {
    const r = G.center([
      [10, 20, 30, 20],
      [20, 40, 20, 40],
    ]);
    expect(r.cx).toBe(20);
    expect(r.cy).toBe(30);
    expect(r.polys).toEqual([
      [-10, -10, 10, -10],
      [0, 10, 0, 10],
    ]);
    expect(G.center([])).toEqual({ polys: [], cx: 0, cy: 0 });
  });
});

describe('measurements', () => {
  it('polyLength, totalLength and pointCount', () => {
    expect(G.polyLength([0, 0, 3, 4, 3, 10])).toBe(11);
    expect(G.polyLength([5, 5])).toBe(0);
    expect(G.polyLength([2, 2, 2, 2])).toBe(0);
    expect(G.totalLength([[0, 0, 3, 4], SQUARE])).toBe(45);
    expect(G.totalLength([])).toBe(0);
    expect(G.pointCount([[0, 0, 3, 4], SQUARE])).toBe(7);
  });

  it('isClosed needs four points with matching ends; reverse flips point order', () => {
    expect(G.isClosed(SQUARE)).toBe(true);
    expect(G.isClosed([0, 0, 1, 0, 0, 0])).toBe(false); // only 3 points
    expect(G.isClosed([0, 0, 1, 0, 1, 1, 0.01, 0])).toBe(false);
    expect(G.isClosed([0, 0, 1, 0, 1, 1, 0.01, 0], 0.1)).toBe(true);
    expect(G.closedLoops([SQUARE, [0, 0, 5, 5]])).toEqual([SQUARE]);
    expect(G.reverse([1, 2, 3, 4, 5, 6])).toEqual([5, 6, 3, 4, 1, 2]);
  });

  it('segDistSq measures squared distance to the nearest point of a segment', () => {
    expect(G.segDistSq(5, 3, 0, 0, 10, 0)).toBe(9); // perpendicular foot inside
    expect(G.segDistSq(13, 4, 0, 0, 10, 0)).toBe(25); // beyond the end: distance to (10, 0)
    expect(G.segDistSq(-3, -4, 0, 0, 10, 0)).toBe(25); // before the start
    expect(G.segDistSq(4, 5, 1, 1, 1, 1)).toBe(25); // degenerate segment
    expect(G.segDistSq(1, 1, 0, 0, 2, 2)).toBe(0);
  });
});

describe('simplify (Ramer-Douglas-Peucker)', () => {
  it('drops points within tolerance and keeps the ones outside it', () => {
    const p = [0, 0, 1, 0.05, 2, 0, 2, 5];
    expect(G.simplify(p, 0.1)).toEqual([0, 0, 2, 0, 2, 5]);
    expect(G.simplify(p, 0.01)).toEqual(p);
  });

  it('collapses a long collinear run to its endpoints', () => {
    const p = [];
    for (let i = 0; i <= 100; i++) p.push(i, 0);
    expect(G.simplify(p, 0.001)).toEqual([0, 0, 100, 0]);
  });

  it('returns a copy for two points or a non-positive tolerance', () => {
    const p = [0, 0, 1, 0.5, 2, 0];
    expect(G.simplify(p, 0)).toEqual(p);
    expect(G.simplify(p, 0)).not.toBe(p);
    expect(G.simplify(p, NaN)).toEqual(p);
    expect(G.simplify([0, 0, 5, 5], 10)).toEqual([0, 0, 5, 5]);
  });
});

describe('dedupe', () => {
  it('removes consecutive duplicates within eps', () => {
    expect(G.dedupe([0, 0, 0, 0, 1, 1, 1, 1, 2, 2])).toEqual([0, 0, 1, 1, 2, 2]);
    expect(G.dedupe([0, 0, 1e-7, 0, 1, 0])).toEqual([0, 0, 1, 0]);
    expect(G.dedupe([0, 0, 0.01, 0, 1, 0], 0.1)).toEqual([0, 0, 1, 0]);
    expect(G.dedupe([0, 0, 1, 0, 0, 0])).toEqual([0, 0, 1, 0, 0, 0]); // not consecutive
    // a collapsed polyline survives as a two-point dot; short input is copied as-is
    expect(G.dedupe([5, 5, 5, 5, 5, 5])).toEqual([5, 5, 5, 5]);
    const short = [1, 1, 1, 1];
    expect(G.dedupe(short)).toEqual(short);
    expect(G.dedupe(short)).not.toBe(short);
  });
});

describe('smoothing', () => {
  it('chaikin cuts corners at 1/4 and 3/4 and keeps open endpoints', () => {
    expect(G.chaikin([0, 0, 4, 0, 4, 4])).toEqual([0, 0, 1, 0, 3, 0, 4, 1, 4, 3, 4, 4]);
    const twice = G.chaikin([0, 0, 4, 0, 4, 4], 2);
    expect(twice).toHaveLength(24); // 3 -> 6 -> 12 points
    expect(twice.slice(0, 2)).toEqual([0, 0]);
    expect(twice.slice(-2)).toEqual([4, 4]);
  });

  it('chaikin on a closed loop stays closed and drops the original corners', () => {
    const sq = [0, 0, 4, 0, 4, 4, 0, 4, 0, 0];
    expect(G.chaikin(sq, 1, true)).toEqual([1, 0, 3, 0, 4, 1, 4, 3, 3, 4, 1, 4, 0, 3, 0, 1, 1, 0]);
    expect(G.chaikin([0, 0, 1, 1], 3)).toEqual([0, 0, 1, 1]); // fewer than 3 points: unchanged
  });

  it('catmullRom interpolates every control point of an open curve', () => {
    const out = G.catmullRom([0, 0, 10, 0, 10, 10], false, 0.5);
    expect(out).toHaveLength(82); // two 10 mm spans of 20 steps each, shared joint point
    expectCoords(out.slice(0, 2), [0, 0]);
    expectCoords(out.slice(40, 42), [10, 0]);
    expectCoords(out.slice(-2), [10, 10]);
    const flat = G.catmullRom([0, 0, 5, 0, 10, 0], false, 1);
    for (const [, y] of points(flat)) expect(y).toBe(0);
  });

  it('catmullRom on a closed loop wraps back to the first point', () => {
    const out = G.catmullRom([0, 0, 10, 0, 10, 10, 0, 10], true, 0.5);
    expect(out).toHaveLength(162); // 4 spans x 20 steps + start point
    for (const k of [0, 20, 40, 60, 80]) {
      const expected = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ][k / 20];
      expectCoords(out.slice(k * 2, k * 2 + 2), expected);
    }
    expect(G.catmullRom([0, 0, 1, 1])).toEqual([0, 0, 1, 1]);
  });
});

describe('resample', () => {
  it('places points every step along the path and always ends on the last point', () => {
    expect(G.resample([0, 0, 10, 0], 2.5)).toEqual([0, 0, 2.5, 0, 5, 0, 7.5, 0, 10, 0]);
    expect(G.resample([0, 0, 5, 0], 2)).toEqual([0, 0, 2, 0, 4, 0, 5, 0]);
    // the leftover distance carries across vertices; zero-length segments are skipped
    expect(G.resample([0, 0, 3, 0, 3, 3], 2)).toEqual([0, 0, 2, 0, 3, 1, 3, 3]);
    expect(G.resample([0, 0, 0, 0, 4, 0], 2)).toEqual([0, 0, 2, 0, 4, 0]);
  });

  it('returns a copy for a single point or an invalid step', () => {
    const p = [0, 0, 4, 0];
    expect(G.resample(p, 0)).toEqual(p);
    expect(G.resample(p, -1)).not.toBe(p);
    expect(G.resample([3, 3], 1)).toEqual([3, 3]);
  });
});

describe('shape builders', () => {
  it('ellipse is closed exactly and every point lies on the ellipse', () => {
    const e = G.ellipse(10, 5, 8);
    expect(e).toHaveLength(18);
    expect(e[16]).toBe(e[0]);
    expect(e[17]).toBe(e[1]);
    expectCoords(e.slice(4, 6), [0, 5]);
    for (const [x, y] of points(e)) expect((x / 10) ** 2 + (y / 5) ** 2).toBeCloseTo(1, 12);
    expect(G.ellipse(10, 10)).toHaveLength(127 * 2); // ~0.5 mm segments: ceil(20 pi / 0.5) = 126
    expect(G.ellipse(0.1, 0.1)).toHaveLength(25 * 2); // at least 24 segments
  });

  it('rect is closed and centered; rounded corners keep the bbox and clamp the radius', () => {
    expect(G.rect(10, 4)).toEqual([-5, -2, 5, -2, 5, 2, -5, 2, -5, -2]);
    const r = G.rect(10, 4, 1);
    expect(G.isClosed(r)).toBe(true);
    expectCoords(Object.values(G.bbox([r])), [-5, -2, 5, 2]);
    // inscribed corner arcs are slightly shorter than the true 20 + 2 pi outline
    expect(G.polyLength(r)).toBeGreaterThan(26.2);
    expect(G.polyLength(r)).toBeLessThan(20 + 2 * Math.PI);
    const pill = G.rect(10, 4, 100); // radius clamps to half the height
    expectCoords(Object.values(G.bbox([pill])), [-5, -2, 5, 2]);
    expect(G.hitPolys([pill], 5, 0, 1e-9)).toBe(true);
    expect(G.hitPolys([pill], 5, 1.5, 0.1)).toBe(false); // the sharp corner region is cut away
  });

  it('polygon and star close exactly and start at the rotation angle', () => {
    const sq = G.polygon(4, 1, 1, 0);
    expectCoords(sq, [1, 0, 0, 1, -1, 0, 0, -1, 1, 0]);
    expect(sq[8]).toBe(sq[0]);
    expectCoords(G.polygon(3, 2, 2).slice(0, 2), [0, 2]); // default rotation 90 deg
    const st = G.star(5, 10, 10, 0.5);
    expect(st).toHaveLength(22);
    expectCoords(st.slice(0, 2), [0, 10]);
    expect(st[20]).toBe(st[0]);
    points(st).forEach(([x, y], i) => expect(Math.hypot(x, y)).toBeCloseTo(i % 2 ? 5 : 10, 12));
  });

  it('arc samples about every step mm between the two angles', () => {
    const a = G.arc(1, 2, 10, 0, Math.PI / 2);
    expect(a).toHaveLength(33 * 2); // ceil(15.7 / 0.5) = 32 segments
    expectCoords(a.slice(0, 2), [11, 2]);
    expectCoords(a.slice(-2), [1, 12]);
    for (const [x, y] of points(a)) expect(Math.hypot(x - 1, y - 2)).toBeCloseTo(10, 12);
    expect(G.arc(0, 0, 10, 0, Math.PI / 2, 5)).toHaveLength(5 * 2);
    expect(G.arc(0, 0, 0.1, 0, 0.1)).toHaveLength(3 * 2); // at least 2 segments
  });
});

describe('hit testing', () => {
  it('hitPolys hits within tol of any segment and of dots', () => {
    const polys = [
      [0, 0, 10, 0],
      [3, 3, 3, 3],
    ];
    expect(G.hitPolys(polys, 5, 0.4, 0.5)).toBe(true);
    expect(G.hitPolys(polys, 5, 0.6, 0.5)).toBe(false);
    expect(G.hitPolys(polys, 10.3, 0.3, 0.5)).toBe(true); // near the end point
    expect(G.hitPolys(polys, 10.4, 0.4, 0.5)).toBe(false);
    expect(G.hitPolys(polys, 3.2, 3.2, 0.5)).toBe(true);
    expect(G.hitPolys(polys, 3.5, 3.5, 0.5)).toBe(false);
    expect(G.hitPolys([], 0, 0, 1)).toBe(false);
  });

  it('pointInLoops uses the even-odd rule over all loops', () => {
    expect(G.pointInLoops([SQUARE], 5, 5)).toBe(true);
    expect(G.pointInLoops([SQUARE], 15, 5)).toBe(false);
    expect(G.pointInLoops([SQUARE], 5, -0.1)).toBe(false);
    expect(G.pointInLoops([SQUARE, HOLE], 5, 5)).toBe(false); // inside the hole
    expect(G.pointInLoops([SQUARE, HOLE], 1, 1)).toBe(true);
    expect(G.pointInLoops([SQUARE, G.translate([SQUARE], 20, 0)[0]], 25, 5)).toBe(true);
    const tri = [0, 0, 10, 0, 0, 10]; // implicit closing edge also counts
    expect(G.pointInLoops([tri], 2, 2)).toBe(true);
    expect(G.pointInLoops([tri], 6, 6)).toBe(false);
  });
});

describe('clipping (Liang-Barsky)', () => {
  it('trims a crossing segment to the rect edges', () => {
    expect(G.clipToRect([[-5, 5, 15, 5]], RECT)).toEqual({ polys: [[0, 5, 10, 5]], clipped: true });
    expectPolys(G.clipToRect([[-5, -5, 15, 15]], RECT).polys, [[0, 0, 10, 10]]);
  });

  it('splits a polyline that leaves and re-enters the rect', () => {
    const r = G.clipToRect([[2, 5, 12, 5, 12, 8, 2, 8]], RECT);
    expect(r.clipped).toBe(true);
    expectPolys(r.polys, [
      [2, 5, 10, 5],
      [10, 8, 2, 8],
    ]);
    expectPolys(G.clipPolyToRect([-1, 1, 5, 1, 5, 9, -1, 9], RECT), [[0, 1, 5, 1, 5, 9, 0, 9]]);
  });

  it('passes inside polylines through untouched and drops outside ones', () => {
    const inside = [1, 1, 9, 9];
    const r = G.clipToRect([inside], RECT);
    expect(r.clipped).toBe(false);
    expect(r.polys[0]).toBe(inside);
    expect(G.clipToRect([[20, 20, 30, 30]], RECT)).toEqual({ polys: [], clipped: true });
    expect(G.clipToRect([[NaN, NaN, NaN, NaN]], RECT)).toEqual({ polys: [], clipped: false });
    // dots: kept on or inside the edge, dropped outside
    expect(G.clipPolyToRect([10, 10, 10, 10], RECT)).toEqual([[10, 10, 10, 10]]);
    expect(G.clipPolyToRect([11, 5, 11, 5], RECT)).toEqual([]);
  });
});

describe('eraseCircle', () => {
  it('cuts a gap where the circle crosses a segment or covers a vertex', () => {
    expect(G.eraseCircle([[0, 0, 10, 0]], 5, 0, 1)).toEqual({
      polys: [
        [0, 0, 4, 0],
        [6, 0, 10, 0],
      ],
      changed: true,
    });
    const r = G.eraseCircle([[0, 0, 5, 0, 5, 5]], 5, 0, 1);
    expect(r.changed).toBe(true);
    expectPolys(r.polys, [
      [0, 0, 4, 0],
      [5, 1, 5, 5],
    ]);
  });

  it('leaves polylines alone when they miss the circle', () => {
    const far = [20, 20, 30, 20];
    const around = [0, 10, 0, 0, 10, 0]; // bbox overlaps the circle, the segments do not
    const r = G.eraseCircle([far, around], 5, 5, 2);
    expect(r.changed).toBe(false);
    expect(r.polys[0]).toBe(far);
    expect(r.polys[1]).toEqual(around);
  });

  it('removes dots and segments that lie entirely inside the circle', () => {
    const r = G.eraseCircle(
      [
        [1, 1, 1, 1],
        [0, 0, 0.5, 0],
        [8, 8, 8, 8],
      ],
      0,
      0,
      2,
    );
    expect(r).toEqual({ polys: [[8, 8, 8, 8]], changed: true });
  });
});

describe('hatch (even-odd)', () => {
  it('fills a square with zig-zag lines at half-spacing offsets', () => {
    const h = G.hatch([SQUARE], 1, 0);
    expect(h).toHaveLength(10);
    expectCoords(h[0], [0, 0.5, 10, 0.5]);
    expectCoords(h[1], [10, 1.5, 0, 1.5]);
    expectCoords(h[9], [10, 9.5, 0, 9.5]);
  });

  it('skips holes by the even-odd rule', () => {
    const h = G.hatch([SQUARE, HOLE], 1, 0);
    expect(h).toHaveLength(6 + 4 * 2); // rows 3.5..6.5 are split around the hole
    for (const s of h) {
      expect(G.pointInLoops([SQUARE, HOLE], (s[0] + s[2]) / 2, (s[1] + s[3]) / 2)).toBe(true);
    }
    expect(G.totalLength(h)).toBeCloseTo(10 * 6 + 6 * 4, 9);
  });

  it('rotates the lines by the angle', () => {
    const h = G.hatch([SQUARE], 1, 90);
    expect(h).toHaveLength(10);
    for (const s of h) {
      expect(s[0]).toBeCloseTo(s[2], 9);
      expect(Math.abs(s[3] - s[1])).toBeCloseTo(10, 9);
    }
    // 45 deg default: total length is the midpoint-rule estimate of area / spacing
    expect(G.totalLength(G.hatch([SQUARE], 1))).toBeCloseTo(100, 1);
  });

  it('returns nothing for degenerate input', () => {
    expect(G.hatch([], 1)).toEqual([]);
    expect(G.hatch([SQUARE], 0.05)).toEqual([]);
    expect(G.hatch([SQUARE], NaN)).toEqual([]);
    expect(G.hatch([[0, 0, 10, 0]], 1, 0)).toEqual([]); // only horizontal edges
  });
});
