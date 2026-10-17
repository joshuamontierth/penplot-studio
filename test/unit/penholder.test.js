// Pen-holder bore resizer (js/core/penholder.js) on synthetic parts built with manifold itself, the owner's local
// copies of the MakerWorld parts when present, and the ZIP reader that takes the MakerWorld download.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from './load.js';

const PH = window.PP.PenHolder;
const STL = window.PP.STL;
let api;

beforeAll(async () => {
  api = await PH.load({
    moduleUrl: pathToFileURL(join(ROOT, 'vendor/manifold/manifold.js')).href,
    wasmBinary: readFileSync(join(ROOT, 'vendor/manifold/manifold.wasm')),
  });
});

const trisOf = (m) => {
  const mesh = m.getMesh();
  const out = new Float32Array(mesh.triVerts.length * 3);
  mesh.triVerts.forEach((v, i) => out.set(mesh.vertProperties.subarray(v * mesh.numProp, v * mesh.numProp + 3), i * 3));
  return out;
};
const boreAt = (polys, cx, cy) => {
  for (const p of polys) {
    let a = 0,
      x = 0,
      y = 0;
    p.forEach((q, i) => {
      const r = p[(i + 1) % p.length];
      a += q[0] * r[1] - r[0] * q[1];
      x += q[0];
      y += q[1];
    });
    if (a < 0 && Math.hypot(x / p.length - cx, y / p.length - cy) < 0.3) return 2 * Math.sqrt(-a / 2 / Math.PI);
  }
  return null;
};

/** A cartridge-like tube along Z: outer r 9 with a flat at x = 7.5, bore d 10.6, 1 mm entry chamfers, 40 long. */
function tube() {
  const { Manifold } = api;
  const outer = Manifold.cylinder(40, 9, -1, 96).subtract(Manifold.cube([10, 30, 50]).translate([7.5, -15, -5]));
  const bore = Manifold.cylinder(42, 5.3, -1, 72).translate([0, 0, -1]);
  const ch0 = Manifold.cylinder(1, 6.3, 5.3, 72),
    ch1 = Manifold.cylinder(1, 5.3, 6.3, 72).translate([0, 0, 39]);
  return outer.subtract(bore).subtract(ch0).subtract(ch1);
}

/** A spring-like stack along Y: 5 rings (outer r 9, bore d 11.5, 2 mm thick, 1.5 mm air gaps) on a side bar. */
function ringStack() {
  const { Manifold } = api;
  let m = Manifold.cube([2, 2, 15.5]).translate([8.5, -1, 0]);
  for (let i = 0; i < 5; i++)
    m = m.add(
      Manifold.cylinder(2, 9, -1, 96)
        .subtract(Manifold.cylinder(4, 5.75, -1, 72).translate([0, 0, -1]))
        .translate([0, 0, i * 3.5]),
    );
  return m.rotate([-90, 0, 0]); // bore along Y
}

describe('STL read/write', () => {
  it('round-trips triangles through binary STL', () => {
    const tris = trisOf(tube());
    const back = STL.parse(STL.write(tris));
    expect(back.count).toBe(tris.length / 9);
    expect(Array.from(back.tris.slice(0, 9))).toEqual(Array.from(tris.slice(0, 9)));
  });

  it('reads ASCII STL', () => {
    const txt =
      'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
    expect(STL.parse(new TextEncoder().encode(txt).buffer).count).toBe(1);
  });
});

