/*
 * PenPlot Studio - "Save to removable drive" (desktop app on Linux and Windows): a bar that lists the SD cards and
 * USB drives the desktop shell finds (desktop/drives.js), saves G-code to the root of the chosen one and ejects
 * it, like Cura. In a browser there is no bar (UI.driveBar returns null).
 */
(function (PP) {
  'use strict';

  const U = PP.U, h = U.h;
  const UI = PP.UI;
  const POLL_MS = 3000;
  const desk = () => (window.ppDesktop && window.ppDesktop.drives ? window.ppDesktop : null);

  /** Bar with the drive picker and Eject; null outside the desktop app. Call stop() when its dialog closes. */
  UI.driveBar = function () {
    const D = desk();
    if (!D) return null;
    let list = [], sel = PP.Storage.getLocal('drive', null), timer = null, busy = false;
    const listeners = [];
    const select = h('select', { 'aria-label': 'Removable drive' });
    const ejectB = UI.btn('Eject', () => eject(), { small: true, icon: 'eject', title: 'Eject the drive so it can be removed safely' });
    const none = h('span', { class: 'hint' }, 'No SD card or USB drive');
    const el = h('div', { class: 'drive-bar' }, UI.icon('sd', 16), select, ejectB, none);
    select.addEventListener('change', () => { sel = select.value; PP.Storage.setLocal('drive', sel); render(); });

    const free = (d) => (d.free != null ? ' · ' + U.fmt(d.free / 1e9, 1) + ' GB free' : '');
    const current = () => list.find(d => d.id === sel) || null;
    let lastKey = '', lastSel;
    function emit() { for (const fn of listeners) fn(current()); }
    function render() {
      if (!list.some(d => d.id === sel)) sel = list.length ? list[0].id : null;
      const key = JSON.stringify(list.map(d => [d.id, d.label, d.free]));
      if (key !== lastKey) {
        lastKey = key;
        U.clear(select);
        for (const d of list) select.appendChild(h('option', { value: d.id }, d.label + free(d)));
        select.hidden = ejectB.hidden = !list.length;
        none.hidden = !!list.length;
      }
      if (sel) select.value = sel;
      if (sel !== lastSel) { lastSel = sel; emit(); }
    }
    async function refresh() {
      if (busy) return;
      try { list = await D.drives(); } catch (e) { list = []; }
      render();
    }
    async function eject() {
      const d = current();
      if (!d) return;
      busy = true;
      ejectB.disabled = true;
      try {
        await D.eject(d.id);
        UI.toast(d.label + ' can be removed now.', 'info', 5000);
      } catch (e) {
        UI.toast(e.message, 'error', 6000);
      } finally {
        busy = false;
        ejectB.disabled = false;
        refresh();
      }
    }
    refresh();
    timer = setInterval(refresh, POLL_MS);
    render();
    return {
      el,
      drive: current,
      onChange(fn) { listeners.push(fn); fn(current()); },
      stop() { clearInterval(timer); },
      /** Save [{ name, data }] to the root of the chosen drive; true when written. */
      async save(files) {
        const d = current();
        if (!d) return false;
        try {
          await D.saveToDrive(d.id, files);
          UI.toast('Saved ' + (files.length === 1 ? files[0].name : files.length + ' files') + ' to ' + d.label + '. Eject it before you take it out.', 'info', 6000);
          refresh();
          return true;
        } catch (e) {
          UI.toast('Could not save to ' + d.label + ': ' + e.message, 'error', 6000);
          return false;
        }
      },
    };
  };
})(window.PP = window.PP || {});
