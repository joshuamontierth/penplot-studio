'use strict';

// The bridge from the page to the desktop shell: saving with native dialogs (saveFiles in main.js), removable
// drives (drives.js) and projects opened from the file manager. The page still has no Node access; it hands over
// file names and contents, and drive ids from the listing.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ppDesktop', {
  /** files: [{ name, data: string | ArrayBuffer | Uint8Array }] → { saved: [paths], dir } or { canceled: true } */
  saveFiles: (files, opts) => ipcRenderer.invoke('pp:save-files', files, opts || {}),
  /** → [{ id, label, root, size, free }] removable drives with a mounted volume */
  drives: () => ipcRenderer.invoke('pp:drives'),
  saveToDrive: (id, files) => ipcRenderer.invoke('pp:save-to-drive', id, files),
  eject: (id) => ipcRenderer.invoke('pp:eject', id),
  /** the project file the app was opened with, once ({ name, data }), then any opened later */
  takeOpenFile: () => ipcRenderer.invoke('pp:take-open-file'),
  onOpenFile: (cb) => ipcRenderer.on('pp:open-file', (_e, f) => cb(f)),
});
