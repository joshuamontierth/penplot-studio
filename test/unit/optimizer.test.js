// Unit tests for js/core/optimizer.js (PP.Optimizer): path preparation, travel ordering, joining, time estimates.
import { describe, expect, it } from 'vitest';

const O = window.PP.Optimizer;
const G = window.PP.Geo;

/** Element-wise toBeCloseTo for flat coordinate arrays. */
function expectCoords(actual, expected, digits = 9) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((v, i) => expect(actual[i], `index ${i}`).toBeCloseTo(v, digits));
}

function expectPolys(actual, expected, digits = 9) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((p, i) => expectCoords(actual[i], p, digits));
}

/** Pen-up distance to draw `seq` in order, starting at `start`. */
function travel(seq, start) {
  let cx = start.x,
    cy = start.y,
    d = 0;
  for (const p of seq) {
    d += Math.hypot(p[0] - cx, p[1] - cy);
    cx = p[p.length - 2];
    cy = p[p.length - 1];
  }
  return d;
}

/** Deterministic PRNG (LCG) in [0, 1). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomSegments(n, seed) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = r() * 200,
      y = r() * 150,
      a = r() * Math.PI * 2,
      l = 1 + r() * 4;
    out.push([x, y, x + Math.cos(a) * l, y + Math.sin(a) * l]);
  }
  return out;
}

/** O(n^2) greedy nearest-neighbour reference, optionally drawing paths backwards. */
function bruteForceOrder(polys, start, allowRev) {
  const left = polys.slice();
  const out = [];
  let cx = start.x,
    cy = start.y;
  while (left.length) {
    let best = -1,
      bestD = Infinity,
      rev = false;
    left.forEach((p, i) => {
      const d0 = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
      if (d0 < bestD) {
        bestD = d0;
        best = i;
        rev = false;
      }
      if (!allowRev) return;
      const d1 = (p[p.length - 2] - cx) ** 2 + (p[p.length - 1] - cy) ** 2;
      if (d1 < bestD) {
        bestD = d1;
        best = i;
        rev = true;
      }
    });
    const p = rev ? G.reverse(left[best]) : left[best];
    left.splice(best, 1);
    out.push(p);
    cx = p[p.length - 2];
    cy = p[p.length - 1];
  }
  return out;
}

const ORIGIN = { x: 0, y: 0 };

describe('prepare', () => {
  it('splits polylines at non-finite points and drops fragments shorter than two points', () => {
    expect(O.prepare([[0, 0, 1, 0, NaN, NaN, 5, 5, 6, 5]]).polys).toEqual([
      [0, 0, 1, 0],
      [5, 5, 6, 5],
    ]);
    expect(O.prepare([[0, 0, NaN, 1, 5, 5, 6, 6, Infinity, 0, 7, 7]]).polys).toEqual([[5, 5, 6, 6]]);
  });

  it('skips empty input and removes consecutive duplicate points', () => {
    const r = O.prepare([null, [1, 2], [], [0, 0, 0, 0, 1, 0, 1, 0, 2, 0]]);
    expect(r).toEqual({ polys: [[0, 0, 1, 0, 2, 0]], clipped: false, removed: 0 });
  });

  it('simplifies with the tolerance and leaves points alone without one', () => {
    const p = [0, 0, 1, 0.01, 2, 0, 3, 0.02, 4, 0];
    expect(O.prepare([p], { tolerance: 0.1 }).polys).toEqual([[0, 0, 4, 0]]);
    expect(O.prepare([p]).polys).toEqual([p]);
    expect(O.prepare([p], { tolerance: 0.001 }).polys).toEqual([p]);
  });

  it('reports clipped only when something was cut away', () => {
    const rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(O.prepare([[1, 1, 99, 99]], { rect }).clipped).toBe(false);
    const r = O.prepare(
      [
        [50, 50, 150, 50],
        [200, 200, 300, 300],
      ],
      { rect },
    );
    expect(r.clipped).toBe(true);
    expectPolys(r.polys, [[50, 50, 100, 50]]);
  });

  it('clips before simplifying, so the result stays on the design inside the rect', () => {
    const rect = { minX: 0, minY: -100, maxX: 100, maxY: 100 };
    // Simplifying first would collapse this to one chord and then clip it to (0, 0)-(30, 0).
    const long = O.prepare([[-10, 0, 5, 0.01, 10, 0, 20, 0.01, 30, 0]], { rect, tolerance: 0.1 });
    expectPolys(long.polys, [[0, 0.02 / 3, 30, 0]]);
    // A zig-zag grazing the edge: simplify-first would keep a line at x = 0.04 where the design is outside.
    const graze = O.prepare([[0.04, 0, -0.04, 10, 0.04, 20]], { rect, tolerance: 0.1 });
    expect(graze.clipped).toBe(true);
    expectPolys(graze.polys, [
      [0.04, 0, 0, 5],
      [0, 15, 0.04, 20],
    ]);
  });

  it('drops paths shorter than minLength, keeps dots and counts removals', () => {
    const r = O.prepare(
      [
        [0, 0, 0.1, 0],
        [0, 0, 5, 0],
        [3, 3, 3, 3],
        [0, 0, 0.3, 0, 0.3, 0.3],
      ],
      { minLength: 0.5 },
    );
    expect(r).toEqual({
      polys: [
        [0, 0, 5, 0],
        [3, 3, 3, 3],
        [0, 0, 0.3, 0, 0.3, 0.3],
      ],
      clipped: false,
      removed: 1,
    });
  });

  it('does not mutate its input', () => {
    const p = [-10, 0, 0, 0, 0, 0, 5, 0.01, 10, 0];
    const copy = p.slice();
    O.prepare([p], { rect: { minX: -5, minY: -5, maxX: 5, maxY: 5 }, tolerance: 0.1, minLength: 1 });
    expect(p).toEqual(copy);
  });
});

