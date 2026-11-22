const STAMP_GROUPS = [
  { name: "電掣", items: ["13A單蘇", "13A孖蘇", "燈掣", "雙控掣", "數據掣", "電視掣", "冷氣掣", "曲架掣", "電箱"] },
  { name: "水煤", items: ["冷水喉", "熱水喉", "去水位", "地台去水", "煤氣掣", "煤氣錶"] },
  { name: "收口/結構", items: ["收口條", "見光板", "石膏線", "燈槽", "假天花底", "橫樑陣位", "柱位", "暗門", "地腳線"] }
];

export class MeasureCanvas {
  constructor(container, imageUrl, initialData, rulerColors, onSave) {
    this.container = container;
    this.imageUrl = imageUrl;
    this.rawInitialData = (initialData && !Array.isArray(initialData) && typeof initialData === "object")
      ? JSON.parse(JSON.stringify(initialData)) : {};

    if (Array.isArray(initialData)) {
      this.lines = JSON.parse(JSON.stringify(initialData));
      this.markers = [];
      this.stickers = [];
      this.paths = [];
    } else {
      this.lines = JSON.parse(JSON.stringify(initialData?.lines || []));
      this.markers = JSON.parse(JSON.stringify(initialData?.markers || []));
      this.stickers = JSON.parse(JSON.stringify(initialData?.stickers || initialData?.images || []));
      this.paths = JSON.parse(JSON.stringify(initialData?.paths || []));
    }

    const rawColors = (rulerColors && rulerColors.length)
      ? rulerColors.map(c => typeof c === "string" ? c : c.hex)
      : ["#EF4444", "#2563EB", "#16A34A", "#D97706", "#9333EA", "#111827"];
    this.colors = rawColors.filter(Boolean);
    this.activeColor = this.colors[0] || "#EF4444";
    this.onSave = onSave;

    this.tool = "RULER";
    this.activeStamp = "13A孖蘇";
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;

    this.history = [];
    this.redoStack = [];
    this.selectedLineIdx = -1;
    this.selectedStickerIdx = -1;
    this.activeSegIdx = -1;
    this.inlineState = null;
    this.stickerCache = new Map();

    this.loadBaseImage(imageUrl, true);
  }

  loadBaseImage(src, isInitial = false) {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => {
      this.img = im;
      this.natW = im.naturalWidth || 1200;
      this.natH = im.naturalHeight || 900;
      if (isInitial) {
        this.preloadStickers();
        this.initUI();
        this.fitToScreen();
      }
      this.render();
    };
    im.onerror = () => {
      if (im.crossOrigin) {
        const fb = new Image();
        fb.onload = () => {
          this.img = fb;
          this.natW = fb.naturalWidth || 1200;
          this.natH = fb.naturalHeight || 900;
          if (isInitial) {
            this.preloadStickers();
            this.initUI();
            this.fitToScreen();
          }
          this.render();
        };
        fb.src = src;
      }
    };
    im.src = src;
  }

  preloadStickers() {
    this.stickers.forEach(st => {
      const src = st.url || st.src || st.dataUrl;
      if (src && !this.stickerCache.has(src)) {
        const im = new Image();
        im.crossOrigin = "anonymous";
        im.onload = () => this.render();
        im.src = src;
        this.stickerCache.set(src, im);
      }
    });
  }

  pushHistory() {
    this.history.push(JSON.stringify({
      imageUrl: this.imageUrl, lines: this.lines, markers: this.markers, stickers: this.stickers, paths: this.paths
    }));
    if (this.history.length > 40) this.history.shift();
    this.redoStack = [];
  }

