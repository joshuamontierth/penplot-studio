'use strict';

// The bridge from the page to the desktop shell: saving with native dialogs (saveFiles in main.js) and projects
// opened from the file manager. The page still has no Node access; it can only hand over file names and contents.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ppDesktop', {
  /** files: [{ name, data: string | ArrayBuffer | Uint8Array }] → { saved: [paths], dir } or { canceled: true } */
  saveFiles: (files, opts) => ipcRenderer.invoke('pp:save-files', files, opts || {}),
  /** the project file the app was opened with, once ({ name, data }), then any opened later */
  takeOpenFile: () => ipcRenderer.invoke('pp:take-open-file'),
  onOpenFile: (cb) => ipcRenderer.on('pp:open-file', (_e, f) => cb(f)),
});
