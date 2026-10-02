// Removable-drive listing (desktop/drives.js) from sample lsblk and PowerShell output.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { parseLsblk, parseWinDisks } = createRequire(import.meta.url)('../../desktop/drives.js');

describe('removable drives', () => {
  it('lists user-mounted removable volumes from lsblk (new and old output styles)', () => {
    const json = JSON.stringify({
      blockdevices: [
        {
          path: '/dev/nvme0n1',
          type: 'disk',
          rm: false,
          hotplug: false,
          mountpoint: null,
          size: 512e9,
          children: [
            {
              path: '/dev/nvme0n1p2',
              type: 'part',
              rm: false,
              hotplug: false,
              mountpoint: '/',
              size: 5e11,
              fsavail: 1e11,
            },
          ],
        },
        {
          path: '/dev/sda',
          type: 'disk',
          rm: true,
          hotplug: true,
          mountpoint: null,
          size: 31914983424,
          children: [
            {
              path: '/dev/sda1',
              type: 'part',
              rm: true,
              hotplug: true,
              mountpoint: '/media/jm/BAMBU',
              label: 'BAMBU',
              size: 31910789120,
              fsavail: 3e10,
            },
          ],
        },
        // older lsblk: strings for flags and numbers; unpartitioned card mounted under /run/media
        {
          path: '/dev/sdb',
          type: 'disk',
          rm: '1',
          hotplug: '1',
          mountpoint: '/run/media/jm/3A2B-1C0D',
          size: '8000000000',
          fsavail: '7000000000',
        },
        // hot-pluggable but mounted by fstab elsewhere: not offered
        {
          path: '/dev/sdc',
          type: 'disk',
          rm: false,
          hotplug: true,
          children: [{ path: '/dev/sdc1', type: 'part', mountpoint: '/mnt/backup' }],
        },
        // newer lsblk: mountpoints array
        {
          path: '/dev/sdd',
          type: 'disk',
          rm: true,
          children: [{ path: '/dev/sdd1', type: 'part', mountpoints: [null, '/media/jm/USB'], label: 'USB' }],
        },
      ],
    });
    const list = parseLsblk(json);
    expect(list.map((d) => [d.id, d.label, d.root, d.disk])).toEqual([
      ['/dev/sda1', 'BAMBU', '/media/jm/BAMBU', '/dev/sda'],
      ['/dev/sdb', '3A2B-1C0D', '/run/media/jm/3A2B-1C0D', '/dev/sdb'],
      ['/dev/sdd1', 'USB', '/media/jm/USB', '/dev/sdd'],
    ]);
    expect(list[0].free).toBe(3e10);
    expect(list[1].size).toBe(8e9);
  });

  it('lists Windows removable volumes with media in them', () => {
    expect(parseWinDisks('')).toEqual([]);
    const one = parseWinDisks('{"DeviceID":"e:","VolumeName":"BAMBU","Size":31910789120,"FreeSpace":30000000000}');
    expect(one).toEqual([{ id: 'E:', label: 'BAMBU (E:)', root: 'E:\\', device: 'E:', size: 31910789120, free: 3e10 }]);
    const many = parseWinDisks(
      '[{"DeviceID":"F:","VolumeName":"","Size":8000000000,"FreeSpace":1},{"DeviceID":"G:","VolumeName":null,"Size":null,"FreeSpace":null}]',
    );
    expect(many.map((d) => d.label)).toEqual(['Removable drive (F:)']); // G: is an empty card reader
  });
});
