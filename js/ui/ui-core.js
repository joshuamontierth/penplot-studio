/* PenPlot Studio - UI building blocks: icons, toasts, modals, form controls. */
(function (PP) {
  'use strict';

  const U = PP.U, h = U.h;

  // ---------------------------------------------------------------------------
  // Icons (24x24, stroke based)
  // ---------------------------------------------------------------------------
  const ICONS = {
    select: '<path d="M5 3l14 8-6 1.8L10 19z"/><path d="M13 13l5 6"/>',
    pan: '<path d="M8 13V5.5a1.5 1.5 0 013 0V12"/><path d="M11 11.5V4.5a1.5 1.5 0 013 0V12"/><path d="M14 11.5v-6a1.5 1.5 0 013 0V14"/><path d="M8 13l-1.6-1.7a1.6 1.6 0 00-2.4 2.1L8 19a5 5 0 004 2h1a5 5 0 005-5v-2"/>',
    pen: '<path d="M4 20l1-5L16.5 3.5a2.1 2.1 0 013 3L8 18z"/><path d="M14.5 5.5l3 3"/>',
    line: '<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6"/><circle cx="19" cy="5" r="1.6"/>',
    polyline: '<path d="M3 18l5-9 5 6 4-10 4 4"/>',
    curve: '<path d="M3 19C6 5 12 5 12 12s6 7 9-7"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
    polygon: '<path d="M12 3l8 5v8l-8 5-8-5V8z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    text: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
    eraser: '<path d="M7 21h10"/><path d="M5.5 14.5l8-8a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L13 19H9z"/><path d="M9.5 10.5l5 5"/>',
    new: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/><path d="M12 12v6M9 15h6"/>',
    open: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
    save: '<path d="M5 3h11l5 5v11a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z"/><path d="M7 3v5h8"/><rect x="7" y="13" width="10" height="8"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 015.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    play: '<path d="M7 4l13 8-13 8z"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    stepf: '<path d="M5 4l10 8-10 8z"/><path d="M19 5v14"/>',
    stepb: '<path d="M19 20L9 12l10-8z"/><path d="M5 19V5"/>',
    download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
    upload: '<path d="M12 21V9"/><path d="M7 14l5-5 5 5"/><path d="M5 3h14"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4"/><path d="M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
    unlock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 017.5-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"/><path d="M9 7V4h6v3"/>',
    up: '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>',
    down: '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
    fliph: '<path d="M12 3v18"/><path d="M8 7L3 12l5 5z"/><path d="M16 7l5 5-5 5z"/>',
    flipv: '<path d="M3 12h18"/><path d="M7 8l5-5 5 5z"/><path d="M7 16l5 5 5-5z"/>',
    rotate: '<path d="M20 11a8 8 0 10-2.3 6.6"/><path d="M20 4v7h-7"/>',
    zoomin: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/><path d="M11 8v6M8 11h6"/>',
    zoomout: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/><path d="M8 11h6"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    wand: '<path d="M15 4V2M15 10V8M11 6h2M17 6h2"/><path d="M3 21l12-12"/>',
    paths: '<path d="M4 18c4-10 6 2 10-8s4 4 6 0"/>',
    center: '<circle cx="12" cy="12" r="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    check: '<path d="M5 12l5 5L20 7"/>',
    warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    hand: '<path d="M4 19c3-1 4-4 5-8s3-6 5-5-1 5 0 7 4 0 5 2-2 5-6 6"/>',
    grid: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12h16M12 4v16"/>',
    printer: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
    combine: '<rect x="3" y="3" width="11" height="11" rx="1"/><rect x="10" y="10" width="11" height="11" rx="1"/>',
    fill: '<path d="M4 20L20 4M4 14L14 4M10 20L20 10M4 8l4-4M16 20l4-4"/>',
  };

  function icon(name, size = 18) {
    const span = document.createElement('span');
    span.className = 'ico';
    span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
    return span;
  }

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------
  let toastHost = null;
  function toast(msg, type = 'info', ms = 3800) {
    if (!toastHost) { toastHost = h('div', { class: 'toasts' }); document.body.appendChild(toastHost); }
    const t = h('div', { class: 'toast toast-' + type }, icon(type === 'error' || type === 'warn' ? 'warn' : 'check', 16), h('span', null, msg));
    toastHost.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
  }

  // ---------------------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------------------
  const openModals = [];
  function modal({ title, body, footer, wide, width, onClose, className }) {
    const box = h('div', { class: 'modal' + (wide ? ' modal-wide' : '') + (className ? ' ' + className : ''), role: 'dialog', 'aria-modal': 'true' });
    if (width) box.style.width = width;
    const closeBtn = h('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: () => close() }, icon('close'));
    const head = h('div', { class: 'modal-head' }, h('h2', null, title), closeBtn);
    const bodyEl = h('div', { class: 'modal-body' });
    const footEl = h('div', { class: 'modal-foot' });
    if (body) bodyEl.appendChild(body);
    if (footer) (Array.isArray(footer) ? footer : [footer]).forEach(f => f && footEl.appendChild(f));
    box.append(head, bodyEl);
    if (footer) box.appendChild(footEl);
    const back = h('div', { class: 'modal-back' }, box);
    back.addEventListener('mousedown', (e) => { if (e.target === back) back._downOnBack = true; });
    back.addEventListener('mouseup', (e) => { if (e.target === back && back._downOnBack) close(); back._downOnBack = false; });
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    const api = { el: box, body: bodyEl, foot: footEl, close, setTitle: (t) => { head.querySelector('h2').textContent = t; } };
    openModals.push(api);
    function close() {
      const i = openModals.indexOf(api);
      if (i < 0) return;
      openModals.splice(i, 1);
      back.classList.remove('show');
      setTimeout(() => back.remove(), 160);
      if (onClose) onClose();
    }
    return api;
  }
  function closeTopModal() { const m = openModals[openModals.length - 1]; if (m) { m.close(); return true; } return false; }
  const hasModal = () => openModals.length > 0;

  function confirmDialog(title, message, okLabel = 'OK', danger = false) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; m.close(); resolve(v); };
      const m = modal({
        title,
        body: h('p', { class: 'muted', style: { margin: 0, lineHeight: 1.5 } }, message),
        footer: [
          h('button', { class: 'btn', onclick: () => finish(false) }, 'Cancel'),
          h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), onclick: () => finish(true) }, okLabel),
        ],
        onClose: () => { if (!done) { done = true; resolve(false); } },
        width: '420px',
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Form controls
  // ---------------------------------------------------------------------------
  /** Labeled number input with optional slider. */
  /** allowEmpty: an emptied field emits onChange(null) (e.g. "use the default") instead of reverting. */
  function numberField({ label, value, min, max, step = 1, unit, slider = false, onInput, onChange, title, decimals, allowEmpty = false }) {
    let current = value; // last committed value: an invalid entry reverts to this, not to the initial value
    const fmtV = (v) => decimals !== undefined ? U.fmt(v, decimals) : String(v);
    const num = h('input', { type: 'number', class: 'num', value: fmtV(value), min, max, step, title });
    const wrap = h('div', { class: 'field' + (slider ? ' field-slider' : '') });
    const lab = h('label', null, label, unit ? h('span', { class: 'unit' }, unit) : null);
    wrap.appendChild(lab);
    let range = null;
    const parse = (v) => { let x = parseFloat(v); if (!isFinite(x)) return null; return x; };
    const emit = (v, final) => {
      if (v === null) return;
      if (onInput && !final) onInput(v);
      if (final && onChange) onChange(v);
    };
    if (slider) {
      range = h('input', { type: 'range', min, max, step, value });
      range.addEventListener('input', () => { num.value = fmtV(parseFloat(range.value)); emit(parseFloat(range.value), false); });
      range.addEventListener('change', () => emit(parseFloat(range.value), true));
      wrap.appendChild(h('div', { class: 'slider-row' }, range, num));
    } else wrap.appendChild(num);
    num.addEventListener('input', () => { const v = parse(num.value); if (v !== null && range) range.value = v; emit(v, false); });
    num.addEventListener('change', () => {
      let v = parse(num.value);
      if (v === null && allowEmpty && num.value.trim() === '') { current = ''; if (onChange) onChange(null); return; }
      if (v === null) { num.value = fmtV(current); return; }
      if (min !== undefined && v < min) v = min;
      if (max !== undefined && v > max) v = max;
      num.value = fmtV(v);
      if (range) range.value = v;
      current = v;
      emit(v, true);
    });
    num.addEventListener('keydown', (e) => { if (e.key === 'Enter') num.blur(); e.stopPropagation(); });
    wrap.setValue = (v) => { current = v; if (document.activeElement !== num) num.value = fmtV(v); if (range) range.value = v; };
    wrap.input = num;
    return wrap;
  }

  function selectField({ label, value, options, onChange, title }) {
    const sel = h('select', { title });
    const addOpts = (parent, opts) => {
      for (const o of opts) {
        if (o.group) {
          const g = h('optgroup', { label: o.group });
          addOpts(g, o.options);
          parent.appendChild(g);
        } else parent.appendChild(h('option', { value: o.value }, o.label));
      }
    };
    addOpts(sel, options);
    sel.value = value;
    sel.addEventListener('change', () => onChange && onChange(sel.value));
    const wrap = h('div', { class: 'field' }, label ? h('label', null, label) : null, sel);
    wrap.setValue = (v) => { sel.value = v; };
    wrap.select = sel;
    return wrap;
  }

  function checkField({ label, value, onChange, title }) {
    const cb = h('input', { type: 'checkbox', checked: !!value });
    cb.addEventListener('change', () => onChange && onChange(cb.checked));
    const wrap = h('label', { class: 'check', title }, cb, h('span', null, label));
    wrap.setValue = (v) => { cb.checked = !!v; };
    wrap.input = cb;
    return wrap;
  }

  function segmented({ options, value, onChange }) {
    const wrap = h('div', { class: 'seg' });
    const btns = options.map(o => {
      const b = h('button', { class: 'seg-btn' + (o.value === value ? ' on' : ''), title: o.title || o.label, onclick: () => { set(o.value); onChange && onChange(o.value); } }, o.icon ? icon(o.icon, 16) : null, o.icon && !o.showLabel ? null : o.label);
      b.dataset.value = o.value;
      return b;
    });
    btns.forEach(b => wrap.appendChild(b));
    function set(v) { btns.forEach(b => b.classList.toggle('on', b.dataset.value === String(v))); }
    wrap.setValue = set;
    return wrap;
  }

  /**
   * Generic parameter form for pattern generators / image trace modes.
   * params: [{key,label,type:'range'|'int'|'select'|'checkbox'|'seed',min,max,step,default,options}]
   */
  function paramForm(params, values, onChange) {
    const wrap = h('div', { class: 'param-form' });
    const fields = {};
    for (const p of params) {
      const v = values[p.key] !== undefined ? values[p.key] : p.default;
      let f;
      if (p.type === 'select') {
        f = selectField({ label: p.label, value: v, options: p.options.map(o => ({ value: o.value, label: o.label })), onChange: (x) => onChange(p.key, x, true) });
      } else if (p.type === 'checkbox') {
        f = checkField({ label: p.label, value: v, onChange: (x) => onChange(p.key, x, true) });
      } else if (p.type === 'seed') {
        f = numberField({ label: p.label, value: v, min: p.min || 0, max: p.max || 99999, step: 1, onChange: (x) => onChange(p.key, Math.round(x), true) });
        const dice = h('button', { class: 'btn btn-sm', title: 'Randomize', onclick: () => { const r = Math.floor(Math.random() * (p.max || 99999)); f.setValue(r); onChange(p.key, r, true); } }, 'Randomize');
        f.appendChild(dice);
      } else {
        const isInt = p.type === 'int';
        const step = p.step || (isInt ? 1 : ((p.max - p.min) / 100));
        const dec = isInt ? 0 : Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) + 0.001)));
        f = numberField({
          label: p.label, value: v, min: p.min, max: p.max, step, slider: true, decimals: dec,
          onInput: (x) => onChange(p.key, isInt ? Math.round(x) : x, false),
          onChange: (x) => onChange(p.key, isInt ? Math.round(x) : x, true),
        });
      }
      fields[p.key] = f;
      wrap.appendChild(f);
    }
    wrap.fields = fields;
    return wrap;
  }

  function section(title, content, opts = {}) {
    const body = h('div', { class: 'sec-body' });
    if (content) (Array.isArray(content) ? content : [content]).forEach(c => c && body.appendChild(c));
    const head = h('div', { class: 'sec-head' + (opts.collapsible ? ' collapsible' : '') }, h('span', null, title), opts.extra || null);
    const el = h('div', { class: 'sec' + (opts.collapsed ? ' collapsed' : '') }, head, body);
    if (opts.collapsible) head.addEventListener('click', (e) => { if (e.target.closest('button')) return; el.classList.toggle('collapsed'); });
    el.body = body;
    return el;
  }

  function btn(label, onclick, opts = {}) {
    return h('button', { class: 'btn' + (opts.primary ? ' btn-primary' : '') + (opts.danger ? ' btn-danger' : '') + (opts.small ? ' btn-sm' : '') + (opts.cls ? ' ' + opts.cls : ''), title: opts.title, onclick, disabled: opts.disabled }, opts.icon ? icon(opts.icon, 16) : null, label ? h('span', null, label) : null);
  }

  function iconBtn(name, title, onclick, opts = {}) {
    return h('button', { class: 'icon-btn' + (opts.cls ? ' ' + opts.cls : ''), title, onclick, 'aria-label': title }, icon(name, opts.size || 18));
  }

  PP.UI = Object.assign(PP.UI || {}, {
    icon, toast, modal, closeTopModal, hasModal, confirm: confirmDialog,
    numberField, selectField, checkField, segmented, paramForm, section, btn, iconBtn,
  });
})(window.PP = window.PP || {});