  undo() {
    if (!this.history.length) return;
    this.commitInline(false);
    this.redoStack.push(JSON.stringify({
      imageUrl: this.imageUrl, lines: this.lines, markers: this.markers, stickers: this.stickers, paths: this.paths
    }));
    const prev = JSON.parse(this.history.pop());
    this.lines = prev.lines || [];
    this.markers = prev.markers || [];
    this.stickers = prev.stickers || [];
    this.paths = prev.paths || [];
    this.preloadStickers();
    this.selectedLineIdx = -1;
    this.selectedStickerIdx = -1;
    this.updateStickerBar();
    if (prev.imageUrl && prev.imageUrl !== this.imageUrl) {
      this.imageUrl = prev.imageUrl;
      this.loadBaseImage(prev.imageUrl, false);
    } else {
      this.render();
    }
    this.triggerSave();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.commitInline(false);
    this.history.push(JSON.stringify({
      imageUrl: this.imageUrl, lines: this.lines, markers: this.markers, stickers: this.stickers, paths: this.paths
    }));
    const next = JSON.parse(this.redoStack.pop());
    this.lines = next.lines || [];
    this.markers = next.markers || [];
    this.stickers = next.stickers || [];
    this.paths = next.paths || [];
    this.preloadStickers();
    this.updateStickerBar();
    if (next.imageUrl && next.imageUrl !== this.imageUrl) {
      this.imageUrl = next.imageUrl;
      this.loadBaseImage(next.imageUrl, false);
    } else {
      this.render();
    }
    this.triggerSave();
  }

  triggerSave() {
    if (this.onSave) {
      const payload = {
        ...this.rawInitialData,
        lines: this.lines,
        markers: this.markers,
        stickers: this.stickers,
        paths: this.paths
      };
      if (this.imageUrl) {
        if ("imageUrl" in this.rawInitialData) payload.imageUrl = this.imageUrl;
        if ("url" in this.rawInitialData) payload.url = this.imageUrl;
      }
      this.onSave(payload);
    }
  }

