/* PenPlot Studio - shared utilities (DOM helpers, formatting, events, files). */
(function (PP) {
  'use strict';

  let idCounter = 0;

  const U = {
    uid(prefix = 'id') {
      idCounter = (idCounter + 1) % 1e9;
      return prefix + '_' + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
    },

    clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    deg2rad(d) { return d * Math.PI / 180; },
    rad2deg(r) { return r * 180 / Math.PI; },
    isNum(v) { return typeof v === 'number' && isFinite(v); },

    /** Format a number for G-code: fixed decimals with trailing zeros stripped. */
    fmt(v, decimals = 3) {
      let s = v.toFixed(decimals);
      if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
      if (s === '-0') s = '0';
      return s;
    },

    round(v, decimals = 2) {
      const m = Math.pow(10, decimals);
      return Math.round(v * m) / m;
    },

    formatDuration(sec) {
      if (!isFinite(sec) || sec < 0) sec = 0;
      sec = Math.round(sec);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
      if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
      return s + 's';
    },

    formatLength(mm) {
      if (mm >= 1000) return (mm / 1000).toFixed(2) + ' m';
      return Math.round(mm) + ' mm';
    },

    debounce(fn, ms) {
      let t = null;
      const d = function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), ms);
      };
      d.cancel = () => clearTimeout(t);
      return d;
    },

    clone(o) {
      return (typeof structuredClone === 'function') ? structuredClone(o) : JSON.parse(JSON.stringify(o));
    },

    escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    /**
     * Tiny hyperscript DOM builder.
     * h('div', {class: 'x', onclick: fn, style: {color: 'red'}}, 'text', childNode, [more])
     */
    h(tag, attrs, ...children) {
      const el = document.createElement(tag);
      if (attrs) {
        for (const k in attrs) {
          const v = attrs[k];
          if (v === undefined || v === null || v === false) continue;
          if (k === 'class') el.className = v;
          else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
          else if (k === 'dataset') Object.assign(el.dataset, v);
          else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
          else if (k === 'html') el.innerHTML = v;
          else if (k === 'value') el.value = v;
          else if (k === 'checked') el.checked = !!v;
          else if (v === true) el.setAttribute(k, '');
          else el.setAttribute(k, v);
        }
      }
      const add = (c) => {
        if (c === null || c === undefined || c === false) return;
        if (Array.isArray(c)) { c.forEach(add); return; }
        el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
      };
      children.forEach(add);
      return el;
    },

    $(sel, root) { return (root || document).querySelector(sel); },
    $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); },

    clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; },

    downloadBlob(filename, blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },

    downloadText(filename, text, mime = 'text/plain') {
      U.downloadBlob(filename, new Blob([text], { type: mime + ';charset=utf-8' }));
    },

    /**
     * Save files the user asked for. Desktop app: one native Save dialog, or one folder dialog for several files;
     * resolves with { count, where } once they are written, or null if the user canceled. Browser: plain
     * downloads, resolves at once with where = null (the browser decides where they go).
     * files: [{ name, data: string | ArrayBuffer | Uint8Array, type }]
     */
    async saveFiles(files, opts = {}) {
      const desk = window.ppDesktop;
      if (desk && desk.saveFiles) {
        const r = await desk.saveFiles(files.map(f => ({ name: f.name, data: f.data })), { title: opts.title });
        return r && !r.canceled && r.saved && r.saved.length ? { count: r.saved.length, where: r.dir } : null;
      }
      for (const f of files) {
        const type = (f.type || 'application/octet-stream') + (typeof f.data === 'string' ? ';charset=utf-8' : '');
        U.downloadBlob(f.name, new Blob([f.data], { type }));
      }
      return { count: files.length, where: null };
    },

    /** " to <folder>" when the desktop app reported where saveFiles put the files, else "". */
    savedTo(r) {
      return r && r.where ? ' to ' + r.where : '';
    },

    readFile(file, as = 'text') {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        if (as === 'text') r.readAsText(file);
        else if (as === 'dataurl') r.readAsDataURL(file);
        else r.readAsArrayBuffer(file);
      });
    },

    /** Open a native file picker and resolve with the chosen File (or null). */
    pickFile(accept) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        if (accept) input.accept = accept;
        input.style.display = 'none';
        document.body.appendChild(input);
        input.addEventListener('change', () => {
          const f = input.files && input.files[0];
          input.remove();
          resolve(f || null);
        });
        input.addEventListener('cancel', () => { input.remove(); resolve(null); });
        input.click();
      });
    },

    loadImage(src) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Could not load image'));
        img.src = src;
      });
    },

    loadScript(src) {
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(s);
      });
    },

    safeFilename(name, fallback = 'plot') {
      // ASCII only (the printer's SD card file list), but accents are kept as their base letter: "héllo" -> "hello"
      const s = String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
      return (s || fallback).slice(0, 60);
    },

    /** Deterministic PRNG. */
    mulberry32(seed) {
      let a = seed >>> 0;
      return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
  };

  /** Minimal event emitter. */
  class Emitter {
    constructor() { this._h = {}; }
    on(evt, fn) { (this._h[evt] = this._h[evt] || []).push(fn); return () => this.off(evt, fn); }
    off(evt, fn) { const a = this._h[evt]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
    emit(evt, ...args) { const a = this._h[evt]; if (a) a.slice().forEach(fn => { try { fn(...args); } catch (e) { console.error(e); } }); }
  }
  U.Emitter = Emitter;

  PP.U = U;
})(window.PP = window.PP || {});
