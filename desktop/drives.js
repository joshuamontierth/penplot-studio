'use strict';

// Removable drives (SD cards, USB sticks) for "Save to removable drive", like Cura: list them, write files to the
// root, eject. Linux: lsblk lists, udisksctl (udisks2, standard on desktop distros) unmounts and powers off.
// Windows: PowerShell lists removable volumes (CIM) and ejects with DeviceIoControl (lock, dismount, eject - the
// sequence Cura uses), no admin rights needed. The parsers are plain functions so the unit tests can feed them
// sample output.

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 << 20 }, (err, stdout, stderr) => {
      if (err) {
        err.message = (String(stderr || '').trim() || err.message).split('\n')[0];
        reject(err);
      } else resolve(String(stdout));
    });
  });
}

const truthy = (v) => v === true || v === 1 || v === '1';
const num = (v) => (v == null || v === '' ? null : Number(v));

/** lsblk -J output -> mounted removable volumes (user-mounted under /media or /run/media, like Cura). */
function parseLsblk(text) {
  const out = [];
  const walk = (dev, removable, disk) => {
    const rm = removable || truthy(dev.rm) || truthy(dev.hotplug);
    const diskPath = dev.type === 'disk' ? dev.path : disk;
    const mounts = (dev.mountpoints || [dev.mountpoint]).filter(Boolean);
    const root = mounts.find((m) => /^\/(media|run\/media)\//.test(m));
    if (rm && root && (dev.type === 'part' || dev.type === 'disk')) {
      out.push({
        id: dev.path,
        label: dev.label || path.posix.basename(root),
        root,
        device: dev.path,
        disk: diskPath,
        size: num(dev.size),
        free: num(dev.fsavail),
      });
    }
    for (const c of dev.children || []) walk(c, rm, diskPath);
  };
  for (const d of JSON.parse(text).blockdevices || []) walk(d, false, null);
  return out;
}

/** Win32_LogicalDisk (DriveType 2) as JSON -> volumes with media in them. */
function parseWinDisks(text) {
  if (!String(text).trim()) return [];
  let list = JSON.parse(text);
  if (!Array.isArray(list)) list = [list];
  return list
    .filter((d) => d && /^[A-Z]:$/i.test(d.DeviceID) && d.Size)
    .map((d) => ({
      id: d.DeviceID.toUpperCase(),
      label: (d.VolumeName || 'Removable drive') + ' (' + d.DeviceID.toUpperCase() + ')',
      root: d.DeviceID.toUpperCase() + '\\',
      device: d.DeviceID.toUpperCase(),
      size: num(d.Size),
      free: num(d.FreeSpace),
    }));
}

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'];
const ps = (script) => run('powershell.exe', [...PS, Buffer.from(script, 'utf16le').toString('base64')]);

const WIN_LIST =
  "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress";

// Lock (retries while Explorer lets go), dismount, allow removal, eject. "busy" = a file on it is still open.
const WIN_EJECT = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class PPEject {
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr sa, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool DeviceIoControl(IntPtr h, uint code, byte[] inBuf, uint inSize, IntPtr outBuf, uint outSize, out uint returned, IntPtr overlapped);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr h);
  const uint LOCK = 0x90018, DISMOUNT = 0x90020, MEDIA_REMOVAL = 0x2D4804, EJECT = 0x2D4808;
  static bool Io(IntPtr h, uint code, byte[] buf) {
    uint r;
    return DeviceIoControl(h, code, buf, buf == null ? 0u : (uint)buf.Length, IntPtr.Zero, 0, out r, IntPtr.Zero);
  }
  public static string Eject(string drive) {
    IntPtr h = CreateFile("\\\\.\\" + drive, 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
    if (h == new IntPtr(-1)) return "open " + Marshal.GetLastWin32Error();
    try {
      bool locked = false;
      for (int i = 0; i < 20 && !locked; i++) { locked = Io(h, LOCK, null); if (!locked) Thread.Sleep(250); }
      if (!locked) return "busy";
      if (!Io(h, DISMOUNT, null)) return "dismount " + Marshal.GetLastWin32Error();
      Io(h, MEDIA_REMOVAL, new byte[] { 0 });
      Io(h, EJECT, null);
      return "ok";
    } finally { CloseHandle(h); }
  }
}`;

let listing = null;
/** The removable volumes right now. One listing at a time (the page polls). */
function list() {
  if (!listing) {
    const p =
      process.platform === 'win32'
        ? ps(WIN_LIST).then(parseWinDisks)
        : process.platform === 'linux'
          ? run('lsblk', ['-J', '-b', '-o', 'PATH,TYPE,RM,HOTPLUG,MOUNTPOINT,LABEL,SIZE,FSAVAIL']).then(parseLsblk)
          : Promise.resolve([]);
    listing = p.finally(() => (listing = null));
  }
  return listing;
}

async function find(id) {
  const d = (await list()).find((x) => x.id === id);
  if (!d) throw new Error('The drive is no longer connected.');
  return d;
}

/** Write [{ name (already safe), data }] to the root of drive `id`, flushed to the card. */
async function save(id, items) {
  const d = await find(id);
  const bytes = items.reduce((s, it) => s + Buffer.byteLength(it.data), 0);
  if (d.free != null && bytes > d.free) throw new Error('Not enough free space on ' + d.label + '.');
  const saved = [];
  for (const it of items) {
    const file = path.join(d.root, it.name);
    const fh = await fs.open(file, 'w');
    try {
      await fh.writeFile(it.data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    saved.push(file);
  }
  return { saved, drive: d };
}

/** Unmount and eject drive `id`; resolves once it is safe to pull out. */
async function eject(id) {
  const d = await find(id);
  if (process.platform === 'win32') {
    if (!/^[A-Z]:$/.test(d.device)) throw new Error('Unexpected drive ' + d.device);
    const r = (await ps(`Add-Type -TypeDefinition @'\n${WIN_EJECT}\n'@\n[PPEject]::Eject('${d.device}')`)).trim();
    if (r === 'busy') throw new Error(d.label + ' is in use - close any file or window open on it, then try again.');
    if (r !== 'ok') throw new Error('Windows could not eject ' + d.label + ' (' + r + ').');
    return { ejected: d.label };
  }
  try {
    await run('udisksctl', ['unmount', '--no-user-interaction', '-b', d.device]);
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error('Could not unmount ' + d.label + ': ' + e.message, { cause: e });
    await run('gio', ['mount', '-e', d.root]); // no udisks2: let GVfs do it
    return { ejected: d.label };
  }
  if (d.disk) await run('udisksctl', ['power-off', '--no-user-interaction', '-b', d.disk]).catch(() => {});
  return { ejected: d.label };
}

module.exports = { list, save, eject, parseLsblk, parseWinDisks };