describe('bore resizer', () => {
  it('finds the tube bore, its length and the wall limit', () => {
    const part = PH.analyze(api, trisOf(tube()));
    expect(part.axis).toBe('z');
    expect(part.d).toBeCloseTo(10.6, 1);
    expect(part.paths).toHaveLength(1); // the whole length, through the chamfers
    expect(part.boreLen).toBeGreaterThan(37);
    // the flat at 7.5 mm from the axis leaves 2 x (7.5 - 1.2) = 12.6 mm
    expect(part.maxD).toBeCloseTo(12.6, 1);
    PH.free(part);
  });

  it('shrinks and enlarges only the bore, through the chamfered ends', () => {
    const part = PH.analyze(api, trisOf(tube()));
    for (const d of [8.4, 12.2]) {
      const out = PH.resize(api, part, d);
      const m = PH.toManifold(api, out.tris);
      for (const z of [0.3, 5, 20, 39.7])
        expect(boreAt(m.slice(z).toPolygons(), 0, 0)).toBeGreaterThanOrEqual(d - 0.05);
      expect(boreAt(m.slice(20).toPolygons(), 0, 0)).toBeCloseTo(d, 1);
      // the rest of the part is untouched: the flat is still there
      expect(m.boundingBox().max[0]).toBeCloseTo(7.5, 3);
      m.delete();
    }
    expect(() => PH.resize(api, part, 13)).toThrow(/outside what this part supports/);
    PH.free(part);
  });

  it('resizes every ring of a spring stack without filling the gaps between them', () => {
    const part = PH.analyze(api, trisOf(ringStack()));
    expect(part.axis).toBe('y');
    expect(part.d).toBeCloseTo(11.5, 1);
    expect(part.plugs).toHaveLength(5);
    const v0 = PH.toManifold(api, trisOf(ringStack())).volume();
    const out = PH.resize(api, part, 9.3);
    // material added = 5 rings x 2 mm of the annulus between the old and new bore
    const expected = 5 * 2 * (Math.PI / 4) * (11.5 ** 2 - 9.3 ** 2);
    expect(out.volume - v0).toBeGreaterThan(expected * 0.95);
    expect(out.volume - v0).toBeLessThan(expected * 1.05);
    PH.free(part);
  });

  it('rejects a part without a round bore', () => {
    expect(() => PH.analyze(api, trisOf(api.Manifold.cube([10, 10, 10])))).toThrow(/No round pen bore/);
  });
});

// The owner's copies of the MakerWorld parts, when present on this machine (experiments/stls is git-ignored: the
// license does not allow committing them, so CI skips this)
const REAL = join(ROOT, 'experiments/stls');
const realParts = [
  ['Pen Cartriage.stl', 'z', 10.56, 12.1],
  ['Spring.stl', 'y', 11.47, 12.7],
].filter(([f]) => existsSync(join(REAL, f)));

describe.skipIf(!realParts.length)('the MakerWorld parts (local only)', () => {
  it.each(realParts)('%s: finds the bore and its limit, and resizes it for an 8 mm pen', (file, axis, d, maxD) => {
    const tris = () => STL.parse(readFileSync(join(REAL, file)).buffer.slice(0)).tris;
    const part = PH.analyze(api, tris());
    expect(part.axis).toBe(axis);
    expect(part.d).toBeCloseTo(d, 1);
    expect(part.maxD).toBeCloseTo(maxD, 1);
    const out = PH.resize(api, part, 8.4 + (axis === 'y' ? 0.9 : 0));
    const m = PH.toManifold(api, out.tris);
    expect(m.genus()).toBe(PH.toManifold(api, tris()).genus());
    m.delete();
    PH.free(part);
  });
});

describe('ZIP files (the MakerWorld download)', () => {
  /** A ZIP with one stored and one deflated entry, and a folder. */
  function zip(entries) {
    const locals = [],
      centrals = [];
    let offset = 0;
    for (const { name, data, deflate } of entries) {
      const body = deflate ? deflateRawSync(data) : data;
      const n = Buffer.from(name);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(deflate ? 8 : 0, 8);
      lh.writeUInt32LE(body.length, 18);
      lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(n.length, 26);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(deflate ? 8 : 0, 10);
      ch.writeUInt32LE(body.length, 20);
      ch.writeUInt32LE(data.length, 24);
      ch.writeUInt16LE(n.length, 28);
      ch.writeUInt32LE(offset, 42);
      locals.push(lh, n, body);
      centrals.push(ch, n);
      offset += 30 + n.length + body.length;
    }
    const cd = Buffer.concat(centrals);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, cd, end]);
  }

  it('reads stored and deflated entries and skips folders', async () => {
    const a = Buffer.from(STL.write(trisOf(tube()))),
      b = Buffer.from('solid x\nendsolid x\n');
    const z = zip([
      { name: 'model/', data: Buffer.alloc(0) },
      { name: 'model/Pen Cartriage.stl', data: a, deflate: true },
      { name: 'model/notes.txt', data: b },
    ]);
    const files = await window.PP.U.unzip(z.buffer.slice(z.byteOffset, z.byteOffset + z.length));
    expect(files.map((f) => f.name)).toEqual(['model/Pen Cartriage.stl', 'model/notes.txt']);
    expect(Buffer.from(files[0].data).equals(a)).toBe(true);
    expect(Buffer.from(files[1].data).equals(b)).toBe(true);
    await expect(window.PP.U.unzip(new Uint8Array(40).buffer)).rejects.toThrow(/Not a ZIP/);
  });
});