  initUI() {
    this.container.innerHTML = `
      <div class="mc-wrapper" style="background:#111827; border-radius:8px; overflow:hidden; display:flex; flex-direction:column; user-select:none;">
        <!-- 頂部工具列：正中對齊 -->
        <div style="display:flex; justify-content:center; align-items:center; padding:6px 10px; background:#1F2937; border-bottom:1px solid #374151; flex-wrap:wrap; gap:12px;">
          <div style="display:flex; align-items:center; gap:6px;">
            ${this.colors.map(c => `
              <button type="button" class="mc-color-btn" data-color="${c}"
                      style="width:21px; height:21px; border-radius:50%; background:${c}; border:${c === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280"}; cursor:pointer;"></button>
            `).join("")}
          </div>
          <div style="width:1px; height:16px; background:#4B5563;"></div>
          <div style="display:flex; align-items:center; gap:6px;">
            <button type="button" id="mc-fit" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;">重置視角</button>
            <button type="button" id="mc-undo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;">↩ 復原</button>
            <button type="button" id="mc-redo" class="btn-outline btn-sm" style="background:#374151; color:#FFF; border-color:#4B5563;">↪ 重做</button>
          </div>
        </div>

        <!-- 中央畫布視窗 -->
        <div id="mc-viewport" style="position:relative; width:100%; height:68vh; min-height:400px; background:#0F172A; overflow:hidden; touch-action:none;">
          <canvas id="mc-canvas" style="display:block; width:100%; height:100%;"></canvas>
          <input type="file" id="mc-sticker-input" accept="image/*" class="hidden">

          <!-- 就地直接打字輸入框（零跳窗） -->
          <input type="text" id="mc-inline-input" class="hidden" autocomplete="off" spellcheck="false"
                 style="position:absolute; transform:translate(-50%, -50%); background:rgba(255,255,255,0.96); border:1.5px dashed #2563EB; border-radius:4px; padding:2px 6px; text-align:center; font-weight:800; outline:none; z-index:25; min-width:56px; box-shadow:0 2px 8px rgba(0,0,0,0.25);" />

          <!-- 選中貼圖時的快捷合併條 -->
          <div id="mc-sticker-bar" class="hidden" style="position:absolute; top:12px; left:50%; transform:translateX(-50%); background:rgba(17,24,39,0.94); border:1px solid #34D399; border-radius:8px; padding:6px 12px; display:flex; align-items:center; gap:10px; z-index:22; box-shadow:0 6px 20px rgba(0,0,0,0.45);">
            <span style="font-size:12px; color:#A7F3D0; font-weight:700;">🖼️ 拖動調整貼圖位置／右下角縮放</span>
            <button type="button" id="mc-merge-sticker" style="background:#059669; color:#FFF; border:none; border-radius:5px; padding:4px 10px; font-size:12px; font-weight:700; cursor:pointer;">📌 確定合併進底圖</button>
            <button type="button" id="mc-del-sticker" style="background:#DC2626; color:#FFF; border:none; border-radius:5px; padding:4px 8px; font-size:12px; font-weight:700; cursor:pointer;">刪除</button>
          </div>

          <!-- 精緻懸浮印章卡片 -->
          <div id="mc-stamp-drawer" class="hidden" style="position:absolute; bottom:10px; left:50%; transform:translateX(-50%); width:92%; max-width:520px; background:rgba(255,255,255,0.97); padding:8px 10px; border-radius:10px; border:1.5px solid #CBD5E1; box-shadow:0 10px 25px rgba(0,0,0,0.4); z-index:20; display:flex; flex-direction:column; gap:5px;">
            ${STAMP_GROUPS.map(g => `
              <div style="display:flex; flex-wrap:wrap; align-items:center; gap:4px;">
                <span style="font-size:11px; font-weight:700; color:#475569; min-width:52px;">${g.name}：</span>
                ${g.items.map(st => `
                  <button type="button" class="chip mc-stamp-chip ${st === this.activeStamp ? "active" : ""}" data-stamp="${st}" style="font-size:11px; padding:2px 7px;">${st}</button>
                `).join("")}
              </div>
            `).join("")}
          </div>
        </div>

        <!-- 底部工具列：正中對齊 -->
        <div style="display:flex; justify-content:center; align-items:center; padding:6px 8px; background:#1F2937; border-top:1px solid #374151; flex-wrap:wrap; gap:6px;">
          ${[
            { id: "PAN", label: "✋ 移動縮放" },
            { id: "RULER", label: "📏 拉尺線" },
            { id: "CHAIN", label: "🔗 分段拉尺" },
            { id: "PEN", label: "✏️ 手繪" },
            { id: "STAMP", label: "🔖 印章庫" },
            { id: "TEXT", label: "🔤 文字" },
            { id: "STICKER", label: "🖼️ 貼圖" },
            { id: "ERASER", label: "🧹 擦除" }
          ].map(t => `
            <button type="button" class="mc-tool-btn" data-tool="${t.id}"
                    style="padding:5px 10px; border-radius:5px; font-size:12px; font-weight:700; cursor:pointer; border:1px solid ${t.id === this.tool ? "#FFF" : "#4B5563"}; background:${t.id === this.tool ? "#2563EB" : "#374151"}; color:#FFF;">
              ${t.label}
            </button>
          `).join("")}
        </div>
      </div>
    `;