describe('order', () => {
  it('returns an empty list for no paths', () => {
    expect(O.order([], ORIGIN)).toEqual([]);
  });

  it('keeps the input order and direction when reorder is off', () => {
    const polys = [
      [20, 0, 21, 0],
      [0, 0, 1, 0],
      [11, 0, 10, 0],
    ];
    const r = O.order(polys, ORIGIN, { reorder: false, joinTol: 0 });
    expect(r).toEqual(polys);
    r.forEach((p, i) => expect(p).toBe(polys[i]));
  });

  it('visits the nearest path next, starting from the start point', () => {
    const a = [20, 0, 21, 0],
      b = [0, 0, 1, 0],
      c = [10, 0, 11, 0];
    expect(O.order([a, b, c], ORIGIN, { joinTol: 0 })).toEqual([b, c, a]);
    expect(O.order([a, b, c], { x: 25, y: 0 }, { joinTol: 0 })).toEqual([
      [21, 0, 20, 0],
      [11, 0, 10, 0],
      [1, 0, 0, 0],
    ]);
  });

  it('reverses a path when its end is closer, unless reverse is off', () => {
    const p = [10, 0, 1, 0];
    expect(O.order([p], ORIGIN, { joinTol: 0 })).toEqual([[1, 0, 10, 0]]);
    expect(O.order([p], ORIGIN, { joinTol: 0, reverse: false })).toEqual([p]);
  });

  it('matches a brute-force greedy nearest-neighbour search', () => {
    const polys = randomSegments(300, 7);
    const start = { x: 100, y: 75 };
    expect(O.order(polys, start, { joinTol: 0 })).toEqual(bruteForceOrder(polys, start, true));
    expect(O.order(polys, start, { joinTol: 0, reverse: false })).toEqual(bruteForceOrder(polys, start, false));
  });

  it('reduces travel compared with the input order and keeps every path', () => {
    const polys = randomSegments(200, 42);
    const r = O.order(polys, ORIGIN, { joinTol: 0 });
    expect(travel(r, ORIGIN)).toBeLessThan(travel(polys, ORIGIN) / 4);
    expect(r).toHaveLength(polys.length);
    const key = (p) => [p, G.reverse(p)].map(String).sort()[0];
    expect(r.map(key).sort()).toEqual(polys.map(key).sort());
    expect(O.order(polys, ORIGIN, { joinTol: 0, reverse: false })).toHaveLength(polys.length);
  });

  it('starts from the bbox corner when no start point is given', () => {
    const polys = [
      [50, 50, 51, 50],
      [5, 5, 6, 5],
      [20, 20, 21, 20],
    ];
    expect(O.order(polys, null, { joinTol: 0 })[0]).toBe(polys[1]);
  });

  it('joins touching paths by default and not when joinTol is 0', () => {
    const polys = [
      [5, 0, 10, 0],
      [0, 0, 5, 0],
    ];
    expect(O.order(polys, ORIGIN)).toEqual([[0, 0, 5, 0, 10, 0]]);
    expect(O.order(polys, ORIGIN, { joinTol: 0 })).toEqual([
      [0, 0, 5, 0],
      [5, 0, 10, 0],
    ]);
  });
});

