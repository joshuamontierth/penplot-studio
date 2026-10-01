/*
 * PenPlot Studio - bed canvas: rendering, navigation, selection and drawing tools.
 * World units are millimetres in PEN coordinates, Y up, origin = front-left of the bed.
 */
(function (PP) {
  'use strict';

  const U = PP.U, G = PP.Geo, S = PP.Store, OBJ = PP.Objects;

  /** Point strictly inside a convex quad given in either winding order. */
  function insideQuad(q, x, y) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4];
      const c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
      if (Math.abs(c) < 1e-9) return false;
      if (sign && Math.sign(c) !== sign) return false;
      sign = Math.sign(c);
    }
    return true;
  }

  const C = {
    bg: '#e7e8eb',
    bed: '#d9dee5',
    bedEdge: '#9aa3ad',
    gridMinor: 'rgba(40,52,70,0.07)',
    gridMajor: 'rgba(40,52,70,0.16)',
    blocked: 'rgba(225, 45, 45, 0.06)',
    blockedStripe: 'rgba(225, 45, 45, 0.16)',
    paper: '#ffffff',
    paperEdge: 'rgba(0,0,0,0.18)',
    reach: '#2f5bd2',
    sel: '#2f5bd2',
    selFill: 'rgba(47,91,210,0.05)',
    out: '#e11d48',
    label: '#8b95a3',
    travel: 'rgba(245, 158, 11, 0.55)',
  };

  /** Canvas colors that follow the UI theme (CSS custom properties; light/dark follow the OS). */
  function themeColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name, def) => cs.getPropertyValue(name).trim() || def;
    C.bg = v('--canvas', C.bg);
    C.sel = v('--canvas-accent', C.sel);
    C.reach = v('--canvas-accent', C.reach);
    C.selFill = v('--canvas-sel-fill', C.selFill);
    C.label = v('--muted', C.label);
  }

  class View {
    constructor(host) {
      this.host = host;
      this.canvas = U.h('canvas', { class: 'bed-canvas', tabindex: '0' });
      themeColors();
      if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeColors(); this.invalidate(); });
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.events = new U.Emitter();
      this.zoom = 2; this.ox = 40; this.oy = 500;
      this.cw = 100; this.ch = 100; this.dpr = 1;
      this.tools = {};
      this.tool = null;
      this.toolId = null;
      this.spaceDown = false;
      this.panning = null;
      this.hoverWorld = null;
      this.preview = null; // set by PP.Preview
      this._raf = 0;
      this._fitted = false;

      new ResizeObserver(() => this.resize()).observe(host);
      this.resize();

      const cv = this.canvas;
      cv.addEventListener('pointerdown', (e) => this.onDown(e));
      cv.addEventListener('pointermove', (e) => this.onMove(e));
      cv.addEventListener('pointerup', (e) => this.onUp(e));
      cv.addEventListener('pointercancel', (e) => this.onUp(e));
      cv.addEventListener('dblclick', (e) => { if (this.tool && this.tool.dblclick) this.tool.dblclick(e, this.worldOf(e), this); });
      cv.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('pointerleave', () => { this.hoverWorld = null; this.events.emit('cursor', null); this.invalidate(); });

      S.events.on('change', () => this.invalidate());
      S.events.on('selection', () => this.invalidate());
      PP.Fonts.events.on('loaded', (id) => { OBJ.clearFontCache(id); this.invalidate(); });
    }

    get profile() { return PP.App.profile(); }
    get reach() { return PP.GCode.reachableRect(this.profile); }

    resize() {
      const r = this.host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const prevW = this.cw, prevH = this.ch;
      this.cw = Math.max(50, r.width); this.ch = Math.max(50, r.height); this.dpr = dpr;
      this.canvas.width = Math.round(this.cw * dpr);
      this.canvas.height = Math.round(this.ch * dpr);
      this.canvas.style.width = this.cw + 'px';
      this.canvas.style.height = this.ch + 'px';
      if (!this._userMoved) this.fit();
      else { this.ox += (this.cw - prevW) / 2; this.oy += (this.ch - prevH) / 2; }
      this.render();
    }

    fit() {
      this._userMoved = false;
      const p = this.profile;
      const pad = 56;
      const z = Math.min((this.cw - pad * 2) / p.bedWidth, (this.ch - pad * 2) / p.bedDepth);
      this.zoom = Math.max(0.3, z);
      this.ox = (this.cw - p.bedWidth * this.zoom) / 2;
      this.oy = (this.ch + p.bedDepth * this.zoom) / 2;
      this.invalidate();
      this.events.emit('zoom', this.zoom);
    }

    zoomBy(f, sx = this.cw / 2, sy = this.ch / 2) {
      this._userMoved = true;
      const nz = U.clamp(this.zoom * f, 0.3, 120);
      f = nz / this.zoom;
      this.ox = sx - (sx - this.ox) * f;
      this.oy = sy - (sy - this.oy) * f;
      this.zoom = nz;
      this.invalidate();
      this.events.emit('zoom', this.zoom);
    }

    toScreen(x, y) { return [this.ox + x * this.zoom, this.oy - y * this.zoom]; }
    toWorld(sx, sy) { return [(sx - this.ox) / this.zoom, (this.oy - sy) / this.zoom]; }
    screenOf(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    worldOf(e) { const s = this.screenOf(e); const w = this.toWorld(s[0], s[1]); return { x: w[0], y: w[1], sx: s[0], sy: s[1] }; }

    invalidate() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
    }

    setTool(id) {
      if (this.tool && this.tool.cancel) this.tool.cancel(this);
      this.toolId = id;
      this.tool = this.tools[id] || this.tools.select;
      this.canvas.style.cursor = this.tool.cursor || 'default';
      this.events.emit('tool', id);
      this.invalidate();
    }

    // -------------------------------------------------------------------------
    // Input
    // -------------------------------------------------------------------------
    onDown(e) {
      this.canvas.focus({ preventScroll: true });
      const w = this.worldOf(e);
      const capture = () => { try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } };
      if (e.button === 1 || e.button === 2 || (e.button === 0 && (this.spaceDown || this.toolId === 'pan'))) {
        this.panning = { sx: w.sx, sy: w.sy, ox: this.ox, oy: this.oy };
        capture();
        this.canvas.style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      if (this.preview && this.preview.active) return;
      capture();
      if (this.tool && this.tool.down) this.tool.down(e, w, this);
      this.invalidate();
    }

    onMove(e) {
      const w = this.worldOf(e);
      this.hoverWorld = w;
      this.events.emit('cursor', w);
      if (this.panning) {
        this._userMoved = true;
        this.ox = this.panning.ox + (w.sx - this.panning.sx);
        this.oy = this.panning.oy + (w.sy - this.panning.sy);
        this.invalidate();
        return;
      }
      if (this.preview && this.preview.active) return;
      if (this.tool && this.tool.move) this.tool.move(e, w, this);
      this.invalidate();
    }

    onUp(e) {
      const w = this.worldOf(e);
      if (this.panning) {
        this.panning = null;
        this.canvas.style.cursor = (this.spaceDown || this.toolId === 'pan') ? 'grab' : (this.tool.cursor || 'default');
        return;
      }
      if (this.preview && this.preview.active) return;
      if (this.tool && this.tool.up) this.tool.up(e, w, this);
      this.invalidate();
    }

    onWheel(e) {
      e.preventDefault();
      const s = this.screenOf(e);
      if (e.ctrlKey || !e.shiftKey) {
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 30;
        const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
        this.zoomBy(f, s[0], s[1]);
      } else {
        this._userMoved = true;
        this.ox -= e.deltaY; this.invalidate();
      }
    }

    // -------------------------------------------------------------------------
    // Picking
    // -------------------------------------------------------------------------
    pick(w, editableOnly = true) {
      const tol = 6 / this.zoom;
      const layers = S.project.layers;
      const objs = S.project.objects;
      for (let li = layers.length - 1; li >= 0; li--) {
        const L = layers[li];
        if (!L.visible) continue;
        for (let i = objs.length - 1; i >= 0; i--) {
          const o = objs[i];
          if (o.layerId !== L.id) continue;
          if (editableOnly && !S.isEditable(o)) continue;
          if (OBJ.hit(o, w.x, w.y, tol)) return o;
        }
      }
      return null;
    }

    /** Selection frame: {type:'single', obj, pts (8 handles), rot, center} or {type:'multi', bbox} */
    selectionFrame() {
      const sel = S.selected();
      if (!sel.length) return null;
      if (sel.length === 1) {
        const o = sel[0];
        const b = OBJ.local(o).bbox;
        if (!b) return null;
        const m = OBJ.matrix(o);
        const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
        const hw = (b.maxX - b.minX) / 2, hh = (b.maxY - b.minY) / 2;
        const handles = [];
        for (const [hx, hy] of [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]]) {
          // no edge handles across a zero-thickness axis (a straight line): both would sit on its midpoint
          if ((hx === 0 && hh < 1e-9) || (hy === 0 && hw < 1e-9)) continue;
          const wpt = G.apply(m, cx + hx * hw, cy + hy * hh);
          handles.push({ kind: 'scale', hx, hy, w: wpt, s: this.toScreen(wpt[0], wpt[1]) });
        }
        const top = G.apply(m, cx, cy + hh);
        const topS = this.toScreen(top[0], top[1]);
        const cen = G.apply(m, cx, cy);
        const cenS = this.toScreen(cen[0], cen[1]);
        let dx = topS[0] - cenS[0], dy = topS[1] - cenS[1];
        const len = Math.hypot(dx, dy) || 1;
        dx /= len; dy /= len;
        if (len < 2) { dx = 0; dy = -1; }
        handles.push({ kind: 'rotate', s: [topS[0] + dx * 26, topS[1] + dy * 26], base: topS });
        const corners = [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]].map(p => G.apply(m, p[0], p[1]));
        return { type: 'single', obj: o, local: { cx, cy, hw, hh }, handles, corners, center: cen };
      }
      let bb = null;
      for (const o of sel) bb = G.bboxUnion(bb, OBJ.world(o).bbox);
      if (!bb) return null;
      const handles = [];
      for (const [hx, hy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const wpt = [hx < 0 ? bb.minX : bb.maxX, hy < 0 ? bb.minY : bb.maxY];
        handles.push({ kind: 'scale', hx, hy, w: wpt, s: this.toScreen(wpt[0], wpt[1]) });
      }
      const topS = this.toScreen((bb.minX + bb.maxX) / 2, bb.maxY);
      handles.push({ kind: 'rotate', s: [topS[0], topS[1] - 26], base: topS });
      const corners = [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY]];
      return { type: 'multi', bbox: bb, handles, corners, center: [(bb.minX + bb.maxX) / 2, (bb.minY + bb.maxY) / 2] };
    }

    hitHandle(sx, sy) {
      const f = this.selectionFrame();
      if (!f) return null;
      if (f.type === 'single' && !S.isEditable(f.obj)) return null;
      // Handles straddle the frame edge. On a small frame their inner halves would cover the whole body
      // (a thin line of text could only be squashed, never moved), so inside the frame the hit radius
      // shrinks to a quarter of the frame's shorter on-screen side.
      const q = f.corners.map(c => this.toScreen(c[0], c[1]));
      let radius = 7;
      if (insideQuad(q, sx, sy)) {
        const side = Math.min(Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]), Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]));
        radius = Math.min(7, side / 4);
      }
      let best = null, bestD = Infinity;
      for (const h of f.handles) {
        const d = Math.hypot(h.s[0] - sx, h.s[1] - sy);
        if (d <= (h.kind === 'rotate' ? 7 : radius) && d < bestD) { best = h; bestD = d; }
      }
      return best ? { frame: f, handle: best } : null;
    }

    // -------------------------------------------------------------------------
    // Rendering
    // -------------------------------------------------------------------------
    worldTransform(ctx) {
      const d = this.dpr, z = this.zoom;
      ctx.setTransform(d * z, 0, 0, -d * z, d * this.ox, d * this.oy);
    }
    screenTransform(ctx) { ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }

    render() {
      const ctx = this.ctx, p = this.profile, z = this.zoom;
      const W = p.bedWidth, D = p.bedDepth;
      const R = this.reach;
      const prev = this.preview && this.preview.active ? this.preview : null;

      this.screenTransform(ctx);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, this.cw, this.ch);

      // bed with shadow
      const [bx, by] = this.toScreen(0, D);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 24;
      ctx.fillStyle = C.bed;
      ctx.fillRect(bx, by, W * z, D * z);
      ctx.restore();

      this.worldTransform(ctx);
      const px = 1 / z;
      // grid
      ctx.lineWidth = px;
      if (z * 10 >= 6) {
        ctx.strokeStyle = C.gridMinor;
        ctx.beginPath();
        for (let x = 10; x < W; x += 10) if (x % 50) { ctx.moveTo(x, 0); ctx.lineTo(x, D); }
        for (let y = 10; y < D; y += 10) if (y % 50) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
        ctx.stroke();
      }
      ctx.strokeStyle = C.gridMajor;
      ctx.beginPath();
      for (let x = 50; x < W; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, D); }
      for (let y = 50; y < D; y += 50) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();

      // paper
      const pa = S.project.paper;
      if (pa.visible) {
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, D); ctx.clip();
        ctx.shadowColor = 'rgba(0,0,0,0.18)'; ctx.shadowBlur = 8 * this.dpr;
        ctx.fillStyle = C.paper;
        ctx.fillRect(pa.x, pa.y, pa.w, pa.h);
        ctx.restore();
        ctx.strokeStyle = C.paperEdge; ctx.lineWidth = px;
        ctx.strokeRect(pa.x, pa.y, pa.w, pa.h);
        if (pa.x < 0 || pa.y < 0 || pa.x + pa.w > W || pa.y + pa.h > D) {
          ctx.setLineDash([4 * px, 4 * px]);
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.strokeRect(pa.x, pa.y, pa.w, pa.h);
          ctx.setLineDash([]);
        }
      }

      // unreachable zone
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, D);
      ctx.rect(R.minX, R.minY, R.maxX - R.minX, R.maxY - R.minY);
      ctx.fillStyle = C.blocked;
      ctx.fill('evenodd');
      ctx.clip('evenodd');
      ctx.strokeStyle = C.blockedStripe;
      ctx.lineWidth = px;
      ctx.beginPath();
      const step = 14 * px; // hairlines 14 screen px apart at any zoom
      for (let t = -D; t < W + D; t += step) { ctx.moveTo(t, 0); ctx.lineTo(t + D, D); }
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.strokeStyle = C.reach; ctx.lineWidth = px;
      ctx.strokeRect(R.minX, R.minY, R.maxX - R.minX, R.maxY - R.minY);
      ctx.restore();

      // bed edge
      ctx.strokeStyle = C.bedEdge; ctx.lineWidth = px;
      ctx.strokeRect(0, 0, W, D);

      // objects
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const objs = S.project.objects;
      const layers = S.project.layers;
      ctx.globalAlpha = prev ? 0.14 : 1;
      for (const L of layers) {
        if (!L.visible) continue;
        ctx.strokeStyle = L.color;
        ctx.lineWidth = Math.max(L.penWidth || 0.5, 1.1 * px);
        for (const o of objs) {
          if (o.layerId !== L.id) continue;
          ctx.stroke(OBJ.path2d(o));
        }
      }
      ctx.globalAlpha = 1;

      // out-of-reach strokes in red
      if (!prev) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(-5000, -5000, 10000, 10000);
        ctx.rect(R.minX, R.minY, R.maxX - R.minX, R.maxY - R.minY);
        ctx.clip('evenodd');
        ctx.strokeStyle = C.out;
        for (const L of layers) {
          if (!L.visible) continue;
          ctx.lineWidth = Math.max(L.penWidth || 0.5, 1.6 * px);
          for (const o of objs) {
            if (o.layerId !== L.id) continue;
            const b = OBJ.world(o).bbox;
            if (!b || (b.minX >= R.minX && b.maxX <= R.maxX && b.minY >= R.minY && b.maxY <= R.maxY)) continue;
            ctx.stroke(OBJ.path2d(o));
          }
        }
        ctx.restore();
      }

      if (prev) prev.draw(ctx, this);

      // screen-space overlays
      this.screenTransform(ctx);
      this.drawLabels(ctx);
      if (!prev) {
        this.drawSelection(ctx);
        if (this.tool && this.tool.overlay) this.tool.overlay(ctx, this);
      } else if (prev.drawScreen) prev.drawScreen(ctx, this);
    }

    drawLabels(ctx) {
      const p = this.profile, z = this.zoom;
      ctx.fillStyle = C.label;
      ctx.font = '600 11px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const [fx, fy] = this.toScreen(p.bedWidth / 2, 0);
      ctx.fillText('▼ FRONT OF PRINTER (door side)', fx, fy + 20);
      const [bx, by] = this.toScreen(p.bedWidth / 2, p.bedDepth);
      ctx.textBaseline = 'bottom';
      ctx.fillText('▲ BACK OF PRINTER', bx, by - 8);
      // axis ticks
      ctx.font = '10px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      const tick = z >= 3 ? 25 : 50;
      for (let x = 0; x <= p.bedWidth + 0.01; x += tick) {
        const s = this.toScreen(x, 0);
        ctx.fillText(String(x), s[0], s[1] + 5);
      }
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let y = 0; y <= p.bedDepth + 0.01; y += tick) {
        const s = this.toScreen(0, y);
        ctx.fillText(String(y), s[0] - 6, s[1]);
      }
      // reach label
      const R = this.reach;
      const rs = this.toScreen(R.minX, R.maxY);
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = C.reach;
      ctx.font = '600 10px system-ui, sans-serif';
      if (z > 1) ctx.fillText('Drawable area ' + U.fmt(R.maxX - R.minX, 0) + ' × ' + U.fmt(R.maxY - R.minY, 0) + ' mm', rs[0] + 5, rs[1] + 5);
    }

    drawSelection(ctx) {
      const f = this.selectionFrame();
      if (!f) return;
      ctx.save();
      const sel = S.selected();
      // outline each selected object lightly when multiple
      if (f.type === 'multi') {
        ctx.strokeStyle = C.sel;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        for (const o of sel) {
          const cs = OBJ.corners(o).map(p => this.toScreen(p[0], p[1]));
          ctx.beginPath(); cs.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.stroke();
        }
      }
      const cs = f.corners.map(p => this.toScreen(p[0], p[1]));
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = C.sel;
      ctx.lineWidth = 1.3;
      ctx.fillStyle = C.selFill;
      ctx.beginPath(); cs.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      const editable = f.type === 'multi' || S.isEditable(f.obj);
      if (editable) {
        for (const h of f.handles) {
          if (h.kind === 'rotate') {
            ctx.beginPath(); ctx.moveTo(h.base[0], h.base[1]); ctx.lineTo(h.s[0], h.s[1]); ctx.stroke();
            ctx.beginPath(); ctx.arc(h.s[0], h.s[1], 5.5, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
          } else {
            ctx.fillStyle = '#fff';
            ctx.fillRect(h.s[0] - 4.5, h.s[1] - 4.5, 9, 9);
            ctx.strokeRect(h.s[0] - 4.5, h.s[1] - 4.5, 9, 9);
          }
        }
      } else {
        ctx.fillStyle = C.sel; ctx.font = '11px system-ui'; ctx.fillText('locked', cs[3][0], cs[3][1] - 6);
      }
      ctx.restore();
    }
  }

  // ===========================================================================
  // Tools
  // ===========================================================================
  function requireEditableLayer() {
    return PP.App.requireEditableLayer();
  }

  function snapAngle(x0, y0, x1, y1) {
    const a = Math.atan2(y1 - y0, x1 - x0);
    const sa = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
    const L = Math.hypot(x1 - x0, y1 - y0);
    return [x0 + Math.cos(sa) * L, y0 + Math.sin(sa) * L];
  }

  function strokePolyScreen(ctx, view, pts, closed) {
    if (pts.length < 2) return;
    ctx.beginPath();
    for (let j = 0; j < pts.length; j += 2) {
      const s = view.toScreen(pts[j], pts[j + 1]);
      if (j === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
    }
    if (closed) ctx.closePath();
    ctx.stroke();
  }

  function layerColor() { const L = S.activeLayer(); return L ? L.color : '#111'; }

  // ---- Select ----
  const selectTool = {
    id: 'select', cursor: 'default',
    op: null,
    down(e, w, view) {
      const hh = view.hitHandle(w.sx, w.sy);
      if (hh) { this.startTransform(hh, w, view); return; }
      let o = view.pick(w);
      // a locked object can still be clicked to select it (it won't move), so it can be unlocked again
      if (!o) { const lo = view.pick(w, false); const L = lo && S.layer(lo.layerId); if (lo && lo.locked && L && !L.locked) o = lo; }
      if (o) {
        if (e.shiftKey) { S.select(o.id, true); if (!S.isSelected(o.id)) { this.op = null; return; } }
        else if (!S.isSelected(o.id)) S.select(o.id);
        this.op = { mode: 'move', start: w, moved: false, orig: new Map(S.selected().filter(S.isEditable).map(s => [s.id, { x: s.x, y: s.y }])) };
        return;
      }
      if (!e.shiftKey) S.clearSelection();
      this.op = { mode: 'marquee', start: w, cur: w, additive: e.shiftKey };
    },
    startTransform(hh, w, view) {
      const f = hh.frame, h = hh.handle;
      const orig = new Map(S.selected().filter(S.isEditable).map(s => [s.id, { x: s.x, y: s.y, rotation: s.rotation, scaleX: s.scaleX, scaleY: s.scaleY }]));
      if (h.kind === 'rotate') {
        const c = f.center;
        this.op = { mode: 'rotate', frame: f, orig, c, a0: Math.atan2(w.y - c[1], w.x - c[0]), moved: false };
      } else {
        this.op = { mode: 'scale', frame: f, handle: h, orig, start: w, moved: false };
      }
    },
    move(e, w, view) {
      const op = this.op;
      if (!op) { this.hover(w, view); return; }
      if (op.mode === 'marquee') { op.cur = w; return; }
      if (!op.moved) {
        const s0 = view.toScreen(op.start ? op.start.x : w.x, op.start ? op.start.y : w.y);
        if (op.mode === 'move' && Math.hypot(s0[0] - w.sx, s0[1] - w.sy) < 3) return;
        if (!op.orig.size) return;
        S.checkpoint();
        op.moved = true;
      }
      if (op.mode === 'move') {
        let dx = w.x - op.start.x, dy = w.y - op.start.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const patches = new Map();
        op.orig.forEach((o, id) => patches.set(id, { x: o.x + dx, y: o.y + dy }));
        S.updateMany(patches, { history: false, kind: 'transform' });
      } else if (op.mode === 'rotate') {
        let da = Math.atan2(w.y - op.c[1], w.x - op.c[0]) - op.a0;
        let deg = da * 180 / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        const r = deg * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
        const patches = new Map();
        op.orig.forEach((o, id) => {
          const dx = o.x - op.c[0], dy = o.y - op.c[1];
          patches.set(id, {
            rotation: normDeg(o.rotation + deg),
            x: op.frame.type === 'single' ? o.x : op.c[0] + dx * cs - dy * sn,
            y: op.frame.type === 'single' ? o.y : op.c[1] + dx * sn + dy * cs,
          });
        });
        // single object: rotate around its visual center (which may differ from x,y slightly)
        if (op.frame.type === 'single') {
          const [id, o] = op.orig.entries().next().value;
          const c = op.frame.center;
          const dx = o.x - c[0], dy = o.y - c[1];
          patches.set(id, { rotation: normDeg(o.rotation + deg), x: c[0] + dx * cs - dy * sn, y: c[1] + dx * sn + dy * cs });
        }
        S.updateMany(patches, { history: false, kind: 'transform' });
        view.events.emit('hint', 'Rotation ' + U.fmt(normDeg(deg), 1) + '°' + (e.shiftKey ? ' (snapped)' : ' - hold Shift to snap to 15°'));
      } else if (op.mode === 'scale') {
        this.applyScale(e, w, op);
      }
    },
    applyScale(e, w, op) {
      const f = op.frame, h = op.handle;
      const patches = new Map();
      if (f.type === 'single') {
        const [id, o] = op.orig.entries().next().value;
        const { cx, cy, hw, hh } = f.local;
        const ax = cx - h.hx * hw, ay = cy - h.hy * hh; // anchor (local)
        const m0 = G.matTRS(o.x, o.y, o.rotation, o.scaleX, o.scaleY);
        const A = G.apply(m0, ax, ay);
        const r = -o.rotation * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
        const vx = w.x - A[0], vy = w.y - A[1];
        const dx = vx * cs - vy * sn, dy = vx * sn + vy * cs; // pointer in object rotation frame
        let sx = o.scaleX, sy = o.scaleY;
        const corner = h.hx !== 0 && h.hy !== 0;
        const lockAspect = corner && !e.shiftKey;
        if (lockAspect) {
          const ex = h.hx * 2 * hw * o.scaleX, ey = h.hy * 2 * hh * o.scaleY;
          let k = (dx * ex + dy * ey) / (ex * ex + ey * ey || 1);
          k = Math.max(0.01, k);
          sx = o.scaleX * k; sy = o.scaleY * k;
        } else {
          if (h.hx !== 0 && hw > 1e-6) { sx = dx / (h.hx * 2 * hw); if (Math.sign(sx) !== Math.sign(o.scaleX) || Math.abs(sx) < 0.01) sx = Math.sign(o.scaleX) * 0.01; }
          if (h.hy !== 0 && hh > 1e-6) { sy = dy / (h.hy * 2 * hh); if (Math.sign(sy) !== Math.sign(o.scaleY) || Math.abs(sy) < 0.01) sy = Math.sign(o.scaleY) * 0.01; }
        }
        // keep anchor fixed: pos = A - R*S*anchorLocal
        const rr = o.rotation * Math.PI / 180, c2 = Math.cos(rr), s2 = Math.sin(rr);
        const lx = ax * sx, ly = ay * sy;
        patches.set(id, { scaleX: sx, scaleY: sy, x: A[0] - (lx * c2 - ly * s2), y: A[1] - (lx * s2 + ly * c2) });
      } else {
        const bb = f.bbox;
        const P = [h.hx < 0 ? bb.maxX : bb.minX, h.hy < 0 ? bb.maxY : bb.minY];
        const ex = (h.hx < 0 ? bb.minX : bb.maxX) - P[0], ey = (h.hy < 0 ? bb.minY : bb.maxY) - P[1];
        let k = ((w.x - P[0]) * ex + (w.y - P[1]) * ey) / (ex * ex + ey * ey || 1);
        k = Math.max(0.01, k);
        op.orig.forEach((o, id) => patches.set(id, { x: P[0] + (o.x - P[0]) * k, y: P[1] + (o.y - P[1]) * k, scaleX: o.scaleX * k, scaleY: o.scaleY * k }));
      }
      S.updateMany(patches, { history: false, kind: 'transform' });
    },
    up(e, w, view) {
      const op = this.op;
      this.op = null;
      if (!op) return;
      if (op.mode === 'marquee') {
        const r = { minX: Math.min(op.start.x, w.x), maxX: Math.max(op.start.x, w.x), minY: Math.min(op.start.y, w.y), maxY: Math.max(op.start.y, w.y) };
        if ((r.maxX - r.minX) * view.zoom < 3 && (r.maxY - r.minY) * view.zoom < 3) return;
        const ids = S.project.objects.filter(o => {
          if (!S.isEditable(o)) return false;
          const b = OBJ.world(o).bbox;
          return b && b.maxX >= r.minX && b.minX <= r.maxX && b.maxY >= r.minY && b.minY <= r.maxY;
        }).map(o => o.id);
        if (op.additive) S.select(Array.from(new Set(S.selection.concat(ids))));
        else S.select(ids);
      } else if (op.moved) {
        S.changed('transform-end');
      }
      view.events.emit('hint', null);
    },
    hover(w, view) {
      const hh = view.hitHandle(w.sx, w.sy);
      let cur = 'default';
      if (hh) {
        if (hh.handle.kind === 'rotate') cur = 'grab';
        else {
          const { hx, hy } = hh.handle;
          const o = hh.frame.obj;
          let ang = Math.atan2(hy, hx) * 180 / Math.PI + (o ? o.rotation : 0);
          ang = ((Math.round(ang / 45) % 4) + 4) % 4;
          cur = ['ew-resize', 'nesw-resize', 'ns-resize', 'nwse-resize'][ang];
        }
      } else if (view.pick(w)) cur = 'move';
      view.canvas.style.cursor = cur;
    },
    dblclick(e, w, view) {
      const o = view.pick(w);
      if (o && o.type === 'text') { S.select(o.id); PP.UI.focusTextEditor(); }
    },
    overlay(ctx, view) {
      const op = this.op;
      if (op && op.mode === 'marquee') {
        const a = view.toScreen(op.start.x, op.start.y), b = view.toScreen(op.cur.x, op.cur.y);
        ctx.fillStyle = C.selFill;
        ctx.strokeStyle = C.sel;
        ctx.setLineDash([4, 3]);
        ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
        ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
        ctx.setLineDash([]);
      }
    },
    cancel() { this.op = null; },
  };

  function normDeg(d) { d = d % 360; if (d > 180) d -= 360; if (d <= -180) d += 360; return d; }

  // ---- Pan ----
  const panTool = { id: 'pan', cursor: 'grab' };

  // ---- Freehand pen ----
  const penTool = {
    id: 'pen', cursor: 'crosshair', pts: null,
    down(e, w) {
      if (!requireEditableLayer()) return;
      this.pts = [w.x, w.y];
    },
    move(e, w, view) {
      if (!this.pts) return;
      const n = this.pts.length;
      const dx = w.x - this.pts[n - 2], dy = w.y - this.pts[n - 1];
      if (Math.hypot(dx, dy) * view.zoom >= 1.5) this.pts.push(w.x, w.y);
    },
    up() {
      const pts = this.pts;
      this.pts = null;
      if (!pts || pts.length < 4) return;
      const ds = PP.App.drawSettings;
      let p = G.simplify(pts, 0.08);
      if (ds.smoothing > 0) p = G.chaikin(p, Math.round(ds.smoothing), false);
      p = G.simplify(p, 0.03);
      S.add(OBJ.create.path([p], { name: 'Freehand' }));
    },
    overlay(ctx, view) {
      if (!this.pts) return;
      ctx.strokeStyle = layerColor(); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      strokePolyScreen(ctx, view, this.pts, false);
    },
    cancel() { this.pts = null; },
  };

  // ---- Line ----
  const lineTool = {
    id: 'line', cursor: 'crosshair', a: null, b: null,
    down(e, w) { if (!requireEditableLayer()) return; this.a = [w.x, w.y]; this.b = [w.x, w.y]; },
    move(e, w) { if (!this.a) return; this.b = e.shiftKey ? snapAngle(this.a[0], this.a[1], w.x, w.y) : [w.x, w.y]; },
    up() {
      const a = this.a, b = this.b;
      this.a = this.b = null;
      if (!a || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.3) return;
      S.add(OBJ.create.path([[a[0], a[1], b[0], b[1]]], { name: 'Line' }));
    },
    overlay(ctx, view) {
      if (!this.a) return;
      ctx.strokeStyle = layerColor(); ctx.lineWidth = 2;
      strokePolyScreen(ctx, view, [this.a[0], this.a[1], this.b[0], this.b[1]]);
      const L = Math.hypot(this.b[0] - this.a[0], this.b[1] - this.a[1]);
      const s = view.toScreen(this.b[0], this.b[1]);
      ctx.fillStyle = '#10b981'; ctx.font = '11px system-ui'; ctx.fillText(U.fmt(L, 1) + ' mm', s[0] + 10, s[1] - 10);
    },
    cancel() { this.a = this.b = null; },
  };

  // ---- Polyline / Curve (click to add points) ----
  function makeClickTool(id, smooth) {
    return {
      id, cursor: 'crosshair', pts: null, hover: null,
      down(e, w, view) {
        if (!this.pts) { if (!requireEditableLayer()) return; this.pts = []; }
        let x = w.x, y = w.y;
        const n = this.pts.length;
        if (n >= 2 && e.shiftKey) [x, y] = snapAngle(this.pts[n - 2], this.pts[n - 1], x, y);
        if (n >= 6) {
          const s0 = view.toScreen(this.pts[0], this.pts[1]);
          if (Math.hypot(s0[0] - w.sx, s0[1] - w.sy) < 8) { this.finish(true); return; }
        }
        if (n >= 2) {
          const sl = view.toScreen(this.pts[n - 2], this.pts[n - 1]);
          if (Math.hypot(sl[0] - w.sx, sl[1] - w.sy) < 3) return; // ignore double clicks
        }
        this.pts.push(x, y);
      },
      move(e, w) {
        if (!this.pts || !this.pts.length) { this.hover = null; return; }
        const n = this.pts.length;
        this.hover = e.shiftKey ? snapAngle(this.pts[n - 2], this.pts[n - 1], w.x, w.y) : [w.x, w.y];
      },
      dblclick() { this.finish(false); },
      key(e) {
        if (!this.pts) return false;
        if (e.key === 'Enter') { this.finish(false); return true; }
        if (e.key === 'Escape') { this.cancel(); return true; }
        if (e.key === 'Backspace') { this.pts.splice(-2, 2); if (!this.pts.length) this.pts = null; return true; }
        return false;
      },
      finish(closed) {
        const pts = this.pts;
        this.pts = null; this.hover = null;
        if (!pts || pts.length < 4) return;
        let p = pts.slice();
        if (smooth) p = G.catmullRom(p, closed, 0.4);
        else if (closed) p.push(p[0], p[1]);
        if (smooth && closed) p.push(p[0], p[1]);
        S.add(OBJ.create.path([p], { name: smooth ? 'Curve' : 'Polyline' }));
        PP.App.view.invalidate();
      },
      overlay(ctx, view) {
        if (!this.pts || !this.pts.length) return;
        let pts = this.pts.slice();
        if (this.hover) pts.push(this.hover[0], this.hover[1]);
        if (smooth && pts.length >= 6) pts = G.catmullRom(pts, false, 1 / view.zoom * 3);
        ctx.strokeStyle = layerColor(); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        strokePolyScreen(ctx, view, pts, false);
        ctx.fillStyle = '#10b981';
        for (let j = 0; j < this.pts.length; j += 2) {
          const s = view.toScreen(this.pts[j], this.pts[j + 1]);
          ctx.fillRect(s[0] - 3, s[1] - 3, 6, 6);
        }
      },
      cancel() { this.pts = null; this.hover = null; },
    };
  }

  // ---- Shapes (drag) ----
  function makeShapeTool(id, shape) {
    return {
      id, cursor: 'crosshair', a: null, b: null, alt: false, shift: false,
      down(e, w) { if (!requireEditableLayer()) return; this.a = [w.x, w.y]; this.b = [w.x, w.y]; },
      move(e, w) { if (!this.a) return; this.b = [w.x, w.y]; this.alt = e.altKey; this.shift = e.shiftKey; },
      box() {
        let [x0, y0] = this.a, [x1, y1] = this.b;
        let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
        if (this.shift) { w = h = Math.max(w, h); }
        let cx, cy;
        if (this.alt) { cx = x0; cy = y0; w *= 2; h *= 2; }
        else { cx = x0 + Math.sign(x1 - x0 || 1) * w / 2; cy = y0 + Math.sign(y1 - y0 || 1) * h / 2; }
        return { cx, cy, w, h };
      },
      up() {
        if (!this.a) return;
        const b = this.box();
        this.a = this.b = null;
        if (b.w < 0.5 || b.h < 0.5) return;
        const ds = PP.App.drawSettings;
        S.add(OBJ.create.shape(shape, { x: b.cx, y: b.cy, w: b.w, h: b.h, sides: ds.sides, points: ds.starPoints, inner: ds.starInner, radius: shape === 'rect' ? ds.cornerRadius : 0 }));
      },
      overlay(ctx, view) {
        if (!this.a) return;
        const b = this.box();
        const ds = PP.App.drawSettings;
        let p;
        if (shape === 'rect') p = G.rect(b.w, b.h, ds.cornerRadius);
        else if (shape === 'ellipse') p = G.ellipse(b.w / 2, b.h / 2, 96);
        else if (shape === 'polygon') p = G.polygon(ds.sides, b.w / 2, b.h / 2);
        else p = G.star(ds.starPoints, b.w / 2, b.h / 2, ds.starInner);
        p = G.translate([p], b.cx, b.cy)[0];
        ctx.strokeStyle = layerColor(); ctx.lineWidth = 2;
        strokePolyScreen(ctx, view, p, false);
        const s = view.toScreen(b.cx + b.w / 2, b.cy - b.h / 2);
        ctx.fillStyle = '#10b981'; ctx.font = '11px system-ui';
        ctx.fillText(U.fmt(b.w, 1) + ' × ' + U.fmt(b.h, 1) + ' mm', s[0] + 8, s[1] + 14);
      },
      cancel() { this.a = this.b = null; },
    };
  }

  // ---- Text ----
  const textTool = {
    id: 'text', cursor: 'text',
    down(e, w, view) {
      const o = view.pick(w);
      if (o && o.type === 'text') { S.select(o.id); PP.UI.focusTextEditor(); return; }
      if (!requireEditableLayer()) return;
      const t = PP.UI.textDefaults();
      S.add(OBJ.create.text(Object.assign({}, t, { x: w.x, y: w.y })));
      PP.App.setTool('select');
      PP.UI.focusTextEditor(true);
    },
  };

  // ---- Eraser ----
  const eraserTool = {
    id: 'eraser', cursor: 'none', active: false, started: false, pos: null,
    down(e, w, view) { this.active = true; this.started = false; this.pos = w; this.erase(w, view); },
    move(e, w, view) {
      const prev = this.pos;
      this.pos = w;
      if (!this.active) return;
      // sweep between pointer samples so fast drags don't skip lines
      const r = PP.App.drawSettings.eraserSize / 2;
      const d = prev ? Math.hypot(w.x - prev.x, w.y - prev.y) : 0;
      const n = Math.min(200, Math.ceil(d / Math.max(0.1, r * 0.5)));
      for (let i = 1; i <= n; i++) this.erase({ x: prev.x + (w.x - prev.x) * i / n, y: prev.y + (w.y - prev.y) * i / n }, view);
      if (!n) this.erase(w, view);
    },
    up() { this.active = false; if (this.started) S.changed('erase'); this.started = false; },
    erase(w, view) {
      const r = PP.App.drawSettings.eraserSize / 2;
      const objs = S.project.objects.filter(o => {
        if (!S.isEditable(o)) return false;
        const b = OBJ.world(o).bbox;
        return b && !(b.maxX < w.x - r || b.minX > w.x + r || b.maxY < w.y - r || b.minY > w.y + r);
      });
      for (const o of objs) {
        const wp = OBJ.world(o).polys;
        const res = G.eraseCircle(wp, w.x, w.y, r);
        if (!res.changed) continue;
        if (!this.started) { S.checkpoint(); this.started = true; }
        if (!res.polys.length) { S.remove(o.id, { history: false }); continue; }
        // bake into a path object in world space, keep id & layer
        const c = G.center(res.polys);
        S.replace(o.id, Object.assign({}, OBJ.toPath(o), { paths: c.polys, x: c.cx, y: c.cy, rotation: 0, scaleX: 1, scaleY: 1, fill: null }), { history: false });
      }
    },
    overlay(ctx, view) {
      if (!this.pos) return;
      const r = PP.App.drawSettings.eraserSize / 2 * view.zoom;
      ctx.beginPath(); ctx.arc(this.pos.sx, this.pos.sy, Math.max(2, r), 0, Math.PI * 2);
      ctx.strokeStyle = '#e11d48'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 2]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(225,29,72,0.08)'; ctx.fill();
    },
    cancel() { this.active = false; this.pos = null; },
  };

  function installTools(view) {
    const t = view.tools;
    t.select = selectTool;
    t.pan = panTool;
    t.pen = penTool;
    t.line = lineTool;
    t.polyline = makeClickTool('polyline', false);
    t.curve = makeClickTool('curve', true);
    t.rect = makeShapeTool('rect', 'rect');
    t.ellipse = makeShapeTool('ellipse', 'ellipse');
    t.polygon = makeShapeTool('polygon', 'polygon');
    t.star = makeShapeTool('star', 'star');
    t.text = textTool;
    t.eraser = eraserTool;
  }

  PP.View = View;
  PP.installTools = installTools;
  PP.CanvasColors = C;
})(window.PP = window.PP || {});