    this.viewport = document.getElementById("mc-viewport");
    this.canvas = document.getElementById("mc-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.inlineInput = document.getElementById("mc-inline-input");

    this.bindToolbarEvents();
    this.bindInlineEvents();
    this.bindPointerEvents();
    window.addEventListener("resize", () => { this.render(); this.positionInline(); });
    window.addEventListener("paste", (e) => {
      if (!document.body.contains(this.canvas)) return;
      for (const it of (e.clipboardData?.items || [])) {
        if (it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) this.addStickerFile(f);
        }
      }
    });
  }

  startInline(state) {
    this.commitInline(false);
    this.inlineState = state;
    this.inlineInput.value = state.val || "";
    this.inlineInput.placeholder = state.kind === "line" ? "數字(如1755-5)" : "輸入文字...";
    this.inlineInput.style.color = state.color || this.activeColor;
    this.inlineInput.classList.remove("hidden");
    this.positionInline();
    this.render();
    requestAnimationFrame(() => { this.inlineInput.focus(); this.inlineInput.select(); });
  }

  positionInline() {
    if (!this.inlineState || this.inlineInput.classList.contains("hidden")) return;
    let ix = this.inlineState.x, iy = this.inlineState.y;
    if (this.inlineState.kind === "line") {
      const l = this.lines[this.inlineState.lineIdx];
      if (!l) return;
      ix = (l.x1 + l.x2) / 2;
      iy = (l.y1 + l.y2) / 2;
    } else if (this.inlineState.kind === "marker" && typeof this.inlineState.markerIdx === "number") {
      const m = this.markers[this.inlineState.markerIdx];
      if (m) { ix = m.x; iy = m.y; }
    }
    const sx = ix * this.scale + this.offsetX;
    const sy = iy * this.scale + this.offsetY;
    const fs = Math.max(14, Math.round((this.natW / 44) * this.scale));
    this.inlineInput.style.left = `${sx}px`;
    this.inlineInput.style.top = `${sy}px`;
    this.inlineInput.style.fontSize = `${fs}px`;
    this.inlineInput.style.width = `${Math.max(70, (this.inlineInput.value.length + 2) * fs * 0.72)}px`;
  }

  evalNumber(raw) {
    const clean = String(raw || "").trim().replace(/[^\d.+-]/g, "");
    if (!clean) return "";
    const toks = clean.match(/[+-]?[\d.]+/g);
    if (!toks) return clean;
    const sum = toks.reduce((a, b) => a + (parseFloat(b) || 0), 0);
    return String(Math.round(sum * 100) / 100);
  }

  commitInline(doRender = true) {
    if (!this.inlineState) return;
    const st = this.inlineState;
    const val = this.inlineInput.value.trim();
    this.inlineState = null;
    this.inlineInput.classList.add("hidden");

    if (st.kind === "line") {
      const l = this.lines[st.lineIdx];
      if (l) {
        this.pushHistory();
        const numStr = this.evalNumber(val);
        if (Array.isArray(l.chainSegs) && l.chainSegs.length > 0 && st.segIdx >= 0) {
          l.chainSegs[st.segIdx].val = Number(numStr || 0);
          l.text = String(l.chainSegs.reduce((s, c) => s + (Number(c.val) || 0), 0));
        } else {
          l.text = numStr;
        }
        this.triggerSave();
      }
    } else if (st.kind === "marker") {
      if (typeof st.markerIdx === "number" && this.markers[st.markerIdx]) {
        if (val) { this.pushHistory(); this.markers[st.markerIdx].text = val; this.triggerSave(); }
      } else if (val) {
        this.pushHistory();
        this.markers.push({ x: st.x, y: st.y, text: val, color: st.color || this.activeColor, isStamp: false });
        this.triggerSave();
      }
    }
    if (doRender) this.render();
  }

  bindInlineEvents() {
    this.inlineInput.addEventListener("input", () => this.positionInline());
    this.inlineInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); this.commitInline(true); }
      else if (e.key === "Escape") { e.preventDefault(); this.inlineState = null; this.inlineInput.classList.add("hidden"); this.render(); }
    });
    this.inlineInput.addEventListener("blur", () => { if (this.inlineState) this.commitInline(true); });
  }

  addStickerFile(file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      const im = new Image();
      im.onload = () => {
        const w = Math.min(im.width, this.natW * 0.3);
        const h = w * (im.height / (im.width || 1));
        this.pushHistory();
        const cx = (-this.offsetX + this.viewport.clientWidth / 2) / this.scale;
        const cy = (-this.offsetY + this.viewport.clientHeight / 2) / this.scale;
        this.stickers.push({ x: cx - w / 2, y: cy - h / 2, w, h, url: dataUrl });
        this.stickerCache.set(dataUrl, im);
        this.selectedStickerIdx = this.stickers.length - 1;
        this.setTool("PAN");
        this.updateStickerBar();
        this.render();
        this.triggerSave();
      };
      im.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  mergeStickerToBase() {
    if (this.selectedStickerIdx < 0 || !this.stickers[this.selectedStickerIdx]) return;
    const st = this.stickers[this.selectedStickerIdx];
    const src = st.url || st.src || st.dataUrl;
    const stImg = src ? this.stickerCache.get(src) : null;
    if (!stImg || !stImg.complete) return;

    const off = document.createElement("canvas");
    off.width = this.natW;
    off.height = this.natH;
    const octx = off.getContext("2d");
    octx.drawImage(this.img, 0, 0, this.natW, this.natH);
    octx.drawImage(stImg, st.x, st.y, st.w, st.h);

    try {
      const merged = off.toDataURL("image/jpeg", 0.92);
      this.pushHistory();
      this.stickers.splice(this.selectedStickerIdx, 1);
      this.selectedStickerIdx = -1;
      this.imageUrl = merged;
      this.updateStickerBar();
      this.loadBaseImage(merged, false);
      this.triggerSave();
    } catch (e) {
      alert("原底圖受瀏覽器跨網域安全限制，無法直接輸出合併圖；請先下載截圖再換底圖上傳。");
    }
  }

  updateStickerBar() {
    const bar = document.getElementById("mc-sticker-bar");
    if (!bar) return;
    if (this.selectedStickerIdx >= 0 && this.stickers[this.selectedStickerIdx]) bar.classList.remove("hidden");
    else bar.classList.add("hidden");
  }

  setTool(toolId) {
    this.commitInline(false);
    this.tool = toolId;
    this.container.querySelectorAll(".mc-tool-btn").forEach(b => {
      const active = b.dataset.tool === this.tool;
      b.style.background = active ? "#2563EB" : "#374151";
      b.style.borderColor = active ? "#FFF" : "#4B5563";
    });
    const drawer = document.getElementById("mc-stamp-drawer");
    if (drawer) {
      if (this.tool === "STAMP") drawer.classList.remove("hidden");
      else drawer.classList.add("hidden");
    }
  }

  bindToolbarEvents() {
    this.container.querySelectorAll(".mc-color-btn").forEach(btn => {
      btn.onclick = () => {
        this.activeColor = btn.dataset.color;
        this.container.querySelectorAll(".mc-color-btn").forEach(b => {
          b.style.border = b.dataset.color === this.activeColor ? "2.5px solid #FFF" : "1px solid #6B7280";
        });
      };
    });

    const stInput = document.getElementById("mc-sticker-input");
    stInput.onchange = (e) => { if (e.target.files?.[0]) this.addStickerFile(e.target.files[0]); stInput.value = ""; };

    this.container.querySelectorAll(".mc-tool-btn").forEach(btn => {
      btn.onclick = () => {
        if (btn.dataset.tool === "STICKER") { stInput.click(); return; }
        this.setTool(btn.dataset.tool);
      };
    });

    this.container.querySelectorAll(".mc-stamp-chip").forEach(btn => {
      btn.onclick = () => {
        this.activeStamp = btn.dataset.stamp;
        this.container.querySelectorAll(".mc-stamp-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("mc-stamp-drawer")?.classList.add("hidden");
      };
    });

    document.getElementById("mc-merge-sticker").onclick = () => this.mergeStickerToBase();
    document.getElementById("mc-del-sticker").onclick = () => {
      if (this.selectedStickerIdx >= 0) {
        this.pushHistory();
        this.stickers.splice(this.selectedStickerIdx, 1);
        this.selectedStickerIdx = -1;
        this.updateStickerBar();
        this.render();
        this.triggerSave();
      }
    };
    document.getElementById("mc-fit").onclick = () => { this.fitToScreen(); this.render(); this.positionInline(); };
    document.getElementById("mc-undo").onclick = () => this.undo();
    document.getElementById("mc-redo").onclick = () => this.redo();
  }

  fitToScreen() {
    const rect = this.viewport.getBoundingClientRect();
    const vw = rect.width || 800, vh = rect.height || 500;
    this.scale = Math.min(vw / this.natW, vh / this.natH) * 0.96;
    this.offsetX = (vw - this.natW * this.scale) / 2;
    this.offsetY = (vh - this.natH * this.scale) / 2;
  }

  screenToImg(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (clientX - rect.left - this.offsetX) / this.scale, y: (clientY - rect.top - this.offsetY) / this.scale };
  }

  bindPointerEvents() {
    let isDown = false, startPt = null, lastPt = null, draftLine = null, draftPath = null, panStart = null, stickerDragMode = null;
    let pinchStartDist = 0, pinchStartScale = 1, hasMoved = false;
    const activePointers = new Map();

    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.inlineState) { this.commitInline(true); return; }
      this.canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartScale = this.scale;
        draftLine = null; draftPath = null;
        return;
      }

      isDown = true; hasMoved = false;
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      startPt = imgPt; lastPt = imgPt;

      if (this.tool === "PAN") {
        this.selectedStickerIdx = -1; stickerDragMode = null;
        for (let i = this.stickers.length - 1; i >= 0; i--) {
          const s = this.stickers[i];
          if (Math.hypot(imgPt.x - (s.x + s.w), imgPt.y - (s.y + s.h)) < 22 / this.scale) {
            this.selectedStickerIdx = i; stickerDragMode = "resize"; this.pushHistory(); break;
          }
          if (imgPt.x >= s.x && imgPt.x <= s.x + s.w && imgPt.y >= s.y && imgPt.y <= s.y + s.h) {
            this.selectedStickerIdx = i; stickerDragMode = "move"; this.pushHistory(); break;
          }
        }
        this.updateStickerBar();
        if (this.selectedStickerIdx === -1) {
          panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
        }
        this.render();
      } else if (this.tool === "RULER" || this.tool === "CHAIN") {
        draftLine = {
          x1: imgPt.x, y1: imgPt.y, x2: imgPt.x, y2: imgPt.y,
          color: this.activeColor, text: "",
          chainSegs: this.tool === "CHAIN" ? [{ val: 0 }, { val: 0 }] : null
        };
      } else if (this.tool === "PEN") {
        draftPath = { color: this.activeColor, points: [{ x: imgPt.x, y: imgPt.y }] };
      } else if (this.tool === "STAMP") {
        this.pushHistory();
        this.markers.push({ x: imgPt.x, y: imgPt.y, text: this.activeStamp, color: this.activeColor, isStamp: true });
        this.render(); this.triggerSave();
      } else if (this.tool === "TEXT") {
        isDown = false;
        this.startInline({ kind: "marker", x: imgPt.x, y: imgPt.y, val: "", color: this.activeColor });
      } else if (this.tool === "ERASER") {
        this.eraseAt(imgPt);
      }
    });

    this.canvas.addEventListener("pointermove", (e) => {
      if (activePointers.has(e.pointerId)) activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchStartDist > 0) {
          const rect = this.canvas.getBoundingClientRect();
          const midX = (pts[0].x + pts[1].x) / 2 - rect.left, midY = (pts[0].y + pts[1].y) / 2 - rect.top;
          const nextScale = Math.max(0.15, Math.min(8, pinchStartScale * (dist / pinchStartDist)));
          this.offsetX = midX - (midX - this.offsetX) * (nextScale / this.scale);
          this.offsetY = midY - (midY - this.offsetY) * (nextScale / this.scale);
          this.scale = nextScale;
          this.render();
        }
        return;
      }

      if (!isDown) return;
      const imgPt = this.screenToImg(e.clientX, e.clientY);
      if (Math.hypot(imgPt.x - startPt.x, imgPt.y - startPt.y) > 3 / this.scale) hasMoved = true;

      if (this.tool === "PAN") {
        if (this.selectedStickerIdx >= 0 && stickerDragMode) {
          const s = this.stickers[this.selectedStickerIdx];
          if (stickerDragMode === "resize") { s.w = Math.max(30, imgPt.x - s.x); s.h = Math.max(30, imgPt.y - s.y); }
          else { s.x += imgPt.x - lastPt.x; s.y += imgPt.y - lastPt.y; }
          this.render();
        } else if (panStart) {
          this.offsetX = e.clientX - panStart.x;
          this.offsetY = e.clientY - panStart.y;
          this.render();
        }
      } else if (draftLine) {
        const dx = imgPt.x - startPt.x, dy = imgPt.y - startPt.y;
        if (Math.abs(dy) < Math.abs(dx) * 0.08) { draftLine.x2 = imgPt.x; draftLine.y2 = startPt.y; }
        else if (Math.abs(dx) < Math.abs(dy) * 0.08) { draftLine.x2 = startPt.x; draftLine.y2 = imgPt.y; }
        else { draftLine.x2 = imgPt.x; draftLine.y2 = imgPt.y; }
        this.render(draftLine, null);
      } else if (draftPath) {
        draftPath.points.push({ x: imgPt.x, y: imgPt.y });
        this.render(null, draftPath);
      } else if (this.tool === "ERASER") {
        this.eraseAt(imgPt);
      }
      lastPt = imgPt;
    });

    const endPointer = (e) => {
      activePointers.delete(e.pointerId);
      if (this.tool === "PAN" && isDown && !hasMoved && this.selectedStickerIdx === -1) {
        const hitM = this.markers.findIndex(m => Math.hypot(m.x - startPt.x, m.y - startPt.y) < 24 / this.scale);
        if (hitM !== -1) {
          const m = this.markers[hitM];
          this.startInline({ kind: "marker", markerIdx: hitM, x: m.x, y: m.y, val: m.text || "", color: m.color });
        } else {
          const hitL = this.findNearestLine(startPt);
          if (hitL !== -1) {
            const l = this.lines[hitL];
            this.selectedLineIdx = hitL;
            this.startInline({ kind: "line", lineIdx: hitL, segIdx: 0, val: String(l.text || ""), color: l.color });
          }
        }
      }
      if (stickerDragMode && hasMoved) this.triggerSave();
      if (draftLine) {
        if (Math.hypot(draftLine.x2 - draftLine.x1, draftLine.y2 - draftLine.y1) > 15 / this.scale) {
          this.pushHistory();
          this.lines.push(draftLine);
          const idx = this.lines.length - 1;
          this.selectedLineIdx = idx;
          this.render(); this.triggerSave();
          this.startInline({ kind: "line", lineIdx: idx, segIdx: 0, val: "", color: draftLine.color });
        } else { this.render(); }
        draftLine = null;
      }
      if (draftPath) {
        if (draftPath.points.length > 1) { this.pushHistory(); this.paths.push(draftPath); this.render(); this.triggerSave(); }
        draftPath = null;
      }
      isDown = false; panStart = null; stickerDragMode = null;
    };

    this.canvas.addEventListener("pointerup", endPointer);
    this.canvas.addEventListener("pointercancel", endPointer);
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      const nextScale = Math.max(0.15, Math.min(8, this.scale * factor));
      this.offsetX = mx - (mx - this.offsetX) * (nextScale / this.scale);
      this.offsetY = my - (my - this.offsetY) * (nextScale / this.scale);
      this.scale = nextScale;
      this.render(); this.positionInline();
    }, { passive: false });
  }

  findNearestLine(pt) {
    const tol = 22 / this.scale;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      if (Math.hypot(pt.x - (l.x1 + l.x2) / 2, pt.y - (l.y1 + l.y2) / 2) < tol * 1.6) return i;
    }
    return -1;
  }

  eraseAt(pt) {
    const tol = 24 / this.scale;
    const sIdx = this.stickers.findIndex(s => pt.x >= s.x && pt.x <= s.x + s.w && pt.y >= s.y && pt.y <= s.y + s.h);
    if (sIdx !== -1) { this.pushHistory(); this.stickers.splice(sIdx, 1); this.selectedStickerIdx = -1; this.updateStickerBar(); this.render(); this.triggerSave(); return; }
    const mIdx = this.markers.findIndex(m => Math.hypot(m.x - pt.x, m.y - pt.y) < tol);
    if (mIdx !== -1) { this.pushHistory(); this.markers.splice(mIdx, 1); this.render(); this.triggerSave(); return; }
    const lIdx = this.findNearestLine(pt);
    if (lIdx !== -1) { this.pushHistory(); this.lines.splice(lIdx, 1); this.render(); this.triggerSave(); }
  }

  render(draftLine = null, draftPath = null) {
    if (!this.canvas || !this.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = this.viewport.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    const ctx = this.ctx;
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    ctx.drawImage(this.img, 0, 0, this.natW, this.natH);

    this.stickers.forEach((st, idx) => {
      const src = st.url || st.src || st.dataUrl;
      const im = src ? this.stickerCache.get(src) : null;
      if (im && im.complete) ctx.drawImage(im, st.x, st.y, st.w, st.h);
      if (idx === this.selectedStickerIdx) {
        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = 2.5 / this.scale;
        ctx.strokeRect(st.x, st.y, st.w, st.h);
        ctx.fillStyle = "#10B981";
        const hs = 10 / this.scale;
        ctx.fillRect(st.x + st.w - hs / 2, st.y + st.h - hs / 2, hs, hs);
      }
    });

    const allPaths = draftPath ? [...this.paths, draftPath] : this.paths;
    allPaths.forEach(p => {
      const pts = p.points || [];
      if (pts.length < 2) return;
      ctx.strokeStyle = p.color || "#111827";
      ctx.lineWidth = Math.max(2, this.natW / 520);
      ctx.lineCap = "round";
      ctx.beginPath();
      pts.forEach((pt, i) => i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    });

    const allLines = draftLine ? [...this.lines, draftLine] : this.lines;
    allLines.forEach((l, idx) => this.drawRulerLine(ctx, l, idx === this.selectedLineIdx, idx));

    this.markers.forEach((m, idx) => {
      if (this.inlineState?.kind === "marker" && this.inlineState?.markerIdx === idx) return;
      this.drawMarker(ctx, m);
    });

    ctx.restore();
  }

  drawRulerLine(ctx, l, isSelected, idx) {
    const color = l.color || "#EF4444";
    const lw = Math.max(2.5, (this.natW / 420));
    const headLen = lw * 4.5;
    const angle = Math.atan2(l.y2 - l.y1, l.x2 - l.x1);

    ctx.save();
    ctx.strokeStyle = isSelected ? "#FACC15" : color;
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(l.x1, l.y1); ctx.lineTo(l.x2, l.y2); ctx.stroke();

    const drawEnd = (x, y, ang) => {
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x + headLen * Math.cos(ang + 0.42), y + headLen * Math.sin(ang + 0.42));
      ctx.moveTo(x, y); ctx.lineTo(x + headLen * Math.cos(ang - 0.42), y + headLen * Math.sin(ang - 0.42));
      ctx.stroke();
    };
    drawEnd(l.x1, l.y1, angle);
    drawEnd(l.x2, l.y2, angle + Math.PI);

    if (this.inlineState?.kind === "line" && this.inlineState?.lineIdx === idx) { ctx.restore(); return; }

    let label = l.text ? String(l.text) : "";
    if (Array.isArray(l.chainSegs) && l.chainSegs.length > 0) {
      const segText = l.chainSegs.map(s => s.val || 0).join("+");
      const total = l.chainSegs.reduce((a, b) => a + (Number(b.val) || 0), 0);
      label = `${segText} = ${total}`;
    }

    if (label) {
      const mx = (l.x1 + l.x2) / 2, my = (l.y1 + l.y2) / 2;
      const fontSize = Math.max(16, Math.round(this.natW / 42));
      ctx.font = `800 ${fontSize}px -apple-system, sans-serif`;
      const metrics = ctx.measureText(label);
      const boxW = metrics.width + fontSize * 0.9, boxH = fontSize * 1.6;

      ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, lw * 0.6);
      ctx.beginPath(); ctx.roundRect(mx - boxW / 2, my - boxH / 2, boxW, boxH, 4); ctx.fill(); ctx.stroke();

      ctx.fillStyle = color;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, mx, my);
    }
    ctx.restore();
  }

  drawMarker(ctx, m) {
    const text = m.text || m.label || "";
    if (!text) return;
    const color = m.color || "#2563EB";
    const fontSize = Math.max(15, Math.round(this.natW / 46));
    ctx.save();
    ctx.font = `700 ${fontSize}px -apple-system, sans-serif`;
    const metrics = ctx.measureText(text);
    const w = metrics.width + fontSize, h = fontSize * 1.64;

    ctx.fillStyle = m.isStamp !== false ? color : "rgba(255,255,255,0.94)";
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, this.natW / 500);
    ctx.beginPath(); ctx.roundRect(m.x - w / 2, m.y - h / 2, w, h, 5); ctx.fill(); ctx.stroke();

    ctx.fillStyle = m.isStamp !== false ? "#FFFFFF" : color;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, m.x, m.y);
    ctx.restore();
  }
}