describe('join', () => {
  it('merges paths whose ends touch exactly, dropping the duplicate point', () => {
    expect(
      O.join(
        [
          [0, 0, 1, 0],
          [1, 0, 2, 0],
          [2, 0, 2, 1],
        ],
        0.05,
      ),
    ).toEqual([[0, 0, 1, 0, 2, 0, 2, 1]]);
  });

  it('keeps the start point of a path joined within tolerance', () => {
    // regression: the joined path's first point used to be dropped, cutting a corner off the design
    expect(
      O.join(
        [
          [0, 0, 1, 0],
          [1.01, 0, 1.01, 5],
        ],
        0.05,
      ),
    ).toEqual([[0, 0, 1, 0, 1.01, 0, 1.01, 5]]);
    expect(O.join([[3, 3, 4, 4]], 0.05)).toEqual([[3, 3, 4, 4]]);
  });

  it('does not join beyond the tolerance or by reversing a path', () => {
    expect(
      O.join(
        [
          [0, 0, 1, 0],
          [1.1, 0, 2, 0],
        ],
        0.05,
      ),
    ).toEqual([
      [0, 0, 1, 0],
      [1.1, 0, 2, 0],
    ]);
    expect(
      O.join(
        [
          [0, 0, 1, 0],
          [2, 0, 1, 0],
        ],
        0.05,
      ),
    ).toEqual([
      [0, 0, 1, 0],
      [2, 0, 1, 0],
    ]);
  });

  it('copies instead of mutating and handles an empty list', () => {
    const a = [0, 0, 1, 0],
      b = [1, 0, 2, 0];
    const r = O.join([a, b], 0.05);
    expect(a).toEqual([0, 0, 1, 0]);
    expect(b).toEqual([1, 0, 2, 0]);
    expect(r[0]).not.toBe(a);
    expect(O.join([], 1)).toEqual([]);
  });
});

