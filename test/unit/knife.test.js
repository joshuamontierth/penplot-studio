// Drag-knife paths (js/core/knife.js) and cut layers in the G-code builder and simulator (docs/cutting.md).
import { describe, expect, it } from 'vitest';

const { Knife, GCode: GC, GSim: SIM } = window.PP;
const X1C = GC.normalizeProfile(window.PPTest.X1C);

/** A real drag knife: the tip is dragged behind the axis at distance r, like a caster. */
function dragTip(axis, r, tip0) {
  let tx = tip0[0],
    ty = tip0[1];
  const out = [tx, ty];
  for (let i = 2; i < axis.length; i += 2) {
    const ax0 = axis[i - 2],
      ay0 = axis[i - 1],
      ax1 = axis[i],
      ay1 = axis[i + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(ax1 - ax0, ay1 - ay0) / 0.002));
    for (let s = 1; s <= steps; s++) {
      const ax = ax0 + ((ax1 - ax0) * s) / steps,
        ay = ay0 + ((ay1 - ay0) * s) / steps;
      const d = Math.hypot(ax - tx, ay - ty);
      if (d > r) {
        tx = ax - ((ax - tx) * r) / d;
        ty = ay - ((ay - ty) * r) / d;
      }
    }
    out.push(tx, ty);
  }
  return out;
}
const near = (pts, x, y) =>
  Math.min(...pts.filter((_, i) => i % 2 === 0).map((px, i) => Math.hypot(px - x, pts[2 * i + 1] - y)));
const square = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s, x, y];

describe('knife paths', () => {
  it('make the blade tip cut sharp corners and close the shape', () => {
    const r = 0.25;
    const tip = Knife.startMidLongest(square(0, 0, 20));
    const { poly } = Knife.compensate(tip, { offset: r, swivel: 30, overcut: 1 });
    // the axis starts r ahead of the tip, along the first edge
    const dx = tip[2] - tip[0],
      dy = tip[3] - tip[1],
      l = Math.hypot(dx, dy);
    const cut = dragTip(poly, r, [tip[0], tip[1]]);
    for (const [cx, cy] of [
      [0, 0],
      [20, 0],
      [20, 20],
      [0, 20],
    ])
      expect(near(cut, cx, cy)).toBeLessThan(0.02);
    expect([poly[0], poly[1]]).toEqual([tip[0] + (r * dx) / l, tip[1] + (r * dy) / l]);
    // uncorrected, the same knife rounds every corner
    const raw = dragTip(Knife.compensate(tip, { offset: 0, overcut: 1 }).poly, r, [
      tip[0] - (r * dx) / l,
      tip[1] - (r * dy) / l,
    ]);
    expect(near(raw, 20, 0)).toBeGreaterThan(0.08);
  });

  it('leaves gentle turns to the blade and swivels it before a cut when it points elsewhere', () => {
    const arc = [];
    for (let a = 0; a <= 90; a += 5) arc.push(10 * Math.cos((a * Math.PI) / 180), 10 * Math.sin((a * Math.PI) / 180));
    const smooth = Knife.compensate(arc, { offset: 0.25, swivel: 30 });
    expect(smooth.poly.length).toBe(arc.length); // one axis point per tip point, no arcs
    const line = Knife.compensate([0, 0, 10, 0], { offset: 0.25, swivel: 30, dir: [0, 1] });
    expect(line.poly.length / 2).toBe(1 + 9 + 1); // start, 90° swivel in 10° steps, end
    expect(Knife.compensate([0, 0, 10, 0], { offset: 0, dir: [0, 1] }).poly).toEqual([0, 0, 10, 0]);
  });

  it('cuts open paths first, then shapes from the inside out, without joining', () => {
    const outer = square(0, 0, 40),
      hole = square(10, 10, 20),
      island = square(15, 15, 10),
      line = [50, 0, 60, 0];
    const out = Knife.order([outer, hole, line, island], { x: 0, y: 0 });
    const size = (p) => Math.max(...p.filter((_, i) => i % 2 === 0)) - Math.min(...p.filter((_, i) => i % 2 === 0));
    expect(out.map(size)).toEqual([10, 10, 20, 40]); // line (10 long), island, hole, outer
    expect(out[0]).toEqual([50, 0, 60, 0]);
  });
});

