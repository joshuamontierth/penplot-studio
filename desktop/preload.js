'use strict';

// The one bridge from the page to the desktop shell: saving files with native dialogs (see saveFiles in main.js).
// The page still has no Node access; it can only hand over file names and contents.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ppDesktop', {
  /** files: [{ name, data: string | ArrayBuffer | Uint8Array }] → { saved: [paths], dir } or { canceled: true } */
  saveFiles: (files, opts) => ipcRenderer.invoke('pp:save-files', files, opts || {}),
});