describe('trapTime', () => {
  it('is zero for no distance and d / v without acceleration', () => {
    expect(O.trapTime(0, 10, 100)).toBe(0);
    expect(O.trapTime(-5, 10, 100)).toBe(0);
    expect(O.trapTime(50, 10, 0)).toBe(5);
    expect(O.trapTime(50, 10, undefined)).toBe(5);
  });

  it('uses a trapezoid for long moves and a triangle for short ones', () => {
    expect(O.trapTime(100, 10, 100)).toBeCloseTo(10.1, 12); // cruise + v / a ramp penalty
    expect(O.trapTime(0.5, 10, 100)).toBeCloseTo(2 * Math.sqrt(0.005), 12); // never reaches 10 mm/s
    // continuous where the profile switches (d = v^2 / a)
    expect(O.trapTime(1, 10, 100)).toBeCloseTo(0.2, 12);
    expect(O.trapTime(1 - 1e-9, 10, 100)).toBeCloseTo(0.2, 8);
  });

  it('never decreases with distance', () => {
    let prev = 0;
    for (let d = 0; d <= 5; d += 0.05) {
      const t = O.trapTime(d, 20, 300);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });
});

describe('polyTime', () => {
  it('equals trapTime for a single segment', () => {
    expect(O.polyTime([0, 0, 100, 0], 50, 1000)).toBeCloseTo(O.trapTime(100, 50, 1000), 12);
    expect(O.polyTime([0, 0, 3, 4], 50, 1000)).toBeCloseTo(O.trapTime(5, 50, 1000), 12);
    expect(O.polyTime([0, 0], 50, 1000)).toBe(0);
    expect(O.polyTime([], 50, 1000)).toBe(0);
  });

  it('does not slow down at collinear vertices or zero-length segments', () => {
    const straight = O.trapTime(100, 50, 1000);
    expect(O.polyTime([0, 0, 25, 0, 50, 0, 100, 0], 50, 1000)).toBeCloseTo(straight, 12);
    expect(O.polyTime([0, 0, 0, 0, 100, 0], 50, 1000)).toBeCloseTo(straight, 12);
  });

  it('charges more time for sharper corners', () => {
    const straight = O.polyTime([0, 0, 50, 0, 100, 0], 50, 1000);
    const right = O.polyTime([0, 0, 50, 0, 50, 50], 50, 1000);
    const back = O.polyTime([0, 0, 50, 0, 0, 0], 50, 1000);
    expect(straight).toBeCloseTo(2.05, 12);
    expect(back).toBeCloseTo(2 * O.trapTime(50, 50, 1000), 12); // full stop at a reversal
    expect(right).toBeGreaterThan(straight);
    expect(right).toBeLessThan(back);
    // a larger junction deviation allows a faster corner
    expect(O.polyTime([0, 0, 50, 0, 50, 50], 50, 1000, 0.2)).toBeLessThan(right);
  });

  it('grows with path length', () => {
    let prev = 0;
    for (const L of [0.1, 1, 5, 20, 100, 500]) {
      const t = O.polyTime([0, 0, L / 2, L / 4, L, 0], 30, 500);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
});

describe('estimate', () => {
  const settings = {
    drawSpeed: 10,
    travelSpeed: 100,
    accel: 1000,
    zSpeed: 10,
    zDraw: 0,
    zLift: 2,
    penDownDelay: 100,
    penUpDelay: 50,
  };

  it('adds travel, pen lifts, delays and drawing time per path', () => {
    const e = O.estimate(
      [
        [10, 0, 20, 0],
        [20, 5, 20, 15],
      ],
      ORIGIN,
      settings,
    );
    expect(e.travelLen).toBe(15);
    expect(e.drawLen).toBe(20);
    expect(e.lifts).toBe(2);
    // travel 10 mm: 0.2 s; z 2 mm down+up: 2 x 0.21 s; delays 0.15 s; draw 10 mm: 1.01 s
    expect(e.cumulative[0]).toBeCloseTo(1.78, 12);
    // then travel 5 mm without reaching full speed: 2 sqrt(5 / 1000) s
    expect(e.time).toBeCloseTo(1.78 + 2 * Math.sqrt(0.005) + 0.42 + 0.15 + 1.01, 12);
    expect(e.cumulative[1]).toBe(e.time);
  });

  it('reports sane units: 100 mm at 10 mm/s takes about 10 s', () => {
    const e = O.estimate([[0, 0, 100, 0]], ORIGIN, { drawSpeed: 10, accel: 1e6 });
    expect(e.time).toBeCloseTo(10, 3);
    const t = O.estimate([[1000, 0, 1000, 0]], ORIGIN, { travelSpeed: 100, accel: 1e6 });
    expect(t.travelLen).toBe(1000);
    expect(t.time).toBeCloseTo(10, 3);
  });

  it('falls back to defaults and starts at the origin without a start point', () => {
    const e = O.estimate([[3, 4, 3, 4]], null, {});
    expect(e.travelLen).toBe(5);
    expect(e.time).toBeCloseTo(O.trapTime(5, 100, 3000), 12); // default travel 100 mm/s, accel 3000 mm/s^2
    expect(O.estimate([], ORIGIN, settings)).toMatchObject({ time: 0, drawLen: 0, travelLen: 0, lifts: 0 });
  });

  it('has non-decreasing cumulative times and grows with drawing length', () => {
    const polys = O.order(randomSegments(50, 3), ORIGIN, { joinTol: 0 });
    const e = O.estimate(polys, ORIGIN, settings);
    expect(e.cumulative).toHaveLength(50);
    for (let i = 1; i < e.cumulative.length; i++) expect(e.cumulative[i]).toBeGreaterThan(e.cumulative[i - 1]);
    expect(e.cumulative[49]).toBe(e.time);
    let prev = 0;
    for (const L of [1, 10, 100, 1000]) {
      const t = O.estimate([[0, 0, L, 0]], ORIGIN, settings).time;
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
});