describe('cut layers in the G-code', () => {
  const P = GC.normalizeProfile({ ...window.PPTest.X1C, zDraw: 14, zCut: 13, cutSpeed: 15, layerPause: false });
  const pen = { name: 'Ink', polys: [[100, 100, 150, 100]] };
  const knife = { name: 'Cut', tool: 'cut', polys: [square(100, 100, 30), square(110, 110, 10), [100, 140, 130, 140]] };

  it('swaps to the knife with a pause, cuts at Z-Cut with knife paths, and passes the simulator', () => {
    const jobs = [pen, knife];
    const res = GC.build(jobs, P, { date: new Date(0) });
    const text = res.text;
    expect(text).toMatch(/^; PAUSE: swap the pen holder for the knife holder, then press RESUME$/m);
    expect(text.indexOf('; PP_TOOL knife')).toBeGreaterThan(text.indexOf('; PP_PAUSE swap'));
    expect(text).toMatch(/^G1 Z13 F900 ; knife down$/m);
    expect(text).toMatch(/ F900 ; knife down\nG1 X[\d.]+ Y[\d.]+ F900\n/); // cut speed 15 mm/s
    const sim = SIM.check(text, P, jobs, { keepMoves: false });
    expect(sim.errors).toEqual([]);
    expect(sim.pauses.map((x) => x.action)).toEqual(['attach', 'swap']);
    expect(sim.strokes).toHaveLength(1 + 3);
  });

  it('uses the knife offset when the knife sits elsewhere', () => {
    const Q = GC.normalizeProfile({ ...P, knifeSameAsPen: false, knifeOffsetX: -20, knifeOffsetY: -30 });
    const jobs = [{ ...knife, polys: [[120, 120, 140, 120]] }];
    const text = GC.build(jobs, Q, { date: new Date(0) }).text;
    // the axis starts 0.25 ahead of (120, 120); the nozzle is the axis minus the knife offset
    expect(text).toMatch(/^G1 X140\.25 Y150 F12000$/m);
    expect(text).toMatch(/^; PAUSE: attach the knife holder now, check the blade depth,$/m);
    expect(SIM.check(text, Q, jobs, { keepMoves: false }).errors).toEqual([]);
  });

  it('rejects a knife pushed below its floor, the wrong tool height, and a missing knife marker', () => {
    const jobs = [pen, knife];
    const text = GC.build(jobs, P, { date: new Date(0) }).text;
    const codes = (t) => SIM.check(t, P, jobs, { keepMoves: false }).errors.map((e) => e.code);
    expect(codes(text.replace('G1 Z13 F900 ; knife down', 'G1 Z6 F900 ; knife down'))).toContain('z-too-low');
    expect(codes(text.replace('G1 Z13 F900 ; knife down', 'G1 Z14 F900 ; knife down'))).toContain('odd-draw-z');
    expect(codes(text.replace('; PP_TOOL knife', ';'))).toContain('odd-draw-z');
  });

  it('repeats each path for extra passes and keeps the pen file unchanged', () => {
    const two = GC.normalizeProfile({ ...P, cutPasses: 2 });
    expect(GC.cutPlan(two, knife).polys).toHaveLength(2 * GC.cutPlan(P, knife).polys.length);
    const jobs = [knife];
    expect(SIM.check(GC.build(jobs, two, { date: new Date(0) }).text, two, jobs, { keepMoves: false }).errors).toEqual(
      [],
    );
  });
});

describe('cut golden file', () => {
  it('a pen square, then a knife square with a hole, on the X1C', async () => {
    const jobs = [
      { name: 'Ink', color: '#1a1a1a', polys: [square(100, 100, 10)] },
      { name: 'Cut', color: '#e11d48', tool: 'cut', polys: [square(130, 100, 20), square(135, 105, 10)] },
    ];
    const res = GC.build(jobs, X1C, { date: new Date(Date.UTC(2026, 0, 1)), title: 'golden' });
    expect(SIM.check(res.text, X1C, jobs, { keepMoves: false }).errors).toEqual([]);
    await expect(res.text).toMatchFileSnapshot('__snapshots__/x1c-cut.gcode');
  });
});
