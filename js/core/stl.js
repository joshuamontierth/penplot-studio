/*
 * PenPlot Studio - STL read/write (binary and ASCII in, binary out).
 * Triangles are a flat Float32Array [x0,y0,z0, x1,y1,z1, x2,y2,z2, ...] (9 numbers per triangle), in mm.
 */
(function (PP) {
  'use strict';

  /** Parse an STL file (ArrayBuffer) into { tris: Float32Array, count }. */
  function parse(buffer) {
    const bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    // binary if the declared triangle count matches the file size (ASCII files can also start with "solid")
    if (bytes.length >= 84) {
      const n = dv.getUint32(80, true);
      if (84 + n * 50 === bytes.length) {
        const tris = new Float32Array(n * 9);
        for (let i = 0; i < n; i++) {
          const o = 84 + i * 50 + 12;
          for (let k = 0; k < 9; k++) tris[i * 9 + k] = dv.getFloat32(o + k * 4, true);
        }
        return { tris, count: n };
      }
    }
    const text = new TextDecoder().decode(bytes);
    if (!/^\s*solid/i.test(text)) throw new Error('Not an STL file.');
    const nums = [];
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m;
    while ((m = re.exec(text))) nums.push(+m[1], +m[2], +m[3]);
    if (!nums.length || nums.length % 9) throw new Error('Could not read the triangles of this STL file.');
    return { tris: new Float32Array(nums), count: nums.length / 9 };
  }

  /** Write triangles as a binary STL (ArrayBuffer). Normals are computed from the winding. */
  function write(tris, header = 'PenPlot Studio') {
    const n = tris.length / 9;
    const buf = new ArrayBuffer(84 + n * 50);
    const dv = new DataView(buf);
    const head = new TextEncoder().encode(String(header).slice(0, 79));
    new Uint8Array(buf, 0, head.length).set(head);
    dv.setUint32(80, n, true);
    for (let i = 0; i < n; i++) {
      const t = i * 9, o = 84 + i * 50;
      const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
      const vx = tris[t + 6] - tris[t], vy = tris[t + 7] - tris[t + 1], vz = tris[t + 8] - tris[t + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1;
      nx /= L; ny /= L; nz /= L;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      for (let k = 0; k < 9; k++) dv.setFloat32(o + 12 + k * 4, tris[t + k], true);
    }
    return buf;
  }

  PP.STL = { parse, write };
})(window.PP = window.PP || {});
