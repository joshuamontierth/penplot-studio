// .penplot project files: the project JSON, gzipped; plain JSON still opens.
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

describe('.penplot files', () => {
  const U = window.PP.U;
  it('are the project JSON gzipped, and plain JSON still opens', async () => {
    const text = JSON.stringify({ name: 'Test', objects: [1, 2, 3] });
    const gz = await U.gzip(text);
    expect([gz[0], gz[1]]).toEqual([0x1f, 0x8b]);
    expect(gunzipSync(gz).toString()).toBe(text);
    expect(await U.gunzipText(gz.buffer)).toBe(text);
    expect(await U.gunzipText(new TextEncoder().encode(text).buffer)).toBe(text);
  });
});
